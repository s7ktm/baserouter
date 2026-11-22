// The one address: /v1/chat/completions, /v1/images/generations, /v1/audio/speech,
// /v1/audio/transcriptions, /v1/videos and /v1/models, opened with a route's key.
import { Hono, type Context } from "hono";
import { gate, monthStart } from "./budget.ts";
import { later, refuse, type Deps, type Env } from "./deps.ts";
import { imagesIn, isPcm, MediaKeeper, pcmFormat, promptOf, type Found, type MediaFile } from "./media.ts";
import * as nanogpt from "./nanogpt.ts";
import * as openrouter from "./openrouter.ts";
import * as providers from "./providers.ts";
import { hashKey, unseal } from "./secrets.ts";
import type { Failure, Kind, ProviderRow, RouteRow, Store, VideoJobRow } from "./store.ts";
import { readPlain, StreamScanner, type Reading } from "./usage.ts";
import { forClient, fromNano, nanoForClient, providerOf, readJob, VideoWatcher, type JobStatus } from "./video.ts";
import { bodyFor, namesOf, resolve, type Place } from "./models.ts";

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
  | { ok: true; model: string; alsoModels?: string[]; body: Uint8Array | string; contentType: string; kind: Kind; streamed: boolean; prompt?: string | null;
      // The body as read, so it can be sent to another place of the model: a JSON object, or a form.
      fields?: Record<string, unknown>; form?: Form };

type Form = Awaited<ReturnType<Response["formData"]>>;
type Prepare = (c: Context<Env>, bytes: Uint8Array, route: RouteRow) => Promise<Prepared> | Prepared;

const invalid = (c: Context<Env>, message: string): Prepared => ({ ok: false, response: refuse(c, 400, "invalid_request", message) });
const noModel = 'The request does not say which model to use. Add "model".';

// What a model id may look like: OpenRouter's are "author/name", sometimes with ":variant"
// or a leading "~". Anything else (markup, spaces, control characters) is refused, so a
// model id is always safe to show and to record.
export const validModelId = (id: unknown): id is string => typeof id === "string" && /^[\w~][\w.:/@+~-]{0,199}$/.test(id);
const badModel = (c: Context<Env>, id: string) => invalid(c, `"${id.slice(0, 60).replace(/[^\w.:/@+~ -]/g, "?")}" is not a model id.`);

// A JSON body with a "model".
function json(kind: Kind | "chat-modalities"): Prepare {
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
      fields,
      body: bytes,
      contentType: "application/json",
      kind: made,
      streamed: fields.stream === true,
      prompt:
        made === "image" ? promptOf(kind === "chat-modalities" ? "chat" : "images", fields)
        : kind === "speech" ? promptOf("speech", fields)
        : kind === "video" ? promptOf("images", fields)
        : null,
    };
  };
}

// A transcription comes as JSON (base64 audio) or as a form with a file, the way OpenAI
// clients send it. Either way it is sent on as it came; only "model" is read from it.
const transcription: Prepare = async (c, bytes, route) => {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) return json("transcription")(c, bytes, route);
  let form: Form;
  try {
    form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    return invalid(c, "The request body is not a valid form.");
  }
  const models = form.getAll("model");
  // One "model" only: with two, the gateway and OpenRouter could each read a different one.
  if (models.length > 1) return invalid(c, 'The form has more than one "model".');
  const model = models[0];
  if (typeof model !== "string" || !model) return invalid(c, noModel);
  if (!validModelId(model)) return badModel(c, model);
  return { ok: true, model, body: bytes, contentType, kind: "transcription", streamed: false, form };
};

// The one address as the client reached it, for the links in a video job's answer. Behind
// Caddy the gateway itself is reached over plain HTTP; the client used HTTPS.
function clientBase(c: Context<Env>): string {
  const url = new URL(c.req.url);
  const https = url.protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
  return `${https ? "https" : "http"}://${url.host}/v1`;
}

const notAJob = (c: Context<Env>) => refuse(c, 404, "not_found", "This route has no video job with that id.");

