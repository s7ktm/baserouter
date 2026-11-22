// The management API the panel talks to: /api. Everything except status, setup and
// login needs a session, which is given in exchange for the admin password.
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { dayStart, monthStart, nextMonthStart, localDate } from "./budget.ts";
import type { Deps, Env } from "./deps.ts";
import type { CatalogueModel, ModelProvider } from "./catalogue.ts";
import { MODEL_NAME, namesOf, parseNames, parsePlaces, type Model } from "./models.ts";
import { MediaKeeper } from "./media.ts";
import * as providers from "./providers.ts";
import type { SendAs } from "./proxy.ts";
import { hashKey, keyHint, newRouteKey, newToken, seal, unseal } from "./secrets.ts";
import type { MediaKind, MediaListed, ProviderRow, RequestRow, RouteRow } from "./store.ts";

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

// "src" is where the panel loads the image from; it needs the session like the rest of /api.
function mediaView(i: MediaListed) {
  return {
    id: i.id, kind: i.kind, route: i.route_id, at: i.created_at, model: i.model, prompt: i.prompt, mediaType: i.media_type, bytes: i.bytes, cost: i.cost_usd,
    src: `/api/media/${i.id}`,
  };
}

function requestView(r: RequestRow) {
  return {
    id: r.id,
    route: r.route_id,
    at: r.started_at,
    kind: r.kind,
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

export function admin(deps: Deps, sendAs: SendAs) {
  const { store } = deps;
  const keeper = new MediaKeeper(deps);
  const space = () => ({ ...store.mediaSpace(), keeping: keeper.on, max: deps.mediaMaxBytes });
  const app = new Hono<Env>();
  let wrong = 0;
  let lockedUntil = 0;
  // Passwords are checked one at a time, so a burst of guesses sent at once is counted
  // like the same guesses sent one after another, and the lock closes after the fifth.
  let checking: Promise<unknown> = Promise.resolve();
  function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
    const run = checking.then(work, work);
    checking = run.catch(() => {});
    return run;
  }
  // Right or wrong; a wrong one counts towards the lock.
  async function passwordIs(password: unknown, hash: string): Promise<"right" | "wrong" | "locked"> {
    return oneAtATime(async () => {
      if (deps.now() < lockedUntil) return "locked";
      if (typeof password === "string" && (await Bun.password.verify(password, hash))) {
        wrong = 0;
        return "right";
      }
      if (++wrong >= MAX_WRONG) (lockedUntil = deps.now() + LOCK_MS), (wrong = 0);
      return "wrong";
    });
  }
  const tooMany = (c: Context) => fail(c, 429, "too_many_tries", "Too many wrong passwords. Wait a minute, then try again.");

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
      models: namesOf(r),
      icon: r.icon,
      color: r.color,
      keepMedia: r.keep_media === 1,
    };
  }

  // One request, with the name of the provider that answered it.
  function rowView(r: RequestRow) {
    return { ...requestView(r), provider: r.provider_id === null ? null : (store.provider(r.provider_id)?.name ?? null) };
  }

  function spendNow() {
    const now = new Date(deps.now());
    return store.spendByRoute(monthStart(now).getTime(), dayStart(now).getTime());
  }

  function startSession(c: Context): string {
    const token = newToken();
    const seconds = SESSION_DAYS * 24 * 60 * 60;
    store.addSession(hashKey(token), deps.now() + seconds * 1000);
    // Secure when the panel is reached over HTTPS (directly, or through Caddy), so the
    // browser never sends the cookie over plain HTTP to the same name.
    const https = new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Strict", path: "/api", maxAge: seconds, secure: https });
    return token;
  }

  function sessionToken(c: Context): string | null {
    const bearer = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "")?.[1]?.trim();
    return bearer ?? getCookie(c, COOKIE) ?? null;
  }

  // Only the names this gateway is reached by. A web page that points a name of its own
  // at this machine (DNS rebinding) would otherwise pass the origin check below, and could
  // set the password of a fresh gateway or guess at it.
  app.use(async (c, next) => {
    const host = (URL.parse(`http://${c.req.header("host") ?? ""}`)?.hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
    if (!deps.allowedHosts.includes(host)) {
      return fail(c, 403, "unknown_host", `BaseRouter is not set up to be reached as "${host.slice(0, 100)}". Add it to BASEROUTER_ALLOWED_HOSTS.`);
    }
    await next();
  });

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
    const { password } = await jsonBody(c);
    const answer = await passwordIs(password, hash);
    if (answer === "locked") return tooMany(c);
    if (answer === "wrong") return fail(c, 401, "wrong_password", "That password is not right.");
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
    const answer = await passwordIs(current, store.setting("admin_password")!);
    if (answer === "locked") return tooMany(c);
    if (answer === "wrong") return fail(c, 401, "wrong_password", "That password is not right.");
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
        id: r.id, name: r.name, enabled: r.enabled === 1, budget: r.budget_usd, models: namesOf(r),
        icon: r.icon, color: r.color, keepMedia: r.keep_media === 1, keyHint: r.key_hint, createdAt: new Date(r.created_at).toISOString(),
      })),
      providers: store.providers().map((p) => ({ ...providerView(p), createdAt: new Date(p.created_at).toISOString() })),
      models: store.models().map(modelView),
      requests: store.allRequests().map((r) => ({ ...requestView(r), at: new Date(r.started_at).toISOString() })),
      // The images and sounds themselves are files in the media folder; here is what is known about each.
      media: store.media({ limit: 1_000_000 }).map((i) => {
        const { src: _, ...rest } = mediaView(i);
        return { ...rest, file: i.file, at: new Date(i.created_at).toISOString() };
      }),
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
    const name = typeof kind === "string" && Object.hasOwn(providers.KINDS, kind) ? providers.KINDS[kind]! : null;
    if (typeof kind !== "string" || !name) return fail(c, 400, "unknown_provider", `BaseRouter can add ${Object.values(providers.KINDS).join(" and ")} for now.`);
    if (typeof key !== "string" || !key.trim()) return fail(c, 400, "key_missing", "Paste the provider's key.");
    // One of each: a second key for the same provider would be a second place for every model.
    if (store.providers().some((p) => p.kind === kind)) return fail(c, 409, "provider_exists", `${name} is already added. Remove it first to use another key.`);

    const secret = key.trim();
    const result = await providers.check(deps, kind, secret);
    if (!result.ok) return fail(c, 422, "provider_test_failed", result.error);

    const now = deps.now();
    const row: ProviderRow = {
      id: newId(), kind, name, key_sealed: seal(deps.master, secret), key_hint: keyHint(secret),
      status: "up", error: null, models: result.models, checked_at: now, created_at: now,
    };
    store.addProvider(row);
    return c.json({ provider: providerView(row) }, 201);
  });

  app.post("/providers/:id/test", async (c) => {
    const provider = store.provider(c.req.param("id"));
    if (!provider) return fail(c, 404, "not_found", "There is no such provider.");
    const result = await providers.check(deps, provider.kind, unseal(deps.master, provider.key_sealed));
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
  const badNames = "Give the models as a list of up to 50 different model names.";

  // The names a route lists that are not models in BaseRouter yet become models, at the first
  // provider, under the provider's own id. (Picking a model a provider offers does the same.)
  function adopt(names: string[]): void {
    const first = store.providers()[0];
    for (const name of names) {
      if (store.modelByName(name)) continue;
      store.addModel({ id: newId(), name, makes: offerOf(first?.id, name)?.makes ?? [], places: first ? [{ provider: first.id, model: name, via: null }] : [], created_at: deps.now() });
    }
  }

  // Makes a route. The answer is the only time its key is given in full.
  // icon and color are how the panel draws it; the gateway only keeps them.
  app.post("/routes", async (c) => {
    const { name, budget, models = [], icon = "code", color = "#2B62D9", keepMedia = true } = await jsonBody(c);
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120) return fail(c, 400, "name_invalid", "Give the route a name of up to 120 characters.");
    if (!validBudget(budget)) return fail(c, 400, "budget_invalid", "Give the monthly budget as a number above zero.");
    const names = parseNames(models);
    if (!names) return fail(c, 400, "models_invalid", badNames);
    if (typeof icon !== "string" || !/^[a-z][a-z0-9-]{0,23}$/.test(icon)) return fail(c, 400, "icon_invalid", "Give the icon as a short lowercase name.");
    if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail(c, 400, "color_invalid", "Give the colour as #RRGGBB.");
    if (typeof keepMedia !== "boolean") return fail(c, 400, "keep_media_invalid", 'Give "keepMedia" as true or false.');

    const key = newRouteKey();
    const row: RouteRow = {
      id: newId(), name: name.trim(), key_hash: hashKey(key), key_hint: keyHint(key), budget_usd: budget, enabled: 1,
      models: JSON.stringify(names), icon, color, keep_media: keepMedia ? 1 : 0, created_at: deps.now(),
    };
    adopt(names);
    store.addRoute(row);
    return c.json({ route: routeView(row, new Map()), key }, 201);
  });

  app.patch("/routes/:id", async (c) => {
    const id = c.req.param("id");
    if (!store.route(id)) return fail(c, 404, "not_found", "There is no such route.");
    const { budget, enabled, models, keepMedia } = await jsonBody(c);
    if (budget !== undefined && !validBudget(budget)) return fail(c, 400, "budget_invalid", "Give the monthly budget as a number above zero.");
    if (enabled !== undefined && typeof enabled !== "boolean") return fail(c, 400, "enabled_invalid", 'Give "enabled" as true or false.');
    const names = models === undefined ? undefined : parseNames(models);
    if (names === null) return fail(c, 400, "models_invalid", badNames);
    if (keepMedia !== undefined && typeof keepMedia !== "boolean") return fail(c, 400, "keep_media_invalid", 'Give "keepMedia" as true or false.');
    if (names) adopt(names);
    store.updateRoute(id, { budget_usd: budget, enabled, models: names, keep_media: keepMedia });
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

  // The playground: a request sent as this route, with the panel's session in place of the
  // route's key, which nobody holds (only its hash is kept). The body is what an app would
  // send to /v1/chat/completions (try) or /v1/images/generations (try/images), and everything
  // that holds for the route holds here: its switch, its budget, its models, one row in its
  // requests, an image kept if the route keeps what it makes. Nothing of a conversation is
  // kept. So the panel can say what answered, what it cost and how long it took, a stream
  // ends with one event more than the provider sent, the request's row; an answer that is not
  // a stream names its row in the header X-BaseRouter-Request (see GET /requests/:id).
  const told = (rowId: number) => {
    const row = store.request(rowId);
    return row ? new TextEncoder().encode(`\nevent: baserouter.request\ndata: ${JSON.stringify(rowView(row))}\n\n`) : null;
  };
  for (const [path, what] of [["/routes/:id/try", "chat"], ["/routes/:id/try/images", "image"]] as const) {
    app.post(path, async (c) => {
      const route = store.route(c.req.param("id"));
      if (!route) return fail(c, 404, "not_found", "There is no such route.");
      return sendAs(c, route, what, told);
    });
  }

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
      images: store.media({ kind: "image", limit: 60 }).map(mediaView),
      sounds: store.media({ kind: "audio", limit: 60 }).map(mediaView),
      videos: store.media({ kind: "video", limit: 60 }).map(mediaView),
      mediaSpace: space(),
      models: store.models().map(modelView),
      budgetsStartAgainOn: localDate(nextMonthStart(date)),
    });
  });

  // What the providers offer, to find models in: what each model makes, takes and costs (see
  // catalogue.ts), and which provider offers it. Each provider is asked once in ten minutes.
  const offersAt = new Map<string, { at: number; list: CatalogueModel[] }>();
  const offerOf = (provider: string | undefined, id: string) => (provider ? offersAt.get(provider)?.list.find((m) => m.id === id) : undefined) ?? null;
  app.get("/offers", async (c) => {
    const all = store.providers();
    for (const id of offersAt.keys()) if (!all.some((p) => p.id === id)) offersAt.delete(id);
    await Promise.all(
      all.map(async (provider) => {
        const kept = offersAt.get(provider.id);
        if (kept && deps.now() - kept.at < 10 * 60_000) return;
        const list = await providers.offers(deps, provider, unseal(deps.master, provider.key_sealed)).catch(() => null);
        if (list) offersAt.set(provider.id, { at: deps.now(), list });
      }),
    );
    // Models whose kind was not known when they were made learn it now.
    for (const m of store.models()) {
      const kind = !m.makes.length && m.places[0] ? offerOf(m.places[0].provider, m.places[0].model)?.makes : null;
      if (kind?.length) store.updateModel(m.id, { makes: kind });
    }
    const offers = all.flatMap((provider) => (offersAt.get(provider.id)?.list ?? []).map((m) => ({ ...m, provider: provider.id })));
    return c.json({ offers, ...(all[0] ? { provider: all[0].id } : {}) });
  });

  // Where one model comes from: its provider's own providers for it (OpenRouter's endpoints
  // list, NanoGPT's providers list), with what each charges. ?model=<id>, and ?provider=<id>
  // for a provider other than the first. Kept for ten minutes each.
  const providersCache = new Map<string, { at: number; list: ModelProvider[] }>();
  app.get("/offers/endpoints", async (c) => {
    const model = c.req.query("model") ?? "";
    const asked = c.req.query("provider");
    const provider = asked ? store.provider(asked) : store.providers()[0];
    // At OpenRouter exactly "author/name": the id becomes part of a path there.
    const parts = model.split("/");
    const bad = !MODEL_NAME.test(model) || (provider && !providers.isNano(provider) && (parts.length !== 2 || parts.some((p) => p === "." || p === "..")));
    if (bad) return fail(c, 400, "model_invalid", "Give a model id, such as ?model=google/gemini-2.5-flash.");
    if (!provider) return c.json({ providers: [] });
    const name = `${provider.id} ${model}`;
    const cached = providersCache.get(name);
    if (cached && deps.now() - cached.at < 10 * 60_000) return c.json({ providers: cached.list });
    try {
      const list = await providers.modelProviders(deps, provider, unseal(deps.master, provider.key_sealed), model);
      if (providersCache.size > 500) providersCache.clear();
      if (list.length) providersCache.set(name, { at: deps.now(), list });
      return c.json({ providers: list });
    } catch {
      return c.json({ providers: [] });
    }
  });

  // Models in BaseRouter: the name apps send, what it makes, the places it comes from in order.
  function modelView(m: Model) {
    return { id: m.id, name: m.name, makes: m.makes.length ? m.makes : offerOf(m.places[0]?.provider, m.places[0]?.model ?? "")?.makes ?? [], from: m.places };
  }
  const badPlaces = 'Give "from" as 1 to 10 different places, each { provider, model, via? }: a provider BaseRouter holds a key for, its id for the model, and which of that provider\'s own providers, when it has them.';
  const badName = "Give the model a name of letters, digits and . : / @ + ~ - (up to 200), that no other model has.";

  app.get("/models", (c) => c.json({ models: store.models().map(modelView) }));

  // Makes a model. Without a name, it is named after its first place's id.
  app.post("/models", async (c) => {
    const { name, from, makes } = await jsonBody(c);
    const places = parsePlaces(from, store.providers());
    if (!places) return fail(c, 400, "places_invalid", badPlaces);
    const chosen = typeof name === "string" ? name.trim() : places[0]!.model;
    if (!MODEL_NAME.test(chosen) || store.modelByName(chosen)) return fail(c, 400, "name_invalid", badName);
    const kinds = offerOf(places[0]!.provider, places[0]!.model)?.makes ?? (Array.isArray(makes) ? makes.filter((k): k is string => typeof k === "string").slice(0, 8) : []);
    const id = newId();
    store.addModel({ id, name: chosen, makes: kinds, places, created_at: deps.now() });
    return c.json({ model: modelView(store.model(id)!) }, 201);
  });

  // Renames a model (its routes follow) or changes its places.
  app.patch("/models/:id", async (c) => {
    const id = c.req.param("id");
    const before = store.model(id);
    if (!before) return fail(c, 404, "not_found", "There is no such model.");
    const { name, from } = await jsonBody(c);
    const places = from === undefined ? undefined : parsePlaces(from, store.providers());
    if (places === null) return fail(c, 400, "places_invalid", badPlaces);
    const renamed = typeof name === "string" ? name.trim() : name === undefined ? undefined : null;
    if (renamed === null || (renamed !== undefined && (!MODEL_NAME.test(renamed) || (renamed !== before.name && store.modelByName(renamed))))) return fail(c, 400, "name_invalid", badName);
    // A new first source may make something else: its kind follows, when the provider's list says.
    const makes = places ? offerOf(places[0]!.provider, places[0]!.model)?.makes : undefined;
    store.updateModel(id, { name: renamed, places, makes: makes?.length ? makes : undefined });
    return c.json({ model: modelView(store.model(id)!) });
  });

  // Deletes a model; the routes that listed it lose it.
  app.delete("/models/:id", (c) => {
    if (!store.removeModel(c.req.param("id"))) return fail(c, 404, "not_found", "There is no such model.");
    return c.body(null, 204);
  });

  // Activity, newest first. ?route=<id> filters; ?before=<request id> gets the next page.
  app.get("/requests", (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
    const before = Number(c.req.query("before")) || undefined;
    const rows = store.requests({ route: c.req.query("route") || undefined, before, limit });
    return c.json({ requests: rows.map(requestView) });
  });

  // One request, as the list above gives it, with the name of the provider that answered.
  app.get("/requests/:id", (c) => {
    const id = Number(c.req.param("id"));
    const row = Number.isInteger(id) && id > 0 ? store.request(id) : null;
    if (!row) return fail(c, 404, "not_found", "There is no such request.");
    return c.json({ request: rowView(row) });
  });

  // Kept images, sound and video, newest first. ?kind=image|audio|video and ?route=<id> filter;
  // ?before=<id> gets the next page.
  app.get("/media", (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 60, 1), 200);
    const kind = (["image", "audio", "video"] as const).find((k) => k === c.req.query("kind"));
    const rows = store.media({ kind, route: c.req.query("route") || undefined, before: c.req.query("before") || undefined, limit });
    return c.json({ media: rows.map(mediaView), space: space() });
  });

  // One file's bytes, or a range of them (browsers ask for ranges to play and seek sound and video;
  // Safari will not play it otherwise). Its type was decided from its bytes when it was kept.
  // It is sent so that the browser cannot run anything in it (an SVG can hold a script).
  app.get("/media/:id", async (c) => {
    const row = store.mediaItem(c.req.param("id"));
    const file = row && deps.mediaDir ? Bun.file(keeper.path(row)) : null;
    if (!row || !file || !(await file.exists())) return fail(c, 404, "not_found", "There is no such file.");
    const name = `baserouter-${localDate(new Date(row.created_at))}-${row.id}.${row.file.split(".").pop()}`;
    const headers: Record<string, string> = {
      "Content-Type": row.media_type,
      "Content-Disposition": `${c.req.query("download") ? "attachment" : "inline"}; filename="${name}"`,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header("range") ?? "");
    if (range && (range[1] || range[2])) {
      const size = file.size;
      // "bytes=a-b", "bytes=a-" or the last n bytes, "bytes=-n"
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
      return new Response(file.slice(start, end + 1), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}` } });
    }
    return new Response(file, { headers });
  });

  app.delete("/media/:id", (c) => {
    if (!keeper.remove(c.req.param("id"))) return fail(c, 404, "not_found", "There is no such file.");
    return c.body(null, 204);
  });

  return app;
}
