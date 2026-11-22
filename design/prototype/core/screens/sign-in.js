// Sign in: the one sheet that cannot be closed. On a new gateway it sets the password
// instead. Built once; every skin restyles it through the shared tokens.
import { sheet } from "./sheet.js";

export function signInSheet(ctx, ui) {
  const { t, esc } = ctx;
  const setup = ui.step === "setup";
  return sheet(ctx, ui, {
    title: t(setup ? "setupTitle" : "signInTitle"),
    fixed: true,
    body: `<p class="br-lead">${t(setup ? "setupLead" : "signInLead")}</p>
      ${ui.error ? `<p class="br-banner" role="alert" style="margin:16px 0 0">${esc(ui.error)}</p>` : ""}
      <form class="br-form" data-form="sign-in">
        <label class="br-label" for="br-password">${t("password")}</label>
        <input class="br-input wide br-keep" id="br-password" name="password" type="password" autocomplete="${setup ? "new-password" : "current-password"}"${setup ? ' minlength="8"' : ""} required data-autofocus>
        ${setup ? `<p class="br-note" style="margin-top:8px">${t("passwordHint")}</p>` : ""}
        <p class="br-actions" style="margin-top:16px"><button class="br-btn main" type="submit">${t(setup ? "setPassword" : "signIn")}</button></p>
      </form>`,
  });
}
