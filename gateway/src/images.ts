// Keeps the images routes make, so they can be looked at again in the panel.
//
// Each image is a file in the images folder, named after the SHA-256 of its bytes, so the
// same image made twice is kept once. The database has a row per image: which request and
// route made it, the model, the prompt, its type and size. Files and rows are all there is;
// there is nothing to set up.
//
// What an image is comes from its first bytes, not from what the answer says, and only
// PNG, JPEG, WebP, GIF and SVG are kept.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Deps } from "./deps.ts";
import type { ImageRow } from "./store.ts";

// An image found in an answer: base64 bytes, or a link to fetch them from.
export type Found = { base64: string } | { url: string };

const object = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(object).filter((o) => o !== null) : []);

function fromUrl(url: unknown): Found | null {
  if (typeof url !== "string") return null;
  const data = /^data:[^;,]*;base64,/.exec(url);
  if (data) return { base64: url.slice(data[0].length) };
  return /^https:\/\//.test(url) ? { url } : null;
}

// The finished images in one answer, or in one event of a stream:
//   chat:    choices[].message.images[].image_url.url, or choices[].delta.images[] when streamed
//   /images: data[].b64_json or data[].url, or the "image_generation.completed" event when streamed
// Partial images of a stream are not kept.
export function imagesIn(value: unknown): Found[] {
  const doc = object(value);
  if (!doc) return [];
  const found: (Found | null)[] = [];
  for (const choice of list(doc.choices)) {
    for (const part of [...list(object(choice.message)?.images), ...list(object(choice.delta)?.images)]) found.push(fromUrl(object(part.image_url)?.url));
  }
  for (const item of list(doc.data)) found.push(typeof item.b64_json === "string" ? { base64: item.b64_json } : fromUrl(item.url));
  if (doc.type === "image_generation.completed" && typeof doc.b64_json === "string") found.push({ base64: doc.b64_json });
  return found.filter((f): f is Found => f !== null && ("url" in f || f.base64.length > 0));
}

// Whether a line of a stream may carry a finished image, so the scanner knows to read it.
export const mayCarryImages = (line: string) => line.includes('"images"') || line.includes("image_generation.completed");

const TYPES: [string, string, (b: Uint8Array) => boolean][] = [
  ["image/png", "png", (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ["image/jpeg", "jpg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/gif", "gif", (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38],
  ["image/webp", "webp", (b) => String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP"],
  ["image/svg+xml", "svg", (b) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(new TextDecoder().decode(b.subarray(0, 512)))],
];

export function sniff(bytes: Uint8Array): { mediaType: string; ext: string } | null {
  const match = TYPES.find(([, , test]) => test(bytes));
  return match ? { mediaType: match[0], ext: match[1] } : null;
}

// Images behind a link are fetched once, with a time and size limit.
const FETCH_MS = 30_000;
const FETCH_MAX = 50 * 1024 * 1024;

async function bytesOf(found: Found, fetcher: typeof fetch): Promise<Uint8Array | null> {
  if ("base64" in found) {
    const bytes = Buffer.from(found.base64, "base64");
    return bytes.length > 0 ? new Uint8Array(bytes) : null;
  }
  const res = await fetcher(found.url, { signal: AbortSignal.timeout(FETCH_MS) });
  if (!res.ok || !res.body) return null;
  if (Number(res.headers.get("content-length") ?? 0) > FETCH_MAX) return null;
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const part of res.body) {
    if ((size += part.byteLength) > FETCH_MAX) return null;
    parts.push(part);
  }
  return new Uint8Array(Buffer.concat(parts));
}

export interface Made {
  requestId: number;
  routeId: string;
  model: string | null;
  prompt: string | null;
}

// The words of a request that made images, shortened: the prompt of /images, or the
// last thing the user said in a chat.
export function promptOf(kind: "chat" | "images", body: Record<string, unknown>): string | null {
  let text: string | null = null;
  if (kind === "images") text = typeof body.prompt === "string" ? body.prompt : null;
  else {
    const said = list(body.messages).filter((m) => m.role === "user").at(-1)?.content;
    if (typeof said === "string") text = said;
    else text = list(said).filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text as string).join("\n") || null;
  }
  return text ? text.slice(0, 2000) : null;
}

export class ImageKeeper {
  constructor(private readonly deps: Pick<Deps, "store" | "now" | "imagesDir" | "imagesMaxBytes" | "upstream">) {
    if (deps.imagesDir) mkdirSync(deps.imagesDir, { recursive: true, mode: 0o700 });
  }

  get on(): boolean {
    return this.deps.imagesDir !== null && this.deps.imagesMaxBytes > 0;
  }

  path(row: ImageRow): string {
    return join(this.deps.imagesDir!, row.file);
  }

  // Writes the images a request made, then removes the oldest images while all of them
  // together are over the limit.
  async keep(made: Made, found: Found[]): Promise<void> {
    if (!this.on) return;
    const { store } = this.deps;
    for (const item of found) {
      const bytes = await bytesOf(item, this.deps.upstream.fetch).catch(() => null);
      if (!bytes || bytes.length > this.deps.imagesMaxBytes) continue;
      const type = sniff(bytes);
      if (!type) continue;
      const file = `${createHash("sha256").update(bytes).digest("hex")}.${type.ext}`;
      const target = join(this.deps.imagesDir!, file);
      if (!(await Bun.file(target).exists())) await Bun.write(target, bytes, { mode: 0o600 });
      store.addImage({
        id: randomBytes(8).toString("hex"), request_id: made.requestId, route_id: made.routeId, created_at: this.deps.now(),
        model: made.model, prompt: made.prompt, media_type: type.mediaType, bytes: bytes.length, file,
      });
    }
    this.trim();
  }

  // Removes an image. Its file goes too, unless another image row has the same bytes.
  remove(id: string): boolean {
    const row = this.deps.store.image(id);
    if (!row) return false;
    this.deps.store.removeImage(id);
    if (!this.deps.store.fileInUse(row.file)) rmSync(this.path(row), { force: true });
    return true;
  }

  trim(): void {
    const { store, imagesMaxBytes } = this.deps;
    while (store.imageSpace().bytes > imagesMaxBytes) {
      const oldest = store.oldestImage();
      if (!oldest || !this.remove(oldest.id)) return;
    }
  }
}
