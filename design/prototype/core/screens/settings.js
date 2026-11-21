// Settings: the look, the theme, the language, then the rarely used things.
import { sheet } from "./sheet.js";

export function settingsSheet(ctx, ui) {
  const { t, esc } = ctx;
  const seg = (action, value, label, current) =>
    `<button data-action="${action}" data-value="${value}" aria-pressed="${value === current}">${label}</button>`;

  return sheet(ctx, ui, {
    title: t("settings"),
    body: `
    <section class="br-sec">
      <h3>${t("look")}</h3>
      <div class="br-tiles">${ctx.skins.map((s) => `<button class="br-tile" data-action="skin" data-value="${s.id}" aria-pressed="${s.active}">${s.icon}<span>${esc(s.name)}</span></button>`).join("")}</div>
    </section>
    <section class="br-sec">
      <h3>${t("theme")}</h3>
      <div class="br-seg">${["light", "dark", "auto"].map((v) => seg("theme", v, t(v), ctx.themePref)).join("")}</div>
    </section>
    <section class="br-sec">
      <h3>${t("language")}</h3>
      <div class="br-seg br-keep">${seg("lang", "en", "English", ctx.lang)}${seg("lang", "tr", "Türkçe", ctx.lang)}</div>
    </section>
    <section class="br-sec">
      <h3>${t("password")}</h3>
      <p class="br-actions"><button class="br-btn">${t("changePassword")}</button></p>
    </section>
    <section class="br-sec">
      <h3>${t("yourData")}</h3>
      <p class="br-note">${t("exportNote")}</p>
      <p class="br-actions"><button class="br-btn">${t("exportAll")}</button></p>
    </section>
    <section class="br-sec">
      <h3>${t("about")}</h3>
      <p class="br-note">${t("aboutLine")}</p>
    </section>`,
  });
}
