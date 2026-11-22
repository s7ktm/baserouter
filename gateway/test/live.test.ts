// Against the real OpenRouter. Skipped unless OPENROUTER_API_KEY is set; costs a
// fraction of a cent. From this folder, with the key in the repository's .env:
//   bun --env-file=../.env test live
// The key is only ever handed to the gateway; it is never printed.
import { afterAll, expect, test } from "bun:test";
import { startGateway, until } from "./harness.ts";

const key = process.env.OPENROUTER_API_KEY;
const model = process.env.BASEROUTER_LIVE_MODEL ?? "openai/gpt-5-mini";
const live = test.skipIf(!key);

const gw = startGateway({ upstream: { baseUrl: "https://openrouter.ai/api/v1", fetch }, providerKey: key ?? null });
gw.deps.costLookupDelays = [2_000, 5_000];
afterAll(() => gw.stop());

const hello = (extra: object = {}) => ({ model, messages: [{ role: "user", content: "Reply with the single word: ok" }], ...extra });

live("a plain completion comes back and is recorded with the cost OpenRouter reports", async () => {
  const route = gw.addRoute({ allow: [model] });
  const res = await gw.chat(route.key, hello());
  expect(res.status).toBe(200);
  const body = (await res.json()) as { choices: { message: { content: string } }[]; usage: { cost: number } };
  expect(typeof body.choices[0]?.message.content).toBe("string");

  const row = gw.lastRequest()!;
  expect(row).toMatchObject({ route_id: route.id, streamed: 0, status: 200, failure: null, cost_source: "provider", cost_usd: body.usage.cost });
  expect(row.cost_usd).toBeGreaterThan(0);
  expect(row.prompt_tokens).toBeGreaterThan(0);
  expect(row.upstream_id).toStartWith("gen-");
}, 60_000);

live("a streamed completion ends with [DONE] and records its cost from the stream", async () => {
  const route = gw.addRoute();
  const res = await gw.chat(route.key, hello({ stream: true }));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const text = await res.text();
  expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);

  await until(() => gw.lastRequest()?.streamed === 1);
  const row = gw.lastRequest()!;
  expect(row).toMatchObject({ streamed: 1, status: 200, failure: null, cost_source: "provider" });
  expect(row.cost_usd).toBeGreaterThan(0);
  expect(row.first_token_ms).toBeGreaterThan(0);
  expect(gw.deps.background.size).toBe(0); // the cost came from the stream, not from a later lookup
}, 60_000);

live("the model list comes from OpenRouter", async () => {
  const route = gw.addRoute();
  const res = await fetch(`${gw.url}/v1/models`, { headers: { Authorization: `Bearer ${route.key}` } });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { data: unknown[] }).data.length).toBeGreaterThan(10);
}, 60_000);

live("a route over its budget is refused without reaching OpenRouter", async () => {
  const route = gw.addRoute({ budget_usd: 1 });
  gw.spend(route.id, 1);
  const before = gw.store.requests({ limit: 200 }).length;
  const res = await gw.chat(route.key, hello());
  expect(res.status).toBe(402);
  expect(gw.store.requests({ limit: 200 }).length).toBe(before);
});
