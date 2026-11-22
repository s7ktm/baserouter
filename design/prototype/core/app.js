// The shared mechanism: one state, one set of actions, any skin on top.
// Served by a gateway, the state is the gateway's and actions go to its API. Anywhere
// else, or with ?state=..., it is the made-up data in data.js and nothing is saved.
import { states, catalog, modelChoices, offers, providersFor, playSample } from "./data.js";
import { modelPicker } from "./screens/models.js";
import { api, gatewayStatus, requestRow, SignedOut, toData, tryChat, tryImage, trySpeech, tryTranscription, tryVideo, videoJob } from "./live.js";
import { words as core } from "./words.js";
import { checkSkin, missingTokens } from "./contract.js";
import { routeSheet } from "./screens/route.js";
import { providersSheet, addProviderSheet } from "./screens/providers.js";
import { newRouteSheet } from "./screens/route-new.js";
import { activitySheet } from "./screens/activity.js";
import { modelsSheet } from "./screens/model-list.js";
import { settingsSheet } from "./screens/settings.js";
import { signInSheet } from "./screens/sign-in.js";
import { playgroundSheet, modelsFor, playNow, elapsed, KINDS } from "./screens/playground.js";
import { size } from "./screens/activity.js";
import { registry } from "../skins/registry.js";

// Everything that is not the home screen is a sheet over it.
const screens = {
  route: routeSheet,
  providers: providersSheet,
  "add-provider": addProviderSheet,
  "new-route": newRouteSheet,
  activity: activitySheet,
  models: modelsSheet,
  settings: settingsSheet,
  playground: playgroundSheet,
  "sign-in": signInSheet,
};
// Sheets that cannot be closed.
const fixed = new Set(["sign-in"]);

const query = new URLSearchParams(location.search);
const root = document.documentElement;
const app = document.getElementById("app");
const bar = document.getElementById("bar");
const prefersDark = matchMedia("(prefers-color-scheme: dark)");

