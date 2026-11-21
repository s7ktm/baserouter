// The frame every shared screen sits in: a sheet that rises from the bottom on a
// phone and sits in the middle on a wide screen.

export const cross = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
export const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

// step: { n, of } draws a progress bar and "Step n of m" above the title.
export function sheet(ctx, ui, { title, keep = false, sub = "", stop = false, right = "", step = null, body }) {
  const { t } = ctx;
  const steps = step
    ? `<div class="br-steps" aria-hidden="true">${Array.from({ length: step.of }, (_, i) => `<i${i < step.n ? ' class="on"' : ""}></i>`).join("")}</div>
       <p class="br-note">${t("stepOf", step)}</p>`
    : "";
  return `<div class="br-scrim" data-action="close" data-self="1">
  <div class="br-sheet${ui.entering ? " br-enter" : ""}" role="dialog" aria-modal="true" aria-labelledby="br-sheet-title">
    <div class="br-grab" aria-hidden="true"></div>
    ${steps}
    <header class="br-head">
      <h2 class="br-title${keep ? " br-keep" : ""}" id="br-sheet-title">${title}</h2>
      <button class="br-x" data-action="close" aria-label="${t("close")}">${cross}</button>
      ${sub || right ? `<p class="br-sub${stop ? " stop" : ""}">${sub}</p>${right || "<span></span>"}` : ""}
    </header>
    ${body}
  </div>
</div>`;
}

export function curl(address, model) {
  return `curl ${address}/chat/completions \\
  -H "Authorization: Bearer $BASEROUTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${model}", "messages": [{"role": "user", "content": "Hello"}]}'`;
}
