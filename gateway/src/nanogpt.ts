// NanoGPT, the second provider: plain calls to its API, as openrouter.ts is for OpenRouter.
// What its API does and where it differs from OpenRouter's is written down in docs/nanogpt.md.
//
// "up.baseUrl" is https://api.nano-gpt.com/api. Most endpoints are under /v1 there; video and
// the list of a model's own providers are not.
import type { CatalogueModel, Makes, ModelProvider } from "./catalogue.ts";
import { publicUrl } from "./media.ts";
import { errorMessage, type Check, type Generation, type Upstream } from "./openrouter.ts";

const auth = (key: string) => ({ Authorization: `Bearer ${key}` });
const object = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const amount = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
// A price per token from one per "per" tokens, without the digits that dividing in binary adds.
const perToken = (v: unknown, per: number): number | null => (amount(v) === null ? null : Number((amount(v)! / per).toPrecision(12)));
// A small number written out in full ("0.0000001", not "1e-7"), as OpenRouter writes its prices.
const written = (n: number): string => (n === 0 ? "0" : n.toFixed(18).replace(/0+$/, "").replace(/\.$/, ""));

// The gateway names an endpoint the way OpenRouter does; this is where NanoGPT has it.
// /v1/images/generations is the one that takes what OpenAI clients send ("size", "response_format").
const PATHS: Record<string, string> = {
  "/chat/completions": "/v1/chat/completions",
  "/images": "/v1/images/generations",
  "/audio/speech": "/v1/audio/speech",
  "/audio/transcriptions": "/v1/audio/transcriptions",
  "/videos": "/generate-video",
};

export function send(up: Upstream, key: string, path: string, body: Uint8Array | string, contentType: string, signal: AbortSignal): Promise<Response> {
  return up.fetch(`${up.baseUrl}${PATHS[path] ?? path}`, { method: "POST", headers: { ...auth(key), "Content-Type": contentType }, body, signal });
}

export function get(up: Upstream, key: string, path: string, signal?: AbortSignal): Promise<Response> {
  return up.fetch(`${up.baseUrl}${path}`, { headers: auth(key), signal });
}

// NanoGPT stops checking a key it has refused many times, and answers 429 instead of 401.
// That is the key's problem, not the load's; the header says so.
export const keyRefused = (res: Response): boolean => res.status === 401 || res.headers.has("x-nanogpt-auth-rate-limit-reason");

// ---- models ----

// The lists are the same for every key and change slowly, so each is asked for once in ten minutes.
const LIST_MS = 10 * 60_000;
const lists = new Map<string, { at: number; data: Promise<Record<string, unknown>[] | null> }>();

function list(up: Upstream, key: string, path: string): Promise<Record<string, unknown>[] | null> {
  const name = `${up.baseUrl}${path}`;
  const kept = lists.get(name);
  if (kept && Date.now() - kept.at < LIST_MS) return kept.data;
  const data = get(up, key, path, AbortSignal.timeout(15_000))
    .then(async (res) => {
      if (!res.ok) throw new Error(await errorMessage(res));
      const rows = ((await res.json()) as { data?: unknown }).data;
      return Array.isArray(rows) ? rows.map(object).filter((m) => m !== null) : [];
    })
    .catch(() => {
      lists.delete(name); // a list that could not be had is asked for again next time
      return null;
    });
  lists.set(name, { at: Date.now(), data });
  return data;
}

// The lowest price per second NanoGPT gives for a video model, when it prices by the second.
function perSecond(pricing: Record<string, unknown> | null): number | null {
  const flat = amount(pricing?.per_second);
  if (flat !== null) return flat;
  const tiers = Object.values(object(pricing?.per_second_by_resolution) ?? {}).map(amount).filter((n) => n !== null);
  return tiers.length ? Math.min(...tiers) : null;
}

// What a model in the audio list makes. Music comes from the speech endpoint too. The rest
// (sound effects, voice cloning, analysis) have no endpoint in BaseRouter.
function audioMakes(m: Record<string, unknown>): Makes | null {
  const can = object(m.capabilities);
  if (can?.speech_to_text === true || m.category === "audio_stt") return "transcription";
  if (can?.text_to_speech === true || m.category === "audio_tts" || m.category === "audio_music") return "speech";
  return null;
}

