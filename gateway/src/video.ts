// Video. OpenRouter makes a video as a job: POST /videos starts it and answers 202 with the
// job's id; GET /videos/:id says how far it has got; once it is "completed" that answer carries
// the cost and links to the video, GET /videos/:id/content?index=n. The cost is known only
// then: it is not in the first answer, and /generation does not know video jobs.
//
// So the gateway watches each job itself, from the moment it starts until it ends, whether or
// not the client asks about it. When it ends, its cost is recorded against the route and, if
// the route keeps what it makes, the video is fetched and kept. A client asking about a job
// that has ended settles it the same way; whichever comes first records it, once. Jobs still
// open when the gateway stops are watched again when it starts.
import { later, type Deps } from "./deps.ts";
import type { MediaKeeper } from "./media.ts";
import * as openrouter from "./openrouter.ts";
import { unseal } from "./secrets.ts";
import type { VideoJobRow } from "./store.ts";

// The statuses after which nothing more happens to a job.
export const FINISHED = new Set(["completed", "failed", "cancelled", "expired"]);

// The longest a video is fetched for, to be kept.
const FETCH_MS = 10 * 60_000;

const object = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// What OpenRouter says about a job: its status, its cost once known, how many videos it made.
export interface JobStatus {
  id: string;
  status: string;
  cost: number | null;
  outputs: number;
}

export function readJob(value: unknown): JobStatus | null {
  const doc = object(value);
  if (!doc || typeof doc.id !== "string" || typeof doc.status !== "string") return null;
  const cost = object(doc.usage)?.cost;
  return {
    id: doc.id,
    status: doc.status,
    cost: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    outputs: Array.isArray(doc.unsigned_urls) ? doc.unsigned_urls.length : 0,
  };
}

// A job's answer as the client gets it. Its links lead to the gateway ("base" is the one
// address as the client reached it), to be opened with the route's key; OpenRouter's own
// would need the key the gateway holds. OpenRouter's signed storage links ("urls", with
// "expires_at") are left out: they open the video without any key, around the gateway,
// and carry the OpenRouter account's id. The rest is as OpenRouter wrote it.
export function forClient(value: Record<string, unknown>, base: string): Record<string, unknown> {
  const { urls: _, expires_at: __, ...doc } = value;
  if (typeof doc.id !== "string") return doc;
  const at = `${base}/videos/${encodeURIComponent(doc.id)}`;
  if ("polling_url" in doc) doc.polling_url = at;
  if (Array.isArray(doc.unsigned_urls)) doc.unsigned_urls = doc.unsigned_urls.map((_, i) => `${at}/content?index=${i}`);
  return doc;
}

export class VideoWatcher {
  #watching = new Set<string>();

  constructor(
    private readonly deps: Deps,
    private readonly keeper: MediaKeeper,
  ) {}

  // Watches a job until it ends. Watching one already watched does nothing.
  watch(id: string): void {
    if (this.#watching.has(id)) return;
    this.#watching.add(id);
    later(this.deps, this.#loop(id).finally(() => this.#watching.delete(id)));
  }

  // The jobs a gateway that stopped was still watching.
  resume(): void {
    for (const job of this.deps.store.openVideoJobs()) this.watch(job.id);
  }

  async #loop(id: string): Promise<void> {
    const { store, videoPollDelays: delays } = this.deps;
    for (let i = 0; ; i++) {
      await Bun.sleep(delays[Math.min(i, delays.length - 1)]!);
      const job = store.videoJob(id);
      if (!job || job.done_at !== null) return;
      const status = await this.#ask(id).catch(() => null);
      if (status && (await this.observe(job, status))) return;
      // A job OpenRouter never finishes is given up on; its cost stays unknown.
      if (this.deps.now() - job.created_at > this.deps.videoGiveUpMs) {
        store.finishVideoJob(id, { status: "expired", at: this.deps.now(), cost: null, failure: "upstream_error" });
        return;
      }
    }
  }

  async #ask(id: string): Promise<JobStatus | null> {
    const key = this.#key();
    if (!key) return null;
    const res = await openrouter.get(this.deps.upstream, key, `/videos/${encodeURIComponent(id)}`, AbortSignal.timeout(30_000));
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return readJob(await res.json());
  }

  #key(): string | null {
    const provider = this.deps.store.providers()[0];
    return provider ? unseal(this.deps.master, provider.key_sealed) : null;
  }

  // Takes in what OpenRouter said about a job, from the gateway's own watch or from an answer
  // a client asked for. True once the job has ended. The one that ends it records its cost
  // and starts keeping its video.
  async observe(job: VideoJobRow, status: JobStatus): Promise<boolean> {
    const { store } = this.deps;
    if (!FINISHED.has(status.status)) {
      store.videoJobStatus(job.id, status.status);
      return false;
    }
    const made = status.status === "completed";
    const ended = store.finishVideoJob(job.id, { status: status.status, at: this.deps.now(), cost: status.cost, failure: made ? null : "upstream_error" });
    if (ended && made && job.keep === 1 && this.keeper.on && job.request_id !== null && job.route_id !== null) {
      later(this.deps, this.#keep(job, Math.max(status.outputs, 1)));
    }
    return true;
  }

  // Fetches the job's videos into the media folder, as they arrive.
  async #keep(job: VideoJobRow, outputs: number): Promise<void> {
    const key = this.#key();
    if (!key) return;
    for (let index = 0; index < outputs; index++) {
      const file = this.keeper.start("video");
      if (!file) return;
      try {
        const res = await openrouter.get(this.deps.upstream, key, `/videos/${encodeURIComponent(job.id)}/content?index=${index}`, AbortSignal.timeout(FETCH_MS));
        if (!res.ok || !res.body) {
          await res.body?.cancel();
          file.drop();
          continue;
        }
        for await (const piece of res.body) if (!file.write(piece)) break;
        await file.finish({ requestId: job.request_id!, routeId: job.route_id!, model: job.model, prompt: job.prompt });
      } catch {
        file.drop();
      }
    }
  }
}
