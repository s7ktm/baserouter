// New route: a short form, then the one moment the full key is shown,
// with a line that watches for the first request.
import { sheet, curl } from "./sheet.js";

export function newRouteSheet(ctx, ui) {
  const { t, esc, data, money } = ctx;
  const copyLabel = (id) => t(ctx.copiedId === id ? "copied" : "copy");

  if (ui.step === "made" && ui.made) {
    const route = data.routes.find((r) => r.id === ui.made.id);
    const snippet = curl(data.address, route.models[0]);
    const first = ui.made.first;
    return sheet(ctx, ui, {
      title: t("routeReady", { name: `<span class="br-keep">${ctx.name(route)}</span>` }),
      step: ui.flow ? { n: 3, of: 3 } : null,
      body: `
        <span class="br-label">${t("key")}</span>
        <div class="br-field"><code class="br-keep">${esc(ui.made.key)}</code><button class="br-btn" data-action="copy" data-copy-id="new-key" data-copy="${esc(ui.made.key)}">${copyLabel("new-key")}</button></div>
        <p class="br-callout">${t("keyOnce")}</p>
        <section class="br-sec">
          <h3>${t("tryIt")}</h3>
          <pre class="br-code br-keep" tabindex="0">${esc(snippet)}</pre>
          <p class="br-actions"><button class="br-btn" data-action="copy" data-copy-id="new-snippet" data-copy="${esc(snippet)}">${copyLabel("new-snippet")}</button></p>
          ${first
            ? `<p class="br-busy"><i class="ok"></i>${t("arrived", { secs: ctx.secs(first.seconds), cost: money(first.cost) })}</p>`
            : `<p class="br-busy" role="status"><i></i>${t("waiting")}</p>`}
        </section>
        <p class="br-actions" style="margin-top:18px"><button class="br-btn main" data-action="close">${t("done")}</button></p>`,
    });
  }

  const step = ui.flow ? { n: 2, of: 3 } : null;
  if (!data.providers.length) {
    return sheet(ctx, ui, {
      title: t("newRoute"),
      step,
      body: `<p class="br-lead">${t("needProvider")}</p>
        <p class="br-actions" style="margin-top:16px"><button class="br-btn main" data-action="go" data-screen="add-provider">+ ${t("addProvider")}</button></p>`,
    });
  }

  return sheet(ctx, ui, {
    title: t("newRoute"),
    step,
    body: `<form class="br-form" data-form="route">
      <label class="br-label" for="br-name">${t("routeName")}</label>
      <input class="br-input wide br-keep" id="br-name" name="name" type="text" maxlength="40" autocomplete="off" required data-autofocus>
      <p class="br-note" style="margin-top:8px">${t("routeNameHint")}</p>
      <label class="br-label" for="br-new-budget">${t("monthly")}</label>
      <input class="br-input wide" id="br-new-budget" name="budget" type="number" inputmode="decimal" min="1" step="1" value="5" required>
      <label class="br-label" for="br-model">${t("firstModel")}</label>
      <span class="br-select"><select class="br-input wide br-keep" id="br-model" name="model">${ctx.modelChoices.map((m) => `<option>${esc(m)}</option>`).join("")}</select></span>
      <p class="br-note" style="margin-top:8px">${t("modelLater")}</p>
      <p class="br-actions" style="margin-top:16px"><button class="br-btn main" type="submit">${t("makeRoute")}</button></p>
    </form>`,
  });
}
