# BaseRouter gateway

The part of BaseRouter that requests go through: one provider (OpenRouter), the one address, budgets, a record of every request, and the panel.

## Run it

You need [Bun](https://bun.sh) 1.4 or newer.

```bash
cd gateway
bun install
bun start
```

Open the panel at http://localhost:4141/. The first time, it asks you to choose a password, then walks you through adding OpenRouter, making a route and connecting to it. The one address is `http://localhost:4141/v1`. There is nothing to configure and no other database to install; everything it keeps is in `gateway/data/`.

The panel is the folder `design/prototype/`, served as it is; see [its README](../design/prototype/README.md).

To run it for good (Docker, HTTPS, systemd, backups, updates), see [INSTALL.md](../INSTALL.md). It stops cleanly on SIGTERM or Ctrl-C: no new requests, a few seconds for running ones, then the database is closed.

## First run without the panel

The same steps as four requests.

1. Set the admin password. This works once; afterwards `POST /api/login` with the same body gives a new session.

   ```bash
   curl http://localhost:4141/api/setup -H "Content-Type: application/json" -d '{"password": "choose a password"}'
   ```

   Keep the `token` from the answer for the next steps. The password needs at least 8 characters.

   ```bash
   export BASEROUTER_ADMIN=<token>
   ```

2. Add OpenRouter. The key is tested first and is not stored if the test fails. Reading it from a variable keeps it out of the command itself, so set `OPENROUTER_API_KEY` first (with `bun run demo`, it is `fixture-openrouter-key`).

   ```bash
   curl http://localhost:4141/api/providers -H "Authorization: Bearer $BASEROUTER_ADMIN" -H "Content-Type: application/json" -d "{\"kind\": \"openrouter\", \"key\": \"$OPENROUTER_API_KEY\"}"
   ```

3. Make a route. The answer contains the route's `key`. It is shown this once and cannot be read again.

   ```bash
   curl http://localhost:4141/api/routes -H "Authorization: Bearer $BASEROUTER_ADMIN" -H "Content-Type: application/json" -d '{"name": "Home assistant", "budget": 10, "models": ["openai/gpt-5-mini"]}'
   ```

4. Connect, with the route's key in `BASEROUTER_KEY` (`export BASEROUTER_KEY=<key>`):

   ```bash
   curl http://localhost:4141/v1/chat/completions \
     -H "Authorization: Bearer $BASEROUTER_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model": "openai/gpt-5-mini", "messages": [{"role": "user", "content": "Hello"}]}'
   ```

Anything that speaks the OpenAI API works the same way: point its base URL at the one address and give it the route's key.

## What it does

**The one address.** `POST /v1/chat/completions`, `POST /v1/images/generations`, `POST /v1/audio/speech`, `POST /v1/audio/transcriptions`, `POST /v1/videos` (with `GET /v1/videos/:id`, `GET /v1/videos/:id/content` and `GET /v1/videos/models`) and `GET /v1/models`, opened with a route's key. The request body goes to OpenRouter as the client wrote it and the answer comes back as OpenRouter sent it. A stream is passed on byte for byte, keep-alive lines included. If the client goes away, the request to OpenRouter is cancelled. A request body may be up to 64 MB (`BASEROUTER_MAX_REQUEST_MB`); a larger one is refused with HTTP 413 before anything is sent.

**Budgets.** A budget is monthly and starts again on the first day of the month, at midnight in the local time of the machine the gateway runs on. A route that has used up its budget is refused with HTTP 402 before anything is sent to the provider; a switched-off route is refused with HTTP 403. The check happens when a request starts and counts what finished requests cost, so requests running at the same time all pass it: many requests sent at once can take a route past its budget by as much as they cost together. A request whose cost stays unknown counts as nothing.

**A row per request.** Route, what it made (`chat`, `image`, `speech`, `transcription` or `video`), the model asked for and the model that answered, tokens, cost, where the cost came from, time to the first token, total time, and what went wrong if something did. The cost is the `usage.cost` OpenRouter reports, read from the stream as it passes. When an answer ends without it (a stream that broke off, a client that left), the gateway asks OpenRouter for that request's cost a few seconds later. A request whose cost stays unknown counts as nothing towards the budget.

**Images, sound and files.** All through OpenRouter, all with the route's key, checked against its budget and its models, and recorded with their cost.

| Request | Goes to OpenRouter's | Cost from |
|---|---|---|
| Images, PDFs and sound *inside* a chat request (`image_url`, `file`, `input_audio` parts) | `/chat/completions`, unchanged | `usage.cost` in the answer |
| A chat request with `modalities: ["image", "text"]`: the images come back in `message.images` (plain) or `delta.images` (streamed), as base64 data URLs | `/chat/completions` | `usage.cost`, in the stream's last chunk when streamed |
| A chat request with `modalities: ["text", "audio"]` (sound out; OpenRouter streams it) | `/chat/completions` | `usage.cost` |
| `POST /v1/images/generations` (OpenAI's name; OpenRouter calls it `/images`), plain or `stream: true` | `/images`, unchanged | `usage.cost` in the answer, or in the stream's `image_generation.completed` event |
| `POST /v1/audio/speech`: the answer is the sound itself (`audio/mpeg`, `audio/pcm`) | `/audio/speech`, unchanged | Not in the answer. The gateway asks `GET /generation?id=` with the answer's `X-Generation-Id` once it has ended |
| `POST /v1/audio/transcriptions`, as JSON (`input_audio` in base64) or as a form with a `file`, the way OpenAI clients send it | `/audio/transcriptions`, unchanged, the form's boundary included | `usage.cost` in the answer |

The `kind` of a chat request comes from the `modalities` it asks for: `image` when it asks for images, `speech` when it asks for sound, `chat` otherwise. The panel's activity list and route page say which requests were images or sound.

Where a cost is filled in afterwards it is still OpenRouter's own figure, so `cost_source` is `provider` either way; until it is known it is `unknown`. That is a gap in the budget for speech: its cost arrives a few seconds after the sound, so a route making many speech requests at once can go further past its budget than one making chat requests, and a speech request whose cost OpenRouter never gives counts as nothing.

What takes over when a model fails is set on the model in BaseRouter (see "Models" below), and works the same for images, sound and video.

**Video.** OpenRouter makes a video as a job: it is started, asked about until it is done, and its video fetched. The gateway passes on all four steps with the route's key.

| Request | Does |
|---|---|
| `POST /v1/videos` | Starts a job: checked against the route's budget and models, sent to OpenRouter's `/videos` as written, answered with HTTP 202 and the job's `id`. The request's row is written now, with its cost unknown |
| `GET /v1/videos/:id` | OpenRouter's answer about the job: `status` (`pending`, `in_progress`, then `completed`, `failed`, `cancelled` or `expired`), and once it is completed `unsigned_urls` and `usage.cost` |
| `GET /v1/videos/:id/content?index=0` | The video itself (`video/mp4`), passed on as it arrives |
| `GET /v1/videos/models` | The models that make video, with their resolutions, lengths and prices; a route limited to some models sees only those |

- Only the route that started a job can ask about it, fetch its video, or continue it (`previous_job_id`); to any other route it does not exist (HTTP 404). Asking and fetching are free, are not recorded, and work when the route is over its budget.
- In the answers, `polling_url` and `unsigned_urls` lead to the gateway, at the address the client used (HTTPS behind Caddy), so they open with the route's key. OpenRouter's `urls` and `expires_at` are left out: those signed links open the video with no key at all, around the gateway, and carry the OpenRouter account's id. The rest of the answer is as OpenRouter wrote it.
- The cost of a video is known only when its job is done: it is not in the first answer, and OpenRouter's `/generation` does not know video jobs. So the gateway asks about every job itself (after 5, 10, 20, 35 seconds, then every 30 seconds) until it ends, whether or not the client does, and records its cost on the request's row then; whichever learns first that the job ended records it, once. The row's total time becomes the time from start to end. A job that fails is recorded as failed. Jobs still open when the gateway stops are asked about again when it starts; one still not done three hours after it started is given up on, with its cost unknown.
- Until a job is done its cost counts as nothing towards the budget, so a route can start several videos before the first one's cost is counted.

**Kept images, sound and video.** The images, speech and video a route makes are kept, so they can be looked at, listened to and watched again in the panel (activity: Images, Sounds and Videos). The answer still goes to the client unchanged and at once.

- Each one is a file in `gateway/data/media/`, named after the SHA-256 of its bytes, so the same image or sound made twice is stored once. The database has a row each: request, route, model, the words that asked for it (the `prompt` of `/images/generations`, the `input` of `/audio/speech`, or the last thing the user said in a chat; up to 2,000 characters), type and size.
- Files are written as they arrive, through a temporary file in the same folder, and are never held in memory whole: the sound of `/audio/speech` is written while it streams to the client, and an image given as a link (`response_format: "url"`) is fetched once, in pieces, within 30 seconds and up to 50 MB. A file that is cut off (the client left, the provider broke off) or would pass the room allowed is dropped. Parts left by a gateway that stopped mid-write are removed when it starts.
- Which: the finished images of a request that worked, from `/v1/images/generations` (plain or streamed; partial images of a stream are not kept) and from chat requests that ask for images; the sound of `/v1/audio/speech`; and the videos of a job that completed, fetched by the gateway once it is done, within ten minutes each.
- What a file is comes from its first bytes, not from what the answer says. Kept are PNG, JPEG, WebP, GIF and SVG images, MP3, WAV, Ogg, FLAC, AAC, MP4 and WebM sound, and MP4, WebM and QuickTime video (MP4 and WebM can hold either; what was asked for decides). Raw PCM (`response_format: "pcm"`, the default of `/audio/speech`, and the only format of Google's Gemini voices) has no header saying how to play it; OpenRouter names its format in the content type (`audio/pcm;rate=24000;channels=1`), and the gateway writes a WAV header in front of it, so it is kept as a WAV file that plays anywhere. The client still gets the raw PCM. PCM whose content type does not name its rate is not kept. Not kept either: the sound of a chat answer (`modalities: ["text", "audio"]`), which comes as base64 PCM spread over the stream's events, without its format.
- The panel gets them through `/api`, with the session, in ranges for playing and seeking sound, and with headers that stop a browser from running anything inside them (an SVG can hold a script).
- A route can switch keeping off (in the panel, or `PATCH /api/routes/:id {"keepMedia": false}`). One request can say no with the header `X-BaseRouter-Save: no` (also `false`, `0`, `off`). A header and not a body field, so the body still goes to OpenRouter exactly as written; OpenAI clients send one with `extra_headers`. The header is not sent on to OpenRouter.
- Images, sound and video together may take `BASEROUTER_MEDIA_MAX_MB`, 1 GB by default. When that is passed, the oldest are removed first. `0` keeps none.
- When a route is removed, what it made stays, without a route. Deleting one removes its file once no other row has the same bytes.

**Models.** BaseRouter keeps its own list of models: the name apps send, what the model makes, and the sources it comes from, in order. A source is a provider BaseRouter holds a key for, that provider's id for the model, and for OpenRouter which of its own providers serves it (`via`: `google-vertex`, a tier such as `google-ai-studio/flex`, or none for OpenRouter's own choice). A route only names the models it may use. See "Providers, models and routes" in [PRODUCT.md](../PRODUCT.md).

- A request is sent to the asked model's first source, with that source's model id and, with a `via`, OpenRouter's `provider.only` (the client's other `provider` wishes are kept). When OpenRouter refuses it (an outage, a rate limit, a provider that does not serve the model), the next source is tried, before anything reaches the client; not when it refuses BaseRouter's key or credit. One request from the client is one row, whichever source answered. This holds for chat, images, speech, transcriptions and video.
- A model with one source at its own name and no `via` is sent byte for byte, as before models existed.
- A route made with `models` may only use those (HTTP 403 otherwise). A route with an empty list may use every model in BaseRouter, and also any model its first provider offers, by that provider's id, as before models existed.
- A name a route lists that is not a model in BaseRouter becomes one when the route is saved, at the first provider, under the provider's own id. Routes made before models existed are moved over the same way when the gateway starts.
- A client's own `models` fallback list is passed on only when the asked model goes to its one source as asked; otherwise it is refused (HTTP 400), because what takes over is set on the model.
- A model id OpenRouter does not know is refused, not skipped. The cost recorded is that of the model that answered.

**The model list.** `GET /v1/models`, opened with a route's key, lists the models the route may use, by the names apps send, in OpenAI's shape (`client.models.list()` works). Each carries what OpenRouter says about the model at its first source: name, prices, context length, what it takes and makes (`architecture.input_modalities`, `output_modalities`), its parameters. A route that may use any model sees BaseRouter's models first, then the rest of OpenRouter's list. OpenRouter is asked for every model (on its own it lists only those that write text), and an app can ask for some only, with OpenRouter's filters: `?output_modalities=image` (or `image,video`; `text`, `audio`, `speech`, `transcription`, `embeddings`, `all`), `?supported_parameters=tools`, `?category=programming`. Other query parameters are not passed on; a filter value OpenRouter does not know is answered with its HTTP 400. Video models, with their resolutions, lengths and prices, are at `GET /v1/videos/models`, as OpenRouter names them, limited to those at the route's models' sources.

### Refusals

Errors from the gateway itself have the shape OpenAI clients expect: `{"error": {"message", "type", "code"}}`. Errors from OpenRouter are passed on unchanged.

| Status | `code` | Meaning |
|---|---|---|
| 401 | `unknown_key` | The key is missing or is not a route's key |
| 402 | `budget_used_up` | The route has used up its monthly budget; `metadata` has the amounts and the date it starts again |
| 403 | `route_off` | The route is switched off |
| 403 | `model_not_allowed` | The route may not use that model, or a model in the request's own `models` list |
| 400 | `invalid_request` (`models`) | The request sends its own `models` list for a model BaseRouter sends elsewhere |
| 400 | `invalid_request` | The body is not JSON (or, for a transcription, not a form either), names no model, names something that is not a model id, or (in a form) names more than one; a video job with `callback_url`, or a bad `index` |
| 404 | `not_found` | A video job id this route did not start |
| 413 | `request_too_large` | The body is larger than `BASEROUTER_MAX_REQUEST_MB`; `metadata.max_bytes` has the limit. The management API (`/api`) takes up to 1 MB |
| 503 | `no_provider` | No provider has been added |
| 502 | `provider_unreachable` | OpenRouter could not be reached |
| 502 | `provider_refused_key` | OpenRouter did not accept the key BaseRouter holds for it |

## Management API

Everything under `/api` except `status`, `setup` and `login` needs a session: the `token` from `setup` or `login`, sent as `Authorization: Bearer <token>`, or the cookie those two answers set. A session lasts thirty days. Passwords are checked one at a time; five wrong ones in a row close sign-in for a minute, for everyone (a session already open stays open). The panel and `/api` answer only to the names in `BASEROUTER_ALLOWED_HOSTS` (and this machine's), and refuse a request from a page on another site. Over HTTPS the session cookie is `Secure`.

| Request | Does |
|---|---|
| `GET /api/status` | Says whether a password is set |
| `POST /api/setup` `{password}` | Sets the password, once |
| `POST /api/login` `{password}`, `POST /api/logout` | Starts and ends a session |
| `GET /api/providers` | Lists providers: status, last four characters of the key, number of models |
| `POST /api/providers` `{kind: "openrouter", key}` | Tests the key, then adds the provider |
| `POST /api/providers/:id/test` | Tests it again |
| `DELETE /api/providers/:id` | Removes it |
| `GET /api/state` | Everything the panel draws, in one answer: spend today, this month and per day for the week, providers, routes, the last 100 requests, and the last 60 kept images, sounds and videos each |
| `GET /api/models` | BaseRouter's models: `id`, `name` (what apps send), what it `makes`, and `from`, its sources in order (`{provider, model, via}`) |
| `POST /api/models` `{name?, from}` | Makes a model. Without a name it is named after its first source's model id |
| `PATCH /api/models/:id` `{name?, from?}` | Renames it (the routes that list it follow; apps that send the old name are refused) or changes its sources |
| `DELETE /api/models/:id` | Deletes it; the routes that list it lose it |
| `GET /api/offers` | What the provider offers, to find models in, in OpenRouter's order: for each, `id`, `name`, what it `makes` (`text`, `image`, `speech`, `transcription`, `video`), what it `takes`, its `context`, its price per token read (`in`) and written (`out`) for text models, its lowest price per second (`perSecond`) for video models, and whether it is `free`; and which `provider` offers them. Models the gateway cannot use (embeddings, reranking, moderation) are left out. Asked of OpenRouter once in ten minutes |
| `GET /api/offers/endpoints?model=<id>` | Where one of OpenRouter's models can come from: its providers for it, each with its `tag` (what a source's `via` names), `name`, `tier`, prices per token (`in`, `out`), `context` and whether it works right now (`up`). Asked once in ten minutes per model |
| `GET /api/routes` | Lists routes with what each spent today and this month; `models` are the names of the models each may use |
| `POST /api/routes` `{name, budget, models?, icon?, color?}` (`models`: names of models it may use) | Makes a route and gives its key, once. `icon` and `color` are how the panel draws it |
| `PATCH /api/routes/:id` `{budget?, enabled?, models?, keepMedia?}` | Changes the budget, switches it on or off, changes its models, switches keeping its images, sound and video |
| `POST /api/routes/:id/key` | Replaces its key; the old one stops working at once. Gives the new key, once |
| `DELETE /api/routes/:id` | Removes it; its requests stay in the list |
| `GET /api/requests?route=&limit=&before=` | Lists requests, newest first |
| `GET /api/media?kind=&route=&limit=&before=` | Lists kept images (`kind=image`), sounds (`kind=audio`) and videos (`kind=video`), newest first, with what each request cost, and the room they take (`space`) |
| `GET /api/media/:id` | One file's bytes, or a `Range` of them; `?download=1` to save it |
| `DELETE /api/media/:id` | Deletes it |
| `POST /api/password` `{current, password}` | Changes the password; every other session ends |
| `GET /api/export` | Routes, providers without their keys, models, every request, and what is known about each kept image and sound (not the files themselves: those are in `data/media/`), as one JSON file |

## What is kept, and how

Everything is in `gateway/data/`, which git ignores.

- `baserouter.sqlite` holds providers, models, routes, requests, video jobs, settings and sessions.
- A route's key is never stored. Only its SHA-256 hash and its last four characters are. A lost key cannot be recovered.
- A provider's key is stored encrypted (AES-256-GCM) and is never given back by the API.
- The folder and everything in it can be read by BaseRouter's own user only (it sets this on every start).
- `secret.key` is the key that encryption uses. It is made on the first start and only its owner can read it. Back it up together with the database: without it, providers have to be added again. Keeping it beside the database protects a copied or backed-up database file; it does not protect against someone who can read the whole folder.
- The admin password is stored as an Argon2 hash.
- `media/` holds the images, sound and video routes made, unless switched off (see "Kept images, sound and video" above). The words that asked for each are kept with it. Before sound was kept this folder was `images/`; it is renamed on the first start.
- Other prompts and answers are not stored or logged, and neither are sound or files, sent or generated.

## Settings

All optional, as environment variables.

| Variable | Default | |
|---|---|---|
| `BASEROUTER_PORT` | `4141` | |
| `BASEROUTER_HOST` | `127.0.0.1` | Only this machine can reach it. Set `0.0.0.0` to let other machines on your network connect, and set the admin password before you do: the first one to reach a fresh gateway sets it. |
| `BASEROUTER_DATA_DIR` | `gateway/data` | |
| `BASEROUTER_ALLOWED_HOSTS` | | The names the panel and `/api` may be reached by, comma-separated, besides `localhost`, `127.0.0.1` and `BASEROUTER_HOST`: the machine's name or address on your network (`baserouter.home.arpa,192.168.1.20`). Any other name is refused with HTTP 403, so a web page cannot point a name of its own at the gateway (DNS rebinding). |
| `BASEROUTER_DOMAIN` | | The name the gateway is reached by through Caddy; counted as an allowed name. |
| `BASEROUTER_PANEL_DIR` | `design/prototype` | The folder the panel is served from. Only `index.html` and the `core/`, `skins/` and `fonts/` folders in it are served; the design pages beside them are not. |
| `BASEROUTER_MAX_REQUEST_MB` | `64` | The largest request body the one address takes, in megabytes. Files travel inside requests as base64, which is a third larger than the file. |
| `BASEROUTER_MEDIA_MAX_MB` | `1024` | The most room kept images, sound and video may take together, in megabytes; past it the oldest go first. `0` keeps none. |
| `BASEROUTER_OPENROUTER_URL` | `https://openrouter.ai/api/v1` | For trying the gateway without a real key, below |

## Tests

```bash
bun test
```

These run without a network. The proxy and the management API are tested over real HTTP against `test/fake-openrouter.ts`, a stand-in that answers from the files in `test/fixtures/`. Those files are written by hand from OpenRouter's API reference and compared with real answers; they are not captures of real traffic. [test/fixtures/README.md](test/fixtures/README.md) says which were compared.

To test against the real OpenRouter, put a key in `.env` at the top of the repository (git ignores it) as `OPENROUTER_API_KEY=...`, then:

```bash
bun --env-file=../.env test live
```

That sends three short requests, one of them through a fallback, and asks for the model list. It costs a fraction of a cent. `BASEROUTER_LIVE_MODEL` picks the model. With `BASEROUTER_LIVE_MEDIA=1` it also makes an image in a chat stream, an image through `/images/generations` and a sentence of speech, for about four cents. With `BASEROUTER_LIVE_VIDEO=1` it makes a one-second 480p video through `/videos` and follows it to the end (`BASEROUTER_LIVE_VIDEO_MODEL` picks the model).

`bun run typecheck` checks the types.

### Try it without a real key

```bash
bun run demo
```

This starts the gateway and its panel in front of the stand-in, with a new, empty database each time. Open http://localhost:4141/, choose any password of 8 characters or more, and add OpenRouter with the key `fixture-openrouter-key`.

## Not here yet

- Providers other than OpenRouter. There is no provider interface on purpose; it will grow out of the second provider.
- Changing a route's name after it is made.
- Webhooks for video jobs. A request with `callback_url` is refused (HTTP 400), since OpenRouter would send the job's end, signed links included, straight to it; ask `GET /v1/videos/:id` instead.
- Embeddings, image edits (`/images/edits`), and OpenRouter's own `/responses` API.
- With your own provider keys inside OpenRouter (BYOK), `usage.cost` is what OpenRouter charged, not what the provider behind it charged. Only the first is counted.
- A cost lookup that is still waiting when the gateway stops is not picked up again on the next start.
