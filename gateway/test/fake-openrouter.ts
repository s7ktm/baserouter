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

// The generation ids the fake hands out in its X-Generation-Id header.
export const IDS = {
  images: "gen-img-1795300007-FixtureImages00001",
  speech: "gen-tts-1795300009-FixtureSpeech00001",
  transcription: "gen-stt-1795300010-FixtureTranscribe1",
} as const;

// 4,000 bytes of 16-bit PCM: what /audio/speech sends for response_format "pcm".
export const PCM = new Uint8Array(4000).map((_, i) => (i * 7) % 256);

export interface Fake {
  url: string;
  chats: { key: string | null; body: string }[]; // every chat request received
  posts: { path: string; key: string | null; contentType: string | null; body: Uint8Array }[]; // every POST received, chat included
  lookups: string[]; // every generation id asked for
  cancelled: Promise<void>; // settles when a "fixture/hang" stream is cancelled by its reader
  stop(): Promise<void>;
}

export function startFake(port = 0): Fake {
  const chats: Fake["chats"] = [];
  const posts: Fake["posts"] = [];
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
        const id = url.searchParams.get("id") ?? "";
        lookups.push(id);
        return json(id === IDS.speech ? "generation-speech.json" : "generation.json");
      }
      if (req.method !== "POST") return new Response("Not found", { status: 404 });

      const bytes = new Uint8Array(await req.arrayBuffer());
      posts.push({ path: url.pathname, key, contentType: req.headers.get("content-type"), body: bytes });

      if (url.pathname === "/audio/transcriptions") return json("transcription.json", 200, { "X-Generation-Id": IDS.transcription });
      const { model, stream, modalities } = JSON.parse(new TextDecoder().decode(bytes)) as { model: string; stream?: boolean; modalities?: string[] };
      if (model === "fixture/429") return json("error-429.json", 429, { "Retry-After": "3" });

      if (url.pathname === "/images") {
        if (stream) return new Response(inPieces(await fixtureBytes("images-stream.sse")), { headers: { ...SSE, "X-Generation-Id": IDS.images } });
        return json("images.json", 200, { "X-Generation-Id": IDS.images });
      }
      // The sound comes as bytes, with no cost in it.
      if (url.pathname === "/audio/speech") {
        // Raw PCM has no header: just samples. OpenRouter says the format in the content type;
        // the model "fixture/pcm-no-rate" leaves it out.
        if ((JSON.parse(new TextDecoder().decode(bytes)) as { response_format?: string }).response_format === "pcm") {
          const type = model === "fixture/pcm-no-rate" ? "audio/pcm" : "audio/pcm;rate=24000;channels=1";
          return new Response(inPieces(PCM), { headers: { "Content-Type": type, "X-Generation-Id": IDS.speech } });
        }
        return new Response(inPieces(await fixtureBytes("speech.mp3")), { headers: { "Content-Type": "audio/mpeg", "X-Generation-Id": IDS.speech } });
      }
      if (url.pathname !== "/chat/completions") return new Response("Not found", { status: 404 });

      const body = new TextDecoder().decode(bytes);
      chats.push({ key, body });

      if (modalities?.includes("image")) {
        if (stream) return new Response(inPieces(await fixtureBytes("chat-image-stream.sse")), { headers: SSE });
        return json("chat-image.json");
      }
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

  return { url: `http://127.0.0.1:${server.port}`, chats, posts, lookups, cancelled: cancelled.promise, stop: () => server.stop(true) };
}

if (import.meta.main) {
  const fake = startFake(Number(process.env.PORT ?? 4142));
  console.log(`Fake OpenRouter: ${fake.url}  (key: ${FAKE_KEY})`);
  for (const [model, what] of Object.entries(SCENARIOS)) console.log(`  model "${model}": ${what}`);
}
