// The providers BaseRouter can hold a key for. There are two, and they differ in where things
// are and how a request's cost is learned; this file is the one place that asks "which one?".
// It holds only what the proxy and the management API need of either, nothing more general.
import { catalogue, providersOf, type CatalogueModel, type ModelProvider } from "./catalogue.ts";
import type { Deps } from "./deps.ts";
import * as nanogpt from "./nanogpt.ts";
import * as openrouter from "./openrouter.ts";
import type { Check, Generation, Upstream } from "./openrouter.ts";
import type { ProviderRow } from "./store.ts";

type Ups = Pick<Deps, "upstream" | "nanogpt">;
type Kinded = Pick<ProviderRow, "kind">;

// What can be added, and what each is called.
export const KINDS: Record<string, string> = { openrouter: "OpenRouter", nanogpt: "NanoGPT" };

export const isNano = (provider: Kinded): boolean => provider.kind === "nanogpt";
export const upstreamOf = (deps: Ups, provider: Kinded): Upstream => (isNano(provider) ? deps.nanogpt : deps.upstream);

// Sends a request on. "path" is OpenRouter's name for the endpoint; NanoGPT's own is found from it.
export function send(deps: Ups, provider: Kinded, key: string, path: string, body: Uint8Array | string, contentType: string, signal: AbortSignal): Promise<Response> {
  return isNano(provider) ? nanogpt.send(deps.nanogpt, key, path, body, contentType, signal) : openrouter.send(deps.upstream, key, path, body, contentType, signal);
}

export function check(deps: Ups, kind: string, key: string): Promise<Check> {
  return kind === "nanogpt" ? nanogpt.check(deps.nanogpt, key) : openrouter.check(deps.upstream, key);
}

// The provider did not accept the key BaseRouter holds for it.
export const keyRefused = (provider: Kinded, res: Response): boolean => (isNano(provider) ? nanogpt.keyRefused(res) : res.status === 401);

// The id an answer's headers give for asking what the request cost.
export const costId = (provider: Kinded, res: Response): string | null => res.headers.get(isNano(provider) ? "x-request-id" : "x-generation-id");

// Asks what a finished request cost. Null when the provider does not know it (yet).
export function lookUp(deps: Ups, provider: Kinded, key: string, id: string): Promise<Generation | null> {
  return isNano(provider) ? nanogpt.billing(deps.nanogpt, key, id) : openrouter.generation(deps.upstream, key, id);
}

// What a provider offers, to find models in. Null when its list cannot be had.
export async function offers(deps: Ups, provider: Kinded, key: string): Promise<CatalogueModel[] | null> {
  if (isNano(provider)) return nanogpt.offers(deps.nanogpt, key);
  const read = async (res: Response) => (res.ok ? (((await res.json()) as { data?: unknown }).data ?? []) : (await res.body?.cancel(), null));
  const [all, videos] = await Promise.all([
    openrouter.models(deps.upstream, key, AbortSignal.timeout(15_000)).then(read),
    // Video prices are only in the video list; without them the list still stands.
    openrouter.get(deps.upstream, key, "/videos/models", AbortSignal.timeout(15_000)).then(read).catch(() => []),
  ]);
  return all ? catalogue(all, videos ?? []) : null;
}

// Which of a provider's own providers can serve one of its models.
export async function modelProviders(deps: Ups, provider: Kinded, key: string, model: string): Promise<ModelProvider[]> {
  if (isNano(provider)) return nanogpt.providersOf(deps.nanogpt, key, model);
  // Exactly "author/name": the id becomes part of a path to OpenRouter.
  const parts = model.split("/");
  if (parts.length !== 2 || parts.some((p) => p === "." || p === "..")) return [];
  const res = await openrouter.get(deps.upstream, key, `/models/${parts.map(encodeURIComponent).join("/")}/endpoints`, AbortSignal.timeout(15_000));
  if (!res.ok) {
    await res.body?.cancel();
    return [];
  }
  return providersOf(((await res.json()) as { data?: unknown }).data);
}
