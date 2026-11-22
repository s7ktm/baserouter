// Activity: every request, newest first, with one filter: which route.
import { sheet } from "./sheet.js";

export function activitySheet(ctx, ui) {
  const { t, esc, data, money } = ctx;
  const filter = data.routes.some((r) => r.id === ui.filter) ? ui.filter : "";
  const rows = data.requests.filter((q) => !filter || q.route === filter);
  const nameOf = (id) => {
    const route = data.routes.find((r) => r.id === id);
    return route ? ctx.name(route) : esc(id);
  };
  const chip = (id, label) => `<button class="br-chip${id ? " br-keep" : ""}" data-action="filter" data-route="${id}" aria-pressed="${id === filter}">${label}</button>`;

  return sheet(ctx, ui, {
    title: t("activity"),
    sub: data.requests.length ? t("actSub", { n: ctx.num(data.spend.requests ?? data.requests.length, 0), spent: money(data.spend.today, 2) }) : "",
    body: !data.requests.length
      ? `<p class="br-lead">${t("actNone")}</p>`
      : `<div class="br-chips">${chip("", t("allRoutes"))}${data.routes.map((r) => chip(r.id, ctx.name(r))).join("")}</div>
         ${rows.length
           ? `<ul class="br-list">${rows.map((q) => `<li><i class="br-dot${q.ok ? "" : " stop"}"></i>
               <span><strong class="br-keep">${nameOf(q.route)}</strong><code class="br-keep">${esc(q.model)}</code><small>${ctx.when(q)}</small></span>
               <b>${q.ok ? money(q.cost) : t("failed")}</b></li>`).join("")}</ul>`
           : `<p class="br-lead">${t("actNoneFor")}</p>`}`,
  });
}
