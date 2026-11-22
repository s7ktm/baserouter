// A stand-in for OpenRouter that answers from the fixture files. The tests start it
// on a free port; run it by hand to try the gateway without a real key:
//   bun test/fake-openrouter.ts        (listens on 127.0.0.1:4142)
// The model name picks what happens: see SCENARIOS.
import { join } from "node:path";

export const FAKE_KEY = "fixture-openrouter-key";

const dir = join(import.meta.dir, "fixtures");
export const fixture = (name: string) => Bun.file(join(dir, name));
export const fixtureBytes = async (name: string) => new Uint8Array(await fixture(name).arrayBuffer());

export const SCENARIOS = {
  "fixture/stream-error": "a stream that fails half way, after HTTP 200",
  "fixture/no-usage": "a stream that breaks off before the usage chunk",
  "fixture/hang": "a stream that never ends, until the client goes away",
  "fixture/error-200": "a plain request that fails after HTTP 200",
  "fixture/429": "a rate limit, before any response",
} as const;

const json = (file: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(fixture(file), { status, headers: { "Content-Type": "application/json", ...headers } });

const SSE = { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" };

// Sends a file in small pieces of an awkward size, so lines and multi-byte
// characters are split across chunks the way a network splits them.
function inPieces(bytes: Uint8Array, size = 37): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    async pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(at, (at += size)));
      await Bun.sleep(1);
    },
  });
}

export interface Fake {
  url: string;
  chats: { key: string | null; body: string }[]; // every chat request received
  lookups: string[]; // every generation id asked for
  cancelled: Promise<void>; // settles when a "fixture/hang" stream is cancelled by its reader
  stop(): Promise<void>;
}

export function startFake(port = 0): Fake {
  const chats: Fake["chats"] = [];
  const lookups: string[] = [];
  const cancelled = Promise.withResolvers<void>();

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const key = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;
      if (key !== FAKE_KEY) return json("error-401.json", 401);

      if (req.method === "GET" && url.pathname === "/key") return json("key.json");
      if (req.method === "GET" && url.pathname === "/models") return json("models.json");
      if (req.method === "GET" && url.pathname === "/generation") {
        lookups.push(url.searchParams.get("id") ?? "");
        return json("generation.json");
      }
      if (req.method !== "POST" || url.pathname !== "/chat/completions") return new Response("Not found", { status: 404 });

      const body = await req.text();
      chats.push({ key, body });
      const { model, stream } = JSON.parse(body) as { model: string; stream?: boolean };

      if (model === "fixture/429") return json("error-429.json", 429, { "Retry-After": "3" });
      if (model === "fixture/error-200") return json("chat-error-200.json");
      if (model === "fixture/stream-error") return new Response(inPieces(await fixtureBytes("chat-stream-error.sse")), { headers: SSE });
      if (model === "fixture/no-usage") return new Response(inPieces(await fixtureBytes("chat-stream-no-usage.sse")), { headers: SSE });
      if (model === "fixture/hang") {
        const start = (await fixtureBytes("chat-stream-no-usage.sse")).subarray(0, 600);
        let sent = false;
        const keepAlive = new TextEncoder().encode(": OPENROUTER PROCESSING\n\n");
        req.signal.addEventListener("abort", () => cancelled.resolve());
        return new Response(
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              if (!sent) return void ((sent = true), controller.enqueue(start));
              await Bun.sleep(20);
              controller.enqueue(keepAlive);
            },
            cancel: () => cancelled.resolve(),
          }),
          { headers: SSE },
        );
      }
      if (stream) return new Response(inPieces(await fixtureBytes("chat-stream.sse")), { headers: SSE });
      return json("chat.json");
    },
  });

  return { url: `http://127.0.0.1:${server.port}`, chats, lookups, cancelled: cancelled.promise, stop: () => server.stop(true) };
}

if (import.meta.main) {
  const fake = startFake(Number(process.env.PORT ?? 4142));
  console.log(`Fake OpenRouter: ${fake.url}  (key: ${FAKE_KEY})`);
  for (const [model, what] of Object.entries(SCENARIOS)) console.log(`  model "${model}": ${what}`);
}
