// Images, sound and files through the one address, end to end against the fake OpenRouter.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { fixture, fixtureBytes, IDS } from "./fake-openrouter.ts";
import { startGateway, until, type Gateway } from "./harness.ts";

let gw: Gateway;
beforeEach(() => void (gw = startGateway()));
afterEach(() => gw.stop());

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string; metadata?: Record<string, unknown> } }).error;

function post(path: string, key: string | null, body: string | Uint8Array | FormData, contentType: string | null = "application/json") {
  return fetch(`${gw.url}/v1${path}`, {
    method: "POST",
    headers: { ...(contentType ? { "Content-Type": contentType } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body,
  });
}

const imagePrompt = (extra: object = {}) => ({ model: "recraft/recraft-v4.1-flash", prompt: "A small blue circle on white.", ...extra });
const speech = (extra: object = {}) => ({ model: "hexgrad/kokoro-82m", input: "Hello from BaseRouter.", voice: "af_heart", response_format: "mp3", ...extra });

function transcriptionForm(model: string | null = "qwen/qwen3-asr-0.6b"): FormData {
  const form = new FormData();
  if (model) form.set("model", model);
  form.set("file", new File([new Uint8Array([73, 68, 51, 4, 0, 0, 1, 2, 3])], "speech.mp3", { type: "audio/mpeg" }));
  return form;
}

// A base64 string of about the given size, the way a file travels inside a request.
const base64Of = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64");

// 1. Images, PDFs and sound inside a chat request

test("a chat request with an image, a PDF and sound inside is sent on byte for byte, however large", async () => {
  const route = gw.addRoute();
  const sent = JSON.stringify({
    model: "openai/gpt-5-mini",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in these?" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${base64Of(4 << 20)}` } },
          { type: "file", file: { filename: "report.pdf", file_data: `data:application/pdf;base64,${base64Of(4 << 20)}` } },
          { type: "input_audio", input_audio: { data: base64Of(4 << 20), format: "wav" } },
        ],
      },
    ],
  });
  expect(sent.length).toBeGreaterThan(16 << 20);

  const res = await gw.chat(route.key, sent);
  expect(res.status).toBe(200);
  expect(gw.fake.chats).toHaveLength(1);
  expect(gw.fake.chats[0]!.body === sent).toBe(true); // not toEqual: a failure would print 16 MB
  expect(gw.lastRequest()).toMatchObject({ kind: "chat", cost_usd: 0.0000205, failure: null });
});

test("a request larger than the limit is refused before anything is sent, with or without a declared length", async () => {
  const small = startGateway({ maxRequestBytes: 1 << 20 });
  try {
    const route = small.addRoute();
    const big = JSON.stringify({ model: "openai/gpt-5-mini", messages: [{ role: "user", content: base64Of(1 << 20) }] });

    const declared = await small.chat(route.key, big);
    expect(declared.status).toBe(413);
    const error = await errorOf(declared);
    expect(error.code).toBe("request_too_large");
    expect(error.message).toBe("The request is larger than 1 MB, the most BaseRouter takes. Send smaller files, or raise BASEROUTER_MAX_REQUEST_MB.");
    expect(error.metadata).toEqual({ max_bytes: 1 << 20 });

    // Sent in pieces, without a Content-Length: counted as it arrives.
    const bytes = new TextEncoder().encode(big);
    const pieces = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 64 << 10) controller.enqueue(bytes.subarray(at, at + (64 << 10)));
        controller.close();
      },
    });
    const chunked = await fetch(`${small.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${route.key}`, "Content-Type": "application/json" },
      body: pieces,
    });
    expect(chunked.status).toBe(413);

    for (const path of ["/images/generations", "/audio/speech", "/audio/transcriptions"]) {
      const res = await fetch(`${small.url}/v1${path}`, { method: "POST", headers: { Authorization: `Bearer ${route.key}`, "Content-Type": "application/json" }, body: big });
      expect(res.status).toBe(413);
    }
    expect(small.fake.posts).toHaveLength(0);
    expect(small.lastRequest()).toBeNull();

    // Just under the limit goes through.
    expect((await small.chat(route.key, { model: "openai/gpt-5-mini", messages: [{ role: "user", content: base64Of(700 << 10) }] })).status).toBe(200);
  } finally {
    await small.stop();
  }
});

// 2. Images out of a chat request

test("a chat answer with an image comes back unchanged and is recorded as an image with its cost", async () => {
  const route = gw.addRoute();
  const res = await gw.chat(route.key, { model: "recraft/recraft-v4.1-flash", modalities: ["image"], messages: [{ role: "user", content: "A blue circle" }] });
  expect(res.status).toBe(200);
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(await fixtureBytes("chat-image.json"));
  expect(gw.lastRequest()).toMatchObject({
    kind: "image", model_served: "recraft/recraft-v4.1-flash", streamed: 0, prompt_tokens: 8, completion_tokens: 4175,
    cost_usd: 0.007, cost_source: "provider", failure: null, upstream_id: "gen-1795300005-FixtureChatImage0001",
  });
});

