// The proxy end to end, over real HTTP, against the fake OpenRouter.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { seal } from "../src/secrets.ts";
import { FAKE_KEY, fixture, fixtureBytes } from "./fake-openrouter.ts";
import { startGateway, until, type Gateway } from "./harness.ts";

let gw: Gateway;
beforeEach(() => void (gw = startGateway()));
afterEach(() => gw.stop());

const hello = (model = "openai/gpt-5-mini", extra: object = {}) => ({ model, messages: [{ role: "user", content: "Hello" }], ...extra });
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string; metadata?: Record<string, unknown> } }).error;

test("a plain completion comes back unchanged and is recorded with its cost", async () => {
  const route = gw.addRoute();
  const sent = JSON.stringify(hello());
  const res = await gw.chat(route.key, sent);

  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(await fixtureBytes("chat.json"));

  // The provider saw its own key and the body as the client wrote it; never the route key.
  expect(gw.fake.chats).toEqual([{ key: FAKE_KEY, body: sent }]);

  expect(gw.lastRequest()).toMatchObject({
    route_id: route.id,
    provider_id: "openrouter",
    model_requested: "openai/gpt-5-mini",
    model_served: "openai/gpt-5-mini",
    streamed: 0,
    prompt_tokens: 8,
    completion_tokens: 9,
    cost_usd: 0.0000205,
    cost_source: "provider",
    first_token_ms: null,
    status: 200,
    failure: null,
    upstream_id: "gen-1795300001-FixturePlain00000001",
  });
});

test("a stream is passed through byte for byte, keep-alive lines included, and records its cost", async () => {
  const route = gw.addRoute();
  const res = await gw.chat(route.key, hello("openai/gpt-5-mini", { stream: true }));

  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const received = new Uint8Array(await res.arrayBuffer());
  const original = await fixtureBytes("chat-stream.sse");
  expect(received).toEqual(original);
  expect(new TextDecoder().decode(received).match(/^: OPENROUTER PROCESSING$/gm)).toHaveLength(2);

  await until(() => gw.lastRequest() !== null);
  const row = gw.lastRequest()!;
  expect(row).toMatchObject({
    streamed: 1,
    model_served: "openai/gpt-5-mini",
    prompt_tokens: 8,
    completion_tokens: 6,
    cost_usd: 0.0000143,
    cost_source: "provider",
    status: 200,
    failure: null,
  });
  expect(row.first_token_ms).toBeGreaterThanOrEqual(0);
  expect(row.total_ms).toBeGreaterThanOrEqual(row.first_token_ms!);
  expect(gw.fake.lookups).toEqual([]); // the cost was in the stream; nothing to look up
});

test("chunks reach the client while the stream is still running", async () => {
  const route = gw.addRoute();
  const res = await gw.chat(route.key, hello("fixture/hang", { stream: true }));
  const reader = res.body!.getReader();
  const first = await reader.read(); // would never arrive if the gateway waited for the end
  expect(new TextDecoder().decode(first.value)).toContain("data: ");
  await reader.cancel();
});

test("a request without a key, or with a key that is not a route's, is refused", async () => {
  gw.addRoute();
  for (const key of [null, "br_" + "0".repeat(48), FAKE_KEY]) {
    const res = await gw.chat(key, hello());
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("unknown_key");
  }
  expect(gw.fake.chats).toHaveLength(0);
});

test("a switched-off route is refused before anything is sent to the provider", async () => {
  const route = gw.addRoute({ enabled: 0 });
  const res = await gw.chat(route.key, hello());
  expect(res.status).toBe(403);
  expect((await errorOf(res)).code).toBe("route_off");
  expect(gw.fake.chats).toHaveLength(0);
  expect(gw.lastRequest()).toBeNull();
});

test("a route over its budget is refused before anything is sent to the provider", async () => {
  gw.clock.now = new Date(2026, 10, 22, 12).getTime();
  const route = gw.addRoute({ budget_usd: 3 });
  gw.spend(route.id, 1.75);
  gw.spend(route.id, 1.25);

  const res = await gw.chat(route.key, hello());
  expect(res.status).toBe(402);
  const error = await errorOf(res);
  expect(error.code).toBe("budget_used_up");
  expect(error.message).toBe(
    'Route "Home assistant" has used up its monthly budget: $3.00 of $3. It starts again on 2026-12-01. Raise the budget in BaseRouter to continue sooner.',
  );
  expect(error.metadata).toEqual({ spent_usd: 3, budget_usd: 3, resets_on: "2026-12-01" });
  expect(gw.fake.chats).toHaveLength(0);

  // Streaming is refused the same way, as JSON.
  expect((await gw.chat(route.key, hello("openai/gpt-5-mini", { stream: true }))).status).toBe(402);

  // Raising the budget is the way out.
  gw.store.updateRoute(route.id, { budget_usd: 5 });
  expect((await gw.chat(route.key, hello())).status).toBe(200);
  expect(gw.fake.chats).toHaveLength(1);
});

