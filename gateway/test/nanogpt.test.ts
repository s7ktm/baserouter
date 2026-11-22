// NanoGPT as a provider, end to end over real HTTP against the fake NanoGPT: adding it, every
// kind of request, what each cost and where that was learned, and a video job from start to end.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as nanogpt from "../src/nanogpt.ts";
import { readPlain, StreamScanner } from "../src/usage.ts";
import { NANO_IDS, NANO_KEY, NANO_THROTTLED_KEY, nanoFixture } from "./fake-nanogpt.ts";
import { FAKE_KEY } from "./fake-openrouter.ts";
import { startGateway, until, type Gateway } from "./harness.ts";

let dir: string;
let gw: Gateway;
const open = (options: Parameters<typeof startGateway>[0] = {}) => (gw = startGateway({ mediaDir: dir, nanoKey: NANO_KEY, ...options }));
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), "baserouter-nano-"))));
afterEach(async () => {
  await gw.stop();
  rmSync(dir, { recursive: true, force: true });
});

// A model in BaseRouter that comes from NanoGPT, and a route that may use it.
function model(name: string, at = name, via: string | null = null, then: { provider: string; model: string; via: null }[] = []) {
  gw.store.addModel({ id: `m-${name}`, name, makes: [], places: [{ provider: "nanogpt", model: at, via }, ...then], created_at: 0 });
}
const post = (key: string, path: string, body: unknown) =>
  fetch(`${gw.url}/v1${path}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = (key: string, path: string) => fetch(`${gw.url}/v1${path}`, { headers: { Authorization: `Bearer ${key}` } });
const sentTo = (path: string) => gw.nano.posts.filter((p) => p.path === path).map((p) => JSON.parse(new TextDecoder().decode(p.body)) as Record<string, unknown>);

async function signIn(): Promise<Record<string, string>> {
  const res = await fetch(`${gw.url}/api/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "a test password" }) });
  return { Authorization: `Bearer ${((await res.json()) as { token: string }).token}` };
}
const api = (auth: Record<string, string>, method: string, path: string, body?: unknown) =>
  fetch(`${gw.url}/api${path}`, { method, headers: { ...auth, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });

test("NanoGPT is added beside OpenRouter after its key is tested, once", async () => {
  open({ nanoKey: undefined });
  const auth = await signIn();
  const wrong = await api(auth, "POST", "/providers", { kind: "nanogpt", key: "not-the-key" });
  expect(wrong.status).toBe(422);
  expect(((await wrong.json()) as { error: { message: string } }).error.message).toBe("Invalid Authentication");

  const added = await api(auth, "POST", "/providers", { kind: "nanogpt", key: NANO_KEY });
  expect(added.status).toBe(201);
  // Its four lists, without the paused model and the sound model that has no endpoint here.
  expect(((await added.json()) as { provider: unknown }).provider).toMatchObject({ kind: "nanogpt", name: "NanoGPT", status: "up", models: 11 });
  expect(gw.store.providers().map((p) => p.kind)).toEqual(["openrouter", "nanogpt"]);

  expect((await api(auth, "POST", "/providers", { kind: "nanogpt", key: NANO_KEY })).status).toBe(409);
  expect((await api(auth, "POST", "/providers", { kind: "openai", key: "x" })).status).toBe(400);
});

test("what NanoGPT offers: four lists joined, what each makes, prices per token", async () => {
  open();
  const auth = await signIn();
  const { offers } = (await (await api(auth, "GET", "/offers")).json()) as { offers: { id: string; provider: string; makes: string[]; in: number | null; out: number | null; perSecond: number | null }[] };
  const nano = offers.filter((o) => o.provider === "nanogpt");
  expect(offers.filter((o) => o.provider === "openrouter")).toHaveLength(3);
  expect(nano.map((o) => [o.id, o.makes[0]])).toEqual([
    ["openai/gpt-4.1-nano", "text"], ["moonshotai/kimi-k2.5", "text"], ["gemini-2.5-flash-lite", "text"],
    ["nano-banana-2", "image"], ["rev-animated", "image"],
    ["pruna-ai/p-video/text-to-video", "video"], ["kling-lipsync-t2v", "video"], ["lucy-edit-dev", "video"],
    ["Kokoro-82m", "speech"], ["Whisper-Large-V3", "transcription"], ["elevenlabs/music", "speech"],
  ]);
  // NanoGPT lists dollars per million tokens; the gateway gives dollars per token everywhere.
  expect(nano[0]).toMatchObject({ in: 1e-7, out: 4e-7 });
  expect(nano.find((o) => o.id === "pruna-ai/p-video/text-to-video")!.perSecond).toBe(0.02);
  expect(nano.find((o) => o.id === "lucy-edit-dev")!.perSecond).toBe(0.03);
  expect(nano.find((o) => o.id === "kling-lipsync-t2v")!.perSecond).toBeNull();
});

test("a model's own providers at NanoGPT, for models that can be pinned to one", async () => {
  open();
  const auth = await signIn();
  const asked = async (id: string) => ((await (await api(auth, "GET", `/offers/endpoints?provider=nanogpt&model=${encodeURIComponent(id)}`)).json()) as { providers: Record<string, unknown>[] }).providers;
  const list = await asked("moonshotai/kimi-k2.5");
  expect(list.map((p) => [p.tag, p.up])).toEqual([["meganova", true], ["moonshot", false], ["tensorix", false]]);
  // Per thousand tokens at NanoGPT, per token here.
  expect(list[0]).toMatchObject({ name: "MegaNova", in: 4.725e-7, out: 0.0000023625, context: 262144 });
  expect(await asked("openai/gpt-4.1-nano")).toEqual([]);
  // A source at NanoGPT may name one, as one at OpenRouter may.
  const made = await api(auth, "POST", "/models", { from: [{ provider: "nanogpt", model: "moonshotai/kimi-k2.5", via: "meganova" }] });
  expect(made.status).toBe(201);
});

test("chat goes to NanoGPT's address as written, and its cost and request id are recorded", async () => {
  open();
  model("openai/gpt-4.1-nano");
  const route = gw.addRoute({ allow: ["openai/gpt-4.1-nano"] });
  const body = { model: "openai/gpt-4.1-nano", messages: [{ role: "user", content: "Say hello in three words." }] };
  const res = await gw.chat(route.key, body);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(await nanoFixture("chat.json").json());
  expect(sentTo("/api/v1/chat/completions")).toEqual([body]);
  expect(gw.nano.posts[0]!.key).toBe(NANO_KEY);
  expect(gw.fake.posts).toHaveLength(0);
  expect(gw.lastRequest()).toMatchObject({
    provider_id: "nanogpt", kind: "chat", model_served: "openai/gpt-4.1-nano", prompt_tokens: 13, completion_tokens: 6,
    cost_usd: 0.0000037, cost_source: "provider", upstream_id: NANO_IDS.chat, failure: null,
  });
  await gw.settled();
  expect(gw.nano.lookups).toEqual([]); // the cost was in the answer
});

test("a stream's cost is read from the last chunk, though the client did not ask for usage", async () => {
  open();
  model("openai/gpt-4.1-nano");
  const route = gw.addRoute();
  const res = await gw.chat(route.key, { model: "openai/gpt-4.1-nano", messages: [{ role: "user", content: "hi" }], stream: true });
  expect(await res.text()).toBe(await nanoFixture("chat-stream.sse").text());
  await until(() => gw.lastRequest() !== null);
  expect(gw.lastRequest()).toMatchObject({ streamed: 1, prompt_tokens: 13, completion_tokens: 6, cost_usd: 0.0000037, cost_source: "provider", upstream_id: NANO_IDS.chat });
  expect(gw.lastRequest()!.first_token_ms).not.toBeNull();
  // The body went on as the client wrote it: the gateway did not ask for usage on its behalf.
  expect(sentTo("/api/v1/chat/completions")[0]).not.toHaveProperty("stream_options");
});

test("a cost that is an estimate, or not in dollars, is not recorded as the cost", async () => {
  const chat = (await nanoFixture("chat.json").json()) as Record<string, any>;
  expect(readPlain(chat)).toMatchObject({ requestId: NANO_IDS.chat, usage: { cost: 0.0000037 } });
  // Paid from a Nano balance: the amount is in XNO; the pricing still says it in dollars.
  const nano = structuredClone(chat);
  nano.usage.currency = "XNO";
  nano.usage.cost = 0.004;
  expect(readPlain(nano).usage!.cost).toBe(0.0000037);
  delete nano.x_nanogpt_pricing.costUsd;
  nano.x_nanogpt_pricing.currency = "XNO";
  expect(readPlain(nano).usage!.cost).toBeNull();
  // Billing had not finished: what the answer names is a guess.
  const guess = structuredClone(chat);
  delete guess.usage.cost;
  guess.x_nanogpt_pricing.isEstimate = true;
  expect(readPlain(guess)).toMatchObject({ usage: { promptTokens: 13, completionTokens: 6, cost: null }, estimate: 0.0000037 });
  expect(readPlain(chat).estimate).toBeNull();
  const scanner = new StreamScanner();
  scanner.feed(new TextEncoder().encode(await nanoFixture("chat-stream-usage.sse").text()), 1);
  scanner.end(2);
  expect(scanner).toMatchObject({ done: true, requestId: NANO_IDS.chat, usage: { promptTokens: 13, completionTokens: 8, cost: 0.0000045 } });
});

test("a plain answer that came before the charge was known counts as its estimate until the charge is asked for", async () => {
  open();
  model("fixture/estimate");
  const route = gw.addRoute();
  const res = await gw.chat(route.key, { model: "fixture/estimate", messages: [{ role: "user", content: "hi" }] });
  expect(res.status).toBe(200);
  expect(gw.lastRequest()).toMatchObject({ cost_usd: 0.000004, cost_source: "computed", upstream_id: NANO_IDS.chat });
  await gw.settled();
  expect(gw.nano.lookups).toEqual([NANO_IDS.chat]);
  expect(gw.lastRequest()).toMatchObject({ cost_usd: 0.0000037, cost_source: "provider" });
});

test("an image: the account's balance stays here, and the cost is checked against what was charged", async () => {
  open();
  model("rev-animated");
  const route = gw.addRoute();
  const res = await post(route.key, "/images/generations", { model: "rev-animated", prompt: "a small red cube" });
  const answer = (await res.json()) as Record<string, unknown>;
  expect(answer).not.toHaveProperty("remainingBalance");
  expect(answer).toMatchObject({ cost: 0.0017, requestId: NANO_IDS.image });
  expect(gw.nano.posts[0]!.path).toBe("/api/v1/images/generations");
  // The answer named the list price; the charge NanoGPT recorded was higher, and is what counts.
  expect(gw.lastRequest()).toMatchObject({ kind: "image", cost_usd: 0.0017, upstream_id: NANO_IDS.image });
  await gw.settled();
  expect(gw.nano.lookups).toEqual([NANO_IDS.image]);
  expect(gw.lastRequest()).toMatchObject({ cost_usd: 0.00255, cost_source: "provider" });
  expect(readdirSync(dir).filter((f) => f.endsWith(".png"))).toHaveLength(1);

  const linked = (await (await post(route.key, "/images/generations", { model: "rev-animated", prompt: "a ball", response_format: "url" })).json()) as { data: Record<string, unknown>[] };
  expect(Object.keys(linked.data[0]!)).toEqual(["url"]);
  await gw.settled();
});

test("speech says nothing of its cost, so it is worked out from the characters and recorded as that", async () => {
  open();
  model("Kokoro-82m");
  const route = gw.addRoute();
  const input = "Hello from the gateway test.";
  const res = await post(route.key, "/audio/speech", { model: "Kokoro-82m", input, voice: "af_bella" });
  expect(res.headers.get("content-type")).toBe("audio/mp3");
  expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  await gw.settled();
  expect(gw.lastRequest()).toMatchObject({ kind: "speech", provider_id: "nanogpt", cost_source: "computed", upstream_id: null });
  expect(gw.lastRequest()!.cost_usd).toBeCloseTo((input.length * 0.0017) / 1000, 12);
  expect(gw.nano.lookups).toEqual([]);
  expect(readdirSync(dir).filter((f) => f.endsWith(".mp3"))).toHaveLength(1);
});

test("a transcription's cost is in its answer", async () => {
  open();
  model("Whisper-Large-V3");
  const route = gw.addRoute();
  const res = await post(route.key, "/audio/transcriptions", { model: "Whisper-Large-V3", input_audio: { data: "AAAA", format: "mp3" } });
  expect(((await res.json()) as { text: string }).text).toContain("Hello");
  expect(gw.nano.posts[0]!.path).toBe("/api/v1/audio/transcriptions");
  expect(gw.lastRequest()).toMatchObject({ kind: "transcription", cost_usd: 0.001, cost_source: "provider" });
});

type Job = { id: string; status: string; polling_url: string; unsigned_urls?: string[]; usage?: { cost: number | null }; error?: string };

test("a video job at NanoGPT looks like any video job: started, asked about, fetched, kept", async () => {
  open();
  model("cheap-video", "pruna-ai/p-video/text-to-video");
  const route = gw.addRoute();
  const res = await post(route.key, "/videos", { model: "cheap-video", prompt: "a red ball rolling", duration: 1, resolution: "720p" });
  expect(res.status).toBe(202);
  const job = (await res.json()) as Job;
  expect(job).toEqual({ id: NANO_IDS.video, polling_url: `${gw.url}/v1/videos/${NANO_IDS.video}`, status: "pending" });
  // NanoGPT's own fields, with its id for the model and the seconds as a string.
  expect(sentTo("/api/generate-video")).toEqual([{ model: "pruna-ai/p-video/text-to-video", prompt: "a red ball rolling", duration: "1", resolution: "720p" }]);
  // The cost is known when the job starts.
  expect(gw.lastRequest()).toMatchObject({ kind: "video", provider_id: "nanogpt", cost_usd: 0.015, cost_source: "provider" });
  expect(gw.store.videoJob(job.id)).toMatchObject({ provider_id: "nanogpt", route_id: route.id });

  // The gateway watches the job itself, and keeps the video once it is made.
  await until(() => gw.store.videoJob(job.id)!.done_at !== null);
  await gw.settled();
  expect(gw.store.videoJob(job.id)!.status).toBe("completed");
  expect(gw.lastRequest()).toMatchObject({ cost_usd: 0.015, failure: null });
  expect(readdirSync(dir).filter((f) => f.endsWith(".mp4"))).toHaveLength(1);

  const done = (await (await get(route.key, `/videos/${job.id}`)).json()) as Job;
  expect(done).toEqual({ id: job.id, polling_url: `${gw.url}/v1/videos/${job.id}`, status: "completed", unsigned_urls: [`${gw.url}/v1/videos/${job.id}/content?index=0`], usage: { cost: 0.015 } });
  const video = await get(route.key, `/videos/${job.id}/content?index=0`);
  expect(video.headers.get("content-type")).toBe("video/mp4");
  expect((await video.arrayBuffer()).byteLength).toBeGreaterThan(100);
  expect((await get(route.key, `/videos/${job.id}/content?index=1`)).status).toBe(404);

  // Another route cannot see the job.
  expect((await get(gw.addRoute().key, `/videos/${job.id}`)).status).toBe(404);
});

test("a video job that fails costs nothing after all", async () => {
  open();
  model("fixture/video-fails");
  const route = gw.addRoute();
  const job = (await (await post(route.key, "/videos", { model: "fixture/video-fails", prompt: "x y" })).json()) as Job;
  expect(gw.lastRequest()!.cost_usd).toBe(0.015);
  await until(() => gw.store.videoJob(job.id)!.done_at !== null);
  expect(gw.lastRequest()).toMatchObject({ cost_usd: 0, failure: "upstream_error" });
  const answer = (await (await get(route.key, `/videos/${job.id}`)).json()) as Job;
  expect(answer).toMatchObject({ status: "failed", error: "Content flagged as inappropriate. Please modify your prompt and try again." });
  expect(answer).not.toHaveProperty("unsigned_urls");
});

test("a video is fetched with the key from NanoGPT and without it from where NanoGPT sends on", async () => {
  const calls: { url: string; auth: string | null }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    if (url.startsWith("https://api.nano.example/")) return new Response(null, { status: 302, headers: { Location: "https://storage.example/video/account/file.mp4?X-Amz-Signature=s" } });
    return new Response("video", { headers: { "Content-Type": "video/mp4" } });
  }) as typeof fetch;
  const up = { baseUrl: "https://api.nano.example/api", fetch: fetcher };
  const res = await nanogpt.videoContent(up, "the-key", "/api/generate-video/content?runId=vid_1&model=m&variant=video-0");
  expect(await res.text()).toBe("video");
  expect(calls).toEqual([
    { url: "https://api.nano.example/api/generate-video/content?runId=vid_1&model=m&variant=video-0", auth: "Bearer the-key" },
    { url: "https://storage.example/video/account/file.mp4?X-Amz-Signature=s", auth: null },
  ]);
  // A redirect into the local network is not followed.
  const inward = { baseUrl: "https://api.nano.example/api", fetch: (async () => new Response(null, { status: 302, headers: { Location: "http://192.168.1.1/x" } })) as unknown as typeof fetch };
  expect((await nanogpt.videoContent(inward, "the-key", "/api/generate-video/content?runId=vid_1")).status).toBe(502);
  // Nor is a link that points there to begin with.
  calls.length = 0;
  expect((await nanogpt.videoContent(up, "the-key", "http://127.0.0.1:8080/video.mp4")).status).toBe(502);
  expect(calls).toEqual([]);
});

