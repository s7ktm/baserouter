// SQLite storage. All SQL lives in this file.
import { Database } from "bun:sqlite";

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
const MIGRATIONS: string[] = [
  SCHEMA,
  // 2: how the panel draws a route
  `ALTER TABLE routes ADD COLUMN icon TEXT NOT NULL DEFAULT 'code';
   ALTER TABLE routes ADD COLUMN color TEXT NOT NULL DEFAULT '#2B62D9';`,
];

export type CostSource = "provider" | "computed" | "unknown";
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
  created_at: number;
}

export interface RequestRow {
  id: number;
  route_id: string | null;
  provider_id: string | null;
  started_at: number;
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
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version > MIGRATIONS.length) throw new Error(`The database is from a newer BaseRouter (version ${user_version}). Update BaseRouter to open it.`);
  for (let version = user_version; version < MIGRATIONS.length; version++) {
    db.transaction(() => db.exec(`${MIGRATIONS[version]}\nPRAGMA user_version = ${version + 1};`))();
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
      .query("INSERT INTO routes (id, name, key_hash, key_hint, budget_usd, enabled, models, icon, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.name, row.key_hash, row.key_hint, row.budget_usd, row.enabled, row.models, row.icon, row.color, row.created_at);
  }

  updateRoute(id: string, change: { budget_usd?: number; enabled?: boolean; models?: string[]; key_hash?: string; key_hint?: string }): void {
    this.db.transaction(() => {
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
        `INSERT INTO requests (route_id, provider_id, started_at, model_requested, model_served, streamed, prompt_tokens,
           completion_tokens, cost_usd, cost_source, first_token_ms, total_ms, status, failure, upstream_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.route_id, r.provider_id, r.started_at, r.model_requested, r.model_served, r.streamed ? 1 : 0, r.prompt_tokens,
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
}
