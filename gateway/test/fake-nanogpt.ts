// A stand-in for NanoGPT that answers from the files in fixtures/nanogpt/. The tests start it
// on a free port; its address plus "/api" is what the gateway is given as NanoGPT's.
// The model name picks what happens: see SCENARIOS.
import { join } from "node:path";
import { fixtureBytes } from "./fake-openrouter.ts";

export const NANO_KEY = "fixture-nanogpt-key";
// A key NanoGPT has refused so often that it stopped checking it.
export const NANO_THROTTLED_KEY = "fixture-nanogpt-throttled";

const dir = join(import.meta.dir, "fixtures", "nanogpt");
export const nanoFixture = (name: string) => Bun.file(join(dir, name));

export const SCENARIOS = {
  "fixture/429": "a rate limit, before any response",
  "fixture/video-fails": "a video job that fails",
  'provider { only: ["fixture-down"] }': "any chat request: no such provider for the model (HTTP 400)",
} as const;

// The ids in the fixtures: a chat request's and an image request's X-Request-ID, and a video job's.
export const NANO_IDS = {
  chat: "req_00000000-0000-4000-8000-00000000f1c5",
  image: "media-image:00000000-0000-4000-8000-0000000000ac:1795300000000:fixtur",
  video: "vid_fixture0000000000001",
} as const;
const videoId = (n: number) => `vid_fixture${String(n + 1).padStart(13, "0")}`;

const JSON_TYPE = { "Content-Type": "application/json" };
const json = (file: string, status = 200, headers: Record<string, string> = {}) => new Response(nanoFixture(file), { status, headers: { ...JSON_TYPE, ...headers } });
const said = (body: unknown, status: number, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_TYPE, ...headers } });

export interface FakeNano {
  url: string; // without "/api"
  posts: { path: string; key: string | null; contentType: string | null; body: Uint8Array }[]; // every POST received
  lists: string[]; // every model list asked for, as its path and query
  lookups: string[]; // every request id whose cost was asked for
  videoPolls: string[]; // every video job id asked about
  downloads: { path: string; key: string | null }[]; // every video fetched, and the key it was asked for with
  stop(): Promise<void>;
}

