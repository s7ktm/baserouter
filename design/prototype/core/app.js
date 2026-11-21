// The shared mechanism: one state, one set of actions, any skin on top.
import { states, catalog, modelChoices } from "./data.js";
import { words as core } from "./words.js";
import { checkSkin, missingTokens } from "./contract.js";
import { routeSheet } from "./screens/route.js";
import { providersSheet, addProviderSheet } from "./screens/providers.js";
import { newRouteSheet } from "./screens/route-new.js";
import { activitySheet } from "./screens/activity.js";
import { settingsSheet } from "./screens/settings.js";
import { registry } from "../skins/registry.js";

// Everything that is not the home screen is a sheet over it.
const screens = {
  route: routeSheet,
  providers: providersSheet,
  "add-provider": addProviderSheet,
  "new-route": newRouteSheet,
  activity: activitySheet,
  settings: settingsSheet,
};

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
const data = structuredClone(states[query.get("state")] ?? states.default);

// What is open, and the passing state of whatever is open. All of it can be set from the URL:
//   route=<id> [edit=budget]            a route's detail
//   screen=providers|add-provider|new-route|activity|settings
//   step=pick|key|testing|ok|fail (add-provider)   step=made|arrived (new-route)
//   kind=<catalog kind>   flow=1 (first run, numbered steps)   filter=<route id> (activity)
const demoKey = "br-7Qm2xV9cLt4RkP0aZ8wYh3Ns";
const demoFirst = { seconds: 0.8, cost: 0.001 };
let view = null;
let ui = fresh();
let copiedId = null;
let opener = null;

function fresh() {
  return { editing: null, tab: "curl", entering: false, focus: false, step: null, kind: null, flow: false, filter: "", testing: null, error: null, made: null };
}
if (data.routes.some((r) => r.id === query.get("route"))) {
  view = { screen: "route", id: query.get("route") };
  ui.editing = query.get("edit");
} else if (query.get("screen") in screens && query.get("screen") !== "route") {
  view = { screen: query.get("screen") };
  ui.flow = query.get("flow") === "1";
  ui.filter = query.get("filter") ?? "";
  ui.kind = query.get("kind");
  ui.step = query.get("step") ?? (view.screen === "add-provider" ? (ui.kind ? "key" : "pick") : null);
  if (ui.step === "fail") ui.error = "401 invalid key";
  if (view.screen === "new-route" && (ui.step === "made" || ui.step === "arrived") && data.routes[0]) {
    ui.made = { id: data.routes[0].id, key: demoKey, first: ui.step === "arrived" ? demoFirst : null };
    ui.step = "made";
  }
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
    data, lang, counts, empty, mood, status, esc, t, shared, copiedId, view, catalog, modelChoices, themePref,
    theme: theme(),
    copied: copiedId === "address",
    skins: registry.map((id) => ({ id, name: skins[id].name[lang], icon: skins[id].icon, active: id === skinId })),
    money: (n, digits) => "$" + num(n, digits ?? (Number.isInteger(n) ? 0 : n < 0.001 ? 4 : n < 0.01 ? 3 : 2)),
    secs: (n) => `${num(n, 1)} ${lang === "tr" ? "sn" : "s"}`,
    ago: (s) => (s < 60 ? t("agoS", { n: s }) : s < 3600 ? t("agoM", { n: Math.round(s / 60) }) : s < 86400 ? t("agoH", { n: Math.round(s / 3600) }) : t("agoD", { n: Math.round(s / 86400) })),
    resetDate: new Intl.DateTimeFormat(lang, { day: "numeric", month: "long" }).format(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
    name: (r) => esc(r.name[lang] ?? r.name.en),
    percent: (r) => Math.min(100, Math.round((r.used / r.budget) * 100)),
    last: data.last && { ...data.last, route: data.routes.find((r) => r.id === data.last.route) },
  };
}

function render() {
  const scroll = app.querySelector(".br-sheet")?.scrollTop ?? 0;
  const focused = document.activeElement?.closest?.("[data-action]");
  const refocus = focused && ["action", "id", "copyId", "value", "route", "tab"].filter((k) => focused.dataset[k] != null)
    .map((k) => `[data-${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}="${focused.dataset[k]}"]`).join("");

  if (view?.screen === "route" && !data.routes.some((r) => r.id === view.id)) view = null;
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
  else if (refocus) ((sheet ?? app).querySelector(refocus) ?? app.querySelector(refocus))?.focus();
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
    if (!(screen in screens)) return;
    // adding the very first provider starts the three-step first run
    const flow = control.dataset.flow === "1" || (screen === "add-provider" && !data.providers.length && !data.routes.length);
    show({ screen }, control, { flow, filter: control.dataset.filter ?? "", step: screen === "add-provider" ? "pick" : null });
  },
  close,
  edit(control) { ui.editing = control.dataset.edit || null; ui.focus = Boolean(ui.editing); render(); },
  tab(control) { ui.tab = control.dataset.tab; render(); },
  pick(control) { ui.kind = control.dataset.kind; ui.step = "key"; ui.focus = true; render(); },
  step(control) { ui.step = control.dataset.step; ui.error = null; ui.focus = true; render(); },
  filter(control) { ui.filter = control.dataset.route; render(); },
  "test-provider"(control) {
    const id = control.dataset.id;
    ui.testing = id;
    render();
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
  },
  skin(control) { keep.set("skin", control.dataset.value); useSkin(control.dataset.value); },
  theme(control) { themePref = control.dataset.value; keep.set("theme", themePref); render(); },
  lang(control) { lang = control.dataset.value; keep.set("lang", lang); render(); },
};

const forms = {
  budget(form, values) {
    const route = data.routes.find((r) => r.id === form.dataset.id);
    const value = Number(values.get("budget"));
    if (route && value > 0) route.budget = value;
    ui.editing = null;
    render();
  },
  provider(form, values) {
    const kind = catalog.find((k) => k.kind === ui.kind);
    const key = String(values.get("key") ?? "");
    ui.step = "testing";
    render();
    setTimeout(() => {
      if (view?.screen !== "add-provider") return;
      // in this prototype every key is accepted, except one that contains "bad"
      if (key.includes("bad")) { ui.step = "fail"; ui.error = "401 invalid key"; }
      else {
        const name = kind.name ?? new URL(String(values.get("address"))).host;
        data.providers.push({ id: `${kind.kind}-${data.providers.length + 1}`, name, status: "up", keyHint: key ? key.slice(-4) : null, models: kind.models });
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
