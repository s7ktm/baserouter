// SQLite storage. All SQL lives in this file.
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { namesOf, toModel, type Model, type ModelRow, type Place } from "./models.ts";

// cost_source says where cost_usd came from: reported by the provider, computed from a
// price table (not used by OpenRouter), or unknown.
// failure is null for a request that worked.
const SCHEMA = `
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE TABLE providers (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  name       TEXT NOT NULL,
  key_sealed TEXT NOT NULL,
  key_hint   TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('up', 'down')),
  error      TEXT,
  models     INTEGER,
  checked_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE routes (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  key_hash   TEXT NOT NULL UNIQUE,
  key_hint   TEXT NOT NULL,
  budget_usd REAL NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  models     TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE requests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id          TEXT REFERENCES routes(id) ON DELETE SET NULL,
  provider_id       TEXT REFERENCES providers(id) ON DELETE SET NULL,
  started_at        INTEGER NOT NULL,
  model_requested   TEXT,
  model_served      TEXT,
  streamed          INTEGER NOT NULL,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  cost_usd          REAL,
  cost_source       TEXT NOT NULL CHECK (cost_source IN ('provider', 'computed', 'unknown')),
  first_token_ms    INTEGER,
  total_ms          INTEGER NOT NULL,
  status            INTEGER,
  failure           TEXT,
  upstream_id       TEXT
) STRICT;

CREATE INDEX requests_by_route ON requests (route_id, started_at);
CREATE INDEX requests_by_time ON requests (started_at);
`;

