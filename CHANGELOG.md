# Changelog

All notable changes to BaseRouter are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-11-22

The first release.

### Added

- The gateway, with one provider: OpenRouter. One OpenAI-compatible address, `POST /v1/chat/completions` and `GET /v1/models`, streamed or not, passed on as OpenRouter sent it.
- Routes: a named key per agent or app, shown once and stored only as a hash; a monthly budget checked before a request is sent; an on/off switch; a list of allowed models, sent to OpenRouter as a fallback list.
- A record of every request: the model asked for and the model that answered, tokens, cost, time to first token, total time and what went wrong. Prompts and answers are not stored.
- A management API under `/api`, behind an admin password, and an export of everything as one JSON file.
- The panel, served by the gateway, in three skins (Socket, Display, Home), in English and Turkish, light and dark. Fonts are bundled.
- `bun run demo`: the gateway and panel in front of a stand-in OpenRouter, for trying it without a key.

### Not yet

- Providers other than OpenRouter; renaming a route; images, audio, video and embeddings.

[0.1.0]: https://github.com/s7ktm/baserouter/releases/tag/v0.1.0
