// Models: the models BaseRouter offers, under the names apps send, and where each comes from,
// in order. Defined once, for every route. One of them opens in the same sheet: its name,
// its places (the next takes over when one fails), the routes that use it, and deleting it.
// See "Models" in DESIGN.md.
import { sheet, cross } from "./sheet.js";
import { fromSummary, modelPicker, providerName, viaChoice } from "./models.js";

// Whether two places are the same model: the same id once the provider's own prefix is left
// out ("openai/gpt-5-mini" at OpenRouter is "gpt-5-mini" at OpenAI).
const sameModel = (a, b) => a.split("/").pop() === b.split("/").pop();
// The providers that have providers of their own to choose from.
const isOpenRouter = (ctx, id) => /openrouter|nanogpt/i.test(`${id} ${providerName(ctx, id)}`);

export function modelsSheet(ctx, ui) {
  const { t, esc, data } = ctx;
  const models = data.models ?? [];
  const usedBy = (name) => data.routes.filter((r) => r.models.includes(name));
  const open = models.find((m) => m.name === ui.model);
  const sub = models.length ? t("modelsSub", { n: ctx.num(models.length, 0), p: ctx.num(new Set(models.flatMap((m) => m.from.map((p) => p.provider))).size, 0) }) : "";
  // In the first run this is step 2 of 4: add a model, then make a route.
  const step = ui.flow ? { n: 2, of: 4 } : null;
  const next = ui.flow && models.length
    ? `<p class="br-actions" style="margin-top:18px"><button class="br-btn main" data-action="go" data-screen="new-route" data-flow="1">${t("nextRoute")}</button></p>`
    : "";
  if (open) return sheet(ctx, ui, { title: t("models"), sub, step, body: oneModel(ctx, ui, open, usedBy(open.name)) + next });

  const adding = ui.editing === "add"
    ? `<form class="br-form" data-form="find">
        ${modelPicker(ctx, ui, { mode: "add" })}
        <p class="br-actions" style="margin-top:12px"><button class="br-btn" type="button" data-action="edit" data-edit="">${t("cancel")}</button></p>
      </form>`
    : `<p class="br-actions" style="margin-top:16px"><button class="br-btn main" data-action="edit" data-edit="add">+ ${t("addModel")}</button></p>`;

  return sheet(ctx, ui, {
    title: t("models"),
    sub,
    step,
    body: `<p class="br-note" style="margin-top:12px">${t(ui.flow && !models.length ? "modelsFirst" : "modelsNote")}</p>
      ${models.length
        ? `<ul class="br-models">${models.map((m) => {
            const n = usedBy(m.name).length;
            return `<li><button class="br-model" data-action="open-model" data-model="${esc(m.name)}">
              <span><code class="br-keep br-name">${esc(m.name)}</code>
                <small>${m.makes.map((k) => t(`makes_${k}`)).join(", ")} · <span class="br-keep">${esc(fromSummary(ctx, m))}</span> · ${n ? t("usedByCount", { n }) : t("usedByNoRoute")}</small></span>
              <i class="br-mark br-go"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></i></button></li>`;
          }).join("")}</ul>`
        : ui.editing === "add" ? "" : `<p class="br-lead">${t("noModelsYet")}</p>`}
      ${adding}${ui.editing === "add" ? "" : next}`,
  });
}

