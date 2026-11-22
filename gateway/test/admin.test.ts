// The management API end to end, over real HTTP, against the fake OpenRouter.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { hashKey } from "../src/secrets.ts";
import { FAKE_KEY } from "./fake-openrouter.ts";
import { startGateway, type Gateway } from "./harness.ts";

const PASSWORD = "a test password";

let gw: Gateway;
beforeEach(() => void (gw = startGateway({ providerKey: null })));
afterEach(() => gw.stop());

function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${gw.url}/api${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(): Promise<Record<string, string>> {
  const res = await api("POST", "/setup", { password: PASSWORD });
  const { token } = (await res.json()) as { token: string };
  return { Authorization: `Bearer ${token}` };
}

const got = async (res: Response) => (await res.json()) as { provider: Record<string, unknown>; route: Record<string, unknown> };
const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

test("the first run sets the password, once", async () => {
  expect(await (await api("GET", "/status")).json()).toEqual({ passwordSet: false });

  const short = await api("POST", "/setup", { password: "short" });
  expect(short.status).toBe(400);
  expect(await codeOf(short)).toBe("password_too_short");

  const res = await api("POST", "/setup", { password: PASSWORD });
  expect(res.status).toBe(201);
  expect(await (await api("GET", "/status")).json()).toEqual({ passwordSet: true });

  const again = await api("POST", "/setup", { password: "another password" });
  expect(again.status).toBe(409);

  // The password itself is not in the database.
  expect(gw.store.setting("admin_password")).not.toContain(PASSWORD);
});

test("nothing is listed or changed without signing in", async () => {
  await signIn();
  for (const [method, path] of [["GET", "/providers"], ["GET", "/routes"], ["GET", "/requests"], ["POST", "/routes"], ["DELETE", "/routes/x"]] as const) {
    const res = await api(method, path, method === "POST" ? { name: "x", budget: 1 } : undefined);
    expect(res.status).toBe(401);
  }
  expect((await api("GET", "/routes", undefined, { Authorization: "Bearer made-up" })).status).toBe(401);
  expect(gw.store.routes()).toHaveLength(0);
});

test("signing in gives a session that works as a header or a cookie, until signing out", async () => {
  await signIn();
  const wrong = await api("POST", "/login", { password: "not the password" });
  expect(wrong.status).toBe(401);

  const res = await api("POST", "/login", { password: PASSWORD });
  expect(res.status).toBe(200);
  const { token } = (await res.json()) as { token: string };
  const cookie = res.headers.get("set-cookie")!;
  expect(cookie).toContain(`br_session=${token}`);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");

  expect((await api("GET", "/routes", undefined, { Authorization: `Bearer ${token}` })).status).toBe(200);
  expect((await api("GET", "/routes", undefined, { Cookie: `br_session=${token}` })).status).toBe(200);

  expect((await api("POST", "/logout", undefined, { Cookie: `br_session=${token}` })).status).toBe(204);
  expect((await api("GET", "/routes", undefined, { Authorization: `Bearer ${token}` })).status).toBe(401);
});

test("a session ends after thirty days", async () => {
  gw.clock.now = Date.now();
  const auth = await signIn();
  gw.clock.now += 29 * 24 * 60 * 60 * 1000;
  expect((await api("GET", "/routes", undefined, auth)).status).toBe(200);
  gw.clock.now += 2 * 24 * 60 * 60 * 1000;
  expect((await api("GET", "/routes", undefined, auth)).status).toBe(401);
});

test("five wrong passwords close sign-in for a minute", async () => {
  gw.clock.now = Date.now();
  await signIn();
  for (let i = 0; i < 5; i++) expect((await api("POST", "/login", { password: "wrong password" })).status).toBe(401);
  const locked = await api("POST", "/login", { password: PASSWORD });
  expect(locked.status).toBe(429);
  gw.clock.now += 61_000;
  expect((await api("POST", "/login", { password: PASSWORD })).status).toBe(200);
});

test("a request from another site is refused, even with a session", async () => {
  const auth = await signIn();
  const res = await api("GET", "/routes", undefined, { ...auth, Origin: "http://evil.example" });
  expect(res.status).toBe(403);
  const same = await api("GET", "/routes", undefined, { ...auth, Origin: gw.url });
  expect(same.status).toBe(200);
});

test("a provider is tested before it is added, and its key is never given back", async () => {
  const auth = await signIn();

  const bad = await api("POST", "/providers", { kind: "openrouter", key: "a-key-openrouter-does-not-know" }, auth);
  expect(bad.status).toBe(422);
  expect(await bad.json()).toEqual({ error: { code: "provider_test_failed", message: "No auth credentials found" } });
  expect(gw.store.providers()).toHaveLength(0);

  expect((await api("POST", "/providers", { kind: "ollama", key: "x" }, auth)).status).toBe(400);
  expect((await api("POST", "/providers", { kind: "openrouter", key: "  " }, auth)).status).toBe(400);

  const res = await api("POST", "/providers", { kind: "openrouter", key: FAKE_KEY }, auth);
  expect(res.status).toBe(201);
  const text = await res.text();
  expect(text).not.toContain(FAKE_KEY);
  const { provider } = JSON.parse(text);
  expect(provider).toMatchObject({ kind: "openrouter", name: "OpenRouter", status: "up", keyHint: "-key", models: 3, error: null });

  // In the database the key is sealed.
  const stored = gw.store.providers()[0]!;
  expect(JSON.stringify(stored)).not.toContain(FAKE_KEY);
  expect(stored.key_sealed).toStartWith("v1.");

  const list = await (await api("GET", "/providers", undefined, auth)).text();
  expect(list).not.toContain(FAKE_KEY);
  expect(list).not.toContain(stored.key_sealed);
  expect(JSON.parse(list).providers).toHaveLength(1);

  expect((await api("POST", "/providers", { kind: "openrouter", key: FAKE_KEY }, auth)).status).toBe(409);

  const tested = await api("POST", `/providers/${provider.id}/test`, undefined, auth);
  expect((await got(tested)).provider).toMatchObject({ status: "up", models: 3 });

  expect((await api("DELETE", `/providers/${provider.id}`, undefined, auth)).status).toBe(204);
  expect((await api("DELETE", `/providers/${provider.id}`, undefined, auth)).status).toBe(404);
  expect(gw.store.providers()).toHaveLength(0);
});

test("a route's key is given in full once, and only its hash is kept", async () => {
  const auth = await signIn();
  await api("POST", "/providers", { kind: "openrouter", key: FAKE_KEY }, auth);

  const res = await api("POST", "/routes", { name: " Home assistant ", budget: 10, models: ["openai/gpt-5-mini"] }, auth);
  expect(res.status).toBe(201);
  const { route, key } = (await res.json()) as { route: Record<string, unknown>; key: string };
  expect(key).toMatch(/^br_[0-9a-f]{48}$/);
  expect(route).toEqual({ id: route.id, name: "Home assistant", enabled: true, busy: false, today: 0, used: 0, budget: 10, keyHint: key.slice(-4), models: ["openai/gpt-5-mini"], icon: "code", color: "#2B62D9" });

  const stored = gw.store.route(route.id as string)!;
  expect(JSON.stringify(stored)).not.toContain(key);
  expect(stored.key_hash).toBe(hashKey(key));

  const list = await (await api("GET", "/routes", undefined, auth)).text();
  expect(list).not.toContain(key);
  expect(list).not.toContain(stored.key_hash);

  // The key opens the one address.
  const chat = await gw.chat(key, { model: "openai/gpt-5-mini", messages: [{ role: "user", content: "Hello" }] });
  expect(chat.status).toBe(200);

  const { routes, budgetsStartAgainOn } = (await (await api("GET", "/routes", undefined, auth)).json()) as { routes: Record<string, unknown>[]; budgetsStartAgainOn: string };
  expect(routes[0]).toMatchObject({ today: 0.0000205, used: 0.0000205 });
  expect(budgetsStartAgainOn).toMatch(/^\d{4}-\d{2}-01$/);
});

test("a route keeps the icon and colour the panel gives it", async () => {
  const auth = await signIn();
  const res = await api("POST", "/routes", { name: "Robot arm", budget: 5, icon: "robot", color: "#1C2030" }, auth);
  expect(((await res.json()) as { route: Record<string, unknown> }).route).toMatchObject({ icon: "robot", color: "#1C2030" });
});

test("a route needs a name, a budget above zero, and a plain icon and colour", async () => {
  const auth = await signIn();
  for (const body of [{ budget: 5 }, { name: "", budget: 5 }, { name: "x" }, { name: "x", budget: 0 }, { name: "x", budget: -1 }, { name: "x", budget: "5" }, { name: "x", budget: 5, models: "m" },
    { name: "x", budget: 5, icon: "<svg>" }, { name: "x", budget: 5, color: "red" }, { name: "x", budget: 5, color: "#12345" }]) {
    expect((await api("POST", "/routes", body, auth)).status).toBe(400);
  }
  expect(gw.store.routes()).toHaveLength(0);
});

test("a route's budget and switch can be changed, and both take effect at once", async () => {
  const auth = await signIn();
  await api("POST", "/providers", { kind: "openrouter", key: FAKE_KEY }, auth);
  const { route, key } = (await (await api("POST", "/routes", { name: "Robot arm", budget: 5 }, auth)).json()) as { route: { id: string }; key: string };
  const hello = { model: "openai/gpt-5-mini", messages: [{ role: "user", content: "Hello" }] };

  const off = await api("PATCH", `/routes/${route.id}`, { enabled: false }, auth);
  expect((await got(off)).route).toMatchObject({ enabled: false, budget: 5 });
  expect((await gw.chat(key, hello)).status).toBe(403);

  await api("PATCH", `/routes/${route.id}`, { enabled: true }, auth);
  gw.spend(route.id, 5);
  expect((await gw.chat(key, hello)).status).toBe(402);

  const raised = await api("PATCH", `/routes/${route.id}`, { budget: 8 }, auth);
  expect((await got(raised)).route).toMatchObject({ enabled: true, budget: 8, used: 5 });
  expect((await gw.chat(key, hello)).status).toBe(200);

  expect((await api("PATCH", `/routes/${route.id}`, { budget: 0 }, auth)).status).toBe(400);
  expect((await api("PATCH", `/routes/${route.id}`, { enabled: "yes" }, auth)).status).toBe(400);
  expect((await api("PATCH", "/routes/nope", { budget: 1 }, auth)).status).toBe(404);
});

test("a removed route's key stops working, and its requests stay in the activity list", async () => {
  const auth = await signIn();
  await api("POST", "/providers", { kind: "openrouter", key: FAKE_KEY }, auth);
  const { route, key } = (await (await api("POST", "/routes", { name: "Newsletter bot", budget: 3 }, auth)).json()) as { route: { id: string }; key: string };
  const hello = { model: "openai/gpt-5-mini", messages: [{ role: "user", content: "Hello" }] };
  expect((await gw.chat(key, hello)).status).toBe(200);

  expect((await api("DELETE", `/routes/${route.id}`, undefined, auth)).status).toBe(204);
  expect((await gw.chat(key, hello)).status).toBe(401);
  expect((await api("DELETE", `/routes/${route.id}`, undefined, auth)).status).toBe(404);

  const { requests } = (await (await api("GET", "/requests", undefined, auth)).json()) as { requests: Record<string, unknown>[] };
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ route: null, cost: 0.0000205, ok: true });
});

test("requests are listed newest first, and can be filtered by route and paged", async () => {
  const auth = await signIn();
  const a = gw.addRoute();
  const b = gw.addRoute();
  for (let i = 1; i <= 5; i++) gw.spend(i % 2 ? a.id : b.id, i / 100, i);

  type Listed = { id: number; route: string; cost: number; ok: boolean; costSource: string; model: string; at: number };
  const list = async (query = "") => ((await (await api("GET", `/requests${query}`, undefined, auth)).json()) as { requests: Listed[] }).requests;

  const all = await list();
  expect(all.map((r) => r.cost)).toEqual([0.05, 0.04, 0.03, 0.02, 0.01]);
  expect(all[0]).toMatchObject({ route: a.id, ok: true, costSource: "provider", model: "openai/gpt-5-mini", at: 5 });

  expect((await list(`?route=${b.id}`)).map((r) => r.cost)).toEqual([0.04, 0.02]);
  const page = await list("?limit=2");
  expect(page.map((r) => r.cost)).toEqual([0.05, 0.04]);
  expect((await list(`?limit=2&before=${page[1]!.id}`)).map((r) => r.cost)).toEqual([0.03, 0.02]);
});