test("last month's spend does not count: the budget starts again on the first", async () => {
  gw.clock.now = new Date(2026, 11, 1, 0, 0, 5).getTime(); // five seconds into December
  const route = gw.addRoute({ budget_usd: 3 });
  gw.spend(route.id, 3, new Date(2026, 10, 30, 23, 59, 59).getTime());
  expect((await gw.chat(route.key, hello())).status).toBe(200);
});

test("another route's spend does not count", async () => {
  const full = gw.addRoute({ budget_usd: 1 });
  const other = gw.addRoute({ budget_usd: 1 });
  gw.spend(full.id, 1);
  expect((await gw.chat(full.key, hello())).status).toBe(402);
  expect((await gw.chat(other.key, hello())).status).toBe(200);
});

test("a route limited to some models may not use another", async () => {
  const route = gw.addRoute({ allow: ["openai/gpt-5-mini"] });
  const res = await gw.chat(route.key, hello("anthropic/claude-sonnet-5.5"));
  expect(res.status).toBe(403);
  expect((await errorOf(res)).code).toBe("model_not_allowed");
  expect(gw.fake.chats).toHaveLength(0);
  expect((await gw.chat(route.key, hello("openai/gpt-5-mini"))).status).toBe(200);
});

test("a body that is not JSON, or names no model, is refused", async () => {
  const route = gw.addRoute();
  for (const body of ["{not json", JSON.stringify({ messages: [] }), "null"]) {
    const res = await gw.chat(route.key, body);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("invalid_request");
  }
  expect(gw.fake.chats).toHaveLength(0);
});

test("a stream that fails half way still arrives whole, and counts as a failed request", async () => {
  const route = gw.addRoute();
  const res = await gw.chat(route.key, hello("fixture/stream-error", { stream: true }));
  expect(res.status).toBe(200);
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(await fixtureBytes("chat-stream-error.sse"));
  await until(() => gw.lastRequest() !== null);
  expect(gw.lastRequest()).toMatchObject({ status: 200, failure: "stream_error", streamed: 1 });
});

