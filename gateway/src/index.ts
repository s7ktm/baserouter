// Starts the gateway: bun src/index.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import type { Deps } from "./deps.ts";
import { loadMasterKey } from "./secrets.ts";
import { openDb, Store } from "./store.ts";

const env = process.env;
const host = env.BASEROUTER_HOST ?? "127.0.0.1";
const port = Number(env.BASEROUTER_PORT ?? 4141);
const dataDir = env.BASEROUTER_DATA_DIR ?? join(import.meta.dir, "..", "data");

mkdirSync(dataDir, { recursive: true });
const store = new Store(openDb(join(dataDir, "baserouter.sqlite")));

const deps: Deps = {
  store,
  master: loadMasterKey(dataDir),
  upstream: { baseUrl: env.BASEROUTER_OPENROUTER_URL ?? "https://openrouter.ai/api/v1", fetch },
  now: Date.now,
  costLookupDelays: [2_000, 5_000, 15_000],
  running: new Map(),
  background: new Set(),
  panelDir: env.BASEROUTER_PANEL_DIR ?? join(import.meta.dir, "..", "..", "design", "prototype"),
};

const app = createApp(deps);
const server = Bun.serve({ hostname: host, port, fetch: (request, server) => app.fetch(request, { server }) });

const shown = ["127.0.0.1", "0.0.0.0", "::", "::1"].includes(host) ? "localhost" : host;
console.log(`BaseRouter is running. Panel: http://${shown}:${server.port}/  One address: http://${shown}:${server.port}/v1`);
if (store.setting("admin_password") === null) console.log("No admin password yet. Open the panel to set one.");
