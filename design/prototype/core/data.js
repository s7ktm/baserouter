// The one source of truth. Every skin draws from this; no skin keeps its own copy.
// Pick a state with ?state=default|calm|empty|stress.

const routes = [
  { id: "coding", name: { en: "Coding agent", tr: "Kod ajanı" }, icon: "code", color: "#2B62D9", enabled: true, busy: true, today: 0.51, used: 11.3, budget: 25, keyHint: "4f2a", models: ["anthropic/claude-sonnet-5.5", "gpt-5-mini", "smart"] },
  { id: "home", name: { en: "Home assistant", tr: "Ev asistanı" }, icon: "home", color: "#14874C", enabled: true, busy: false, today: 0.42, used: 6.2, budget: 10, keyHint: "9c1e", models: ["gpt-5-mini", "hexgrad/kokoro-82m"] },
  { id: "arm", name: { en: "Robot arm", tr: "Robot kol" }, icon: "robot", color: "#1C2030", enabled: true, busy: false, today: 0.31, used: 1.1, budget: 5, keyHint: "b07d", models: ["google/gemini-2.5-flash"] },
  { id: "news", name: { en: "Newsletter bot", tr: "Bülten botu" }, icon: "mail", color: "#8A4B08", enabled: true, busy: false, today: 0, used: 3, budget: 3, keyHint: "e3a8", models: ["gpt-5-mini", "google/gemini-3.1-flash-lite-image", "google/veo-3.1-lite"] },
  { id: "garden", name: { en: "Garden watcher", tr: "Bahçe gözcüsü" }, icon: "leaf", color: "#0E6F78", enabled: false, busy: false, today: 0, used: 0.8, budget: 5, keyHint: "71c5", models: [], keepMedia: false },
];

// newest first; "ago" is seconds; "kind" is chat unless said: image, speech, transcription or video
const requests = [
  { route: "coding", model: "anthropic/claude-sonnet-5.5", seconds: 2.1, cost: 0.004, ago: 12, ok: true },
  { route: "coding", model: "anthropic/claude-sonnet-5.5", seconds: 3.4, cost: 0.011, ago: 95, ok: true },
  { route: "home", kind: "speech", model: "hexgrad/kokoro-82m", seconds: 0.8, cost: 0.0001, ago: 240, ok: true },
  { route: "coding", model: "anthropic/claude-sonnet-5.5", seconds: 1.2, cost: 0, ago: 610, ok: false },
  { route: "arm", model: "google/gemini-2.5-flash", seconds: 0.6, cost: 0.0004, ago: 1500, ok: true },
  { route: "news", kind: "image", model: "google/gemini-3.1-flash-lite-image", seconds: 5.4, cost: 0.034, ago: 2400, ok: true },
  { route: "news", kind: "video", model: "google/veo-3.1-lite", seconds: 48.2, cost: 0.12, ago: 4300, ok: true },
  { route: "home", model: "openai/gpt-5-mini", seconds: 1.1, cost: 0.001, ago: 5200, ok: true },
  { route: "coding", model: "anthropic/claude-sonnet-5.5", seconds: 4.8, cost: 0.019, ago: 9100, ok: true },
  { route: "news", model: "openai/gpt-5-mini", seconds: 2.6, cost: 0.003, ago: 93000, ok: true },
];

