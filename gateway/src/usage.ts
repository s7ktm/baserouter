// Reads what a response cost, without holding on to the response.

export interface Usage {
  promptTokens: number | null;
  completionTokens: number | null;
  cost: number | null;
}

const number = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const object = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null);

// OpenRouter's usage object. "cost" is what was charged to the OpenRouter account.
// Transcriptions count "input_tokens" and "output_tokens" instead.
export function readUsage(value: unknown): Usage | null {
  const usage = object(value);
  if (!usage) return null;
  return {
    promptTokens: number(usage.prompt_tokens) ?? number(usage.input_tokens),
    completionTokens: number(usage.completion_tokens) ?? number(usage.output_tokens),
    cost: number(usage.cost),
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
  model: string | null;
  usage: Usage | null;
  failed: boolean;
}

// A response that came as one JSON document.
export function readPlain(body: unknown): Reading {
  const doc = object(body);
  if (!doc) return { id: null, model: null, usage: null, failed: true };
  return {
    id: typeof doc.id === "string" ? doc.id : null,
    model: typeof doc.model === "string" ? doc.model : null,
    usage: readUsage(doc.usage),
    failed: failed(doc),
  };
}

// A response that comes as server-sent events. Feed it the bytes as they pass; it keeps
// only the unfinished last line and the few facts it is looking for. Lines starting
// with ":" are keep-alives and are not looked at.
export class StreamScanner implements Reading {
  id: string | null = null;
  model: string | null = null;
  usage: Usage | null = null;
  failed = false;
  done = false; // "data: [DONE]" was seen
  firstTokenAt: number | null = null;

  #decoder = new TextDecoder();
  // The pieces of the line not finished yet. A line can be megabytes long (an image as
  // base64), so pieces are joined once, when the line ends, not on every chunk.
  #rest: string[] = [];

  feed(chunk: Uint8Array, now: number): void {
    const text = this.#decoder.decode(chunk, { stream: true });
    let start = 0;
    for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n", start)) {
      this.#rest.push(text.slice(start, end));
      this.#line(this.#rest.join(""), now);
      this.#rest = [];
      start = end + 1;
    }
    if (start < text.length) this.#rest.push(text.slice(start));
  }

  // Call when the stream is over, so a last line without a line break is still read.
  end(now: number): void {
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
    // chunk), only a line that mentions usage or an error is worth parsing.
    const settled = this.firstTokenAt !== null;
    if (settled && !data.includes('"usage"') && !data.includes('"error"')) return;

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
    const usage = readUsage(event.usage);
    if (usage) this.usage = usage;
  }
}
