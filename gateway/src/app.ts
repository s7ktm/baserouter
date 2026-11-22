import { Hono } from "hono";
import { admin } from "./admin.ts";
import type { Deps, Env } from "./deps.ts";
import { proxy } from "./proxy.ts";

export function createApp(deps: Deps) {
  const app = new Hono<Env>();
  app.route("/v1", proxy(deps));
  app.route("/api", admin(deps));
  app.notFound((c) => c.json({ error: { message: `There is nothing at ${c.req.path}.`, type: "not_found", code: "not_found" } }, 404));
  app.onError((err, c) => {
    console.error(`${c.req.method} ${c.req.path} failed: ${err instanceof Error ? err.message : String(err)}`);
    return c.json({ error: { message: "BaseRouter ran into a problem of its own. Look at its log.", type: "gateway_error", code: "gateway_error" } }, 500);
  });
  return app;
}
