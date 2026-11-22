// The playground: try a model as one of the routes, and see what comes back, without
// writing a client. A chat, or an image. The request is that route's in every way (its switch,
// its budget, its models, one row in its requests); a conversation lives in this page only.
//
// It asks only for what every model of a kind needs: a message, a description of an image.
// Everything else a provider takes (sizes, masks, its own parameters) is the provider's; the
// gateway sends a body on as written, so those are sent with a client, and are not modelled here.
import { sheet, chevron } from "./sheet.js";

// What can be tried, and what a model must make for it.
export const KINDS = ["chat", "image"];
const MAKES = { chat: "text", image: "image" };

// The models a route may ask for that make a kind: from its own list, or every model in
// BaseRouter. A model whose kind is not known counts as one that writes text.
export function modelsFor(data, route, kind) {
  const fits = (name) => {
    const model = (data.models ?? []).find((m) => m.name === name);
    return !model || !model.makes?.length ? kind === "chat" : model.makes.includes(MAKES[kind]);
  };
  const names = route?.models?.length ? route.models : (data.models ?? []).map((m) => m.name);
  return names.filter(fits);
}

// What the playground is set to right now: the route, the kinds it has models for, the kind
// and the model chosen. The screen and the actions both read it from here.
export function playNow(data, play) {
  const route = data.routes.find((r) => r.id === play.route) ?? data.routes[0] ?? null;
  const kinds = route ? KINDS.filter((kind) => modelsFor(data, route, kind).length) : [];
  const kind = kinds.includes(play.kind) ? play.kind : kinds[0] ?? "chat";
  const models = route ? modelsFor(data, route, kind) : [];
  return { route, kinds, kind, models, model: models.includes(play.model) ? play.model : models[0] ?? null };
}

export function playgroundSheet(ctx, ui) {
  const { t, esc, data, play } = ctx;
  const title = t("tryTitle");

  if (!data.routes.length) {
    return sheet(ctx, ui, {
      title,
      body: `<p class="br-lead">${t("tryNoRoute")}</p>
        <p class="br-actions" style="margin-top:16px"><button class="br-btn main" data-action="go" data-screen="new-route">+ ${t("newRoute")}</button></p>`,
    });
  }

  const { route, kinds, kind, models, model } = playNow(data, play);
  const status = ctx.status(route);
  const image = kind === "image";
  const turns = play.turns[kind];
  const running = Boolean(play.running);

  // The kinds this route has models for; one kind needs no tabs.
  const tabs = kinds.length > 1
    ? `<div class="br-seg br-show" role="group" aria-label="${t("tryKinds")}">${kinds.map((k) =>
        `<button data-action="try-kind" data-kind="${k}" aria-pressed="${k === kind}"${running ? " disabled" : ""}>${t(`try_${k}`)}</button>`).join("")}</div>`
    : "";

  const pickers = `
    <div class="br-try-who">
      <label><span class="br-label">${t("route")}</span>
        <span class="br-select"><select class="br-input wide br-keep" data-play="route"${running ? " disabled" : ""}>
          ${data.routes.map((r) => `<option value="${esc(r.id)}"${r.id === route.id ? " selected" : ""}>${ctx.name(r)}</option>`).join("")}
        </select></span></label>
      ${models.length
        ? `<label><span class="br-label">${t("model")}</span>
        <span class="br-select"><select class="br-input wide br-keep" data-play="model"${running ? " disabled" : ""}>
          ${models.map((name) => `<option value="${esc(name)}"${name === model ? " selected" : ""}>${esc(name)}</option>`).join("")}
        </select></span></label>`
        : ""}
    </div>`;

  // What stands in the way of a request, said before one is sent: the gateway would refuse it.
  const blocked = status === "over"
    ? `<p class="br-banner" style="margin:16px 0 0">${t("overNote")}</p>
       <p class="br-actions"><button class="br-btn main" data-action="open" data-id="${esc(route.id)}" data-edit="budget">${t("raiseBudget")}</button></p>`
    : status === "off"
      ? `<p class="br-callout">${t("tryOff")}</p>
         <p class="br-actions"><button class="br-btn main" data-action="toggle" data-id="${esc(route.id)}">${t("switchOn")}</button></p>`
      : !models.length
        ? `<p class="br-callout">${t("tryNoModel")}</p>
           <p class="br-actions"><button class="br-btn main" data-action="open" data-id="${esc(route.id)}" data-edit="model">${t("allowModel")}</button></p>`
        : "";

  const list = turns.map((turn, i) => `
    <li class="br-turn">
      <p class="br-said br-keep">${esc(turn.ask)}</p>
      ${image ? made(ctx, turn, i) : answer(ctx, turn, i)}
    </li>`).join("");

  const system = !image && (ui.editing === "system" || play.system)
    ? `<label class="br-label" for="br-system">${t("systemLabel")}</label>
       <textarea class="br-input wide br-area br-keep" id="br-system" rows="2" data-play="system" placeholder="${t("systemHint")}"${ui.editing === "system" ? " data-autofocus" : ""}>${esc(play.system)}</textarea>`
    : "";

  const compose = blocked
    ? blocked
    : `<form class="br-form br-compose" data-form="${image ? "try-image" : "try"}">
        ${system}
        <textarea class="br-input wide br-area br-keep" id="br-draft" rows="2" data-play="draft" aria-label="${t(image ? "imageAsk" : "tryMessage")}" placeholder="${t(image ? "imageAsk" : "tryPlaceholder")}" required${ui.editing === "system" ? "" : " data-autofocus"}>${esc(play.draft[kind])}</textarea>
        <p class="br-actions">
          ${running
            ? `<button class="br-btn main" type="button" data-action="try-stop">${t("stop")}</button>`
            : `<button class="br-btn main" type="submit">${t(image ? "makeImage" : "send")}</button>`}
          ${turns.length && !running ? `<button class="br-btn" type="button" data-action="try-clear">${t("startOver")}</button>` : ""}
          ${image || system ? "" : `<button class="br-btn quiet" type="button" data-action="edit" data-edit="system">${t("systemAdd")}</button>`}
        </p>
      </form>`;

  return sheet(ctx, ui, {
    title,
    sub: t("trySub"),
    body: `${tabs}${pickers}
      ${list ? `<ol class="br-turns">${list}</ol>` : blocked ? "" : `<p class="br-note br-try-note">${t(image ? "tryNoteImage" : "tryNote")}</p>`}
      ${compose}`,
  });
}