export function startFakeNano(port = 0): FakeNano {
  const posts: FakeNano["posts"] = [];
  const lists: string[] = [];
  const lookups: string[] = [];
  const videoPolls: string[] = [];
  const downloads: FakeNano["downloads"] = [];
  // A job is in progress the first time it is asked about, and finished the second time.
  const jobs = new Map<string, { model: string; polls: number }>();
  const asJob = async (file: string, id: string, status = 200) => new Response((await nanoFixture(file).text()).replaceAll(NANO_IDS.video, id), { status, headers: JSON_TYPE });

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const key = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;

      // NanoGPT's own storage, where a video's link redirects to. It takes no key.
      if (path === "/storage/video.mp4") {
        downloads.push({ path, key });
        return new Response(await fixtureBytes("video.mp4"), { headers: { "Content-Type": "video/mp4" } });
      }
      if (key === NANO_THROTTLED_KEY) {
        return said(
          { error: { message: "This API key was rejected repeatedly and is temporarily rate limited.", type: "authentication_error", code: "authentication_rate_limited", status: 429 } },
          429,
          { "Retry-After": "59", "x-nanogpt-auth-rate-limit-reason": "credential_blocked" },
        );
      }
      if (key !== NANO_KEY) {
        // The older endpoints (video, balance) refuse in plain text.
        if (!path.startsWith("/api/v1/")) return new Response("Invalid session", { status: 401, headers: { "Content-Type": "text/plain;charset=UTF-8" } });
        return said({ error: { message: "Invalid Authentication", type: "invalid_request_error", code: "missing_api_key", status: 401 } }, 401);
      }

      if (req.method === "GET") {
        if (path === "/api/v1/api-keys/current") return json("key.json");
        const listed: Record<string, string> = { "/api/v1/models": "models.json", "/api/v1/image-models": "image-models.json", "/api/v1/video-models": "video-models.json", "/api/v1/audio-models": "audio-models.json" };
        if (listed[path]) {
          lists.push(path + url.search);
          return json(listed[path]!);
        }
        const provided = /^\/api\/models\/([^/]+)\/providers$/.exec(path);
        if (provided) {
          const id = decodeURIComponent(provided[1]!);
          if (id !== "moonshotai/kimi-k2.5") return said({ canonicalId: id, supportsProviderSelection: false, providerDetails: [], message: "This model does not support provider selection" }, 200);
          return json("model-providers.json");
        }
        const billed = /^\/api\/v1\/usage\/requests\/(.+)$/.exec(path);
        if (billed) {
          const id = decodeURIComponent(billed[1]!);
          lookups.push(id);
          if (id === NANO_IDS.chat) return json("billing.json");
          if (id === NANO_IDS.image) return json("billing-image.json");
          return said({ error: { type: "invalid_request_error", code: "billing_record_not_found", message: "No recorded primary charge is available within the last 24 hours." } }, 404, { "Retry-After": "30" });
        }
        if (path === "/api/video/status") {
          const id = url.searchParams.get("requestId") ?? url.searchParams.get("runId") ?? "";
          const job = jobs.get(id);
          if (!job) return said({ error: "Video generation request not found" }, 404);
          videoPolls.push(id);
          job.polls++;
          if (job.polls < 2) return asJob("video-in-progress.json", id);
          return asJob(job.model === "fixture/video-fails" ? "video-failed.json" : "video-completed.json", id);
        }
        // The link in a finished job's answer: a redirect to the storage.
        if (path === "/api/generate-video/content") {
          downloads.push({ path: path + url.search, key });
          return new Response(null, { status: 302, headers: { Location: "/storage/video.mp4", "Cache-Control": "private, no-store" } });
        }
        return said({ error: { code: "route_not_available", message: "This route is not available on the standalone API." } }, 404);
      }
      if (req.method !== "POST") return new Response(null, { status: 405 });

      const bytes = new Uint8Array(await req.arrayBuffer());
      posts.push({ path, key, contentType: req.headers.get("content-type"), body: bytes });

      // No request id comes with a transcription or with speech.
      if (path === "/api/v1/audio/transcriptions") return json("transcription.json");
      const body = JSON.parse(new TextDecoder().decode(bytes)) as { model: string; stream?: boolean; stream_options?: { include_usage?: boolean }; provider?: { only?: string[] }; response_format?: string };
      if (body.model === "fixture/429") return said({ error: { message: "Rate limit exceeded.", type: "rate_limit_error", code: "rate_limit_exceeded" } }, 429, { "Retry-After": "3" });

      if (path === "/api/v1/chat/completions") {
        if (body.provider?.only?.includes("fixture-down")) {
          return said({ error: { message: `None of your allowed providers can serve model ${body.model}.`, type: "invalid_request_error", code: "no_allowed_provider_for_model" } }, 400);
        }
        const headers = { "X-Request-ID": NANO_IDS.chat, "x-nanogpt-api-key-masking": "on" };
        // The last chunk carries the cost in "x_nanogpt_pricing" either way; "usage" only when asked for.
        if (body.stream) return new Response(nanoFixture(body.stream_options?.include_usage ? "chat-stream-usage.sse" : "chat-stream.sse"), { headers: { "Content-Type": "text/event-stream", ...headers } });
        return json("chat.json", 200, headers);
      }
      if (path === "/api/v1/images/generations") return json(body.response_format === "url" ? "images-url.json" : "images.json", 200, { "X-Request-ID": NANO_IDS.image });
      if (path === "/api/v1/audio/speech") return new Response(await fixtureBytes("speech.mp3"), { headers: { "Content-Type": "audio/mp3" } });
      if (path === "/api/generate-video") {
        const id = videoId(jobs.size);
        jobs.set(id, { model: body.model, polls: 0 });
        return asJob("video-start.json", id, 202);
      }
      return said({ error: { code: "route_not_available", message: "This route is not available on the standalone API." } }, 404);
    },
  });

  return { url: `http://127.0.0.1:${server.port}`, posts, lists, lookups, videoPolls, downloads, stop: () => server.stop(true) };
}
