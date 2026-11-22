// A route's lines: each a model and where it comes from. When lines name providers, the gateway
// tries them in order itself, one request each, with OpenRouter's "only" for that provider.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { providersOf } from "../src/catalogue.ts";
import { attemptOrder, bodyFor, linesOf, parseLines } from "../src/lines.ts";
import { fixture } from "./fake-openrouter.ts";
import { startGateway, type Gateway } from "./harness.ts";

let gw: Gateway;
beforeEach(() => void (gw = startGateway()));
afterEach(() => gw.stop());

// A route whose lines are given as { model, provider }.
function routeWith(lines: { model: string; provider: string | null }[]) {
  const route = gw.addRoute();
  gw.store.updateRoute(route.id, { models: lines });
  return route;
}
const hello = (model: string, extra: object = {}) => ({ model, messages: [{ role: "user", content: "Hello" }], ...extra });
const sent = () => gw.fake.chats.map((c) => JSON.parse(c.body) as { model: string; models?: string[]; provider?: Record<string, unknown> });

test("old routes, whose models are plain ids, read as lines with no provider", () => {
  expect(linesOf({ models: '["a/b", {"model": "c/d", "provider": "x"}, {"nope": 1}]' })).toEqual([{ model: "a/b", provider: null }, { model: "c/d", provider: "x" }]);
  expect(parseLines(["a/b", { model: " c/d ", provider: "google-ai-studio/flex" }, { model: "c/d", provider: null }])).toEqual([
    { model: "a/b", provider: null }, { model: "c/d", provider: "google-ai-studio/flex" }, { model: "c/d", provider: null },
  ]);
  expect(attemptOrder(parseLines(["a/b", { model: "c/d", provider: "x" }, "c/d"])!, "c/d").map((l) => `${l.model}@${l.provider}`)).toEqual(["c/d@x", "c/d@null", "a/b@null"]);
  // The client's other wishes about providers stay; "only" is the line's.
  expect(JSON.parse(bodyFor({ model: "a/b", models: ["a/b"], provider: { sort: "price", only: ["y"] } }, { model: "c/d", provider: "x" }))).toEqual({ model: "c/d", provider: { sort: "price", only: ["x"] } });
});

test("a route that names no providers still sends one request with OpenRouter's fallback list", async () => {
  const route = routeWith([{ model: "openai/gpt-5-mini", provider: null }, { model: "google/gemini-2.5-flash", provider: null }]);
  expect((await gw.chat(route.key, hello("openai/gpt-5-mini"))).status).toBe(200);
  expect(sent()).toEqual([expect.objectContaining({ model: "openai/gpt-5-mini", models: ["openai/gpt-5-mini", "google/gemini-2.5-flash"] })]);
  expect(sent()[0]!.provider).toBeUndefined();
});

test("a route that names providers tries its lines one at a time, each with only its provider", async () => {
  const route = routeWith([
    { model: "google/gemini-2.5-flash", provider: "fixture-down" },
    { model: "google/gemini-2.5-flash", provider: "google-ai-studio" },
    { model: "openai/gpt-5-mini", provider: null },
  ]);
  const res = await gw.chat(route.key, hello("google/gemini-2.5-flash", { provider: { sort: "price" } }));
  expect(res.status).toBe(200);
  expect(sent()).toEqual([
    expect.objectContaining({ model: "google/gemini-2.5-flash", provider: { sort: "price", only: ["fixture-down"] } }),
    expect.objectContaining({ model: "google/gemini-2.5-flash", provider: { sort: "price", only: ["google-ai-studio"] } }),
  ]);
  expect(sent().every((b) => !("models" in b))).toBe(true);
  // One request from the client, one row.
  expect(gw.store.requests({ limit: 10 })).toHaveLength(1);
  expect(gw.lastRequest()).toMatchObject({ status: 200, failure: null });
});

test("the lines of the model asked for go first; a line with no provider sends the client's own wishes as they were", async () => {
  const route = routeWith([
    { model: "openai/gpt-5-mini", provider: "fixture-down" },
    { model: "google/gemini-2.5-flash", provider: "fixture-down" },
    { model: "openai/gpt-5-mini", provider: null },
  ]);
  expect((await gw.chat(route.key, hello("google/gemini-2.5-flash", { provider: { sort: "price" } }))).status).toBe(200);
  expect(sent().map((b) => [b.model, b.provider])).toEqual([
    ["google/gemini-2.5-flash", { sort: "price", only: ["fixture-down"] }],
    ["openai/gpt-5-mini", { sort: "price", only: ["fixture-down"] }],
    ["openai/gpt-5-mini", { sort: "price" }],
  ]);
});