const keep = {
  get(key) { try { return localStorage.getItem("baserouter." + key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem("baserouter." + key, value); } catch {} },
};

const skins = Object.fromEntries(
  await Promise.all(registry.map(async (id) => [id, (await import(`../skins/${id}/skin.js`)).default])),
);
for (const [id, skin] of Object.entries(skins)) {
  const problems = checkSkin(skin);
  if (problems.length) console.warn(`Skin "${id}" does not meet the contract:`, problems);
}

function pick(key, fallback, valid) {
  const value = query.get(key) || keep.get(key);
  return value && valid(value) ? value : fallback;
}
let skinId = pick("skin", registry[0], (v) => v in skins);
let lang = pick("lang", (navigator.language || "").startsWith("tr") ? "tr" : "en", (v) => v in core);
let themePref = pick("theme", "auto", (v) => ["light", "dark", "auto"].includes(v));
// live: served by a gateway, and not asked for made-up data
const gateway = query.get("state") ? null : await gatewayStatus();
const live = gateway !== null;
const data = structuredClone(live ? states.empty : states[query.get("state")] ?? states.default);
if (!live && query.get("models") === "none") data.models = []; // a new route with no models to choose from
let signedOut = false;
if (live) {
  data.address = `${location.origin}/v1`;
  if (!gateway.passwordSet) signedOut = true;
  else {
    try {
      replaceData(toData(await api.state()));
    } catch (err) {
      if (!(err instanceof SignedOut)) throw err;
      signedOut = true;
    }
  }
}

// In a live panel, only the providers the gateway can add are offered, and one that is
// already added is marked so the list can leave it out.
const liveCatalog = catalog.filter((k) => k.kind === "openrouter" || k.kind === "nanogpt").map((k) => ({ ...k }));
let liveModels = null; // what the provider offers (see gateway/src/catalogue.ts), once asked for

// What is open, and the passing state of whatever is open. All of it can be set from the URL:
//   route=<id> [edit=budget]            a route's detail
//   screen=providers|add-provider|new-route|activity|settings|playground
//   as=<route id> kind=chat|image|speech|transcription|video model=<name> (playground: who asks, and for what)   edit=system (its system message)
//   step=waiting|streaming|done|stopped|fail (playground, on made-up data: an answer, image, sound, text or video in that state;
//   step=chosen: a sound file chosen to be written down)   detail=1 (its details open)
//   step=pick|key|testing|ok|fail (add-provider)   step=made|arrived (new-route)
//   kind=<catalog kind>   flow=1 (first run, numbered steps)   filter=<route id> (activity)
//   find=<words> makes=text|image|speech|transcription|video (choosing a model: route edit=model, new-route edit=model)
//   show=images|sounds|videos (activity: what was kept)   media=<id> (one of them)   edit=delete-media
const demoKey = "br_7Qm2xV9cLt4RkP0aZ8wYh3Ns";
const demoFirst = { seconds: 0.8, cost: 0.001 };
// The playground: what is being tried (a chat, an image, speech, a transcription or a video),
// and what was said and made so far, each kind in its own list. It lives here and nowhere else:
// closing the sheet keeps it, "Start over" and leaving the page end it. "running" stops the
// request under way; a video is not one, since it is made as a job that the page only watches.
// "file" is the sound file chosen to be written down.
const play = {
  route: null, kind: "chat", model: null, system: "", file: null, open: null, running: null,
  draft: Object.fromEntries(KINDS.map((k) => [k, ""])), turns: Object.fromEntries(KINDS.map((k) => [k, []])),
};
let view = null;
let ui = fresh();
let copiedId = null;
let opener = null;

function fresh() {
  return { editing: null, tab: "curl", entering: false, focus: false, step: null, kind: null, flow: false, filter: "", show: "requests", media: null, testing: null, error: null, made: null, newKey: null, saved: false,
    find: "", makes: "", more: 0, picking: false, chosen: null, where: null, model: null, place: null, providers: null };
}
if (signedOut) {
  view = { screen: "sign-in" };
  ui.step = live && !gateway.passwordSet ? "setup" : "login";
} else if (data.routes.some((r) => r.id === query.get("route"))) {
  view = { screen: "route", id: query.get("route") };
  ui.editing = query.get("edit");
  // edit=key&step=made: the new key, shown once
  if (ui.editing === "key" && query.get("step") === "made") {
    ui.editing = null;
    ui.newKey = { id: view.id, key: demoKey };
  }
} else if (query.get("screen") in screens && query.get("screen") !== "route" && !(live && fixed.has(query.get("screen")))) {
  view = { screen: query.get("screen") };
  ui.flow = query.get("flow") === "1";
  ui.filter = query.get("filter") ?? "";
  ui.media = query.get("media");
  ui.show = ["images", "sounds", "videos"].includes(query.get("show")) ? query.get("show")
    : data.sounds?.some((s) => s.id === ui.media) ? "sounds" : data.videos?.some((v) => v.id === ui.media) ? "videos" : ui.media ? "images" : "requests";
  ui.editing = query.get("edit");
  ui.kind = query.get("kind");
  ui.step = query.get("step") ?? (view.screen === "add-provider" ? (ui.kind ? "key" : "pick") : null);
  if (ui.step === "fail") ui.error = view.screen === "sign-in" ? core[lang].wrongPassword : "401 invalid key";
  if (view.screen === "sign-in" && ui.step !== "setup") ui.step = "login";
  if (view.screen === "new-route" && (ui.step === "made" || ui.step === "arrived") && data.routes[0]) {
    ui.made = { id: data.routes[0].id, key: demoKey, first: ui.step === "arrived" ? demoFirst : null };
    ui.step = "made";
  }
}

// The playground, from the URL: who asks and for what, and on made-up data an answer in each state.
if (view?.screen === "playground") {
  play.route = query.get("as");
  play.model = query.get("model");
  if (KINDS.includes(query.get("kind"))) play.kind = query.get("kind");
  const step = query.get("step");
  const now = playNow(data, play);
  if (!live && now.kind === "transcription" && step === "chosen") play.file = madeUpFile();
  if (!live && ["speech", "transcription", "video"].includes(now.kind) && ["waiting", "done", "stopped", "fail"].includes(step) && !(now.kind === "video" && step === "stopped")) {
    const { route, kind, model } = now;
    const state = step === "fail" ? "failed" : step;
    const done = step === "done";
    const turn = {
      speech: () => ({ ask: playSample.speechAsk[lang], sound: done ? playSample.sound : null, facts: done ? madeUpFacts(route, kind, model, playSample.speechFacts) : null }),
      transcription: () => ({ ask: fileLabel(madeUpFile()), text: done ? playSample.heard[lang] : "", facts: done ? madeUpFacts(route, kind, model, playSample.heardFacts) : null }),
      video: () => ({ ask: playSample.videoAsk[lang], video: done ? playSample.video : null, started: Date.now() - playSample.videoSoFar, facts: done ? madeUpFacts(route, kind, model, playSample.videoFacts) : null }),
    }[kind]();
    play.turns[kind] = [{ ...turn, route: route.id, kept: keepsMedia(route), state, error: step === "fail" ? playSample.error : null }];
    if (query.get("detail") === "1") play.open = 0;
  } else if (!live && now.kind === "image" && ["waiting", "done", "stopped", "fail"].includes(step)) {
    const { route, model } = playNow(data, play);
    play.turns.image = [{
      ask: playSample.imageAsk[lang], route: route.id, kept: keepsMedia(route), state: step === "fail" ? "failed" : step, images: step === "done" ? [playSample.image] : [],
      error: step === "fail" ? playSample.error : null,
      facts: step === "done" ? madeUpFacts(route, "image", model, playSample.imageFacts) : null,
    }];
    if (query.get("detail") === "1") play.open = 0;
  } else if (!live && ["waiting", "streaming", "done", "stopped", "fail"].includes(step) && data.routes.length) {
    const stress = query.get("state") === "stress";
    const route = data.routes.find((r) => r.id === play.route) ?? data.routes[0];
    const whole = stress ? `${playSample.answer[lang]} `.repeat(6) + "Çekoslovakyalılaştıramadıklarımızdanmışsınız" : playSample.answer[lang];
    const half = whole.slice(0, whole.indexOf(" ", whole.length / 2));
    play.turns.chat = [{
      ask: stress ? `${playSample.ask[lang]} `.repeat(4) + "Çekoslovakyalılaştıramadıklarımızdanmışsınız" : playSample.ask[lang],
      text: step === "done" ? whole : step === "streaming" || step === "stopped" ? half : "",
      state: step === "fail" ? "failed" : step,
      error: step === "fail" ? playSample.error : null,
      facts: step === "done" ? madeUpFacts(route, "chat", play.model, stress ? { promptTokens: 2000000, completionTokens: 123456, cost: 1234.5, firstMs: 312400, totalMs: 987600 } : playSample.facts) : null,
    }];
    if (query.get("detail") === "1") play.open = 0;
  }
}

// Choosing a model, from the URL: the search, the category, and for a new route whether the field is open.
ui.find = query.get("find") ?? "";
ui.makes = ["text", "image", "speech", "transcription", "video"].includes(query.get("makes")) ? query.get("makes") : "";
ui.where = query.get("where");
if (view?.screen === "new-route") {
  ui.picking = ui.editing === "model";
  ui.chosen = defaultModel();
}
// Models: model=<name> opens one; edit=rename|place|delete, or edit=via&place=<n> for where
// one of its OpenRouter places comes from; edit=add on the list.
if (view?.screen === "models") {
  ui.model = (data.models ?? []).some((m) => m.name === query.get("model")) ? query.get("model") : null;
  ui.place = Number(query.get("place") ?? 0);
  const place = (data.models ?? []).find((m) => m.name === ui.model)?.from[ui.place];
  if (ui.editing === "via" && !place) ui.editing = null;
  if (ui.editing === "via" && !live) ui.providers = { model: place.model, list: providersFor(place.model, query.get("state") === "stress") };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const status = (r) => (!r.enabled ? "off" : r.used >= r.budget ? "over" : r.busy ? "busy" : "on");
const theme = () => (themePref === "auto" ? (prefersDark.matches ? "dark" : "light") : themePref);

function fill(text, vars = {}) {
  return text
    .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_, key, one, many) => `${vars[key]} ${String(vars[key]) === "1" ? one : many}`)
    .replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

// Everything a skin, or a shared screen, gets to draw with.
function context() {
  const skin = skins[skinId];
  const statuses = data.routes.map(status);
  const down = data.providers.filter((p) => p.status === "down").length;
  const over = statuses.filter((s) => s === "over").length;
  const counts = {
    routes: data.routes.length,
    on: statuses.filter((s) => s === "on" || s === "busy").length,
    off: statuses.filter((s) => s === "off").length,
    over,
    providers: data.providers.length,
    up: data.providers.length - down,
    down,
    attention: over + down,
  };
  const empty = !counts.routes && !counts.providers;
  const mood = empty || !counts.on ? "sleepy" : counts.attention ? "worried" : statuses.includes("busy") ? "busy" : "happy";
  const t = (key, vars) => fill(skin.strings?.[lang]?.[key] ?? core[lang][key] ?? key, vars);
  const shared = (key, vars) => fill(core[lang][key] ?? key, vars);
  const now = new Date();
  // numbers follow the interface language: 12,345.67 in English, 12.345,67 in Turkish
  const num = (n, digits = 2) => new Intl.NumberFormat(lang === "tr" ? "tr-TR" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  return {
    num,
    data, lang, counts, empty, mood, status, esc, t, shared, copiedId, view, themePref, play,
    catalog: live ? liveCatalog.map((k) => ({ ...k, added: data.providers.some((p) => p.kind === k.kind) })) : catalog,
    // what the providers offer, to find models in (gateway/src/catalogue.ts)
    offers: live ? liveModels ?? [] : data.offers ?? offers,
    loadingOffers: live && !liveModels?.length,
    theme: theme(),
    copied: copiedId === "address",
    skins: registry.map((id) => ({ id, name: skins[id].name[lang], icon: skins[id].icon, active: id === skinId })),
    money: (n, digits) => "$" + (digits === undefined && n > 0 && n < 0.001
      ? new Intl.NumberFormat(lang === "tr" ? "tr-TR" : "en-US", { maximumSignificantDigits: 2 }).format(n)
      : num(n, digits ?? (Number.isInteger(n) ? 0 : n < 0.01 ? 3 : 2))),
    secs: (n) => `${num(n, 1)} ${lang === "tr" ? "sn" : "s"}`,
    // what a request made, when it was more than text: "Image · 2 min ago, 3.4 s"
    when(q) {
      return `${q.kind && q.kind !== "chat" ? t(`kind_${q.kind}`) + " · " : ""}${this.ago(q.ago)}, ${this.secs(q.seconds)}`;
    },
    ago: (s) => (s < 60 ? t("agoS", { n: s }) : s < 3600 ? t("agoM", { n: Math.round(s / 60) }) : s < 86400 ? t("agoH", { n: Math.round(s / 3600) }) : t("agoD", { n: Math.round(s / 86400) })),
    resetDate: new Intl.DateTimeFormat(lang, { day: "numeric", month: "long" }).format(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
    name: (r) => esc(r.name[lang] ?? r.name.en),
    percent: (r) => Math.min(100, Math.round((r.used / r.budget) * 100)),
    // the last request, while its route still exists
    last: data.last && data.routes.some((r) => r.id === data.last.route) ? { ...data.last, route: data.routes.find((r) => r.id === data.last.route) } : null,
  };
}

function render() {
  const scroll = app.querySelector(".br-sheet")?.scrollTop ?? 0;
  // something being typed in the playground: it comes back with its caret
  const field = document.activeElement?.matches?.("textarea[data-play]") ? document.activeElement : null;
  const typing = field && { which: field.dataset.play, start: field.selectionStart, end: field.selectionEnd };
  const focused = document.activeElement?.closest?.("[data-action]");
  const refocus = focused && ["action", "id", "copyId", "value", "route", "tab"].filter((k) => focused.dataset[k] != null)
    .map((k) => `[data-${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}="${focused.dataset[k]}"]`).join("");

  if (view?.screen === "route" && !data.routes.some((r) => r.id === view.id)) view = null;
  waiting = false;
  const ctx = context();
  root.lang = lang;
  root.dataset.theme = ctx.theme;
  root.dataset.skin = skinId;
  root.classList.toggle("br-locked", Boolean(view));
  // while a sheet is open, the home screen behind it cannot be reached by keyboard or screen reader
  // A skin's own words apply to its home screen only. Shared screens use the shared words,
  // so a skin string can never change, or collide with, a sentence on a shared screen.
  app.innerHTML = `<div${view ? " inert" : ""}>${skins[skinId].home(ctx)}</div>${view ? screens[view.screen]({ ...ctx, t: ctx.shared }, ui) : ""}`;

  const sheet = app.querySelector(".br-sheet");
  if (sheet && !ui.focus) sheet.scrollTop = scroll;
  if (ui.focus) (sheet?.querySelector("[data-autofocus]") ?? sheet?.querySelector(".br-x"))?.focus();
  else if (typing) {
    const again = sheet?.querySelector(`textarea[data-play="${typing.which}"]`);
    again?.focus();
    again?.setSelectionRange(typing.start, typing.end);
  } else if (refocus) ((sheet ?? app).querySelector(refocus) ?? app.querySelector(refocus))?.focus();
  ui.entering = ui.focus = false;

  if (bar) {
    bar.innerHTML =
      registry.map((id) => `<button data-skin="${id}" aria-pressed="${id === skinId}">${skins[id].icon}<span>${esc(skins[id].name[lang])}</span></button>`).join("") +
      `<i></i><button data-set="lang">${lang === "tr" ? "EN" : "TR"}</button>` +
      `<button data-set="theme">${ctx.theme === "dark" ? "Light" : "Dark"}</button>`;
  }
}

// Swap the stylesheet and fonts, then draw: the old skin stays up until the new one is ready.
function useSkin(id) {
  skinId = id;
  const skin = skins[id];
  const swap = (elementId, href) => {
    const old = document.getElementById(elementId);
    if (!href) return old?.remove(), Promise.resolve();
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href });
    const ready = new Promise((done) => { link.onload = link.onerror = done; });
    document.head.append(link);
    return ready.then(() => { old?.remove(); link.id = elementId; });
  };
  swap("skin-fonts", skin.fonts);
  document.getElementById("favicon").href = "data:image/svg+xml," + encodeURIComponent(skin.icon);
  return swap("skin-css", `skins/${id}/skin.css`).then(() => {
    render();
    const missing = missingTokens(document);
    if (missing.length) console.warn(`Skin "${id}" does not define:`, missing);
  });
}

function show(next, control, patch = {}) {
  const wasOpen = Boolean(view);
  if (!wasOpen && control) {
    opener = `[data-action="${control.dataset.action}"]` + (control.dataset.id ? `[data-id="${control.dataset.id}"]` : "") + (control.dataset.screen ? `[data-screen="${control.dataset.screen}"]` : "");
  }
  view = next;
  ui = { ...fresh(), ...patch, entering: !wasOpen, focus: true };
  render();
}

function close() {
  if (fixed.has(view?.screen)) return;
  if (view?.screen === "playground") play.running?.abort(); // nothing is spent behind a closed sheet
  const back = opener;
  view = null;
  opener = null;
  ui = fresh();
  render();
  if (back) app.querySelector(back)?.focus();
}

function uniqueId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "route";
  let id = base;
  for (let n = 2; data.routes.some((r) => r.id === id); n++) id = `${base}-${n}`;
  return id;
}