test("NanoGPT's two ways of describing a job are read the same", () => {
  expect(nanogpt.readVideo({ runId: "vid_1", id: "vid_1", status: "pending", cost: 0.01 })).toEqual({ id: "vid_1", status: "pending", links: [], error: null });
  expect(nanogpt.readVideo({ requestId: "vid_1", data: { status: "IN_QUEUE", request_id: "vid_1" } })!.status).toBe("pending");
  expect(nanogpt.readVideo({ data: { status: "COMPLETED", request_id: "vid_1", output: { video: { url: "/a" } } } })).toEqual({ id: "vid_1", status: "completed", links: ["/a"], error: null });
  expect(nanogpt.readVideo({ data: { status: "CANCELED", request_id: "vid_1" } })!.status).toBe("cancelled");
  // The shape NanoGPT's OpenAPI file describes, should it ever be sent.
  expect(nanogpt.readVideo({ requestId: "vid_1", status: "completed", videoUrl: "/b" })).toEqual({ id: "vid_1", status: "completed", links: ["/b"], error: null });
  expect(nanogpt.readVideo({ error: "Video generation request not found" })).toBeNull();
});

test("when NanoGPT cannot serve a model, its next source takes over", async () => {
  open();
  model("kimi", "moonshotai/kimi-k2.5", "fixture-down", [{ provider: "openrouter", model: "openai/gpt-5-mini", via: null }]);
  const route = gw.addRoute({ allow: ["kimi"] });
  const res = await gw.chat(route.key, { model: "kimi", messages: [{ role: "user", content: "hi" }] });
  expect(res.status).toBe(200);
  expect(sentTo("/api/v1/chat/completions")[0]).toMatchObject({ model: "moonshotai/kimi-k2.5", provider: { only: ["fixture-down"] } });
  expect(gw.fake.chats).toHaveLength(1);
  expect(gw.lastRequest()).toMatchObject({ provider_id: "openrouter", model_requested: "kimi", model_served: "openai/gpt-5-mini" });
});

