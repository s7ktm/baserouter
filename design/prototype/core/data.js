// The one source of truth. Every skin draws from this; no skin keeps its own copy.
// Pick a state with ?state=default|calm|empty|stress.

const routes = [
  { id: "coding", name: { en: "Coding agent", tr: "Kod ajanı" }, icon: "code", color: "#2B62D9", enabled: true, busy: true, today: 0.51, used: 11.3, budget: 25, keyHint: "4f2a", models: ["anthropic/claude-sonnet-5.5", "openai/gpt-5-mini"] },
  { id: "home", name: { en: "Home assistant", tr: "Ev asistanı" }, icon: "home", color: "#14874C", enabled: true, busy: false, today: 0.42, used: 6.2, budget: 10, keyHint: "9c1e", models: ["openai/gpt-5-mini"] },
  { id: "arm", name: { en: "Robot arm", tr: "Robot kol" }, icon: "robot", color: "#1C2030", enabled: true, busy: false, today: 0.31, used: 1.1, budget: 5, keyHint: "b07d", models: ["google/gemini-2.5-flash"] },
  { id: "news", name: { en: "Newsletter bot", tr: "Bülten botu" }, icon: "mail", color: "#8A4B08", enabled: true, busy: false, today: 0, used: 3, budget: 3, keyHint: "e3a8", models: ["openai/gpt-5-mini"] },
  { id: "garden", name: { en: "Garden watcher", tr: "Bahçe gözcüsü" }, icon: "leaf", color: "#0E6F78", enabled: false, busy: false, today: 0, used: 0.8, budget: 5, keyHint: "71c5", models: ["ollama/llama3.2"] },
];

// newest first; "ago" is seconds
const requests = [
  { route: "coding", model: "anthropic/claude-sonnet-5.5", seconds: 2.1, cost: 0.004, ago: 12, ok: true },
  { route: "coding", model: "anthropic/claude-sonnet-5.5", seconds: 3.4, cost: 0.011, ago: 95, ok: true },
  { route: "home", model: "openai/gpt-5-mini", seconds: 0.8, cost: 0.001, ago: 240, ok: true },
  { route: "coding", model: "anthropic/claude-sonnet-5.5", seconds: 1.2, cost: 0, ago: 610, ok: false },
  { route: "arm", model: "google/gemini-2.5-flash", seconds: 0.6, cost: 0.0004, ago: 1500, ok: true },
  { route: "coding", model: "openai/gpt-5-mini", seconds: 1.9, cost: 0.002, ago: 2400, ok: true },
  { route: "home", model: "openai/gpt-5-mini", seconds: 1.1, cost: 0.001, ago: 5200, ok: true },
  { route: "coding", model: "anthropic/claude-sonnet-5.5", seconds: 4.8, cost: 0.019, ago: 9100, ok: true },
  { route: "news", model: "openai/gpt-5-mini", seconds: 2.6, cost: 0.003, ago: 93000, ok: true },
];

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
      models: i % 2 ? ["some-provider/extremely-long-model-identifier-with-many-parts-v2.5-preview-0612-thinking"] : ["openai/gpt-5-mini", "anthropic/claude-sonnet-5.5", "google/gemini-2.5-flash"],
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
      route: `r${i % 6}`, model: many[i % 6].models[0], seconds: [0.1, 312.4, 2.1][i % 3], cost: [1234.5, 0.0004, 0, 0.02][i % 4], ago: [3, 400, 9000, 400000][i % 4], ok: i % 5 !== 2,
    })),
    last: { route: "r0", model: "extremely-long-model-identifier-with-many-parts-v2.5-preview-0612-thinking", seconds: 312.4, cost: 1234.5 },
  };
}
