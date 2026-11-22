# Fixtures

Responses in the shape OpenRouter sends, so the tests run without a network.

They are written by hand from OpenRouter's API reference (streaming, usage accounting, errors, generation, key, models). They are not captures of real traffic: ids, costs and token counts are made up.

`chat.json` and `chat-stream.sse` were compared with real answers from OpenRouter on 2026-11-22 and follow them: the same fields, the white space a plain answer starts with, keep-alive lines before the first chunk, a reasoning chunk before the text, and the usage chunk before `[DONE]`. The two failure streams, `chat-error-200.json` and `generation.json` follow the reference only; those cases were not seen live.

The media fixtures were made on 2026-11-22 from real answers, shortened: every image is replaced by the same 1×1 PNG, the megabyte of encrypted reasoning that Gemini sends before its image by a short stand-in, and ids by fixture ids. `chat-image.json` (model `recraft/recraft-v4.1-flash`), `chat-image-stream.sse` (`google/gemini-3.1-flash-lite-image`) and `images.json` (`recraft/recraft-v4.1-flash`) keep the real fields, order and costs. The real `/audio/speech` answer was MP3 bytes with `X-Generation-Id: gen-tts-…`, and its cost came from `/generation`; `speech.mp3` is made-up bytes, not sound, starting with an `ID3` header (the real one started with an MP3 frame sync, `FF F3`; both are recognised), and `generation-speech.json` is written from the reference with the cost and tokens seen live. `transcription.json` and `images-stream.sse` follow the reference only: the live transcription was refused because OpenRouter's up-front cost estimate was more than the account's remaining credit, and the image stream was not tried.

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

Raw PCM from `/audio/speech` (`response_format: "pcm"`) came live on 2026-11-22 from `hexgrad/kokoro-82m` and `microsoft/mai-voice-2.1` with the content type `audio/pcm;rate=24000;channels=1`, chunked; the stand-in answers the same way (`test/fake-openrouter.ts`, `PCM`). Google's Gemini voices, which offer only PCM, could not be tried: OpenRouter refused them up front because of the account's credit.