// Each step takes the database from one version to the next. Steps are never edited
// once released; a change is a new step.
export const MIGRATIONS: (string | ((db: Database) => void))[] = [
  SCHEMA,
  // 2: how the panel draws a route
  `ALTER TABLE routes ADD COLUMN icon TEXT NOT NULL DEFAULT 'code';
   ALTER TABLE routes ADD COLUMN color TEXT NOT NULL DEFAULT '#2B62D9';`,
  // 3: what a request made: text, an image, speech, or a transcription
  `ALTER TABLE requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'image', 'speech', 'transcription'));`,
  // 4: the images routes make, kept as files; whether a route keeps them
  `CREATE TABLE images (
     id         TEXT PRIMARY KEY,
     request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
     route_id   TEXT REFERENCES routes(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL,
     model      TEXT,
     prompt     TEXT,
     media_type TEXT NOT NULL,
     bytes      INTEGER NOT NULL,
     file       TEXT NOT NULL
   ) STRICT;
   CREATE INDEX images_by_time ON images (created_at);
   CREATE INDEX images_by_route ON images (route_id, created_at);
   CREATE INDEX images_by_file ON images (file);
   ALTER TABLE routes ADD COLUMN keep_images INTEGER NOT NULL DEFAULT 1;`,
  // 5: sound is kept too, so images become media, with a kind
  `ALTER TABLE images RENAME TO media;
   ALTER TABLE media ADD COLUMN kind TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'audio'));
   DROP INDEX images_by_time;
   DROP INDEX images_by_route;
   DROP INDEX images_by_file;
   CREATE INDEX media_by_kind ON media (kind, created_at);
   CREATE INDEX media_by_route ON media (route_id, created_at);
   CREATE INDEX media_by_file ON media (file);
   ALTER TABLE routes RENAME COLUMN keep_images TO keep_media;`,
  // 6: video. A request and a kept file may now be a video, which means rebuilding the two
  // tables (SQLite cannot change a CHECK). migrate() switches foreign keys off around this,
  // as SQLite's own procedure says, so dropping the old requests leaves media rows alone.
  // video_jobs: the jobs OpenRouter is making, which route started them, and whether they are done.
  `CREATE TABLE requests_new (
     id                INTEGER PRIMARY KEY AUTOINCREMENT,
     route_id          TEXT REFERENCES routes(id) ON DELETE SET NULL,
     provider_id       TEXT REFERENCES providers(id) ON DELETE SET NULL,
     started_at        INTEGER NOT NULL,
     model_requested   TEXT,
     model_served      TEXT,
     streamed          INTEGER NOT NULL,
     prompt_tokens     INTEGER,
     completion_tokens INTEGER,
     cost_usd          REAL,
     cost_source       TEXT NOT NULL CHECK (cost_source IN ('provider', 'computed', 'unknown')),
     first_token_ms    INTEGER,
     total_ms          INTEGER NOT NULL,
     status            INTEGER,
     failure           TEXT,
     upstream_id       TEXT,
     kind              TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'image', 'speech', 'transcription', 'video'))
   ) STRICT;
   INSERT INTO requests_new (id, route_id, provider_id, started_at, model_requested, model_served, streamed, prompt_tokens, completion_tokens, cost_usd, cost_source, first_token_ms, total_ms, status, failure, upstream_id, kind)
     SELECT id, route_id, provider_id, started_at, model_requested, model_served, streamed, prompt_tokens, completion_tokens, cost_usd, cost_source, first_token_ms, total_ms, status, failure, upstream_id, kind FROM requests;
   DROP TABLE requests;
   ALTER TABLE requests_new RENAME TO requests;
   CREATE INDEX requests_by_route ON requests (route_id, started_at);
   CREATE INDEX requests_by_time ON requests (started_at);

   CREATE TABLE media_new (
     id         TEXT PRIMARY KEY,
     request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
     route_id   TEXT REFERENCES routes(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL,
     model      TEXT,
     prompt     TEXT,
     media_type TEXT NOT NULL,
     bytes      INTEGER NOT NULL,
     file       TEXT NOT NULL,
     kind       TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'audio', 'video'))
   ) STRICT;
   INSERT INTO media_new (id, request_id, route_id, created_at, model, prompt, media_type, bytes, file, kind) SELECT id, request_id, route_id, created_at, model, prompt, media_type, bytes, file, kind FROM media;
   DROP TABLE media;
   ALTER TABLE media_new RENAME TO media;
   CREATE INDEX media_by_kind ON media (kind, created_at);
   CREATE INDEX media_by_route ON media (route_id, created_at);
   CREATE INDEX media_by_file ON media (file);

   CREATE TABLE video_jobs (
     id         TEXT PRIMARY KEY,
     request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
     route_id   TEXT REFERENCES routes(id) ON DELETE SET NULL,
     model      TEXT,
     prompt     TEXT,
     keep       INTEGER NOT NULL,
     status     TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     done_at    INTEGER
   ) STRICT;
   CREATE INDEX video_jobs_open ON video_jobs (done_at);`,
  // 7: models in BaseRouter: the name apps send, what it makes, the places it comes from in
  // order (JSON, see models.ts). A route's "models" become the names of the models it may use.
  // Every name a route already lists becomes a model, at the first provider, so nothing that
  // worked before changes.
  (db) => {
    db.exec(`CREATE TABLE models (
       id         TEXT PRIMARY KEY,
       name       TEXT NOT NULL UNIQUE,
       makes      TEXT NOT NULL DEFAULT '[]',
       places     TEXT NOT NULL DEFAULT '[]',
       created_at INTEGER NOT NULL
     ) STRICT;`);
    const first = db.query("SELECT id FROM providers ORDER BY created_at LIMIT 1").get() as { id: string } | null;
    const known = new Set<string>();
    for (const route of db.query("SELECT id, models, created_at FROM routes ORDER BY created_at").all() as { id: string; models: string; created_at: number }[]) {
      const names = namesOf(route);
      db.query("UPDATE routes SET models = ? WHERE id = ?").run(JSON.stringify(names), route.id);
      for (const name of names) {
        if (known.has(name)) continue;
        known.add(name);
        const places = first ? [{ provider: first.id, model: name, via: null }] : [];
        db.query("INSERT INTO models (id, name, makes, places, created_at) VALUES (?, ?, '[]', ?, ?)").run(randomBytes(6).toString("hex"), name, JSON.stringify(places), route.created_at);
      }
    }
  },
];

export type CostSource = "provider" | "computed" | "unknown";
// chat: text from /chat/completions. image: /images/generations, or a chat request asking for
// images. speech: /audio/speech, or a chat request asking for audio. transcription: /audio/transcriptions.
// video: /videos, a job that is made over minutes.
export type Kind = "chat" | "image" | "speech" | "transcription" | "video";
export type Failure = "upstream_error" | "stream_error" | "network_error" | "client_cancelled";