const actions = {
  toggle(control) {
    const route = data.routes.find((r) => r.id === control.dataset.id);
    if (!route || status(route) === "over") return;
    route.enabled = !route.enabled;
    render();
    if (live) send(api.toggle(route.id, route.enabled));
  },
  copy(control) {
    navigator.clipboard?.writeText(control.dataset.copy ?? data.address).catch(() => {});
    copiedId = control.dataset.copyId ?? "address";
    render();
    setTimeout(() => { copiedId = null; render(); }, 1200);
  },
  open(control) {
    show({ screen: "route", id: control.dataset.id }, control, { editing: control.dataset.edit || null });
  },
  go(control) {
    const screen = control.dataset.screen;
    if (!(screen in screens) || fixed.has(screen)) return;
    if (live && screen === "models" && control.dataset.edit === "add") loadModels().then(() => drawPicker(true));
    // from a route, the playground opens as that route
    if (screen === "playground" && control.dataset.as && control.dataset.as !== play.route) Object.assign(play, { route: control.dataset.as, model: null });
    // adding the very first provider starts the three-step first run
    const flow = control.dataset.flow === "1" || (screen === "add-provider" && !data.providers.length && !data.routes.length);
    show({ screen }, control, { flow, filter: control.dataset.filter ?? "", show: control.dataset.show ?? "requests", step: screen === "add-provider" ? "pick" : null, chosen: screen === "new-route" ? defaultModel() : null, model: control.dataset.model ?? null, editing: control.dataset.edit ?? null });
  },
  close,
  async edit(control) {
    const editing = control.dataset.edit || null;
    if (live && ["model", "add", "place", "replace"].includes(editing)) loadModels().then(() => drawPicker(true));
    ui.place = editing === "via" || editing === "replace" ? Number(control.dataset.place) : null;
    if (editing === "via") loadProviders();
    ui.editing = editing;
    Object.assign(ui, { find: "", makes: "", more: 0, where: null });
    ui.error = null;
    ui.saved = false;
    ui.focus = Boolean(editing);
    render();
  },
  "new-key"(control) {
    const route = data.routes.find((r) => r.id === control.dataset.id);
    if (!route) return;
    if (!live) {
      route.keyHint = demoKey.slice(-4);
      ui.newKey = { id: route.id, key: demoKey };
      ui.editing = null;
      return render();
    }
    api.newKey(route.id)
      .then(async ({ key }) => {
        await refresh(true);
        ui.newKey = { id: route.id, key };
        ui.editing = null;
        ui.error = null;
      })
      .catch(failed)
      .finally(render);
  },
  "remove-model"(control) {
    const route = data.routes.find((r) => r.id === control.dataset.id);
    if (!route || route.models.length < 2) return;
    route.models = route.models.filter((name) => name !== control.dataset.model);
    ui.editing = null;
    render();
    if (live) send(api.setModels(route.id, route.models));
  },
  "delete-route"(control) {
    const id = control.dataset.id;
    data.routes = data.routes.filter((r) => r.id !== id);
    data.requests = data.requests.filter((q) => q.route !== id); // as the gateway's state leaves them out
    // its images and sounds stay
    data.images = data.images.map((i) => (i.route === id ? { ...i, route: null } : i));
    data.sounds = data.sounds.map((i) => (i.route === id ? { ...i, route: null } : i));
    data.videos = (data.videos ?? []).map((i) => (i.route === id ? { ...i, route: null } : i));
    close();
    if (live) send(api.deleteRoute(id));
  },
  "sign-out"() {
    if (live) return api.logout().catch(() => {}).finally(signOut);
    view = { screen: "sign-in" };
    ui = { ...fresh(), step: "login", focus: true };
    render();
  },
  export() {
    const link = document.createElement("a");
    if (live) link.href = "/api/export";
    else {
      link.href = URL.createObjectURL(new Blob([JSON.stringify({ baserouter: 1, madeUp: true, ...data }, null, 2)], { type: "application/json" }));
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
    link.download = "baserouter.json";
    link.click();
  },
  tab(control) { ui.tab = control.dataset.tab; render(); },
  pick(control) { ui.kind = control.dataset.kind; ui.step = "key"; ui.focus = true; render(); },
  step(control) { ui.step = control.dataset.step; ui.error = null; ui.focus = true; render(); },
  filter(control) { ui.filter = control.dataset.route; render(); },
  // activity: requests, kept images, sounds or videos, and one of them opened
  show(control) { ui.show = control.dataset.show; ui.media = null; ui.editing = null; render(); },
  media(control) { ui.media = control.dataset.id || null; ui.editing = null; ui.focus = true; render(); },
  "delete-media"(control) {
    const id = control.dataset.id;
    const gone = [...data.images, ...data.sounds, ...(data.videos ?? [])].find((i) => i.id === id);
    data.images = data.images.filter((i) => i.id !== id);
    data.sounds = data.sounds.filter((i) => i.id !== id);
    data.videos = (data.videos ?? []).filter((i) => i.id !== id);
    if (gone && data.mediaSpace) {
      const which = gone.kind === "audio" ? "sounds" : gone.kind === "video" ? "videos" : "images";
      data.mediaSpace = { ...data.mediaSpace, [which]: data.mediaSpace[which] - 1, bytes: Math.max(0, data.mediaSpace.bytes - gone.bytes) };
    }
    ui.media = null;
    ui.editing = null;
    ui.focus = true;
    render();
    if (live) send(api.deleteMedia(id));
  },
  "keep-media"(control) {
    const route = data.routes.find((r) => r.id === control.dataset.id);
    if (!route) return;
    route.keepMedia = route.keepMedia === false;
    render();
    if (live) send(api.keepMedia(route.id, route.keepMedia));
  },
  "test-provider"(control) {
    const id = control.dataset.id;
    ui.testing = id;
    render();
    if (live) {
      send(api.testProvider(id)).finally(() => {
        if (ui.testing === id) ui.testing = null;
        render();
      });
      return;
    }
    setTimeout(() => {
      const provider = data.providers.find((p) => p.id === id);
      if (provider) { provider.status = "up"; delete provider.error; } // in this prototype a second test always succeeds
      if (ui.testing === id) ui.testing = null;
      render();
    }, 900);
  },
  "remove-provider"(control) {
    data.providers = data.providers.filter((p) => p.id !== control.dataset.id);
    render();
    if (live) {
      liveModels = null;
      send(api.removeProvider(control.dataset.id));
    }
  },
  // choosing a model (core/screens/models.js): only the picker is drawn again
  makes(control) { ui.makes = control.dataset.makes; ui.more = 0; drawPicker(); },
  "more-models"() { ui.more++; drawPicker(); },
  "pick-open"() { Object.assign(ui, { picking: true, find: "", makes: "", more: 0 }); drawPicker(true); },
  "pick-close"() { ui.picking = false; drawPicker(); },
  where(control) { ui.where = control.dataset.where; ui.more = 0; ui.makes = ""; drawPicker(); },
  // A row of the picker: a model in BaseRouter (its name), or one a provider offers
  // ("<provider>|<id>"), which becomes a model in BaseRouter first, unless it already is one.
  "pick-model"(control) {
    const picker = control.closest("#br-picker");
    const mode = picker?.dataset.mode;
    const value = control.dataset.model;
    const offer = value.includes("|") ? context().offers.find((o) => `${o.provider}|${o.id}` === value) : null;
    // A source changed: the pick takes its place, in its position. The model's name stays.
    if (mode === "replace") {
      const model = data.models.find((m) => m.name === picker.dataset.for);
      const at = ui.place;
      if (!model || !offer || !model.from[at]) return;
      if (model.from.some((p, i) => i !== at && p.provider === offer.provider && p.model === offer.id && !p.via)) return;
      model.from = model.from.map((p, i) => (i === at ? { provider: offer.provider, model: offer.id, via: null } : p));
      if (at === 0 && offer.makes?.length) model.makes = offer.makes;
      ui.editing = null;
      render();
      app.querySelector(`.br-change[data-place="${at}"]`)?.focus();
      if (live) send(api.updateModel(model.id, { from: model.from }));
      return;
    }
    if (mode === "place") {
      const model = data.models.find((m) => m.name === picker.dataset.for);
      if (!model || !offer || model.from.some((p) => p.provider === offer.provider && p.model === offer.id && !p.via)) return;
      model.from.push({ provider: offer.provider, model: offer.id, via: null });
      ui.editing = null;
      render();
      if (live) send(api.updateModel(model.id, { from: model.from }));
      return;
    }
    const known = offer && (data.models ?? []).some((m) => m.from.some((p) => p.provider === offer.provider && p.model === offer.id));
    const name = offer ? ensureModel(offer) : value;
    // A provider's model that is not in BaseRouter yet is made one first (a new route's model is
    // made when the route is: the gateway makes a model of every name a route lists).
    const made = live && offer && !known ? api.createModel({ name, from: [{ provider: offer.provider, model: offer.id }] }).catch(() => {}) : Promise.resolve();
    if (mode === "choose") {
      Object.assign(ui, { chosen: name, picking: false });
      drawPicker();
      return app.querySelector("#br-picker .br-btn")?.focus();
    }
    if (mode === "add") {
      Object.assign(ui, { model: name, editing: null, focus: true });
      render();
      if (live) send(made);
      return;
    }
    const route = data.routes.find((r) => r.id === picker.dataset.id);
    if (!route || route.models.includes(name)) return;
    route.models = [...route.models, name];
    ui.editing = null;
    render();
    if (live) send(made.then(() => api.setModels(route.id, route.models)));
  },
  // Models: one opened, a place removed, where an OpenRouter place comes from, deleting one
  "open-model"(control) { Object.assign(ui, { model: control.dataset.model || null, editing: null, error: null, focus: true }); render(); },
  "remove-place"(control) {
    const model = data.models.find((m) => m.name === ui.model);
    if (!model || model.from.length < 2) return;
    model.from = model.from.filter((_, i) => i !== Number(control.dataset.place));
    ui.editing = null;
    render();
    if (live) send(api.updateModel(model.id, { from: model.from }));
  },
  "set-via"(control) {
    const model = data.models.find((m) => m.name === ui.model);
    const at = ui.place;
    const place = model?.from[at];
    if (!place) return;
    const via = control.dataset.tag || null;
    if (model.from.some((p, i) => i !== at && p.provider === place.provider && p.model === place.model && p.via === via)) return;
    model.from = model.from.map((p, i) => (i === at ? { ...p, via } : p));
    ui.editing = null;
    render();
    app.querySelector(`.br-from[data-place="${at}"]`)?.focus();
    if (live) send(api.updateModel(model.id, { from: model.from }));
  },
  "delete-model"(control) {
    const name = control.dataset.model;
    const gone = data.models.find((m) => m.name === name);
    data.models = data.models.filter((m) => m.name !== name);
    for (const route of data.routes) route.models = route.models.filter((n) => n !== name);
    Object.assign(ui, { model: null, editing: null, focus: true });
    render();
    if (live && gone?.id) send(api.deleteModel(gone.id));
  },
  // the playground: stop the answer under way, forget the conversation, open an answer's details
  "try-stop"() { play.running?.abort(); },
  "try-clear"() {
    play.running?.abort();
    play.turns[playNow(data, play).kind] = [];
    play.open = null;
    ui.focus = true;
    render();
  },
  // what is tried: the models follow the kind
  "try-kind"(control) {
    if (play.running || !KINDS.includes(control.dataset.kind)) return;
    Object.assign(play, { kind: control.dataset.kind, model: null, open: null });
    ui.editing = null;
    render();
  },
  "try-facts"(control) {
    const turn = Number(control.dataset.turn);
    play.open = play.open === turn ? null : turn;
    render();
  },
  skin(control) { keep.set("skin", control.dataset.value); useSkin(control.dataset.value); },
  theme(control) { themePref = control.dataset.value; keep.set("theme", themePref); render(); },
  lang(control) { lang = control.dataset.value; keep.set("lang", lang); render(); },
};

const forms = {
  // the model search: Enter picks the first model found (see the keydown listener)
  find() {},
  // The playground: the message is sent as the chosen route, with what was said before it.
  try(form) {
    const { route, kind, model } = playNow(data, play);
    const ask = (form.querySelector('[data-play="draft"]')?.value ?? play.draft.chat).trim();
    if (!route || kind !== "chat" || !model || !ask || play.running) return;
    // What was said so far. A turn that failed is left out; one that was stopped keeps what arrived.
    const messages = [
      ...(play.system.trim() ? [{ role: "system", content: play.system.trim() }] : []),
      ...play.turns.chat.filter((turn) => turn.text && turn.state !== "failed").flatMap((turn) => [{ role: "user", content: turn.ask }, { role: "assistant", content: turn.text }]),
      { role: "user", content: ask },
    ];
    const turn = { ask, text: "", state: "waiting", error: null, facts: null };
    Object.assign(play, { route: route.id, model, open: null });
    play.draft.chat = "";
    play.turns.chat.push(turn);
    const wrote = (piece) => {
      turn.text += piece;
      if (turn.state !== "waiting") return drawAnswer(turn);
      turn.state = "streaming";
      draw();
    };
    const draw = () => {
      if (view?.screen !== "playground") return;
      render();
      toEnd();
    };
    if (!live) return pretend(route, model, turn, wrote, draw);
    const abort = new AbortController();
    play.running = abort;
    draw();
    tryChat(route.id, { model, messages }, { signal: abort.signal, onText: wrote })
      .then(({ row, error }) => {
        turn.state = error || row?.ok === false || (!row && !turn.text) ? "failed" : "done";
        turn.error = error;
        if (row) turn.facts = { id: row.id, model: row.model, provider: row.provider, promptTokens: row.promptTokens, completionTokens: row.completionTokens, cost: row.cost, firstMs: row.firstTokenMs, totalMs: row.totalMs };
      })
      .catch((err) => {
        if (err instanceof SignedOut) return signOut();
        if (abort.signal.aborted) return void (turn.state = "stopped");
        turn.state = "failed";
        // a connection that broke: before anything came the gateway did not answer, after it the answer broke off
        turn.error = err instanceof TypeError ? (turn.text ? null : core[lang].noAnswer) : err.message;
      })
      .then(() => {
        play.running = null;
        return signedOut ? null : refresh(true).catch(() => {});
      })
      .then(() => { if (!signedOut) draw(); });
  },
  // The playground: an image asked for as the chosen route. Only the description is sent
  // with the model; what else a provider takes is not the playground's to know.
  "try-image"(form) {
    const { route, kind, model } = playNow(data, play);
    const ask = (form.querySelector('[data-play="draft"]')?.value ?? play.draft.image).trim();
    if (!route || kind !== "image" || !model || !ask || play.running) return;
    const turn = { ask, route: route.id, kept: keepsMedia(route), state: "waiting", images: [], error: null, facts: null };
    Object.assign(play, { route: route.id, model, open: null });
    play.draft.image = "";
    play.turns.image.push(turn);
    const draw = () => {
      if (view?.screen !== "playground") return;
      render();
      toEnd();
    };
    if (!live) {
      // on made-up data an image "arrives" by itself after a moment
      const started = Date.now();
      const timer = setTimeout(() => {
        play.running = null;
        Object.assign(turn, { state: "done", images: [playSample.image], facts: madeUpFacts(route, "image", model, { ...playSample.imageFacts, totalMs: Date.now() - started }) });
        data.requests.unshift({ route: route.id, kind: "image", model: turn.facts.model, seconds: turn.facts.totalMs / 1000, cost: turn.facts.cost, ago: 1, ok: true });
        route.today += turn.facts.cost;
        route.used += turn.facts.cost;
        if (turn.kept) {
          data.images.unshift({ id: `p${data.images.length + 1}`, kind: "image", route: route.id, model: turn.facts.model, prompt: ask, cost: turn.facts.cost, bytes: 240000, ago: 1, src: playSample.image });
          data.mediaSpace = { ...data.mediaSpace, images: data.mediaSpace.images + 1, bytes: data.mediaSpace.bytes + 240000 };
        }
        draw();
      }, 1400);
      play.running = { abort() { clearTimeout(timer); play.running = null; turn.state = "stopped"; draw(); } };
      return draw();
    }
    const abort = new AbortController();
    play.running = abort;
    draw();
    tryImage(route.id, { model, prompt: ask }, { signal: abort.signal, keeps: turn.kept })
      .then(({ images, row }) => {
        turn.images = images;
        turn.state = images.length ? "done" : "failed"; // an answer with no image in it
        if (row) turn.facts = { id: row.id, model: row.model, provider: row.provider, cost: row.cost, totalMs: row.totalMs };
      })
      .catch((err) => {
        if (err instanceof SignedOut) return signOut();
        if (abort.signal.aborted) return void (turn.state = "stopped");
        turn.state = "failed";
        turn.error = err instanceof TypeError ? core[lang].noAnswer : err.message;
      })
      .then(() => {
        play.running = null;
        return signedOut ? null : refresh(true).catch(() => {});
      })
      .then(() => { if (!signedOut) draw(); });
  },
  // The playground: speech asked for as the chosen route. Only the words are sent with the
  // model; a voice, for a model that needs one, is sent with a client.
  "try-speech"(form) {
    const ask = draftOf(form, "speech");
    if (!ask) return;
    tryOnce("speech", ask, (route, model, signal) => trySpeech(route.id, { model, input: ask }, { signal }).then(({ sound, row }) => ({ sound, row, state: sound ? "done" : "failed" })),
      () => ({ sound: playSample.sound, facts: playSample.speechFacts, bytes: 31000, media: "sounds" }));
  },
  // The playground: the chosen sound file written down, sent as a form with the model.
  "try-transcription"() {
    const file = play.file;
    if (!file) return;
    tryOnce("transcription", fileLabel(file), (route, model, signal) => tryTranscription(route.id, { model, file }, { signal }).then(({ text, row }) => ({ text, row, state: text ? "done" : "failed" })),
      () => ({ text: playSample.heard[lang], facts: playSample.heardFacts }));
  },
  // The playground: a video asked for as the chosen route. It is made as a job of minutes,
  // which the page watches; meanwhile the screen stays free. Leaving the page leaves the job
  // to the gateway, which keeps its video if the route keeps what it makes.
  "try-video"(form) {
    const { route, kind, model } = playNow(data, play);
    const ask = draftOf(form, "video");
    if (!route || kind !== "video" || !model || !ask || play.running) return;
    const turn = { ask, route: route.id, kept: keepsMedia(route), state: "waiting", started: Date.now(), video: null, error: null, facts: null };
    Object.assign(play, { route: route.id, model, open: null });
    play.draft.video = "";
    play.turns.video.push(turn);
    render();
    toEnd();
    if (!live) {
      // on made-up data a video "is made" in a few seconds
      return void setTimeout(() => {
        if (!play.turns.video.includes(turn)) return;
        const facts = madeUpFacts(route, "video", model, { ...playSample.videoFacts, totalMs: Date.now() - turn.started });
        Object.assign(turn, { state: "done", video: playSample.video, facts });
        madeUp(route, "video", turn, ask, 599000, "videos");
        drawLater();
      }, 6000);
    }
    tryVideo(route.id, { model, prompt: ask }, {})
      .then(({ job, rowId }) => watchVideo(route.id, turn, job, rowId))
      .catch((err) => {
        if (err instanceof SignedOut) return signOut();
        Object.assign(turn, { state: "failed", error: err instanceof TypeError ? core[lang].noAnswer : err.message });
        drawLater();
      });
  },
  // A model's new name. Routes that use it follow.
  rename(form, values) {
    const from = form.dataset.model;
    const name = String(values.get("name") ?? "").trim();
    const model = data.models.find((m) => m.name === from);
    if (!model) return;
    if (!/^[\w~][\w.:/@+~-]{0,199}$/.test(name)) return void ((ui.error = core[lang].nameInvalid), render());
    if (name !== from && data.models.some((m) => m.name === name)) return void ((ui.error = core[lang].nameTaken), render());
    if (live) {
      // The gateway checks the name too; what it says is shown in the form.
      return void api.updateModel(model.id, { name })
        .then(() => refresh(true))
        .then(() => Object.assign(ui, { model: name, editing: null, error: null, focus: true }))
        .catch(failed)
        .finally(render);
    }
    model.name = name;
    for (const route of data.routes) route.models = route.models.map((n) => (n === from ? name : n));
    Object.assign(ui, { model: name, editing: null, error: null, focus: true });
    render();
  },
  password(form, values) {
    const done = () => { ui.editing = null; ui.error = null; ui.saved = true; };
    if (!live) return done(), render();
    form.querySelector("button[type=submit]")?.setAttribute("disabled", "");
    api.password(String(values.get("current") ?? ""), String(values.get("password") ?? ""))
      .then(done)
      .catch((err) => {
        if (err instanceof SignedOut) return signOut();
        const words = core[lang];
        const known = { wrong_password: words.wrongPassword, too_many_tries: words.tooManyTries, password_too_short: words.passwordHint };
        ui.error = known[err.code] ?? (err instanceof TypeError ? words.noAnswer : err.message);
        ui.focus = true;
      })
      .finally(render);
  },
  "sign-in"(form, values) {
    const password = String(values.get("password") ?? "");
    if (!live) { // made-up data: any password opens the panel
      view = null;
      ui = fresh();
      return render();
    }
    form.querySelector("button[type=submit]")?.setAttribute("disabled", "");
    (ui.step === "setup" ? api.setup(password) : api.login(password))
      .then(async () => {
        signedOut = false;
        await refresh(true);
        view = null;
        ui = fresh();
        loadModels();
      })
      .catch((err) => {
        const words = core[lang];
        const known = { wrong_password: words.wrongPassword, too_many_tries: words.tooManyTries, password_too_short: words.passwordHint };
        if (err.code === "already_set_up") ui.step = "login";
        ui.error = known[err.code] ?? (err instanceof TypeError ? words.noAnswer : err.message);
        ui.focus = true;
      })
      .finally(render);
  },
  budget(form, values) {
    const route = data.routes.find((r) => r.id === form.dataset.id);
    const value = Number(values.get("budget"));
    if (route && value > 0) route.budget = value;
    ui.editing = null;
    render();
    if (live && route && value > 0) send(api.budget(route.id, value));
  },
  provider(form, values) {
    const kind = catalog.find((k) => k.kind === ui.kind);
    const key = String(values.get("key") ?? "");
    ui.step = "testing";
    render();
    if (live) {
      api.addProvider(kind.kind, key)
        .then(async ({ provider }) => {
          liveCatalog.find((k) => k.kind === kind.kind).models = provider.models ?? 0;
          liveModels = null;
          await Promise.all([refresh(true), loadModels()]);
          ui.step = "ok";
        })
        .catch((err) => {
          if (err instanceof SignedOut) return signOut();
          ui.step = "fail";
          ui.error = err instanceof TypeError ? core[lang].noAnswer : err.message;
        })
        .finally(() => {
          if (view?.screen !== "add-provider") return;
          ui.focus = true;
          render();
        });
      return;
    }
    setTimeout(() => {
      if (view?.screen !== "add-provider") return;
      // in this prototype every key is accepted, except one that contains "bad"
      if (key.includes("bad")) { ui.step = "fail"; ui.error = "401 invalid key"; }
      else {
        const name = kind.name ?? new URL(String(values.get("address"))).host;
        data.providers.push({ id: data.providers.some((p) => p.id === kind.kind) ? `${kind.kind}-${data.providers.length + 1}` : kind.kind, name, status: "up", keyHint: key ? key.slice(-4) : null, models: kind.models });
        ui.step = "ok";
      }
      ui.focus = true;
      render();
    }, 900);
  },
  route(form, values) {
    const name = String(values.get("name")).trim();
    if (!name) return;
    const colours = ["#2B62D9", "#14874C", "#8A4B08", "#0E6F78", "#7A3FB8"];
    if (live) {
      const made = { name, budget: Number(values.get("budget")) || 5, models: [String(values.get("model"))], icon: "code", color: colours[data.routes.length % colours.length] };
      form.querySelector("button[type=submit]")?.setAttribute("disabled", "");
      api.makeRoute(made)
        .then(async ({ route, key }) => {
          await refresh(true);
          ui.error = null;
          ui.step = "made";
          ui.made = { id: route.id, key, first: null };
        })
        .catch((err) => {
          if (err instanceof SignedOut) return signOut();
          ui.error = err instanceof TypeError ? core[lang].noAnswer : err.message;
        })
        .finally(() => {
          if (view?.screen !== "new-route") return;
          ui.focus = true;
          render();
        });
      return;
    }
    const route = {
      id: uniqueId(name), name: { en: name, tr: name }, icon: "code", color: colours[data.routes.length % colours.length],
      enabled: true, busy: false, today: 0, used: 0, budget: Number(values.get("budget")) || 5,
      keyHint: demoKey.slice(-4), models: [String(values.get("model"))],
    };
    data.routes.push(route);
    ui.step = "made";
    ui.made = { id: route.id, key: demoKey, first: null };
    ui.focus = true;
    render();
    // in this prototype the first request "arrives" by itself after a moment
    setTimeout(() => {
      if (ui.made?.id !== route.id) return;
      ui.made.first = demoFirst;
      data.requests.unshift({ route: route.id, model: route.models[0], ...demoFirst, ago: 1, ok: true });
      route.today = route.used = demoFirst.cost;
      render();
    }, 3000);
  },
};

app.addEventListener("click", (event) => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  if (control.dataset.self && event.target !== control) return; // a press inside the sheet is not a press on the dimmed area
  actions[control.dataset.action]?.(control);
});

