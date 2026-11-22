# Fixtures

Responses in the shape OpenRouter sends, so the tests run without a network.

They are written by hand from OpenRouter's API reference (streaming, usage accounting, errors, generation, key, models). They are not captures of real traffic: ids, costs and token counts are made up.

`chat.json` and `chat-stream.sse` were compared with real answers from OpenRouter on 2026-11-22 and follow them: the same fields, the white space a plain answer starts with, keep-alive lines before the first chunk, a reasoning chunk before the text, and the usage chunk before `[DONE]`. The two failure streams, `chat-error-200.json` and `generation.json` follow the reference only; those cases were not seen live.

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
