// Activity: every request, newest first, with one filter: which route. A second tab shows
// the images routes made, kept by the gateway; one of them can be opened, downloaded or deleted.
import { sheet } from "./sheet.js";

export function activitySheet(ctx, ui) {
  const { t, esc, data, money } = ctx;
  const filter = data.routes.some((r) => r.id === ui.filter) ? ui.filter : "";
  const images = ui.show === "images";
  const nameOf = (id) => {
    const route = data.routes.find((r) => r.id === id);
    return route ? ctx.name(route) : t("removedRoute");
  };
  const chip = (id, label) => `<button class="br-chip${id ? " br-keep" : ""}" data-action="filter" data-route="${id}" aria-pressed="${id === filter}">${label}</button>`;
  const chips = `<div class="br-chips">${chip("", t("allRoutes"))}${data.routes.map((r) => chip(r.id, ctx.name(r))).join("")}</div>`;
  const tabs = `<div class="br-seg br-show" role="group" aria-label="${t("activity")}">
      <button data-action="show" data-show="requests" aria-pressed="${!images}">${t("requestsTab")}</button>
      <button data-action="show" data-show="images" aria-pressed="${images}">${t("imagesTab")}</button>
    </div>`;

  const open = images ? data.images.find((i) => i.id === ui.image) : null;
  if (open) return sheet(ctx, ui, { title: t("imagesTab"), sub: imagesSub(ctx), body: viewer(ctx, ui, open, nameOf) });

  let body;
  if (images) {
    const rows = data.images.filter((i) => !filter || i.route === filter);
    body = !data.images.length
      ? `${tabs}<p class="br-lead">${t(data.imageSpace.keeping === false ? "imgOff" : "imgNone")}</p>`
      : `${tabs}${chips}
         ${rows.length
           ? `<ul class="br-grid">${rows.map((i) => `<li><button class="br-thumb" data-action="image" data-id="${esc(i.id)}" aria-label="${esc(i.prompt || t("imagesTab"))}, ${nameOf(i.route)}, ${ctx.ago(i.ago)}">
               <img src="${esc(i.src)}" alt="" loading="lazy" decoding="async"></button></li>`).join("")}</ul>`
           : `<p class="br-lead">${t("imgNoneFor")}</p>`}`;
  } else {
    const rows = data.requests.filter((q) => !filter || q.route === filter);
    body = !data.requests.length
      ? `${tabs}<p class="br-lead">${t("actNone")}</p>`
      : `${tabs}${chips}
         ${rows.length
           ? `<ul class="br-list">${rows.map((q) => `<li><i class="br-dot${q.ok ? "" : " stop"}"></i>
               <span><strong class="br-keep">${nameOf(q.route)}</strong><code class="br-keep">${esc(q.model)}</code><small>${ctx.when(q)}</small></span>
               <b>${q.ok ? money(q.cost) : t("failed")}</b></li>`).join("")}</ul>`
           : `<p class="br-lead">${t("actNoneFor")}</p>`}`;
  }

  return sheet(ctx, ui, {
    title: t("activity"),
    sub: images
      ? imagesSub(ctx)
      : data.requests.length ? t("actSub", { n: ctx.num(data.spend.requests ?? data.requests.length, 0), spent: money(data.spend.today, 2) }) : "",
    body,
  });
}

// "12 images, 3.4 MB of 1 GB"
function imagesSub(ctx) {
  const space = ctx.data.imageSpace;
  if (!space?.count) return "";
  return ctx.t("imgSub", { n: ctx.num(space.count, 0), size: size(ctx, space.bytes), max: size(ctx, space.max) });
}

function size(ctx, bytes) {
  const units = [["GB", 1024 ** 3], ["MB", 1024 ** 2], ["KB", 1024]];
  const [unit, per] = units.find(([, per]) => bytes >= per) ?? ["KB", 1024];
  const value = bytes / per;
  return `${ctx.num(value, value >= 10 || Number.isInteger(value) ? 0 : 1)} ${unit}`;
}

// One image, large, with what made it.
function viewer(ctx, ui, image, nameOf) {
  const { t, esc, money } = ctx;
  const facts = [
    [t("route"), nameOf(image.route)],
    [t("model"), `<code class="br-keep">${esc(image.model ?? "")}</code>`],
    [t("when"), ctx.ago(image.ago)],
    [t("cost"), image.cost == null ? t("costUnknown") : money(image.cost)],
    [t("size"), size(ctx, image.bytes)],
  ];
  const download = image.src.startsWith("data:") ? image.src : `${image.src}?download=1`;
  return `
    <p class="br-actions"><button class="br-btn quiet" data-action="image" data-id=""${ui.editing === "delete-image" ? "" : " data-autofocus"}>${t("imgBack")}</button></p>
    <figure class="br-shot"><img src="${esc(image.src)}" alt="${esc(image.prompt ?? "")}"></figure>
    ${image.prompt ? `<p class="br-prompt br-keep">${esc(image.prompt)}</p>` : ""}
    <dl class="br-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    ${ui.editing === "delete-image"
      ? `<p class="br-lead">${t("imgDeleteAsk")}</p>
         <p class="br-actions"><button class="br-btn main danger" data-action="delete-image" data-id="${esc(image.id)}">${t("imgDelete")}</button><button class="br-btn" data-action="edit" data-edit="" data-autofocus>${t("cancel")}</button></p>`
      : `<p class="br-actions"><a class="br-btn" href="${esc(download)}" download="baserouter-${esc(image.id)}">${t("imgDownload")}</a><button class="br-btn quiet danger" data-action="edit" data-edit="delete-image">${t("imgDelete")}</button></p>`}`;
}
