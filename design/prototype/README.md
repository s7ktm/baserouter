# Skin prototype

BaseRouter ships with more than one look. Each look is a **skin**: it is free in how things are drawn and where they sit, and all skins run on the same state and the same actions.

```bash
bun design/serve.ts
```

- http://127.0.0.1:4173/prototype/ — the home screen, with a skin picker
- http://127.0.0.1:4173/prototype/check.html — every skin in every state, and whether it meets the contract

The gateway serves only the panel itself (`index.html`, `core/`, `skins/`, `fonts/`); the design pages here (`check.html`, `mascots.html`, `cover.html`, `frame.html`) are opened through `bun design/serve.ts`.
- http://127.0.0.1:4173/prototype/mascots.html — every mascot in every mood, both themes, and at small sizes
- http://127.0.0.1:4173/prototype/cover.html — the README and social cover

`sh design/screenshots/make.sh` turns the cover and six phone views into images (`design/brand/cover.png`, `design/screenshots/`). It needs the server running and Google Chrome; `frame.html` is the phone-sized frame it photographs through.

URL parameters for `index.html`:

| Parameter | Values |
|---|---|
| `skin` | `socket`, `display`, `home` |
| `state` | `default`, `calm`, `empty`, `stress` (worst case: 40 routes, very long names, huge and zero amounts). Always made-up data, also when a gateway serves the page |
| `lang`, `theme` | `en`, `tr`; `light`, `dark`, `auto` |
| `route` | A route id: opens its detail. With `edit=budget`, `edit=model`, `edit=key` or `edit=delete`, on that form or question; `edit=key&step=made` shows a new key |
| `screen` | `providers`, `add-provider`, `models`, `new-route`, `activity`, `settings`, `playground`, and `sign-in` on made-up data |
| `models=none` | Leaves BaseRouter without models, for a new route that has none to choose from |
| `find`, `makes` | While choosing a model (`route=<id>&edit=model`, or `screen=new-route&edit=model` with the field open): the search, and the kind, `text`, `image`, `speech`, `transcription` or `video` |
| `step` | For `add-provider`: `pick`, `key`, `testing`, `ok`, `fail`, with `kind` (for example `kind=openrouter`). For `new-route`: `made`, `arrived`. For `sign-in`: `login`, `setup`, `fail` |
| `flow=1` | Shows a flow as part of the first run, with numbered steps |
| `filter` | For `activity`: a route id |
| `show` | For `activity`: `images`, `sounds` or `videos`, what was kept, instead of the requests |
| `media` | For `activity`: an image, sound or video id (`i1` to `i5`, `a1` to `a3` and `v1` to `v3` on the default data) opens it; with `edit=delete-media`, on the question before it is deleted |
| `edit=password` | For `settings`: the password form |
| `as`, `kind`, `model` | For `playground`: the route that asks (`as=news` is over its budget, `as=garden` is switched off, `as=home` has a model that makes images), what is tried (`chat` or `image`), and the model it asks for |
| `step`, `detail=1` | For `playground`, on made-up data: an answer that is `waiting` for its first word, `streaming`, `done`, `stopped` or `fail` (an image: `waiting`, `done`, `stopped`, `fail`); with `detail=1` a finished one's details are open. `edit=system` shows the system message field. `state=empty&screen=playground` is the playground with no route yet |
| `bar=0` | Hides the picker bar |

## What is shared

| File | Holds |
|---|---|
| `core/data.js` | The made-up data: address, spend, providers, routes, requests, kept images, sounds and videos, and the provider's models. Its shape is what every skin draws from |
| `core/videos/` | Three short clips of moving colour, the made-up videos, made with ffmpeg so nothing is loaded from elsewhere |
| `core/live.js` | Talks to the gateway, and turns its state into the shape of `data.js` |
| `core/app.js` | State, actions, language, theme, shared words, skin loading |
| `core/contract.js` | What a skin must provide, and the check for it |
| `core/shared.css` | Styles for the screens that are built once. Uses only the shared `--br-*` tokens |
| `core/screens/` | Those screens: route detail, providers and adding one, models, new route, activity, the playground, settings, sign in. `sheet.js` is the frame they share |
| `fonts/` | Every skin's typefaces and their licences, so nothing is loaded from a third party |
| `core/words.js` | The shared words, in English and Turkish |
| `skins/registry.js` | The list of skins |

