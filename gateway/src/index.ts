// Starts the gateway: bun src/index.ts
import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { BUN_BODY_LIMIT, createApp } from "./app.ts";
import type { Deps } from "./deps.ts";
import { loadMasterKey } from "./secrets.ts";
import { openDb, Store } from "./store.ts";

const env = process.env;
const host = env.BASEROUTER_HOST ?? "127.0.0.1";
const port = Number(env.BASEROUTER_PORT ?? 4141);
// Images, PDFs and sound go inside the request as base64, a third larger than the file.
const maxRequestMb = Number(env.BASEROUTER_MAX_REQUEST_MB ?? 64);
if (!(maxRequestMb > 0)) throw new Error("BASEROUTER_MAX_REQUEST_MB must be a number of megabytes larger than 0.");
const maxRequestBytes = Math.round(maxRequestMb * 1024 * 1024);
// The images and sound routes make are kept until they take this much room; then the oldest go first. 0 keeps none.
const mediaMaxMb = Number(env.BASEROUTER_MEDIA_MAX_MB ?? 1024);
if (!(mediaMaxMb >= 0)) throw new Error("BASEROUTER_MEDIA_MAX_MB must be a number of megabytes, 0 or more.");
const mediaMaxBytes = Math.round(mediaMaxMb * 1024 * 1024);
// The names the panel may be reached by: this machine, the name it listens on, and any given.
// Behind Caddy, BASEROUTER_DOMAIN; on a home network, the machine's name or address.
const allowedHosts = [
  ...new Set(
    ["localhost", "127.0.0.1", "::1", host, env.BASEROUTER_DOMAIN ?? "", ...(env.BASEROUTER_ALLOWED_HOSTS ?? "").split(",")]
      .map((name) => name.trim().toLowerCase().replace(/^\[|\]$/g, ""))
      .filter((name) => name && name !== "0.0.0.0" && name !== "::"),
  ),
];
const dataDir = env.BASEROUTER_DATA_DIR ?? join(import.meta.dir, "..", "data");

// Everything BaseRouter writes is for its own user only: the database holds the sealed
// provider key, hashes and kept prompts. Files made before this are tightened as well.
process.umask(0o077);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
chmodSync(dataDir, 0o700);
for (const name of ["baserouter.sqlite", "baserouter.sqlite-wal", "baserouter.sqlite-shm", "secret.key"]) {
  if (existsSync(join(dataDir, name))) chmodSync(join(dataDir, name), 0o600);
}
// Kept images were in "images" before sound was kept too.
if (existsSync(join(dataDir, "images")) && !existsSync(join(dataDir, "media"))) renameSync(join(dataDir, "images"), join(dataDir, "media"));
const store = new Store(openDb(join(dataDir, "baserouter.sqlite")));

const deps: Deps = {
  store,
  master: loadMasterKey(dataDir),
  upstream: { baseUrl: env.BASEROUTER_OPENROUTER_URL ?? "https://openrouter.ai/api/v1", fetch },
  now: Date.now,
  costLookupDelays: [2_000, 5_000, 15_000],
  running: new Map(),
  background: new Set(),
  maxRequestBytes,
  allowedHosts,
  mediaDir: join(dataDir, "media"),
  mediaMaxBytes,
  panelDir: env.BASEROUTER_PANEL_DIR ?? join(import.meta.dir, "..", "..", "design", "prototype"),
};

const app = createApp(deps);
const server = Bun.serve({
  hostname: host,
  port,
  maxRequestBodySize: BUN_BODY_LIMIT,
  fetch: (request, server) => app.fetch(request, { server }),
});

const shown = ["127.0.0.1", "0.0.0.0", "::", "::1"].includes(host) ? "localhost" : host;
console.log(`BaseRouter is running. Panel: http://${shown}:${server.port}/  One address: http://${shown}:${server.port}/v1`);
if (store.setting("admin_password") === null) console.log("No admin password yet. Open the panel to set one.");

// Stopping (docker stop, systemctl stop, Ctrl-C): take no new requests, give running ones
// and pending cost lookups a few seconds, then close the database cleanly. Without this,
// a gateway running as the first process in a container would ignore the signal and be killed.
let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: stopping.`);
  const grace = Bun.sleep(5_000);
  await Promise.race([Promise.all([server.stop(), ...deps.background]), grace]);
  server.stop(true);
  store.db.close();
  process.exit(0);
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