// The quiet line under a finished answer (how long, how much), and the rest of what is
// known about it, which the line opens in place.
function known(ctx, turn, i, rows) {
  const { t, play } = ctx;
  const facts = turn.facts;
  if (!facts) return "";
  const open = play.open === i;
  const short = [facts.totalMs == null ? null : ctx.secs(facts.totalMs / 1000), facts.cost == null ? null : ctx.money(facts.cost)].filter(Boolean).join(", ") || t("details");
  return `<button class="br-try-more" data-action="try-facts" data-turn="${i}" aria-expanded="${open}" aria-label="${t("tryDetails")}: ${short}">${short}${chevron}</button>
    ${open ? `<dl class="br-facts br-try-facts">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}`;
}

// What every kind knows about its answer: the model and the provider that answered, and its cost.
function who(ctx, facts) {
  const { t, esc } = ctx;
  return [
    [t("answeredBy"), `<code class="br-keep">${esc(facts.model ?? "")}</code>`],
    facts.provider ? [t("source"), `<span class="br-keep">${esc(facts.provider)}</span>`] : null,
  ];
}
const cost = (ctx, facts) => [ctx.t("cost"), facts.cost == null ? ctx.t("costUnknown") : ctx.money(facts.cost)];

// One answer: waiting for its first word, arriving, whole, cut short or failed.
function answer(ctx, turn, i) {
  const { t, esc } = ctx;
  const text = `<p class="br-answer br-keep" data-answer="${i}">${esc(turn.text)}</p>`;
  if (turn.state === "waiting") return `<p class="br-busy" role="status"><i></i>${t("tryWaiting")}</p>`;
  if (turn.state === "streaming") return `${text}<p class="br-busy br-try-live"><i></i>${t("tryWriting")}</p>`;
  if (turn.state === "failed") {
    return `${turn.text ? text : ""}<p class="br-banner br-try-failed" role="alert">${turn.error ? t("actionFailed", { error: esc(turn.error) }) : t("tryBroke")}</p>`;
  }
  if (turn.state === "stopped") return `${turn.text ? text : ""}<p class="br-note">${t("tryStopped")}</p>`;
  const facts = turn.facts;
  if (!facts) return text;
  const secs = (ms) => ctx.secs(ms / 1000);
  return `${text}
    ${known(ctx, turn, i, [
      ...who(ctx, facts),
      facts.promptTokens == null && facts.completionTokens == null ? null
        : [t("tokens"), t("tokensInOut", { in: ctx.num(facts.promptTokens ?? 0, 0), out: ctx.num(facts.completionTokens ?? 0, 0) })],
      cost(ctx, facts),
      facts.firstMs == null ? null : [t("firstWord"), secs(facts.firstMs)],
      facts.totalMs == null ? null : [t("wholeAnswer"), secs(facts.totalMs)],
    ])}`;
}

// One image asked for: being made, made, stopped or failed. Under it, whether the route
// that asked for it kept it (as it was when it asked).
function made(ctx, turn, i) {
  const { t, esc } = ctx;
  if (turn.state === "waiting") return `<p class="br-busy" role="status"><i></i>${t("imageWaiting")}</p>`;
  if (turn.state === "failed") return `<p class="br-banner br-try-failed" role="alert">${turn.error ? t("actionFailed", { error: esc(turn.error) }) : t("imageNone")}</p>`;
  if (turn.state === "stopped") return `<p class="br-note">${t("tryStopped")}</p>`;
  const facts = turn.facts;
  return `${turn.images.map((src) => `<figure class="br-shot br-try-shot"><img src="${esc(src)}" alt="${esc(turn.ask)}"></figure>`).join("")}
    ${facts ? known(ctx, turn, i, [...who(ctx, facts), cost(ctx, facts), facts.totalMs == null ? null : [t("took"), ctx.secs(facts.totalMs / 1000)]]) : ""}
    ${turn.kept
      ? `<button class="br-btn quiet br-try-kept" data-action="go" data-screen="activity" data-show="images" data-filter="${esc(turn.route)}">${t("seeImages")}</button>`
      : `<p class="br-note">${t("imageNotKept")}</p>`}`;
}
