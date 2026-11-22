# BaseRouter — Design

BaseRouter ships with several looks, called **skins**. This document has two halves: the rules every skin obeys, and the three skins that exist today. What the product is and who it is for is in [PRODUCT.md](PRODUCT.md). How a skin is built, file by file, is in [design/prototype/README.md](design/prototype/README.md).

A skin decides how things look and where they sit. It does not decide what the product does, what a status means, or what the words promise.

## Rules for every skin

### The home screen

- No sidebar and no menu tree. One column on a phone; from 980 px the same structure gets more room. Content is never wider than 1120 px.
- On a 390 × 844 screen, without scrolling, a person sees the one address, today's spend, and the state of at least the first two routes.
- A route can be switched on or off from the home screen, without opening it.
- Every route has exactly two targets: its switch turns it on or off, and pressing it anywhere else opens its detail. This is the same in every skin.
- The overall state is said in one short line that counts what is on and what needs a look. It never says "all good" while a provider is unreachable or a route is stopped.

### Statuses

Each status looks different in shape or position, never in colour alone.

| Status | Means | Socket | Display | Home |
|---|---|---|---|---|
| **on** | Route accepts requests | Rocker lit, eyes open, green lamp | Blue lamp lit, key raised, slide switch to the right | Room lit yellow, switch to the right |
| **busy** | A request is running now | Lamp blinks yellow, mouth open | Lamp blinks | Three hopping dots, "working now" |
| **off** | Switched off by the person | Rocker dark, eyes closed, grey label | Key lowered, lamp dark, slide switch to the left, readout `-.--` | Room unlit, switch to the left |
| **over** | Stopped because the budget is used up | Rocker dark, frown, full meter, "Breaker tripped" | Readout inverted, hollow blinking lamp, "full" | Tomato outline, "Full" tag, no switch |
| **provider up / down** | Provider reachable or not | Plug seated / plug pulled and tilted | Filled square / hollow square | Green dot / hollow ring and "unreachable" |

An **over** route cannot be switched on; the way out is to raise its budget.

### The mascot

Every skin has one character with four moods. The core picks the mood; the skin only draws it.

| Mood | When |
|---|---|
| `sleepy` | Nothing is set up yet, or no route is on |
| `worried` | A provider is unreachable or a route is over budget |
| `busy` | A request is running and nothing needs attention |
| `happy` | Routes are on and nothing needs attention |

The mascot stays at the edge of the screen: the header, an empty state, the status display. It never sits on top of numbers and never replaces a label.

How a mascot is made:

- Drawn by hand as SVG, from few shapes, so anyone can open the file and change it.
- Each mood changes the pose or the silhouette, not only the mouth, so the moods can be told apart at 32 px.
- Colours come from the skin's variables, each with its light-theme value as a fallback, so the drawing also works on a page with no skin loaded.
- Every skin also has an **icon**: a 32 × 32 SVG with fixed colours. It is the browser tab icon while that skin is active and the thumbnail in the skin picker.

All mascots, moods and sizes are on `design/prototype/mascots.html`.

### Numbers

- Spend always has two decimals: `$1.24`. A budget drops them when it is whole: `$25`. A cost under one cent has three: `$0.004`. A cost under a tenth of a cent keeps two significant digits, so it never reads as nothing: `$0.000021`.
- Numbers follow the interface language: `$12,345.67` in English, `$12.345,67` in Turkish. Thousands are always grouped.
- A big number shrinks to fit its place; it never pushes a control off the screen and is never cut.
- Figures that change or line up use tabular numerals.
- The currency sign belongs to the number. It is never a separate decorated element that could be read as something else.

### Words