export interface ProviderRow {
  id: string;
  kind: string;
  name: string;
  key_sealed: string;
  key_hint: string;
  status: "up" | "down";
  error: string | null;
  models: number | null;
  checked_at: number;
  created_at: number;
}

export interface RouteRow {
  id: string;
  name: string;
  key_hash: string;
  key_hint: string;
  budget_usd: number;
  enabled: number;
  models: string;
  icon: string;
  color: string;
  keep_media: number;
  created_at: number;
}

export type MediaKind = "image" | "audio" | "video";

// A video job OpenRouter is making. id is OpenRouter's ("gen-vid-…"). keep: the video is to be
// kept once it is made. status is OpenRouter's last word on it; done_at is set once it is
// finished one way or another and its cost is recorded.
export interface VideoJobRow {
  id: string;
  request_id: number | null;
  route_id: string | null;
  model: string | null;
  prompt: string | null;
  keep: number;
  status: string;
  created_at: number;
  done_at: number | null;
}

export interface MediaRow {
  id: string;
  kind: MediaKind;
  request_id: number | null;
  route_id: string | null;
  created_at: number;
  model: string | null;
  prompt: string | null;
  media_type: string;
  bytes: number;
  file: string; // the file's name in the media folder: <sha256>.<ext>
}

// An image or sound with what its request cost.
export type MediaListed = MediaRow & { cost_usd: number | null };

export interface RequestRow {
  id: number;
  route_id: string | null;
  provider_id: string | null;
  started_at: number;
  kind: Kind;
  model_requested: string | null;
  model_served: string | null;
  streamed: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  cost_source: CostSource;
  first_token_ms: number | null;
  total_ms: number;
  status: number | null;
  failure: Failure | null;
  upstream_id: string | null;
}

export type NewRequest = Omit<RequestRow, "id" | "streamed"> & { streamed: boolean };

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return migrate(db);
}

// Brings a database up to this version, one step at a time.
export function migrate(db: Database): Database {
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version > MIGRATIONS.length) throw new Error(`The database is from a newer BaseRouter (version ${user_version}). Update BaseRouter to open it.`);
  if (user_version === MIGRATIONS.length) return db;
  // A step may rebuild a table that others point to. Foreign keys are off while it does
  // (they cannot be switched inside a transaction), checked once all steps are done, and
  // put back as they were.
  const { foreign_keys } = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    for (let version = user_version; version < MIGRATIONS.length; version++) {
      const step = MIGRATIONS[version]!;
      db.transaction(() => {
        if (typeof step === "string") db.exec(step);
        else step(db);
        db.exec(`PRAGMA user_version = ${version + 1}`);
      })();
    }
    const broken = db.query("PRAGMA foreign_key_check").all();
    if (broken.length > 0) throw new Error(`The database has ${broken.length} rows that point at rows that are gone.`);
  } finally {
    db.exec(`PRAGMA foreign_keys = ${foreign_keys ? "ON" : "OFF"}`);
  }
  return db;
}

export class Store {
  constructor(readonly db: Database) {}

