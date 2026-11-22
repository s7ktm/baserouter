// Activity: every request, newest first, with one filter: which route. Three more tabs show
// what routes made and the gateway kept: images in a grid, sounds in a list, videos in a grid
// of frames. One of them can be opened, looked at, listened to or watched, downloaded or deleted.
import { sheet } from "./sheet.js";

const play = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

export function activitySheet(ctx, ui) {
  const { t, esc, data, money } = ctx;
  const filter = data.routes.some((r) => r.id === ui.filter) ? ui.filter : "";
  const show = ["images", "sounds", "videos"].includes(ui.show) ? ui.show : "requests";
  const nameOf = (id) => {
    const route = data.routes.find((r) => r.id === id);
    return route ? ctx.name(route) : t("removedRoute");
  };
  const chip = (id, label) => `<button class="br-chip${id ? " br-keep" : ""}" data-action="filter" data-route="${id}" aria-pressed="${id === filter}">${label}</button>`;
  const chips = `<div class="br-chips">${chip("", t("allRoutes"))}${data.routes.map((r) => chip(r.id, ctx.name(r))).join("")}</div>`;
  const tab = (id, label) => `<button data-action="show" data-show="${id}" aria-pressed="${show === id}">${label}</button>`;
  const tabs = `<div class="br-seg br-show" role="group" aria-label="${t("activity")}">${tab("requests", t("requestsTab"))}${tab("images", t("imagesTab"))}${tab("sounds", t("soundsTab"))}${tab("videos", t("videosTab"))}</div>`;

  // The words of each kept kind: its tab, none at all, none from this route.
  const words = { images: ["imagesTab", "imgNone", "imgNoneFor"], sounds: ["soundsTab", "sndNone", "sndNoneFor"], videos: ["videosTab", "vidNone", "vidNoneFor"] }[show];
  const items = show === "requests" ? null : (data[show] ?? []);
  const open = items?.find((i) => i.id === ui.media);
  if (open) return sheet(ctx, ui, { title: t(words[0]), sub: mediaSub(ctx), body: viewer(ctx, ui, open, nameOf) });

  let body;
  if (items) {
    const rows = items.filter((i) => !filter || i.route === filter);
    const none = data.mediaSpace?.keeping === false ? "mediaOff" : words[1];
    body = !items.length
      ? `${tabs}<p class="br-lead">${t(none)}</p>`
      : `${tabs}${chips}
         ${!rows.length
           ? `<p class="br-lead">${t(words[2])}</p>`
           : show === "videos"
             ? `<ul class="br-grid br-films">${rows.map((i) => `<li><button class="br-thumb br-film-thumb" data-action="media" data-id="${esc(i.id)}" aria-label="${esc(i.prompt || t("videosTab"))}, ${nameOf(i.route)}, ${ctx.ago(i.ago)}">
                 <video src="${esc(frame(i.src))}" muted playsinline preload="metadata" tabindex="-1" aria-hidden="true"></video><i class="br-play">${play}</i></button></li>`).join("")}</ul>`
           : show === "images"
             ? `<ul class="br-grid">${rows.map((i) => `<li><button class="br-thumb" data-action="media" data-id="${esc(i.id)}" aria-label="${esc(i.prompt || t("imagesTab"))}, ${nameOf(i.route)}, ${ctx.ago(i.ago)}">
                 <img src="${esc(i.src)}" alt="" loading="lazy" decoding="async"></button></li>`).join("")}</ul>`
             : `<ul class="br-list br-sounds">${rows.map((i) => `<li><button class="br-sound" data-action="media" data-id="${esc(i.id)}">
                 <i class="br-play">${play}</i>
                 <span><strong class="br-keep">${esc(i.prompt || t("soundsTab"))}</strong><code class="br-keep">${esc(i.model ?? "")}</code><small>${nameOf(i.route)} · ${ctx.ago(i.ago)}</small></span>
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

// "4 images, 2 sounds, 1 video: 3.4 MB of 1 GB". Images, sound and video share the room.
function mediaSub(ctx) {
  const space = ctx.data.mediaSpace;
  if (!space?.images && !space?.sounds && !space?.videos) return "";
  const n = (count) => ctx.num(count ?? 0, 0);
  return ctx.t("mediaSub", { images: n(space.images), sounds: n(space.sounds), videos: n(space.videos), size: size(ctx, space.bytes), max: size(ctx, space.max) });
}

// A video's first frame, for its tile: a browser shows nothing until it has a moment to show.
const frame = (src) => (src.startsWith("data:") || src.includes("#") ? src : `${src}#t=0.1`);

function size(ctx, bytes) {
  const units = [["GB", 1024 ** 3], ["MB", 1024 ** 2], ["KB", 1024]];
  let at = units.findIndex(([, per]) => bytes >= per);
  if (at < 0) at = units.length - 1;
  // 1,013 KB reads better as 1 MB: a number that would show four digits moves up a unit.
  if (at > 0 && bytes / units[at][1] >= 999.5) at--;
  const [unit, per] = units[at];
  const value = bytes / per;
  return `${ctx.num(value, value >= 10 || Number.isInteger(Math.round(value * 10) / 10) ? 0 : 1)} ${unit}`;
}

// One image, large, one sound to listen to, or one video to watch, with what made it.
function viewer(ctx, ui, item, nameOf) {
  const { t, esc, money } = ctx;
  const sound = item.kind === "audio";
  const film = item.kind === "video";
  // back, delete, the question before deleting
  const [back, del, ask] = film ? ["vidBack", "vidDelete", "vidDeleteAsk"] : sound ? ["sndBack", "sndDelete", "sndDeleteAsk"] : ["imgBack", "imgDelete", "imgDeleteAsk"];
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
    <p class="br-actions"><button class="br-btn quiet" data-action="media" data-id=""${asking ? "" : " data-autofocus"}>${t(back)}</button></p>
    ${sound
      ? `<audio class="br-audio" controls preload="metadata" src="${esc(item.src)}"></audio>`
      : film
        ? `<figure class="br-shot br-film"><video src="${esc(frame(item.src))}" controls playsinline preload="metadata" aria-label="${esc(item.prompt || t("videosTab"))}"></video></figure>`
        : `<figure class="br-shot"><img src="${esc(item.src)}" alt="${esc(item.prompt ?? "")}"></figure>`}
    ${item.prompt ? `<p class="br-prompt br-keep">${esc(item.prompt)}</p>` : ""}
    <dl class="br-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    ${asking
      ? `<p class="br-lead">${t(ask)}</p>
         <p class="br-actions"><button class="br-btn main danger" data-action="delete-media" data-id="${esc(item.id)}">${t(del)}</button><button class="br-btn" data-action="edit" data-edit="" data-autofocus>${t("cancel")}</button></p>`
      : `<p class="br-actions"><a class="br-btn" href="${esc(download)}" download="baserouter-${esc(item.id)}">${t("imgDownload")}</a><button class="br-btn quiet danger" data-action="edit" data-edit="delete-media">${t(del)}</button></p>`}`;
}