app.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  forms[form.dataset.form]?.(form, new FormData(form));
});

addEventListener("keydown", (event) => {
  if (event.key === "Escape" && view) close();
});

// The playground: what is typed is kept as it is typed, so drawing again never loses it; a
// change of route or model draws again, since the models follow the route.
app.addEventListener("input", (event) => {
  const which = event.target.dataset?.play;
  if (which === "draft") play.draft[playNow(data, play).kind] = event.target.value;
  if (which === "system") play.system = event.target.value;
});
app.addEventListener("change", (event) => {
  const which = event.target.dataset?.play;
  if (which === "file") {
    play.file = event.target.files?.[0] ?? null;
    ui.focus = true;
    return render();
  }
  if (which !== "route" && which !== "model") return;
  play[which] = event.target.value;
  if (which === "route") play.model = null;
  render();
});
// Enter sends, Shift+Enter starts a new line. On a touch keyboard Enter is a new line and the button sends.
app.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || !event.target.matches?.('[data-play="draft"]')) return;
  if (matchMedia("(pointer: coarse)").matches) return;
  event.preventDefault();
  event.target.form?.requestSubmit();
});

// What was typed in the playground's field for a kind.
function draftOf(form, kind) {
  return (form.querySelector('[data-play="draft"]')?.value ?? play.draft[kind]).trim();
}

