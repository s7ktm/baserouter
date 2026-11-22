// Against the real OpenRouter. Skipped unless OPENROUTER_API_KEY is set; costs a
// fraction of a cent. From this folder, with the key in the repository's .env:
//   bun --env-file=../.env test live
// The key is only ever handed to the gateway; it is never printed.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

live("when the first model of a route fails, OpenRouter answers with the next one", async () => {
  // openai/gpt-4o-mini cannot write 200,000 tokens, so it fails at once and the route's next
  // model answers. (An unknown model id is refused with 400 before any fallback.)
  const route = gw.addRoute({ allow: ["openai/gpt-4o-mini", model] });
  const res = await gw.chat(route.key, { model: "openai/gpt-4o-mini", max_tokens: 200_000, messages: [{ role: "user", content: "Reply with the single word: ok" }] });
  const body = (await res.json()) as { model?: string };
  expect(res.status).toBe(200);
  expect(body.model).toStartWith(model);
  const row = gw.lastRequest()!;
  expect(row).toMatchObject({ model_requested: "openai/gpt-4o-mini", failure: null, cost_source: "provider" });
  expect(row.model_served).toStartWith(model);
  expect(row.cost_usd).toBeGreaterThan(0);
}, 60_000);

// Images and sound cost more (about four cents for all three), so they only run when asked:
//   BASEROUTER_LIVE_MEDIA=1 bun --env-file=../.env test live
const media = test.skipIf(!key || !process.env.BASEROUTER_LIVE_MEDIA);

media("a streamed chat answer with an image records its cost from the stream", async () => {
  const route = gw.addRoute();
  const res = await gw.chat(route.key, { model: "google/gemini-3.1-flash-lite-image", modalities: ["image", "text"], stream: true, messages: [{ role: "user", content: "Draw a small blue circle." }] });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('"images":[{"type":"image_url","image_url":{"url":"data:image/');
  await until(() => gw.lastRequest()?.kind === "image");
  expect(gw.lastRequest()).toMatchObject({ streamed: 1, failure: null, cost_source: "provider" });
  expect(gw.lastRequest()!.cost_usd).toBeGreaterThan(0);
}, 120_000);

media("/images/generations answers with base64 and records its cost", async () => {
  const route = gw.addRoute();
  const res = await fetch(`${gw.url}/v1/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${route.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "recraft/recraft-v4.1-flash", prompt: "A small blue circle on white." }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { b64_json: string }[]; usage: { cost: number } };
  expect(body.data[0]!.b64_json.length).toBeGreaterThan(100);
  expect(gw.lastRequest()).toMatchObject({ kind: "image", cost_usd: body.usage.cost, cost_source: "provider" });
  expect(gw.lastRequest()!.upstream_id).toStartWith("gen-img-");
}, 120_000);

media("/audio/speech answers with sound, and its cost is asked for afterwards", async () => {
  const route = gw.addRoute();
  const res = await fetch(`${gw.url}/v1/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${route.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "hexgrad/kokoro-82m", input: "Hello from BaseRouter.", voice: "af_heart", response_format: "mp3" }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("audio/mpeg");
  expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  await until(() => gw.lastRequest()?.kind === "speech");
  await gw.settled();
  expect(gw.lastRequest()).toMatchObject({ cost_source: "provider", failure: null });
  expect(gw.lastRequest()!.cost_usd).toBeGreaterThan(0);
}, 120_000);

// A video costs more than the requests above, so it only runs when asked (one second at 480p):
//   BASEROUTER_LIVE_VIDEO=1 bun --env-file=../.env test live
// BASEROUTER_LIVE_VIDEO_MODEL picks the model; it must take "duration" 1 and "480p".
const video = test.skipIf(!key || !process.env.BASEROUTER_LIVE_VIDEO);
const videoModel = process.env.BASEROUTER_LIVE_VIDEO_MODEL ?? "x-ai/grok-imagine-video-1.5-lite";

video("a video job is started, asked about until it is done, fetched, kept, and its cost recorded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "baserouter-live-video-"));
  const vg = startGateway({ upstream: { baseUrl: "https://openrouter.ai/api/v1", fetch }, providerKey: key ?? null, mediaDir: dir });
  vg.deps.videoPollDelays = [5_000];
  try {
    const route = vg.addRoute({ allow: [videoModel] });
    const auth = { Authorization: `Bearer ${route.key}` };
    const started = await fetch(`${vg.url}/v1/videos`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ model: videoModel, prompt: "A paper boat drifting on a calm pond, morning light.", duration: 1, resolution: "480p", generate_audio: false }),
    });
    expect(started.status).toBe(202);
    const job = (await started.json()) as { id: string; polling_url: string };
    expect(job.id).toStartWith("gen-vid-");
    expect(job.polling_url).toBe(`${vg.url}/v1/videos/${job.id}`);

    // Asked about the way a client would, through the gateway.
    let done: { status: string; unsigned_urls?: string[]; urls?: unknown; usage?: { cost: number } } = { status: "pending" };
    const deadline = Date.now() + 240_000;
    while (!["completed", "failed", "cancelled", "expired"].includes(done.status) && Date.now() < deadline) {
      await Bun.sleep(4_000);
      done = (await (await fetch(job.polling_url, { headers: auth })).json()) as typeof done;
    }
    expect(done.status).toBe("completed");
    expect(done.urls).toBeUndefined();
    expect(done.usage!.cost).toBeGreaterThan(0);
    const link = done.unsigned_urls![0]!;
    expect(link).toStartWith(`${vg.url}/v1/videos/${job.id}/content`);

    const res = await fetch(link, { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(4, 8))).toBe("ftyp");

    await vg.settled();
    expect(vg.lastRequest()).toMatchObject({ kind: "video", cost_usd: done.usage!.cost, cost_source: "provider", failure: null, upstream_id: job.id });
    const [kept] = vg.store.media({ kind: "video", limit: 1 });
    expect(kept).toMatchObject({ media_type: "video/mp4", bytes: bytes.length, route_id: route.id });
  } finally {
    await vg.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}, 300_000);