test("a plain request that fails after HTTP 200 counts as a failed request", async () => {
  const route = gw.addRoute();
  const res = await gw.chat(route.key, hello("fixture/error-200"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(await fixture("chat-error-200.json").json());
  expect(gw.lastRequest()).toMatchObject({ status: 200, failure: "upstream_error" });
});

test("the provider's own refusal is passed on as it is, and recorded", async () => {
  const route = gw.addRoute();
  const res = await gw.chat(route.key, hello("fixture/429"));
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("3");
  expect(await res.json()).toEqual(await fixture("error-429.json").json());
  expect(gw.lastRequest()).toMatchObject({ status: 429, failure: "upstream_error", cost_usd: null, cost_source: "unknown" });
  expect(gw.fake.lookups).toEqual([]);
});

test("a stream that ends without its cost has the cost looked up afterwards", async () => {
  const route = gw.addRoute();
  const res = await gw.chat(route.key, hello("fixture/no-usage", { stream: true }));
  await res.arrayBuffer();
  await until(() => gw.lastRequest() !== null);
  await gw.settled();

  expect(gw.fake.lookups).toEqual(["gen-1795300004-FixtureNoUsage000001"]);
  expect(gw.lastRequest()).toMatchObject({ cost_usd: 0.0000087, cost_source: "provider", prompt_tokens: 8, completion_tokens: 3, failure: null });
});

test("when the client goes away, the request to the provider is cancelled", async () => {
  // Watch the signal the gateway hands to its own request to the provider.
  const signals: AbortSignal[] = [];
  const watching = startGateway({ fetch: ((input, init) => (init?.signal && signals.push(init.signal), fetch(input, init))) as typeof fetch });
  try {
    const route = watching.addRoute();
    const leaving = new AbortController();
    const res = await watching.chat(route.key, hello("fixture/hang", { stream: true }), { signal: leaving.signal });
    await res.body!.getReader().read();
    expect(watching.deps.running.get(route.id)).toBe(1);
    expect(signals.map((s) => s.aborted)).toEqual([false]);

    leaving.abort();
    await until(() => signals[0]!.aborted);
    await watching.fake.cancelled; // and the provider saw its stream cancelled

    await until(() => watching.lastRequest() !== null);
    expect(watching.lastRequest()).toMatchObject({ failure: "client_cancelled", streamed: 1 });
    expect(watching.deps.running.has(route.id)).toBe(false);

    // What the cut-off answer cost is asked for afterwards, since the provider may still charge for it.
    await watching.settled();
    expect(watching.lastRequest()).toMatchObject({ cost_usd: 0.0000087, cost_source: "provider" });
  } finally {
    await watching.stop();
  }
});

test("when the provider refuses BaseRouter's key, the client is not told its own key is wrong", async () => {
  gw.store.removeProvider("openrouter");
  gw.store.addProvider({
    id: "openrouter", kind: "openrouter", name: "OpenRouter", key_sealed: seal(gw.deps.master, "a-key-openrouter-does-not-know"), key_hint: "know",
    status: "up", error: null, models: 3, checked_at: 0, created_at: 0,
  });
  const route = gw.addRoute();
  const res = await gw.chat(route.key, hello());
  expect(res.status).toBe(502);
  expect((await errorOf(res)).code).toBe("provider_refused_key");
  expect(gw.store.provider("openrouter")).toMatchObject({ status: "down", error: "No auth credentials found" });
  expect(gw.lastRequest()).toMatchObject({ status: 401, failure: "upstream_error" });
});

test("a provider that cannot be reached gives a clear error and a failed request", async () => {
  const dead = startGateway({ upstream: { baseUrl: "http://127.0.0.1:1", fetch } });
  try {
    const route = dead.addRoute();
    const res = await dead.chat(route.key, hello());
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe("provider_unreachable");
    expect(dead.lastRequest()).toMatchObject({ status: null, failure: "network_error" });
  } finally {
    await dead.stop();
  }
});

test("without a provider, the request is refused with what to do", async () => {
  const empty = startGateway({ providerKey: null });
  try {
    const route = empty.addRoute();
    const res = await empty.chat(route.key, hello());
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe("no_provider");
  } finally {
    await empty.stop();
  }
});

test("the model list is the provider's, limited to the route's models when it has a list", async () => {
  const models = (key: string) => fetch(`${gw.url}/v1/models`, { headers: { Authorization: `Bearer ${key}` } });
  const ids = async (res: Response) => ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id);

  const open = gw.addRoute();
  expect(await ids(await models(open.key))).toEqual(["openai/gpt-5-mini", "anthropic/claude-sonnet-5.5", "google/gemini-2.5-flash"]);

  const limited = gw.addRoute({ allow: ["google/gemini-2.5-flash", "not/there"] });
  expect(await ids(await models(limited.key))).toEqual(["google/gemini-2.5-flash"]);

  expect((await fetch(`${gw.url}/v1/models`)).status).toBe(401);
});

test("the model list asks for every model, not only those that write text, and passes on a client's filters", async () => {
  const route = gw.addRoute();
  const list = (query = "") => fetch(`${gw.url}/v1/models${query}`, { headers: { Authorization: `Bearer ${route.key}` } });
  // OpenRouter leaves out models that only make images, sound or video unless asked for all.
  expect((await list()).status).toBe(200);
  expect(gw.fake.modelQueries.at(-1)).toBe("?output_modalities=all");
  // An app can ask for some only; filters OpenRouter does not take, and odd values, are not sent on.
  await list("?output_modalities=image,video&supported_parameters=tools&category=programming&order=newest&x=1");
  expect(gw.fake.modelQueries.at(-1)).toBe("?output_modalities=image%2Cvideo&supported_parameters=tools&category=programming");
  await list("?supported_parameters=" + encodeURIComponent("tools&output_modalities=text"));
  expect(gw.fake.modelQueries.at(-1)).toBe("?output_modalities=all");
});

test("a route with several models sends them as fallbacks, starting with the model asked for", async () => {
  const route = gw.addRoute({ allow: ["anthropic/claude-sonnet-5.5", "openai/gpt-5-mini", "google/gemini-2.5-flash"] });
  await gw.chat(route.key, hello("openai/gpt-5-mini"));
  const sent = JSON.parse(gw.fake.chats[0]!.body);
  expect(sent.model).toBe("openai/gpt-5-mini");
  expect(sent.models).toEqual(["openai/gpt-5-mini", "anthropic/claude-sonnet-5.5", "google/gemini-2.5-flash"]);
  expect(sent.messages).toEqual([{ role: "user", content: "Hello" }]);
});

test("a route with one model, or a client that sends its own list, is sent as written", async () => {
  const one = gw.addRoute({ allow: ["openai/gpt-5-mini"] });
  const written = JSON.stringify(hello("openai/gpt-5-mini"));
  await gw.chat(one.key, written);
  expect(gw.fake.chats[0]!.body).toBe(written);

  const many = gw.addRoute({ allow: ["openai/gpt-5-mini", "google/gemini-2.5-flash"] });
  const own = JSON.stringify(hello("openai/gpt-5-mini", { models: ["openai/gpt-5-mini"] }));
  await gw.chat(many.key, own);
  expect(gw.fake.chats[1]!.body).toBe(own);
});
