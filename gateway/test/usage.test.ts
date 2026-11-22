import { expect, test } from "bun:test";
import { readPlain, readUsage, StreamScanner } from "../src/usage.ts";
import { fixture, fixtureBytes } from "./fake-openrouter.ts";

// Feeds a fixture in pieces of the given size; the clock is the number of the piece.
async function scan(file: string, size: number): Promise<StreamScanner> {
  const bytes = await fixtureBytes(file);
  const scanner = new StreamScanner();
  let piece = 0;
  for (let at = 0; at < bytes.length; at += size) scanner.feed(bytes.subarray(at, at + size), ++piece);
  scanner.end(++piece);
  return scanner;
}

const facts = (s: StreamScanner) => ({ id: s.id, model: s.model, usage: s.usage, failed: s.failed, done: s.done });

test("a streamed completion gives its id, model, tokens and cost", async () => {
  const scanner = await scan("chat-stream.sse", 1 << 20);
  expect(facts(scanner)).toEqual({
    id: "gen-1795300003-FixtureStream0000001",
    model: "openai/gpt-5-mini",
    usage: { promptTokens: 8, completionTokens: 6, cost: 0.0000143 },
    failed: false,
    done: true,
  });
});

test("the result is the same however the bytes are cut up", async () => {
  const whole = facts(await scan("chat-stream.sse", 1 << 20));
  for (const size of [1, 2, 3, 7, 37, 256]) expect(facts(await scan("chat-stream.sse", size))).toEqual(whole);
});

test("the first token is the first chunk with text, not the keep-alive or the empty opening chunk", async () => {
  const text = await fixture("chat-stream.sse").text();
  const events = text.split("\n\n").filter(Boolean);
  expect(events[0]).toBe(": OPENROUTER PROCESSING");
  expect(events[1]).toContain('"content":""');
  expect(events[2]).toContain('"content":"Merhaba"');

  const scanner = new StreamScanner();
  events.forEach((event, i) => scanner.feed(new TextEncoder().encode(event + "\n\n"), i));
  expect(scanner.firstTokenAt).toBe(2);
});

test("a first token can be reasoning or a tool call", () => {
  for (const delta of [{ reasoning: "Let me think" }, { tool_calls: [{ index: 0, function: { name: "lamp" } }] }]) {
    const scanner = new StreamScanner();
    scanner.feed(new TextEncoder().encode(`data: ${JSON.stringify({ id: "gen-1", model: "m", choices: [{ delta }] })}\n\n`), 7);
    expect(scanner.firstTokenAt).toBe(7);
  }
});

test("a stream that fails half way is marked failed and has no cost", async () => {
  const scanner = await scan("chat-stream-error.sse", 37);
  expect(facts(scanner)).toEqual({ id: "gen-1795300005-FixtureMidErr0000001", model: "openai/gpt-5-mini", usage: null, failed: true, done: false });
});

test("a stream that breaks off has an id to look its cost up with, and no cost", async () => {
  const scanner = await scan("chat-stream-no-usage.sse", 37);
  expect(facts(scanner)).toEqual({ id: "gen-1795300004-FixtureNoUsage000001", model: "openai/gpt-5-mini", usage: null, failed: false, done: false });
  expect(scanner.firstTokenAt).not.toBeNull();
});

test('text that contains the words "usage" and "error" is not taken for either', async () => {
  const text = await fixture("chat-stream.sse").text();
  expect(text).toContain('\\"usage\\" and \\"error\\"');
  const upTo = text.indexOf('"finish_reason":"stop"');
  const scanner = new StreamScanner();
  scanner.feed(new TextEncoder().encode(text.slice(0, text.lastIndexOf("data:", upTo))), 1);
  expect(scanner.failed).toBe(false);
  expect(scanner.usage).toBeNull();
});

test("lines may end with a carriage return, and the last line needs no line break", () => {
  const scanner = new StreamScanner();
  const event = JSON.stringify({ id: "gen-2", model: "m", choices: [{ delta: { content: "hi" } }], usage: { prompt_tokens: 1, completion_tokens: 2, cost: 0.5 } });
  scanner.feed(new TextEncoder().encode(`: keep-alive\r\n\r\ndata: ${event}\r\n\r\ndata: [DONE]`), 1);
  expect(scanner.usage).toEqual({ promptTokens: 1, completionTokens: 2, cost: 0.5 });
  expect(scanner.done).toBe(false);
  scanner.end(2);
  expect(scanner.done).toBe(true);
});

test("a line that is not JSON is passed over", () => {
  const scanner = new StreamScanner();
  scanner.feed(new TextEncoder().encode('data: {"broken\n\nevent: ping\n\ndata: {"id":"gen-3","model":"m","choices":[]}\n\n'), 1);
  expect(scanner.id).toBe("gen-3");
  expect(scanner.failed).toBe(false);
});

test("usage without a cost keeps the tokens and leaves the cost unknown", () => {
  expect(readUsage({ prompt_tokens: 3, completion_tokens: 4 })).toEqual({ promptTokens: 3, completionTokens: 4, cost: null });
  expect(readUsage({ prompt_tokens: 3, completion_tokens: 4, cost: "0.1" })).toEqual({ promptTokens: 3, completionTokens: 4, cost: null });
  expect(readUsage(null)).toBeNull();
});

test("a plain completion gives its id, model, tokens and cost", async () => {
  expect(readPlain(await fixture("chat.json").json())).toEqual({
    id: "gen-1795300001-FixturePlain00000001",
    model: "openai/gpt-5-mini",
    usage: { promptTokens: 8, completionTokens: 9, cost: 0.0000205 },
    failed: false,
  });
});

test("a plain response can fail after HTTP 200", async () => {
  expect(readPlain(await fixture("chat-error-200.json").json())).toEqual({ id: "gen-1795300002-FixtureError00000001", model: null, usage: null, failed: true });
  expect(readPlain({ id: "gen-4", model: "m", choices: [{ finish_reason: "error", error: { code: 502, message: "x" } }] }).failed).toBe(true);
  expect(readPlain("not an object").failed).toBe(true);
});
