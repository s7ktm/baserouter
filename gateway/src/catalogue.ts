// The provider's models, as the panel shows them when a route's model is chosen: what each
// one is called, what it makes and takes, how much it can read, and what it costs, all as
// OpenRouter says. Only the models the gateway can use are listed: those that write text, or
// make images, speech, transcriptions or video. Embeddings, reranking and moderation models
// have no endpoint here yet.

import { usable } from "./openrouter.ts";

// What a model makes, in the panel's words. OpenRouter's "audio" (sound out of a chat
// answer) is speech too.
export type Makes = "text" | "image" | "speech" | "transcription" | "video";
const MAKES: Record<string, Makes> = { text: "text", image: "image", speech: "speech", audio: "speech", transcription: "transcription", video: "video" };

export interface CatalogueModel {
  id: string;
  name: string;
  makes: Makes[];
  takes: string[]; // OpenRouter's input_modalities: text, image, file, audio, video
  context: number | null; // tokens it can read at once
  in: number | null; // US dollars per token read, when it is priced by the token
  out: number | null; // US dollars per token written
  perSecond: number | null; // US dollars per second of video, the lowest of its prices
  free: boolean;
}

const object = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const price = (v: unknown): number | null => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// The lowest price per second of video OpenRouter gives for a model. Its video list names
// prices by what they count: "duration_seconds_…" in dollars, "cents_per_…second…" in cents.
// Prices per token, per image or for continuing a video are not prices per second.
export function perSecond(skus: unknown): number | null {
  const found: number[] = [];
  for (const [name, value] of Object.entries(object(skus) ?? {})) {
    const n = price(value);
    if (n === null || /reference|continuation|megapixel|input|minimum/.test(name)) continue;
    if (/^(long_)?duration_seconds/.test(name)) found.push(n);
    else if (/^cents_per_(video_output_)?second/.test(name)) found.push(n / 100);
  }
  return found.length ? Math.min(...found) : null;
}

// OpenRouter's /models list (every model) and its /videos/models list, in OpenRouter's order.
export function catalogue(models: unknown, videoModels: unknown = []): CatalogueModel[] {
  const videoPrices = new Map<string, number | null>();
  for (const v of Array.isArray(videoModels) ? videoModels : []) {
    const m = object(v);
    if (m && typeof m.id === "string") videoPrices.set(m.id, perSecond(m.pricing_skus));
  }
  const out: CatalogueModel[] = [];
  for (const item of Array.isArray(models) ? models : []) {
    const m = object(item);
    if (!m || typeof m.id !== "string" || !usable(m.id)) continue;
    const architecture = object(m.architecture);
    const makes = [...new Set(strings(architecture?.output_modalities).map((k) => MAKES[k]).filter((k): k is Makes => k !== undefined))];
    if (!makes.length) continue;
    const pricing = object(m.pricing);
    const byToken = makes.includes("text");
    const context = typeof m.context_length === "number" && m.context_length > 0 ? m.context_length : null;
    out.push({
      id: m.id,
      name: typeof m.name === "string" && m.name ? m.name : m.id,
      makes,
      takes: strings(architecture?.input_modalities),
      context,
      in: byToken ? price(pricing?.prompt) : null,
      out: byToken ? price(pricing?.completion) : null,
      perSecond: videoPrices.get(m.id) ?? null,
      free: m.id.endsWith(":free"),
    });
  }
  return out;
}

// One place a model comes from, as OpenRouter's endpoints list for that model gives it.
// tag is what a route's line names ("google-vertex", "google-ai-studio/flex"); tier is a
// faster or cheaper service tier of the same provider, when it is one.
export interface ModelProvider {
  tag: string;
  name: string;
  tier: string | null;
  in: number | null; // US dollars per token read, for models priced by the token
  out: number | null;
  context: number | null;
  up: boolean; // OpenRouter counts it as working right now (status 0)
}

export function providersOf(data: unknown): ModelProvider[] {
  const endpoints = object(data)?.endpoints;
  const seen = new Set<string>();
  const out: ModelProvider[] = [];
  for (const item of Array.isArray(endpoints) ? endpoints : []) {
    const e = object(item);
    if (!e || typeof e.tag !== "string" || seen.has(e.tag)) continue;
    seen.add(e.tag);
    const pricing = object(e.pricing);
    const context = typeof e.context_length === "number" && e.context_length > 0 ? e.context_length : null;
    out.push({
      tag: e.tag,
      name: typeof e.provider_name === "string" && e.provider_name ? e.provider_name : e.tag,
      tier: typeof e.service_tier === "string" && e.service_tier ? e.service_tier : null,
      in: price(pricing?.prompt),
      out: price(pricing?.completion),
      context,
      up: e.status === 0 || e.status === undefined,
    });
  }
  return out;
}
