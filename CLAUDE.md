# BaseRouter — working notes for Claude

- Read [PRODUCT.md](PRODUCT.md) before any product or interface work. Once it exists, read `DESIGN.md` before any interface work; Claude Code does not load it automatically.
- The design was approved by the maintainer on 2026-11-22. Gateway work may start; it follows [DESIGN.md](DESIGN.md) and the prototype in `design/prototype/`, and changes to the design still go through the maintainer.
- The gateway is built one provider at a time: OpenRouter first, NanoGPT second. Do not design a general provider architecture up front; let it grow from what each provider teaches. What NanoGPT's API does, and where its documentation is wrong, is in [docs/nanogpt.md](docs/nanogpt.md); read it before touching `gateway/src/nanogpt.ts`.
- Never print, log or commit a provider key. Real keys live in `.env`, which git ignores.
- Talk to the maintainer in Turkish. Repository documents and code are in English.
- The interface ships in English and Turkish. Check every screen in both languages.
- Check every interface change in the browser at 390×844 and 1440×900, in light and dark themes.
- Every screen state (empty, loading, error, over budget) must be reachable through a URL parameter.
- Keep dependencies few and pin their versions.
- BaseRouter ships with several **skins** (Socket, Display, Home). Skins are free in look and layout; they share one state, one set of actions and one contract. Read [design/prototype/README.md](design/prototype/README.md) before touching a skin.
- A skin never stores data or handles clicks itself, and every skin must pass `design/prototype/check.html` in all states, both languages and both themes.
- Secondary screens (route detail, providers, activity, settings, first run) are built once; skins restyle them through colour, type and shape, they do not redraw them.
- `design/directions/` holds the first three stand-alone mock-ups, kept for reference. New work goes in `design/prototype/`. No build step in either.
