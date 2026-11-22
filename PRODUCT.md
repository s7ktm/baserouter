# BaseRouter — Product

**Plug in your providers, use one address, see what every route spends.**

BaseRouter is a self-hosted AI gateway with the simplicity of a smart-home panel. You add your provider keys once, every agent and app talks to one OpenAI-compatible endpoint, and a small friendly panel shows what each of them costs.

## Who it is for

- A hobby engineer with several agents (a home assistant, a robot arm, a coding agent) who wants one place to manage providers and budgets.
- A small startup founder who wants to switch models or providers in one place instead of in every codebase.
- Anyone who looked at a full-size gateway and thought "this is too much for me".

It is not for enterprises that need organisations, teams, SSO, audit logs or policy engines.

## The whole product in five words

| Concept | What it is | Example |
|---|---|---|
| **One Address** | The single endpoint everything connects to. The most visible thing on the home screen. | `http://localhost:…/v1` |
| **Provider** | An API key you add once. It is on or off, healthy or not. | OpenRouter |
| **Model** | A model BaseRouter offers, under the name apps use, and the places it comes from, in order. Defined once, for every route. | `gpt-5-mini`: OpenAI, then OpenRouter |
| **Route** | A named key for one agent or app: its own budget, the models it may use, and an on/off switch. | "Home assistant" |
| **Spend** | What was spent per route, per provider, per day. Budgets are enforced before a request is sent. | Today $1.24 |

A model's name and the places it comes from live on the model; a route only says which models it may use.

## Providers, models and routes

Three things, each answering one question. Decided and its screens approved on 2026-11-22.

- **A provider** answers *how do I reach it*: a key, and whether it works. It is also where models are found: what it offers, what each makes and costs, all as the provider says.
- **A model** answers *what do apps ask for, and where does it come from*. It is defined once in BaseRouter, for every route: the name apps send (by default the provider's own id, so existing apps work unchanged), what it makes (from the provider, never chosen by hand), and the places it comes from, in order. When the first place fails, the next is used, for every route at once. A place is a provider and that provider's id for the model; the same model has different ids at different providers (`gpt-5-mini` at OpenAI, `openai/gpt-5-mini` at OpenRouter). A place may also be a different model, as a deliberate fallback; it is then shown as one.
- **A route** answers *who is asking, and what may it spend*: one agent or app, with its own key, monthly budget, on/off switch, the models it may use, and what it made. A route holds no routing logic: no order, no providers. A route that names no models may use every model in BaseRouter, and also any model the first provider offers, by the provider's own id, as before models existed.

Adding a model is finding it: picking a model a provider offers makes it a model in BaseRouter, with that one place. Renaming it and adding fallback places is done on the model, when wanted, never required.

Replaced by this: a route's ordered model list with a provider on each line (built in the branch before this decision, not released).
## Screens

No sidebar. On mobile, one centred column; on desktop, the same layout with more room.

1. **First run** — add a provider, create a route, copy the snippet, see the first request arrive.
2. **Home** — One Address, today's spend, route tiles, provider status.
3. **Route** (bottom sheet) — name, key, budget, allowed models, recent requests, connection snippet.
4. **Providers** — tiles and the add flow (pick, paste key, test).
5. **Models** — the models BaseRouter offers, where each comes from, and which routes use it. Reached from Providers and from a route.
6. **Activity** — request list, filter by route; the images, sounds and videos routes made, to look at, listen to and watch again.
7. **Settings** — password, theme, language, export.

## Not in the first version

Users, teams and organisations; routing strategies; guardrails; MCP; caching; SSO; Postgres; Redis.

## What is kept

Every request leaves a row: route, model, tokens, cost, timings, what went wrong. Prompts and answers are not stored. The one exception is what a route makes that cannot be seen again otherwise: generated images, speech and video are kept, with the words that asked for them, so they can be looked at, listened to and watched in activity. This is on by default; a route can switch it off, and a single request can say no. Everything is kept on the machine BaseRouter runs on, and nowhere else.

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
