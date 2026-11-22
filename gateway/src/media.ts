// Keeps the images, sound and video routes make, so they can be looked at, listened to and
// watched again in the panel.
//
// Each one is a file in the media folder, named after the SHA-256 of its bytes, so the same
// image or sound made twice is kept once. The database has a row each: which request and
// route made it, the model, the words that asked for it, its type and size.
//
// Files are written as they arrive, through a temporary file, so a large one is never held
// in memory whole: the sound of /audio/speech is written while it streams to the client.
// What a file is comes from its first bytes, not from what the answer says. Only these
// are kept: PNG, JPEG, WebP, GIF and SVG images; MP3, WAV, Ogg (Opus, Vorbis), FLAC, AAC,
// MP4 audio and WebM sound; MP4, WebM and QuickTime video. Raw PCM sound has no header
// saying how to play it: when the
// answer says its sample rate (OpenRouter's "audio/pcm;rate=24000;channels=1"), a WAV header
// is written in front of it, so it can be played; when it does not, it is not kept.
import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { FileSink } from "bun";
import type { Deps } from "./deps.ts";
import type { MediaKind, MediaRow } from "./store.ts";

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

const text = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

type Type = { mediaType: string; ext: string; kind: MediaKind };
const TYPES: [Type, (b: Uint8Array) => boolean][] = [
  [{ mediaType: "image/png", ext: "png", kind: "image" }, (b) => b[0] === 0x89 && text(b, 1, 4) === "PNG"],
  [{ mediaType: "image/jpeg", ext: "jpg", kind: "image" }, (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  [{ mediaType: "image/gif", ext: "gif", kind: "image" }, (b) => text(b, 0, 4) === "GIF8"],
  [{ mediaType: "image/webp", ext: "webp", kind: "image" }, (b) => text(b, 0, 4) === "RIFF" && text(b, 8, 12) === "WEBP"],
  [{ mediaType: "image/svg+xml", ext: "svg", kind: "image" }, (b) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(new TextDecoder().decode(b.subarray(0, 512)))],
  [{ mediaType: "audio/wav", ext: "wav", kind: "audio" }, (b) => text(b, 0, 4) === "RIFF" && text(b, 8, 12) === "WAVE"],
  [{ mediaType: "audio/ogg", ext: "ogg", kind: "audio" }, (b) => text(b, 0, 4) === "OggS"],
  [{ mediaType: "audio/flac", ext: "flac", kind: "audio" }, (b) => text(b, 0, 4) === "fLaC"],
  [{ mediaType: "audio/mpeg", ext: "mp3", kind: "audio" }, (b) => text(b, 0, 3) === "ID3"],
  // AAC (ADTS) and MP3 both start with a frame sync; the layer bits tell them apart.
  [{ mediaType: "audio/aac", ext: "aac", kind: "audio" }, (b) => b[0] === 0xff && (b[1]! & 0xf6) === 0xf0],
  [{ mediaType: "audio/mpeg", ext: "mp3", kind: "audio" }, (b) => b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && (b[1]! & 0x06) !== 0],
  [{ mediaType: "audio/mp4", ext: "m4a", kind: "audio" }, (b) => text(b, 4, 8) === "ftyp"],
  [{ mediaType: "audio/webm", ext: "webm", kind: "audio" }, (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3],
  // MP4 and WebM hold sound, video or both, and their first bytes do not say which; what was
  // asked for decides (see sniff). QuickTime is told apart by its brand.
  [{ mediaType: "video/quicktime", ext: "mov", kind: "video" }, (b) => text(b, 4, 10) === "ftypqt"],
  [{ mediaType: "video/mp4", ext: "mp4", kind: "video" }, (b) => text(b, 4, 8) === "ftyp"],
  [{ mediaType: "video/webm", ext: "webm", kind: "video" }, (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3],
];

// What a file is, from its first bytes. "want" is what kind it is expected to be, which
// decides for the containers that can be either (an MP4 from /videos is a video, from
// /audio/speech it is sound).
export function sniff(bytes: Uint8Array, want?: MediaKind): Type | null {
  return (want && TYPES.find(([type, test]) => type.kind === want && test(bytes))?.[0]) || (TYPES.find(([, test]) => test(bytes))?.[0] ?? null);
}

// The words that asked for a file, shortened: the prompt of /images, the text /audio/speech
// was asked to say, or the last thing the user said in a chat.
export function promptOf(kind: "chat" | "images" | "speech", body: Record<string, unknown>): string | null {
  let said: string | null = null;
  if (kind === "images") said = typeof body.prompt === "string" ? body.prompt : null;
  else if (kind === "speech") {
    said = typeof body.input === "string" ? body.input : list(body.input).map((turn) => (typeof turn.text === "string" ? turn.text : "")).filter(Boolean).join("\n") || null;
  } else {
    const content = list(body.messages).filter((m) => m.role === "user").at(-1)?.content;
    if (typeof content === "string") said = content;
    else said = list(content).filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text as string).join("\n") || null;
  }
  return said ? said.slice(0, 2000) : null;
}

// The format of raw PCM sound, from its content type: 16-bit little-endian samples (as
// OpenRouter's reference says), at the rate and with the channels the type names.
// Null when the type is not raw PCM, or does not say its rate.
export interface Pcm {
  rate: number;
  channels: number;
}
export const isPcm = (contentType: string) => /^\s*audio\/(pcm|l16)\b/i.test(contentType);
export function pcmFormat(contentType: string): Pcm | null {
  if (!isPcm(contentType)) return null;
  const param = (name: string) => Number(new RegExp(`;\\s*${name}\\s*=\\s*"?(\\d+)`, "i").exec(contentType)?.[1] ?? NaN);
  const rate = param("rate");
  const channels = param("channels") || 1;
  return rate >= 1000 && rate <= 384_000 && channels >= 1 && channels <= 8 ? { rate, channels } : null;
}

// A WAV header for 16-bit PCM. The two sizes are filled in once the length is known.
function wavHeader({ rate, channels }: Pcm, dataBytes = 0): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // size of the fmt chunk
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true); // bytes per second
  view.setUint16(32, channels * 2, true); // bytes per sample frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return header;
}

// Links are fetched once, with a time and size limit.
const FETCH_MS = 30_000;
const FETCH_MAX = 50 * 1024 * 1024;
const TEMP = ".part-";

// An https link whose host is a name or a public address: not localhost, not a loopback,
// private, link-local or unspecified address. (A name that resolves to such an address is
// not caught here; what is fetched is kept only if it is an image.)
export function publicUrl(link: string): boolean {
  const url = URL.parse(link);
  if (!url || url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "") return false;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)?.slice(1).map(Number);
  if (v4) {
    const [a, b] = v4 as [number, number];
    return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
  }
  if (host.includes(":")) return !(host === "::" || host === "::1" || /^(fc|fd|fe8|fe9|fea|feb)/.test(host) || host.startsWith("::ffff:"));
  return true;
}