// What NanoGPT offers, in the shape of catalogue.ts: its four lists joined, each model with
// what it makes. A text model's prices are per million tokens there; here they are per token,
// as everywhere else in the gateway. Null when the text list cannot be had.
export async function offers(up: Upstream, key: string): Promise<CatalogueModel[] | null> {
  const [text, image, video, audio] = await Promise.all([
    list(up, key, "/v1/models?detailed=true"),
    list(up, key, "/v1/image-models"),
    list(up, key, "/v1/video-models"),
    list(up, key, "/v1/audio-models"),
  ]);
  if (!text) return null;
  const out: CatalogueModel[] = [];
  const seen = new Set<string>();
  const add = (m: Record<string, unknown>, makes: Makes | null, prices: Partial<CatalogueModel> = {}) => {
    // A paused entry says "available": false; the ones that work do not say.
    if (!makes || typeof m.id !== "string" || m.available === false || seen.has(m.id)) return;
    seen.add(m.id);
    const context = typeof m.context_length === "number" && m.context_length > 0 ? m.context_length : null;
    out.push({
      id: m.id, name: typeof m.name === "string" && m.name ? m.name : m.id, makes: [makes], takes: strings(object(m.architecture)?.input_modalities),
      context, in: null, out: null, perSecond: null, free: false, ...prices,
    });
  };
  for (const m of text) add(m, "text", { in: perToken(object(m.pricing)?.prompt, 1e6), out: perToken(object(m.pricing)?.completion, 1e6) });
  for (const m of image ?? []) add(m, "image");
  for (const m of video ?? []) add(m, "video", { perSecond: perSecond(object(m.pricing)) });
  for (const m of audio ?? []) add(m, audioMakes(m));
  return out;
}

// One of NanoGPT's models as an entry of /v1/models, in the shape OpenRouter's entries have,
// so a client reads the same fields whichever provider a model comes from.
export function listed(m: CatalogueModel): Record<string, unknown> {
  const made = m.makes.map((k) => (k === "speech" ? "audio" : k));
  return {
    id: m.id, object: "model", name: m.name, context_length: m.context,
    architecture: { input_modalities: m.takes, output_modalities: made },
    pricing: m.in === null || m.out === null ? {} : { prompt: written(m.in), completion: written(m.out) },
  };
}

// Which of NanoGPT's own providers can serve a model, with what each charges (per thousand
// tokens there, per token here). Empty for a model that cannot be pinned to one.
export async function providersOf(up: Upstream, key: string, model: string): Promise<ModelProvider[]> {
  const res = await get(up, key, `/models/${encodeURIComponent(model)}/providers`, AbortSignal.timeout(15_000));
  if (!res.ok) {
    await res.body?.cancel();
    return [];
  }
  const doc = object(await res.json());
  if (doc?.supportsProviderSelection !== true || !Array.isArray(doc.providers)) return [];
  const out: ModelProvider[] = [];
  for (const item of doc.providers) {
    const p = object(item);
    if (!p || typeof p.provider !== "string" || out.some((o) => o.tag === p.provider)) continue;
    const pricing = object(p.pricing);
    out.push({
      tag: p.provider, name: typeof p.displayName === "string" && p.displayName ? p.displayName : p.provider, tier: null,
      in: perToken(pricing?.inputPer1kTokens, 1000), out: perToken(pricing?.outputPer1kTokens, 1000),
      context: amount(p.maxInputTokens) || null, up: p.available !== false,
    });
  }
  return out;
}

