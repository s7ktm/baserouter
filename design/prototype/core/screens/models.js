// Choosing a model. One element, #br-picker, which the core redraws on its own while a search
// is typed, so nothing else in the sheet (a name being typed in the new-route form) is touched.
//
// What it lists depends on where it is. On a route, only BaseRouter's own models, by the names
// apps send: a route never takes a model straight from a provider. In Manage models, what each
// provider offers, as it describes it, one provider at a time. Then a search and the kinds.
//
// mode "allow"  a route: a row authorizes its model
//      "choose" a new route: a row becomes the field's value, and the field folds back
//      "add"    Manage models: a row adds a provider's model to BaseRouter
//      "place"  one model: a row adds a backup source
//      "replace" one model: a row takes the place of the source being changed
//
// ui: where ("mine" or a provider id), find, makes, more, picking and chosen (new route).

const PAGE = 30;
export const KINDS = ["text", "image", "speech", "transcription", "video"];
const plus = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
export const tick = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

// The words to search: a model's name and id, or for BaseRouter's own, its name and places.
const words = (m) => (m.from ? [m.name, ...m.from.map((p) => p.model)] : [m.id, m.name]).join(" ").toLowerCase();
export function matching(list, ui) {
  const find = (ui.find ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((m) => (!ui.makes || m.makes.includes(ui.makes)) && find.every((w) => words(m).includes(w)));
}

export const providerName = (ctx, id) => ctx.data.providers.find((p) => p.id === id)?.name ?? id;

// "OpenAI, then OpenRouter": where a BaseRouter model comes from, in order.
export function fromSummary(ctx, m) {
  const names = [...new Set(m.from.map((p) => providerName(ctx, p.provider)))];
  return names.length > 1 ? ctx.t("thenList", { first: names.slice(0, -1).join(", "), last: names.at(-1) }) : names[0] ?? "";
}

// The BaseRouter model a provider's model already is, if any.
export const modelOf = (ctx, offer) => ctx.data.models?.find((m) => m.from.some((p) => p.provider === offer.provider && p.model === offer.id));

export function contextText(ctx, n) {
  return n >= 1e6 ? `${ctx.num(n / 1e6, Number.isInteger(Math.round(n / 1e5) / 10) ? 0 : 1)}M` : `${Math.round(n / 1000)}K`;
}

// One line of plain facts about a provider's model: price, how much it reads, what it reads.
export function facts(ctx, m, showKind) {
  const { t } = ctx;
  const parts = [];
  if (showKind) parts.push(m.makes.map((k) => t(`makes_${k}`)).join(", "));
  if (m.free) parts.push(t("free"));
  else if (m.makes.includes("text") && m.in != null && m.out != null && (m.in > 0 || m.out > 0)) parts.push(t("perTokens", { in: ctx.money(m.in * 1e6), out: ctx.money(m.out * 1e6) }));
  if (m.perSecond != null) parts.push(t("perSecond", { price: ctx.money(m.perSecond) }));
  if (m.context && m.makes.includes("text")) parts.push(t("contextOf", { n: contextText(ctx, m.context) }));
  const reads = (m.takes ?? []).filter((k) => k !== "text");
  if (reads.length && m.makes.includes("text")) parts.push(t("reads", { what: reads.map((k) => t(`m_${k}`)).join(", ") }));
  return parts.join(" · ");
}

function row(ctx, { value, name, code, small, picked, adding, label }) {
  const { esc } = ctx;
  return `<li><button type="button" class="br-model" data-action="pick-model" data-model="${esc(value)}"${adding ? ` aria-label="${esc(label)}"` : ` aria-pressed="${picked}"`}>
    <span><strong class="br-keep">${esc(name)}</strong>${code ? `<code class="br-keep">${esc(code)}</code>` : ""}<small>${small}</small></span>
    <i class="br-mark">${adding ? plus : picked ? tick : ""}</i></button></li>`;
}

export function modelPicker(ctx, ui, { mode, taken = [], routeId = "", forModel = "" }) {
  const { t, esc, data } = ctx;
  const attrs = `id="br-picker" data-mode="${mode}" data-id="${esc(routeId)}" data-for="${esc(forModel)}"`;
  const mine = data.models ?? [];
  const hidden = mode === "choose" ? `<input type="hidden" name="model" value="${esc(ui.chosen ?? "")}">` : "";

  if (mode === "choose" && !ui.picking) {
    const chosen = mine.find((m) => m.name === ui.chosen);
    return `<div ${attrs}>${hidden}
      <div class="br-chosen"><span><code class="br-keep">${esc(ui.chosen ?? "")}</code>${chosen ? `<small>${chosen.makes.map((k) => t(`makes_${k}`)).join(", ")} · ${esc(fromSummary(ctx, chosen))}</small>` : ""}</span>
        <button type="button" class="br-btn" data-action="pick-open">${t("change")}</button></div></div>`;
  }

  // Where to look: BaseRouter's models on a route, a provider's offer in Manage models.
  const own = mode === "allow" || mode === "choose";
  const places = own ? ["mine"] : data.providers.map((p) => p.id);
  const where = places.includes(ui.where) ? ui.where : places[0] ?? "mine";
  const list = own ? mine.filter((m) => !taken.includes(m.name)) : (ctx.offers ?? []).filter((o) => o.provider === where);

  const found = matching(list, ui);
  const shown = found.slice(0, PAGE * (1 + (ui.more ?? 0)));
  const count = (k) => matching(list, { ...ui, makes: k }).length;
  const chip = (k) => `<button type="button" class="br-chip" data-action="makes" data-makes="${k}" aria-pressed="${(ui.makes ?? "") === k}">${t(k ? `makes_${k}` : "makes_all")} <span class="br-count">${ctx.num(count(k), 0)}</span></button>`;
  const placeChip = (p) => `<button type="button" class="br-chip br-keep" data-action="where" data-where="${esc(p)}" aria-pressed="${where === p}">${p === "mine" ? t("inBaseRouter") : esc(providerName(ctx, p))}</button>`;
  const label = { allow: "allowModel", choose: "firstModel", add: "addModel", place: "addPlace", replace: "newSource" }[mode];

  const rows = shown.map((m) => {
    if (own) {
      return row(ctx, {
        value: m.name, name: m.name, small: `${m.makes.map((k) => t(`makes_${k}`)).join(", ")} · ${esc(fromSummary(ctx, m))}`,
        picked: m.name === ui.chosen, adding: mode !== "choose", label: t("allowNamed", { name: m.name }),
      });
    }
    const already = modelOf(ctx, m);
    const note = already && mode !== "place" && mode !== "replace" ? ` · ${t("alreadyAs", { name: esc(already.name) })}` : "";
    return row(ctx, { value: `${m.provider}|${m.id}`, name: m.name, code: m.id, small: facts(ctx, m, !ui.makes) + note, picked: false, adding: true, label: t("addNamed", { name: m.name }) });
  });

  const empty = own && !list.length && !(ui.find || ui.makes) ? (mine.length ? "allAuthorized" : "noOwnModels") : !own && !list.length && ctx.loadingOffers ? "modelsLoading" : "noModel";
  // On a route, the way to more models is Manage models.
  const manage = own ? `<p class="br-actions"><button type="button" class="br-btn quiet" data-action="go" data-screen="models"${mine.length ? "" : ' data-edit="add"'}>${t("manageModels")}</button></p>` : "";
  return `<div ${attrs}>${hidden}
    <label class="br-label" for="br-find">${t(label)}</label>
    ${places.length > 1 ? `<div class="br-chips br-where-chips" role="group" aria-label="${t("whereToLook")}">${places.map(placeChip).join("")}</div>` : ""}
    <input class="br-input wide br-find" id="br-find" type="search" data-find autocomplete="off" spellcheck="false" placeholder="${t("findModel")}" value="${esc(ui.find ?? "")}" data-autofocus>
    <div class="br-chips" role="group" aria-label="${t("modelKinds")}">${["", ...KINDS].filter((k) => !k || k === ui.makes || count(k) > 0).map(chip).join("")}</div>
    ${shown.length
      ? `<ul class="br-models">${rows.join("")}</ul>
         ${found.length > shown.length ? `<p class="br-actions"><button type="button" class="br-btn quiet" data-action="more-models">${t("moreModels", { n: ctx.num(found.length - shown.length, 0) })}</button></p>` : ""}`
      : `<p class="br-lead">${t(empty)}</p>`}
    ${manage}
    ${mode === "choose" && ui.chosen ? `<p class="br-actions"><button type="button" class="br-btn quiet" data-action="pick-close">${t("keepChosen", { id: esc(ui.chosen) })}</button></p>` : ""}
  </div>`;
}

// Which of OpenRouter's own providers one place of a model uses: "Any provider", or one
// named, from OpenRouter's endpoints list for that model. ui.providers: { model, list }.
export function viaChoice(ctx, ui, model, at) {
  const { t, esc } = ctx;
  const place = model.from[at];
  const list = ui.providers?.model === place.model ? ui.providers.list : null;
  const taken = (tag) => model.from.some((p, i) => i !== at && p.provider === place.provider && p.model === place.model && (p.via ?? "") === tag);
  const row = (tag, name, tier, small, up = true) => `<li><button type="button" class="br-model" data-action="set-via" data-tag="${esc(tag)}"
      aria-pressed="${(place.via ?? "") === tag}"${taken(tag) ? " disabled" : ""}${(place.via ?? "") === tag ? " data-autofocus" : ""}>
    <span><strong class="br-keep">${name}${tier ? ` <span class="br-tier">${esc(tier)}</span>` : ""}</strong>${tag ? `<code class="br-keep">${esc(tag)}</code>` : ""}<small>${[small, up ? "" : t("providerDown"), taken(tag) ? t("alreadyListed") : ""].filter(Boolean).join(" · ")}</small></span>
    <i class="br-mark">${(place.via ?? "") === tag ? tick : ""}</i></button></li>`;
  const price = (p) => [
    p.in != null && p.out != null && (p.in > 0 || p.out > 0) ? t("perTokens", { in: ctx.money(p.in * 1e6), out: ctx.money(p.out * 1e6) }) : "",
    p.context ? t("contextOf", { n: contextText(ctx, p.context) }) : "",
  ].filter(Boolean).join(" · ");
  return `<div class="br-where">
    <h4 class="br-label">${t("whereFrom", { model: `<span class="br-keep">${esc(place.model)}</span>` })}</h4>
    <p class="br-note">${t("whereFromNote")}</p>
    ${list === null
      ? `<p class="br-busy" role="status"><i></i>${t("providersLoading")}</p>`
      : `<ul class="br-models">${row("", t("anyProvider"), null, t("anyProviderNote"))}${
          place.via && !list.some((p) => p.tag === place.via) ? row(place.via, esc(place.via), null, t("notListed")) : ""
        }${list.map((p) => row(p.tag, esc(p.name), p.tier, price(p), p.up)).join("")}</ul>`}
    <p class="br-actions" style="margin-top:12px"><button class="br-btn" data-action="edit" data-edit="">${t("cancel")}</button></p>
  </div>`;
}