test("when every line fails, the client gets the last answer, and the request is recorded as failed", async () => {
  const route = routeWith([{ model: "openai/gpt-5-mini", provider: "fixture-down" }, { model: "google/gemini-2.5-flash", provider: "fixture-down" }]);
  const res = await gw.chat(route.key, hello("openai/gpt-5-mini"));
  expect(res.status).toBe(503);
  expect(sent()).toHaveLength(2);
  expect(gw.lastRequest()).toMatchObject({ status: 503, failure: "upstream_error" });
});

test("a client's own fallback list is refused on a route that names providers", async () => {
  const route = routeWith([{ model: "openai/gpt-5-mini", provider: "azure" }]);
  const res = await gw.chat(route.key, hello("openai/gpt-5-mini", { models: ["openai/gpt-5-mini"] }));
  expect(res.status).toBe(400);
  expect(sent()).toEqual([]);
});

test("images, speech and video take the asked model's provider, without fallbacks", async () => {
  const route = routeWith([{ model: "recraft/recraft-v4.1-flash", provider: "recraft" }, { model: "recraft/recraft-v4.1-flash", provider: "other" }]);
  const res = await fetch(`${gw.url}/v1/images/generations`, {
    method: "POST", headers: { Authorization: `Bearer ${route.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "recraft/recraft-v4.1-flash", prompt: "A circle." }),
  });
  expect(res.status).toBe(200);
  const posted = gw.fake.posts.filter((p) => p.path === "/images");
  expect(posted).toHaveLength(1);
  expect(JSON.parse(new TextDecoder().decode(posted[0]!.body))).toEqual({ model: "recraft/recraft-v4.1-flash", prompt: "A circle.", provider: { only: ["recraft"] } });
});

test("the model list shows each of the route's models once", async () => {
  const route = routeWith([{ model: "google/gemini-2.5-flash", provider: "google-vertex" }, { model: "google/gemini-2.5-flash", provider: null }, { model: "openai/gpt-5-mini", provider: null }]);
  const res = await fetch(`${gw.url}/v1/models`, { headers: { Authorization: `Bearer ${route.key}` } });
  expect(((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id)).toEqual(["openai/gpt-5-mini", "google/gemini-2.5-flash"]);
});

test("a model's providers come from OpenRouter's endpoints list, with their tier, prices and whether they work", async () => {
  const data = ((await fixture("model-endpoints.json").json()) as { data: unknown }).data;
  expect(providersOf(data)).toEqual([
    { tag: "google-ai-studio/flex", name: "Google AI Studio", tier: "flex", in: 0.00000015, out: 0.00000125, context: 1048576, up: true },
    { tag: "google-ai-studio", name: "Google AI Studio", tier: null, in: 0.0000003, out: 0.0000025, context: 1048576, up: true },
    { tag: "google-ai-studio/priority", name: "Google AI Studio", tier: "priority", in: expect.any(Number), out: expect.any(Number), context: 1048576, up: true },
    { tag: "google-vertex", name: "Google Vertex", tier: null, in: 0.0000003, out: 0.0000025, context: 1048576, up: false },
  ]);
  const signIn = await fetch(`${gw.url}/api/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "a test password" }) });
  const auth = { Authorization: `Bearer ${((await signIn.json()) as { token: string }).token}` };
  const answer = (await (await fetch(`${gw.url}/api/models/providers?model=google/gemini-2.5-flash`, { headers: auth })).json()) as { providers: { tag: string }[] };
  expect(answer.providers.map((p) => p.tag)).toEqual(["google-ai-studio/flex", "google-ai-studio", "google-ai-studio/priority", "google-vertex"]);
  for (const bad of ["../../key", "a/../../key", "a/b/c", "a"]) expect((await fetch(`${gw.url}/api/models/providers?model=${encodeURIComponent(bad)}`, { headers: auth })).status).toBe(400);
});
