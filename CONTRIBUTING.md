# Contributing to BaseRouter

Thank you for helping. BaseRouter is small on purpose; a change that keeps it small is easier to take.

Read [PRODUCT.md](PRODUCT.md) first. For anything you can see in the panel, read [DESIGN.md](DESIGN.md) too.

## Run it

You need [Bun](https://bun.sh) 1.4 or newer.

```bash
cd gateway
bun install
bun run demo
```

`bun run demo` starts the gateway and the panel at http://localhost:4141/ in front of a stand-in OpenRouter, with a fresh database each time. Add OpenRouter with the key `fixture-openrouter-key`. Use `bun start` for the real thing. To work on the panel alone, on made-up data, run `bun design/serve.ts` from the top of the repository and open http://127.0.0.1:4173/.

## Test it

```bash
cd gateway
bun test
bun run typecheck
```

The tests need no network and no key. To run the few live tests against the real OpenRouter, put `OPENROUTER_API_KEY=...` in `.env` at the top of the repository (git ignores it) and run `bun --env-file=../.env test live`. Never commit, log or paste a real key, in code, tests, issues or pull requests.

## Change it

- Open an issue first for anything larger than a fix, so we can agree on the shape before you write it.
- Work on a branch, one piece of work per branch, and open a pull request against `main`. Pull requests are squash-merged.
- Say in the pull request what changed, why, and how you checked it.
- Add or change tests with the code. `bun test` and `bun run typecheck` must pass.
- Keep dependencies few, and pin their exact versions.
- Providers are added one at a time. Do not add a general provider layer ahead of the provider that needs it.
- Code and documents are in English. The panel ships in English and Turkish: every new word goes into both.

### Changes to the panel

Check every change in the browser at 390 × 844 and at 1440 × 900, in light and dark themes, in English and Turkish. Every screen state (empty, loading, error, over budget) must be reachable through a URL parameter; the parameters are listed in [design/prototype/README.md](design/prototype/README.md). Open `design/prototype/check.html`: every skin must still meet the contract in every state.

Secondary screens (route detail, providers, activity, settings, first run, sign in) are built once in `design/prototype/core/screens/`. Skins restyle them through colour, type and shape; they do not redraw them.

## Add a skin

A skin is a folder `design/prototype/skins/<id>/` with `skin.css`, `skin.js` and `mascot.js`. It decides how the home screen looks and where things sit; it never stores data or handles clicks itself. In short:

1. Copy the skin closest to what you have in mind into `skins/<your-id>/`.
2. Change `id` and `name`, then redraw.
3. Add the id to `skins/registry.js`.
4. Open `check.html`: the skin must meet the contract in every view, both languages and both themes. Then open `index.html?skin=<your-id>&state=stress`: nothing may be cut, overlap or scroll sideways.

[design/prototype/README.md](design/prototype/README.md) describes the contract in full. Typefaces go in `design/prototype/fonts/` with their licences; nothing is loaded from a third party.

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