export interface Made {
  requestId: number;
  routeId: string;
  model: string | null;
  prompt: string | null;
}

// One file being written: pieces go in as they come, then it is either finished (named by
// its hash, and given a row) or dropped. Over the size limit, it drops itself.
export class MediaFile {
  #sink: FileSink;
  #hash = new Bun.CryptoHasher("sha256");
  #head = new Uint8Array(512);
  #headSize = 0;
  #size = 0;
  #done = false;
  readonly #temp: string;

  // pcm: the pieces are raw PCM in this format, and a WAV header goes in front of them.
  constructor(private readonly keeper: MediaKeeper, private readonly kind: MediaKind, private readonly max: number, private readonly pcm: Pcm | null = null) {
    this.#temp = join(keeper.dir, TEMP + randomBytes(8).toString("hex"));
    this.#sink = Bun.file(this.#temp).writer({ highWaterMark: 1 << 20 });
    if (pcm) this.write(wavHeader(pcm));
  }

  get dropped(): boolean {
    return this.#done;
  }

  // Returns false once the file is dropped, so the caller can stop.
  write(piece: Uint8Array): boolean {
    if (this.#done) return false;
    if ((this.#size += piece.byteLength) > this.max) {
      this.drop();
      return false;
    }
    if (this.#headSize < this.#head.length) {
      const part = piece.subarray(0, this.#head.length - this.#headSize);
      this.#head.set(part, this.#headSize);
      this.#headSize += part.length;
    }
    this.#hash.update(piece);
    this.#sink.write(piece);
    return true;
  }

  drop(): void {
    if (this.#done) return;
    this.#done = true;
    void Promise.resolve(this.#sink.end()).catch(() => {}).finally(() => rmSync(this.#temp, { force: true }));
  }

  // Names the file and gives it a row. Nothing is kept when it is empty, too large, or not a
  // kind of file that is kept here.
  async finish(made: Made): Promise<MediaRow | null> {
    if (this.#done) return null;
    this.#done = true;
    await this.#sink.end();
    let hash = this.#hash.digest("hex");
    if (this.pcm && this.#size > 44) {
      // Now that the length is known, the header's two sizes are written, and the file is
      // hashed again as it now is.
      const sized = wavHeader(this.pcm, this.#size - 44);
      const fd = openSync(this.#temp, "r+");
      try {
        writeSync(fd, sized, 4, 4, 4);
        writeSync(fd, sized, 40, 4, 40);
      } finally {
        closeSync(fd);
      }
      const again = new Bun.CryptoHasher("sha256");
      for await (const piece of Bun.file(this.#temp).stream()) again.update(piece);
      hash = again.digest("hex");
    }
    const type = sniff(this.#head.subarray(0, this.#headSize), this.kind);
    if (this.#size === (this.pcm ? 44 : 0) || !type || type.kind !== this.kind) {
      rmSync(this.#temp, { force: true });
      return null;
    }
    const file = `${hash}.${type.ext}`;
    renameSync(this.#temp, join(this.keeper.dir, file)); // the same bytes kept twice end up in one file
    return this.keeper.added(made, { kind: type.kind, media_type: type.mediaType, bytes: this.#size, file });
  }
}

export class MediaKeeper {
  readonly dir: string;

  constructor(private readonly deps: Pick<Deps, "store" | "now" | "mediaDir" | "mediaMaxBytes" | "upstream">) {
    this.dir = deps.mediaDir ?? "";
    if (!deps.mediaDir) return;
    mkdirSync(deps.mediaDir, { recursive: true, mode: 0o700 });
    // Files a previous run was writing when it stopped.
    for (const name of readdirSync(deps.mediaDir)) if (name.startsWith(TEMP)) rmSync(join(deps.mediaDir, name), { force: true });
  }

  get on(): boolean {
    return this.deps.mediaDir !== null && this.deps.mediaMaxBytes > 0;
  }

  path(row: MediaRow): string {
    return join(this.dir, row.file);
  }

  // A file to write into as it arrives, or null when nothing is kept. With "pcm", the pieces
  // are raw PCM in that format and are kept as WAV.
  start(kind: MediaKind, pcm: Pcm | null = null): MediaFile | null {
    return this.on ? new MediaFile(this, kind, this.deps.mediaMaxBytes, pcm) : null;
  }

  // Keeps the images found in an answer.
  async keepImages(made: Made, found: Found[]): Promise<void> {
    for (const item of found) {
      const file = this.start("image");
      if (!file) return;
      try {
        if ("base64" in item) file.write(new Uint8Array(Buffer.from(item.base64, "base64")));
        else await this.#fetchInto(item.url, file);
        await file.finish(made);
      } catch {
        file.drop();
      }
    }
  }

  async #fetchInto(url: string, file: MediaFile): Promise<void> {
    // The link comes from the provider's answer. It is fetched only as it is, never by
    // following a redirect, and never to this machine or the local network by address.
    if (!publicUrl(url)) return file.drop();
    const res = await this.deps.upstream.fetch(url, { signal: AbortSignal.timeout(FETCH_MS), redirect: "error" });
    if (!res.ok || !res.body || Number(res.headers.get("content-length") ?? 0) > FETCH_MAX) {
      await res.body?.cancel();
      return file.drop();
    }
    let size = 0;
    for await (const piece of res.body) {
      if ((size += piece.byteLength) > FETCH_MAX || !file.write(piece)) return file.drop();
    }
  }

  // Called by a finished file: its row, then old files go while all of them take too much room.
  added(made: Made, file: Pick<MediaRow, "kind" | "media_type" | "bytes" | "file">): MediaRow {
    const row: MediaRow = {
      id: randomBytes(8).toString("hex"), request_id: made.requestId, route_id: made.routeId, created_at: this.deps.now(),
      model: made.model, prompt: made.prompt, ...file,
    };
    this.deps.store.addMedia(row);
    this.trim();
    return row;
  }

  // Removes one. Its file goes too, unless another row has the same bytes.
  remove(id: string): boolean {
    const row = this.deps.store.mediaItem(id);
    if (!row) return false;
    this.deps.store.removeMedia(id);
    if (!this.deps.store.fileInUse(row.file)) rmSync(this.path(row), { force: true });
    return true;
  }

  trim(): void {
    const { store, mediaMaxBytes } = this.deps;
    while (store.mediaSpace().bytes > mediaMaxBytes) {
      const oldest = store.oldestMedia();
      if (!oldest || !this.remove(oldest.id)) return;
    }
  }
}