// A video job, sent on as written. A job may continue an earlier one ("previous_job_id");
// that must be a job of the same route, or one route could build on another's video. A
// "callback_url" is refused: OpenRouter would send it the job's end, signed links included,
// around the gateway.
function video(store: Store): Prepare {
  const asJson = json("video");
  return async (c, bytes, route) => {
    const prepared = await asJson(c, bytes, route);
    if (!prepared.ok) return prepared;
    const fields = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if ("callback_url" in fields) return invalid(c, 'BaseRouter does not pass on "callback_url". Ask GET /v1/videos/{id} until the job is done.');
    const previous = fields.previous_job_id;
    if (previous !== undefined && (typeof previous !== "string" || store.videoJob(previous)?.route_id !== route.id)) {
      return { ok: false, response: notAJob(c) };
    }
    return prepared;
  };
}

// One place to send a request to: its provider, the key BaseRouter holds for it, and the body
// with that place's model id.
type Attempt = { provider: ProviderRow; key: string; model: string; body: Uint8Array | string; contentType: string };

async function bodyAt(prepared: Extract<Prepared, { ok: true }>, place: Place, provider: ProviderRow): Promise<{ body: Uint8Array | string; contentType: string }> {
  // NanoGPT starts a video with fields of its own.
  if (prepared.fields && prepared.kind === "video" && providers.isNano(provider)) return { body: nanogpt.videoBody(prepared.fields, place.model), contentType: prepared.contentType };
  if (prepared.fields) return { body: bodyFor(prepared.fields, place, prepared.model) ?? prepared.body, contentType: prepared.contentType };
  if (prepared.form && place.model !== prepared.model) {
    const form = new FormData();
    prepared.form.forEach((value, name) => form.append(name, name === "model" ? place.model : (value as string | Blob)));
    // The boundary is taken from the encoded body itself: the content type Bun gives for an
    // encoded form can name a different one.
    const body = new Uint8Array(await new Request("http://form.invalid/", { method: "POST", body: form }).arrayBuffer());
    const boundary = /^--([^\r\n]+)\r\n/.exec(new TextDecoder().decode(body.subarray(0, 200)))?.[1];
    if (boundary) return { body, contentType: `multipart/form-data; boundary=${boundary}` };
  }
  return { body: prepared.body, contentType: prepared.contentType };
}

// A client asks for one request's images or sound not to be kept with "X-BaseRouter-Save: no".
const saveRefused = (value: string | undefined) => /^(no|false|0|off)$/i.test(value?.trim() ?? "");

