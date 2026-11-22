// Against the real NanoGPT. Skipped unless NANOGPT_API_KEY is set; costs a fraction of a
// cent. From this folder, with the key in the repository's .env:
//   bun --env-file=../.env test live-nanogpt
// The key is only ever handed to the gateway; it is never printed.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as nanogpt from "../src/nanogpt.ts";
import { startGateway, until } from "./harness.ts";

const key = process.env.NANOGPT_API_KEY;
const model = process.env.BASEROUTER_LIVE_NANOGPT_MODEL ?? "openai/gpt-4.1-nano";
const live = test.skipIf(!key);
const real = { baseUrl: "https://api.nano-gpt.com/api", fetch };

const dir = mkdtempSync(join(tmpdir(), "baserouter-live-nano-"));
const gw = startGateway({ nanogpt: real, providerKey: null, nanoKey: key ?? "none", mediaDir: dir });
gw.deps.costLookupDelays = [3_000, 6_000];
gw.deps.videoPollDelays = [5_000];
afterAll(async () => {
  await gw.stop();
  rmSync(dir, { recursive: true, force: true });
});

const hello = (extra: object = {}) => ({ model, messages: [{ role: "user", content: "Reply with the single word: ok" }], ...extra });
const post = (routeKey: string, path: string, body: unknown) =>
  fetch(`${gw.url}/v1${path}`, { method: "POST", headers: { Authorization: `Bearer ${routeKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

live("the key is accepted and NanoGPT's four lists are joined", async () => {
  const result = await nanogpt.check(real, key!);
  expect(result.ok).toBe(true);
  expect(result.ok && result.models).toBeGreaterThan(500);
  const route = gw.addRoute();
  const list = (await (await fetch(`${gw.url}/v1/models`, { headers: { Authorization: `Bearer ${route.key}` } })).json()) as { data: { id: string }[] };
  expect(list.data.map((m) => m.id)).toContain(model);
}, 60_000);

live("a plain completion is recorded with the cost NanoGPT reports, at once or once the charge is known", async () => {
  const route = gw.addRoute();
  const res = await gw.chat(route.key, hello());
  expect(res.status).toBe(200);
  const body = (await res.json()) as { usage: { cost?: number }; x_nanogpt_pricing: { cost: number; isEstimate?: boolean } };
  // An answer that did not wait for billing carries an estimate, which counts until the charge is asked for.
  const early = gw.lastRequest()!;
  expect(early).toMatchObject({ provider_id: "nanogpt", streamed: 0, status: 200, failure: null, cost_usd: body.usage.cost ?? body.x_nanogpt_pricing.cost });
  expect(early.cost_source).toBe(body.usage.cost === undefined ? "computed" : "provider");
  expect(early.upstream_id).toStartWith("req_");
  await gw.settled();
  expect(gw.lastRequest()!.cost_usd).toBeGreaterThan(0);
  if (body.usage.cost === undefined) expect(gw.lastRequest()!.cost_source).toBe("provider");
}, 120_000);

live("a streamed completion records its cost from the stream, without asking for usage", async () => {
  const route = gw.addRoute();
  const res = await gw.chat(route.key, hello({ stream: true }));
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  expect((await res.text()).trimEnd().endsWith("data: [DONE]")).toBe(true);
  await until(() => gw.lastRequest()?.streamed === 1);
  const row = gw.lastRequest()!;
  expect(row).toMatchObject({ streamed: 1, status: 200, failure: null, cost_source: "provider" });
  expect(row.cost_usd).toBeGreaterThan(0);
  expect(row.prompt_tokens).toBeGreaterThan(0);
  expect(gw.deps.background.size).toBe(0); // the cost came from the stream, not from a later lookup
}, 60_000);

// An image, a sentence of speech and its transcription cost more than the requests above,
// so they only run when asked:
//   BASEROUTER_LIVE_MEDIA=1 bun --env-file=../.env test live-nanogpt
const media = test.skipIf(!key || !process.env.BASEROUTER_LIVE_MEDIA);
const imageModel = process.env.BASEROUTER_LIVE_NANOGPT_IMAGE_MODEL ?? "rev-animated";
const speechModel = process.env.BASEROUTER_LIVE_NANOGPT_SPEECH_MODEL ?? "Kokoro-82m";
const transcribeModel = process.env.BASEROUTER_LIVE_NANOGPT_TRANSCRIBE_MODEL ?? "Whisper-Large-V3";

media("an image is kept, says nothing about the account, and its cost is NanoGPT's record of the charge", async () => {
  const route = gw.addRoute();
  const res = await post(route.key, "/images/generations", { model: imageModel, prompt: "a small red cube on a white table", size: "512x512" });
  expect(res.status).toBe(200);
  const answer = (await res.json()) as { cost: number; data: { b64_json?: string }[]; remainingBalance?: unknown };
  expect(answer.remainingBalance).toBeUndefined();
  expect(answer.data[0]!.b64_json!.length).toBeGreaterThan(1000);
  expect(gw.lastRequest()).toMatchObject({ kind: "image", cost_usd: answer.cost, cost_source: "provider" });
  await gw.settled();
  expect(gw.lastRequest()!.cost_usd).toBeGreaterThanOrEqual(answer.cost);
  expect(gw.store.media({ kind: "image", limit: 1 })[0]).toMatchObject({ route_id: route.id });
}, 120_000);

media("speech is kept and its cost worked out; its transcription says its own cost", async () => {
  const route = gw.addRoute();
  const said = "Hello from the gateway test.";
  const res = await post(route.key, "/audio/speech", { model: speechModel, input: said, voice: "af_bella" });
  expect(res.status).toBe(200);
  const sound = new Uint8Array(await res.arrayBuffer());
  expect(sound.length).toBeGreaterThan(1000);
  await gw.settled();
  expect(gw.lastRequest()).toMatchObject({ kind: "speech", cost_source: "computed", failure: null });
  expect(gw.lastRequest()!.cost_usd).toBeGreaterThan(0);
  expect(gw.store.media({ kind: "audio", limit: 1 })[0]).toMatchObject({ route_id: route.id, bytes: sound.length });

  const form = new FormData();
  form.append("file", new Blob([sound]), "hello.wav");
  form.append("model", transcribeModel);
  const heard = await fetch(`${gw.url}/v1/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${route.key}` }, body: form });
  expect(heard.status).toBe(200);
  expect(((await heard.json()) as { text: string }).text.toLowerCase()).toContain("hello");
  expect(gw.lastRequest()).toMatchObject({ kind: "transcription", cost_source: "provider" });
  expect(gw.lastRequest()!.cost_usd).toBeGreaterThan(0);
}, 120_000);

// A video costs more again, so it only runs when asked (one second, as a draft):
//   BASEROUTER_LIVE_VIDEO=1 bun --env-file=../.env test live-nanogpt
const video = test.skipIf(!key || !process.env.BASEROUTER_LIVE_VIDEO);
const videoModel = process.env.BASEROUTER_LIVE_NANOGPT_VIDEO_MODEL ?? "pruna-ai/p-video-2/text-to-video";

video("a video job is started, asked about until it is done, fetched, kept, and its cost recorded", async () => {
  const route = gw.addRoute();
  const auth = { Authorization: `Bearer ${route.key}` };
  const started = await post(route.key, "/videos", { model: videoModel, prompt: "A paper boat drifting on a calm pond, morning light.", duration: 1, resolution: "720p", draft: true });
  expect(started.status).toBe(202);
  const job = (await started.json()) as { id: string; polling_url: string; status: string };
  expect(job).toEqual({ id: job.id, polling_url: `${gw.url}/v1/videos/${job.id}`, status: "pending" });
  const startCost = gw.lastRequest()!.cost_usd!;
  expect(startCost).toBeGreaterThan(0);

  let done: { status: string; unsigned_urls?: string[]; usage?: { cost: number } } = { status: "pending" };
  const deadline = Date.now() + 240_000;
  while (!["completed", "failed", "cancelled", "expired"].includes(done.status) && Date.now() < deadline) {
    await Bun.sleep(4_000);
    done = (await (await fetch(job.polling_url, { headers: auth })).json()) as typeof done;
  }
  expect(done).toMatchObject({ status: "completed", unsigned_urls: [`${gw.url}/v1/videos/${job.id}/content?index=0`], usage: { cost: startCost } });

  const res = await fetch(done.unsigned_urls![0]!, { headers: auth });
  expect(res.headers.get("content-type")).toBe("video/mp4");
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(new TextDecoder().decode(bytes.subarray(4, 8))).toBe("ftyp");

  await gw.settled();
  expect(gw.lastRequest()).toMatchObject({ kind: "video", cost_usd: startCost, cost_source: "provider", failure: null, upstream_id: job.id });
  expect(gw.store.media({ kind: "video", limit: 1 })[0]).toMatchObject({ media_type: "video/mp4", bytes: bytes.length, route_id: route.id });
}, 300_000);