function oneModel(ctx, ui, m, routes) {
  const { t, esc, data } = ctx;
  const first = m.from[0]?.model ?? "";
  const anyRoutes = data.routes.filter((r) => !r.models.length).length;

  const name = ui.editing === "rename"
    ? `<form class="br-form" data-form="rename" data-model="${esc(m.name)}">
        <label class="br-label" for="br-rename">${t("newName")}</label>
        <input class="br-input wide br-keep" id="br-rename" name="name" value="${esc(m.name)}" maxlength="200" autocomplete="off" spellcheck="false" required data-autofocus>
        ${ui.error ? `<p class="br-banner" role="alert" style="margin:10px 0 0">${esc(ui.error)}</p>` : ""}
        <p class="br-note" style="margin-top:8px">${t("renameNote")}</p>
        <p class="br-actions" style="margin-top:12px"><button class="br-btn main" type="submit">${t("rename")}</button><button class="br-btn" type="button" data-action="edit" data-edit="">${t("cancel")}</button></p>
      </form>`
    : `<div class="br-field"><code class="br-keep">${esc(m.name)}</code><button class="br-btn" data-action="edit" data-edit="rename">${t("rename")}</button></div>
       <p class="br-note" style="margin-top:8px">${m.makes.map((k) => t(`makes_${k}`)).join(", ")}</p>`;

  const places = `<ol class="br-list">${m.from.map((p, i) => `<li><b class="br-n">${i + 1}</b>
      <span><strong class="br-keep">${esc(providerName(ctx, p.provider))}${i > 0 && !sameModel(p.model, first) ? ` <span class="br-tier">${t("differentModel")}</span>` : ""}</strong>
        <code class="br-keep">${esc(p.model)}</code>
        <span class="br-source-acts">${isOpenRouter(ctx, p.provider)
          ? `<button class="br-from" data-action="edit" data-edit="via" data-place="${i}" aria-pressed="${ui.editing === "via" && ui.place === i}">${p.via ? `<span class="br-keep">${esc(p.via)}</span>` : t("anyProvider")}</button>`
          : ""}<button class="br-from br-change" data-action="edit" data-edit="replace" data-place="${i}" aria-pressed="${ui.editing === "replace" && ui.place === i}" aria-label="${t("changeNamed", { n: i + 1 })}">${t("changeSource")}</button></span></span>
      ${m.from.length > 1 ? `<button class="br-x small" data-action="remove-place" data-place="${i}" aria-label="${t("remove", { name: esc(`${providerName(ctx, p.provider)} ${p.model}`) })}">${cross}</button>` : "<span></span>"}</li>`).join("")}</ol>`;

  const via = ui.editing === "via" && m.from[ui.place] ? viaChoice(ctx, ui, m, ui.place) : "";
  // Changing one source: the picker on the providers' offers; the pick takes that source's place.
  const replace = ui.editing === "replace" && m.from[ui.place]
    ? `<form class="br-form br-where" data-form="find">
        ${modelPicker(ctx, ui, { mode: "replace", forModel: m.name })}
        <p class="br-actions" style="margin-top:12px"><button class="br-btn" type="button" data-action="edit" data-edit="">${t("cancel")}</button></p>
      </form>`
    : "";
  const addPlace = ui.editing === "place"
    ? `<form class="br-form" data-form="find">
        ${modelPicker(ctx, ui, { mode: "place", forModel: m.name })}
        <p class="br-actions" style="margin-top:12px"><button class="br-btn" type="button" data-action="edit" data-edit="">${t("cancel")}</button></p>
      </form>`
    : ui.editing === "via" || ui.editing === "replace" ? "" : `<p class="br-actions"><button class="br-btn" data-action="edit" data-edit="place">+ ${t("addPlace")}</button></p>`;

  const lose = routes.map((r) => `<span class="br-keep">${ctx.name(r)}</span>`).join(", ");
  return `
    <p class="br-actions"><button class="br-btn quiet" data-action="open-model" data-model=""${ui.editing ? "" : " data-autofocus"}>${t("allModels")}</button></p>
    <section class="br-sec">
      <h3>${t("nameAppsUse")}</h3>
      ${name}
    </section>
    <section class="br-sec">
      <h3>${t("comesFrom")}</h3>
      <p class="br-note">${t("comesFromNote")}</p>
      ${places}
      ${via}
      ${replace}
      ${addPlace}
    </section>
    <section class="br-sec">
      <h3>${t("usedBy")}</h3>
      ${routes.length
        ? `<p class="br-actions br-used">${routes.map((r) => `<button class="br-btn quiet" data-action="open" data-id="${r.id}">${ctx.name(r)}</button>`).join("")}</p>`
        : `<p class="br-note">${t("usedByNone")}</p>`}
      ${anyRoutes ? `<p class="br-note" style="margin-top:6px">${t("usedByAny", { n: anyRoutes })}</p>` : ""}
    </section>
    <section class="br-sec">${ui.editing === "delete"
      ? `<p class="br-lead" style="margin:0">${routes.length ? t("deleteModelAsk", { name: `<span class="br-keep">${esc(m.name)}</span>`, routes: lose }) : t("deleteModelAskNone", { name: `<span class="br-keep">${esc(m.name)}</span>` })}</p>
         <p class="br-actions"><button class="br-btn main danger" data-action="delete-model" data-model="${esc(m.name)}">${t("deleteModel")}</button><button class="br-btn" data-action="edit" data-edit="" data-autofocus>${t("cancel")}</button></p>`
      : `<button class="br-btn quiet danger" data-action="edit" data-edit="delete">${t("deleteModel")}</button>`}</section>`;
}
