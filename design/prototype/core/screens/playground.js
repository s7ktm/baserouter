// The playground: try a model as one of the routes, and see what comes back, without
// writing a client. The request is that route's in every way (its switch, its budget, its
// models, one row in its requests); the conversation lives in this page only.
import { sheet, chevron } from "./sheet.js";

// The models a route may ask for that write text: its own list, or every model in BaseRouter.
export function textModels(data, route) {
  const writes = (name) => {
    const model = (data.models ?? []).find((m) => m.name === name);
    return !model || !model.makes?.length || model.makes.includes("text");
  };
  const names = route?.models?.length ? route.models : (data.models ?? []).map((m) => m.name);
  return names.filter(writes);
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

  const route = data.routes.find((r) => r.id === play.route) ?? data.routes[0];
  const status = ctx.status(route);
  const models = textModels(data, route);
  const model = models.includes(play.model) ? play.model : models[0];
  const running = play.turns.some((turn) => turn.state === "waiting" || turn.state === "streaming");

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

  const turns = play.turns.map((turn, i) => `
    <li class="br-turn">
      <p class="br-said br-keep">${esc(turn.ask)}</p>
      ${answer(ctx, turn, i)}
    </li>`).join("");

  const system = ui.editing === "system" || play.system
    ? `<label class="br-label" for="br-system">${t("systemLabel")}</label>
       <textarea class="br-input wide br-area br-keep" id="br-system" rows="2" data-play="system" placeholder="${t("systemHint")}"${ui.editing === "system" ? " data-autofocus" : ""}>${esc(play.system)}</textarea>`
    : "";

  const compose = blocked
    ? blocked
    : `<form class="br-form br-compose" data-form="try">
        ${system}
        <textarea class="br-input wide br-area br-keep" id="br-draft" rows="2" data-play="draft" aria-label="${t("tryMessage")}" placeholder="${t("tryPlaceholder")}" required${ui.editing === "system" ? "" : " data-autofocus"}>${esc(play.draft)}</textarea>
        <p class="br-actions">
          ${running
            ? `<button class="br-btn main" type="button" data-action="try-stop">${t("stop")}</button>`
            : `<button class="br-btn main" type="submit">${t("send")}</button>`}
          ${play.turns.length && !running ? `<button class="br-btn" type="button" data-action="try-clear">${t("startOver")}</button>` : ""}
          ${system ? "" : `<button class="br-btn quiet" type="button" data-action="edit" data-edit="system">${t("systemAdd")}</button>`}
        </p>
      </form>`;

  return sheet(ctx, ui, {
    title,
    sub: t("trySub"),
    body: `${pickers}
      ${turns ? `<ol class="br-turns">${turns}</ol>` : blocked ? "" : `<p class="br-note br-try-note">${t("tryNote")}</p>`}
      ${compose}`,
  });
}

// One answer: waiting for its first word, arriving, whole, cut short or failed. Under a
// whole answer, one quiet line (how long, how much) that opens the rest of what is known.
function answer(ctx, turn, i) {
  const { t, esc, play } = ctx;
  const text = `<p class="br-answer br-keep" data-answer="${i}">${esc(turn.text)}</p>`;
  if (turn.state === "waiting") return `<p class="br-busy" role="status"><i></i>${t("tryWaiting")}</p>`;
  if (turn.state === "streaming") return `${text}<p class="br-busy br-try-live"><i></i>${t("tryWriting")}</p>`;
  if (turn.state === "failed") {
    return `${turn.text ? text : ""}<p class="br-banner br-try-failed" role="alert">${turn.error ? t("actionFailed", { error: esc(turn.error) }) : t("tryBroke")}</p>`;
  }
  if (turn.state === "stopped") return `${turn.text ? text : ""}<p class="br-note">${t("tryStopped")}</p>`;

  const facts = turn.facts;
  if (!facts) return text;
  const open = play.open === i;
  const secs = (ms) => ctx.secs(ms / 1000);
  const cost = facts.cost == null ? t("costUnknown") : ctx.money(facts.cost);
  const short = [facts.totalMs == null ? null : secs(facts.totalMs), facts.cost == null ? null : ctx.money(facts.cost)].filter(Boolean).join(", ") || t("details");
  const rows = [
    [t("answeredBy"), `<code class="br-keep">${esc(facts.model ?? "")}</code>`],
    facts.provider ? [t("source"), `<span class="br-keep">${esc(facts.provider)}</span>`] : null,
    facts.promptTokens == null && facts.completionTokens == null ? null
      : [t("tokens"), t("tokensInOut", { in: ctx.num(facts.promptTokens ?? 0, 0), out: ctx.num(facts.completionTokens ?? 0, 0) })],
    [t("cost"), cost],
    facts.firstMs == null ? null : [t("firstWord"), secs(facts.firstMs)],
    facts.totalMs == null ? null : [t("wholeAnswer"), secs(facts.totalMs)],
  ].filter(Boolean);
  return `${text}
    <button class="br-try-more" data-action="try-facts" data-turn="${i}" aria-expanded="${open}" aria-label="${t("tryDetails")}: ${short}">${short}${chevron}</button>
    ${open ? `<dl class="br-facts br-try-facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}`;
}
