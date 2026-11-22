// Reads what a response cost, without holding on to the response. When asked, it also
// picks out the finished images, so they can be kept.
import { imagesIn, mayCarryImages, type Found } from "./media.ts";

export interface Usage {
  promptTokens: number | null;
  completionTokens: number | null;
  cost: number | null;
}

const number = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const object = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null);

// A provider's usage object. "cost" is what was charged to the account at the provider.
// Transcriptions count "input_tokens" and "output_tokens" instead. NanoGPT names the currency
// beside the cost; one that is not US dollars (an account paying in Nano) is not a cost in dollars.
export function readUsage(value: unknown): Usage | null {
  const usage = object(value);
  if (!usage) return null;
  const dollars = usage.currency === undefined || usage.currency === "USD";
  return {
    promptTokens: number(usage.prompt_tokens) ?? number(usage.input_tokens),
    completionTokens: number(usage.completion_tokens) ?? number(usage.output_tokens),
    cost: dollars ? number(usage.cost) : null,
  };
}

// What NanoGPT says a request cost when "usage" does not: "x_nanogpt_pricing" in every chat
// answer and in the last chunk of every stream, asked for or not, and a top-level "cost" (with
// "paymentSource") in an image answer and in the answer that starts a video. An estimate
// ("isEstimate") is not the charge, and neither is an amount in another currency. See docs/nanogpt.md.
function readExtras(doc: Record<string, unknown>): { cost: number | null; promptTokens: number | null; completionTokens: number | null; requestId: string | null } {
  const pricing = object(doc.x_nanogpt_pricing);
  const id = [pricing?.requestId, doc.requestId].find((v): v is string => typeof v === "string" && v !== "") ?? null;
  if (pricing) {
    const dollars = (pricing.currency ?? pricing.paymentSource ?? "USD") === "USD";
    const cost = pricing.isEstimate === true ? null : (number(pricing.costUsd) ?? (dollars ? number(pricing.cost) : null));
    return { cost, promptTokens: number(pricing.inputTokens), completionTokens: number(pricing.outputTokens), requestId: id };
  }
  const flat = (doc.paymentSource ?? "USD") === "USD" && !("choices" in doc) ? number(doc.cost) : null;
  return { cost: flat, promptTokens: null, completionTokens: null, requestId: id };
}

// The usage of an answer or of one event of a stream, with what NanoGPT says beside it.
function usageOf(doc: Record<string, unknown>, before: Usage | null = null): { usage: Usage | null; requestId: string | null } {
  const usage = readUsage(doc.usage) ?? before;
  const extra = readExtras(doc);
  if (extra.cost === null && extra.promptTokens === null) return { usage, requestId: extra.requestId };
  return {
    usage: { promptTokens: usage?.promptTokens ?? extra.promptTokens, completionTokens: usage?.completionTokens ?? extra.completionTokens, cost: usage?.cost ?? extra.cost },
    requestId: extra.requestId,
  };
}

function choices(event: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(event.choices) ? event.choices.map(object).filter((c) => c !== null) : [];
}

// A response can fail after HTTP 200 was sent: a top-level "error", or a choice that
// finished with "error".
function failed(event: Record<string, unknown>): boolean {
  return object(event.error) !== null || choices(event).some((c) => c.finish_reason === "error" || object(c.error) !== null);
}

// The first thing the client can use: text, reasoning, a tool call, an image or sound in a
// chat stream, or a (partial) picture from /images.
function carriesToken(event: Record<string, unknown>): boolean {
  if (typeof event.b64_json === "string" && event.b64_json !== "") return true;
  return choices(event).some((c) => {
    const delta = object(c.delta);
    if (!delta) return false;
    return (
      (typeof delta.content === "string" && delta.content !== "") ||
      (typeof delta.reasoning === "string" && delta.reasoning !== "") ||
      (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) ||
      (Array.isArray(delta.images) && delta.images.length > 0) ||
      object(delta.audio) !== null
    );
  });
}