// Tests a key: is it accepted, and how many models does NanoGPT offer.
export async function check(up: Upstream, key: string): Promise<Check> {
  try {
    const res = await get(up, key, "/v1/api-keys/current", AbortSignal.timeout(15_000));
    if (!res.ok) return { ok: false, error: await errorMessage(res) };
    const status = object(await res.json())?.status;
    if (typeof status === "string" && status !== "active") return { ok: false, error: `NanoGPT says this key is ${status.slice(0, 40)}.` };
    return { ok: true, models: (await offers(up, key))?.length ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- what a request cost ----

// Asks what a finished chat or image request was charged, by the X-Request-ID its answer came
// with. Null when NanoGPT does not know it (yet), or charged it in something other than dollars.
export async function billing(up: Upstream, key: string, id: string): Promise<Generation | null> {
  const res = await get(up, key, `/v1/usage/requests/${encodeURIComponent(id)}`, AbortSignal.timeout(15_000));
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  const doc = object(await res.json());
  const cost = typeof doc?.cost === "string" && doc.cost.trim() !== "" ? Number(doc.cost) : NaN;
  if (!doc || doc.currency !== "USD" || !Number.isFinite(cost) || cost < 0) return null;
  const usage = object(doc.usage);
  const count = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
  return { cost, promptTokens: count(usage?.input_tokens), completionTokens: count(usage?.output_tokens), model: null };
}

// A speech answer is the sound alone: no cost, and no id to ask with. What it cost is worked
// out from the characters sent and the model's listed price, so it is an estimate. Null when
// the list has no price per character for the model.
export async function speechCost(up: Upstream, key: string, model: string, input: unknown): Promise<number | null> {
  const said = typeof input === "string" ? input : Array.isArray(input) ? input.map((turn) => (typeof object(turn)?.text === "string" ? (object(turn)!.text as string) : "")).join("") : "";
  const entry = (await list(up, key, "/v1/audio-models"))?.find((m) => m.id === model);
  const per1k = amount(object(entry?.pricing)?.per_thousand_chars);
  return per1k === null || !said ? null : (said.length * per1k) / 1000;
}

// An image answer carries the account's balance and where the image is stored at NanoGPT.
// Neither is the client's business. Null when the answer has neither, so it is passed on as it came.
export function withoutAccount(doc: unknown): Record<string, unknown> | null {
  const answer = object(doc);
  if (!answer) return null;
  const entries = Array.isArray(answer.data) ? answer.data : [];
  if (!("remainingBalance" in answer) && !entries.some((e) => object(e) && "storageKey" in object(e)!)) return null;
  const { remainingBalance: _, ...rest } = answer;
  if (Array.isArray(rest.data)) rest.data = rest.data.map((e) => (object(e) ? (({ storageKey: _, ...kept }) => kept)(object(e)!) : e));
  return rest;
}

// ---- video ----

// NanoGPT's statuses, in the words the gateway's video jobs use (OpenRouter's).
const STATUS: Record<string, string> = { in_queue: "pending", queued: "pending", pending: "pending", in_progress: "in_progress", processing: "in_progress", completed: "completed", failed: "failed", canceled: "cancelled", cancelled: "cancelled" };

// A video job as NanoGPT describes it, read into what the gateway needs: its status in the
// gateway's words, where its videos are, and what went wrong.
export interface VideoStatus {
  id: string;
  status: string;
  links: string[];
  error: string | null;
}

// The answer that started a job, or the answer about one. The first is flat ("id", "status");
// the second keeps everything under "data".
export function readVideo(value: unknown, id?: string): VideoStatus | null {
  const doc = object(value);
  if (!doc) return null;
  const data = object(doc.data) ?? doc;
  const jobId = [id, doc.runId, doc.id, doc.requestId, data.request_id].find((v): v is string => typeof v === "string" && v !== "");
  if (!jobId || typeof data.status !== "string") return null;
  const output = object(data.output);
  const many = strings(output?.videoUrls);
  const one = [object(output?.video)?.url, data.videoUrl, data.video_url].find((v): v is string => typeof v === "string" && v !== "");
  const error = [data.userFriendlyError, data.error].find((v): v is string => typeof v === "string" && v !== "");
  return { id: jobId, status: STATUS[data.status.toLowerCase()] ?? data.status.toLowerCase(), links: many.length ? many : one ? [one] : [], error: error ?? null };
}

// The body that starts a job. NanoGPT takes the same flat fields, with "duration" as a
// string of seconds; a client that sends OpenRouter's number is understood too.
export function videoBody(fields: Record<string, unknown>, model: string): string {
  const { provider: _, ...rest } = fields;
  return JSON.stringify({ ...rest, model, ...(typeof fields.duration === "number" ? { duration: String(fields.duration) } : {}) });
}

export async function videoStatus(up: Upstream, key: string, id: string, signal?: AbortSignal): Promise<VideoStatus | null> {
  const res = await get(up, key, `/video/status?requestId=${encodeURIComponent(id)}`, signal ?? AbortSignal.timeout(30_000));
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  return readVideo(await res.json(), id);
}

// Fetches one of a job's videos. The link in the job's answer is a path at NanoGPT, which
// answers with a redirect to its storage. The key goes to NanoGPT only, never to the storage,
// and a redirect is followed only to a public https address.
export async function videoContent(up: Upstream, key: string, link: string, signal?: AbortSignal): Promise<Response> {
  const origin = new URL(up.baseUrl).origin;
  let url = new URL(link, origin);
  for (let hop = 0; hop < 4; hop++) {
    // A video may also be at the model's own provider, as a full address. Anywhere but
    // NanoGPT itself, only a public https address is fetched.
    if (url.origin !== origin && !publicUrl(url.href)) break;
    const res = await up.fetch(url, { headers: url.origin === origin ? auth(key) : {}, redirect: "manual", signal });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) return res;
    await res.body?.cancel();
    url = new URL(next, url);
  }
  return new Response(null, { status: 502 });
}