A skin's own words (`strings`) apply to its home screen only; shared screens always use the shared words. A skin never stores data and never handles a click itself. It marks its controls and the core does the rest:

- `data-action="toggle" data-id="<route id>"` switches a route on or off
- `data-action="copy"` copies the address
- `data-action="open" data-id="<route id>"` opens the route's detail; add `data-edit="budget"` to land on its budget form
- `data-action="go" data-screen="<screen>"` opens `providers`, `add-provider`, `models`, `new-route`, `activity`, `settings` or `playground`. Every skin offers a way to all seven from its home screen

Every route offers both `toggle` and `open`. The usual way is a button with class `br-stretch` that covers the whole route, with the skin's switch lifted above it by `position: relative; z-index: 1`.

## What a skin provides

A folder `skins/<id>/` with `skin.css`, `skin.js` and `mascot.js`. The stylesheet draws the skin's home screen and defines the shared `--br-*` tokens on `:root` (listed in `DESIGN.md`); `check.html` names any that are missing. The mascot lives in its own file so the mascot sheet and the cover can use it without the rest of the skin. The default export of `skin.js` has:

| Member | Purpose |
|---|---|
| `id`, `name.en`, `name.tr` | Identity |
| `fonts` | A stylesheet for its typefaces, in `fonts/`, or `null` |
| `strings.en`, `strings.tr` | Its own words, same keys in both languages |
| `mascot(mood)` | The character, for each mood: `happy`, `busy`, `worried`, `sleepy` |
| `icon` | A 32 × 32 SVG string with fixed colours and its own `xmlns`: the tab icon and the picker thumbnail |
| `provider(p, ctx)` | One provider |
| `route(r, ctx)` | One route, in every status: `on`, `busy`, `off`, `over` |
| `address(ctx)` | The one address, with a copy control |
| `spend(ctx)` | Today's spend |
| `home(ctx)` | The home screen, composed from the parts above |

Each function returns an HTML string. `ctx` carries the data, the counts, the mood, and helpers for words (`t`), money, names and percentages; see `context()` in `core/app.js`.

A part may be as small or as large as the skin wants. In Display a provider is one square on the status line; in Socket it is a plug with a cable.

## Adding a skin

1. Copy the skin closest to what you have in mind into `skins/<your-id>/`.
2. Change `id` and `name`, then redraw.
3. Add the id to `skins/registry.js`.
4. Open `check.html`. The skin must meet the contract and hold up in every view, both languages and both themes. Then open `index.html?skin=<your-id>&state=stress`: nothing may be cut, overlap or scroll sideways.
5. Open `mascots.html`. The four moods must be distinguishable at 32 px.

## Made-up data and the real thing

This folder is also the panel the gateway ships. Served by the gateway (`cd gateway && bun start`, then http://localhost:4141/), it asks for the password, draws the gateway's real state, sends every change to the gateway's `/api`, and looks again every three seconds. The picker bar is hidden there; the look, theme and language are in settings.

Served by `bun design/serve.ts`, or opened with `?state=...` anywhere, it runs on the made-up data in `core/data.js` and nothing is saved. A provider test always succeeds, any key is accepted unless it contains `bad`, any password signs in, and the first request to a new route "arrives" by itself after three seconds.

In the playground, on made-up data, every message is answered with the same made-up sentence, word by word, every image asked for is the same made-up picture, and nothing is sent anywhere.

On made-up data a new key is always the same, export saves the made-up data, and signing out asks for a password that any password answers.