// Made-up pictures for the kept images: small drawings, so nothing is loaded from elsewhere.
// w and h give a picture that is not square, to see how a wide or tall one sits.
function picture(n, w = 512, h = 512) {
  const sky = ["#F4C27A", "#9FC4F0", "#1E2A4A", "#BFE3C6", "#F2B5B5", "#D9D2F5"][n % 6];
  const ink = ["#2B62D9", "#14874C", "#F4C27A", "#8A4B08", "#7A3FB8", "#0E6F78"][n % 6];
  const shape = [
    `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="${ink}"/>`,
    `<path d="M0 ${h * 0.7} L${w * 0.35} ${h * 0.35} L${w * 0.6} ${h * 0.6} L${w * 0.8} ${h * 0.45} L${w} ${h * 0.7} V${h} H0Z" fill="${ink}"/>`,
    `<rect x="${w * 0.25}" y="${h * 0.3}" width="${w / 2}" height="${h * 0.4}" rx="${w / 20}" fill="${ink}"/><circle cx="${w * 0.75}" cy="${h * 0.22}" r="${Math.min(w, h) / 12}" fill="#fff"/>`,
  ][n % 3];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${sky}"/>${shape}</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

// newest first; "ago" is seconds
const images = [
  { id: "i1", kind: "image", route: "news", model: "google/gemini-3.1-flash-lite-image", prompt: "A calm sunrise over hills, for the morning newsletter header.", cost: 0.034, bytes: 812000, ago: 2400, src: picture(1, 768, 432) },
  { id: "i2", kind: "image", route: "coding", model: "recraft/recraft-v4.1-flash", prompt: "A small blue circle on white.", cost: 0.007, bytes: 104000, ago: 5100, src: picture(0) },
  { id: "i3", kind: "image", route: "news", model: "recraft/recraft-v4.1-flash", prompt: "An icon of a letter with a green leaf.", cost: 0.007, bytes: 98000, ago: 9600, src: picture(5) },
  { id: "i4", kind: "image", route: "home", model: "google/gemini-3.1-flash-lite-image", prompt: "A floor plan sketch of a living room, top view.", cost: 0.034, bytes: 1240000, ago: 86000, src: picture(2, 432, 768) },
  { id: "i5", kind: "image", route: "news", model: "recraft/recraft-v4.1-flash", prompt: "Mountains at night under a deep blue sky.", cost: 0.007, bytes: 120000, ago: 170000, src: picture(4) },
];
// Made-up sounds: a short tone each, as a WAV, so nothing is loaded from elsewhere.
function tone(hz, seconds = 1.2) {
  const rate = 8000;
  const n = Math.round(rate * seconds);
  const bytes = new Uint8Array(44 + n);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + n, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  text(36, "data"); view.setUint32(40, n, true);
  for (let i = 0; i < n; i++) bytes[44 + i] = 128 + Math.round(40 * Math.sin((2 * Math.PI * hz * i) / rate) * Math.min(1, (n - i) / 800));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return "data:audio/wav;base64," + btoa(binary);
}

const sounds = [
  { id: "a1", kind: "audio", route: "home", model: "hexgrad/kokoro-82m", prompt: "Good morning. It is seven degrees outside and the heating is on.", cost: 0.00002, bytes: 48000, ago: 240, src: tone(440) },
  { id: "a2", kind: "audio", route: "home", model: "hexgrad/kokoro-82m", prompt: "The front door is open.", cost: 0.00001, bytes: 12400, ago: 7200, src: tone(523) },
  { id: "a3", kind: "audio", route: "news", model: "elevenlabs/eleven-flash-v2.5", prompt: "Here is your newsletter for Monday.", cost: 0.0004, bytes: 96000, ago: 90000, src: tone(330) },
];
// Made-up videos: three short clips in core/videos/, three seconds of moving colour each,
// so nothing is loaded from elsewhere. "clip" is the path from the prototype's folder.
const clip = (n) => `core/videos/sample-${n}.mp4`;
const videos = [
  { id: "v1", kind: "video", route: "news", model: "google/veo-3.1-lite", prompt: "A slow pan over a calm blue sea at dawn, for the newsletter's opening.", cost: 0.12, bytes: 2480000, ago: 4300, src: clip(1) },
  { id: "v2", kind: "video", route: "home", model: "x-ai/grok-imagine-video-1.5-lite", prompt: "Morning light moving across a green garden.", cost: 0.02, bytes: 599000, ago: 52000, src: clip(2) },
  { id: "v3", kind: "video", route: "news", model: "bytedance/seedance-2.0-fast", prompt: "Purple and teal clouds drifting, a loop for the website header.", cost: 0.07, bytes: 1310000, ago: 260000, src: clip(3) },
];
const mediaSpace = { images: images.length, sounds: sounds.length, videos: videos.length, bytes: [...images, ...sounds, ...videos].reduce((sum, i) => sum + i.bytes, 0), keeping: true, max: 1024 ** 3 };

const base = {
  address: "http://localhost:4141/v1",
  spend: { today: 1.24, month: 18.6, week: [0.62, 1.02, 0.49, 1.38, 0.9, 1.15, 1.24], requests: 38 },
  providers: [
    { id: "openrouter", name: "OpenRouter", status: "up", keyHint: "a1b2", models: 312 },
    { id: "openai", name: "OpenAI", status: "up", keyHint: "7f3c", models: 41 },
    { id: "ollama", name: "Ollama", status: "down", keyHint: null, models: 6, error: "connection refused" },
  ],
  routes,
  requests,
  last: { route: "coding", model: "claude-sonnet-5.5", seconds: 2.1, cost: 0.004 },
  images,
  sounds,
  videos,
  mediaSpace,
};

// What "Add a provider" offers. A kind with an address asks for it; key: false means no key is needed.
export const catalog = [
  { kind: "openrouter", name: "OpenRouter", where: "openrouter.ai/keys", models: 312 },
  { kind: "openai", name: "OpenAI", where: "platform.openai.com/api-keys", models: 41 },
  { kind: "anthropic", name: "Anthropic", where: "console.anthropic.com/settings/keys", models: 9 },
  { kind: "google", name: "Google Gemini", where: "aistudio.google.com/apikey", models: 14 },
  { kind: "ollama", name: "Ollama", address: "http://localhost:11434", key: false, models: 6 },
  { kind: "custom", name: null, address: "https://", models: 1 },
];

// What "New route" offers as a first model.
export const modelChoices = ["openai/gpt-5-mini", "anthropic/claude-sonnet-5.5", "google/gemini-2.5-flash"];

// The provider's models, in the shape the gateway gives them (gateway/src/catalogue.ts):
// what each makes and takes, how much it reads ("context", tokens), its price per token read
// and written, or per second of video, in US dollars. Made up, after OpenRouter's list.
const model = (id, name, makes, takes, context, inM, outM, extra = {}) =>
  ({ provider: "openrouter", id, name, makes, takes, context, in: inM == null ? null : inM / 1e6, out: outM == null ? null : outM / 1e6, perSecond: null, free: id.endsWith(":free"), ...extra });
// What the providers offer: OpenRouter's list, and smaller ones from OpenAI and Ollama.
// Each says which provider offers it ("provider", a provider's id in the made-up data).
const openrouterOffers = [
  model("anthropic/claude-sonnet-5.5", "Anthropic: Claude Sonnet 5.5", ["text"], ["text", "image", "file"], 1000000, 3, 15),
  model("openai/gpt-5-mini", "OpenAI: GPT-5 Mini", ["text"], ["text", "image", "file"], 400000, 0.25, 2),
  model("google/gemini-2.5-flash", "Google: Gemini 2.5 Flash", ["text"], ["text", "image", "file", "audio", "video"], 1048576, 0.3, 2.5),
  model("google/gemini-3.1-flash-lite-image", "Google: Gemini 3.1 Flash Lite Image", ["image", "text"], ["text", "image"], 65536, 0.1, 0.4),
  model("x-ai/grok-imagine-video-1.5-lite", "xAI: Grok Imagine Video 1.5 Lite", ["video"], ["text", "image"], null, null, null, { perSecond: 0.02 }),
  model("google/veo-3.1-lite", "Google: Veo 3.1 Lite", ["video"], ["text", "image"], null, null, null, { perSecond: 0.03 }),
  model("hexgrad/kokoro-82m", "hexgrad: Kokoro 82M", ["speech"], ["text"], 4096, null, null),
  model("elevenlabs/eleven-flash-v2.5", "ElevenLabs: Flash v2.5", ["speech"], ["text"], null, null, null),
  model("qwen/qwen3-asr-0.6b", "Qwen: Qwen3 ASR 0.6B", ["transcription"], ["audio"], null, null, null),
  model("openai/gpt-4o-mini-transcribe", "OpenAI: GPT-4o Mini Transcribe", ["transcription"], ["audio"], null, null, null),
  model("recraft/recraft-v4.1-flash", "Recraft: Recraft V4.1 Flash", ["image"], ["text"], null, null, null),
  model("black-forest-labs/flux-3-schnell", "Black Forest Labs: FLUX.3 Schnell", ["image"], ["text", "image"], null, null, null),
  model("openai/gpt-audio-mini", "OpenAI: GPT Audio Mini", ["speech", "text"], ["text", "audio"], 128000, 0.6, 2.4),
  model("deepseek/deepseek-v4", "DeepSeek: DeepSeek V4", ["text"], ["text"], 163840, 0.27, 1.1),
  model("meta-llama/llama-5-scout:free", "Meta: Llama 5 Scout (free)", ["text"], ["text", "image"], 131072, 0, 0),
  model("mistralai/mistral-small-4", "Mistral: Mistral Small 4", ["text"], ["text", "image"], 131072, 0.1, 0.3),
  model("qwen/qwen3.5-coder", "Qwen: Qwen3.5 Coder", ["text"], ["text"], 262144, 0.22, 0.95),
  model("bytedance/seedance-2.0-fast", "ByteDance: Seedance 2.0 Fast", ["video"], ["text", "image", "video", "audio"], null, null, null),
];
const at = (provider, entries) => entries.map((m) => ({ ...m, provider }));
export const offers = [
  ...openrouterOffers,
  ...at("openai", [
    model("gpt-5-mini", "GPT-5 Mini", ["text"], ["text", "image", "file"], 400000, 0.25, 2),
    model("gpt-image-1.5", "GPT Image 1.5", ["image"], ["text", "image"], null, null, null),
    model("gpt-4o-mini-tts", "GPT-4o Mini TTS", ["speech"], ["text"], null, null, null),
  ]),
  ...at("ollama", [model("llama3.2", "Llama 3.2", ["text"], ["text"], 131072, 0, 0), model("qwen3:8b", "Qwen3 8B", ["text"], ["text"], 40960, 0, 0)]),
];

// BaseRouter's own models: the name apps send, what it makes, and the places it comes from,
// in order. A place is a provider, that provider's id for the model, and for OpenRouter which
// of its own providers ("via", or null for any). See "Providers, models and routes" in PRODUCT.md.
const place = (provider, model, via = null) => ({ provider, model, via });
export const models = [
  { name: "gpt-5-mini", makes: ["text"], from: [place("openai", "gpt-5-mini"), place("openrouter", "openai/gpt-5-mini")] },
  { name: "anthropic/claude-sonnet-5.5", makes: ["text"], from: [place("openrouter", "anthropic/claude-sonnet-5.5", "anthropic"), place("openrouter", "anthropic/claude-sonnet-5.5")] },
  { name: "smart", makes: ["text"], from: [place("openrouter", "anthropic/claude-sonnet-5.5"), place("openai", "gpt-5-mini")] },
  { name: "google/gemini-2.5-flash", makes: ["text"], from: [place("openrouter", "google/gemini-2.5-flash", "google-ai-studio/flex")] },
  { name: "google/gemini-3.1-flash-lite-image", makes: ["image", "text"], from: [place("openrouter", "google/gemini-3.1-flash-lite-image")] },
  { name: "hexgrad/kokoro-82m", makes: ["speech"], from: [place("openrouter", "hexgrad/kokoro-82m")] },
  { name: "google/veo-3.1-lite", makes: ["video"], from: [place("openrouter", "google/veo-3.1-lite")] },
  { name: "llama3.2", makes: ["text"], from: [place("ollama", "llama3.2")] },
];
base.models = models;
const stressModels = Array.from({ length: 40 }, (_, i) => ({
  name: i % 5 === 0 ? `a-very-long-model-name-that-apps-send-${i}/with-many-parts-v2.5-preview-0612-thinking` : `m${i}`,
  makes: [["text"], ["image"], ["speech"], ["transcription"], ["video"], ["image", "text"]][i % 6],
  from: i % 4 === 0
    ? [place("p2", "extremely-long-model-identifier-at-a-self-hosted-provider-v9"), place("p1", `provider-with-a-very-long-name-${i}/extremely-long-model-identifier`, "a-provider-with-a-very-long-name/eu-west-3/priority"), place("p3", "gpt-5-mini")]
    : [place("p1", `p${i}/m${i}`)],
}));


// Where a model comes from: the provider's own providers for it, as OpenRouter's endpoints
// list gives them (gateway/src/catalogue.ts, providersOf). Made up, after real ones.
const where = (tag, name, tier, inM, outM, context, up = true) => ({ tag, name, tier, in: inM == null ? null : inM / 1e6, out: outM == null ? null : outM / 1e6, context, up });
const providerLists = {
  "anthropic/claude-sonnet-5.5": [
    where("anthropic", "Anthropic", null, 3, 15, 1000000),
    where("amazon-bedrock", "Amazon Bedrock", null, 3, 15, 1000000),
    where("google-vertex/global", "Google Vertex", null, 3, 15, 1000000),
    where("azure/global", "Azure", null, 3.3, 16.5, 200000, false),
  ],
  "google/gemini-2.5-flash": [
    where("google-ai-studio/flex", "Google AI Studio", "flex", 0.15, 1.25, 1048576),
    where("google-ai-studio", "Google AI Studio", null, 0.3, 2.5, 1048576),
    where("google-ai-studio/priority", "Google AI Studio", "priority", 0.54, 4.5, 1048576),
    where("google-vertex", "Google Vertex", null, 0.3, 2.5, 1048576, false),
  ],
  "openai/gpt-5-mini": [where("openai", "OpenAI", null, 0.25, 2, 400000), where("azure", "Azure", null, 0.25, 2, 400000)],
};
export function providersFor(model, stress = false) {
  if (stress) {
    return Array.from({ length: 14 }, (_, i) => where(i % 3 ? `p${i}` : `a-provider-with-a-very-long-name-${i}/eu-west-3/priority`,
      i % 3 ? `P${i}` : `A Provider With A Very Long Name And Region ${i}`, ["flex", null, "priority"][i % 3], [1234.5, 0.000001, 0][i % 3], [9999, 0.000004, 0][i % 3], [2000000, 4096, null][i % 3], i % 4 !== 1));
  }
  return providerLists[model] ?? [where(model.split("/")[0], model.split("/")[0], null, null, null, null)];
}

export const states = {
  // a normal day: one provider unreachable, one route stopped at its budget, one switched off
  default: base,

  // nothing needs attention
  calm: {
    ...base,
    providers: base.providers.map((p) => ({ ...p, status: "up" })),
    routes: routes.map((r) =>
      r.id === "news" ? { ...r, today: 0.06, used: 1.8 } : r.id === "garden" ? { ...r, enabled: true, today: 0.02 } : r,
    ),
  },

  // worst case: 40 routes, very long and very short names, huge and zero amounts, many providers
  stress: stress(),

  // first run: nothing added yet
  empty: {
    address: base.address,
    spend: { today: 0, month: 0, week: [0, 0, 0, 0, 0, 0, 0], requests: 0 },
    providers: [],
    routes: [],
    requests: [],
    last: null,
    images: [],
    sounds: [],
    videos: [],
    mediaSpace: { images: 0, sounds: 0, videos: 0, bytes: 0, keeping: true, max: 1024 ** 3 },
    models: [],
  },
};

function stress() {
  const names = [
    "Home assistant for the upstairs bathroom humidity sensor and fan controller",
    "X",
    "Çekoslovakyalılaştıramadıklarımızdanmışsınız",
    "Robot arm",
    "nightly-batch-summariser-for-the-family-photo-archive",
  ];
  const icons = ["home", "code", "robot", "mail", "leaf"];
  const colours = ["#2B62D9", "#14874C", "#1C2030", "#8A4B08", "#0E6F78"];
  const many = Array.from({ length: 40 }, (_, i) => {
    const kind = i % 8;
    const budget = [0.5, 3, 25, 100000, 1][i % 5];
    return {
      id: `r${i}`,
      name: { en: i < names.length ? names[i] : `Agent number ${i + 1}`, tr: i < names.length ? names[i] : `${i + 1} numaralı ajan` },
      icon: icons[i % 5], color: colours[i % 5],
      enabled: kind !== 3, busy: kind === 0,
      today: [0, 9999.99, 0.004, 12.5][i % 4],
      used: kind === 5 ? budget : [0, budget * 0.97, budget * 0.4][i % 3],
      budget, keyHint: "0000",
      models: i % 3 === 2 ? [] : i % 2 ? [stressModels[0].name] : stressModels.slice(0, 6).map((m) => m.name),
    };
  });
  return {
    address: "https://baserouter.my-very-long-home-server-name.example.internal:8443/v1",
    spend: { today: 12345.67, month: 98765.43, week: [0, 15000, 0.01, 8200, 0, 12000, 12345.67], requests: 120394 },
    providers: [
      { id: "p1", name: "OpenRouter", status: "up", keyHint: "a1b2", models: 312 },
      { id: "p2", name: "My self-hosted inference cluster in the garage", status: "down", keyHint: null, models: 2, error: "dial tcp 192.168.1.240:11434: connect: connection refused after 30000 ms" },
      { id: "p3", name: "OpenAI", status: "up", keyHint: "7f3c", models: 41 },
      { id: "p4", name: "Anthropic", status: "up", keyHint: "c0de", models: 9 },
      { id: "p5", name: "Google Gemini", status: "down", keyHint: "9e9e", models: 14, error: "429" },
      { id: "p6", name: "Ollama", status: "up", keyHint: null, models: 6 },
      { id: "p7", name: "Q", status: "up", keyHint: "zzzz", models: 1 },
    ],
    routes: many,
    requests: Array.from({ length: 30 }, (_, i) => ({
      route: `r${i % 6}`, kind: ["chat", "transcription", "image", "speech", "video"][i % 5], model: (many[i % 6].models[0] ?? "x/y"), seconds: [0.1, 312.4, 2.1][i % 3], cost: [1234.5, 0.0004, 0, 0.02][i % 4], ago: [3, 400, 9000, 400000][i % 4], ok: i % 5 !== 2,
    })),
    last: { route: "r0", model: "extremely-long-model-identifier-with-many-parts-v2.5-preview-0612-thinking", seconds: 312.4, cost: 1234.5 },
    images: Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`, kind: "image", route: i === 7 ? null : `r${i % 6}`, model: (many[i % 6].models[0] ?? "x/y"),
      prompt: i % 4 === 0 ? null : i % 4 === 1 ? "A" : "A very detailed picture of a ".repeat(12) + "Çekoslovakyalılaştıramadıklarımızdanmışsınız",
      cost: [1234.5, 0.0004, null, 0][i % 4], bytes: [999, 52428800, 1536, 1073741824][i % 4], ago: [3, 400, 9000, 400000][i % 4],
      src: picture(i, [512, 2048, 300][i % 3], [512, 300, 2048][i % 3]),
    })),
    sounds: Array.from({ length: 30 }, (_, i) => ({
      id: `t${i}`, kind: "audio", route: i === 3 ? null : `r${i % 6}`, model: (many[(i + 1) % 6].models[0] ?? "x/y"),
      prompt: i % 3 === 0 ? null : i % 3 === 1 ? "Ok" : "Read this very long announcement out loud, slowly and clearly, ".repeat(10) + "Çekoslovakyalılaştıramadıklarımızdanmışsınız",
      cost: [1234.5, 0.0004, null][i % 3], bytes: [999, 52428800, 1073741824][i % 3], ago: [3, 400, 9000, 400000][i % 4],
      src: tone(220 + i * 20, 0.3),
    })),
    videos: Array.from({ length: 30 }, (_, i) => ({
      id: `w${i}`, kind: "video", route: i === 5 ? null : `r${i % 6}`, model: (many[(i + 2) % 6].models[0] ?? "x/y"),
      prompt: i % 3 === 0 ? null : i % 3 === 1 ? "Go" : "A long, slow, carefully lit shot of a city at night with rain on the windows, ".repeat(10) + "Çekoslovakyalılaştıramadıklarımızdanmışsınız",
      cost: [1234.5, 0.0004, null][i % 3], bytes: [999, 52428800, 1073741824][i % 3], ago: [3, 400, 9000, 400000][i % 4],
      src: clip((i % 3) + 1),
    })),
    mediaSpace: { images: 120394, sounds: 98765, videos: 4321, bytes: 1073000000, keeping: true, max: 1024 ** 3 },
    models: stressModels,
    // 120 offers: very long names and ids, huge and tiny prices, every kind
    offers: Array.from({ length: 120 }, (_, i) => model(
      i % 7 === 0 ? `provider-with-a-very-long-name-${i}/extremely-long-model-identifier-with-many-parts-v${i}.5-preview-0612-thinking` : `p${i}/m${i}`,
      i % 7 === 0 ? "A Provider With A Very Long Name: An Extremely Long Model Name That Goes On And On, Preview Edition " + i : `P: M${i}`,
      [["text"], ["image"], ["speech"], ["transcription"], ["video"], ["image", "text"]][i % 6],
      i % 3 ? ["text", "image", "file", "audio", "video"] : ["text"],
      [2000000, 4096, null][i % 3], [1234.5, 0.000001, 0][i % 3], [9999, 0.000004, 0][i % 3],
      i % 6 === 4 ? { perSecond: [12.5, 0.005][i % 2] } : {},
    )).map((m, i) => ({ ...m, provider: ["p1", "p3", "p6"][i % 3] })),
  };
}
