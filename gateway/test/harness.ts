// A whole gateway for a test: an in-memory database, a real HTTP server on a free
// port, and the fake OpenRouter behind it.
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.ts";
import type { Deps } from "../src/deps.ts";
import type { Upstream } from "../src/openrouter.ts";
import { hashKey, keyHint, newRouteKey, seal } from "../src/secrets.ts";
import { openDb, Store, type RouteRow } from "../src/store.ts";
import { FAKE_KEY, startFake } from "./fake-openrouter.ts";

export async function until(condition: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Waited too long");
    await Bun.sleep(5);
  }
}

export function startGateway(options: { upstream?: Upstream; fetch?: typeof fetch; providerKey?: string | null } = {}) {
  const fake = startFake();
  const store = new Store(openDb(":memory:"));
  const clock = { now: null as number | null }; // set it to freeze time
  const deps: Deps = {
    store,
    master: randomBytes(32),
    upstream: options.upstream ?? { baseUrl: fake.url, fetch: options.fetch ?? fetch },
    now: () => clock.now ?? Date.now(),
    costLookupDelays: [0],
    running: new Map(),
    background: new Set(),
  };
  const app = createApp(deps);
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request, server) => app.fetch(request, { server }) });
  const url = `http://127.0.0.1:${server.port}`;

  const providerKey = options.providerKey === undefined ? FAKE_KEY : options.providerKey;
  if (providerKey !== null) {
    store.addProvider({
      id: "openrouter", kind: "openrouter", name: "OpenRouter", key_sealed: seal(deps.master, providerKey), key_hint: keyHint(providerKey),
      status: "up", error: null, models: 3, checked_at: 0, created_at: 0,
    });
  }

  let made = 0;
  function addRoute(over: Partial<RouteRow> & { models?: never; allow?: string[] } = {}) {
    const key = newRouteKey();
    const { allow = [], ...rest } = over;
    const row: RouteRow = {
      id: `route${++made}`, name: "Home assistant", key_hash: hashKey(key), key_hint: keyHint(key), budget_usd: 10, enabled: 1,
      models: JSON.stringify(allow), created_at: made, ...rest,
    };
    store.addRoute(row);
    return { id: row.id, key };
  }

  // Adds a finished request straight to the database, to set up spend.
  function spend(routeId: string, cost: number | null, at = deps.now()) {
    store.addRequest({
      route_id: routeId, provider_id: null, started_at: at, model_requested: "openai/gpt-5-mini", model_served: "openai/gpt-5-mini", streamed: false,
      prompt_tokens: 1, completion_tokens: 1, cost_usd: cost, cost_source: cost === null ? "unknown" : "provider", first_token_ms: null, total_ms: 1,
      status: 200, failure: null, upstream_id: null,
    });
  }

  function chat(key: string | null, body: unknown, init: RequestInit = {}) {
    return fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    });
  }

  return {
    url, fake, store, deps, clock, addRoute, spend, chat,
    lastRequest: () => store.requests({ limit: 1 })[0] ?? null,
    settled: async () => void (await Promise.all([...deps.background])),
    async stop() {
      await Promise.all([...deps.background]);
      await server.stop(true);
      await fake.stop();
      store.db.close();
    },
  };
}

export type Gateway = ReturnType<typeof startGateway>;