- Sentence case everywhere. No all-caps labels, no labels above things that explain themselves.
- No strings joined with middle dots, no "word — fragment" labels, no arrows on buttons.
- A control is named by what it does, and keeps that name through the flow: "Copy" becomes "Copied".
- An error says what happened and what to do. It does not apologise.
- Every string exists in English and Turkish. Turkish strings never attach a suffix to an inserted name or number; reword the sentence instead (`Sigorta attı: $3 / $3`, not `$3'te sigorta attı`).
- A skin may use its own vocabulary for its metaphor ("Breaker tripped", "The address on the door") on its home screen. The plain meaning must still be readable from the same line. Shared screens always use the shared words, in every skin.

### Touch, focus, motion

- Every control is at least 44 × 44 px. A control drawn smaller than that (a slide switch, a wall switch) extends its touch area invisibly.
- Keyboard focus is always visible, drawn in the skin's own ink or accent.
- Motion only answers an action or shows live work (the busy state). A state change takes 200 ms or less. Nothing animates when the page loads.
- `prefers-reduced-motion` switches all of it off.

### Worst case

A skin is not finished until it holds with `?state=stress`: 40 routes, a 75-character name, a one-letter name, a 43-letter word with no place to break, amounts from `$0.00` to `$98,765.43`, seven providers and a long address.

- Names are cut with an ellipsis after one line (Socket) or two (Display, Home). The full name is in the route's detail.
- Nothing scrolls sideways except rows made for it: Socket's plugs, Home's provider pills, the route filter in activity, and code.
- With 40 routes, the ways to providers, activity, settings and a new route stay within reach: Display's function keys and Home's bar stay on screen, and Home lists providers above routes.

### Contrast

Text is at least 4.5 : 1 against what it sits on. Marks that carry state (lamps, dots, outlines, meter fills) are at least 3 : 1. Measured values for the current skins are at the end of each skin's section.

### Not allowed in any skin

- Gradients or glows used as decoration. A glow is allowed only where something is literally lit: a lamp, a lit switch, a backlit screen.
- A second accent colour added "for variety".
- Technical vocabulary on the surface: virtual key, deployment, model group, upstream.
- Charts on the home screen beyond one small seven-day bar.
- Anything that needs hover to be understood.
- Typefaces fetched from a third party. They are bundled in `design/prototype/fonts/`.

## Shared tokens

Route detail, providers, activity, settings and first run are built once. Skins do not redraw them; they restyle them through these custom properties, which every skin's stylesheet defines on `:root` for both themes. `design/prototype/check.html` reports any that are missing.

| Token | Used for |
|---|---|
| `--br-bg` | Page background |
| `--br-surface` | Raised panels, sheets, list rows |
| `--br-sunken`, `--br-on-sunken` | Fields and readouts, and the text inside them |
| `--br-ink`, `--br-ink-2` | Main text, supporting text |
| `--br-line` | Dividers and outlines |
| `--br-action`, `--br-on-action` | The main action on a screen, and its label |
| `--br-on` | "This route is on" |
| `--br-busy` | "A request is running" |
| `--br-ok` | "This provider is reachable" |
| `--br-stop`, `--br-on-stop` | "This needs attention", and text placed on it |
| `--br-radius-s`, `-m`, `-l` | Controls; fields and small panels; large panels |
| `--br-stroke` | Outline width: `0px` where shape comes from shading, a real width where it comes from line |
| `--br-font-display`, `-body`, `-code` | Headings and names; running text; addresses, keys, readouts |
| `--br-code-size` | Size of the code face, since the three code faces differ widely in width |
| `--br-case` | `none`, or `lowercase` for a skin that speaks in lowercase. Names a person typed and code always keep their case |

A shared screen uses these and nothing else. If it needs a colour or a shape that is not here, the token set grows; the screen does not reach into a skin's private variables. It also sets its own margins and fonts on every element, so a skin's rules for plain `h2` or `p` cannot leak in.

### Route detail

The first shared screen. It rises from the bottom on a phone and sits in the middle from 980 px. Its sections follow what a person opens a route for, in this order:

