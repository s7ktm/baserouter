// The management API the panel talks to: /api. Everything except status, setup and
// login needs a session, which is given in exchange for the admin password.
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { dayStart, monthStart, nextMonthStart, localDate } from "./budget.ts";
import type { Deps, Env } from "./deps.ts";
import * as openrouter from "./openrouter.ts";
import { hashKey, keyHint, newRouteKey, newToken, seal, unseal } from "./secrets.ts";
import type { ProviderRow, RequestRow, RouteRow } from "./store.ts";

const COOKIE = "br_session";
const SESSION_DAYS = 30;
const MIN_PASSWORD = 8;
// After this many wrong passwords in a row, sign-in is closed for a while.
const MAX_WRONG = 5;
const LOCK_MS = 60_000;

type Status = 400 | 401 | 403 | 404 | 409 | 422 | 429;
const fail = (c: Context, status: Status, code: string, message: string) => c.json({ error: { code, message } }, status);

const newId = () => randomBytes(6).toString("hex");

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body) ? body : {};
}

function providerView(p: ProviderRow) {
  return { id: p.id, kind: p.kind, name: p.name, status: p.status, keyHint: p.key_hint, models: p.models, error: p.error, checkedAt: p.checked_at };
}

function requestView(r: RequestRow) {
  return {
    id: r.id,
    route: r.route_id,
    at: r.started_at,
    requestedModel: r.model_requested,
    model: r.model_served ?? r.model_requested,
    streamed: r.streamed === 1,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    cost: r.cost_usd,
    costSource: r.cost_source,
    firstTokenMs: r.first_token_ms,
    totalMs: r.total_ms,
    status: r.status,
    failure: r.failure,
    ok: r.failure === null,
  };
}

