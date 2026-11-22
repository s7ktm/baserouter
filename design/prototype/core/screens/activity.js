// Activity: every request, newest first, with one filter: which route. Two more tabs show
// what routes made and the gateway kept: images in a grid, sounds in a list. One of them
// can be opened, looked at or listened to, downloaded or deleted.
import { sheet } from "./sheet.js";

const play = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

export function activitySheet(ctx, ui) {
  const { t, esc, data, money } = ctx;
  const filter = data.routes.some((r) => r.id === ui.filter) ? ui.filter : "";
  const show = ["images", "sounds"].includes(ui.show) ? ui.show : "requests";
  const nameOf = (id) => {
    const route = data.routes.find((r) => r.id === id);
    return route ? ctx.name(route) : t("removedRoute");
  };
  const chip = (id, label) => `<button class="br-chip${id ? " br-keep" : ""}" data-action="filter" data-route="${id}" aria-pressed="${id === filter}">${label}</button>`;
  const chips = `<div class="br-chips">${chip("", t("allRoutes"))}${data.routes.map((r) => chip(r.id, ctx.name(r))).join("")}</div>`;
  const tab = (id, label) => `<button data-action="show" data-show="${id}" aria-pressed="${show === id}">${label}</button>`;
  const tabs = `<div class="br-seg br-show" role="group" aria-label="${t("activity")}">${tab("requests", t("requestsTab"))}${tab("images", t("imagesTab"))}${tab("sounds", t("soundsTab"))}</div>`;

  const items = show === "images" ? data.images : show === "sounds" ? data.sounds : null;
  const open = items?.find((i) => i.id === ui.media);
  if (open) return sheet(ctx, ui, { title: t(show === "images" ? "imagesTab" : "soundsTab"), sub: mediaSub(ctx), body: viewer(ctx, ui, open, nameOf) });

  let body;
  if (items) {
    const rows = items.filter((i) => !filter || i.route === filter);
    const none = data.mediaSpace?.keeping === false ? "mediaOff" : show === "images" ? "imgNone" : "sndNone";
    body = !items.length
      ? `${tabs}<p class="br-lead">${t(none)}</p>`
      : `${tabs}${chips}
         ${!rows.length
           ? `<p class="br-lead">${t(show === "images" ? "imgNoneFor" : "sndNoneFor")}</p>`
           : show === "images"
             ? `<ul class="br-grid">${rows.map((i) => `<li><button class="br-thumb" data-action="media" data-id="${esc(i.id)}" aria-label="${esc(i.prompt || t("imagesTab"))}, ${nameOf(i.route)}, ${ctx.ago(i.ago)}">
                 <img src="${esc(i.src)}" alt="" loading="lazy" decoding="async"></button></li>`).join("")}</ul>`
             : `<ul class="br-list br-sounds">${rows.map((i) => `<li><button class="br-sound" data-action="media" data-id="${esc(i.id)}">
                 <i class="br-play">${play}</i>
                 <span><strong class="br-keep">${esc(i.prompt || t("soundsTab"))}</strong><small>${nameOf(i.route)} · ${ctx.ago(i.ago)}</small></span>
                 <b>${i.cost == null ? "" : money(i.cost)}</b></button></li>`).join("")}</ul>`}`;
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
    sub: items
      ? mediaSub(ctx)
      : data.requests.length ? t("actSub", { n: ctx.num(data.spend.requests ?? data.requests.length, 0), spent: money(data.spend.today, 2) }) : "",
    body,
  });
}

// "4 images, 2 sounds: 3.4 MB of 1 GB". Images and sound share the room.
function mediaSub(ctx) {
  const space = ctx.data.mediaSpace;
  if (!space?.images && !space?.sounds) return "";
  return ctx.t("mediaSub", { images: ctx.num(space.images, 0), sounds: ctx.num(space.sounds, 0), size: size(ctx, space.bytes), max: size(ctx, space.max) });
}

function size(ctx, bytes) {
  const units = [["GB", 1024 ** 3], ["MB", 1024 ** 2], ["KB", 1024]];
  const [unit, per] = units.find(([, per]) => bytes >= per) ?? ["KB", 1024];
  const value = bytes / per;
  return `${ctx.num(value, value >= 10 || Number.isInteger(value) ? 0 : 1)} ${unit}`;
}

// One image, large, or one sound, to listen to, with what made it.
function viewer(ctx, ui, item, nameOf) {
  const { t, esc, money } = ctx;
  const sound = item.kind === "audio";
  const facts = [
    [t("route"), nameOf(item.route)],
    [t("model"), `<code class="br-keep">${esc(item.model ?? "")}</code>`],
    [t("when"), ctx.ago(item.ago)],
    [t("cost"), item.cost == null ? t("costUnknown") : money(item.cost)],
    [t("size"), size(ctx, item.bytes)],
  ];
  const download = item.src.startsWith("data:") ? item.src : `${item.src}?download=1`;
  const asking = ui.editing === "delete-media";
  return `
    <p class="br-actions"><button class="br-btn quiet" data-action="media" data-id=""${asking ? "" : " data-autofocus"}>${t(sound ? "sndBack" : "imgBack")}</button></p>
    ${sound
      ? `<audio class="br-audio" controls preload="metadata" src="${esc(item.src)}"></audio>`
      : `<figure class="br-shot"><img src="${esc(item.src)}" alt="${esc(item.prompt ?? "")}"></figure>`}
    ${item.prompt ? `<p class="br-prompt br-keep">${esc(item.prompt)}</p>` : ""}
    <dl class="br-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    ${asking
      ? `<p class="br-lead">${t(sound ? "sndDeleteAsk" : "imgDeleteAsk")}</p>
         <p class="br-actions"><button class="br-btn main danger" data-action="delete-media" data-id="${esc(item.id)}">${t(sound ? "sndDelete" : "imgDelete")}</button><button class="br-btn" data-action="edit" data-edit="" data-autofocus>${t("cancel")}</button></p>`
      : `<p class="br-actions"><a class="br-btn" href="${esc(download)}" download="baserouter-${esc(item.id)}">${t("imgDownload")}</a><button class="br-btn quiet danger" data-action="edit" data-edit="delete-media">${t(sound ? "sndDelete" : "imgDelete")}</button></p>`}`;
}
