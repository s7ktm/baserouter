// The one address: /v1/chat/completions, /v1/images/generations, /v1/audio/speech,
// /v1/audio/transcriptions and /v1/models, opened with a route's key.
import { Hono, type Context } from "hono";
import { gate, monthStart } from "./budget.ts";
import { later, refuse, type Deps, type Env } from "./deps.ts";
import { imagesIn, isPcm, MediaKeeper, pcmFormat, promptOf, type Found, type MediaFile } from "./media.ts";
import * as openrouter from "./openrouter.ts";
import { hashKey, unseal } from "./secrets.ts";
import type { Failure, Kind, ProviderRow, RouteRow } from "./store.ts";
import { readPlain, StreamScanner, type Reading } from "./usage.ts";

const allowedModels = (route: RouteRow): string[] => JSON.parse(route.models) as string[];

// Only these response headers are passed back. The rest describe the connection
// between the gateway and the provider, not the one to the client.
function passHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const name of ["content-type", "cache-control", "retry-after"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

// A route's models are an order: when the model asked for fails, the next ones are tried.
// OpenRouter does that itself when the request carries "models", so the gateway adds it:
// the model asked for first, then the route's other models in the route's order. The body
// is left exactly as written when the route has one model, or the client sent its own list
// (which forward() has already checked against the route's models).
export function withFallbacks(text: string, body: Record<string, unknown>, model: string, routeModels: string[]): string {
  if (routeModels.length < 2 || "models" in body) return text;
  return JSON.stringify({ ...body, models: [model, ...routeModels.filter((m) => m !== model)] });
}

// What a chat request makes, from the "modalities" it asks for.
export function chatKind(body: Record<string, unknown>): Kind {
  const modalities = Array.isArray(body.modalities) ? body.modalities : [];
  if (modalities.includes("image")) return "image";
  if (modalities.includes("audio")) return "speech";
  return "chat";
}

// Reads the request body, but no more than the limit. Null when it is larger.
async function readBody(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (declared > limit) {
    await request.body?.cancel().catch(() => {});
    return null;
  }
  if (!request.body) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const part of request.body) {
    size += part.byteLength;
    if (size > limit) return null;
    parts.push(part);
  }
  return Buffer.concat(parts);
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

// What one endpoint needs to say about a request before it is sent on.
// prompt: for a request that makes images or speech, the words that asked for them.
type Prepared =
  | { ok: false; response: Response }
  | { ok: true; model: string; alsoModels?: string[]; body: Uint8Array | string; contentType: string; kind: Kind; streamed: boolean; prompt?: string | null };

type Prepare = (c: Context<Env>, bytes: Uint8Array, route: RouteRow) => Promise<Prepared> | Prepared;

const invalid = (c: Context<Env>, message: string): Prepared => ({ ok: false, response: refuse(c, 400, "invalid_request", message) });
const noModel = 'The request does not say which model to use. Add "model".';

// What a model id may look like: OpenRouter's are "author/name", sometimes with ":variant"
// or a leading "~". Anything else (markup, spaces, control characters) is refused, so a
// model id is always safe to show and to record.
export const validModelId = (id: unknown): id is string => typeof id === "string" && /^[\w~][\w.:/@+~-]{0,199}$/.test(id);
const badModel = (c: Context<Env>, id: string) => invalid(c, `"${id.slice(0, 60).replace(/[^\w.:/@+~ -]/g, "?")}" is not a model id.`);

// A JSON body with a "model". Chat requests get the route's fallbacks; the others are sent as written.
function json(kind: Kind | "chat-modalities", fallbacks: boolean): Prepare {
  return (c, bytes, route) => {
    const text = new TextDecoder().decode(bytes);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return invalid(c, "The request body is not valid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return invalid(c, "The request body is not a JSON object.");
    const fields = body as Record<string, unknown>;
    const model = typeof fields.model === "string" ? fields.model : "";
    if (!model) return invalid(c, noModel);
    if (!validModelId(model)) return badModel(c, model);
    // A client may send its own fallback list ("models"); OpenRouter would use those models
    // too, so they are checked against the route's models like the one asked for.
    let alsoModels: string[] = [];
    if ("models" in fields) {
      if (!Array.isArray(fields.models) || !fields.models.every(validModelId)) return invalid(c, '"models" must be a list of model ids.');
      alsoModels = fields.models;
    }
    const made = kind === "chat-modalities" ? chatKind(fields) : kind;
    return {
      ok: true,
      model,
      alsoModels,
      body: fallbacks ? withFallbacks(text, fields, model, allowedModels(route)) : bytes,
      contentType: "application/json",
      kind: made,
      streamed: fields.stream === true,
      prompt: made === "image" ? promptOf(kind === "chat-modalities" ? "chat" : "images", fields) : kind === "speech" ? promptOf("speech", fields) : null,
    };
  };
}

// A transcription comes as JSON (base64 audio) or as a form with a file, the way OpenAI
// clients send it. Either way it is sent on as it came; only "model" is read from it.
const transcription: Prepare = async (c, bytes, route) => {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) return json("transcription", false)(c, bytes, route);
  let models: unknown[];
  try {
    models = (await new Response(bytes, { headers: { "Content-Type": contentType } }).formData()).getAll("model");
  } catch {
    return invalid(c, "The request body is not a valid form.");
  }
  // One "model" only: with two, the gateway and OpenRouter could each read a different one.
  if (models.length > 1) return invalid(c, 'The form has more than one "model".');
  const model = models[0];
  if (typeof model !== "string" || !model) return invalid(c, noModel);
  if (!validModelId(model)) return badModel(c, model);
  return { ok: true, model, body: bytes, contentType, kind: "transcription", streamed: false };
};

// A client asks for one request's images or sound not to be kept with "X-BaseRouter-Save: no".
const saveRefused = (value: string | undefined) => /^(no|false|0|off)$/i.test(value?.trim() ?? "");

export function proxy(deps: Deps) {
  const { store } = deps;
  const keeper = new MediaKeeper(deps);
  const app = new Hono<Env>();

  app.use(async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const key = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
    const route = key ? store.routeByKeyHash(hashKey(key)) : null;
    if (!route) return refuse(c, 401, "unknown_key", "This key does not belong to a route. Use the key BaseRouter showed when the route was made.");
    c.set("route", route);
    await next();
  });

  // The provider's key was refused: that is the gateway's problem, not the client's,
  // so the client is not handed a 401 that would make it doubt its own key.
  function providerRefused(provider: ProviderRow, message: string) {
    store.markProvider(provider.id, "down", message, null, deps.now());
  }

  // Every request that is sent on goes through here: the budget, the body, the model,
  // the provider, and one row in the request log. "path" is OpenRouter's.
  async function forward(c: Context<Env>, path: string, prepare: Prepare): Promise<Response> {
    const started = deps.now();
    const route = c.get("route");

    const allowed = gate(route, store.spentSince(route.id, monthStart(new Date(started)).getTime()), new Date(started));
    if (!allowed.ok) return refuse(c, allowed.status, allowed.code, allowed.message, allowed.metadata);

    const bytes = await readBody(c.req.raw, deps.maxRequestBytes);
    if (!bytes) {
      return refuse(c, 413, "request_too_large", `The request is larger than ${mb(deps.maxRequestBytes)}, the most BaseRouter takes. Send smaller files, or raise BASEROUTER_MAX_REQUEST_MB.`, {
        max_bytes: deps.maxRequestBytes,
      });
    }
    const prepared = await prepare(c, bytes, route);
    if (!prepared.ok) return prepared.response;
    const { model, kind } = prepared;
    // Images and sound are kept when the gateway keeps any, the route keeps them, and the request
    // did not say no. Sound is kept from /audio/speech; the sound of a chat answer comes as
    // base64 PCM spread over the stream's events, without its format, so it is not.
    const keepMedia = keeper.on && route.keep_media === 1 && !saveRefused(c.req.header("x-baserouter-save"));
    const keepImages = keepMedia && kind === "image";
    const keepSound = keepMedia && path === "/audio/speech";

    const models = allowedModels(route);
    const notAllowed = models.length > 0 ? [model, ...(prepared.alsoModels ?? [])].find((m) => !models.includes(m)) : undefined;
    if (notAllowed !== undefined) {
      return refuse(c, 403, "model_not_allowed", `Route "${route.name}" may not use ${notAllowed}. It may use: ${models.join(", ")}.`);
    }

    const provider = store.providers()[0];
    if (!provider) return refuse(c, 503, "no_provider", "No provider is set up yet. Add one in BaseRouter.");
    const key = unseal(deps.master, provider.key_sealed);

    // An answer can take, or pause for, longer than Bun's idle timeout (10 seconds), which would cut it.
    c.env?.server?.timeout(c.req.raw, 0);

    // When the client goes away, the request to the provider is cancelled.
    const abort = new AbortController();
    const client = c.req.raw.signal;
    const clientGone = () => abort.abort();
    if (client.aborted) abort.abort();
    else client.addEventListener("abort", clientGone, { once: true });

    deps.running.set(route.id, (deps.running.get(route.id) ?? 0) + 1);

    // Writes the one row this request gets. Whatever path the request takes, it ends here once.
    let finished = false;
    const finish = (status: number | null, failure: Failure | null, reading?: Reading, firstTokenAt?: number | null, generationId?: string | null, images: Found[] = [], sound?: MediaFile | null) => {
      if (finished) return;
      finished = true;
      client.removeEventListener("abort", clientGone);
      const running = (deps.running.get(route.id) ?? 1) - 1;
      if (running > 0) deps.running.set(route.id, running);
      else deps.running.delete(route.id);

      const cost = reading?.usage?.cost ?? null;
      const upstreamId = reading?.id ?? generationId ?? null;
      const rowId = store.addRequest({
        route_id: route.id,
        provider_id: provider.id,
        started_at: started,
        kind,
        model_requested: model,
        model_served: reading?.model ?? null,
        streamed: prepared.streamed,
        prompt_tokens: reading?.usage?.promptTokens ?? null,
        completion_tokens: reading?.usage?.completionTokens ?? null,
        cost_usd: cost,
        cost_source: cost === null ? "unknown" : "provider",
        first_token_ms: firstTokenAt == null ? null : firstTokenAt - started,
        total_ms: deps.now() - started,
        status,
        failure,
        upstream_id: upstreamId,
      });
      // The provider started a response but it ended without a cost: ask for it afterwards.
      if (cost === null && upstreamId && status !== null && status < 300) later(deps, lookUpCost(rowId, upstreamId, key));
      const made = { requestId: rowId, routeId: route.id, model: reading?.model ?? model, prompt: prepared.prompt ?? null };
      const worked = failure === null && status !== null && status < 300;
      if (keepImages && worked && images.length > 0) later(deps, keeper.keepImages(made, images));
      if (sound) {
        if (worked) later(deps, sound.finish(made));
        else sound.drop();
      }
    };

    let upstream: Response;
    try {
      upstream = await openrouter.send(deps.upstream, key, path, prepared.body, prepared.contentType, abort.signal);
    } catch {
      if (client.aborted) {
        finish(null, "client_cancelled");
        return new Response(null, { status: 499 });
      }
      finish(null, "network_error");
      return refuse(c, 502, "provider_unreachable", `BaseRouter could not reach ${provider.name}. Check the provider in BaseRouter, then try again.`);
    }

    const generationId = upstream.headers.get("x-generation-id");

    if (upstream.status === 401) {
      const message = await openrouter.errorMessage(upstream);
      providerRefused(provider, message);
      finish(401, "upstream_error");
      return refuse(c, 502, "provider_refused_key", `${provider.name} did not accept the key BaseRouter holds for it. Replace the provider's key in BaseRouter.`);
    }

    // How the answer is read depends on what it is: server-sent events are scanned as they
    // pass, JSON is read whole, and anything else (the sound of /audio/speech) is passed on
    // without being looked at, its cost asked for once it has ended.
    const type = upstream.headers.get("content-type") ?? "";
    const mode = !upstream.ok || upstream.body === null || type.includes("json") ? "plain" : type.includes("text/event-stream") ? "events" : "bytes";

    if (mode === "plain") {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await upstream.arrayBuffer());
      } catch {
        finish(upstream.status, client.aborted ? "client_cancelled" : "network_error", undefined, null, generationId);
        return refuse(c, 502, "provider_unreachable", `The answer from ${provider.name} broke off. Try again.`);
      }
      let reading: Reading | undefined;
      let images: Found[] = [];
      try {
        const doc: unknown = JSON.parse(new TextDecoder().decode(bytes));
        reading = readPlain(doc);
        if (keepImages && upstream.ok) images = imagesIn(doc);
      } catch {}
      const failure: Failure | null = !upstream.ok || !reading || reading.failed ? "upstream_error" : null;
      finish(upstream.status, failure, reading, null, generationId, images);
      return new Response(bytes, { status: upstream.status, headers: passHeaders(upstream) });
    }

    // Every chunk goes to the client exactly as it arrived; events are scanned on the way past.
    const scanner = mode === "events" ? new StreamScanner(keepImages) : null;
    // The sound of /audio/speech is written to its file as it passes to the client. Raw PCM
    // is kept as WAV when its format is known, and not at all when it is not.
    const pcm = pcmFormat(type);
    const sound = mode === "bytes" && keepSound && (!isPcm(type) || pcm) ? keeper.start("audio", pcm) : null;
    let firstChunkAt: number | null = null;
    const reader = upstream.body!.getReader();
    const settle = (failure: Failure | null) => {
      scanner?.end(deps.now());
      const outcome = failure ?? (scanner?.failed ? "stream_error" : null);
      finish(upstream.status, outcome, scanner ?? undefined, scanner ? scanner.firstTokenAt : firstChunkAt, generationId, scanner?.images, sound);
    };
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            settle(null);
            controller.close();
            return;
          }
          const now = deps.now();
          firstChunkAt ??= now;
          scanner?.feed(value, now);
          sound?.write(value);
          controller.enqueue(value);
        } catch (err) {
          settle(client.aborted ? "client_cancelled" : "network_error");
          controller.error(err);
        }
      },
      cancel() {
        settle("client_cancelled");
        abort.abort();
      },
    });
    return new Response(stream, { status: upstream.status, headers: passHeaders(upstream) });
  }

  async function lookUpCost(rowId: number, generationId: string, key: string): Promise<void> {
    for (const delay of deps.costLookupDelays) {
      await Bun.sleep(delay);
      const found = await openrouter.generation(deps.upstream, key, generationId).catch(() => null);
      if (found) {
        store.fillRequest(rowId, found);
        return;
      }
    }
  }

  app.post("/chat/completions", (c) => forward(c, "/chat/completions", json("chat-modalities", true)));
  // OpenAI's name for it; OpenRouter's own is /images.
  app.post("/images/generations", (c) => forward(c, "/images", json("image", false)));
  app.post("/audio/speech", (c) => forward(c, "/audio/speech", json("speech", false)));
  app.post("/audio/transcriptions", (c) => forward(c, "/audio/transcriptions", transcription));

  app.get("/models", async (c) => {
    const route = c.get("route");
    const provider = store.providers()[0];
    if (!provider) return refuse(c, 503, "no_provider", "No provider is set up yet. Add one in BaseRouter.");

    let upstream: Response;
    try {
      upstream = await openrouter.models(deps.upstream, unseal(deps.master, provider.key_sealed), c.req.raw.signal);
    } catch {
      return refuse(c, 502, "provider_unreachable", `BaseRouter could not reach ${provider.name}. Check the provider in BaseRouter, then try again.`);
    }
    if (upstream.status === 401) {
      providerRefused(provider, await openrouter.errorMessage(upstream));
      return refuse(c, 502, "provider_refused_key", `${provider.name} did not accept the key BaseRouter holds for it. Replace the provider's key in BaseRouter.`);
    }
    const models = allowedModels(route);
    if (!upstream.ok || models.length === 0) return new Response(upstream.body, { status: upstream.status, headers: passHeaders(upstream) });

    // A route that is limited to some models only sees those.
    const list = (await upstream.json()) as { data?: { id?: string }[] };
    return c.json({ ...list, data: (list.data ?? []).filter((m) => typeof m.id === "string" && models.includes(m.id)) });
  });

  return app;
}