  setting(key: string): string | null {
    const row = this.db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  addSession(tokenHash: string, expiresAt: number): void {
    this.db.query("INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)").run(tokenHash, expiresAt);
  }

  hasSession(tokenHash: string, now: number): boolean {
    this.db.query("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    return this.db.query("SELECT 1 FROM sessions WHERE token_hash = ?").get(tokenHash) !== null;
  }

  dropSession(tokenHash: string): void {
    this.db.query("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  // Every session except the one given ends.
  dropOtherSessions(keep: string): void {
    this.db.query("DELETE FROM sessions WHERE token_hash != ?").run(keep);
  }

  providers(): ProviderRow[] {
    return this.db.query("SELECT * FROM providers ORDER BY created_at").all() as ProviderRow[];
  }

  provider(id: string): ProviderRow | null {
    return this.db.query("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | null;
  }

  addProvider(row: ProviderRow): void {
    this.db
      .query("INSERT INTO providers (id, kind, name, key_sealed, key_hint, status, error, models, checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.kind, row.name, row.key_sealed, row.key_hint, row.status, row.error, row.models, row.checked_at, row.created_at);
  }

  // models is left as it was when the check could not count them.
  markProvider(id: string, status: "up" | "down", error: string | null, models: number | null, at: number): void {
    this.db.query("UPDATE providers SET status = ?, error = ?, models = COALESCE(?, models), checked_at = ? WHERE id = ?").run(status, error, models, at, id);
  }

  removeProvider(id: string): boolean {
    return this.db.query("DELETE FROM providers WHERE id = ?").run(id).changes > 0;
  }

  routes(): RouteRow[] {
    return this.db.query("SELECT * FROM routes ORDER BY created_at").all() as RouteRow[];
  }

  route(id: string): RouteRow | null {
    return this.db.query("SELECT * FROM routes WHERE id = ?").get(id) as RouteRow | null;
  }

  routeByKeyHash(hash: string): RouteRow | null {
    return this.db.query("SELECT * FROM routes WHERE key_hash = ?").get(hash) as RouteRow | null;
  }

  addRoute(row: RouteRow): void {
    this.db
      .query("INSERT INTO routes (id, name, key_hash, key_hint, budget_usd, enabled, models, icon, color, keep_media, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.name, row.key_hash, row.key_hint, row.budget_usd, row.enabled, row.models, row.icon, row.color, row.keep_media, row.created_at);
  }

  updateRoute(id: string, change: { budget_usd?: number; enabled?: boolean; models?: string[]; key_hash?: string; key_hint?: string; keep_media?: boolean }): void {
    this.db.transaction(() => {
      if (change.keep_media !== undefined) this.db.query("UPDATE routes SET keep_media = ? WHERE id = ?").run(change.keep_media ? 1 : 0, id);
      if (change.budget_usd !== undefined) this.db.query("UPDATE routes SET budget_usd = ? WHERE id = ?").run(change.budget_usd, id);
      if (change.enabled !== undefined) this.db.query("UPDATE routes SET enabled = ? WHERE id = ?").run(change.enabled ? 1 : 0, id);
      if (change.models !== undefined) this.db.query("UPDATE routes SET models = ? WHERE id = ?").run(JSON.stringify(change.models), id);
      if (change.key_hash !== undefined && change.key_hint !== undefined) {
        this.db.query("UPDATE routes SET key_hash = ?, key_hint = ? WHERE id = ?").run(change.key_hash, change.key_hint, id);
      }
    })();
  }

  allRequests(): RequestRow[] {
    return this.db.query("SELECT * FROM requests ORDER BY id").all() as RequestRow[];
  }

  removeRoute(id: string): boolean {
    return this.db.query("DELETE FROM routes WHERE id = ?").run(id).changes > 0;
  }

  addRequest(r: NewRequest): number {
    const result = this.db
      .query(
        `INSERT INTO requests (route_id, provider_id, started_at, kind, model_requested, model_served, streamed, prompt_tokens,
           completion_tokens, cost_usd, cost_source, first_token_ms, total_ms, status, failure, upstream_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.route_id, r.provider_id, r.started_at, r.kind, r.model_requested, r.model_served, r.streamed ? 1 : 0, r.prompt_tokens,
        r.completion_tokens, r.cost_usd, r.cost_source, r.first_token_ms, r.total_ms, r.status, r.failure, r.upstream_id,
      );
    return Number(result.lastInsertRowid);
  }

  // Fills in a request whose response ended without saying what it cost.
  fillRequest(id: number, fill: { cost: number; promptTokens: number | null; completionTokens: number | null; model: string | null }): void {
    this.db
      .query(
        `UPDATE requests SET cost_usd = ?, cost_source = 'provider', prompt_tokens = COALESCE(prompt_tokens, ?),
           completion_tokens = COALESCE(completion_tokens, ?), model_served = COALESCE(model_served, ?)
         WHERE id = ? AND cost_usd IS NULL`,
      )
      .run(fill.cost, fill.promptTokens, fill.completionTokens, fill.model, id);
  }

  request(id: number): RequestRow | null {
    return this.db.query("SELECT * FROM requests WHERE id = ?").get(id) as RequestRow | null;
  }

  // Newest first. "before" is the id of the last row of the previous page.
  requests(filter: { route?: string; before?: number; limit: number }): RequestRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.route) (where.push("route_id = ?"), args.push(filter.route));
    if (filter.before) (where.push("id < ?"), args.push(filter.before));
    const sql = `SELECT * FROM requests ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`;
    return this.db.query(sql).all(...args, filter.limit) as RequestRow[];
  }

  // What a route has spent since a moment. Requests of unknown cost count as nothing.
  spentSince(routeId: string, since: number): number {
    const row = this.db.query("SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM requests WHERE route_id = ? AND started_at >= ?").get(routeId, since) as { spent: number };
    return row.spent;
  }

  // Total spend in each of the given periods. "starts" are the period starts in order; the
  // last period runs until now. Requests before the first start are not counted.
  spendPerPeriod(starts: number[]): number[] {
    if (starts.length === 0) return [];
    const rows = this.db.query("SELECT started_at, cost_usd FROM requests WHERE started_at >= ? AND cost_usd IS NOT NULL").all(starts[0]!) as { started_at: number; cost_usd: number }[];
    const totals = starts.map(() => 0);
    for (const row of rows) {
      let i = starts.length - 1;
      while (i > 0 && row.started_at < starts[i]!) i--;
      totals[i]! += row.cost_usd;
    }
    return totals;
  }

  countSince(since: number): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM requests WHERE started_at >= ?").get(since) as { n: number }).n;
  }

  // Per route: spend since the start of the month and since the start of the day.
  spendByRoute(monthStart: number, dayStart: number): Map<string, { used: number; today: number }> {
    const rows = this.db
      .query(
        `SELECT route_id, COALESCE(SUM(cost_usd), 0) AS used,
           COALESCE(SUM(CASE WHEN started_at >= ? THEN cost_usd END), 0) AS today
         FROM requests WHERE started_at >= ? AND route_id IS NOT NULL GROUP BY route_id`,
      )
      .all(dayStart, monthStart) as { route_id: string; used: number; today: number }[];
    return new Map(rows.map((r) => [r.route_id, { used: r.used, today: r.today }]));
  }

  addMedia(r: MediaRow): void {
    this.db
      .query("INSERT INTO media (id, kind, request_id, route_id, created_at, model, prompt, media_type, bytes, file) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(r.id, r.kind, r.request_id, r.route_id, r.created_at, r.model, r.prompt, r.media_type, r.bytes, r.file);
  }

  mediaItem(id: string): MediaRow | null {
    return this.db.query("SELECT * FROM media WHERE id = ?").get(id) as MediaRow | null;
  }

  // Newest first. "before" is the id of the last one of the previous page.
  media(filter: { kind?: MediaKind; route?: string; before?: string; limit: number }): MediaListed[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.kind) (where.push("m.kind = ?"), args.push(filter.kind));
    if (filter.route) (where.push("m.route_id = ?"), args.push(filter.route));
    if (filter.before) {
      const last = this.mediaItem(filter.before);
      if (last) (where.push("(m.created_at, m.id) < (?, ?)"), args.push(last.created_at, last.id));
    }
    const sql = `SELECT m.*, r.cost_usd FROM media m LEFT JOIN requests r ON r.id = m.request_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`;
    return this.db.query(sql).all(...args, filter.limit) as MediaListed[];
  }

  removeMedia(id: string): void {
    this.db.query("DELETE FROM media WHERE id = ?").run(id);
  }

  fileInUse(file: string): boolean {
    return this.db.query("SELECT 1 FROM media WHERE file = ? LIMIT 1").get(file) !== null;
  }

  oldestMedia(): MediaRow | null {
    return this.db.query("SELECT * FROM media ORDER BY created_at, id LIMIT 1").get() as MediaRow | null;
  }

  addVideoJob(job: VideoJobRow): void {
    this.db
      .query("INSERT INTO video_jobs (id, request_id, route_id, model, prompt, keep, status, created_at, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(job.id, job.request_id, job.route_id, job.model, job.prompt, job.keep, job.status, job.created_at, job.done_at);
  }

  videoJob(id: string): VideoJobRow | null {
    return this.db.query("SELECT * FROM video_jobs WHERE id = ?").get(id) as VideoJobRow | null;
  }

  openVideoJobs(): VideoJobRow[] {
    return this.db.query("SELECT * FROM video_jobs WHERE done_at IS NULL ORDER BY created_at").all() as VideoJobRow[];
  }

  videoJobStatus(id: string, status: string): void {
    this.db.query("UPDATE video_jobs SET status = ? WHERE id = ? AND done_at IS NULL").run(status, id);
  }

  // Marks a job finished and records it on its request: what it cost, whether it failed, how
  // long it took from start to end. True only for the one caller that finished it, so the
  // gateway's own watch and a client's poll arriving together record it once.
  finishVideoJob(id: string, end: { status: string; at: number; cost: number | null; failure: Failure | null }): boolean {
    return this.db.transaction(() => {
      const done = this.db.query("UPDATE video_jobs SET status = ?, done_at = ? WHERE id = ? AND done_at IS NULL").run(end.status, end.at, id).changes > 0;
      if (!done) return false;
      const job = this.videoJob(id)!;
      if (job.request_id !== null) {
        this.db
          .query(
            `UPDATE requests SET cost_usd = COALESCE(?, cost_usd), cost_source = CASE WHEN ? IS NULL THEN cost_source ELSE 'provider' END,
               failure = COALESCE(failure, ?), total_ms = MAX(total_ms, ? - started_at) WHERE id = ?`,
          )
          .run(end.cost, end.cost, end.failure, end.at, job.request_id);
      }
      return true;
    })();
  }

  models(): Model[] {
    return (this.db.query("SELECT * FROM models ORDER BY created_at, name").all() as ModelRow[]).map(toModel);
  }

  model(id: string): Model | null {
    const row = this.db.query("SELECT * FROM models WHERE id = ?").get(id) as ModelRow | null;
    return row ? toModel(row) : null;
  }

  modelByName(name: string): Model | null {
    const row = this.db.query("SELECT * FROM models WHERE name = ?").get(name) as ModelRow | null;
    return row ? toModel(row) : null;
  }

  addModel(m: { id: string; name: string; makes: string[]; places: Place[]; created_at: number }): void {
    this.db.query("INSERT INTO models (id, name, makes, places, created_at) VALUES (?, ?, ?, ?, ?)").run(m.id, m.name, JSON.stringify(m.makes), JSON.stringify(m.places), m.created_at);
  }

  // Changes a model. A new name is carried into every route that lists the old one.
  updateModel(id: string, change: { name?: string; makes?: string[]; places?: Place[] }): void {
    this.db.transaction(() => {
      const before = this.model(id);
      if (!before) return;
      if (change.makes) this.db.query("UPDATE models SET makes = ? WHERE id = ?").run(JSON.stringify(change.makes), id);
      if (change.places) this.db.query("UPDATE models SET places = ? WHERE id = ?").run(JSON.stringify(change.places), id);
      if (change.name !== undefined && change.name !== before.name) {
        this.db.query("UPDATE models SET name = ? WHERE id = ?").run(change.name, id);
        this.renameInRoutes(before.name, change.name);
      }
    })();
  }

  // Removes a model, and its name from every route that lists it.
  removeModel(id: string): boolean {
    return this.db.transaction(() => {
      const before = this.model(id);
      if (!before) return false;
      this.db.query("DELETE FROM models WHERE id = ?").run(id);
      this.renameInRoutes(before.name, null);
      return true;
    })();
  }

  private renameInRoutes(from: string, to: string | null): void {
    for (const route of this.routes()) {
      const names = namesOf(route);
      if (!names.includes(from)) continue;
      const next = to === null ? names.filter((n) => n !== from) : names.map((n) => (n === from ? to : n));
      this.db.query("UPDATE routes SET models = ? WHERE id = ?").run(JSON.stringify([...new Set(next)]), route.id);
    }
  }

  // How many images, sounds and videos, and the room their files take: the same bytes kept twice count once.
  mediaSpace(): { images: number; sounds: number; videos: number; bytes: number } {
    const counts = this.db.query("SELECT kind, COUNT(*) AS n FROM media GROUP BY kind").all() as { kind: MediaKind; n: number }[];
    const count = (kind: MediaKind) => counts.find((c) => c.kind === kind)?.n ?? 0;
    const bytes = (this.db.query("SELECT COALESCE(SUM(bytes), 0) AS b FROM (SELECT file, MAX(bytes) AS bytes FROM media GROUP BY file)").get() as { b: number }).b;
    return { images: count("image"), sounds: count("audio"), videos: count("video"), bytes };
  }
}
