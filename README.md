# <img src="design/brand/mark.svg" width="36" height="36" alt=""> BaseRouter

![BaseRouter: plug in your providers, use one address, see what every route spends. A self-hosted AI gateway in three looks: Socket, Display and Home.](design/brand/cover.png)

BaseRouter is a self-hosted AI gateway with the simplicity of a smart-home panel. You add your provider keys once, every agent and app talks to one OpenAI-compatible address, and a small friendly panel shows what each of them costs. See [PRODUCT.md](PRODUCT.md) for what it is and who it is for.

It comes in three looks. They share everything underneath; pick the one you like, or [draw your own](design/prototype/README.md).

| Socket | Display | Home |
|---|---|---|
| <img src="design/screenshots/socket-light.png" width="250" alt="The Socket look: providers as plugs, each route an outlet with a rocker switch"> | <img src="design/screenshots/display-dark.png" width="250" alt="The Display look in its dark theme: a backlit screen with dot-matrix numbers and a key per route"> | <img src="design/screenshots/home-light.png" width="250" alt="The Home look: each route a room with its lights on, and a homing pigeon"> |

## Status

Version 0.1.0, the first release. It is young: try it, but do not bet a business on it yet.

**Works today**

- One provider, OpenRouter, behind one OpenAI-compatible address (`/v1/chat/completions`, `/v1/models`), streamed or not.
- Routes: a named key per agent, a monthly budget enforced before a request is sent, an on/off switch, a list of allowed models with OpenRouter's fallback between them.
- A record of every request: models, tokens, cost, timings, what went wrong.
- The panel in three skins (Socket, Display, Home), in English and Turkish, light and dark, behind an admin password.

**Not yet**

- Any provider other than OpenRouter.
- Renaming a route after it is made.
- Images, audio, video and embeddings.
- Users, teams, SSO, caching and routing strategies are not planned; see [PRODUCT.md](PRODUCT.md).

## Get started

You need [Bun](https://bun.sh) 1.4 or newer.

```bash
git clone https://github.com/s7ktm/baserouter.git
cd baserouter/gateway
bun install
bun start
```

Open http://localhost:4141/. The panel asks you to choose a password, then walks you through adding your OpenRouter key, making a route and connecting to it. The [gateway README](gateway/README.md) has the same steps with `curl`, the full API and every setting.

To try it without an OpenRouter key, run `bun run demo` instead of `bun start`: the same gateway and panel in front of a stand-in OpenRouter, with a fresh database each time. Add OpenRouter with the key `fixture-openrouter-key`.

## What is in here

- `gateway/` — the gateway. See [its README](gateway/README.md).
- `design/prototype/` — the panel, in three skins running on one shared state. Served by the gateway it shows the real thing; on its own it runs on made-up data. See [its README](design/prototype/README.md) for how skins work and how to add one. The design rules are in [DESIGN.md](DESIGN.md).
- `design/directions/` — the first three stand-alone mock-ups the skins grew out of.

To run the panel on made-up data, for design work, from the top of the repository:

```bash
bun design/serve.ts
```

Then open http://127.0.0.1:4173/. The bar at the top switches skin, language (English, Turkish) and theme. `/prototype/check.html` shows every skin in every state. The images above are made with `sh design/screenshots/make.sh` while that server is running.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Licence

[MIT](LICENSE)
