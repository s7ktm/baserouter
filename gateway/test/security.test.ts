// What the security review of 2026-11-22 turned up, each kept fixed by a test.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { startGateway, type Gateway } from "./harness.ts";

let gw: Gateway;
beforeEach(() => void (gw = startGateway()));
afterEach(() => gw.stop());

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;
const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${gw.url}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

// The panel

test("only the panel and what it loads are served; the design pages beside it are not", async () => {
  for (const path of ["/", "/index.html", "/core/app.js", "/skins/registry.js", "/fonts/socket.css"]) expect((await fetch(gw.url + path)).status).toBe(200);
  for (const path of ["/frame.html", "/check.html", "/cover.html", "/mascots.html", "/README.md", "/frame.html?src=javascript:alert(1)"]) {
    expect((await fetch(gw.url + path)).status).toBe(404);
  }
  const page = await fetch(`${gw.url}/`);
  expect(page.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
});

// Models

test("a model id that is not one, such as markup, is refused on every endpoint", async () => {
  const route = gw.addRoute();
  const auth = { Authorization: `Bearer ${route.key}` };
  const bad = '<button data-action="delete-route">x</button>';
  for (const [path, body] of [
    ["/v1/chat/completions", { model: bad, messages: [] }],
    ["/v1/images/generations", { model: bad, prompt: "p" }],
    ["/v1/audio/speech", { model: bad, input: "hi" }],
    ["/v1/audio/transcriptions", { model: "has space", input_audio: { data: "", format: "mp3" } }],
  ] as const) {
    const res = await json(path, body, auth);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).message).not.toContain("<");
  }
  expect(gw.fake.posts).toHaveLength(0);
  expect(gw.lastRequest()).toBeNull(); // nothing recorded, so nothing to show in the panel
  // Real ids pass.
  for (const model of ["openai/gpt-5-mini", "google/gemini-2.5-flash:free", "~anthropic/claude-sonnet-latest", "openrouter/auto"]) {
    expect((await json("/v1/chat/completions", { model, messages: [] }, auth)).status).toBe(200);
  }
});

test("a client's own fallback list may only name the route's models", async () => {
  const route = gw.addRoute({ allow: ["openai/gpt-5-mini", "google/gemini-2.5-flash"] });
  const auth = { Authorization: `Bearer ${route.key}` };
  const sneaky = await json("/v1/chat/completions", { model: "openai/gpt-5-mini", models: ["openai/gpt-5-mini", "openai/o1-pro"], messages: [] }, auth);
  expect(sneaky.status).toBe(403);
  expect((await errorOf(sneaky)).message).toContain("openai/o1-pro");
  const images = await json("/v1/images/generations", { model: "openai/gpt-5-mini", models: ["openai/o1-pro"], prompt: "p" }, auth);
  expect(images.status).toBe(403);
  const broken = await json("/v1/chat/completions", { model: "openai/gpt-5-mini", models: "openai/o1-pro", messages: [] }, auth);
  expect(broken.status).toBe(400);
  expect(gw.fake.posts).toHaveLength(0);

  // A list within the route's models is sent as written.
  const fine = { model: "google/gemini-2.5-flash", models: ["google/gemini-2.5-flash", "openai/gpt-5-mini"], messages: [] };
  expect((await json("/v1/chat/completions", fine, auth)).status).toBe(200);
  expect(gw.fake.chats[0]!.body).toBe(JSON.stringify(fine));

  // A route with no list may use any model, in its own list too.
  const open = gw.addRoute();
  expect((await json("/v1/chat/completions", { model: "a/b", models: ["a/b", "c/d"], messages: [] }, { Authorization: `Bearer ${open.key}` })).status).toBe(200);
});

test("a transcription form with two models is refused", async () => {
  const route = gw.addRoute({ allow: ["qwen/qwen3-asr-0.6b"] });
  const form = new FormData();
  form.append("model", "qwen/qwen3-asr-0.6b");
  form.append("model", "openai/gpt-transcribe");
  form.set("file", new File([new Uint8Array([1, 2, 3])], "a.mp3"));
  const res = await fetch(`${gw.url}/v1/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${route.key}` }, body: form });
  expect(res.status).toBe(400);
  expect(gw.fake.posts).toHaveLength(0);
});

// Signing in

test("a burst of guesses sent at once is stopped after five, like guesses sent one by one", async () => {
  await json("/api/setup", { password: "the right password" });
  const answers = await Promise.all(Array.from({ length: 20 }, () => json("/api/login", { password: "a wrong guess" }).then((r) => r.status)));
  expect(answers.filter((s) => s === 401)).toHaveLength(5);
  expect(answers.filter((s) => s === 429)).toHaveLength(15);
  // While it is closed, even the right password waits.
  expect((await json("/api/login", { password: "the right password" })).status).toBe(429);
});

test("the panel's API answers only to the names the gateway is reached by", async () => {
  const fresh = await fetch(`${gw.url}/api/setup`, { method: "POST", headers: { Host: "attacker.example:4141", "Content-Type": "application/json" }, body: JSON.stringify({ password: "taken over" }) });
  expect(fresh.status).toBe(403);
  expect((await errorOf(fresh)).code).toBe("unknown_host");
  expect((await fetch(`${gw.url}/api/status`, { headers: { Host: "localhost:4141" } })).status).toBe(200);
  expect((await fetch(`${gw.url}/api/status`, { headers: { Host: "[::1]:4141" } })).status).toBe(200);
  expect((await fetch(`${gw.url}/api/status`)).status).toBe(200); // 127.0.0.1
  // The one address is not affected: it needs a route key either way.
  const route = gw.addRoute();
  expect((await json("/v1/chat/completions", { model: "openai/gpt-5-mini", messages: [] }, { Host: "anything.example", Authorization: `Bearer ${route.key}` })).status).toBe(200);
});

test("the session cookie is Secure when the panel is reached over HTTPS", async () => {
  const plain = await json("/api/setup", { password: "a test password" });
  expect(plain.headers.get("set-cookie")).not.toContain("Secure");
  const login = await json("/api/login", { password: "a test password" }, { "X-Forwarded-Proto": "https" });
  expect(login.headers.get("set-cookie")).toContain("Secure");
  expect(login.headers.get("set-cookie")).toContain("HttpOnly");
  expect(login.headers.get("set-cookie")).toContain("SameSite=Strict");
});
