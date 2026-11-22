# BaseRouter gateway

The part of BaseRouter that requests go through. This is its first slice: one provider (OpenRouter), the one address, budgets, a record of every request, and the small API the panel will talk to. There is no panel wired to it yet.

## Run it

You need [Bun](https://bun.sh) 1.4 or newer.

```bash
cd gateway
bun install
bun start
```

It listens on `http://localhost:4141`, and the one address is `http://localhost:4141/v1`. There is nothing to configure and no other database to install; everything it keeps is in `gateway/data/`.

## First run

Until the panel is wired up, the first steps are four requests.

1. Set the admin password. This works once; afterwards `POST /api/login` with the same body gives a new session.

   ```bash
   curl http://localhost:4141/api/setup -H "Content-Type: application/json" -d '{"password": "choose a password"}'
   ```

   Keep the `token` from the answer for the next steps:

   ```bash
   export BASEROUTER_ADMIN=<token>
   ```

2. Add OpenRouter. The key is tested first and is not stored if the test fails. Reading it from a variable keeps it out of the command itself.

   ```bash
   curl http://localhost:4141/api/providers -H "Authorization: Bearer $BASEROUTER_ADMIN" -H "Content-Type: application/json" -d "{\"kind\": \"openrouter\", \"key\": \"$OPENROUTER_API_KEY\"}"
   ```

3. Make a route. The answer contains the route's `key`. It is shown this once and cannot be read again.

   ```bash
   curl http://localhost:4141/api/routes -H "Authorization: Bearer $BASEROUTER_ADMIN" -H "Content-Type: application/json" -d '{"name": "Home assistant", "budget": 10, "models": ["openai/gpt-5-mini"]}'
   ```

4. Connect, with the route's key in `BASEROUTER_KEY`:

   ```bash
   curl http://localhost:4141/v1/chat/completions \
     -H "Authorization: Bearer $BASEROUTER_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model": "openai/gpt-5-mini", "messages": [{"role": "user", "content": "Hello"}]}'
   ```

Anything that speaks the OpenAI API works the same way: point its base URL at the one address and give it the route's key.

## What it does

**The one address.** `POST /v1/chat/completions` and `GET /v1/models`, opened with a route's key. The request body goes to OpenRouter as the client wrote it and the answer comes back as OpenRouter sent it. A stream is passed on byte for byte, keep-alive lines included. If the client goes away, the request to OpenRouter is cancelled.

**Budgets.** A budget is monthly and starts again on the first day of the month, at midnight in the local time of the machine the gateway runs on. A route that has used up its budget is refused with HTTP 402 before anything is sent to the provider; a switched-off route is refused with HTTP 403. The check happens when a request starts, so requests already running can take a route a little past its budget.

**A row per request.** Route, the model asked for and the model that answered, tokens, cost, where the cost came from, time to the first token, total time, and what went wrong if something did. The cost is the `usage.cost` OpenRouter reports, read from the stream as it passes. When an answer ends without it (a stream that broke off, a client that left), the gateway asks OpenRouter for that request's cost a few seconds later. A request whose cost stays unknown counts as nothing towards the budget.

**A model list per route.** A route made with `models` may only use those, and only sees those in `/v1/models`. A route with an empty list may use any model.

### Refusals

Errors from the gateway itself have the shape OpenAI clients expect: `{"error": {"message", "type", "code"}}`. Errors from OpenRouter are passed on unchanged.

| Status | `code` | Meaning |
|---|---|---|
| 401 | `unknown_key` | The key is missing or is not a route's key |
| 402 | `budget_used_up` | The route has used up its monthly budget; `metadata` has the amounts and the date it starts again |
| 403 | `route_off` | The route is switched off |
| 403 | `model_not_allowed` | The route may not use that model |
| 400 | `invalid_request` | The body is not JSON or names no model |
| 503 | `no_provider` | No provider has been added |
| 502 | `provider_unreachable` | OpenRouter could not be reached |
| 502 | `provider_refused_key` | OpenRouter did not accept the key BaseRouter holds for it |

## Management API

Everything under `/api` except `status`, `setup` and `login` needs a session: the `token` from `setup` or `login`, sent as `Authorization: Bearer <token>`, or the cookie those two answers set. A session lasts thirty days. Five wrong passwords in a row close sign-in for a minute.

| Request | Does |
|---|---|
| `GET /api/status` | Says whether a password is set |
| `POST /api/setup` `{password}` | Sets the password, once |
| `POST /api/login` `{password}`, `POST /api/logout` | Starts and ends a session |
| `GET /api/providers` | Lists providers: status, last four characters of the key, number of models |
| `POST /api/providers` `{kind: "openrouter", key}` | Tests the key, then adds the provider |
| `POST /api/providers/:id/test` | Tests it again |
| `DELETE /api/providers/:id` | Removes it |
| `GET /api/routes` | Lists routes with what each spent today and this month |
| `POST /api/routes` `{name, budget, models?}` | Makes a route and gives its key, once |
| `PATCH /api/routes/:id` `{budget?, enabled?}` | Changes the budget, switches it on or off |
| `DELETE /api/routes/:id` | Removes it; its requests stay in the list |
| `GET /api/requests?route=&limit=&before=` | Lists requests, newest first |

## What is kept, and how

Everything is in `gateway/data/`, which git ignores.

- `baserouter.sqlite` holds providers, routes, requests, settings and sessions.
- A route's key is never stored. Only its SHA-256 hash and its last four characters are. A lost key cannot be recovered.
- A provider's key is stored encrypted (AES-256-GCM) and is never given back by the API.
- `secret.key` is the key that encryption uses. It is made on the first start and only its owner can read it. Back it up together with the database: without it, providers have to be added again. Keeping it beside the database protects a copied or backed-up database file; it does not protect against someone who can read the whole folder.
- The admin password is stored as an Argon2 hash.
- Prompts and answers are not stored or logged.

## Settings

All optional, as environment variables.

| Variable | Default | |
|---|---|---|
| `BASEROUTER_PORT` | `4141` | |
| `BASEROUTER_HOST` | `127.0.0.1` | Only this machine can reach it. Set `0.0.0.0` to let other machines on your network connect, and set the admin password before you do: the first one to reach a fresh gateway sets it. |
| `BASEROUTER_DATA_DIR` | `gateway/data` | |
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

That sends two short requests and asks for the model list. It costs a fraction of a cent. `BASEROUTER_LIVE_MODEL` picks the model.

`bun run typecheck` checks the types.

### Try it without a real key

Run the stand-in in one terminal and the gateway, pointed at it, in another. Then follow "First run" with `fixture-openrouter-key` as the provider's key.

```bash
bun test/fake-openrouter.ts
```

```bash
BASEROUTER_OPENROUTER_URL=http://127.0.0.1:4142 BASEROUTER_DATA_DIR=/tmp/baserouter-try bun start
```

## Not here yet

- The panel is not wired to this API.
- Providers other than OpenRouter. There is no provider interface on purpose; it will grow out of the second provider.
- Trying a route's next model when the first fails, and changing a route's models or name after it is made.
- Changing the admin password, and export.
- Images, audio, video and embeddings.
- With your own provider keys inside OpenRouter (BYOK), `usage.cost` is what OpenRouter charged, not what the provider behind it charged. Only the first is counted.
- A cost lookup that is still waiting when the gateway stops is not picked up again on the next start.
