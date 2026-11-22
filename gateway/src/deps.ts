// What the two halves of the gateway (the proxy and the management API) share.
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Upstream } from "./openrouter.ts";
import type { RouteRow, Store } from "./store.ts";

export interface Deps {
  store: Store;
  master: Buffer; // seals provider keys
  upstream: Upstream;
  now: () => number;
  // How long to wait before each attempt to ask the provider what a request cost,
  // when its response ended without saying.
  costLookupDelays: number[];
  // Requests running right now, per route.
  running: Map<string, number>;
  // Work that outlives a response. Tests wait for it.
  background: Set<Promise<unknown>>;
  // The largest request body the one address takes.
  maxRequestBytes: number;
  // The folder the panel is served from, or null for no panel.
  panelDir: string | null;
}

export type Env = {
  // Bun's server, when there is one. Used to lift the idle timeout for long responses.
  Bindings: { server?: { timeout(request: Request, seconds: number): void } };
  Variables: { route: RouteRow };
};

// Errors look the way OpenAI-compatible clients expect.
export function refuse(c: Context, status: ContentfulStatusCode, code: string, message: string, metadata?: Record<string, unknown>) {
  return c.json({ error: { message, type: code, code, ...(metadata ? { metadata } : {}) } }, status);
}

export function later(deps: Deps, work: Promise<unknown>): void {
  const tracked = work.catch(() => {}).finally(() => deps.background.delete(tracked));
  deps.background.add(tracked);
}
