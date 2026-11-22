// The one address: /v1/chat/completions and /v1/models, opened with a route's key.
import { Hono } from "hono";
import { gate, monthStart } from "./budget.ts";
import { later, refuse, type Deps, type Env } from "./deps.ts";
import * as openrouter from "./openrouter.ts";
import { hashKey, unseal } from "./secrets.ts";
import type { Failure, ProviderRow, RouteRow } from "./store.ts";
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

export function proxy(deps: Deps) {
  const { store } = deps;
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

  app.post("/chat/completions", async (c) => {
    const started = deps.now();
    const route = c.get("route");

    const allowed = gate(route, store.spentSince(route.id, monthStart(new Date(started)).getTime()), new Date(started));
    if (!allowed.ok) return refuse(c, allowed.status, allowed.code, allowed.message, allowed.metadata);

    const text = await c.req.text();
    let body: { model?: unknown; stream?: unknown } | null;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(c, 400, "invalid_request", "The request body is not valid JSON.");
    }
    const model = body && typeof body === "object" && typeof body.model === "string" ? body.model : "";
    if (!model) return refuse(c, 400, "invalid_request", 'The request does not say which model to use. Add "model".');

    const models = allowedModels(route);
    if (models.length > 0 && !models.includes(model)) {
      return refuse(c, 403, "model_not_allowed", `Route "${route.name}" may not use ${model}. It may use: ${models.join(", ")}.`);
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
    const finish = (status: number | null, failure: Failure | null, reading?: Reading, firstTokenAt?: number | null, generationId?: string | null) => {
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
        model_requested: model,
        model_served: reading?.model ?? null,
        streamed: body?.stream === true,
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
    };

    let upstream: Response;
    try {
      upstream = await openrouter.chat(deps.upstream, key, text, abort.signal);
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

    const streaming = upstream.ok && upstream.body !== null && (upstream.headers.get("content-type") ?? "").includes("text/event-stream");

    if (!streaming) {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await upstream.arrayBuffer());
      } catch {
        finish(upstream.status, client.aborted ? "client_cancelled" : "network_error", undefined, null, generationId);
        return refuse(c, 502, "provider_unreachable", `The answer from ${provider.name} broke off. Try again.`);
      }
      let reading: Reading | undefined;
      try {
        reading = readPlain(JSON.parse(new TextDecoder().decode(bytes)));
      } catch {}
      const failure: Failure | null = !upstream.ok || !reading || reading.failed ? "upstream_error" : null;
      finish(upstream.status, failure, reading, null, generationId);
      return new Response(bytes, { status: upstream.status, headers: passHeaders(upstream) });
    }

    // Streaming: every chunk goes to the client exactly as it arrived, and the scanner
    // looks at the same bytes on the way past.
    const scanner = new StreamScanner();
    const reader = upstream.body!.getReader();
    const settle = (failure: Failure | null) => {
      scanner.end(deps.now());
      const outcome = failure ?? (scanner.failed ? "stream_error" : null);
      finish(upstream.status, outcome, scanner, scanner.firstTokenAt, generationId);
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
          scanner.feed(value, deps.now());
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
  });

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