// A sound file as it is shown where it was asked: its name and size. (Also used before the
// first drawing, so it formats the number itself rather than through context().)
function fileLabel(file) {
  const num = (n, digits) => new Intl.NumberFormat(lang === "tr" ? "tr-TR" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  return `${file.name}, ${size({ num }, file.size)}`;
}
// The made-up sound file of the transcription states.
function madeUpFile() {
  return new File([new Uint8Array(playSample.file.bytes)], playSample.file.name, { type: "audio/mp4" });
}

// Draws the playground again after something arrived, unless a sound or a video is playing
// there: then the next look draws it (see refresh).
function drawLater() {
  if (view?.screen !== "playground") return;
  if ([...app.querySelectorAll("audio, video")].some((a) => !a.paused)) return void (waiting = true);
  render();
}

// Speech or a transcription asked for as the chosen route: one request, which "Stop" cancels.
// "send" makes it and says what came back; "pretend" is what arrives on made-up data.
function tryOnce(kind, ask, send, pretend) {
  const { route, kind: now, model } = playNow(data, play);
  if (!route || now !== kind || !model || play.running) return;
  const turn = { ask, route: route.id, kept: keepsMedia(route), state: "waiting", error: null, facts: null };
  Object.assign(play, { route: route.id, model, open: null });
  if (kind === "transcription") play.file = null;
  else play.draft[kind] = "";
  play.turns[kind].push(turn);
  const draw = () => {
    if (view?.screen !== "playground") return;
    render();
    toEnd();
  };
  if (!live) {
    // on made-up data the answer "arrives" by itself after a moment
    const started = Date.now();
    const timer = setTimeout(() => {
      play.running = null;
      const { facts, bytes, media, ...made } = pretend();
      Object.assign(turn, made, { state: "done", facts: madeUpFacts(route, kind, model, { ...facts, totalMs: Date.now() - started }) });
      madeUp(route, kind, turn, ask, bytes, media);
      draw();
    }, 1400);
    play.running = { abort() { clearTimeout(timer); play.running = null; turn.state = "stopped"; draw(); } };
    return draw();
  }
  const abort = new AbortController();
  play.running = abort;
  draw();
  send(route, model, abort.signal)
    .then(({ row, ...made }) => {
      Object.assign(turn, made);
      if (row) turn.facts = { id: row.id, model: row.model, provider: row.provider, cost: row.cost, totalMs: row.totalMs };
    })
    .catch((err) => {
      if (err instanceof SignedOut) return signOut();
      if (abort.signal.aborted) return void (turn.state = "stopped");
      turn.state = "failed";
      turn.error = err instanceof TypeError ? core[lang].noAnswer : err.message;
    })
    .then(() => {
      play.running = null;
      return signedOut ? null : refresh(true).catch(() => {});
    })
    .then(() => { if (!signedOut) draw(); });
}

// What a made-up answer leaves behind: a request of the route, its cost, and what was kept.
function madeUp(route, kind, turn, ask, bytes, media) {
  data.requests.unshift({ route: route.id, kind, model: turn.facts.model, seconds: turn.facts.totalMs / 1000, cost: turn.facts.cost, ago: 1, ok: true });
  route.today += turn.facts.cost;
  route.used += turn.facts.cost;
  if (!turn.kept || !media) return;
  const src = turn.sound ?? turn.video;
  data[media].unshift({ id: `p${data[media].length + 1}`, kind: media === "sounds" ? "audio" : "video", route: route.id, model: turn.facts.model, prompt: ask, cost: turn.facts.cost, bytes, ago: 1, src });
  data.mediaSpace = { ...data.mediaSpace, [media]: data.mediaSpace[media] + 1, bytes: data.mediaSpace.bytes + bytes };
}

// A video job the playground started, asked about every few seconds until it ends, while the
// page is open and the turn is still on it ("Start over" forgets it). Its video is played from
// the copy the gateway kept, or else from the panel's own link to the provider's.
async function watchVideo(routeId, turn, job, rowId) {
  let status = job;
  for (let misses = 0; !["completed", "failed", "cancelled", "expired"].includes(status.status); ) {
    await new Promise((done) => setTimeout(done, 5000));
    if (!play.turns.video.includes(turn) || signedOut) return;
    try {
      status = await videoJob(routeId, job.id);
      misses = 0;
    } catch (err) {
      if (err instanceof SignedOut) return signOut();
      // a gateway that is restarting is asked again; one that is gone for a minute is given up on
      if (++misses < 12) continue;
      return void (Object.assign(turn, { state: "failed", error: err instanceof TypeError ? core[lang].noAnswer : err.message }), drawLater());
    }
  }
  const totalMs = Date.now() - turn.started;
  let row = rowId ? await requestRow(rowId).catch(() => null) : null;
  // A video the route keeps is fetched a moment after the job ends: wait for it a while, since
  // the kept copy can be sought in (Safari plays nothing else).
  const own = () => row?.media?.find((m) => m.kind === "video")?.src;
  for (let tries = 0; status.status === "completed" && turn.kept && row && !own() && tries < 20; tries++) {
    await new Promise((done) => setTimeout(done, 1000));
    row = (await requestRow(rowId).catch(() => null)) ?? row;
  }
  if (row) turn.facts = { id: row.id, model: row.model, provider: row.provider, cost: row.cost, totalMs };
  if (status.status === "completed") {
    Object.assign(turn, { state: "done", video: own() ?? `/api/routes/${encodeURIComponent(routeId)}/videos/${encodeURIComponent(job.id)}/content?index=0` });
  } else {
    Object.assign(turn, { state: "failed", error: typeof status.error === "string" ? status.error : typeof status.error?.message === "string" ? status.error.message : null });
  }
  await refresh(true).catch(() => {});
  drawLater();
}

// While a video is being made, how long it has been is counted on the screen, second by second,
// without drawing the sheet again.
setInterval(() => {
  if (view?.screen !== "playground" || playNow(data, play).kind !== "video") return;
  const ctx = context();
  play.turns.video.forEach((turn, i) => {
    const at = turn.state === "waiting" ? app.querySelector(`[data-elapsed="${i}"]`) : null;
    if (at) at.textContent = elapsed(ctx, turn);
  });
}, 1000);

// Does this route keep the images it makes (and does the gateway keep any)?
function keepsMedia(route) {
  return route.keepMedia !== false && data.mediaSpace?.keeping !== false;
}

// The sheet, scrolled to its end: where a new message and its answer appear.
function toEnd() {
  const sheet = app.querySelector(".br-sheet");
  if (sheet) sheet.scrollTop = sheet.scrollHeight;
}

// An answer as it arrives: only its text is drawn again, and the sheet follows it down
// unless the person has scrolled up to read.
function drawAnswer(turn) {
  const at = app.querySelector(`[data-answer="${play.turns.chat.indexOf(turn)}"]`);
  if (!at) return;
  const sheet = at.closest(".br-sheet");
  const following = sheet.scrollHeight - sheet.scrollTop - sheet.clientHeight < 120;
  at.textContent = turn.text;
  if (following) sheet.scrollTop = sheet.scrollHeight;
}

// What is known about an answer on made-up data: the model's first source answered.
function madeUpFacts(route, kind, name, numbers) {
  const model = modelsFor(data, route, kind).find((n) => n === name) ?? modelsFor(data, route, kind)[0];
  const first = (data.models ?? []).find((m) => m.name === model)?.from?.[0];
  return { id: null, model: first?.model ?? model ?? "", provider: data.providers.find((p) => p.id === first?.provider)?.name ?? null, ...numbers };
}

// On made-up data an answer writes itself: a moment of waiting, then word by word.
function pretend(route, model, turn, wrote, draw) {
  const words = playSample.reply[lang].split(/(?<= )/);
  const started = Date.now();
  let at = 0;
  let timer = setTimeout(function next() {
    wrote(words[at++]);
    if (at < words.length) return void (timer = setTimeout(next, 50));
    play.running = null;
    turn.state = "done";
    turn.facts = madeUpFacts(route, "chat", model, { ...playSample.facts, totalMs: Date.now() - started });
    data.requests.unshift({ route: route.id, model: turn.facts.model, seconds: turn.facts.totalMs / 1000, cost: turn.facts.cost, ago: 1, ok: true });
    route.today += turn.facts.cost;
    route.used += turn.facts.cost;
    draw();
  }, playSample.facts.firstMs);
  play.running = { abort() { clearTimeout(timer); play.running = null; turn.state = "stopped"; draw(); } };
  draw();
}

// Typing a model search draws the picker again, and nothing else.
app.addEventListener("input", (event) => {
  if (!event.target.matches("[data-find]")) return;
  ui.find = event.target.value;
  ui.more = 0;
  drawPicker();
});
app.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !event.target.matches("[data-find]")) return;
  event.preventDefault();
  app.querySelector("#br-picker .br-model")?.click();
});

