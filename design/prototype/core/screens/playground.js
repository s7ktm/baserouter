// The playground: try a model as one of the routes, and see what comes back, without
// writing a client. A chat, an image, speech, a transcription or a video. The request is that
// route's in every way (its switch, its budget, its models, one row in its requests); what was
// asked and answered lives in this page only.
//
// It asks only for what every model of a kind needs: a message, a description, the words to
// speak, a sound file. Everything else a provider takes (sizes, voices, its own parameters) is
// the provider's; the gateway sends a body on as written, so those are sent with a client, and
// are not modelled here.
import { sheet, chevron } from "./sheet.js";
import { size } from "./activity.js";

// What can be tried, and what a model must make for it.
export const KINDS = ["chat", "image", "speech", "transcription", "video"];
const MAKES = { chat: "text", image: "image", speech: "speech", transcription: "transcription", video: "video" };

// How each kind is asked for: the field's words, the button, the form, and the note shown
// before anything was asked. A transcription is asked for with a file, not words.
const ASK = {
  chat: { field: "tryMessage", hint: "tryPlaceholder", button: "send", form: "try", note: "tryNote" },
  image: { field: "imageAsk", hint: "imageAsk", button: "makeImage", form: "try-image", note: "tryNoteImage" },
  speech: { field: "speechAsk", hint: "speechAsk", button: "makeSpeech", form: "try-speech", note: "tryNoteSpeech" },
  transcription: { button: "transcribe", form: "try-transcription", note: "tryNoteTranscription" },
  video: { field: "videoAsk", hint: "videoAsk", button: "makeVideo", form: "try-video", note: "tryNoteVideo" },
};

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
  const chat = kind === "chat";
  const how = ASK[kind];
  const turns = play.turns[kind];
  const running = Boolean(play.running);

  // The kinds this route has models for; one kind needs no tabs. More than three sit in two
  // even rows: five in one row leave too little room for their names.
  const tabs = kinds.length > 1
    ? `<div class="br-seg br-show br-try-kinds" style="--cols:${kinds.length > 3 ? Math.ceil(kinds.length / 2) : kinds.length}" role="group" aria-label="${t("tryKinds")}">${kinds.map((k) =>
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

  const draw = { chat: answer, image: made, speech: spoken, transcription: written, video: filmed }[kind];
  const list = turns.map((turn, i) => `
    <li class="br-turn">
      <p class="br-said br-keep">${esc(turn.ask)}</p>
      ${draw(ctx, turn, i)}
    </li>`).join("");

  const system = chat && (ui.editing === "system" || play.system)
    ? `<label class="br-label" for="br-system">${t("systemLabel")}</label>
       <textarea class="br-input wide br-area br-keep" id="br-system" rows="2" data-play="system" placeholder="${t("systemHint")}"${ui.editing === "system" ? " data-autofocus" : ""}>${esc(play.system)}</textarea>`
    : "";

  // A transcription asks for a file: the field itself is hidden behind a button that says
  // what was chosen, since drawing the sheet again would empty a file field. Until a file is
  // chosen, choosing one is the main thing to do; then sending it is.
  const file = play.file;
  const field = kind === "transcription"
    ? `<p class="br-try-file">
        <label class="br-btn${file ? "" : " main"} br-try-pick"><input type="file" class="br-try-input" accept="audio/*" data-play="file"${running ? " disabled" : ""}${ui.editing === "system" ? "" : " data-autofocus"}>${t(file ? "fileOther" : "fileChoose")}</label>
        ${file ? `<span class="br-keep br-try-chosen">${esc(file.name)}, ${size(ctx, file.size)}</span>` : ""}
      </p>`
    : `<textarea class="br-input wide br-area br-keep" id="br-draft" rows="2" data-play="draft" aria-label="${t(how.field)}" placeholder="${t(how.hint)}" required${ui.editing === "system" ? "" : " data-autofocus"}>${esc(play.draft[kind])}</textarea>`;

  const compose = blocked
    ? blocked
    : `<form class="br-form br-compose" data-form="${how.form}">
        ${system}
        ${field}
        <p class="br-actions">
          ${running
            ? `<button class="br-btn main" type="button" data-action="try-stop">${t("stop")}</button>`
            : kind === "transcription" && !file ? "" : `<button class="br-btn main" type="submit">${t(how.button)}</button>`}
          ${turns.length && !running ? `<button class="br-btn" type="button" data-action="try-clear">${t("startOver")}</button>` : ""}
          ${!chat || system ? "" : `<button class="br-btn quiet" type="button" data-action="edit" data-edit="system">${t("systemAdd")}</button>`}
        </p>
      </form>`;

  return sheet(ctx, ui, {
    title,
    sub: t("trySub"),
    body: `${tabs}${pickers}
      ${list ? `<ol class="br-turns">${list}</ol>` : blocked ? "" : `<p class="br-note br-try-note">${t(how.note)}</p>`}
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
  // An image the panel cannot show itself (a provider's link, when the route keeps nothing) is offered to open.
  const own = (src) => src.startsWith("data:") || src.startsWith("/");
  return `${turn.images.map((src) => own(src)
      ? `<figure class="br-shot br-try-shot"><img src="${esc(src)}" alt="${esc(turn.ask)}"></figure>`
      : `<p class="br-note">${t("imageLink")}</p><p class="br-actions"><a class="br-btn" href="${esc(src)}" target="_blank" rel="noopener noreferrer">${t("imageOpen")}</a></p>`).join("")}
    ${plain(ctx, turn, i)}
    ${kept(ctx, turn, "images", "seeImages", "imageNotKept")}`;
}

