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
4. **Models.** A numbered list, because the order is real: the first is used, the next is tried if it fails. Each model but the last can be removed; "Add model" picks one of the provider's models.
5. **Keep images.** A switch, on unless turned off: the images this route makes are kept, to look at again in activity. Below it, when there are any, a way to this route's images.
6. **Recent requests.** Five rows. A request that worked has a filled dot and its cost; one that failed has a hollow ring and the word "failed".
7. **Delete route.** Last, and quiet. It asks before it deletes, with the answer that keeps the route under the cursor.

### The sheet

Everything that is not the home screen is a sheet over it: one frame, one way in and one way out. While a sheet is open, the home screen behind it cannot be reached by keyboard or screen reader. Escape, the close button and the dimmed area all close it, and focus returns to whatever opened it. A sheet that opens with a form puts the cursor in its first field.

Every skin offers a way from its home screen to each of the five screens below. Where that way sits is the skin's choice: in Socket the plugs open providers and the last-request line opens activity; in Display they are function keys; in Home they are the bottom bar and the provider pills.

### Providers

One block per provider: its name, a sentence about its state ("Working. 312 models available.", or "Unreachable." with the provider's own last answer), the end of its key, and two controls: test again, remove. The main action adds a provider.

### Add a provider

Three moments: pick one from a short list, paste its key, see the result of the test. A provider that needs no key (Ollama) asks for its address instead. If the test fails, the form stays where it is with what the provider answered above it; nothing typed is lost. The key is stored encrypted and never shown in full again.

### New route

A form with three fields (name, monthly budget, first model), then the one moment the full key is shown, with the snippet under it and a line that waits for the first request and says when it arrives.

### First run

Not a screen of its own. When nothing is set up, adding the first provider turns the two flows above into one numbered sequence: add a provider, make a route, connect. The numbers appear only here, because only here is it a sequence.

### Activity

Every request, newest first: which route, which model, how long ago, how long it took, what it cost. One filter, by route. Opening it from a route arrives already filtered to that route.

Two tabs above the filter: requests and images. Images is a grid of the images routes made and the gateway kept, newest first, under the same route filter, with how many there are and how much room they take of the most they may. Pressing one opens it in the same sheet: the image whole, the words that asked for it, then route, model, when, cost and size, and two controls: download, and delete, which asks first. "All images" goes back to the grid. An image whose route was removed stays, and says so.

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
- **All planned screens exist.** Route detail added two tokens (`--br-code-size`, `--br-case`); the five screens after it needed no more.
- **A route's name cannot be changed** after it is made.
- **A change that does not go through on the home screen is undone without a word.** Switching a route on or off redraws it at once; if the gateway refuses, the switch flips back at the next look. Forms in sheets do say what went wrong.
- **No screen for a single request.** A row in activity does not open. An image does, since it can only be seen by opening it.
- **A provider cannot be switched off,** only removed. PRODUCT.md calls a provider "on or off"; drawing an off provider in three skins is not done.
- **The list of providers to add** shows six kinds on made-up data. A panel served by a gateway offers only what that gateway can add, which today is OpenRouter, and says so once it is added.
- **The switch in route detail is a plain token-coloured switch** in every skin, not Socket's rocker or Display's slide switch. Whether skins should be able to supply their own is undecided.
- **Display on a wide screen** leaves the area around the device empty. Whether that is the point of the skin or a gap is undecided.