// ---- live: keeping the panel in step with the gateway ----

function replaceData(next) {
  for (const key of Object.keys(data)) delete data[key];
  Object.assign(data, next);
}

// Where a place of the open model can come from, at a provider that has providers of its own
// (OpenRouter, NanoGPT): from the gateway, or the made-up data.
async function loadProviders() {
  const place = (data.models ?? []).find((m) => m.name === ui.model)?.from[ui.place];
  const model = place?.model;
  if (!model || (ui.providers?.model === model && (ui.providers.provider ?? place.provider) === place.provider)) return;
  ui.providers = null;
  if (!live) return void (ui.providers = { model, provider: place.provider, list: providersFor(model) });
  try {
    ui.providers = { model, provider: place.provider, list: await api.offerEndpoints(model, place.provider) };
  } catch {
    ui.providers = { model, provider: place.provider, list: [] };
  }
  render();
}

// A provider's model as a model in BaseRouter: the one it already is, or a new one named after
// the provider's id (or "<provider>/<id>" when that name is taken), with that one place.
function ensureModel(offer) {
  data.models ??= [];
  const known = data.models.find((m) => m.from.some((p) => p.provider === offer.provider && p.model === offer.id));
  if (known) return known.name;
  const name = data.models.some((m) => m.name === offer.id) ? `${offer.provider}/${offer.id}` : offer.id;
  data.models.push({ name, makes: offer.makes, from: [{ provider: offer.provider, model: offer.id, via: null }] });
  return name;
}

