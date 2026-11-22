// Models in BaseRouter: the name apps send, what it makes, and the places it comes from, in
// order. A place is a provider BaseRouter holds a key for, that provider's id for the model, and
// for OpenRouter which of its own providers ("via", such as "google-vertex", or null for any).
// When a place fails, the next is tried. A route only names the models it may use.
// See "Providers, models and routes" in PRODUCT.md.
//
// A name a route lists that is not a model in BaseRouter (routes made before models existed, or
// a route that may use any model) is the provider's own id, at the first provider.
import type { ProviderRow, RouteRow, Store } from "./store.ts";

export interface Place {
  provider: string; // a provider's id in BaseRouter
  model: string; // that provider's id for the model
  via: string | null; // OpenRouter only: which of its own providers
}

export interface ModelRow {
  id: string;
  name: string;
  makes: string; // JSON: ["text"], ["image", "text"]...
  places: string; // JSON: Place[]
  created_at: number;
}

export interface Model {
  id: string;
  name: string;
  makes: string[];
  places: Place[];
}

export const MODEL_NAME = /^[\w~][\w.:/@+~-]{0,199}$/;
// OpenRouter's provider slugs: "anthropic", "google-vertex", "deepinfra/turbo", "google-ai-studio/flex".
export const VIA = /^[a-z0-9][a-z0-9._-]{0,63}(\/[a-z0-9._-]{1,63}){0,3}$/;

export const toModel = (row: ModelRow): Model => ({ id: row.id, name: row.name, makes: JSON.parse(row.makes) as string[], places: JSON.parse(row.places) as Place[] });

// The names of the models a route may use. Empty: any. Routes saved while lines had providers
// stored { model, provider } objects; those read as their model.
export function namesOf(route: Pick<RouteRow, "models">): string[] {
  const stored: unknown = JSON.parse(route.models);
  const names = (Array.isArray(stored) ? stored : []).map((item) =>
    typeof item === "string" ? item : typeof (item as { model?: unknown } | null)?.model === "string" ? (item as { model: string }).model : null,
  );
  return [...new Set(names.filter((n): n is string => n !== null))];
}

// Reads the model names a client sent for a route: each a name, or { model } as the branch
// before this one sent them. Null when they are not a list of at most 50 different names.
export function parseNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const names = value.map((item) => (typeof item === "string" ? item.trim() : typeof item?.model === "string" ? String(item.model).trim() : ""));
  if (!names.every((n) => MODEL_NAME.test(n)) || new Set(names).size !== names.length) return null;
  return names;
}

// Reads a model's places. Null when they are not 1 to 10 different places at known providers.
export function parsePlaces(value: unknown, providers: ProviderRow[]): Place[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return null;
  const places: Place[] = [];
  for (const item of value) {
    const raw = item as Record<string, unknown> | null;
    const provider = providers.find((p) => p.id === raw?.provider);
    const model = typeof raw?.model === "string" ? raw.model.trim() : "";
    const via = raw?.via == null || raw.via === "" ? null : typeof raw.via === "string" ? raw.via.trim() : undefined;
    if (!provider || !MODEL_NAME.test(model) || via === undefined || (via !== null && (provider.kind !== "openrouter" || !VIA.test(via)))) return null;
    if (places.some((p) => p.provider === provider.id && p.model === model && p.via === via)) return null;
    places.push({ provider: provider.id, model, via });
  }
  return places;
}

export type Resolved = { ok: true; places: Place[]; model: Model | null } | { ok: false };

// What a request for a name on a route goes to: the model's places in order, or for a name
// that is not a model in BaseRouter, that id at the first provider. Not ok when the route may
// not use the name.
export function resolve(store: Store, route: Pick<RouteRow, "models">, name: string): Resolved {
  const names = namesOf(route);
  if (names.length > 0 && !names.includes(name)) return { ok: false };
  const model = store.modelByName(name);
  const first = store.providers()[0];
  const places = model?.places.length ? model.places : first ? [{ provider: first.id, model: name, via: null }] : [];
  return { ok: true, places, model };
}

// The request body for one place: its model id, and for OpenRouter its own provider as "only",
// kept beside whatever else the client asked of providers. Null when nothing needs to change,
// so the body is sent exactly as the client wrote it.
export function bodyFor(body: Record<string, unknown>, place: Place, name: string): string | null {
  if (place.model === name && !place.via) return null;
  const asked = typeof body.provider === "object" && body.provider !== null && !Array.isArray(body.provider) ? (body.provider as Record<string, unknown>) : null;
  const provider = place.via ? { ...(asked ?? {}), only: [place.via] } : body.provider;
  return JSON.stringify({ ...body, model: place.model, ...(provider === undefined ? {} : { provider }) });
}
