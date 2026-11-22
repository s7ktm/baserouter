// What the panel needs from the gateway: its files, one answer with everything it draws,
// and the provider's models. Over real HTTP, against the fake OpenRouter.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/store.ts";
import { FAKE_KEY } from "./fake-openrouter.ts";
import { startGateway, type Gateway } from "./harness.ts";

let gw: Gateway;
beforeEach(() => void (gw = startGateway()));
afterEach(() => gw.stop());

async function signIn(): Promise<Record<string, string>> {
  const res = await fetch(`${gw.url}/api/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "a test password" }) });
  return { Authorization: `Bearer ${((await res.json()) as { token: string }).token}` };
}

test("the panel is served at the root, and may only talk to this gateway", async () => {
  const res = await fetch(`${gw.url}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain('<script type="module" src="core/app.js"></script>');
  const policy = res.headers.get("content-security-policy")!;
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).not.toContain("googleapis");
});

test("the panel's scripts, styles and fonts are served with their types", async () => {
  for (const [path, type] of [["/core/app.js", "javascript"], ["/core/shared.css", "text/css"], ["/fonts/socket.css", "text/css"], ["/fonts/onest-latin-ext.woff2", "font/woff2"]]) {
    const res = await fetch(gw.url + path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(type!);
    await res.arrayBuffer();
  }
});

test("nothing outside the panel's folder is served", async () => {
  for (const path of ["/../../gateway/package.json", "/%2e%2e/%2e%2e/gateway/package.json", "/core/../../serve.ts", "/core", "/nothing-here.js", "/.git", "/%E0%A4%A"]) {
    const res = await fetch(gw.url + path);
    expect([400, 404]).toContain(res.status);
    expect(await res.text()).not.toContain('"name": "baserouter-gateway"');
  }
  // and the panel does not hide the API's own answers
  expect((await fetch(`${gw.url}/api/nothing`)).status).toBe(401);
  expect((await fetch(`${gw.url}/v1/nothing`)).status).toBe(401);
  expect((await fetch(`${gw.url}/api/status`)).status).toBe(200);
});

test("the state is everything the panel draws, in the prototype's shape", async () => {
  const auth = await signIn();
  gw.clock.now = new Date(2026, 10, 22, 15, 0).getTime();
  const home = gw.addRoute({ name: "Home assistant", budget_usd: 10, icon: "home", color: "#14874C" });
  const arm = gw.addRoute({ name: "Robot arm", budget_usd: 5 });
  const day = (d: number, h = 12) => new Date(2026, 10, d, h).getTime();
  gw.spend(home.id, 0.5, day(22, 9)); // today
  gw.spend(arm.id, 0.25, day(22, 10)); // today
  gw.spend(home.id, 1, day(21)); // yesterday
  gw.spend(home.id, 2, day(16)); // six days ago: still in the week
  gw.spend(home.id, 4, day(15)); // seven days ago: in the month, not the week
  gw.spend(home.id, 8, new Date(2026, 9, 31, 23).getTime()); // last month
  gw.spend(arm.id, null, day(22, 11)); // today, cost unknown

  const res = await fetch(`${gw.url}/api/state`, { headers: auth });
  expect(res.status).toBe(200);
  const state = (await res.json()) as Record<string, any>;

  expect(state.now).toBe(gw.clock.now);
  expect(state.spend).toEqual({ today: 0.75, month: 7.75, week: [2, 0, 0, 0, 0, 1, 0.75], requests: 3 });
  expect(state.budgetsStartAgainOn).toBe("2026-12-01");
  expect(state.providers).toEqual([{ id: "openrouter", kind: "openrouter", name: "OpenRouter", status: "up", keyHint: "-key", models: 3, error: null, checkedAt: 0 }]);
  expect(state.routes).toEqual([
    { id: home.id, name: "Home assistant", enabled: true, busy: false, today: 0.5, used: 7.5, budget: 10, keyHint: home.key.slice(-4), models: [], icon: "home", color: "#14874C", keepMedia: true },
    { id: arm.id, name: "Robot arm", enabled: true, busy: false, today: 0.25, used: 0.25, budget: 5, keyHint: arm.key.slice(-4), models: [], icon: "code", color: "#2B62D9", keepMedia: true },
  ]);
  expect(state.images).toEqual([]);
  expect(state.sounds).toEqual([]);
  expect(state.mediaSpace).toEqual({ images: 0, sounds: 0, bytes: 0, keeping: false, max: 1024 * 1024 * 1024 });
  expect(state.requests).toHaveLength(7);
  expect(state.requests[0]).toMatchObject({ route: arm.id, cost: null, costSource: "unknown", ok: true, at: day(22, 11) });
  expect(state.last).toEqual(state.requests[0]);
  expect(JSON.stringify(state)).not.toContain(FAKE_KEY);
});

test("a request whose route was removed is listed, but is not the last request", async () => {
  const auth = await signIn();
  const kept = gw.addRoute();
  const gone = gw.addRoute();
  gw.spend(kept.id, 0.1, 1);
  gw.spend(gone.id, 0.2, 2);
  gw.store.removeRoute(gone.id);
  const state = (await (await fetch(`${gw.url}/api/state`, { headers: auth })).json()) as Record<string, any>;
  expect(state.requests.map((r: { route: string | null }) => r.route)).toEqual([null, kept.id]);
  expect(state.last.route).toBe(kept.id);
});

test("with nothing set up, the state is empty", async () => {
  const empty = startGateway({ providerKey: null });
  try {
    const res = await fetch(`${empty.url}/api/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "a test password" }) });
    const { token } = (await res.json()) as { token: string };
    const state = (await (await fetch(`${empty.url}/api/state`, { headers: { Authorization: `Bearer ${token}` } })).json()) as Record<string, any>;
    expect(state).toMatchObject({ spend: { today: 0, month: 0, week: [0, 0, 0, 0, 0, 0, 0], requests: 0 }, providers: [], routes: [], requests: [], last: null });
    expect((await (await fetch(`${empty.url}/api/models`, { headers: { Authorization: `Bearer ${token}` } })).json())).toEqual({ models: [] });
  } finally {
    await empty.stop();
  }
});

test("the state needs a session", async () => {
  await signIn();
  expect((await fetch(`${gw.url}/api/state`)).status).toBe(401);
  expect((await fetch(`${gw.url}/api/models`)).status).toBe(401);
});

test("the model list is the provider's, sorted, and asked for once in ten minutes", async () => {
  const auth = await signIn();
  const asked = () => fetch(`${gw.url}/api/models`, { headers: auth }).then((r) => r.json());
  expect(await asked()).toEqual({ models: ["anthropic/claude-sonnet-5.5", "google/gemini-2.5-flash", "openai/gpt-5-mini"] });
  gw.store.removeProvider("openrouter");
  expect(await asked()).toEqual({ models: [] });
});

test("a database from the first version gains the route's icon, colour and image switch, and its requests a kind", () => {
  const dir = mkdtempSync(join(tmpdir(), "baserouter-test-"));
  try {
    const path = join(dir, "old.sqlite");
    const old = new Database(path);
    old.exec(`CREATE TABLE routes (id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_hint TEXT NOT NULL,
      budget_usd REAL NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, models TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL) STRICT;
      INSERT INTO routes VALUES ('r1', 'Old route', 'h', '0000', 5, 1, '[]', 0);
      CREATE TABLE requests (id INTEGER PRIMARY KEY AUTOINCREMENT, route_id TEXT, started_at INTEGER NOT NULL) STRICT;
      INSERT INTO requests (route_id, started_at) VALUES ('r1', 0);
      PRAGMA user_version = 1;`);
    old.close();

    const db = openDb(path);
    expect(db.query("SELECT icon, color FROM routes").get()).toEqual({ icon: "code", color: "#2B62D9" });
    expect(db.query("SELECT kind FROM requests").get()).toEqual({ kind: "chat" });
    expect(db.query("SELECT keep_media FROM routes").get()).toEqual({ keep_media: 1 });
    expect(db.query("SELECT COUNT(*) AS n FROM media").get()).toEqual({ n: 0 });
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 5 });
    db.close();
    expect(openDb(path).query("PRAGMA user_version").get()).toEqual({ user_version: 5 }); // opening again changes nothing

    const newer = new Database(path);
    newer.exec("PRAGMA user_version = 99");
    newer.close();
    expect(() => openDb(path)).toThrow("newer BaseRouter");
  } finally {
    rmSync(dir, { recursive: true });
  }
});
