# Changelog

All notable changes to BaseRouter are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Images, sound and files through OpenRouter, each with the route's key, its budget and its models, and recorded with its cost:
  - images, PDFs and sound inside `POST /v1/chat/completions`, sent on unchanged;
  - images out of a chat request (`modalities: ["image", "text"]`), plain and streamed;
  - `POST /v1/images/generations`, plain and streamed;
  - `POST /v1/audio/speech`, whose cost OpenRouter does not put in the answer, so it is asked for afterwards;
  - `POST /v1/audio/transcriptions`, as JSON or as a form with a file.
- Each request records what it made: `chat`, `image`, `speech` or `transcription`. The activity list and the route page show it.
- A limit on the size of a request body, 64 MB by default (`BASEROUTER_MAX_REQUEST_MB`), with a clear HTTP 413 when it is passed.

### Not yet

- Video, which OpenRouter makes as a job to be asked about later; embeddings; image edits.

Generated images and sound are passed through and not kept.

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

[Unreleased]: https://github.com/s7ktm/baserouter/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/s7ktm/baserouter/releases/tag/v0.1.0