export function proxy(deps: Deps) {
  const { store } = deps;
  const keeper = new MediaKeeper(deps);
  const videos = new VideoWatcher(deps, keeper);
  videos.resume();
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
    const keepVideo = keepMedia && kind === "video";
    const keepSound = keepMedia && path === "/audio/speech";

    // The model asked for, and the places it comes from: tried in order, the next when one is
    // refused (see "Models" in models.ts). A client's own fallback list ("models") is checked
    // like the model, and passed on only when the model is sent exactly as asked.
    const names = namesOf(route);
    const notAllowed = [model, ...(prepared.alsoModels ?? [])].find((m) => !resolve(store, route, m).ok);
    if (notAllowed !== undefined) {
      return refuse(c, 403, "model_not_allowed", `Route "${route.name}" may not use ${notAllowed}. It may use: ${names.join(", ")}.`);
    }
    const resolved = resolve(store, route, model);
    const held = store.providers();
    const attempts: Attempt[] = [];
    for (const place of resolved.ok ? resolved.places : []) {
      const at = held.find((p) => p.id === place.provider);
      if (at) attempts.push({ provider: at, key: unseal(deps.master, at.key_sealed), model: place.model, ...(await bodyAt(prepared, place, at)) });
    }
    if (!attempts.length) return refuse(c, 503, "no_provider", "No provider is set up yet. Add one in BaseRouter.");
    if (prepared.alsoModels?.length && (attempts.length > 1 || attempts[0]!.body !== prepared.body)) {
      return refuse(c, 400, "invalid_request", `In BaseRouter, what takes over when ${model} fails is set on the model. Leave out "models".`);
    }
    let { provider, key } = attempts[0]!;

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
    const finish = (status: number | null, failure: Failure | null, reading?: Reading, firstTokenAt?: number | null, generationId?: string | null, images: Found[] = [], sound?: MediaFile | null): number | null => {
      if (finished) return null;
      finished = true;
      client.removeEventListener("abort", clientGone);
      const running = (deps.running.get(route.id) ?? 1) - 1;
      if (running > 0) deps.running.set(route.id, running);
      else deps.running.delete(route.id);

      const cost = reading?.usage?.cost ?? null;
      const nano = providers.isNano(provider);
      // The id to ask the provider about this request with: OpenRouter's is the answer's own,
      // NanoGPT's is in the answer's headers, or named in its pricing after a fallback there.
      const upstreamId = (nano ? reading?.requestId : reading?.id) ?? generationId ?? null;
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
      const made = { requestId: rowId, routeId: route.id, model: reading?.model ?? model, prompt: prepared.prompt ?? null };
      const worked = failure === null && status !== null && status < 300;
      // The provider started a response but it ended without a cost: ask for it afterwards.
      // (A video job's cost comes with the job, from the watch in video.ts.) NanoGPT's image
      // answers can name less than was charged, so those are asked about as well.
      if (upstreamId && status !== null && status < 300 && kind !== "video") {
        if (cost === null) later(deps, lookUpCost(rowId, upstreamId, provider, key));
        else if (nano && kind === "image" && worked) later(deps, lookUpCost(rowId, upstreamId, provider, key, true));
      }
      // NanoGPT's speech answers say nothing of their cost and carry no id to ask with: it is
      // worked out from the characters sent and the model's listed price, and recorded as that.
      if (nano && path === "/audio/speech" && worked && cost === null) {
        const sent = attempts.find((a) => a.provider.id === provider.id)?.model ?? model;
        later(deps, nanogpt.speechCost(deps.nanogpt, key, sent, prepared.fields?.input).then((worth) => {
          if (worth !== null) store.fillRequest(rowId, { cost: worth, promptTokens: null, completionTokens: null, model: null }, { source: "computed" });
        }));
      }
      if (keepImages && worked && images.length > 0) later(deps, keeper.keepImages(made, images));
      if (sound) {
        if (worked) later(deps, sound.finish(made));
        else sound.drop();
      }
      return rowId;
    };

    // A route's lines: when an answer is refused (an outage, a rate limit, no such provider for
    // the model), the next line is tried, before anything reaches the client. Not when the
    // provider refused BaseRouter's key or its credit, which no other line would change.
    let upstream: Response;
    try {
      for (let i = 0; ; i++) {
        ({ provider, key } = attempts[i]!);
        upstream = await providers.send(deps, provider, key, path, attempts[i]!.body, attempts[i]!.contentType, abort.signal);
        if (upstream.ok || i === attempts.length - 1 || providers.keyRefused(provider, upstream) || upstream.status === 402 || client.aborted) break;
        await upstream.body?.cancel().catch(() => {});
      }
    } catch {
      if (client.aborted) {
        finish(null, "client_cancelled");
        return new Response(null, { status: 499 });
      }
      finish(null, "network_error");
      return refuse(c, 502, "provider_unreachable", `BaseRouter could not reach ${provider.name}. Check the provider in BaseRouter, then try again.`);
    }

    const generationId = providers.costId(provider, upstream);

    if (providers.keyRefused(provider, upstream)) {
      const message = await openrouter.errorMessage(upstream);
      providerRefused(provider, message);
      finish(upstream.status, "upstream_error");
      return keyNotAccepted(c, provider);
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
        // What a NanoGPT answer says about the account stays here.
        const cleaned = providers.isNano(provider) ? nanogpt.withoutAccount(doc) : null;
        if (cleaned) bytes = new TextEncoder().encode(JSON.stringify(cleaned));
      } catch {}
      const failure: Failure | null = !upstream.ok || !reading || reading.failed ? "upstream_error" : null;
      const rowId = finish(upstream.status, failure, reading, null, generationId, images);
      if (kind === "video" && failure === null && rowId !== null) {
        const answer = startedVideo(c, bytes, rowId, route, model, prepared.prompt ?? null, keepVideo, provider);
        if (answer) return answer;
      }
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

  // A video job has started: it is remembered as the route's, watched until it ends, and its
  // answer goes back with links to the gateway. Null when the answer is not a job after all.
  function startedVideo(c: Context<Env>, bytes: Uint8Array, rowId: number, route: RouteRow, model: string, prompt: string | null, keep: boolean, provider: ProviderRow): Response | null {
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    } catch {
      return null;
    }
    const nano = providers.isNano(provider);
    const started = nano ? nanogpt.readVideo(doc) : null;
    const status: JobStatus | null = nano ? started && fromNano(started) : readJob(doc);
    if (!status) return null;
    const job = { id: status.id, provider_id: provider.id, request_id: rowId, route_id: route.id, model, prompt, keep: keep ? 1 : 0, status: status.status, created_at: deps.now(), done_at: null };
    store.addVideoJob(job);
    // A job may already have ended in its first answer (a refusal after 202, say).
    later(deps, videos.observe(job, status).then((ended) => ended || videos.watch(job.id)));
    return c.json(nano ? nanoForClient(status, clientBase(c), null) : forClient(doc, clientBase(c)), 202);
  }

  const unreachable = (c: Context<Env>, provider: ProviderRow) =>
    refuse(c, 502, "provider_unreachable", `BaseRouter could not reach ${provider.name}. Check the provider in BaseRouter, then try again.`);
  const keyNotAccepted = (c: Context<Env>, provider: ProviderRow) =>
    refuse(c, 502, "provider_refused_key", `${provider.name} did not accept the key BaseRouter holds for it. Replace the provider's key in BaseRouter.`);

  // A GET to OpenRouter for a request that is not recorded: a video job's status or video, the
  // model lists. Either OpenRouter's answer, or the gateway's refusal when it cannot be had.
  async function ask(c: Context<Env>, path: string, provider: ProviderRow | null = store.providers()[0] ?? null): Promise<Response> {
    if (!provider) return refuse(c, 503, "no_provider", "No provider is set up yet. Add one in BaseRouter.");
    let upstream: Response;
    try {
      upstream = await openrouter.get(deps.upstream, unseal(deps.master, provider.key_sealed), path, c.req.raw.signal);
    } catch {
      return unreachable(c, provider);
    }
    if (upstream.status === 401) {
      providerRefused(provider, await openrouter.errorMessage(upstream));
      return keyNotAccepted(c, provider);
    }
    return upstream;
  }

  // What a provider's model list says about each of its models, by the provider's id for it,
  // as entries of /v1/models. NanoGPT's are brought to the shape OpenRouter's have. Empty when
  // the list cannot be had.
  async function listedAt(provider: ProviderRow): Promise<Map<string, Record<string, unknown>>> {
    const key = unseal(deps.master, provider.key_sealed);
    try {
      if (providers.isNano(provider)) return new Map(((await nanogpt.offers(deps.nanogpt, key)) ?? []).map((m) => [m.id, nanogpt.listed(m)]));
      const res = await openrouter.models(deps.upstream, key, AbortSignal.timeout(15_000));
      const data = res.ok ? ((await res.json()) as { data?: Record<string, unknown>[] }).data : (await res.body?.cancel(), null);
      return new Map((data ?? []).filter((m) => openrouter.usable(m.id)).map((m) => [m.id as string, m]));
    } catch {
      return new Map();
    }
  }

  // Whether an entry makes one of the things a client asked for with ?output_modalities=.
  // OpenRouter filters its own list; the entries the gateway adds from NanoGPT are filtered here.
  function makesAsked(entry: Record<string, unknown>, asked: string | null): boolean {
    if (!asked || asked === "all") return true;
    const made = (entry.architecture as { output_modalities?: unknown } | undefined)?.output_modalities;
    const wanted = asked.split(",").map((k) => (k === "speech" ? "audio" : k));
    return Array.isArray(made) && made.some((k) => wanted.includes(k));
  }

  // The models a route may use, in OpenAI's shape, by the names apps send. Each carries what
  // its provider says about the model at its first place. A route that may use any model also
  // sees the first provider's own list after BaseRouter's models.
  async function modelList(c: Context<Env>): Promise<Response> {
    const asked = new URL(c.req.url).searchParams;
    const all = store.providers();
    const first = all[0];
    if (!first) return refuse(c, 503, "no_provider", "No provider is set up yet. Add one in BaseRouter.");
    const lists = new Map<string, Promise<Map<string, Record<string, unknown>>>>();
    let envelope: Record<string, unknown> = { object: "list" };
    if (providers.isNano(first)) {
      const offered = await nanogpt.offers(deps.nanogpt, unseal(deps.master, first.key_sealed)).catch(() => null);
      if (!offered) return unreachable(c, first);
      lists.set(first.id, Promise.resolve(new Map(offered.map((m) => [m.id, nanogpt.listed(m)]))));
    } else {
      // The first provider is asked with the client's own filters, and its refusal is the answer.
      const upstream = await ask(c, openrouter.modelsPath(asked), first);
      if (!upstream.ok) return new Response(upstream.body, { status: upstream.status, headers: passHeaders(upstream) });
      const list = (await upstream.json()) as { data?: Record<string, unknown>[] };
      envelope = list;
      lists.set(first.id, Promise.resolve(new Map((list.data ?? []).filter((m) => openrouter.usable(m.id)).map((m) => [m.id as string, m]))));
    }
    const listOf = (id: string) => {
      const at = all.find((p) => p.id === id);
      if (!lists.has(id)) lists.set(id, at ? listedAt(at) : Promise.resolve(new Map()));
      return lists.get(id)!;
    };
    const wanted = asked.get("output_modalities");
    const names = namesOf(c.get("route"));
    const data: Record<string, unknown>[] = [];
    for (const name of names.length ? names : store.models().map((m) => m.name)) {
      const place = store.modelByName(name)?.places[0];
      const at = place?.provider ?? first.id;
      const info = (await listOf(at)).get(place?.model ?? name);
      // What OpenRouter left out was filtered by OpenRouter; the rest is filtered here.
      if (info && (at === first.id && !providers.isNano(first) ? true : makesAsked(info, wanted))) data.push({ ...info, id: name });
    }
    if (!names.length) {
      const shown = new Set(data.map((m) => m.id));
      for (const [id, info] of await listOf(first.id)) if (!shown.has(id) && (providers.isNano(first) ? makesAsked(info, wanted) : true)) data.push(info);
    }
    return c.json({ ...envelope, data });
  }

  // The video models a route may use, as their providers list them: the models at its models' places.
  async function videoModelList(c: Context<Env>): Promise<Response> {
    const route = c.get("route");
    const all = store.providers();
    if (!all.length) return refuse(c, 503, "no_provider", "No provider is set up yet. Add one in BaseRouter.");
    const allowed = namesOf(route).length
      ? new Set(namesOf(route).flatMap((name) => { const r = resolve(store, route, name); return r.ok ? r.places.map((p) => `${p.provider} ${p.model}`) : []; }))
      : null;
    const data: Record<string, unknown>[] = [];
    let envelope: Record<string, unknown> = { object: "list" };
    for (const provider of all) {
      // A route that may use any model sees the first provider's list, as it may use its models.
      if (!allowed && provider !== all[0]) continue;
      let entries: Record<string, unknown>[];
      if (providers.isNano(provider)) {
        const offered = await nanogpt.offers(deps.nanogpt, unseal(deps.master, provider.key_sealed)).catch(() => null);
        entries = (offered ?? []).filter((m) => m.makes.includes("video")).map((m) => ({ ...nanogpt.listed(m), ...(m.perSecond === null ? {} : { pricing: { per_second: m.perSecond } }) }));
      } else {
        const upstream = await ask(c, "/videos/models", provider);
        if (!upstream.ok) {
          if (provider === all[0]) return new Response(upstream.body, { status: upstream.status, headers: passHeaders(upstream) });
          await upstream.body?.cancel();
          continue;
        }
        const list = (await upstream.json()) as { data?: Record<string, unknown>[] };
        if (provider === all[0]) envelope = list;
        entries = list.data ?? [];
      }
      for (const m of entries) if (typeof m.id === "string" && (!allowed || allowed.has(`${provider.id} ${m.id}`))) data.push(m);
    }
    return c.json({ ...envelope, data });
  }

  // Asks the provider what a request cost, a few times. NanoGPT asks to wait half a minute
  // after it says it does not know yet, so its later questions come further apart.
  // "replace": the cost is recorded even when one already is.
  async function lookUpCost(rowId: number, id: string, provider: ProviderRow, key: string, replace = false): Promise<void> {
    const delays = providers.isNano(provider) ? deps.costLookupDelays.map((delay, i) => (i === 0 ? delay : delay * 6)) : deps.costLookupDelays;
    for (const delay of delays) {
      await Bun.sleep(delay);
      const found = await providers.lookUp(deps, provider, key, id).catch(() => null);
      if (found) {
        store.fillRequest(rowId, found, { replace });
        return;
      }
    }
  }

  // What NanoGPT says about a job right now, taken in the way the gateway's own watch takes it.
  // A refusal as a response when it cannot be had.
  async function nanoJob(c: Context<Env>, job: VideoJobRow, provider: ProviderRow): Promise<JobStatus | Response> {
    try {
      const status = await nanogpt.videoStatus(deps.nanogpt, unseal(deps.master, provider.key_sealed), job.id, c.req.raw.signal);
      if (!status) return unreachable(c, provider);
      const read = fromNano(status);
      later(deps, videos.observe(job, read));
      return read;
    } catch {
      return unreachable(c, provider);
    }
  }

  app.post("/chat/completions", (c) => forward(c, "/chat/completions", json("chat-modalities")));
  // OpenAI's name for it; OpenRouter's own is /images.
  app.post("/images/generations", (c) => forward(c, "/images", json("image")));
  app.post("/audio/speech", (c) => forward(c, "/audio/speech", json("speech")));
  app.post("/audio/transcriptions", (c) => forward(c, "/audio/transcriptions", transcription));

  app.get("/models", (c) => modelList(c));

  // Video: a job is started, asked about until it is done, and its video fetched. Only the
  // route that started a job can ask about it or fetch its video. Asking is free and is not
  // recorded; the job's one row is the request that started it.
  app.post("/videos", (c) => forward(c, "/videos", video(store)));
  app.get("/videos/models", (c) => videoModelList(c));

  app.get("/videos/:id", async (c) => {
    const job = store.videoJob(c.req.param("id"));
    if (!job || job.route_id !== c.get("route").id) return notAJob(c);
    const provider = providerOf(deps, job);
    if (provider && providers.isNano(provider)) {
      const status = await nanoJob(c, job, provider);
      if (status instanceof Response) return status;
      return c.json(nanoForClient(status, clientBase(c), job.request_id === null ? null : (store.request(job.request_id)?.cost_usd ?? null)));
    }
    const upstream = await ask(c, `/videos/${encodeURIComponent(job.id)}`, provider);
    if (!upstream.ok || !(upstream.headers.get("content-type") ?? "").includes("json")) {
      return new Response(upstream.body, { status: upstream.status, headers: passHeaders(upstream) });
    }
    const doc = (await upstream.json()) as Record<string, unknown>;
    const status = readJob(doc);
    if (status && status.id === job.id) later(deps, videos.observe(job, status));
    return c.json(forClient(doc, clientBase(c)), upstream.status as 200);
  });

  app.get("/videos/:id/content", async (c) => {
    const job = store.videoJob(c.req.param("id"));
    if (!job || job.route_id !== c.get("route").id) return notAJob(c);
    const index = c.req.query("index") ?? "0";
    if (!/^\d{1,3}$/.test(index)) return refuse(c, 400, "invalid_request", '"index" must be a number: 0 for the first video.');
    c.env?.server?.timeout(c.req.raw, 0);
    const provider = providerOf(deps, job);
    let upstream: Response;
    if (provider && providers.isNano(provider)) {
      // NanoGPT says where a video is in the job's answer, so the job is asked about first.
      const status = await nanoJob(c, job, provider);
      if (status instanceof Response) return status;
      const link = status.links?.[Number(index)];
      if (!link) return refuse(c, 404, "not_found", "This job has no video with that index (yet).");
      try {
        upstream = await nanogpt.videoContent(deps.nanogpt, unseal(deps.master, provider.key_sealed), link, c.req.raw.signal);
      } catch {
        return unreachable(c, provider);
      }
    } else {
      upstream = await ask(c, `/videos/${encodeURIComponent(job.id)}/content?index=${Number(index)}`, provider);
    }
    const headers = passHeaders(upstream);
    const length = upstream.headers.get("content-length");
    if (upstream.ok && length) headers.set("content-length", length);
    return new Response(upstream.body, { status: upstream.status, headers });
  });

  return app;
}
