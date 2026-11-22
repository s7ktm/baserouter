// Choosing a model: the provider's models, as OpenRouter describes them, to search, sort into
// what they make, and pick from. Route detail uses it to add a model; a new route, to choose
// its first. It is one element, #br-picker, which the core redraws on its own while a search is
// typed, so nothing else in the sheet (a name being typed in the new-route form) is touched.
//
// ui: find (the search), makes (a category, or ""), more (how many extra pages are shown),
// picking (the new-route field is open), chosen (the model the new-route field holds).

const PAGE = 30;
export const KINDS = ["text", "image", "speech", "transcription", "video"];
const plus = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const tick = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

// Every word of the search must be in the model's name or id.
export function matching(models, ui) {
  const words = (ui.find ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter((m) => (!ui.makes || m.makes.includes(ui.makes)) && words.every((w) => m.id.toLowerCase().includes(w) || m.name.toLowerCase().includes(w)));
}

// One line of plain facts: price, how much it reads, what it reads.
function facts(ctx, m, showKind) {
  const { t, num } = ctx;
  const price = (n) => ctx.money(n);
  const parts = [];
  if (showKind) parts.push(m.makes.map((k) => t(`makes_${k}`)).join(", "));
  if (m.free) parts.push(t("free"));
  else if (m.makes.includes("text") && m.in != null && m.out != null && (m.in > 0 || m.out > 0)) parts.push(t("perTokens", { in: price(m.in * 1e6), out: price(m.out * 1e6) }));
  if (m.perSecond != null) parts.push(t("perSecond", { price: price(m.perSecond) }));
  if (m.context && m.makes.includes("text")) parts.push(t("contextOf", { n: m.context >= 1e6 ? `${num(m.context / 1e6, Number.isInteger(Math.round(m.context / 1e5) / 10) ? 0 : 1)}M` : `${Math.round(m.context / 1000)}K` }));
  const reads = m.takes.filter((k) => k !== "text");
  if (reads.length && m.makes.includes("text")) parts.push(t("reads", { what: reads.map((k) => t(`m_${k}`)).join(", ") }));
  return parts.join(" · ");
}

function row(ctx, m, { chosen, adding, showKind }) {
  const { esc, t } = ctx;
  const picked = m.id === chosen;
  return `<li><button type="button" class="br-model" data-action="pick-model" data-model="${esc(m.id)}"${adding ? ` aria-label="${t("addNamed", { name: esc(m.name) })}"` : ` aria-pressed="${picked}"`}>
    <span><strong class="br-keep">${esc(m.name)}</strong><code class="br-keep">${esc(m.id)}</code><small>${facts(ctx, m, showKind)}</small></span>
    <i class="br-mark">${adding ? plus : picked ? tick : ""}</i></button></li>`;
}

// The picker. mode "add": every row adds its model (route detail). mode "choose": the row
// becomes the field's value (new route), and the field folds back to show it.
export function modelPicker(ctx, ui, { mode, taken = [], routeId = "" }) {
  const { t, esc, models } = ctx;
  const attrs = `id="br-picker" data-mode="${mode}" data-id="${esc(routeId)}"`;
  const chosen = mode === "choose" ? models.find((m) => m.id === ui.chosen) : null;
  const hidden = mode === "choose" ? `<input type="hidden" name="model" value="${esc(ui.chosen ?? "")}">` : "";

  if (mode === "choose" && !ui.picking) {
    return `<div ${attrs}>${hidden}
      <div class="br-chosen">${chosen
        ? `<span><strong class="br-keep">${esc(chosen.name)}</strong><code class="br-keep">${esc(chosen.id)}</code><small>${facts(ctx, chosen, true)}</small></span>`
        : `<span><code class="br-keep">${esc(ui.chosen ?? "")}</code></span>`}
        <button type="button" class="br-btn" data-action="pick-open">${t("change")}</button></div></div>`;
  }

  if (!models.length) return `<div ${attrs}>${hidden}<p class="br-busy" role="status"><i></i>${t("modelsLoading")}</p></div>`;

  const pool = models.filter((m) => !taken.includes(m.id));
  const found = matching(pool, ui);
  const shown = found.slice(0, PAGE * (1 + (ui.more ?? 0)));
  const count = (k) => matching(pool, { ...ui, makes: k }).length;
  const chip = (k) => `<button type="button" class="br-chip" data-action="makes" data-makes="${k}" aria-pressed="${(ui.makes ?? "") === k}">${t(k ? `makes_${k}` : "makes_all")} <span class="br-count">${ctx.num(count(k), 0)}</span></button>`;
  return `<div ${attrs}>${hidden}
    <label class="br-label" for="br-find">${t(mode === "add" ? "modelToAdd" : "firstModel")}</label>
    <input class="br-input wide br-find" id="br-find" type="search" data-find autocomplete="off" spellcheck="false" placeholder="${t("findModel")}" value="${esc(ui.find ?? "")}"${ui.focusFind === false ? "" : " data-autofocus"}>
    <div class="br-chips" role="group" aria-label="${t("modelKinds")}">${["", ...KINDS].filter((k) => !k || k === ui.makes || count(k) > 0).map(chip).join("")}</div>
    ${shown.length
      ? `<ul class="br-models">${shown.map((m) => row(ctx, m, { chosen: ui.chosen, adding: mode === "add", showKind: !ui.makes })).join("")}</ul>
         ${found.length > shown.length ? `<p class="br-actions"><button type="button" class="br-btn quiet" data-action="more-models">${t("moreModels", { n: ctx.num(found.length - shown.length, 0) })}</button></p>` : ""}`
      : `<p class="br-lead">${t("noModel")}</p>`}
    ${mode === "choose" && ui.chosen ? `<p class="br-actions"><button type="button" class="br-btn quiet" data-action="pick-close">${t("keepChosen", { id: esc(ui.chosen) })}</button></p>` : ""}
  </div>`;
}

// Where one line of a route gets its model: "Any provider" (the provider chooses, and moves on
// when one is down), or one of the provider's own providers for that model, with what it
// charges. ui.providers holds the list once it has arrived: { model, list }.
export function providerChoice(ctx, ui, route, line) {
  const { t, esc, num } = ctx;
  const list = ui.providers?.model === line.model ? ui.providers.list : null;
  const taken = (tag) => route.models.some((l, i) => i !== ui.line && l.model === line.model && (l.provider ?? "") === tag);
  const row = (tag, name, tier, facts, up = true) => `<li><button type="button" class="br-model" data-action="set-provider" data-id="${route.id}" data-tag="${esc(tag)}"
      aria-pressed="${(line.provider ?? "") === tag}"${taken(tag) ? " disabled" : ""}${(line.provider ?? "") === tag ? " data-autofocus" : ""}>
    <span><strong class="br-keep">${name}${tier ? ` <span class="br-tier">${esc(tier)}</span>` : ""}</strong>${tag ? `<code class="br-keep">${esc(tag)}</code>` : ""}<small>${[facts, up ? "" : t("providerDown"), taken(tag) ? t("alreadyListed") : ""].filter(Boolean).join(" · ")}</small></span>
    <i class="br-mark">${(line.provider ?? "") === tag ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>' : ""}</i></button></li>`;
  const facts = (p) => [
    p.in != null && p.out != null && (p.in > 0 || p.out > 0) ? t("perTokens", { in: ctx.money(p.in * 1e6), out: ctx.money(p.out * 1e6) }) : "",
    p.context ? t("contextOf", { n: p.context >= 1e6 ? `${num(p.context / 1e6, Number.isInteger(Math.round(p.context / 1e5) / 10) ? 0 : 1)}M` : `${Math.round(p.context / 1000)}K` }) : "",
  ].filter(Boolean).join(" · ");
  return `<div class="br-where">
    <h4 class="br-label">${t("whereFrom", { model: `<span class="br-keep">${esc(line.model)}</span>` })}</h4>
    <p class="br-note">${t("whereFromNote")}</p>
    ${list === null
      ? `<p class="br-busy" role="status"><i></i>${t("providersLoading")}</p>`
      : `<ul class="br-models">${row("", t("anyProvider"), null, t("anyProviderNote"))}${
          line.provider && !list.some((p) => p.tag === line.provider) ? row(line.provider, esc(line.provider), null, t("notListed")) : ""
        }${list.map((p) => row(p.tag, esc(p.name), p.tier, facts(p), p.up)).join("")}</ul>
         ${list.length ? "" : `<p class="br-note">${t("noProviders")}</p>`}`}
    <p class="br-actions" style="margin-top:12px"><button class="br-btn" data-action="edit" data-edit="">${t("cancel")}</button></p>
  </div>`;
}
