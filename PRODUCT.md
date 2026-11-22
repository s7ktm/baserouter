# BaseRouter — Product

**Plug in your providers, use one address, see what every route spends.**

BaseRouter is a self-hosted AI gateway with the simplicity of a smart-home panel. You add your provider keys once, every agent and app talks to one OpenAI-compatible endpoint, and a small friendly panel shows what each of them costs.

## Who it is for

- A hobby engineer with several agents (a home assistant, a robot arm, a coding agent) who wants one place to manage providers and budgets.
- A small startup founder who wants to switch models or providers in one place instead of in every codebase.
- Anyone who looked at a full-size gateway and thought "this is too much for me".

It is not for enterprises that need organisations, teams, SSO, audit logs or policy engines.

## The whole product in four words

| Concept | What it is | Example |
|---|---|---|
| **One Address** | The single endpoint everything connects to. The most visible thing on the home screen. | `http://localhost:…/v1` |
| **Provider** | An API key you add once. It is on or off, healthy or not. | OpenRouter |
| **Route** | A named key for one agent or app, with its own budget, allowed models and on/off switch. | "Home assistant" |
| **Spend** | What was spent per route, per provider, per day. Budgets are enforced before a request is sent. | Today $1.24 |

Model aliases and fallback order live inside a route's settings. They are not a separate section.

## Screens

No sidebar. On mobile, one centred column; on desktop, the same layout with more room.

1. **First run** — add a provider, create a route, copy the snippet, see the first request arrive.
2. **Home** — One Address, today's spend, route tiles, provider status.
3. **Route** (bottom sheet) — name, key, budget, allowed models, recent requests, connection snippet.
4. **Providers** — tiles and the add flow (pick, paste key, test).
5. **Activity** — request list, filter by route; the images and sounds routes made, to look at and listen to again.
6. **Settings** — password, theme, language, export.

## Not in the first version

Users, teams and organisations; routing strategies; guardrails; MCP; caching; SSO; Postgres; Redis.

## What is kept

Every request leaves a row: route, model, tokens, cost, timings, what went wrong. Prompts and answers are not stored. The one exception is what a route makes that cannot be seen again otherwise: generated images and speech are kept, with the words that asked for them, so they can be looked at and listened to in activity. This is on by default; a route can switch it off, and a single request can say no. Everything is kept on the machine BaseRouter runs on, and nowhere else.

## Principles

1. **A glance is enough.** Someone seeing a screenshot understands what it does without reading documentation.
2. **Few things, done properly.** A budget limit that exists is a budget limit that is enforced.
3. **State is shown, not described.** On, off, healthy, over budget: colour and shape first, text second.
4. **No technical vocabulary on the surface.** "Route", not "virtual key". "Provider", not "deployment".
5. **Friendly, not childish.** A mascot and warmth around the edges; the numbers stay plain and exact.
6. **One command to run.** No external database, no config file needed to start.

## Voice

Short, plain, second person. Says what happened and what to do next. No exclamation marks, no jargon, no apologies. The interface ships in English and Turkish from the start, and every screen is checked in both.

## Licence

MIT. Open source, community project, not a commercial product.
