// Serves the panel: index.html and the folders it loads from design/prototype/, as they are.
// No build step. The design pages beside it (check.html, frame.html, cover.html,
// mascots.html) are for working on the design and are not served by the gateway.
import type { Context } from "hono";
import { statSync } from "node:fs";
import { resolve, sep } from "node:path";

// The panel itself may only talk to this gateway and load its own files.
const PANEL_POLICY = [
  "default-src 'self'",
  "img-src 'self' data:",
  "media-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

// The folders index.html loads from.
const SERVED = new Set(["core", "skins", "fonts"]);

export function panel(dir: string) {
  const root = resolve(dir);
  return async (c: Context) => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.notFound();
    }
    if (path.endsWith("/")) path += "index.html";
    const full = resolve(root, "." + path);
    // Inside the folder, and no hidden files or folders within it.
    if (!full.startsWith(root + sep) || full.slice(root.length + 1).split(sep).some((part) => part.startsWith("."))) return c.notFound();
    // Only the panel itself and what it loads.
    const inside = full.slice(root.length + 1).split(sep);
    if (!(inside.length === 1 ? inside[0] === "index.html" : SERVED.has(inside[0]!))) return c.notFound();
    try {
      if (!statSync(full).isFile()) return c.notFound();
    } catch {
      return c.notFound();
    }
    const headers: Record<string, string> = { "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
    if (full === resolve(root, "index.html")) {
      headers["Content-Security-Policy"] = PANEL_POLICY;
      headers["X-Frame-Options"] = "SAMEORIGIN";
    }
    return new Response(Bun.file(full), { headers });
  };
}