test("a streamed chat answer with an image is passed on byte for byte and records its cost", async () => {
  const route = gw.addRoute();
  const res = await gw.chat(route.key, { model: "google/gemini-3.1-flash-lite-image", modalities: ["image", "text"], stream: true, messages: [{ role: "user", content: "A blue circle" }] });
  expect(res.status).toBe(200);
  const received = new Uint8Array(await res.arrayBuffer());
  expect(received).toEqual(await fixtureBytes("chat-image-stream.sse"));
  expect(new TextDecoder().decode(received)).toContain('"images":[{"type":"image_url","image_url":{"url":"data:image/png;base64,');

  await until(() => gw.lastRequest() !== null);
  const row = gw.lastRequest()!;
  expect(row).toMatchObject({ kind: "image", streamed: 1, prompt_tokens: 13, completion_tokens: 1120, cost_usd: 0.03360325, cost_source: "provider", failure: null });
  expect(row.first_token_ms).not.toBeNull(); // the chunk with the image
  expect(gw.fake.lookups).toEqual([]);
});

test("a chat request asking for sound is recorded as speech", async () => {
  const route = gw.addRoute();
  await (await gw.chat(route.key, { model: "openai/gpt-audio", modalities: ["text", "audio"], audio: { voice: "alloy", format: "pcm16" }, stream: true, messages: [] })).arrayBuffer();
  await until(() => gw.lastRequest() !== null);
  expect(gw.lastRequest()!.kind).toBe("speech");
});

// 3. /images/generations, /audio/speech, /audio/transcriptions

test("/images/generations goes to OpenRouter's /images as written and records its cost", async () => {
  const route = gw.addRoute({ allow: ["recraft/recraft-v4.1-flash", "openai/gpt-image-1-mini"] });
  const sent = JSON.stringify(imagePrompt());
  const res = await post("/images/generations", route.key, sent);
  expect(res.status).toBe(200);
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(await fixtureBytes("images.json"));

  // No fallback list is added outside chat: OpenRouter's media endpoints do not take one.
  expect(gw.fake.posts.map((p) => [p.path, p.contentType, new TextDecoder().decode(p.body)])).toEqual([["/images", "application/json", sent]]);
  expect(gw.lastRequest()).toMatchObject({
    kind: "image", model_requested: "recraft/recraft-v4.1-flash", model_served: null, streamed: 0, prompt_tokens: 8, completion_tokens: 4175,
    cost_usd: 0.007, cost_source: "provider", failure: null, upstream_id: IDS.images,
  });
  await gw.settled();
  expect(gw.fake.lookups).toEqual([]);
});

test("/images/generations streamed records the cost of the finished image", async () => {
  const route = gw.addRoute();
  const res = await post("/images/generations", route.key, JSON.stringify(imagePrompt({ model: "openai/gpt-image-1-mini", stream: true })));
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(await fixtureBytes("images-stream.sse"));
  await until(() => gw.lastRequest() !== null);
  const row = gw.lastRequest()!;
  expect(row).toMatchObject({ kind: "image", streamed: 1, cost_usd: 0.0022, cost_source: "provider", prompt_tokens: 9, completion_tokens: 272, failure: null });
  expect(row.first_token_ms).not.toBeNull();
});

test("/audio/speech passes the sound on as bytes and asks OpenRouter what it cost", async () => {
  const route = gw.addRoute();
  const res = await post("/audio/speech", route.key, JSON.stringify(speech()));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("audio/mpeg");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(await fixtureBytes("speech.mp3"));

  await until(() => gw.lastRequest() !== null);
  // The sound carries no cost, so at first it is unknown...
  expect(gw.lastRequest()).toMatchObject({ kind: "speech", cost_usd: null, cost_source: "unknown", upstream_id: IDS.speech, status: 200, failure: null });
  expect(gw.lastRequest()!.first_token_ms).not.toBeNull();
  // ...then filled in from /generation.
  await gw.settled();
  expect(gw.fake.lookups).toEqual([IDS.speech]);
  expect(gw.lastRequest()).toMatchObject({ cost_usd: 0.00002178, cost_source: "provider", prompt_tokens: 6, model_served: "hexgrad/kokoro-82m" });
});

