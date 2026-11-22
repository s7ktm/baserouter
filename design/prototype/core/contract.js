// What every skin must provide. A skin is free in how things look and where
// they sit; it is not free to skip a part, a mood or a language.

export const MOODS = ["happy", "busy", "worried", "sleepy"];

// icon: a 32 x 32 SVG string with fixed colours and its own xmlns. It is the favicon
// while the skin is active and the thumbnail in the skin picker.

// Each part is a function that returns an HTML string.
//   mascot(mood)        the character, in one of MOODS
//   provider(p, ctx)    one provider
//   route(r, ctx)       one route, in any status: on, busy, off, over
//   address(ctx)        the one address, with a copy control
//   spend(ctx)          today's spend
//   home(ctx)           the home screen, composed from the parts above
export const PARTS = ["mascot", "provider", "route", "address", "spend", "home"];

// Controls talk to the core through attributes, never through their own code:
//   data-action="toggle" data-id="<route id>"   switch a route on or off
//   data-action="copy"                          copy the address
//   data-action="open" data-id="<route id>"     open the route's detail; add data-edit="budget" to land on its budget form
// Every route offers both "toggle" and "open". The usual way is a button with class
// "br-stretch" that covers the route, with the switch lifted above it.
//   data-action="go" data-screen="<screen>"     open another screen: providers, add-provider, models, new-route, activity, settings
// Every skin offers a way to each of those six screens from its home screen.
export const SCREENS = ["providers", "add-provider", "new-route", "activity", "settings"];
export const ACTIONS = ["toggle", "copy", "open", "go"];

// Every skin's stylesheet defines these on :root. The screens that are built once
// (route detail, providers, activity, settings, first run) are drawn only with them.
export const TOKENS = [
  "--br-bg", "--br-surface", "--br-sunken", "--br-on-sunken", "--br-ink", "--br-ink-2", "--br-line",
  "--br-action", "--br-on-action", "--br-on", "--br-busy", "--br-ok", "--br-stop", "--br-on-stop",
  "--br-radius-s", "--br-radius-m", "--br-radius-l", "--br-stroke",
  "--br-font-display", "--br-font-body", "--br-font-code", "--br-code-size", "--br-case",
];

// Run against a document that has the skin's stylesheet loaded.
export function missingTokens(doc) {
  const style = doc.defaultView.getComputedStyle(doc.documentElement);
  return TOKENS.filter((token) => !style.getPropertyValue(token).trim());
}

export function checkSkin(skin) {
  const problems = [];
  if (!/^[a-z][a-z0-9-]*$/.test(skin?.id ?? "")) problems.push("id must be lowercase letters, digits and dashes");
  for (const lang of ["en", "tr"]) if (!skin?.name?.[lang]) problems.push(`name.${lang} is missing`);
  for (const part of PARTS) if (typeof skin?.[part] !== "function") problems.push(`${part}() is missing`);
  if (typeof skin?.icon !== "string" || !skin.icon.includes("<svg") || !skin.icon.includes("xmlns=")) problems.push("icon must be an SVG string with xmlns");
  else if (/var\(/.test(skin.icon)) problems.push("icon must use fixed colours, not variables");

  const en = Object.keys(skin?.strings?.en ?? {});
  const tr = Object.keys(skin?.strings?.tr ?? {});
  for (const key of en) if (!tr.includes(key)) problems.push(`strings.tr.${key} is missing`);
  for (const key of tr) if (!en.includes(key)) problems.push(`strings.en.${key} is missing`);

  if (typeof skin?.mascot === "function") {
    for (const mood of MOODS) {
      try {
        if (!skin.mascot(mood)) problems.push(`mascot("${mood}") returns nothing`);
      } catch {
        problems.push(`mascot("${mood}") throws`);
      }
    }
  }
  return problems;
}
