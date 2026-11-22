# NanoGPT: provider notes

What NanoGPT's API does, read for one purpose: adding it to BaseRouter as the second provider. Nothing here is built yet.

Every statement carries where it comes from:

- **docs** — NanoGPT's documentation at `docs.nano-gpt.com` (all 133 pages and the OpenAPI file), read on 2026-11-22.
- **live** — seen in a real answer from `api.nano-gpt.com` on 2026-11-22: the model lists and refusals without a key, everything else with one.
- **open** — not known yet; see [Open questions](#open-questions).

Where the docs and a real answer disagree, the real answer is what is written here, and the disagreement is named. There are several.

## Hosts and keys

| | | |
|---|---|---|
| Host for requests with a key | `https://api.nano-gpt.com` | docs |
| Base URL for OpenAI clients | `https://api.nano-gpt.com/api/v1` | docs, live |
| The website host | `https://nano-gpt.com/api/v1` takes the same paths, but refuses a body over about 4.5 MB (HTTP 413) | docs |
| Largest JSON body on the API host | 32 MiB, for chat. BaseRouter's own default limit is 64 MB | docs |
| IPv6 | `api.nano-gpt.com` has an IPv4 address only | docs |
| Key | `Authorization: Bearer <key>` or `x-api-key: <key>`. New keys look like `sk-nano-<uuid>`; old ones are a plain UUID | docs, live |

Not everything is under `/api/v1`. Video, the balance and a model's provider list are under `/api` directly (`/api/generate-video`, `/api/check-balance`, `/api/models/{id}/providers`). So NanoGPT's root for BaseRouter is `https://api.nano-gpt.com/api`, and each call names its own path below it. (docs, live)

The same model list is also served under `/api/v1legacy` (reasoning in `reasoning_content`), `/api/v1thinking` (reasoning merged into the text), `/api/subscription/v1` and `/api/paid/v1`. BaseRouter needs none of them. (docs)

## The one address, mapped

| BaseRouter | OpenRouter today | NanoGPT | Same request? |
|---|---|---|---|
| `POST /v1/chat/completions` | `/chat/completions` | `/api/v1/chat/completions` | Yes, with the differences under [Chat](#chat) |
| `POST /v1/images/generations` | `/images` | `/api/v1/images/generations` or `/api/v1/images` | Mostly; see [Images](#images) |
| `POST /v1/audio/speech` | `/audio/speech` | `/api/v1/audio/speech` | Yes. The answer is the sound itself |
| `POST /v1/audio/transcriptions` | `/audio/transcriptions` | `/api/v1/audio/transcriptions` | Yes, as a form and as base64 JSON |
| `POST /v1/videos` and `GET /v1/videos/:id` | `/videos`, `/videos/:id` | `/api/generate-video`, `/api/video/status?requestId=` | No. Needs translating both ways; see [Video](#video) |
| `GET /v1/videos/:id/content` | `/videos/:id/content` | The link in the job's answer | No |
| `GET /v1/models` | `/models?output_modalities=all` | Five lists; see [Models](#models) | No |
| `GET /v1/videos/models` | `/videos/models` | `/api/v1/video-models` | No, another shape |

`/api/v1/videos` and `/api/v1/videos/models` do not exist: both answer HTTP 404 `route_not_available`. (live)

## Chat

NanoGPT takes OpenRouter's chat request. Its own page on moving from OpenRouter lists what differs; the points that touch the gateway: (docs)

- **Model ids.** Same `vendor/model` format for most; about half of OpenRouter's ids match exactly. Some ids are bare (`gemini-2.5-flash`), and they are case-sensitive.
- **The `models` fallback list** works with at most 4 ids, and moves on only after a provider failure or a prompt that is too long.
- **Silently ignored:** `route`, `transforms`, `plugins`, `HTTP-Referer`, `X-Title`. So `plugins: [{"id": "web"}]` runs no search and raises no error. `modalities` on a model that writes only text is ignored too. (docs, live)
- **Refused with HTTP 400:** `provider.data_collection: "deny"`, `"preset": "@preset/name"`, OpenRouter's provider slugs in `provider.only`.
- **Not available:** `:free`, `:exacto`, `:extended`, `openrouter/auto`, `~vendor/model-latest`.
- **Thinking can be off by default** where OpenRouter has it on.
- **The answer names no provider:** no `provider` field, no `native_finish_reason`. The answer's `model` keeps any suffix that was sent.
- **Key masking is on by default.** NanoGPT replaces strings that look like API keys in a prompt before the model sees them, and puts them back in the answer. Every chat answer says so in a header, `x-nanogpt-api-key-masking: on`. The request header `x-nanogpt-api-key-masking: off` switches it off. (docs, live)

A stream is OpenAI's: `chat.completion.chunk` lines, then `data: [DONE]`. (live)

- The last chunk before `[DONE]` carries `finish_reason`, the cost, and the usage when it was asked for, all in one chunk. There is no chunk with empty `choices`.
- A short answer came without keep-alive comment lines; whether a long wait brings them is open.
- A failure after HTTP 200 is a chunk with `finish_reason: "error"` and a top-level `error`, which is what the gateway's stream reader already looks for. (docs)

Model suffixes exist and are part of the model id as sent: `:online`, `:memory`, `:thinking`, `:reasoning-effort/<level>`, the routing ones (`:fast`, `:cheap`, `:nitro`, `:floor`, `:price`, `:throughput`, `:latency`, `:caching`, `:<provider-id>`) and a few more. The routing ones are billed like choosing a provider. (docs)

## What a request cost

Each endpoint says it differently, and one does not say it at all.

| Request | Where the cost is | In the answer's headers | |
|---|---|---|---|
| Chat, plain | `usage.cost` with `usage.currency`, and again in `x_nanogpt_pricing` | `X-Request-ID: req_<uuid>` | live |
| Chat, streamed | `x_nanogpt_pricing` in the last chunk, always. `usage` (with `cost`) is in that chunk only when the request asked for it | `X-Request-ID` | live |
| Images | Top-level `cost`, with `paymentSource` and `requestId`. Not always what was charged; see below | `X-Request-ID: media-image:…` | live |
| Transcriptions | `usage.cost` with `usage.currency` | None | live |
| Speech | Nowhere. The answer is sound | None | live |
| Video | `cost` in the answer that starts the job. Not in the answer about the finished job | None | live |

**Chat.**

- `x_nanogpt_pricing` holds `cost`, `currency`, `costUsd`, `requestId`, `inputTokens`, `outputTokens`, `paymentSource`. It came in every chat answer, asked for or not, so the gateway can learn a stream's cost without changing the body. (live)
- The docs say otherwise: that a stream carries no cost unless `stream_options.include_usage` or `usage: {"include": true}` is sent. Sending either adds `usage` to the last chunk; the cost was there without it. (docs against live)
- A plain answer carried `usage.cost` without being asked. The docs say this depends on billing finishing in time, and that `usage: {"include": true}` makes NanoGPT wait for it. (docs, live)
- When billing is slow, `x_nanogpt_pricing` holds an estimate marked `isEstimate: true`, which is not the charge. Not seen. (docs)
- `usage.currency` is `USD`, or `XNO` when the account pays from a Nano balance. A cost in XNO is not dollars; `x_nanogpt_pricing.costUsd` may be the way around that. (docs; `costUsd` live)
- `0` is a real value: a request covered by a subscription costs nothing. (docs)

**Asking afterwards.** `GET /api/v1/usage/requests/{id}` is NanoGPT's counterpart to OpenRouter's `/generation`.

- The id is the `X-Request-ID` response header. The answer's own `id` (`chatcmpl-…`) is not known to it: HTTP 404. (live)
- After a `models` fallback the id is `x_nanogpt_pricing.requestId` instead. (docs)
- The gateway must not send an `X-Request-ID` of its own on chat requests, or the lookup cannot find the charge. (docs)
- It knows chat and image requests, a few seconds after the answer. It does not know video jobs (HTTP 404 for a job's id), and speech and transcription answers carry no id to ask with. (live)
- The answer: `{"object": "request_billing", "cost": "<decimal string>", "currency", "cost_scope": "primary_charge", "usage": {"input_tokens", "output_tokens", …}}`. (live)
- HTTP 404 `billing_record_not_found` means "not known yet, or never": it comes with `Retry-After: 30` and never means the request was free. (docs, live)
- It works for 24 hours, with the same key only, 60 lookups a minute per key. (docs)

**Images: the answer's `cost` is not always the charge.** For one model, the `cost` in the answer was the model's list price, while the charge the lookup reported (and the balance and the usage totals agreed with) was 1.5 times that for a 512×512 image and 3 times that for the default size. For another model the two agreed. So for images the lookup is the figure to trust, and it is available. (live)

**Speech has no cost anywhere:** not in the answer, not in a header, and without a request id there is nothing to look up. What was charged matched characters sent × the model's `per_thousand_chars` for one model. For a dated variant of another it matched the undated model's price, 13 times the variant's own listed one. So a cost worked out from the list is an estimate, and has to be recorded as one. (live)

`GET /api/v1/usage` gives what the key spent per model and day, and does include speech. It is the only place speech spend shows up, but it is a total, not a figure per request. (live)

## Models

There is no single list. Each of these is `GET`, needs no key, and answers `{"object": "list", "data": [...]}`. Counts are from 2026-11-22. (live)

| List | Holds | Entries |
|---|---|---|
| `/api/v1/models` | Models that write text. Only `id`, `object`, `created`, `owned_by` | 606 |
| `/api/v1/models?detailed=true` | The same with everything else, plus paused entries | 614 |
| `/api/v1/image-models` (also `/api/v1/images/models`) | Image models | 264 |
| `/api/v1/video-models` | Video models | 222 |
| `/api/v1/audio-models` | Speech, music, transcription and other sound models | 125 |
| `/api/v1/embedding-models` | Embeddings; BaseRouter has no endpoint for these | 20 |

- The lists do not overlap: `/api/v1/models` holds text models only, and what a model makes is which list it is in. One id is in both the video and the audio list.
- In the audio list, `category` tells speech (`audio_tts`) from transcription (`audio_stt`), music (`audio_music`) and the rest. `?type=tts` means "everything that is not transcription", music included.
- What a text model takes is in `architecture.input_modalities` and in `capabilities` (`vision`, `video_input`, `audio_input`, `pdf_upload`).
- An entry with `available: false` is paused and answers HTTP 503. Entries that work have no `available` field.
- There are no `:free` or `:batch` entries. Entries ending in `:thinking` are models of their own, not a suffix to strip.
- Image ids can hold `:` and `@` (`runware:106@1`), and media ids up to four `/`. Every id in all four lists fits BaseRouter's rule for a model id.
- Some ids that are not listed still work (`google/gemini-2.5-flash` for the listed `gemini-2.5-flash`). (docs)
- `GET /api/models` (without `v1`) is a different thing: an internal dump with hidden and disabled entries. Not for finding models.
- What a video model takes (`duration`, `resolution`, switches of its own) is listed in its entry, under `supported_parameters.parameters`, with the values allowed.

**Prices come in several units.**

| Where | Unit |
|---|---|
| `pricing.prompt`, `pricing.completion` in the text list | US dollars per **million** tokens, as a number. OpenRouter gives dollars per token, as a string |
| Any field ending in `Per1kTokens`, and everything in `/api/models/{id}/providers` | US dollars per **thousand** tokens |
| Image models | `pricing.per_image`, by resolution, for most |
| Video models | More than twenty shapes: per second, per second by resolution, per video, per length, or only a minimum |
| Speech | `pricing.per_thousand_chars` for most |
| Transcription | `pricing.per_minute`, `per_second` |

Two text models have no token price at all, only a note that it varies. And a listed price is not always what is charged; see [What a request cost](#what-a-request-cost).

## Choosing who serves a model

OpenRouter's `provider` object works under the same field names, so a source's `via` can stay `provider.only`. What differs: (docs)

- It applies only to models that support choosing a provider, mostly open-weight ones.
- The ids are NanoGPT's own. One it does not know for the model is HTTP 400 `no_allowed_provider_for_model`. (live)
- Choosing a provider costs more: that provider's price plus a markup, normally 5%, and the request is billed from the balance even when a subscription would have covered it.

`GET /api/models/{id}/providers` (the id URL-encoded, `/` as `%2F`) lists them, without a key. `supportsProviderSelection` says whether the model can be pinned at all; each entry of `providers` has `provider` (the id to send), `displayName`, `available`, `pricing.inputPer1kTokens` and `outputPer1kTokens`, `maxInputTokens`, and measured speed and uptime. (live)

## Images

Two endpoints. Both take `{"model", "prompt"}` and gave the same answer. (live)

| | `/api/v1/images/generations` | `/api/v1/images` |
|---|---|---|
| What it is | OpenAI's shape. NanoGPT calls it the legacy route | NanoGPT's newer one, recommended for new work. The same path as OpenRouter's `/images` |
| `model` | Optional | Required |
| Images to work from | `imageDataUrl`, `imageDataUrls`, `maskDataUrl`: base64 data URLs only, 4 MB each | `input_references`: links or data URLs. Mixing in the fields on the left is refused |
| Size | `size` | `resolution` (`1k`, `2k`, `4k`), `aspect_ratio` |
| `stream`, `provider` | Not mentioned | Refused |

The answer, from either: `{"created", "data": [{"b64_json"}], "cost", "paymentSource", "remainingBalance", "requestId"}`. (live)

- `response_format` defaults to `b64_json`. With `url`, each entry is `{"url", "storageKey"}`: a signed link to NanoGPT's storage that opens without a key for 24 hours. The link and `storageKey` contain the account's id, so, like OpenRouter's signed video links, they should not reach a client. (live)
- `requestId` is the same as the `X-Request-ID` header, and is what the cost lookup takes.
- `remainingBalance` is the account's balance. It should not reach a client either.
- `created` is in milliseconds, not seconds as at OpenAI.
- Images are made in one request; there is no job to wait for.
- A refusal has its code twice: `{"error": {"message", "type", "code"}, "code"}`.

## Speech and transcriptions

**Speech**, `POST /api/v1/audio/speech`: `model`, `input`, `voice`, `response_format`, `speed`, `instructions`, `stream`. The answer is the sound, with no request id and no cost. (live)

- The format follows the model, not the request. One model asked for MP3 answered WAV, as `audio/x-wav`.
- The default format of an OpenAI voice is MP3, labelled `audio/mp3` (OpenRouter: `audio/mpeg`). The gateway tells what a file is from its first bytes, so the label does not matter.
- PCM is labelled just `audio/pcm`, without its rate. The gateway keeps PCM only when the content type names the rate, so NanoGPT's PCM would not be kept.
- Music models use the same endpoint; `input` is the prompt. (docs)
- A model that is gone answers HTTP 410. (docs)

**Transcriptions**, `POST /api/v1/audio/transcriptions`. (live)

- Accepted: a form with `file` and `model`; JSON with the sound as base64 in `input_audio: {"data", "format"}`, as OpenRouter takes it; JSON with `file_url`, which may be a `data:` URL.
- The answer: `{"text", "language", "duration", "usage": {"seconds", "type": "duration", "cost", "currency"}}`. `usage.cost` is where the gateway already looks.
- The docs show neither the base64 form nor the `usage` in the answer. (docs against live)

NanoGPT's older endpoint `/api/tts` answered with the sound as well, not with the JSON and cost its page describes, so it is no way to learn what speech cost. (docs against live)

## Video

A job, as at OpenRouter, but with other paths, other field names and other statuses. All of this was seen with one model, from start to finished video. (live)

**Start:** `POST /api/generate-video`.

- The body is flat: `model`, `prompt`, `duration` (seconds as a string: `"5"`), `aspect_ratio`, `resolution`, the model's own switches, and for a picture to start from `imageUrl` (a link) or `imageDataUrl` (base64, 4 MB at most). (docs, live)
- The answer is HTTP 202: `{"runId", "id", "requestId", "status": "pending", "model", "cost", "paymentSource", "seed", "eventsUrl", "statusTransport"}`. The three ids are the same, `vid_…`. There is no `X-Request-ID` header.
- `callback_url` exists. BaseRouter refuses it for OpenRouter, for the same reason it would here. (docs)

**Ask:** `GET /api/video/status?requestId=<id>` (or `runId=`), with the key that started the job.

- While it runs: `{"requestId", "model", "data": {"status": "IN_PROGRESS", "request_id"}}`.
- Once done: `{"data": {"status": "COMPLETED", "request_id", "output": {"video": {"url"}, "videoUrls": [...], "expiresAt"}, "videoUrl", "video_url"}, "seed"}`. No `cost`, and no `requestId` or `model` at the top any more.
- Statuses, in capitals: `IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `CANCELED`. Only `IN_PROGRESS` and `COMPLETED` were seen. (docs, live)
- A failed job has `data.error`, `data.userFriendlyError` and `data.isNSFWError`. (docs)
- A job of another account, or one that does not exist, is HTTP 404 `{"error": "Video generation request not found"}`.
- The OpenAPI file describes a different, flat answer with lower-case statuses. That is not what the endpoint sends. (docs against live)

**The video.**

- The link in the answer is a path, not a full address: `/api/generate-video/content?runId=…&model=…&variant=video-0&expires=…&sig=…`, the same in all four places it appears.
- It opens with the signature and no key, or with the key and no signature. Either way the answer is HTTP 302 to a signed link at NanoGPT's storage, which holds the account's id. Following it gives `video/mp4`. The key must not be sent along to the storage host.
- `output.expiresAt` is a day after the job ended; NanoGPT deletes the video then. (docs, live)
- A video can also be at the model's own provider, as a full address. Not seen. (docs)

**Cost:** charged when the job starts. The `cost` in the first answer was the whole charge, as the usage totals later showed. The docs say the finished job's answer carries the final cost; it did not. A job that fails is refunded. (docs against live; the refund is docs only)

## Account

| | | |
|---|---|---|
| Balance | `POST /api/check-balance` answers `{"usd_balance", "usd_spendable_balance", "usd_pending_usage", "nano_balance", "nanoDepositAddress"}`. `GET` is HTTP 405; without a key it is HTTP 401 `Invalid session`, as plain text | live |
| About the key | `GET /api/v1/api-keys/current`: `{"object": "api_key", "id", "name", "status": "active", "createdAt", "expiresAt", "limits", "usage": {"today", "thisWeek", "thisMonth"}, "allowedModels", …}`. The counterpart of OpenRouter's `/key` for testing a key | live |
| What this key spent | `GET /api/v1/usage?from=&to=&group_by=`: totals, per day and per model (by display name, not id), in UTC, with `costUsd`, `refundedUsd`, `netCostUsd`. This key only, not the account. Up to date within about a minute | docs, live |
| Subscription | `GET /api/subscription/v1/usage`: `active`, `state`, and under `routing` whether requests go to the subscription or the balance | live |

A NanoGPT key can carry its own daily, weekly and monthly limits, set at NanoGPT. Reaching one is HTTP 429 with `Retry-After`. (docs)

## Refusals

Three shapes, depending on the endpoint. (docs, live)

| Where | Shape |
|---|---|
| Most of `/api/v1` | `{"error": {"message", "type", "code", "param"}}`; `code` is a string. The gateway's reader of a provider's error message handles it |
| Older `/api` endpoints | `{"error": "Insufficient balance", "status": 402}` or `{"error": "Video generation request not found"}`: `error` is the message itself |
| Video and balance, without a valid key | Plain text: `Invalid session` |

A model NanoGPT does not have is HTTP 400 `model_not_supported`. (live)

What matters for trying a model's next source:

| Status | Means | Next source? |
|---|---|---|
| 401 | The key BaseRouter holds was refused | No, as today |
| 402 | The balance is used up | No, as today |
| 429 `authentication_rate_limited` | The key was refused so often that NanoGPT stopped checking it. A problem with the key, not with the load | No; treat like 401 |
| 429 `api_key_*_limit`, `api_account_monthly_usd_limit` | A limit set on the key or the account at NanoGPT | Yes, if the next source is another provider |
| 429 other, 500, 503 | Rate limit, outage | Yes |
| 400 | A model or provider NanoGPT cannot serve (OpenRouter: 404), but also any badly written request | Yes, as today |
| 410 | The model is gone | Yes |

## What the gateway would have to learn

Not a design: the places where today's code assumes OpenRouter, and what NanoGPT asks of each.

| Today | NanoGPT needs |
|---|---|
| One base URL for everything (`deps.upstream`), and only one provider may be added | A base per provider kind, and a second provider beside the first |
| The key is tested with `GET /key` | `GET /api/v1/api-keys/current` |
| Chat cost is `usage.cost`, in dollars | `usage.cost` when there, otherwise `x_nanogpt_pricing`; only when the currency is `USD`, and not when `isEstimate` is set |
| The stream reader parses, after the first token, only lines that mention `"usage"` or `"error"` | Also the line that mentions `"x_nanogpt_pricing"`, which is where a stream's cost is when the client did not ask for usage |
| A missing cost is asked for at `/generation?id=`, by the answer's `id` or `X-Generation-Id`, after a few seconds | `/api/v1/usage/requests/{X-Request-ID}`, by the header; a 404 says to wait 30 seconds |
| Images: the cost is `usage.cost` | The top-level `cost`, then checked against the lookup, which can be higher |
| An image answer goes to the client as it came | `remainingBalance` and `storageKey` say things about the account; signed links hold its id |
| Speech: the cost comes from `/generation` | Characters times the model's price, recorded as worked out and not as reported |
| Transcriptions | Nothing: the same request, and the cost where the gateway looks |
| One model list, prices in dollars per token | Five lists to join; dollars per million tokens; other units for images, video and sound |
| What `/v1/models` gives a client is OpenRouter's own entry | NanoGPT's entries look different. A route with models from both would get two shapes unless the gateway brings them to one |
| A source's `via` is allowed for OpenRouter only, checked against OpenRouter's slugs | Also for NanoGPT, for models that can be pinned, with ids from `/api/models/{id}/providers`. It costs 5% more |
| Video: OpenRouter's request, statuses and links are passed on nearly as they are | Translate the request, the statuses and the answer both ways, so a client sees one kind of video job whichever provider made it |
| A video's cost is recorded when the job ends | It is known when the job starts, and taken back if the job fails |
| A video is fetched from `/videos/:id/content` with the key | From the path in the job's answer, with the key, then from where that redirects, without it |
| A video job is asked about at the first provider | A job has to remember which provider it was started at |
| Refused: every status but 401 and 402 moves on to the next source | Also stop on 429 `authentication_rate_limited` |

## An earlier set of notes, checked

Notes from an earlier attempt, written for a different proxy, were checked against the above.

| The note said | Now |
|---|---|
| The model list is `GET {base}/models`, with `?detailed=true` for prices | Right |
| Separate lists at `/image-models`, `/video-models`, `/audio-models` | Right. There are also `/embedding-models` and a newer `/images/models` |
| 1045 models (chat 369, vision 268, image 213, video 138, audio 31) | Out of date: 606 text, 264 image, 222 video, 125 audio |
| Video is at `/api/generate-video` and `/api/video/status?requestId=`, outside `/api/v1` | Right |
| Video statuses `IN_QUEUE` … `CANCELED`, the video at `data.output.video.url` | Right, now seen live. The link is a path that redirects, not a full address |
| A finished video job's cost is at `data.cost` | Wrong, though the docs say so too. The cost is in the answer that starts the job |
| A picture to start a video from: `imageDataUrl` or `imageUrl` | Right |
| Use the host `nano-gpt.com` | Works, but `api.nano-gpt.com` is now the one to use: larger bodies, longer requests |
| The answer has a `cost` field | Right for images and for starting a video. Chat: `usage.cost` and `x_nanogpt_pricing.cost`. Speech: nothing |
| Without a cost, fall back to an estimate from tokens, marked as one | Still sound, and needed for speech (from characters). For chat and images NanoGPT has a lookup by request id |
| Balance at `POST /api/check-balance`; spend at `GET /api/v1/usage` | Right |
| The body's `provider` object is NanoGPT's to read: `order`, `only`, `ignore`, `max_price` | Right, for models that can be pinned, at a 5% markup |
| Suffixes `:fast`, `:cheap`, `:caching` | Right, among others |
| Images to work from go in `imageDataUrl` and `imageDataUrls` | Right for `/api/v1/images/generations`. The newer `/api/v1/images` wants `input_references` and refuses a mix |
| `nano-banana-2` is an image model | Right; it is in the image list |
| `/v1/messages` and `/v1/messages/count_tokens` exist | Right. BaseRouter has no such endpoint |
| A `wrong_endpoint` error, `nanogpt/<model>` names, an `X-Provider` header of the proxy's own | Those were the earlier proxy's, not NanoGPT's. NanoGPT has a header of its own called `X-Provider`, which pins one of its providers |

## Open questions

1. **A cost in XNO:** what an account that pays from a Nano balance reports, and whether `x_nanogpt_pricing.costUsd` is dollars then.
2. **An estimated cost:** when `isEstimate` appears in practice, and how long the lookup then takes to know the charge.
3. **Why an image's charge can be above its `cost`:** seen with one model; whether size is the rule, and for which models.
4. **Images from chat:** one model in the text list is priced for making images. Not tried; nothing says how its images come back.
5. **A failed video job:** its real answer, and how the refund shows.
6. **A video at the model's own provider:** what that link looks like, and how long it lives.
7. **Keep-alive lines** in a stream that waits long for its first token.
8. **A stream that fails midway:** the docs' shape, not seen.