export function admin(deps: Deps) {
  const { store } = deps;
  const app = new Hono<Env>();
  let wrong = 0;
  let lockedUntil = 0;

  function routeView(r: RouteRow, spend: Map<string, { used: number; today: number }>) {
    const spent = spend.get(r.id) ?? { used: 0, today: 0 };
    return {
      id: r.id,
      name: r.name,
      enabled: r.enabled === 1,
      busy: (deps.running.get(r.id) ?? 0) > 0,
      today: spent.today,
      used: spent.used,
      budget: r.budget_usd,
      keyHint: r.key_hint,
      models: JSON.parse(r.models) as string[],
      icon: r.icon,
      color: r.color,
    };
  }

  function spendNow() {
    const now = new Date(deps.now());
    return store.spendByRoute(monthStart(now).getTime(), dayStart(now).getTime());
  }

  function startSession(c: Context): string {
    const token = newToken();
    const seconds = SESSION_DAYS * 24 * 60 * 60;
    store.addSession(hashKey(token), deps.now() + seconds * 1000);
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Strict", path: "/api", maxAge: seconds });
    return token;
  }

  function sessionToken(c: Context): string | null {
    const bearer = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "")?.[1]?.trim();
    return bearer ?? getCookie(c, COOKIE) ?? null;
  }

  // A browser page on another origin must not be able to use the session cookie.
  app.use(async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && URL.parse(origin)?.host !== c.req.header("host")) return fail(c, 403, "wrong_origin", "This request came from another site.");
    await next();
  });

  app.get("/status", (c) => c.json({ passwordSet: store.setting("admin_password") !== null }));

  // First run: whoever reaches the gateway first sets the password. It works once.
  app.post("/setup", async (c) => {
    if (store.setting("admin_password") !== null) return fail(c, 409, "already_set_up", "A password is already set. Sign in with it.");
    const { password } = await jsonBody(c);
    if (typeof password !== "string" || password.length < MIN_PASSWORD) {
      return fail(c, 400, "password_too_short", `Choose a password of at least ${MIN_PASSWORD} characters.`);
    }
    const hash = await Bun.password.hash(password);
    // Two first runs at the same moment: only the first one to finish hashing wins.
    if (store.setting("admin_password") !== null) return fail(c, 409, "already_set_up", "A password is already set. Sign in with it.");
    store.setSetting("admin_password", hash);
    return c.json({ token: startSession(c) }, 201);
  });

  app.post("/login", async (c) => {
    const hash = store.setting("admin_password");
    if (hash === null) return fail(c, 409, "not_set_up", "No password is set yet. Set one first.");
    if (deps.now() < lockedUntil) return fail(c, 429, "too_many_tries", "Too many wrong passwords. Wait a minute, then try again.");
    const { password } = await jsonBody(c);
    if (typeof password !== "string" || !(await Bun.password.verify(password, hash))) {
      if (++wrong >= MAX_WRONG) (lockedUntil = deps.now() + LOCK_MS), (wrong = 0);
      return fail(c, 401, "wrong_password", "That password is not right.");
    }
    wrong = 0;
    return c.json({ token: startSession(c) });
  });

  app.use(async (c, next) => {
    const token = sessionToken(c);
    if (!token || !store.hasSession(hashKey(token), deps.now())) return fail(c, 401, "signed_out", "Sign in to continue.");
    await next();
  });

  // Changes the password. Every other session ends; this one stays signed in.
  app.post("/password", async (c) => {
    const { current, password } = await jsonBody(c);
    if (deps.now() < lockedUntil) return fail(c, 429, "too_many_tries", "Too many wrong passwords. Wait a minute, then try again.");
    if (typeof current !== "string" || !(await Bun.password.verify(current, store.setting("admin_password")!))) {
      if (++wrong >= MAX_WRONG) (lockedUntil = deps.now() + LOCK_MS), (wrong = 0);
      return fail(c, 401, "wrong_password", "That password is not right.");
    }
    wrong = 0;
    if (typeof password !== "string" || password.length < MIN_PASSWORD) {
      return fail(c, 400, "password_too_short", `Choose a password of at least ${MIN_PASSWORD} characters.`);
    }
    store.setSetting("admin_password", await Bun.password.hash(password));
    store.dropOtherSessions(hashKey(sessionToken(c)!));
    return c.body(null, 204);
  });

  // Everything BaseRouter knows, in one file: routes, providers without their keys, and
  // every request. Key hashes and sealed keys are left out.
  app.get("/export", (c) => {
    const now = deps.now();
    const body = {
      baserouter: 1,
      exportedAt: new Date(now).toISOString(),
      routes: store.routes().map((r) => ({
        id: r.id, name: r.name, enabled: r.enabled === 1, budget: r.budget_usd, models: JSON.parse(r.models) as string[],
        icon: r.icon, color: r.color, keyHint: r.key_hint, createdAt: new Date(r.created_at).toISOString(),
      })),
      providers: store.providers().map((p) => ({ ...providerView(p), createdAt: new Date(p.created_at).toISOString() })),
      requests: store.allRequests().map((r) => ({ ...requestView(r), at: new Date(r.started_at).toISOString() })),
    };
    c.header("Content-Disposition", `attachment; filename="baserouter-${localDate(new Date(now))}.json"`);
    c.header("Cache-Control", "no-store");
    return c.json(body);
  });

  app.post("/logout", (c) => {
    const token = sessionToken(c);
    if (token) store.dropSession(hashKey(token));
    deleteCookie(c, COOKIE, { path: "/api" });
    return c.body(null, 204);
  });

  // Providers

  app.get("/providers", (c) => c.json({ providers: store.providers().map(providerView) }));

  // Adds a provider after testing its key. A key that fails the test is not stored.
  app.post("/providers", async (c) => {
    const { kind, key } = await jsonBody(c);
    if (kind !== "openrouter") return fail(c, 400, "unknown_provider", "Only OpenRouter can be added for now.");
    if (typeof key !== "string" || !key.trim()) return fail(c, 400, "key_missing", "Paste the provider's key.");
    if (store.providers().length > 0) return fail(c, 409, "provider_exists", "OpenRouter is already added. Remove it first to use another key.");

    const secret = key.trim();
    const result = await openrouter.check(deps.upstream, secret);
    if (!result.ok) return fail(c, 422, "provider_test_failed", result.error);

    const now = deps.now();
    const row: ProviderRow = {
      id: newId(), kind, name: "OpenRouter", key_sealed: seal(deps.master, secret), key_hint: keyHint(secret),
      status: "up", error: null, models: result.models, checked_at: now, created_at: now,
    };
    store.addProvider(row);
    return c.json({ provider: providerView(row) }, 201);
  });

  app.post("/providers/:id/test", async (c) => {
    const provider = store.provider(c.req.param("id"));
    if (!provider) return fail(c, 404, "not_found", "There is no such provider.");
    const result = await openrouter.check(deps.upstream, unseal(deps.master, provider.key_sealed));
    store.markProvider(provider.id, result.ok ? "up" : "down", result.ok ? null : result.error, result.ok ? result.models : null, deps.now());
    return c.json({ provider: providerView(store.provider(provider.id)!) });
  });

  app.delete("/providers/:id", (c) => {
    if (!store.removeProvider(c.req.param("id"))) return fail(c, 404, "not_found", "There is no such provider.");
    return c.body(null, 204);
  });

  // Routes

  app.get("/routes", (c) => {
    const spend = spendNow();
    return c.json({ routes: store.routes().map((r) => routeView(r, spend)), budgetsStartAgainOn: localDate(nextMonthStart(new Date(deps.now()))) });
  });

  const validBudget = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  const validModels = (v: unknown): v is string[] =>
    Array.isArray(v) && v.length <= 50 && v.every((m) => typeof m === "string" && m.trim() !== "" && m.length <= 200) && new Set(v.map((m: string) => m.trim())).size === v.length;

  // Makes a route. The answer is the only time its key is given in full.
  // icon and color are how the panel draws it; the gateway only keeps them.
  app.post("/routes", async (c) => {
    const { name, budget, models = [], icon = "code", color = "#2B62D9" } = await jsonBody(c);
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120) return fail(c, 400, "name_invalid", "Give the route a name of up to 120 characters.");
    if (!validBudget(budget)) return fail(c, 400, "budget_invalid", "Give the monthly budget as a number above zero.");
    if (!validModels(models)) return fail(c, 400, "models_invalid", "Give the models as a list of different model names.");
    if (typeof icon !== "string" || !/^[a-z][a-z0-9-]{0,23}$/.test(icon)) return fail(c, 400, "icon_invalid", "Give the icon as a short lowercase name.");
    if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail(c, 400, "color_invalid", "Give the colour as #RRGGBB.");

    const key = newRouteKey();
    const row: RouteRow = {
      id: newId(), name: name.trim(), key_hash: hashKey(key), key_hint: keyHint(key), budget_usd: budget, enabled: 1,
      models: JSON.stringify(models.map((m: string) => m.trim())), icon, color, created_at: deps.now(),
    };
    store.addRoute(row);
    return c.json({ route: routeView(row, new Map()), key }, 201);
  });

  app.patch("/routes/:id", async (c) => {
    const id = c.req.param("id");
    if (!store.route(id)) return fail(c, 404, "not_found", "There is no such route.");
    const { budget, enabled, models } = await jsonBody(c);
    if (budget !== undefined && !validBudget(budget)) return fail(c, 400, "budget_invalid", "Give the monthly budget as a number above zero.");
    if (enabled !== undefined && typeof enabled !== "boolean") return fail(c, 400, "enabled_invalid", 'Give "enabled" as true or false.');
    if (models !== undefined && !validModels(models)) return fail(c, 400, "models_invalid", "Give the models as a list of different model names.");
    store.updateRoute(id, { budget_usd: budget, enabled, models: (models as string[] | undefined)?.map((m) => m.trim()) });
    return c.json({ route: routeView(store.route(id)!, spendNow()) });
  });

  // Replaces a route's key. The old one stops working at once; the new one is given in
  // full only in this answer.
  app.post("/routes/:id/key", (c) => {
    const id = c.req.param("id");
    if (!store.route(id)) return fail(c, 404, "not_found", "There is no such route.");
    const key = newRouteKey();
    store.updateRoute(id, { key_hash: hashKey(key), key_hint: keyHint(key) });
    return c.json({ route: routeView(store.route(id)!, spendNow()), key });
  });

  // Its requests stay in the activity list, without a route.
  app.delete("/routes/:id", (c) => {
    if (!store.removeRoute(c.req.param("id"))) return fail(c, 404, "not_found", "There is no such route.");
    return c.body(null, 204);
  });

  // Everything the panel's home screen and its sheets draw from, in one answer.
  // "now" is the gateway's clock, so the panel can say how long ago a request was.
  app.get("/state", (c) => {
    const now = deps.now();
    const date = new Date(now);
    const day = dayStart(date).getTime();
    const [beforeToday, today] = store.spendPerPeriod([monthStart(date).getTime(), day]) as [number, number];
    const week = store.spendPerPeriod(Array.from({ length: 7 }, (_, i) => new Date(date.getFullYear(), date.getMonth(), date.getDate() - 6 + i).getTime()));
    const routes = store.routes();
    const spend = spendNow();
    const requests = store.requests({ limit: 100 }).map(requestView);
    const last = requests.find((r) => r.route !== null) ?? null;
    return c.json({
      now,
      spend: { today, month: beforeToday + today, week, requests: store.countSince(day) },
      providers: store.providers().map(providerView),
      routes: routes.map((r) => routeView(r, spend)),
      requests,
      last,
      budgetsStartAgainOn: localDate(nextMonthStart(date)),
    });
  });

  // The provider's model ids, for choosing a route's model. Kept for ten minutes.
  let models: { providerId: string; at: number; ids: string[] } | null = null;
  app.get("/models", async (c) => {
    const provider = store.providers()[0];
    if (!provider) return c.json({ models: [] });
    if (models && models.providerId === provider.id && deps.now() - models.at < 10 * 60_000) return c.json({ models: models.ids });
    try {
      const res = await openrouter.models(deps.upstream, unseal(deps.master, provider.key_sealed), AbortSignal.timeout(15_000));
      if (!res.ok) {
        await res.body?.cancel();
        return c.json({ models: [] });
      }
      const list = ((await res.json()) as { data?: { id?: unknown }[] }).data ?? [];
      const ids = list.map((m) => m.id).filter((id): id is string => typeof id === "string").sort();
      models = { providerId: provider.id, at: deps.now(), ids };
      return c.json({ models: ids });
    } catch {
      return c.json({ models: [] });
    }
  });

  // Activity, newest first. ?route=<id> filters; ?before=<request id> gets the next page.
  app.get("/requests", (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
    const before = Number(c.req.query("before")) || undefined;
    const rows = store.requests({ route: c.req.query("route") || undefined, before, limit });
    return c.json({ requests: rows.map(requestView) });
  });

  return app;
}
