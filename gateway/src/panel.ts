// Serves the panel: the files of design/prototype/, as they are. No build step.
import type { Context } from "hono";
import { statSync } from "node:fs";
import { resolve, sep } from "node:path";

// The panel itself may only talk to this gateway and load its own files.
const PANEL_POLICY = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

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
    try {
      if (!statSync(full).isFile()) return c.notFound();
    } catch {
      return c.notFound();
    }
    const headers: Record<string, string> = { "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
    if (full === resolve(root, "index.html")) headers["Content-Security-Policy"] = PANEL_POLICY;
    return new Response(Bun.file(full), { headers });
  };
}