// The model a new route starts with: the first suggested one the provider has, or its first.
function defaultModel() {
  const names = (data.models ?? []).map((m) => m.name);
  return names.find((n) => modelChoices.some((c) => c.endsWith(n) || n.endsWith(c))) ?? names[0] ?? modelChoices[0];
}

async function loadModels() {
  if (liveModels?.length || !data.providers.length) return;
  try {
    liveModels = await api.offers();
  } catch {}
}

// Draws the model picker again in place: while a search is typed, when a category is
// chosen, when the provider's models arrive. The rest of the sheet, and anything typed into
// it, is left alone. The search keeps its focus and caret.
function drawPicker(focusFind = false) {
  const picker = app.querySelector("#br-picker");
  if (!picker) return;
  const ctx = context();
  if (picker.dataset.mode === "choose" && !ui.chosen) ui.chosen = defaultModel();
  const find = picker.querySelector("[data-find]");
  const typing = find && document.activeElement === find ? find.selectionStart : null;
  const route = data.routes.find((r) => r.id === picker.dataset.id);
  const taken = picker.dataset.mode === "allow" ? route?.models ?? [] : [];
  picker.outerHTML = modelPicker({ ...ctx, t: ctx.shared }, ui, { mode: picker.dataset.mode, taken, routeId: picker.dataset.id, forModel: picker.dataset.for });
  const again = app.querySelector("#br-picker [data-find]");
  if (again && (typing !== null || focusFind)) {
    again.focus();
    if (typing !== null) again.setSelectionRange(typing, typing);
  }
}

