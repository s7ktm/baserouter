// Static preview server for the design work. Run: bun design/serve.ts
//   /prototype/   the skin prototype (one state, three skins)
//   /directions/  the first three stand-alone mock-ups
import { join, normalize } from "node:path";

const root = import.meta.dir;
const port = Number(process.env.PORT ?? 4173);

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    let path = normalize(decodeURIComponent(new URL(req.url).pathname));
    if (path.includes("..")) return new Response("Not found", { status: 404 });
    if (path === "/") return Response.redirect("/prototype/", 302);
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file(join(root, path));
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file, { headers: { "Cache-Control": "no-store" } });
  },
});

console.log(`Design preview: http://127.0.0.1:${port}/`);
