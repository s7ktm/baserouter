// The one provider so far. These are plain calls to OpenRouter's API; there is no
// provider interface yet, on purpose.

export interface Upstream {
  baseUrl: string; // https://openrouter.ai/api/v1
  fetch: typeof fetch;
}

const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

// A request to one of OpenRouter's endpoints (/chat/completions, /images, /audio/speech,
// /audio/transcriptions). The body is sent on exactly as the client wrote it.
export function send(up: Upstream, key: string, path: string, body: Uint8Array | string, contentType: string, signal: AbortSignal): Promise<Response> {
  return up.fetch(`${up.baseUrl}${path}`, {
    method: "POST",
    headers: { ...auth(key), "Content-Type": contentType },
    body,
    signal,
  });
}

// A GET to one of OpenRouter's endpoints: a video job's status or its video, the video models.
// "path" may carry a query.
export function get(up: Upstream, key: string, path: string, signal?: AbortSignal): Promise<Response> {
  return up.fetch(`${up.baseUrl}${path}`, { headers: auth(key), signal });
}

// Whether BaseRouter can use a model OpenRouter lists. Its ":batch" entries are the same models
// at batch prices, served only by OpenRouter's separate Batch API; a normal request with one is
// refused. They are left out of every list BaseRouter shows.
export const usable = (id: unknown): boolean => typeof id === "string" && !id.endsWith(":batch");

// The filters OpenRouter's model list takes, which a client may pass on through /v1/models.
const LIST_FILTERS = ["output_modalities", "supported_parameters", "category"];

// The path of the model list. Without "output_modalities", OpenRouter lists only the models
// that write text, leaving out most that only make images, sound or video; "all" lists every
// one. A client's own filters are passed on, and only those.
export function modelsPath(asked: URLSearchParams = new URLSearchParams()): string {
  const query = new URLSearchParams();
  for (const name of LIST_FILTERS) {
    const value = asked.get(name);
    if (value && /^[\w,.:-]{1,200}$/.test(value)) query.set(name, value);
  }
  if (!query.has("output_modalities")) query.set("output_modalities", "all");
  return `/models?${query}`;
}

export function models(up: Upstream, key: string, signal?: AbortSignal): Promise<Response> {
  return up.fetch(`${up.baseUrl}${modelsPath()}`, { headers: auth(key), signal });
}

// What the provider itself said went wrong, in its own words.
export async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const message = JSON.parse(text)?.error?.message;
    if (typeof message === "string" && message) return message;
  } catch {}
  return text.trim().slice(0, 200) || `HTTP ${res.status}`;
}

export type Check = { ok: true; models: number | null } | { ok: false; error: string };

// Tests a key: is it accepted, and how many models does it reach.
export async function check(up: Upstream, key: string): Promise<Check> {
  try {
    const res = await up.fetch(`${up.baseUrl}/key`, { headers: auth(key), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ok: false, error: await errorMessage(res) };
    await res.body?.cancel();
    const list = await models(up, key, AbortSignal.timeout(15_000));
    const data = list.ok ? ((await list.json()) as { data?: unknown }).data : null;
    return { ok: true, models: Array.isArray(data) ? data.filter((m) => usable((m as { id?: unknown })?.id)).length : null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface Generation {
  cost: number;
  promptTokens: number | null;
  completionTokens: number | null;
  model: string | null;
}

// Asks what a finished request cost. Null when OpenRouter does not know it (yet).
export async function generation(up: Upstream, key: string, id: string): Promise<Generation | null> {
  const res = await up.fetch(`${up.baseUrl}/generation?id=${encodeURIComponent(id)}`, { headers: auth(key), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  const data = ((await res.json()) as { data?: Record<string, unknown> }).data;
  if (!data || typeof data.total_cost !== "number") return null;
  const count = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    cost: data.total_cost,
    promptTokens: count(data.tokens_prompt),
    completionTokens: count(data.tokens_completion),
    model: typeof data.model === "string" ? data.model : null,
  };
}
