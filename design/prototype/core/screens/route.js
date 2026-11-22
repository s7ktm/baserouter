// Route detail. Built once; every skin restyles it through the shared tokens.
// Order follows what a person opens a route for: is it on, what has it spent,
// how do I connect to it, which models may it use, what did it just do.
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

  const code = snippets(route, data);
  const tab = ui.tab in code ? ui.tab : "curl";
  const recent = data.requests.filter((q) => q.route === route.id).slice(0, 5);

  const body = `
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
      <div class="br-field"><code class="br-keep">br_••••••••${esc(route.keyHint)}</code></div>
      <p class="br-note" style="margin-top:8px">${t("keyNote")}</p>
      <p class="br-actions"><button class="br-btn">${t("newKey")}</button></p>
      <div class="br-tabs" role="tablist">
        ${Object.keys(code).map((id) => `<button class="br-tab br-keep" role="tab" aria-selected="${id === tab}" data-action="tab" data-tab="${id}">${id === "curl" ? "curl" : "Python"}</button>`).join("")}
      </div>
      <pre class="br-code br-keep" tabindex="0">${esc(code[tab])}</pre>
      <p class="br-actions"><button class="br-btn" data-action="copy" data-copy-id="snippet" data-copy="${esc(code[tab])}">${copyLabel("snippet")}</button></p>
    </section>

    <section class="br-sec">
      <h3>${t("models")}</h3>
      <p class="br-note">${t("modelsNote")}</p>
      <ol class="br-list">
        ${route.models.map((m, i) => `<li><b class="br-n">${i + 1}</b><span><code class="br-keep">${esc(m)}</code></span><button class="br-x small" aria-label="${t("remove", { name: esc(m) })}">${cross}</button></li>`).join("")}
      </ol>
      <p class="br-actions"><button class="br-btn">+ ${t("addModel")}</button></p>
    </section>

    <section class="br-sec">
      <h3>${t("recent")}</h3>
      ${recent.length
        ? `<ul class="br-list">${recent.map((q) => `<li><i class="br-dot${q.ok ? "" : " stop"}"></i><span><code class="br-keep">${esc(q.model)}</code><small>${ctx.ago(q.ago)}, ${ctx.secs(q.seconds)}</small></span><b>${q.ok ? money(q.cost) : t("failed")}</b></li>`).join("")}</ul>
           <p class="br-actions"><button class="br-btn quiet" data-action="go" data-screen="activity" data-filter="${route.id}">${t("allActivity")}</button></p>`
        : `<p class="br-note">${t("noRecent")}</p>`}
    </section>

    <section class="br-sec"><button class="br-btn quiet danger">${t("deleteRoute")}</button></section>`;

  return sheet(ctx, ui, {
    title: name,
    keep: true,
    sub: t("st_" + status),
    stop: over,
    right: over ? "" : `<button class="br-switch" data-action="toggle" data-id="${route.id}" aria-pressed="${status !== "off"}" aria-label="${name}"></button>`,
    body,
  });
}
