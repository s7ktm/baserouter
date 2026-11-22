// A route's models, in order. Each line is a model and where it comes from: one of the
// provider's own providers (OpenRouter's "google-vertex", "anthropic", ...), or null to leave
// that to the provider. The same model may be listed more than once, from different places,
// as its own fallback. See "Routes, models and providers" in PRODUCT.md.
//
// Routes made before lines had providers stored their models as plain ids; those read as
// lines with no provider.
import type { RouteRow } from "./store.ts";

export interface Line {
  model: string;
  provider: string | null;
}

// What a model id may look like (also checked in proxy.ts).
const MODEL = /^[\w~][\w.:/@+~-]{0,199}$/;
// OpenRouter's provider slugs: "anthropic", "google-vertex", "deepinfra/turbo", "google-ai-studio/flex".
const PROVIDER = /^[a-z0-9][a-z0-9._-]{0,63}(\/[a-z0-9._-]{1,63}){0,3}$/;

export function linesOf(route: Pick<RouteRow, "models">): Line[] {
  const stored: unknown = JSON.parse(route.models);
  return (Array.isArray(stored) ? stored : []).flatMap((item): Line[] => {
    if (typeof item === "string") return [{ model: item, provider: null }];
    const line = item as Partial<Line> | null;
    return typeof line?.model === "string" ? [{ model: line.model, provider: typeof line.provider === "string" ? line.provider : null }] : [];
  });
}

// The models a route may use, each once, in the route's order. Empty: any model.
export const modelsOf = (route: Pick<RouteRow, "models">): string[] => [...new Set(linesOf(route).map((l) => l.model))];

// Reads the lines a client sent: each a model id, or { model, provider }. Null when they are
// not a list of at most 50 different lines.
export function parseLines(value: unknown): Line[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const lines: Line[] = [];
  for (const item of value) {
    const raw = typeof item === "string" ? { model: item, provider: null } : (item as Record<string, unknown> | null);
    const model = typeof raw?.model === "string" ? raw.model.trim() : "";
    const provider = raw?.provider == null || raw.provider === "" ? null : typeof raw.provider === "string" ? raw.provider.trim() : undefined;
    if (!MODEL.test(model) || provider === undefined || (provider !== null && !PROVIDER.test(provider))) return null;
    if (lines.some((l) => l.model === model && l.provider === provider)) return null;
    lines.push({ model, provider });
  }
  return lines;
}

// The order a request tries a route's lines in: those of the model asked for first, in the
// route's order, then the rest.
export function attemptOrder(lines: Line[], model: string): Line[] {
  return [...lines.filter((l) => l.model === model), ...lines.filter((l) => l.model !== model)];
}

// The request body for one line: its model, and its provider as OpenRouter's "only", kept
// beside whatever else the client asked of providers. A line with no provider leaves the
// client's own "provider" as it was.
export function bodyFor(body: Record<string, unknown>, line: Line, extra: Record<string, unknown> = {}): string {
  const { models: _, ...rest } = body;
  const asked = typeof body.provider === "object" && body.provider !== null && !Array.isArray(body.provider) ? (body.provider as Record<string, unknown>) : null;
  const provider = line.provider ? { ...(asked ?? {}), only: [line.provider] } : body.provider;
  return JSON.stringify({ ...rest, ...extra, model: line.model, ...(provider === undefined ? {} : { provider }) });
}
