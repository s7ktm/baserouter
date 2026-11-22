// Video jobs through the one address, end to end against the fake OpenRouter: started,
// watched until they end, their cost recorded, their video kept.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaKeeper, sniff } from "../src/media.ts";
import { forClient, VideoWatcher } from "../src/video.ts";
import { fixtureBytes, VIDEO_ID } from "./fake-openrouter.ts";
import { startGateway, until, type Gateway } from "./harness.ts";

let dir: string;
let gw: Gateway;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "baserouter-video-"));
  gw = startGateway({ mediaDir: dir });
});
afterEach(async () => {
  await gw.stop();
  rmSync(dir, { recursive: true, force: true });
});

const ask = { model: "x-ai/grok-imagine-video-1.5-lite", prompt: "A paper boat drifting on a calm pond.", duration: 1, resolution: "480p" };

function start(key: string, body: object = ask, headers: Record<string, string> = {}) {
  return fetch(`${gw.url}/v1/videos`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const get = (key: string, path: string) => fetch(`${gw.url}/v1${path}`, { headers: { Authorization: `Bearer ${key}` } });
type Job = { id: string; status: string; polling_url: string; unsigned_urls?: string[]; urls?: unknown; expires_at?: unknown; usage?: { cost: number } };
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error;
const kept = () => gw.store.media({ kind: "video", limit: 10 });

test("a job is started, sent on as written, recorded, and answered with a link to the gateway", async () => {
  const route = gw.addRoute();
  const res = await start(route.key);
  expect(res.status).toBe(202);
  const job = (await res.json()) as Job;
  expect(job.id).toStartWith("gen-vid-");
  expect(job.status).toBe("pending");
  expect(job.polling_url).toBe(`${gw.url}/v1/videos/${job.id}`);

  const sent = gw.fake.posts.find((p) => p.path === "/videos")!;
  expect(new TextDecoder().decode(sent.body)).toBe(JSON.stringify(ask));
  const row = gw.store.requests({ limit: 1 })[0]!;
  expect(row).toMatchObject({ kind: "video", model_requested: ask.model, status: 202, failure: null, upstream_id: job.id });
  expect(gw.store.videoJob(job.id)).toMatchObject({ route_id: route.id, request_id: row.id, prompt: ask.prompt, keep: 1 });
  expect(gw.fake.lookups).toEqual([]); // /generation does not know video jobs
});

test("the gateway watches a job by itself: its cost is recorded when it ends and its video is kept", async () => {
  const route = gw.addRoute();
  const { id } = (await (await start(route.key)).json()) as Job;
  await until(() => gw.store.videoJob(id)?.done_at !== null);
  await gw.settled();

  expect(gw.store.videoJob(id)!.status).toBe("completed");
  expect(gw.lastRequest()).toMatchObject({ kind: "video", cost_usd: 0.02, cost_source: "provider", failure: null });
  expect(gw.fake.videoDownloads).toEqual([`${id}/0`]);
  const [video] = kept();
  expect(video).toMatchObject({ kind: "video", media_type: "video/mp4", route_id: route.id, model: ask.model, prompt: ask.prompt, cost_usd: 0.02 });
  expect(video!.file).toEndWith(".mp4");
  expect(new Uint8Array(await Bun.file(join(dir, video!.file)).arrayBuffer())).toEqual(await fixtureBytes("video.mp4"));
  expect(gw.store.spentSince(route.id, 0)).toBe(0.02);
});

test("a client asking about its job gets OpenRouter's answer with the gateway's links, and the job is recorded once", async () => {
  gw.deps.videoPollDelays = [300]; // the client asks first
  const route = gw.addRoute();
  const { id } = (await (await start(route.key)).json()) as Job;

  const first = (await (await get(route.key, `/videos/${id}`)).json()) as Job;
  expect(first).toMatchObject({ id, status: "in_progress", polling_url: `${gw.url}/v1/videos/${id}` });
  const done = (await (await get(route.key, `/videos/${id}`)).json()) as Job;
  expect(done.status).toBe("completed");
  expect(done.usage?.cost).toBe(0.02);
  expect(done.unsigned_urls).toEqual([`${gw.url}/v1/videos/${id}/content?index=0`]);
  // OpenRouter's signed storage links open the video without a key and name the account.
  expect(done.urls).toBeUndefined();
  expect(done.expires_at).toBeUndefined();

  const video = await get(route.key, `/videos/${id}/content?index=0`);
  expect(video.status).toBe(200);
  expect(video.headers.get("content-type")).toBe("video/mp4");
  expect(new Uint8Array(await video.arrayBuffer())).toEqual(await fixtureBytes("video.mp4"));

  await gw.settled();
  expect(gw.store.requests({ limit: 10 })).toHaveLength(1); // asking is not recorded
  expect(gw.lastRequest()).toMatchObject({ cost_usd: 0.02, failure: null });
  expect(kept()).toHaveLength(1);
  expect(gw.fake.videoPolls).toEqual([id, id]); // the gateway's own watch found it done and did not ask
});

test("a job behind https is answered with https links", () => {
  const doc = forClient({ id: VIDEO_ID, polling_url: "https://openrouter.ai/api/v1/videos/x", status: "completed", unsigned_urls: ["a", "b"], urls: ["s"], expires_at: 1 }, "https://router.example/v1");
  expect(doc).toEqual({
    id: VIDEO_ID, status: "completed", polling_url: `https://router.example/v1/videos/${VIDEO_ID}`,
    unsigned_urls: [`https://router.example/v1/videos/${VIDEO_ID}/content?index=0`, `https://router.example/v1/videos/${VIDEO_ID}/content?index=1`],
  });
});

test("only the route that started a job can ask about it, fetch it, or continue it", async () => {
  const owner = gw.addRoute();
  const other = gw.addRoute({ name: "Robot arm" });
  const { id } = (await (await start(owner.key)).json()) as Job;

  for (const path of [`/videos/${id}`, `/videos/${id}/content`, "/videos/gen-vid-1-unknown"]) {
    const res = await get(other.key, path);
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("not_found");
  }
  const posts = gw.fake.posts.length;
  const res = await start(other.key, { ...ask, previous_job_id: id });
  expect(res.status).toBe(404);
  expect(gw.fake.posts.length).toBe(posts);
  expect((await start(owner.key, { ...ask, previous_job_id: id })).status).toBe(202);
});

test("a job that fails is recorded as failed, and nothing is kept", async () => {
  const route = gw.addRoute();
  const { id } = (await (await start(route.key, { ...ask, model: "fixture/video-fails" })).json()) as Job;
  await until(() => gw.store.videoJob(id)?.done_at !== null);
  await gw.settled();
  expect(gw.store.videoJob(id)!.status).toBe("failed");
  expect(gw.lastRequest()).toMatchObject({ cost_usd: null, cost_source: "unknown", failure: "upstream_error" });
  expect(kept()).toEqual([]);
  expect(gw.fake.videoDownloads).toEqual([]);
});

test("a job OpenRouter never finishes is given up on, with its cost unknown", async () => {
  gw.deps.videoGiveUpMs = 50;
  const route = gw.addRoute();
  const { id } = (await (await start(route.key, { ...ask, model: "fixture/video-slow" })).json()) as Job;
  await until(() => gw.store.videoJob(id)?.done_at !== null);
  expect(gw.store.videoJob(id)!.status).toBe("expired");
  expect(gw.lastRequest()).toMatchObject({ cost_usd: null, failure: "upstream_error" });
});

test("a route that does not keep media, or a request that says no, still records the cost but keeps no video", async () => {
  const off = gw.addRoute({ keep_media: 0 });
  const on = gw.addRoute({ name: "Robot arm" });
  const a = (await (await start(off.key)).json()) as Job;
  const b = (await (await start(on.key, ask, { "X-BaseRouter-Save": "no" })).json()) as Job;
  await until(() => gw.store.videoJob(a.id)?.done_at !== null && gw.store.videoJob(b.id)?.done_at !== null);
  await gw.settled();
  expect(gw.store.spentSince(off.id, 0)).toBe(0.02);
  expect(gw.store.spentSince(on.id, 0)).toBe(0.02);
  expect(kept()).toEqual([]);
  expect(gw.fake.posts.find((p) => p.path === "/videos")).toBeDefined();
});

test("a route over its budget cannot start a job, but can still ask about one and fetch it", async () => {
  gw.deps.videoPollDelays = [300];
  const route = gw.addRoute({ budget_usd: 1 });
  const { id } = (await (await start(route.key)).json()) as Job;
  gw.spend(route.id, 1);
  const refused = await start(route.key);
  expect(refused.status).toBe(402);
  expect((await errorOf(refused)).code).toBe("budget_used_up");
  expect((await get(route.key, `/videos/${id}`)).status).toBe(200);
  expect((await get(route.key, `/videos/${id}/content`)).status).toBe(200);
});

test("a route limited to some models may only start jobs with those, and sees only those video models", async () => {
  const route = gw.addRoute({ allow: ["google/veo-3.1-lite"] });
  const refused = await start(route.key);
  expect(refused.status).toBe(403);
  expect((await errorOf(refused)).code).toBe("model_not_allowed");

  const models = (await (await get(route.key, "/videos/models")).json()) as { data: { id: string }[] };
  expect(models.data.map((m) => m.id)).toEqual(["google/veo-3.1-lite"]);
  const all = (await (await get(gw.addRoute().key, "/videos/models")).json()) as { data: { id: string }[] };
  expect(all.data).toHaveLength(2);
});

test("a job with a callback is refused, so OpenRouter's signed links do not go around the gateway", async () => {
  const route = gw.addRoute();
  const res = await start(route.key, { ...ask, callback_url: "https://example.com/hook" });
  expect(res.status).toBe(400);
  expect((await errorOf(res)).code).toBe("invalid_request");
  expect(gw.fake.posts).toEqual([]);
});

test("a bad index is refused", async () => {
  const route = gw.addRoute();
  const { id } = (await (await start(route.key)).json()) as Job;
  expect((await get(route.key, `/videos/${id}/content?index=first`)).status).toBe(400);
});

test("jobs still open when the gateway stopped are watched again when it starts", async () => {
  const route = gw.addRoute();
  gw.deps.videoPollDelays = [60_000]; // this gateway's own watch would only ask in a minute
  const { id } = (await (await start(route.key)).json()) as Job;
  gw.deps.videoPollDelays = [10];
  // What a new start does: a new watcher picks up the jobs that are not done.
  new VideoWatcher(gw.deps, new MediaKeeper(gw.deps)).resume();
  await until(() => gw.store.videoJob(id)?.done_at !== null);
  expect(gw.lastRequest()).toMatchObject({ cost_usd: 0.02 });
  await until(() => readdirSync(dir).some((f) => f.endsWith(".mp4")));
  // The first watcher is still asleep; let the test end without waiting a minute for it.
  gw.deps.background.clear();
});

test("an MP4 is a video when a video is expected, and sound when sound is", async () => {
  const head = (await fixtureBytes("video.mp4")).subarray(0, 64);
  expect(sniff(head, "video")?.mediaType).toBe("video/mp4");
  expect(sniff(head, "audio")?.mediaType).toBe("audio/mp4");
  expect(sniff(head)?.mediaType).toBe("audio/mp4");
});
