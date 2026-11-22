// Models in BaseRouter: the name apps send, and the places it comes from, tried in order.
// A route only names the models it may use.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { providersOf } from "../src/catalogue.ts";
import { namesOf, parsePlaces } from "../src/models.ts";
import { MIGRATIONS, openDb, type ProviderRow } from "../src/store.ts";
import { fixture } from "./fake-openrouter.ts";
import { startGateway, type Gateway } from "./harness.ts";

let gw: Gateway;
beforeEach(() => void (gw = startGateway()));
afterEach(() => gw.stop());

const OR = "openrouter"; // the harness's provider
let made = 0;
function model(name: string, places: [string, string | null][]) {
  gw.store.addModel({ id: `m${++made}`, name, makes: ["text"], places: places.map(([model, via]) => ({ provider: OR, model, via })), created_at: made });
  return `m${made}`;
}
const hello = (model: string, extra: object = {}) => ({ model, messages: [{ role: "user", content: "Hello" }], ...extra });
const sent = () => gw.fake.chats.map((c) => JSON.parse(c.body) as { model: string; models?: string[]; provider?: Record<string, unknown> });

async function signIn() {
  const res = await fetch(`${gw.url}/api/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "a test password" }) });
  return { Authorization: `Bearer ${((await res.json()) as { token: string }).token}`, "Content-Type": "application/json" };
}
const call = async (auth: Record<string, string>, method: string, path: string, body?: unknown) => {
  const res = await fetch(`${gw.url}/api${path}`, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as Record<string, any>) };
};

test("a route's names: plain names, and the { model } objects of the branch before models", () => {
  expect(namesOf({ models: '["a/b", {"model": "c/d", "provider": "x"}, {"nope": 1}, "a/b"]' })).toEqual(["a/b", "c/d"]);
  const providers = [{ id: "or", kind: "openrouter" }, { id: "oa", kind: "openai" }] as ProviderRow[];
  expect(parsePlaces([{ provider: "or", model: "a/b", via: "google-vertex" }, { provider: "oa", model: "gpt-5-mini" }], providers)).toEqual([
    { provider: "or", model: "a/b", via: "google-vertex" }, { provider: "oa", model: "gpt-5-mini", via: null },
  ]);
  for (const bad of [[], [{ provider: "nope", model: "a/b" }], [{ provider: "oa", model: "x", via: "only-openrouter-has-these" }], [{ provider: "or", model: "a b" }],
    [{ provider: "or", model: "a/b" }, { provider: "or", model: "a/b" }]]) expect(parsePlaces(bad, providers)).toBeNull();
});

test("a model's places are tried in order, each with its own model id and OpenRouter provider", async () => {
  model("smart", [["anthropic/claude-sonnet-5.5", "fixture-down"], ["openai/gpt-5-mini", null]]);
  const route = gw.addRoute({ allow: ["smart"] });
  const res = await gw.chat(route.key, hello("smart", { provider: { sort: "price" } }));
  expect(res.status).toBe(200);
  expect(sent().map((b) => [b.model, b.provider])).toEqual([
    ["anthropic/claude-sonnet-5.5", { sort: "price", only: ["fixture-down"] }],
    ["openai/gpt-5-mini", { sort: "price" }],
  ]);
  expect(gw.store.requests({ limit: 10 })).toHaveLength(1);
  expect(gw.lastRequest()).toMatchObject({ model_requested: "smart", status: 200, failure: null });
});

test("when every place fails, the client gets the last answer and the request is recorded as failed", async () => {
  model("flaky", [["a/one", "fixture-down"], ["a/two", "fixture-down"]]);
  const route = gw.addRoute();
  expect((await gw.chat(route.key, hello("flaky"))).status).toBe(503);
  expect(sent()).toHaveLength(2);
  expect(gw.lastRequest()).toMatchObject({ status: 503, failure: "upstream_error" });
});

test("a model with one place at its own id is sent byte for byte; a name that is not a model goes to the provider as it is", async () => {
  model("openai/gpt-5-mini", [["openai/gpt-5-mini", null]]);
  const route = gw.addRoute();
  const written = `{"model":"openai/gpt-5-mini","messages":[{"role":"user","content":"Hello"}], "temperature": 0.5}`;
  await gw.chat(route.key, written);
  await gw.chat(route.key, hello("google/gemini-2.5-flash"));
  expect(gw.fake.chats[0]!.body).toBe(written);
  expect(sent()[1]!.model).toBe("google/gemini-2.5-flash");
});

test("a client's own fallback list is refused for a model that BaseRouter sends elsewhere", async () => {
  model("smart", [["openai/gpt-5-mini", null], ["anthropic/claude-sonnet-5.5", null]]);
  const route = gw.addRoute();
  const res = await gw.chat(route.key, hello("smart", { models: ["smart"] }));
  expect(res.status).toBe(400);
  expect(sent()).toEqual([]);
});

test("images fall back across places too, and a transcription form is sent with the place's model", async () => {
  model("pictures", [["recraft/recraft-v4.1-flash", "fixture-down"], ["recraft/recraft-v4.1-flash", null]]);
  model("ears", [["qwen/qwen3-asr-0.6b", null]]);
  const route = gw.addRoute();
  const post = (path: string, body: string | FormData, type?: string) =>
    fetch(`${gw.url}/v1${path}`, { method: "POST", headers: { Authorization: `Bearer ${route.key}`, ...(type ? { "Content-Type": type } : {}) }, body });
  expect((await post("/images/generations", JSON.stringify({ model: "pictures", prompt: "A circle." }), "application/json")).status).toBe(200);
  const images = gw.fake.posts.filter((p) => p.path === "/images").map((p) => JSON.parse(new TextDecoder().decode(p.body)));
  expect(images).toEqual([
    { model: "recraft/recraft-v4.1-flash", prompt: "A circle.", provider: { only: ["fixture-down"] } },
    { model: "recraft/recraft-v4.1-flash", prompt: "A circle." },
  ]);

  const form = new FormData();
  form.set("model", "ears");
  form.set("file", new File([new Uint8Array([73, 68, 51, 4])], "a.mp3", { type: "audio/mpeg" }));
  expect((await post("/audio/transcriptions", form)).status).toBe(200);
  const upload = gw.fake.posts.find((p) => p.path === "/audio/transcriptions")!;
  const received = await new Response(upload.body, { headers: { "Content-Type": upload.contentType! } }).formData();
  expect(received.get("model")).toBe("qwen/qwen3-asr-0.6b");
  expect((received.get("file") as File).size).toBe(4);
});

test("the model list speaks in BaseRouter's names; a route that may use any model also sees the provider's own list", async () => {
  model("fast", [["google/gemini-2.5-flash", null]]);
  const limited = gw.addRoute({ allow: ["fast", "openai/gpt-5-mini", "not/there"] });
  const open = gw.addRoute();
  const ids = async (key: string) => ((await (await fetch(`${gw.url}/v1/models`, { headers: { Authorization: `Bearer ${key}` } })).json()) as { data: { id: string; name?: string }[] }).data;
  const mine = await ids(limited.key);
  expect(mine.map((m) => m.id)).toEqual(["fast", "openai/gpt-5-mini"]);
  expect(mine[0]!.name).toBe("Google: Gemini 2.5 Flash"); // what the provider says about it
  expect((await ids(open.key)).map((m) => m.id)).toEqual(["fast", "openai/gpt-5-mini", "anthropic/claude-sonnet-5.5", "google/gemini-2.5-flash"]);
});

test("models are made, renamed (their routes follow), given places, and deleted (their routes lose them)", async () => {
  const auth = await signIn();
  const made = await call(auth, "POST", "/models", { from: [{ provider: OR, model: "openai/gpt-5-mini" }] });
  expect(made.status).toBe(201);
  expect(made.body!.model).toMatchObject({ name: "openai/gpt-5-mini", from: [{ provider: OR, model: "openai/gpt-5-mini", via: null }] });
  const id = made.body!.model.id as string;

  const route = await call(auth, "POST", "/routes", { name: "Agent", budget: 5, models: ["openai/gpt-5-mini"] });
  const routeId = route.body!.route.id as string;
  expect((await call(auth, "POST", "/models", { name: "openai/gpt-5-mini", from: [{ provider: OR, model: "x/y" }] })).status).toBe(400); // name taken
  expect((await call(auth, "POST", "/models", { from: [{ provider: "nope", model: "x/y" }] })).status).toBe(400);

  // A source changed in place, its name unchanged; the kind follows the provider's list once it is known.
  await call(auth, "GET", "/offers");
  const changed = await call(auth, "PATCH", `/models/${id}`, { from: [{ provider: OR, model: "google/gemini-2.5-flash" }] });
  expect(changed.body!.model).toMatchObject({ name: "openai/gpt-5-mini", makes: ["text"], from: [{ model: "google/gemini-2.5-flash" }] });

  const renamed = await call(auth, "PATCH", `/models/${id}`, { name: "mini", from: [{ provider: OR, model: "openai/gpt-5-mini", via: "azure" }, { provider: OR, model: "openai/gpt-5-mini" }] });
  expect(renamed.body!.model).toMatchObject({ name: "mini", from: [{ via: "azure" }, { via: null }] });
  expect((await call(auth, "GET", "/routes")).body!.routes.find((r: { id: string }) => r.id === routeId).models).toEqual(["mini"]);

  // The app asks by the new name; the old one is refused on that route.
  const key = route.body!.key as string;
  expect((await gw.chat(key, hello("mini"))).status).toBe(200);
  expect(sent().at(-1)).toMatchObject({ model: "openai/gpt-5-mini", provider: { only: ["azure"] } });
  expect((await gw.chat(key, hello("openai/gpt-5-mini"))).status).toBe(403);

  expect((await call(auth, "DELETE", `/models/${id}`)).status).toBe(204);
  expect((await call(auth, "GET", "/routes")).body!.routes.find((r: { id: string }) => r.id === routeId).models).toEqual([]);
  expect((await call(auth, "GET", "/models")).body!.models).toEqual([]);
});

test("a database from before models gets a model for every name its routes list, at the first provider", () => {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const step of MIGRATIONS.slice(0, 6)) db.exec(step as string);
  db.exec(`PRAGMA user_version = 6;
    INSERT INTO providers (id, kind, name, key_sealed, key_hint, status, checked_at, created_at) VALUES ('or', 'openrouter', 'OpenRouter', 'x', 'abcd', 'up', 0, 0);
    INSERT INTO routes (id, name, key_hash, key_hint, budget_usd, models, created_at) VALUES ('r1', 'A', 'h1', '0000', 5, '["a/b", "c/d"]', 1);
    INSERT INTO routes (id, name, key_hash, key_hint, budget_usd, models, created_at) VALUES ('r2', 'B', 'h2', '0000', 5, '[{"model": "c/d", "provider": "x"}, {"model": "e/f", "provider": null}]', 2);
    INSERT INTO routes (id, name, key_hash, key_hint, budget_usd, models, created_at) VALUES ('r3', 'C', 'h3', '0000', 5, '[]', 3);`);
  const path = ":memory:";
  void path;
  const { migrate } = require("../src/store.ts") as typeof import("../src/store.ts");
  migrate(db);
  expect(db.query("SELECT name, places FROM models ORDER BY name").all()).toEqual([
    { name: "a/b", places: '[{"provider":"or","model":"a/b","via":null}]' },
    { name: "c/d", places: '[{"provider":"or","model":"c/d","via":null}]' },
    { name: "e/f", places: '[{"provider":"or","model":"e/f","via":null}]' },
  ]);
  expect(db.query("SELECT id, models FROM routes ORDER BY id").all()).toEqual([
    { id: "r1", models: '["a/b","c/d"]' }, { id: "r2", models: '["c/d","e/f"]' }, { id: "r3", models: "[]" },
  ]);
  expect(openDb(":memory:").query("SELECT COUNT(*) AS n FROM models").get()).toEqual({ n: 0 });
});

test("where a model comes from at OpenRouter: its endpoints list, with tier, prices and whether each works", async () => {
  const data = ((await fixture("model-endpoints.json").json()) as { data: unknown }).data;
  expect(providersOf(data).map((p) => [p.tag, p.tier, p.up])).toEqual([
    ["google-ai-studio/flex", "flex", true], ["google-ai-studio", null, true], ["google-ai-studio/priority", "priority", true], ["google-vertex", null, false],
  ]);
  const auth = await signIn();
  const answer = await call(auth, "GET", "/offers/endpoints?model=google/gemini-2.5-flash");
  expect(answer.body!.providers.map((p: { tag: string }) => p.tag)).toEqual(["google-ai-studio/flex", "google-ai-studio", "google-ai-studio/priority", "google-vertex"]);
  for (const bad of ["../../key", "a/../../key", "a/b/c", "a"]) expect((await call(auth, "GET", `/offers/endpoints?model=${encodeURIComponent(bad)}`)).status).toBe(400);
});