1. **Name, status, switch.** The status is a short sentence. A route over its budget has no switch.
2. **Budget.** Spent and limit, a meter, the date it starts again, and one button: "Change budget", or "Raise budget" as the main action when the route is stopped.
3. **Connect.** The address, the route's key, and a snippet for curl and Python. The key is shown in full only once, when it is made; afterwards only its last four characters are shown and a lost key is replaced with a new one. "Make a new key" first says that the old key stops working at once, then shows the new key in full, this once.
4. **Models it may use.** Not ordered: order and fallbacks belong to the model (see "Models"). Each row is a model's name, what it makes and where it comes from, and opens the model; each can be removed from the route. "Authorize a model" opens the picker on BaseRouter's models only; "Manage models" is beside it. With none listed the route may use every model, and says so.
5. **Keep images, sound and video.** A switch, on unless turned off: the images, speech and video this route makes are kept, to look at, listen to and watch again in activity. Below it, when there are any, a way to this route's images, to its sounds and to its videos.
6. **Recent requests.** Five rows. A request that worked has a filled dot and its cost; one that failed has a hollow ring and the word "failed".
7. **Delete route.** Last, and quiet. It asks before it deletes, with the answer that keeps the route under the cursor.

### The sheet

Everything that is not the home screen is a sheet over it: one frame, one way in and one way out. While a sheet is open, the home screen behind it cannot be reached by keyboard or screen reader. Escape, the close button and the dimmed area all close it, and focus returns to whatever opened it. A sheet that opens with a form puts the cursor in its first field.

Every skin offers a way from its home screen to each of the seven screens below (providers, adding one, Models, a new route, activity, settings, the playground). Where that way sits is the skin's choice: in Socket the plugs open providers, the last-request line opens activity and "Try" sits beside "Models"; in Display they are function keys, six of them, three across; in Home they are the bottom bar and the provider pills.

### Providers

