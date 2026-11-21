import { mascot, icon } from "./mascot.js";

// Skin: Socket. BaseRouter is a power strip: providers plug in at the top,
// every route is an outlet with its own rocker switch. Over budget = the breaker trips.

const sliders = '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
const chevron = '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';

export default {
  id: "socket",
  name: { en: "Socket", tr: "Priz" },
  fonts: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Instrument+Sans:wght@400..700&family=Martian+Mono:wght@500;700&display=swap",

  strings: {
    en: {
      plugged: "Plugged-in providers",
      plugIn: "Plug in a provider",
      oneAddress: "Every agent connects to this one address",
      sumCalm: "{n|route|routes} on, all running",
      sumWarn: "{n|route|routes} on, {k} to check",
      sumEmpty: "Plug in a provider to start",
      tripped: "Breaker tripped at {used} of {budget}",
      lastUsed: "<b>{route}</b> just used {model}: {secs}, <b>{cost}</b>",
    },
    tr: {
      plugged: "Takılı sağlayıcılar",
      plugIn: "Sağlayıcı tak",
      oneAddress: "Bütün ajanların bu tek adrese bağlanır",
      sumCalm: "{n} rota açık, hepsi çalışıyor",
      sumWarn: "{n} rota açık, {k} uyarı",
      sumEmpty: "Başlamak için bir sağlayıcı tak",
      tripped: "Sigorta attı: {used} / {budget}",
      lastUsed: "<b>{route}</b> az önce {model} kullandı: {secs}, <b>{cost}</b>",
    },
  },

  mascot,
  icon,

  provider(p, { t, esc }) {
    const down = p.status === "down";
    return `<div class="plug${down ? " out" : ""}"><button class="head" data-action="go" data-screen="providers"><span>${esc(p.name)}</span><em>${t(down ? "unreachable" : "working")}</em></button><div class="wire"></div></div>`;
  },

  route(r, ctx) {
    const { t, money } = ctx;
    const s = ctx.status(r);
    const cls = { on: "", busy: " busy", off: " off", over: " trip" }[s];
    const detail = s === "over"
      ? `<div class="meter"><u style="--p:100%"></u></div>
         <div class="trip-note"><span>${t("tripped", { used: money(r.used), budget: money(r.budget) })}</span><button data-action="open" data-id="${r.id}" data-edit="budget">${t("raiseBudget")}</button></div>`
      : `<div class="nums"><span>${s === "off" ? t("off") : `<b>${money(r.today, 2)}</b> ${t("today")}`}</span>
           <span><b>${money(r.used, 2)}</b> ${t("ofBudget", { budget: money(r.budget) })}</span></div>
         <div class="meter"><u style="--p:${ctx.percent(r)}%"></u></div>`;
    return `<div class="outlet${cls}">
      <button class="br-stretch" data-action="open" data-id="${r.id}" aria-label="${ctx.name(r)}, ${t("st_" + s)}: ${t("details")}"></button>
      <div class="sock"><span></span><i></i></div>
      <div class="who"><span class="tape" style="--t:${r.color}">${ctx.name(r)}</span>${detail}</div>
      <button class="rocker" data-action="toggle" data-id="${r.id}" aria-pressed="${s === "on" || s === "busy"}" aria-label="${ctx.name(r)}"><b></b></button>
    </div>`;
  },

  address({ data, t, copied }) {
    return `<div class="addr"><label>${t("oneAddress")}</label>
      <div class="win"><code>${data.address}</code><button data-action="copy">${t(copied ? "copied" : "copy")}</button></div></div>`;
  },

  spend({ data, t, money, num }) {
    const max = Math.max(...data.spend.week, 0.01);
    const today = num(data.spend.today, 2);
    return `<div class="read">
      <div class="big" style="--len:${today.length + 1}"><sup>$</sup>${today}</div>
      <div class="cap"><span>${t("today")}</span><b>${money(data.spend.month, 2)}</b><span>${t("thisMonth")}</span></div>
      <div class="week" aria-hidden="true">${data.spend.week.map((v) => `<i style="height:${Math.max(6, Math.round((v / max) * 100))}%"></i>`).join("")}</div>
    </div>`;
  },

  home(ctx) {
    const { data, t, counts, empty, last } = ctx;
    const summary = empty ? t("sumEmpty") : t(counts.attention ? "sumWarn" : "sumCalm", { n: counts.on, k: counts.attention });
    const lastLine = last
      ? `<button class="last" data-action="go" data-screen="activity"><span>${t("lastUsed", { route: ctx.name(last.route), model: last.model, secs: ctx.secs(last.seconds), cost: ctx.money(last.cost) })}</span>${chevron}</button>`
      : "";
    return `<main class="bench">
      <header class="top">${this.mascot(ctx.mood)}
        <div class="word">BaseRouter<small>${summary}</small></div>
        <div class="key"><button data-action="go" data-screen="settings" aria-label="${t("settings")}">${sliders}</button></div>
      </header>
      <p class="feed-h">${t("plugged")}</p>
      <div class="plugs">${data.providers.map((p) => this.provider(p, ctx)).join("")}
        <div class="plug add"><button class="head" data-action="go" data-screen="add-provider" aria-label="${t("plugIn")}">+</button><div class="wire"></div></div>
      </div>
      <section class="strip">
        <div class="plate">${this.address(ctx)}${this.spend(ctx)}</div>
        <div class="groove"></div>
        <div class="outlets">${data.routes.map((r) => this.route(r, ctx)).join("")}</div>
        <div class="rest"><button class="new" data-action="go" data-screen="new-route"><i>+</i><span>${t("newRoute")}</span></button>${lastLine}</div>
      </section>
    </main>`;
  },
};
