// Route detail. Built once; every skin restyles it through the shared tokens.
// Order follows what a person opens a route for: is it on, what has it spent,
// how do I connect to it, which models may it use, what did it just do.
import { fromSummary, modelPicker } from "./models.js";
import { sheet, cross, curl } from "./sheet.js";

function snippets(route, data) {
  const model = route.models[0] ?? "model-name";
  return {
    curl: curl(data.address, model),
    python: `import os
from openai import OpenAI

client = OpenAI(
    base_url="${data.address}",
    api_key=os.environ["BASEROUTER_KEY"],
)
reply = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello"}],
)`,
  };
}

export function routeSheet(ctx, ui) {
  const { t, money, esc, data } = ctx;
  const route = data.routes.find((r) => r.id === ctx.view.id);
  const status = ctx.status(route);
  const over = status === "over";
  const name = ctx.name(route);
  const copyLabel = (id) => t(ctx.copiedId === id ? "copied" : "copy");

  const budget = ui.editing === "budget"
    ? `<form class="br-form" data-form="budget" data-id="${route.id}">
        <label class="br-label" for="br-budget">${t("monthly")}</label>
        <div class="br-actions">
          <input class="br-input" id="br-budget" name="budget" type="number" inputmode="decimal" min="1" step="1" value="${route.budget}" required data-autofocus>
          <button class="br-btn main" type="submit">${t("saveBudget")}</button>
          <button class="br-btn" type="button" data-action="edit" data-edit="">${t("cancel")}</button>
        </div>
      </form>`
    : `<p class="br-actions"><button class="br-btn${over ? " main" : ""}" data-action="edit" data-edit="budget">${t(over ? "raiseBudget" : "changeBudget")}</button></p>`;

  // The key: hidden, or asking before a new one is made, or the new one, shown this once.
  const shown = ui.newKey?.id === route.id ? ui.newKey.key : null;
  const key = shown
    ? `<div class="br-field"><code class="br-keep">${esc(shown)}</code><button class="br-btn" data-action="copy" data-copy-id="route-key" data-copy="${esc(shown)}">${copyLabel("route-key")}</button></div>
       <p class="br-callout">${t("keyOnce")}</p>`
    : `<div class="br-field"><code class="br-keep">br_••••••••${esc(route.keyHint)}</code></div>
       <p class="br-note" style="margin-top:8px">${t("keyNote")}</p>
       ${ui.editing === "key"
         ? `<p class="br-callout">${t("newKeyNote")}</p>
            <p class="br-actions"><button class="br-btn main" data-action="new-key" data-id="${route.id}">${t("newKey")}</button><button class="br-btn" data-action="edit" data-edit="" data-autofocus>${t("cancel")}</button></p>`
         : `<p class="br-actions"><button class="br-btn" data-action="edit" data-edit="key">${t("newKey")}</button></p>`}`;

  // Allowing a model: BaseRouter's models first, then what the providers offer (picking one of
  // those makes it a model in BaseRouter, with that one place).
  const allow = ui.editing === "model"
    ? `<form class="br-form br-adding" data-form="find" data-id="${route.id}">
        ${modelPicker(ctx, ui, { mode: "allow", taken: route.models, routeId: route.id })}
        <p class="br-actions" style="margin-top:12px"><button class="br-btn" type="button" data-action="edit" data-edit="">${t("cancel")}</button></p>
      </form>`
    : `<p class="br-actions"><button class="br-btn" data-action="edit" data-edit="model">+ ${t("allowModel")}</button><button class="br-btn quiet" data-action="go" data-screen="models">${t("allModels")}</button></p>`;

  const code = snippets(route, data);
  const tab = ui.tab in code ? ui.tab : "curl";
  const recent = data.requests.filter((q) => q.route === route.id).slice(0, 5);
  // The kinds of kept media this route has made, each with a way to them in activity.
  const kept = [["images", "seeImages"], ["sounds", "seeSounds"], ["videos", "seeVideos"]].filter(([show]) => data[show]?.some((i) => i.route === route.id));

  const body = `
    ${ui.error ? `<p class="br-banner" role="alert" style="margin:16px 0 0">${t("actionFailed", { error: esc(ui.error) })}</p>` : ""}
    <section class="br-sec">
      <h3>${t("budget")}</h3>
      ${over ? `<p class="br-banner">${t("overNote")}</p>` : ""}
      <p class="br-big">${money(route.used, 2)} <small>${t("ofBudget", { budget: money(route.budget) })}</small></p>
      <div class="br-meter${over ? " stop" : ""}"><u style="--p:${ctx.percent(route)}%"></u></div>
      <p class="br-note">${t("resets", { date: ctx.resetDate })}</p>
      ${budget}
    </section>

    <section class="br-sec">
      <h3>${t("connect")}</h3>
      <span class="br-label">${t("address")}</span>
      <div class="br-field"><code class="br-keep">${data.address}</code><button class="br-btn" data-action="copy" data-copy-id="sheet-address">${copyLabel("sheet-address")}</button></div>
      <span class="br-label">${t("key")}</span>
      ${key}
      <div class="br-tabs" role="tablist">
        ${Object.keys(code).map((id) => `<button class="br-tab br-keep" role="tab" aria-selected="${id === tab}" data-action="tab" data-tab="${id}">${id === "curl" ? "curl" : "Python"}</button>`).join("")}
      </div>
      <pre class="br-code br-keep" tabindex="0">${esc(code[tab])}</pre>
      <p class="br-actions"><button class="br-btn" data-action="copy" data-copy-id="snippet" data-copy="${esc(code[tab])}">${copyLabel("snippet")}</button></p>
    </section>

    <section class="br-sec">
      <h3>${t("mayUse")}</h3>
      <p class="br-note">${t("mayUseNote")}</p>
      ${route.models.length
        ? `<ul class="br-list br-allowed">${route.models.map((name) => {
            const m = (data.models ?? []).find((x) => x.name === name);
            return `<li><span><button class="br-open-model" data-action="go" data-screen="models" data-model="${esc(name)}"><code class="br-keep">${esc(name)}</code></button>
                <small>${m ? `${m.makes.map((k) => t(`makes_${k}`)).join(", ")} · <span class="br-keep">${esc(fromSummary(ctx, m))}</span>` : t("modelGone")}</small></span>
              ${route.models.length > 1 ? `<button class="br-x small" data-action="remove-model" data-id="${route.id}" data-model="${esc(name)}" aria-label="${t("remove", { name: esc(name) })}">${cross}</button>` : "<span></span>"}</li>`;
          }).join("")}</ul>`
        : `<p class="br-note" style="margin-top:8px">${t("anyModel")}</p>`}
      ${allow}
    </section>

    <section class="br-sec">
      <div class="br-row">
        <span><h3>${t("keepMedia")}</h3><span class="br-note">${t("keepMediaNote")}</span></span>
        <button class="br-switch" data-action="keep-media" data-id="${route.id}" aria-pressed="${route.keepMedia !== false}" aria-label="${t("keepMedia")}"></button>
      </div>
      ${kept.length
        ? `<p class="br-actions">${kept.map(([show, words]) => `<button class="br-btn quiet" data-action="go" data-screen="activity" data-show="${show}" data-filter="${route.id}">${t(words)}</button>`).join("")}</p>`
        : ""}
    </section>

    <section class="br-sec">
      <h3>${t("recent")}</h3>
      ${recent.length
        ? `<ul class="br-list">${recent.map((q) => `<li><i class="br-dot${q.ok ? "" : " stop"}"></i><span><code class="br-keep">${esc(q.model)}</code><small>${ctx.when(q)}</small></span><b>${q.ok ? money(q.cost) : t("failed")}</b></li>`).join("")}</ul>
           <p class="br-actions"><button class="br-btn quiet" data-action="go" data-screen="activity" data-filter="${route.id}">${t("allActivity")}</button></p>`
        : `<p class="br-note">${t("noRecent")}</p>`}
    </section>

    <section class="br-sec">${ui.editing === "delete"
      ? `<p class="br-lead" style="margin:0">${t("deleteAsk", { name: `<span class="br-keep">${name}</span>` })}</p>
         <p class="br-actions"><button class="br-btn main danger" data-action="delete-route" data-id="${route.id}">${t("deleteRoute")}</button><button class="br-btn" data-action="edit" data-edit="" data-autofocus>${t("cancel")}</button></p>`
      : `<button class="br-btn quiet danger" data-action="edit" data-edit="delete">${t("deleteRoute")}</button>`}</section>`;

  return sheet(ctx, ui, {
    title: name,
    keep: true,
    sub: t("st_" + status),
    stop: over,
    right: over ? "" : `<button class="br-switch" data-action="toggle" data-id="${route.id}" aria-pressed="${status !== "off"}" aria-label="${name}"></button>`,
    body,
  });
}