export interface Reading {
  id: string | null;
  // NanoGPT's id for asking what the request cost, when the answer itself names it.
  requestId: string | null;
  model: string | null;
  usage: Usage | null;
  failed: boolean;
}

// A response that came as one JSON document.
export function readPlain(body: unknown): Reading {
  const doc = object(body);
  if (!doc) return { id: null, requestId: null, model: null, usage: null, failed: true };
  return {
    id: typeof doc.id === "string" ? doc.id : null,
    model: typeof doc.model === "string" ? doc.model : null,
    ...usageOf(doc),
    failed: failed(doc),
  };
}

// A response that comes as server-sent events. Feed it the bytes as they pass; it keeps
// only the unfinished last line and the few facts it is looking for. Lines starting
// with ":" are keep-alives and are not looked at.
export class StreamScanner implements Reading {
  images: Found[] = [];
  constructor(private readonly collectImages = false) {}
  id: string | null = null;
  requestId: string | null = null;
  model: string | null = null;
  usage: Usage | null = null;
  failed = false;
  done = false; // "data: [DONE]" was seen
  firstTokenAt: number | null = null;

  #decoder = new TextDecoder();
  // The pieces of the line not finished yet. A line can be megabytes long (an image as
  // base64), so pieces are joined once, when the line ends, not on every chunk.
  #rest: string[] = [];

  // A line longer than this is not read (it still reaches the client): only an image is
  // that long, and when images are not being kept nothing in it is needed.
  #longest = 0;
  #restSize = 0;
  #skipping = false;

  feed(chunk: Uint8Array, now: number): void {
    const text = this.#decoder.decode(chunk, { stream: true });
    this.#longest ||= this.collectImages ? 96 * 1024 * 1024 : 4 * 1024 * 1024;
    let start = 0;
    for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n", start)) {
      if (!this.#skipping) {
        this.#rest.push(text.slice(start, end));
        this.#line(this.#rest.join(""), now);
      }
      this.#rest = [];
      this.#restSize = 0;
      this.#skipping = false;
      start = end + 1;
    }
    if (start < text.length && !this.#skipping) {
      this.#rest.push(text.slice(start));
      if ((this.#restSize += text.length - start) > this.#longest) {
        this.#rest = [];
        this.#restSize = 0;
        this.#skipping = true;
        this.firstTokenAt ??= now; // a line this long carries something: an image
      }
    }
  }

  // Call when the stream is over, so a last line without a line break is still read.
  end(now: number): void {
    if (this.#skipping) return;
    this.#rest.push(this.#decoder.decode());
    const tail = this.#rest.join("");
    this.#rest = [];
    if (tail) this.#line(tail, now);
  }

  #line(raw: string, now: number): void {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trimStart();
    if (data === "[DONE]") {
      this.done = true;
      return;
    }
    // Once the first token is known (and with it the id and the model, which come in every
    // chunk), only a line that mentions usage, NanoGPT's pricing or an error is worth parsing.
    const settled = this.firstTokenAt !== null;
    const images = this.collectImages && mayCarryImages(data);
    if (settled && !images && !data.includes('"usage"') && !data.includes('"x_nanogpt_pricing"') && !data.includes('"error"')) return;

    let event: Record<string, unknown> | null;
    try {
      event = object(JSON.parse(data));
    } catch {
      return;
    }
    if (!event) return;
    if (typeof event.id === "string") this.id = event.id;
    if (typeof event.model === "string") this.model = event.model;
    if (this.firstTokenAt === null && carriesToken(event)) this.firstTokenAt = now;
    if (failed(event)) this.failed = true;
    const read = usageOf(event, this.usage);
    if (read.usage) this.usage = read.usage;
    if (read.requestId) this.requestId = read.requestId;
    if (images) this.images.push(...imagesIn(event));
  }
}
