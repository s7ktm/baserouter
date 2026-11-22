import { mascot, icon } from "./mascot.js";

// Skin: Home. BaseRouter is home base: a homing pigeon carries every request,
// the one address is the plate on the door, and every route is a room with its lights on or off.

const icons = {
  code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  robot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V5M9.5 13v.5M14.5 13v.5M10 16.5h4"/><circle cx="12" cy="4" r="1"/>',
  mail: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4 8l8 6 8-6"/>',
  leaf: '<path d="M5 19c0-9 5-14 14-14 0 9-5 14-14 14zM5 19l8-8"/>',
  list: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
};
const glyph = (name) => `<svg viewBox="0 0 24 24">${icons[name] ?? icons.code}</svg>`;

export default {
  id: "home",
  name: { en: "Home", tr: "Ev paneli" },
  fonts: "fonts/home.css",

  strings: {
    en: {
      h1Calm: "Everything is running.",
      h1Warn: "{k|thing needs|things need} a look.",
      h1Empty: "Nobody home yet.",
      pSpend: "<b>{today}</b> spent today, <b>{month}</b> this month. {n|route is|routes are} on.",
      pEmpty: "Add a provider, then open your first route.",
      door: "The address on the door: every agent connects here",
      workingNow: "today, working now",
    },
    tr: {
      h1Calm: "Her şey yolunda.",
      h1Warn: "{k} şeye bakman gerek.",
      h1Empty: "Ev henüz boş.",
      pSpend: "{n} rota açık. Bugün <b>{today}</b>, bu ay <b>{month}</b> harcandı.",
      pEmpty: "Önce bir sağlayıcı ekle, sonra ilk rotanı aç.",
      door: "Kapıdaki adres: bütün ajanların buraya bağlanır",
      workingNow: "bugün, şimdi çalışıyor",
    },
  },

  mascot,
  icon,

  provider(p, { t, esc }) {
    const down = p.status === "down";
    return `<button class="pill${down ? " down" : ""}" data-action="go" data-screen="providers"><span>${esc(p.name)}</span>${down ? ` <small>${t("unreachable")}</small>` : ""}</button>`;
  },

  route(r, ctx) {
    const { t, money } = ctx;
    const s = ctx.status(r);
    const cls = { on: "", busy: "", off: " off", over: " stop" }[s];
    const control = s === "over"
      ? `<span class="tag">${t("full")}</span>`
      : `<button class="sw" data-action="toggle" data-id="${r.id}" aria-pressed="${s !== "off"}" aria-label="${ctx.name(r)}"></button>`;
    const sub = s === "over" ? t("stoppedBudget")
      : s === "off" ? t("off")
      : s === "busy" ? `<b>${money(r.today, 2)}</b> ${t("workingNow")}<span class="dots"><s></s><s></s><s></s></span>`
      : `<b>${money(r.today, 2)}</b> ${t("today")}`;
    return `<div class="room${cls}">
      <button class="br-stretch" data-action="open" data-id="${r.id}" aria-label="${ctx.name(r)}, ${t("st_" + s)}: ${t("details")}"></button>
      <div class="hd"><span class="ico">${glyph(r.icon)}</span>${control}</div>
      <h3><span>${ctx.name(r)}</span><small>${sub}</small></h3>
      <div class="bud"><i><u style="--p:${ctx.percent(r)}%"></u></i><span>${t("budgetLine", { used: money(r.used, 2), budget: money(r.budget) })}</span>
        ${s === "over" ? `<button data-action="open" data-id="${r.id}" data-edit="budget">${t("raiseBudget")}</button>` : ""}</div>
    </div>`;
  },

  address({ data, t, copied }) {
    return `<div class="door"><div><small>${t("door")}</small><code>${data.address.replace(/^https?:\/\//, "")}</code></div>
      <button data-action="copy">${t(copied ? "copied" : "copy")}</button></div>`;
  },

  // Here the spend is a sentence, not a dial.
  spend({ data, t, money, counts, empty }) {
    return `<p>${empty ? t("pEmpty") : t("pSpend", { today: money(data.spend.today, 2), month: money(data.spend.month, 2), n: counts.on })}</p>`;
  },

  home(ctx) {
    const { data, t, counts, empty } = ctx;
    const headline = empty ? t("h1Empty") : counts.attention ? t("h1Warn", { k: counts.attention }) : t("h1Calm");
    return `<main class="home">
      <div class="side">
        <header class="hello"><div><h1>${headline}</h1>${this.spend(ctx)}</div>${this.mascot(ctx.mood)}</header>
        ${this.address(ctx)}
      </div>
      <div class="main">
        <h2>${t("providers")}</h2>
        <div class="prov">${data.providers.map((p) => this.provider(p, ctx)).join("")}<button class="add" data-action="go" data-screen="add-provider">+ ${t("addProvider")}</button></div>
        <h2>${t("routes")}</h2>
        <div class="rooms">${data.routes.map((r) => this.route(r, ctx)).join("")}
          <button class="room add" data-action="go" data-screen="new-route"><span><b>+</b><span>${t("newRoute")}</span></span></button>
        </div>
      </div>
    </main>
    <nav class="bar">
      <button aria-current="page">${glyph("home")}<span>${t("home")}</span></button>
      <button data-action="go" data-screen="activity">${glyph("list")}<span>${t("activity")}</span></button>
      <button data-action="go" data-screen="settings">${glyph("sliders")}<span>${t("settings")}</span></button>
    </nav>`;
  },
};
