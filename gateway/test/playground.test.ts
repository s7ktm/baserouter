// The playground's requests: a chat or an image sent as a route, with the panel's session in place of the
// route's key. Over real HTTP, against the fake OpenRouter.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_KEY, fixtureBytes } from "./fake-openrouter.ts";
import { startGateway, until, type Gateway } from "./harness.ts";

let gw: Gateway;
let auth: Record<string, string>;
beforeEach(async () => {
  gw = startGateway();
  const res = await fetch(`${gw.url}/api/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "a test password" }) });
  auth = { Authorization: `Bearer ${((await res.json()) as { token: string }).token}` };
});
afterEach(() => gw.stop());

const hello = (model = "openai/gpt-5-mini", extra: object = {}) => ({ model, messages: [{ role: "user", content: "Hello" }], ...extra });
function attempt(routeId: string, body: unknown, headers: Record<string, string> = auth, init: RequestInit = {}) {
  return fetch(`${gw.url}/api/routes/${routeId}/try`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), ...init });
}
const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

// The stream as the provider sent it, and the one event the gateway adds after it.
async function parts(res: Response) {
  const text = new TextDecoder().decode(await res.arrayBuffer());
  const at = text.lastIndexOf("\nevent: baserouter.request\n");
  const told = at === -1 ? null : (JSON.parse(text.slice(at).split("\ndata: ")[1]!) as Record<string, unknown>);
  return { stream: at === -1 ? text : text.slice(0, at), told };
}

test("a streamed chat sent as a route arrives as the provider sent it, then says what its row holds", async () => {
  const route = gw.addRoute();
  const sent = hello("openai/gpt-5-mini", { stream: true });
  const res = await attempt(route.id, sent);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");

  const { stream, told } = await parts(res);
  expect(stream).toBe(new TextDecoder().decode(await fixtureBytes("chat-stream.sse")));

  // The provider saw its own key and the body as the panel wrote it.
  expect(gw.fake.chats).toEqual([{ key: FAKE_KEY, body: JSON.stringify(sent) }]);

  // One row, the route's, like a request made with its key.
  const row = gw.lastRequest()!;
  expect(gw.store.requests({ limit: 10 })).toHaveLength(1);
  expect(row).toMatchObject({ route_id: route.id, provider_id: "openrouter", kind: "chat", streamed: 1, cost_usd: 0.0000143, cost_source: "provider", failure: null });

  expect(told).toEqual({
    id: row.id, route: route.id, at: row.started_at, kind: "chat", requestedModel: "openai/gpt-5-mini", model: "openai/gpt-5-mini", streamed: true,
    promptTokens: 8, completionTokens: 6, cost: 0.0000143, costSource: "provider", firstTokenMs: row.first_token_ms, totalMs: row.total_ms,
    status: 200, failure: null, ok: true, provider: "OpenRouter",
  });
  expect(told!.firstTokenMs).not.toBeNull();
});

test("it needs the panel's session, a route that exists, and a page of the gateway's own", async () => {
  const route = gw.addRoute();
  const none = await attempt(route.id, hello(), {});
  expect(none.status).toBe(401);
  expect(await codeOf(none)).toBe("signed_out");
  // A route's key opens the one address, not this.
  expect((await attempt(route.id, hello(), { Authorization: `Bearer ${route.key}` })).status).toBe(401);

  const unknown = await attempt("nope", hello());
  expect(unknown.status).toBe(404);

  const elsewhere = await attempt(route.id, hello(), { ...auth, Origin: "https://example.com" });
  expect(elsewhere.status).toBe(403);
  expect(await codeOf(elsewhere)).toBe("wrong_origin");

  expect(gw.fake.chats).toHaveLength(0);
  expect(gw.lastRequest()).toBeNull();
});

test("what holds for the route holds here: its switch, its budget, its models", async () => {
  const off = gw.addRoute({ enabled: 0 });
  const refused = await attempt(off.id, hello());
  expect(refused.status).toBe(403);
  expect(await codeOf(refused)).toBe("route_off");

  const full = gw.addRoute({ budget_usd: 1 });
  gw.spend(full.id, 1);
  const over = await attempt(full.id, hello());
  expect(over.status).toBe(402);
  expect(await codeOf(over)).toBe("budget_used_up");

  const narrow = gw.addRoute({ allow: ["openai/gpt-5-mini"] });
  const other = await attempt(narrow.id, hello("anthropic/claude-sonnet-5.5"));
  expect(other.status).toBe(403);
  expect(await codeOf(other)).toBe("model_not_allowed");

  expect(gw.fake.chats).toHaveLength(0);
});

test("what it costs counts towards the route's budget", async () => {
  const route = gw.addRoute({ budget_usd: 0.00001 });
  const first = await attempt(route.id, hello("openai/gpt-5-mini", { stream: true }));
  expect(first.status).toBe(200);
  await first.arrayBuffer(); // the row is written when the stream ends
  const second = await attempt(route.id, hello("openai/gpt-5-mini", { stream: true }));
  expect(second.status).toBe(402);
  expect(gw.fake.chats).toHaveLength(1);
});

test("when a model's first source fails, the event names the model that answered", async () => {
  gw.store.addModel({
    id: "m1", name: "smart", makes: ["text"], created_at: 1,
    places: [{ provider: "openrouter", model: "anthropic/claude-sonnet-5.5", via: "fixture-down" }, { provider: "openrouter", model: "openai/gpt-5-mini", via: null }],
  });
  const route = gw.addRoute({ allow: ["smart"] });
  const { told } = await parts(await attempt(route.id, hello("smart", { stream: true })));
  expect(told).toMatchObject({ requestedModel: "smart", model: "openai/gpt-5-mini", provider: "OpenRouter", ok: true });
  expect(gw.fake.chats).toHaveLength(2);
});

test("a stream that fails half way arrives whole, and its event says it failed", async () => {
  const route = gw.addRoute();
  const { stream, told } = await parts(await attempt(route.id, hello("fixture/stream-error", { stream: true })));
  expect(stream).toBe(new TextDecoder().decode(await fixtureBytes("chat-stream-error.sse")));
  expect(told).toMatchObject({ ok: false, failure: "stream_error" });
});

test("a stream that ends without its cost says so, and the row is filled in afterwards", async () => {
  const route = gw.addRoute();
  const { told } = await parts(await attempt(route.id, hello("fixture/no-usage", { stream: true })));
  expect(told).toMatchObject({ cost: null, costSource: "unknown", ok: true });
  await gw.settled();
  // The panel finds the cost under the same id in the gateway's state.
  const state = (await (await fetch(`${gw.url}/api/state`, { headers: auth })).json()) as { requests: { id: number; cost: number | null }[] };
  expect(state.requests.find((r) => r.id === told!.id)?.cost).toBeGreaterThan(0);
});

test("a plain answer, and the provider's own refusal, come back as they are, with no event", async () => {
  const route = gw.addRoute();
  const plain = await attempt(route.id, hello());
  expect(new Uint8Array(await plain.arrayBuffer())).toEqual(await fixtureBytes("chat.json"));

  const limited = await attempt(route.id, hello("fixture/429", { stream: true }));
  expect(limited.status).toBe(429);
  expect(new Uint8Array(await limited.arrayBuffer())).toEqual(await fixtureBytes("error-429.json"));
  expect(gw.lastRequest()).toMatchObject({ route_id: route.id, status: 429, failure: "upstream_error" });
});

test("stopping it cancels the request to the provider, and the route is busy while it runs", async () => {
  const route = gw.addRoute();
  const leaving = new AbortController();
  const res = await attempt(route.id, hello("fixture/hang", { stream: true }), auth, { signal: leaving.signal });
  await res.body!.getReader().read();
  expect(gw.deps.running.get(route.id)).toBe(1);

  leaving.abort();
  await gw.fake.cancelled;
  await until(() => gw.lastRequest() !== null);
  expect(gw.lastRequest()).toMatchObject({ route_id: route.id, failure: "client_cancelled" });
  expect(gw.deps.running.has(route.id)).toBe(false);
});

test("nothing of the conversation is kept", async () => {
  const route = gw.addRoute();
  const secret = "a sentence only the playground sent";
  await (await attempt(route.id, { model: "openai/gpt-5-mini", stream: true, messages: [{ role: "user", content: secret }] })).arrayBuffer();
  await gw.settled();
  const everything = JSON.stringify(gw.store.db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => gw.store.db.query(`SELECT * FROM "${(t as { name: string }).name}"`).all()));
  expect(everything).not.toContain(secret);
  expect(everything).not.toContain("Merhaba"); // the answer's first word
});

// ---- images ----

const picture = (extra: object = {}) => ({ model: "recraft/recraft-v4.1-flash", prompt: "A small blue circle on white.", ...extra });
function attemptImage(routeId: string, body: unknown, headers: Record<string, string> = auth) {
  return fetch(`${gw.url}/api/routes/${routeId}/try/images`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const requestOf = async (id: string | null, headers = auth) => {
  const res = await fetch(`${gw.url}/api/requests/${id}`, { headers });
  return { status: res.status, body: (await res.json()) as { request?: Record<string, unknown> } };
};

test("an image asked for as a route comes back unchanged, and names its row", async () => {
  const route = gw.addRoute();
  const sent = picture({ size: "1024x1024", something_only_this_provider_knows: { a: 1 } });
  const res = await attemptImage(route.id, sent);
  expect(res.status).toBe(200);
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(await fixtureBytes("images.json"));

  // The provider saw its own key and the body as written, parameters BaseRouter knows nothing of included.
  const post = gw.fake.posts.at(-1)!;
  expect(post).toMatchObject({ path: "/images", key: FAKE_KEY });
  expect(new TextDecoder().decode(post.body)).toBe(JSON.stringify(sent));

  const row = gw.lastRequest()!;
  expect(row).toMatchObject({ route_id: route.id, kind: "image", cost_usd: 0.007, failure: null });
  expect(res.headers.get("x-baserouter-request")).toBe(String(row.id));

  const { status, body } = await requestOf(res.headers.get("x-baserouter-request"));
  expect(status).toBe(200);
  expect(body.request).toMatchObject({ id: row.id, route: route.id, kind: "image", model: "recraft/recraft-v4.1-flash", cost: 0.007, totalMs: row.total_ms, ok: true, provider: "OpenRouter" });
});

test("one request's row needs the session, and an id that exists", async () => {
  const route = gw.addRoute();
  const res = await attemptImage(route.id, picture());
  const id = res.headers.get("x-baserouter-request");
  expect((await requestOf(id, {})).status).toBe(401);
  for (const unknown of ["999", "0", "abc", "1.5"]) expect((await requestOf(unknown)).status).toBe(404);
});

test("an image is refused as the route's requests are: session, switch, budget, models", async () => {
  const route = gw.addRoute();
  expect((await attemptImage(route.id, picture(), {})).status).toBe(401);
  expect((await attemptImage("nope", picture())).status).toBe(404);

  const off = gw.addRoute({ enabled: 0 });
  expect(await codeOf(await attemptImage(off.id, picture()))).toBe("route_off");

  const full = gw.addRoute({ budget_usd: 1 });
  gw.spend(full.id, 1);
  expect(await codeOf(await attemptImage(full.id, picture()))).toBe("budget_used_up");

  const narrow = gw.addRoute({ allow: ["openai/gpt-5-mini"] });
  expect(await codeOf(await attemptImage(narrow.id, picture()))).toBe("model_not_allowed");

  expect(gw.fake.posts).toHaveLength(0);
});

test("a provider's refusal of an image comes back as it is, with its row", async () => {
  const route = gw.addRoute();
  const res = await attemptImage(route.id, picture({ model: "fixture/429" }));
  expect(res.status).toBe(429);
  const { body } = await requestOf(res.headers.get("x-baserouter-request"));
  expect(body.request).toMatchObject({ kind: "image", ok: false, failure: "upstream_error", status: 429 });
});

test("the image is kept when the route keeps what it makes, and not when it does not", async () => {
  await gw.stop();
  const dir = mkdtempSync(join(tmpdir(), "baserouter-play-"));
  gw = startGateway({ mediaDir: dir });
  try {
    const res = await fetch(`${gw.url}/api/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "a test password" }) });
    auth = { Authorization: `Bearer ${((await res.json()) as { token: string }).token}` };

    const keeps = gw.addRoute();
    const made = await attemptImage(keeps.id, picture());
    await made.arrayBuffer();
    await gw.settled();
    const kept = gw.store.media({ kind: "image", limit: 10 });
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ route_id: keeps.id, request_id: Number(made.headers.get("x-baserouter-request")), prompt: "A small blue circle on white." });

    const forgets = gw.addRoute({ keep_media: 0 });
    await (await attemptImage(forgets.id, picture())).arrayBuffer();
    await gw.settled();
    expect(gw.store.media({ kind: "image", limit: 10 })).toHaveLength(1);
  } finally {
    await gw.settled();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an answer from the one address carries no such header", async () => {
  const route = gw.addRoute();
  const res = await fetch(`${gw.url}/v1/images/generations`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${route.key}` }, body: JSON.stringify(picture()) });
  expect(res.status).toBe(200);
  expect(res.headers.get("x-baserouter-request")).toBeNull();
  expect((await gw.chat(route.key, hello())).headers.get("x-baserouter-request")).toBeNull();
});
