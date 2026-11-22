# Fixtures

Responses in the shape OpenRouter sends, so the tests run without a network.

They are written by hand from OpenRouter's API reference (streaming, usage accounting, errors, generation, key, models). They are not captures of real traffic: ids, costs and token counts are made up.

`chat.json` and `chat-stream.sse` were compared with real answers from OpenRouter on 2026-11-22 and follow them: the same fields, the white space a plain answer starts with, keep-alive lines before the first chunk, a reasoning chunk before the text, and the usage chunk before `[DONE]`. The two failure streams, `chat-error-200.json` and `generation.json` follow the reference only; those cases were not seen live.

The media fixtures were made on 2026-11-22 from real answers, shortened: every image is replaced by the same 1×1 PNG, the megabyte of encrypted reasoning that Gemini sends before its image by a short stand-in, and ids by fixture ids. `chat-image.json` (model `recraft/recraft-v4.1-flash`), `chat-image-stream.sse` (`google/gemini-3.1-flash-lite-image`) and `images.json` (`recraft/recraft-v4.1-flash`) keep the real fields, order and costs. The real `/audio/speech` answer was MP3 bytes with `X-Generation-Id: gen-tts-…`, and its cost came from `/generation`; `speech.mp3` is made-up bytes, not sound, starting with an `ID3` header (the real one started with an MP3 frame sync, `FF F3`; both are recognised), and `generation-speech.json` is written from the reference with the cost and tokens seen live. `transcription.json` and `images-stream.sse` follow the reference only; they have not been compared with real answers yet.

| File | What it stands for |
|---|---|
| `chat.json` | A plain completion, with `usage.cost`, after the white space OpenRouter sends while it waits |
| `chat-stream.sse` | A streamed completion: keep-alive comment lines, a reasoning chunk, text with multi-byte characters, the usage chunk, `[DONE]` |
| `chat-stream-error.sse` | A stream that fails after HTTP 200: a top-level `error` and `finish_reason: "error"` |
| `chat-stream-no-usage.sse` | A stream that breaks off before the usage chunk |
| `chat-error-200.json` | A plain request that fails after HTTP 200: only an `error` and the generation id |
| `generation.json` | `GET /generation?id=` for the stream that broke off |
| `key.json`, `models.json` | `GET /key` and `GET /models` |
| `error-401.json`, `error-429.json` | Errors before a response starts |
| `chat-image.json` | A plain chat answer with an image in `message.images` |
| `chat-image-stream.sse` | A streamed chat answer: encrypted reasoning, then the image in `delta.images`, then the usage chunk |
| `images.json` | `POST /images`: `data[].b64_json` and `usage.cost`; the generation id is only in the `X-Generation-Id` header |
| `images-stream.sse` | `POST /images` with `stream: true`: a partial image, then `image_generation.completed` with the usage |
| `speech.mp3` | Stands in for the bytes of `POST /audio/speech`; not real audio |
| `generation-speech.json` | `GET /generation?id=` for that speech |
| `transcription.json` | `POST /audio/transcriptions`: `text`, and `usage` with `input_tokens`, `output_tokens` and `cost` |
| `video-start.json` | `POST /videos`: HTTP 202, white space first, then `id`, an absolute `polling_url` and `status: "pending"` |
| `video-in-progress.json` | `GET /videos/:id` while the job runs: `status_detail` and `progress` |
| `video-completed.json` | `GET /videos/:id` once done: `unsigned_urls`, signed storage `urls` with `expires_at`, and `usage.cost` |
| `video-failed.json` | `GET /videos/:id` for a job that failed: `status: "failed"` and `error` |
| `video.mp4` | Stands in for `GET /videos/:id/content`: the real answer's `ftyp` box, then made-up bytes; not a playable video |
| `videos-models.json` | `GET /videos/models`, two models, shortened |

The video fixtures were made on 2026-11-22 from real answers of three video models, with fixture ids and the signed link's signature and account replaced: the white space before the first answer, the absolute links, `status_detail`, `generation_id` and `usage` are as seen. The finished video came as `video/mp4` with no `Content-Length` and no support for ranges. `video-failed.json` and `videos-models.json` follow the reference; a failed job was not seen live.

Raw PCM from `/audio/speech` (`response_format: "pcm"`) comes with the content type `audio/pcm;rate=24000;channels=1`, chunked, as real answers showed; the stand-in answers the same way (`test/fake-openrouter.ts`, `PCM`). Google's Gemini voices, which offer only PCM, have not been compared with real answers yet.
