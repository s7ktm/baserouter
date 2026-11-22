# Changelog

All notable changes to BaseRouter are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- The gateway serves only the panel and the files it loads. The design pages beside it, one of which could be made to run a script from a link, are no longer served, and they accept only known values.
- A model id must look like one; anything else is refused. The panel's home screen escapes the last model shown.
- A request's own `models` fallback list may only name the route's models.
- A transcription form with more than one `model` is refused.
- Passwords are checked one at a time, so the five-try lock holds against guesses sent at once.
- The panel and `/api` answer only to known host names (`BASEROUTER_ALLOWED_HOSTS`, `BASEROUTER_DOMAIN`), against DNS rebinding.
- Image links in answers are fetched only over HTTPS, never by following a redirect, and never to this machine or the local network by address.
- The data folder and its files are readable by BaseRouter's own user only; the session cookie is `Secure` over HTTPS; very long stream lines that are not needed are not held in memory.

## [0.2.0] — 2026-11-22

Images and sound, a history of what routes made, and a way to run it for good.

### Added

- Images, sound and files through OpenRouter, each with the route's key, its budget and its models, and recorded with its cost:
  - images, PDFs and sound inside `POST /v1/chat/completions`, sent on unchanged;
  - images out of a chat request (`modalities: ["image", "text"]`), plain and streamed;
  - `POST /v1/images/generations`, plain and streamed;
  - `POST /v1/audio/speech`, whose cost OpenRouter does not put in the answer, so it is asked for afterwards;
  - `POST /v1/audio/transcriptions`, as JSON or as a form with a file.
- Each request records what it made: `chat`, `image`, `speech` or `transcription`. The activity list and the route page show it.
- A limit on the size of a request body, 64 MB by default (`BASEROUTER_MAX_REQUEST_MB`), with a clear HTTP 413 when it is passed.
- Kept images and sound. The images and speech routes make are kept in `gateway/data/media/`, one file each, written as they arrive (speech while it streams to the client), and shown in the panel: activity has an Images tab with a grid and a Sounds tab with a player, filtered by route, and each one opens with its prompt, model, cost and size, to download or delete. A route can switch it off, and one request can say no with the header `X-BaseRouter-Save: no`. They may take 1 GB together by default (`BASEROUTER_MEDIA_MAX_MB`; `0` keeps none), and the oldest go first when that is passed. Raw PCM sound (Gemini voices, `response_format: "pcm"`) is kept as WAV when its sample rate is known; the sound of chat answers is not kept.
- Running it for good: a `Dockerfile` and `compose.yaml` (reachable from the machine itself, with its data in a volume), an optional Caddy in front for HTTPS (`--profile tls`), a hardened systemd unit in `deploy/`, and [INSTALL.md](INSTALL.md) with backups, updates, hosting services and why serverless is not supported.
- The gateway stops cleanly on SIGTERM or Ctrl-C.
- Tests, the type check and a Docker build run on every pull request.

### Changed

- What is kept. In 0.1.0 no prompt or answer was stored. Now the images and speech routes make are kept by default, with the words that asked for them, on the machine BaseRouter runs on; a route can switch it off and one request can say no. Other prompts and answers are still not stored. See "What is kept" in [PRODUCT.md](PRODUCT.md).

### Fixed

- A request body more than 1 MB over the limit got an empty HTTP 413 from the server underneath instead of BaseRouter's own error. The management API now takes bodies of up to 1 MB, before and after signing in.

### Not yet

- Video, which OpenRouter makes as a job to be asked about later; embeddings; image edits.


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

[Unreleased]: https://github.com/s7ktm/baserouter/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/s7ktm/baserouter/releases/tag/v0.2.0
[0.1.0]: https://github.com/s7ktm/baserouter/releases/tag/v0.1.0
