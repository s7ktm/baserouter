import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { admin } from "./admin.ts";
import type { Deps, Env } from "./deps.ts";
import { panel } from "./panel.ts";
import { proxy } from "./proxy.ts";

// The management API takes small JSON bodies only, before and after signing in.
export const MAX_API_BYTES = 1024 * 1024;

// Bun's own limit on a request body answers with an empty 413 that says nothing, so it is
// lifted (index.ts and the tests use this) and BaseRouter's limits below apply instead:
// the one address counts each body as it arrives (proxy.ts), the management API stops at 1 MB.
export const BUN_BODY_LIMIT = Number.MAX_SAFE_INTEGER;

export function createApp(deps: Deps) {
  const app = new Hono<Env>();
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_API_BYTES,
      onError: (c) => c.json({ error: { code: "request_too_large", message: "The request is larger than the management API takes (1 MB)." } }, 413),
    }),
  );
  const gate = proxy(deps);
  app.route("/v1", gate.app);
  app.route("/api", admin(deps, gate.chatAs));
  if (deps.panelDir) {
    const files = panel(deps.panelDir);
    app.on(["GET", "HEAD"], "/*", (c) => (/^\/(v1|api)(\/|$)/.test(c.req.path) ? c.notFound() : files(c)));
  }
  app.notFound((c) => c.json({ error: { message: `There is nothing at ${c.req.path}.`, type: "not_found", code: "not_found" } }, 404));
  app.onError((err, c) => {
    console.error(`${c.req.method} ${c.req.path} failed: ${err instanceof Error ? err.message : String(err)}`);
    return c.json({ error: { message: "BaseRouter ran into a problem of its own. Look at its log.", type: "gateway_error", code: "gateway_error" } }, 500);
  });
  return app;
}