// An action that did not go through: say so in the open sheet, or ask to sign in again.
function failed(err) {
  if (err instanceof SignedOut) return signOut();
  ui.error = err instanceof TypeError ? core[lang].noAnswer : err.message;
}

function signOut() {
  signedOut = true;
  replaceData({ ...structuredClone(states.empty), address: data.address });
  view = { screen: "sign-in" };
  ui = { ...fresh(), step: "login", focus: true };
  render();
}

// Asks the gateway for its state. Redraws only when something changed, and not while a
// form is open, so nothing typed is lost; "force" redraws in any case (the caller draws).
let seen = "";
let waiting = false; // a redraw is owed
async function refresh(force = false) {
  const state = await api.state();
  const { now, ...rest } = state;
  const next = toData(state);
  // the first request of a route that was just made
  if (ui.made && !ui.made.first) {
    const first = next.requests.findLast((q) => q.route === ui.made.id);
    if (first) ui.made.first = { seconds: first.seconds, cost: first.cost };
  }
  // A playground answer whose cost was not known when it ended learns it from its row.
  let learned = false;
  for (const turn of Object.values(play.turns).flat()) {
    const cost = turn.facts?.id != null && turn.facts.cost == null ? state.requests.find((q) => q.id === turn.facts.id)?.cost : null;
    if (cost != null) {
      turn.facts.cost = cost;
      learned = true;
    }
  }
  const changed = JSON.stringify(rest) !== seen || Math.floor(now / 30_000) !== Math.floor(refresh.at / 30_000);
  seen = JSON.stringify(rest);
  refresh.at = now;
  replaceData(next);
  if (force) return void (waiting = true); // the caller draws; if it does not, the next look will
  // what is typed in the playground is kept, so it can be drawn while its form is open
  if (learned && view?.screen === "playground") return render();
  if (changed || waiting) {
    // not while something is being typed, or a sound or video is playing: drawing again would lose it
    if (app.querySelector(".br-sheet form") || [...app.querySelectorAll("audio, video")].some((a) => !a.paused)) waiting = true;
    else render();
  }
}
refresh.at = 0;

// Sends a change. The screen has already been changed; whatever the answer, the
// gateway's state is read again and drawn, which also undoes a change that did not go through.
function send(request) {
  return request
    .catch((err) => {
      if (err instanceof SignedOut) throw err;
      console.warn("BaseRouter did not take a change:", err.message);
    })
    .then(() => refresh(true))
    .then(() => {
      if (!app.querySelector(".br-sheet form")) render();
    })
    .catch((err) => {
      if (err instanceof SignedOut) signOut();
    });
}

if (live) {
  document.title = "BaseRouter";
  query.set("bar", "0");
  if (!signedOut) loadModels();
  setInterval(() => {
    if (signedOut || document.hidden) return;
    refresh().catch((err) => {
      if (err instanceof SignedOut) signOut();
    });
  }, 3000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !signedOut) refresh().catch(() => {});
  });
}
prefersDark.addEventListener("change", () => { if (themePref === "auto") render(); });

if (query.get("bar") === "0") bar.remove();
else bar.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.skin) { keep.set("skin", button.dataset.skin); useSkin(button.dataset.skin); }
  if (button.dataset.set === "lang") { lang = lang === "tr" ? "en" : "tr"; keep.set("lang", lang); render(); }
  if (button.dataset.set === "theme") { themePref = theme() === "dark" ? "light" : "dark"; keep.set("theme", themePref); render(); }
});

useSkin(skinId);
