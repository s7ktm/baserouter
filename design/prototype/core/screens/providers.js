// Providers: the list, and the flow that adds one (pick, paste the key, test).
import { sheet, chevron } from "./sheet.js";

export function providersSheet(ctx, ui) {
  const { t, esc, data } = ctx;
  const cards = data.providers.map((p) => {
    const down = p.status === "down";
    const line = ui.testing === p.id ? t("testingKey") : down ? t("provDown", { error: esc(p.error ?? "") }) : t("provUp", { n: p.models });
    return `<li class="br-card">
      <div class="br-cardhead"><i class="br-dot${down ? " stop" : ""}"></i><span class="br-keep">${esc(p.name)}</span></div>
      <p class="br-note">${line} ${p.keyHint ? t("keyEnds", { hint: esc(p.keyHint) }) : t("noKey")}</p>
      <p class="br-actions">
        <button class="br-btn" data-action="test-provider" data-id="${p.id}">${t("testAgain")}</button>
        <button class="br-btn quiet danger" data-action="remove-provider" data-id="${p.id}">${t("removeProvider")}</button>
      </p>
    </li>`;
  }).join("");

  return sheet(ctx, ui, {
    title: t("providers"),
    body: `${cards ? `<ul class="br-cards">${cards}</ul>` : `<p class="br-lead">${t("provNone")}</p>`}
      <p class="br-actions" style="margin-top:16px"><button class="br-btn main" data-action="go" data-screen="add-provider">+ ${t("addProvider")}</button></p>`,
  });
}

export function addProviderSheet(ctx, ui) {
  const { t, esc } = ctx;
  const kind = ctx.catalog.find((k) => k.kind === ui.kind);
  const kindName = kind && (kind.name ?? t("customName"));
  const step = ui.flow ? { n: 1, of: 3 } : null;
  let body;

  if (!kind || ui.step === "pick") {
    const left = ctx.catalog.filter((k) => !k.added);
    body = !left.length ? `<p class="br-lead">${t("allAdded")}</p>` : `<p class="br-lead">${t("pickSub")}</p>
      <ul class="br-choices">${left.map((k) => `<li><button class="br-choice" data-action="pick" data-kind="${k.kind}">
        <b class="br-keep">${esc(k.name ?? t("customName"))}</b><small>${t("k_" + k.kind)}</small>${chevron}</button></li>`).join("")}</ul>`;
  } else if (ui.step === "testing") {
    body = `<p class="br-busy"><i></i>${t("testingKey")}</p>`;
  } else if (ui.step === "ok") {
    body = `<p class="br-lead">${t("addOk", { name: esc(kindName), n: kind.models })}</p>
      <p class="br-actions" style="margin-top:18px">${ui.flow
        ? `<button class="br-btn main" data-action="go" data-screen="new-route" data-flow="1">${t("nextRoute")}</button>`
        : `<button class="br-btn main" data-action="close">${t("done")}</button>`}</p>`;
  } else {
    // "key", and "fail" which is the same form with what went wrong above it
    const needsAddress = Boolean(kind.address);
    const needsKey = kind.key !== false;
    body = `${ui.step === "fail" ? `<p class="br-banner" style="margin-top:16px">${t("addFail", { name: esc(kindName), error: esc(ui.error ?? "") })}</p>` : ""}
      <form class="br-form" data-form="provider">
        ${needsAddress ? `<label class="br-label" for="br-addr">${t("addressOf", { name: esc(kindName) })}</label>
          <input class="br-input wide br-keep" id="br-addr" name="address" type="url" value="${esc(kind.address)}" required ${needsKey ? "" : "data-autofocus"}>` : ""}
        ${needsKey ? `<label class="br-label" for="br-key">${t("pasteKey", { name: esc(kindName) })}</label>
          <input class="br-input wide br-keep" id="br-key" name="key" type="password" autocomplete="off" spellcheck="false" required data-autofocus>
          <p class="br-note" style="margin-top:8px">${kind.where ? t("whereKey", { where: `<span class="br-keep">${esc(kind.where)}</span>` }) + " " : ""}${t("keyStored")}</p>` : ""}
        <p class="br-actions" style="margin-top:16px">
          <button class="br-btn main" type="submit">${t("testAdd")}</button>
          <button class="br-btn" type="button" data-action="step" data-step="pick">${t("back")}</button>
        </p>
      </form>`;
  }

  return sheet(ctx, ui, { title: kind && ui.step !== "pick" ? esc(kindName) : t("addTitle"), keep: Boolean(kind) && ui.step !== "pick", step, body });
}