test("/audio/transcriptions takes a form with a file, sends it on as it came, and records its cost", async () => {
  const route = gw.addRoute({ allow: ["qwen/qwen3-asr-0.6b"] });
  const request = new Request("http://x", { method: "POST", body: transcriptionForm() });
  const contentType = request.headers.get("content-type")!;
  const sent = new Uint8Array(await request.arrayBuffer());

  const res = await post("/audio/transcriptions", route.key, sent, contentType);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(await fixture("transcription.json").json());
  expect(gw.fake.posts).toHaveLength(1);
  expect(gw.fake.posts[0]!.contentType).toBe(contentType); // the boundary is kept
  expect(gw.fake.posts[0]!.body).toEqual(sent);
  expect(gw.lastRequest()).toMatchObject({
    kind: "transcription", model_requested: "qwen/qwen3-asr-0.6b", prompt_tokens: 2, completion_tokens: 6, cost_usd: 0.0000067, cost_source: "provider", upstream_id: IDS.transcription,
  });
});

test("/audio/transcriptions also takes JSON with the sound as base64", async () => {
  const route = gw.addRoute();
  const sent = JSON.stringify({ model: "qwen/qwen3-asr-0.6b", input_audio: { data: base64Of(1 << 20), format: "mp3" } });
  expect((await post("/audio/transcriptions", route.key, sent)).status).toBe(200);
  expect(new TextDecoder().decode(gw.fake.posts[0]!.body) === sent).toBe(true);
  expect(gw.lastRequest()).toMatchObject({ kind: "transcription", cost_usd: 0.0000067 });
});

test("a transcription form without a model, or that is not a form, is refused", async () => {
  const route = gw.addRoute();
  const noModel = await post("/audio/transcriptions", route.key, transcriptionForm(null), null);
  expect(noModel.status).toBe(400);
  expect((await errorOf(noModel)).message).toBe('The request does not say which model to use. Add "model".');
  const broken = await post("/audio/transcriptions", route.key, "not a form", "multipart/form-data; boundary=nothing");
  expect(broken.status).toBe(400);
  expect(gw.fake.posts).toHaveLength(0);
});

// Every new endpoint is opened with a route key, checked against the budget and the route's models.

const endpoints = [
  { path: "/images/generations", body: () => JSON.stringify(imagePrompt()), type: "application/json" },
  { path: "/audio/speech", body: () => JSON.stringify(speech()), type: "application/json" },
  { path: "/audio/transcriptions", body: () => transcriptionForm(), type: null },
] as const;

for (const endpoint of endpoints) {
  test(`${endpoint.path}: a wrong key, a route over budget, a switched-off route and a model not allowed are refused`, async () => {
    gw.clock.now = new Date(2026, 10, 22, 12).getTime();
    expect((await post(endpoint.path, null, endpoint.body(), endpoint.type)).status).toBe(401);

    const full = gw.addRoute({ budget_usd: 1 });
    gw.spend(full.id, 1);
    const over = await post(endpoint.path, full.key, endpoint.body(), endpoint.type);
    expect(over.status).toBe(402);
    expect((await errorOf(over)).code).toBe("budget_used_up");

    const off = gw.addRoute({ enabled: 0 });
    expect((await post(endpoint.path, off.key, endpoint.body(), endpoint.type)).status).toBe(403);

    const limited = gw.addRoute({ allow: ["openai/gpt-5-mini"] });
    const notAllowed = await post(endpoint.path, limited.key, endpoint.body(), endpoint.type);
    expect(notAllowed.status).toBe(403);
    expect((await errorOf(notAllowed)).code).toBe("model_not_allowed");

    expect(gw.fake.posts).toHaveLength(0);
    expect(gw.store.requests({ limit: 10 }).filter((r) => r.kind !== "chat")).toHaveLength(0);
  });
}

test("what images and sound cost counts towards the budget like anything else", async () => {
  const route = gw.addRoute({ budget_usd: 0.007 });
  expect((await post("/images/generations", route.key, JSON.stringify(imagePrompt()))).status).toBe(200);
  const res = await post("/audio/speech", route.key, JSON.stringify(speech()));
  expect(res.status).toBe(402);
});

test("the provider's refusal of a media request is passed on and recorded", async () => {
  const route = gw.addRoute();
  const res = await post("/audio/speech", route.key, JSON.stringify(speech({ model: "fixture/429" })));
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual(await fixture("error-429.json").json());
  expect(gw.lastRequest()).toMatchObject({ kind: "speech", status: 429, failure: "upstream_error", cost_source: "unknown" });
});

test("the activity list says what each request made", async () => {
  const route = gw.addRoute();
  await post("/audio/speech", route.key, JSON.stringify(speech()));
  await until(() => gw.lastRequest() !== null);
  const login = await fetch(`${gw.url}/api/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "a password" }) });
  const { token } = (await login.json()) as { token: string };
  const list = (await (await fetch(`${gw.url}/api/requests`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { requests: { kind: string }[] };
  expect(list.requests.map((r) => r.kind)).toEqual(["speech"]);
});