// Under what a route made: where it was kept, or that it is shown here only (as the route was
// when it asked).
function kept(ctx, turn, show, see, not) {
  const { t, esc } = ctx;
  return turn.kept
    ? `<button class="br-btn quiet br-try-kept" data-action="go" data-screen="activity" data-show="${show}" data-filter="${esc(turn.route)}">${t(see)}</button>`
    : `<p class="br-note">${t(not)}</p>`;
}

// The time an answer took, and its cost: what is known about everything but a chat.
const plain = (ctx, turn, i) => (turn.facts
  ? known(ctx, turn, i, [...who(ctx, turn.facts), cost(ctx, turn.facts), turn.facts.totalMs == null ? null : [ctx.t("took"), ctx.secs(turn.facts.totalMs / 1000)]])
  : "");

// Speech asked for: being made, made (a player), stopped or failed.
function spoken(ctx, turn, i) {
  const { t, esc } = ctx;
  if (turn.state === "waiting") return `<p class="br-busy" role="status"><i></i>${t("speechWaiting")}</p>`;
  if (turn.state === "failed") return `<p class="br-banner br-try-failed" role="alert">${turn.error ? t("actionFailed", { error: esc(turn.error) }) : t("speechNone")}</p>`;
  if (turn.state === "stopped") return `<p class="br-note">${t("tryStopped")}</p>`;
  return `<audio class="br-audio br-try-audio" src="${esc(turn.sound)}" controls preload="metadata" aria-label="${esc(turn.ask)}"></audio>
    ${plain(ctx, turn, i)}
    ${kept(ctx, turn, "sounds", "seeSounds", "speechNotKept")}`;
}

// A sound file written down: being written, written (the text), stopped or failed.
function written(ctx, turn, i) {
  const { t, esc } = ctx;
  if (turn.state === "waiting") return `<p class="br-busy" role="status"><i></i>${t("transcribeWaiting")}</p>`;
  if (turn.state === "failed") return `<p class="br-banner br-try-failed" role="alert">${turn.error ? t("actionFailed", { error: esc(turn.error) }) : t("transcribeNone")}</p>`;
  if (turn.state === "stopped") return `<p class="br-note">${t("tryStopped")}</p>`;
  return `<p class="br-answer br-keep">${esc(turn.text)}</p>${plain(ctx, turn, i)}`;
}

// A video asked for. It is made as a job that takes minutes, so while it is made the screen
// stays free: it says how long it has been, and that the job goes on without the page.
function filmed(ctx, turn, i) {
  const { t, esc } = ctx;
  if (turn.state === "waiting") {
    return `<p class="br-busy" role="status"><i></i>${t("videoWaiting")}</p>
      <p class="br-note br-try-elapsed" data-elapsed="${i}">${elapsed(ctx, turn)}</p>
      <p class="br-note">${t("videoWait")}</p>`;
  }
  if (turn.state === "failed") return `<p class="br-banner br-try-failed" role="alert">${turn.error ? t("actionFailed", { error: esc(turn.error) }) : t("videoNone")}</p>`;
  return `<figure class="br-shot br-film br-try-shot"><video src="${esc(turn.video)}" controls playsinline preload="metadata" aria-label="${esc(turn.ask)}"></video></figure>
    ${plain(ctx, turn, i)}
    ${kept(ctx, turn, "videos", "seeVideos", "videoNotKept")}`;
}

// How long a video has been in the making: "2 min 10 s so far".
export function elapsed(ctx, turn) {
  const s = Math.max(0, Math.floor(((turn.now ?? Date.now()) - turn.started) / 1000));
  return ctx.t(s < 60 ? "videoSoFarS" : "videoSoFarM", { m: Math.floor(s / 60), s: s % 60 });
}