One block per provider: its name, a sentence about its state ("Working. 312 models available.", or "Unreachable." with the provider's own last answer), the end of its key, and two controls: test again, remove. The main action adds a provider.

### Add a provider

Three moments: pick one from a short list, paste its key, see the result of the test. A provider that needs no key (Ollama) asks for its address instead. If the test fails, the form stays where it is with what the provider answered above it; nothing typed is lost. The key is stored encrypted and never shown in full again.

### New route

A form with three fields (name, monthly budget, first model), then the one moment the full key is shown, with the snippet under it and a line that waits for the first request and says when it arrives.

### Models

From the decision in PRODUCT.md ("Providers, models and routes"); approved by the maintainer on 2026-11-22.

A shared screen, built once, and the only place models are added: "Manage models". Every skin offers it from its home screen, as it offers providers (Socket beside its plugs, Display as a function key, Home in its bar), and Providers and a route link to it. A route never takes a model straight from a provider; it authorizes models that are already here.

- **The list.** Each model on one row: the name apps send, what it makes, where it comes from ("OpenAI, then OpenRouter"), and how many routes use it. The main action is "Add a model", which opens the model picker; picking one a provider offers makes it a model here, with that one source.
- **One model,** opened in the same sheet:
  1. **Name apps use.** Shown as code, with "Rename". Routes that use the model follow the new name; apps that send the old one are refused, which the rename says first.
  2. **Sources.** A numbered list, because the order is real: each source is a provider and that provider's id for the model, and, for OpenRouter and NanoGPT, which of that provider's own providers ("Any provider", or one named). Each source but the last can be removed. "Add a backup source" opens the picker on every provider; "Change" on a source opens it too, and the pick takes that source's place, in its position, while the model keeps its name. A source that is a different model says so.
  3. **Used by.** The routes that may use it, each opening its route.
  4. **Delete model.** Last and quiet; it asks first and names the routes that lose it.

### Choosing a model### Choosing a model

Built once and used wherever a model is chosen: adding one to BaseRouter, allowing one on a route, a new route's first model, and a fallback source on a model. Everything in it is what the provider says about its models, as it says it; nothing is ranked or recommended.

- **A search,** by name or id. Every word typed must appear. Enter picks the first model found.
- **What it lists** depends on where it is. On a route and in a new route: only BaseRouter's models, by their own names, with "Manage models" below for more. In Manage models: what the providers offer, with a chip per provider when there is more than one.
- **Kinds,** as chips under it: All, Text, Image, Speech, Transcription, Video, each with how many models match the search. They are what the model makes, from OpenRouter's own description of each model. A kind with no match is not shown. Models that make only embeddings, rankings or moderation decisions are not listed, because the gateway has no way to use them yet.
- **The list,** in the provider's own order, thirty at a time with "Show more". A row is the model's name, its id, and one line of plain facts: its kind (under All), its price (per million tokens read and written for text models, "from $x a second" for video, "Free"), how much it reads at once, and what else it reads (images, files, sound, video). A fact the provider does not give is left out, not guessed.
- On a route, every row allows its model. On a model, a row adds a fallback source. In a new route the field shows the chosen model with "Change"; opened, a row becomes the choice and the field folds back. Typing in the search, choosing a kind or showing more redraws only the picker, so a route name being typed is never lost.

### First run

Not a screen of its own. When nothing is set up, adding the first provider turns the flows above into one numbered sequence of four: add a provider, add a model (Models, with the picker open on that provider's offer), make a route with it, connect. The numbers appear only here, because only here is it a sequence. A new route made when BaseRouter has no models yet says so and leads to Manage models.

### Activity

Every request, newest first: which route, which model, how long ago, how long it took, what it cost. One filter, by route. Opening it from a route arrives already filtered to that route.

Four tabs above the filter: requests, images, sounds and videos. Images is a grid of the images routes made and the gateway kept; sounds is a list, each row with a play mark, the words that were spoken, the model, route, when and cost; videos is a grid of wide frames, two across on a phone and three from 980 px, each showing the video's first moment with a play mark on it. All three are newest first, under the same route filter, with how many there are and how much room they take of the most they may. Pressing one opens it in the same sheet: the image whole, a player for the sound, or a player for the video, the words that asked for it, then route, model, when, cost and size, and two controls: download, and delete, which asks first. "All images", "All sounds" or "All videos" goes back. One whose route was removed stays, and says so. While a sound or a video plays, the panel does not redraw itself.

### Playground

Approved in scope by the maintainer on 2026-11-22: chat only, sent as a chosen route, reached from the home screen and from a route.

A shared screen, built once, called "Try a model" on the surface ("Try" where a skin has room for one word). It answers one question: what does an app on this route get back. Every skin offers it from its home screen, and a route's Connect section opens it as that route.

- **Who asks, and for what.** Two plain drop-downs at the top: the route, and one of the models that route may use that write text. They sit side by side from 980 px. While an answer is arriving they cannot be changed.
- **The conversation.** What the person wrote sits to the right in a field; the answer is plain text on the sheet, with no label. It can go on for several turns, and the route or the model can be changed between them. A system message is one quiet control away and is not shown until asked for.
- **An answer's states,** each different in shape, not only in colour: waiting for its first word (the busy mark and a sentence), arriving (the text, and the busy mark under it), whole, stopped by the person (what arrived, and "Stopped."), failed (a banner with what the gateway or the provider answered).
- **What is known about an answer** is one quiet underlined line under it, how long it took and what it cost: `1.8 s, $0.00041`. Pressing it opens the rest in place: the model that answered, the provider it came from, tokens read and written, cost, time to the first word, time for the whole answer. Nothing else about the request is on the screen. A cost not known when the answer ended is filled in when the gateway learns it.
- **The message field** stays at the bottom of the sheet under a long conversation. Enter sends and Shift+Enter starts a new line; on a touch keyboard Enter is a new line and the button sends. "Send" becomes "Stop" while an answer is arriving; "Start over" forgets the conversation.
- **What stands in the way is said before anything is sent,** in place of the message field: a route over its budget ("Raise budget"), a route switched off ("Switch it on"), a route with no model that writes text ("Authorize a model"). With no route at all the sheet says so and leads to a new route.
- The request is the route's in every way: it counts towards the budget, appears in its requests and in activity, and lights the route as busy on the home screen. The conversation lives in the page only. Closing the sheet stops an answer that is still arriving and keeps the conversation; leaving the page ends it.

### Settings

In order of how often they are touched: look (the skin picker, with each skin's icon), theme (light, dark, match device), language, then password, export, and about. Changing the password asks for the current one and signs the panel out everywhere else; signing out sits beside it. Export saves one JSON file.

### Sign in

The one sheet that cannot be closed: no close button, and the dimmed area and Escape do nothing. Behind it the home screen is drawn empty, as on a first run, so nothing is shown before the password is given. One field and one button. On a gateway that has no password yet it sets one instead ("Set a password", at least 8 characters). A wrong password keeps the form where it is, with what went wrong above it.

## Skin: Socket

**Idea.** BaseRouter is a power strip. Providers plug in at the top and their cables run into it. Every route is an outlet with a face, a name written on label tape, and its own rocker switch. When a budget runs out, the breaker trips.

**Boldness is spent on** the rocker switches and the outlet faces. Everything else is quiet plastic.

| Colour | Light | Dark | Role |
|---|---|---|---|
| Bench | `#E6E9EE` | `#121419` | Page |
| Plastic | `#FBFBF8` | `#262932` | The strip, keys |
| Recess | `#EEEFEA` | `#1A1C23` | Sunken parts: sockets, the address window, meters |
| Ink | `#1C2030` | `#F3F4F6` | Text, plug heads, main action |
| Ink 2 | `#565C6E` | `#A6ABB8` | Supporting text |
| Rocker | `#F0432B` | same | A lit switch: on |
| Cable | `#FFC531` | same | Cables; the blinking lamp: busy |
| Lamp | `#189D56` | same | Healthy |
| Stop | `#C4301A` | `#FF7A62` | Rocker red made readable as text |

**Type.** Bricolage Grotesque 800 for the wordmark and the big number. Instrument Sans 500–700 for everything else. Martian Mono only on label tape and the address, where it stands for a label maker and for something you copy exactly.

**Shape.** Soft moulded plastic: large radii (30 px strip, 16 px fields, 11 px keys), depth from inset highlights and one drop shadow, no outlines.

**Mascot.** A square socket with a round face, feet, and a cable for a tail that ends in a plug. The tail does the acting: held up when happy, raised and sparking when busy, sagging when worried, lying unplugged on the floor when asleep. Outlets on the strip are its relatives and show the route's status on their own faces.

**Red in this skin.** Red is the colour of power. Lit, on a switch, it means on. Unlit, as text or a full meter beside a dark switch and a frowning face, it means tripped. The two never appear on the same element.

**Do not** add a second switch style, put faces on anything that is not an outlet, or use the monospace face for running text.

Measured: ink 2 on plastic 6.4 (dark 6.3), on bench 5.5 (dark 8.0); stop text on plastic 5.4 (dark 5.7); label on a switched-off tape 6.4 (dark 6.3); lamp green on recess 3.0 (dark 4.9).

## Skin: Display

**Idea.** BaseRouter is a small desk device. One LCD says everything: providers as squares on the status line, today's spend in dot-matrix numerals, the last request as a ticker. Every route is a chunky key with its own small readout. A pixel creature with two antennas lives on the screen.

**Boldness is spent on** the LCD. In the dark theme it is backlit and is the only thing on the page that glows.

| Colour | Light | Dark | Role |
|---|---|---|---|
| Desk | `#C4C9CF` | `#0C0D0F` | Behind the device, from 980 px |
| Shell | `#E2E5E8` | `#1C1E22` | Device body; the page on a phone |
| Key | `#F6F7F8` | `#2B2E34` | Keycaps |
| Key edge | `#B4B9C0` | `#0E0F12` | Key sides, outlines |
| LCD | `#C2CEB8` | `#84E2D2` | Screen glass |
| Pixel | `#1C2A20` | `#0C2C29` | Everything drawn on the screen |
| Ink | `#16181B` | `#F1F2F3` | Printed labels |
| Ink 2 | `#5C6168` | `#9BA0A8` | Supporting labels |
| Blue | `#2440F0` | `#6E86FF` | The one accent: a lit lamp and the main action |

**Type.** Doto 900 for readout numbers, with a plain square in place of its cross-shaped full stop. Handjet 500 for text on the LCD. Archivo at 92 % width for labels printed on the device.

**Voice.** The device speaks in lowercase. Route names keep the case the person typed.

**Shape.** Keys with a visible side edge that press down 3 px. Each route key carries a small slide switch; the rest of the key opens the route. The LCD is inset. 16 px radius on keys, 18 px on the screen, pill-shaped function keys.

**Mascot.** A little router with two antennas, on a 16 × 16 grid so it lands on whole pixels at 16, 32, 48 and 64 px. Antennas spark when busy and droop when asleep; worried raises its brows and sweats one pixel.

**Monochrome rule.** There is no red and no green. Attention is shown by inverting a readout (dark glass, light pixels) and by a hollow, blinking lamp. Reachable and unreachable are a filled and a hollow square.

**Do not** introduce a status colour, put more than one accent-coloured key on a screen, or set running text in Doto.

Measured: pixel on LCD 9.1 (dark 9.8); ink 2 on shell 4.9 (dark 6.4), on key 5.8 (dark 5.2); main action label on blue 6.9 (dark 6.0).

## Skin: Home

**Idea.** BaseRouter is home base. A homing pigeon carries every request out and back. The one address is the plate on the door. Every route is a room: lights on means it is running.

**Boldness is spent on** the lit rooms. Yellow means on and is used for nothing else except the main action.

| Colour | Light | Dark | Role |
|---|---|---|---|
| Sky | `#D6E6F6` | `#191428` | Page |
| Paper | `#FFFFFF` | `#2A2240` | An unlit room, pills |
| Plum | `#33213F` | `#F3ECFA` | Text |
| Plum 2 | `#6B5A78` | `#B3A6C4` | Supporting text |
| Outline | `#33213F` | `#120D1E` | The 2.5 px line around rooms, pills and icons |
| Lamp | `#FFD23F` | same | Lights on; main action. Text on it is always `#33213F` |
| Tomato | `#CF3B26` | `#EE5A42` | Stopped, needs attention |
| Leaf | `#23985A` | same | Healthy |

**Type.** Gabarito 700–800 for the headline, names and buttons. Onest 500–700 for supporting text. No monospace: the address is set in Gabarito.

**Shape.** Flat colour and one outline weight. 28 px radius on rooms, fully round pills and switches. No shadows in the light theme; in the dark theme a lit room throws a soft yellow glow.

**Voice.** The headline is a sentence about the house: "Everything is running.", "2 things need a look.", "Nobody home yet." Today's spend is part of the sentence below it, not a dial.

**Mascot.** A plump pigeon with a letter bag. It stands when things are quiet, flies with its wing up while a request is out, and sits down with its eye shut when nothing is on. It carries the letter only while there is something to deliver.

**Do not** add hard offset shadows, use yellow for decoration, or give a room more than one outline colour.

Measured: plum 2 on sky 4.9 (dark 7.8), on paper 6.3 (dark 6.5); plum on lamp 10.2; tag label on tomato 4.9 (dark 5.3); leaf on paper 3.7 (dark 4.1).

## Brand

BaseRouter has one identity outside the product, whichever skin a person picks inside it.

- **Mark.** The socket face: a rounded square, a round recess, two eyes and a smile. It says "plug in here" and it is the face of the default skin. File: `design/brand/mark.svg`, generated from the Socket icon.
- **Wordmark.** "BaseRouter" in Bricolage Grotesque 800, tracking −0.025 em, one word, capital B and R.
- **Colours.** Ink `#1C2030` and plastic `#FBFBF8`, with cable yellow `#FFC531` for a single line of emphasis.
- **Cover.** `design/prototype/cover.html` is the 1280 × 640 artboard for the README and for social cards: the wordmark and the product sentence on ink, then one panel per skin with its mascot and its name in its own typeface.
- **Tab icon.** Inside the product it follows the active skin.

## Accepting a new or changed skin

1. `design/prototype/check.html` shows "Meets the contract" and all shared tokens defined, and its mascot appears on `mascots.html` in all four moods.
2. It holds up in all four states (a normal day, nothing needs attention, first run, worst case), in English and Turkish, light and dark, at 390 × 844 and 1440 × 900.
3. Every status in the table above is distinguishable with colour removed.
4. The contrast pairs are measured and written into the skin's section here.
5. It has a section in this document: idea, where its boldness is spent, palette, type, shape, and its own "do not" list.

## Open points

- **In Socket with many routes, "New route" is at the bottom of the strip.** With 40 routes it is a long scroll away; Display and Home keep it within reach.
- **A screen reader has not been run over the prototype.** Roles, labels, focus order and touch sizes were checked by inspection and by script.

- **The mascots have no names.**
- **The flying pigeon's raised wing** is one plain shape and reads less clearly than the other poses.
- **All planned screens exist.** Route detail added two tokens (`--br-code-size`, `--br-case`); the screens after it, the playground included, needed no more.
- **The playground tries chat only.** Images, speech, transcriptions and video go through the same address and could follow as kinds of the same screen. It has no controls for temperature or other parameters, shows text only (not a model's reasoning, not images in an answer), and does not show the request as curl; a route's Connect section has the snippet.
- **Display's function keys are two rows of three on every screen size,** since six words do not fit beside each other on a phone. "New route" lost its full-width key from 980 px; it is still the one blue key.
- **A route's name cannot be changed** after it is made.
- **A change that does not go through on the home screen is undone without a word.** Switching a route on or off redraws it at once; if the gateway refuses, the switch flips back at the next look. Forms in sheets do say what went wrong.
- **A video's tile is its first moment,** asked of the browser (`#t=0.1`), not a picture the gateway makes. Each tile loads a little of its video to show it; with many videos that is many small requests. A still made by the gateway would need a video decoder it does not have.
- **A video plays with the browser's own controls,** in every skin, like sound. Skins cannot restyle them.
- **A model shows only what fits on one line.** Its description, its prices for images or sound, and its other parameters are on OpenRouter's page, not here. A model detail view would be the next step if picking turns out to need more.
- **A source shows its OpenRouter provider by tag** ("google-vertex", "google-ai-studio/flex"), not its name, so the route list needs nothing more than the route itself. The provider's name, tier and prices are in the choice that opens.
- **No sort or saved favourites in the model picker.** The provider's order is newest first. A sort (by price, by how much it reads) can follow if search and kinds turn out not to be enough.
- **No screen for a single request.** A row in activity does not open. An image or a sound does, since it can only be seen or heard by opening it.
- **A provider cannot be switched off,** only removed. PRODUCT.md calls a provider "on or off"; drawing an off provider in three skins is not done.
- **The list of providers to add** shows six kinds on made-up data. A panel served by a gateway offers only what that gateway can add, which today is OpenRouter and NanoGPT, and leaves out the ones already added.
- **The switch in route detail is a plain token-coloured switch** in every skin, not Socket's rocker or Display's slide switch. Whether skins should be able to supply their own is undecided.
- **Display on a wide screen** leaves the area around the device empty. Whether that is the point of the skin or a gap is undecided.
