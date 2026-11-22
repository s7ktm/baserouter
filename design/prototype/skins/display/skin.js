import { mascot, icon } from "./mascot.js";

// Skin: Display. BaseRouter is a small desk device: one LCD that tells you
// everything, a chunky key per route, and a pixel creature living on the screen.

// Doto draws its full stop as a cross; a plain square reads as a decimal point.
const dotted = (text) => text.replace(/[.,](?=\d*$)/, '<i class="pt"></i>');

export default {
  id: "display",
  name: { en: "Display", tr: "Dijital ekran" },
  fonts: "fonts/display.css",

  strings: {
    en: {
      provUp: "{up} of {total} providers up",
      noProv: "no providers yet",
      routesOn: "{n|route|routes} on",
      spentLine: "spent today, {month} this month",
      pet_happy: "all good",
      pet_busy: "working",
      pet_worried: "{k} to check",
      pet_sleepy: "nothing on",
      petEmpty: "add a provider",
      noRequests: "no requests yet",
      oneAddress: "the one address every agent connects to",
    },
    tr: {
      provUp: "{total} sağlayıcıdan {up} tanesi açık",
      noProv: "henüz sağlayıcı yok",
      routesOn: "{n} rota açık",
      spentLine: "bugün harcandı, bu ay {month}",
      pet_happy: "her şey yolunda",
      pet_busy: "çalışıyor",
      pet_worried: "{k} uyarı",
      pet_sleepy: "hepsi kapalı",
      petEmpty: "sağlayıcı ekle",
      noRequests: "henüz istek yok",
      oneAddress: "bütün ajanların bağlandığı tek adres",
    },
  },

  mascot,
  icon,

  // On this device a provider is one square on the status line: filled when up, hollow when down.
  provider(p) {
    return `<i${p.status === "down" ? ' class="down"' : ""}></i>`;
  },

  route(r, ctx) {
    const { t, money } = ctx;
    const s = ctx.status(r);
    const cls = { on: "", busy: " busy", off: " off", over: " full" }[s];
    const value = s === "off" ? "-.--" : ctx.num(s === "over" ? r.used : r.today, 2);
    const label = t(s === "off" ? "off" : s === "over" ? "full" : "today");
    const line = s === "over" ? t("stoppedBudget") : t("budgetLine", { used: money(r.used, 2), budget: money(r.budget) });
    const slide = s === "over" ? "" : `<button class="slide" data-action="toggle" data-id="${r.id}" aria-pressed="${s !== "off"}" aria-label="${ctx.name(r)}"></button>`;
    return `<div class="cap rk${cls}">
      <button class="br-stretch" data-action="open" data-id="${r.id}" aria-label="${ctx.name(r)}, ${t("st_" + s)}: ${t("details")}"></button>${slide}
      <span class="nm"><i class="led"></i><span>${ctx.name(r)}</span></span>
      <span class="mini"><b><span class="num" style="--len:${value.length}">${s === "off" ? '-<i class="pt"></i>--' : dotted(value)}</span><em>${label}</em></b><span class="seg" style="--p:${ctx.percent(r)}%"></span></span>
      <span class="of">${line}</span>
    </div>`;
  },

  address({ data, t, copied }) {
    return `<div class="plate"><div><small>${t("oneAddress")}</small><code>${data.address}</code></div>
      <button class="cap" data-action="copy">${t(copied ? "copied" : "copy")}</button></div>`;
  },

  spend({ data, t, money }) {
    const today = money(data.spend.today, 2);
    return `<div class="total"><span class="num" style="--len:${today.length}">${dotted(today)}</span><small>${t("spentLine", { month: money(data.spend.month, 2) })}</small></div>`;
  },

  home(ctx) {
    const { data, t, counts, empty, last } = ctx;
    const max = Math.max(...data.spend.week, 0.01);
    const providers = counts.providers ? t("provUp", { up: counts.up, total: counts.providers }) : t("noProv");
    const says = empty ? t("petEmpty") : t(`pet_${ctx.mood}`, { k: counts.attention });
    const tick = last ? `${ctx.name(last.route)} &gt; ${ctx.esc(last.model)}  ${ctx.secs(last.seconds)}  ${ctx.money(last.cost)}` : t("noRequests");
    return `<main class="shell">
      <div class="brand"><b>baserouter</b><span class="grille" aria-hidden="true"></span></div>
      <div class="left">
        <section class="lcd" aria-label="${t("status")}">
          <div class="stat">
            <span><span class="link" aria-hidden="true">${data.providers.map((p) => this.provider(p, ctx)).join("")}</span><span>${providers}</span></span>
            <span>${t("routesOn", { n: counts.on })}</span>
          </div>
          <div class="main">${this.spend(ctx)}<div class="pet">${this.mascot(ctx.mood)}<span>${says}</span></div></div>
          <div class="bars" aria-hidden="true">${data.spend.week.map((v) => `<i style="height:${Math.max(8, Math.round((v / max) * 100))}%"></i>`).join("")}</div>
          <div class="tick">${tick}</div>
        </section>
        ${this.address(ctx)}
      </div>
      <div class="right">
        <div class="keys">${data.routes.map((r) => this.route(r, ctx)).join("")}</div>
      </div>
      <div class="fn">
        <button class="cap go" data-action="go" data-screen="new-route" aria-label="${t("newRoute")}"><b>+</b><span>${t("newRoute")}</span></button>
        <button class="cap" data-action="go" data-screen="providers">${t("providers")}</button><button class="cap" data-action="go" data-screen="activity">${t("activity")}</button><button class="cap" data-action="go" data-screen="settings">${t("settings")}</button>
      </div>
    </main>`;
  },
};