test("a key NanoGPT has stopped checking is the provider's problem, not the client's, and no other source is tried", async () => {
  open({ nanoKey: NANO_THROTTLED_KEY });
  model("kimi", "moonshotai/kimi-k2.5", null, [{ provider: "openrouter", model: "openai/gpt-5-mini", via: null }]);
  const route = gw.addRoute();
  const res = await gw.chat(route.key, { model: "kimi", messages: [{ role: "user", content: "hi" }] });
  expect(res.status).toBe(502);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("provider_refused_key");
  expect(gw.fake.chats).toHaveLength(0);
  expect(gw.store.provider("nanogpt")).toMatchObject({ status: "down" });
  expect(gw.lastRequest()).toMatchObject({ status: 429, failure: "upstream_error" });
});

test("the model list names each model as its own provider describes it, in one shape", async () => {
  open();
  model("fast", "openai/gpt-4.1-nano");
  model("rev-animated");
  gw.store.addModel({ id: "m-or", name: "openai/gpt-5-mini", makes: [], places: [{ provider: "openrouter", model: "openai/gpt-5-mini", via: null }], created_at: 0 });
  const route = gw.addRoute({ allow: ["fast", "openai/gpt-5-mini", "rev-animated"] });
  const list = (await (await get(route.key, "/models")).json()) as { data: Record<string, any>[] };
  expect(list.data.map((m) => m.id)).toEqual(["fast", "openai/gpt-5-mini", "rev-animated"]);
  // Dollars per token, as a string, the way OpenRouter's entries have it.
  expect(list.data[0]).toMatchObject({ name: "GPT 4.1 Nano", context_length: 1047576, pricing: { prompt: "0.0000001", completion: "0.0000004" }, architecture: { output_modalities: ["text"] } });
  expect(list.data[1]!.pricing.prompt).toBe("0.00000025");
  expect(list.data[2]!.architecture.output_modalities).toEqual(["image"]);
  // Asking for image models: OpenRouter filters its own, the gateway filters NanoGPT's.
  const images = (await (await get(route.key, "/models?output_modalities=image")).json()) as { data: { id: string }[] };
  expect(images.data.map((m) => m.id)).toContain("rev-animated");
  expect(images.data.map((m) => m.id)).not.toContain("fast");
});

test("NanoGPT alone: a route that may use any model reaches NanoGPT's by their own ids", async () => {
  open({ providerKey: null });
  const route = gw.addRoute();
  const res = await gw.chat(route.key, { model: "openai/gpt-4.1-nano", messages: [{ role: "user", content: "hi" }] });
  expect(res.status).toBe(200);
  expect(gw.lastRequest()).toMatchObject({ provider_id: "nanogpt", cost_usd: 0.0000037 });
  const list = (await (await get(route.key, "/models")).json()) as { data: { id: string }[] };
  expect(list.data).toHaveLength(11);
  const videos = (await (await get(route.key, "/videos/models")).json()) as { data: { id: string; pricing?: unknown }[] };
  expect(videos.data.map((m) => m.id)).toEqual(["pruna-ai/p-video/text-to-video", "kling-lipsync-t2v", "lucy-edit-dev"]);
  expect(FAKE_KEY).toBeTruthy();
});
