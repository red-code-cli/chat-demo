# RedCode server

Hono backend that hosts OpenCode and exposes a small, authenticated API for the
RedCode frontend. The browser never talks to OpenCode or to a model provider
directly.

## Security model

- The public surface is this Hono server. The embedded OpenCode process binds to
  `127.0.0.1` on a random port and is protected with a random basic-auth password.
- Every `/api/*` route requires `Authorization: Bearer <APP_AUTH_TOKEN>`. `/health`
  is public and contains no secrets.
- CORS is limited to `ALLOWED_ORIGINS`. Any other browser origin is rejected.
- Embedded OpenCode gets isolated `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, and
  `XDG_STATE_HOME` directories. It does not read the user's global OpenCode
  config, credentials, MCP servers, or database.
- Logs contain request metadata and error messages, never bearer tokens, provider
  keys, or prompt text.
- `edit` and `bash` permissions are set to `allow` in the embedded inline config.
  Remote mode verifies the remote permission policy and logs a warning when it is
  not `allow`; the remote operator owns that config. Running with `allow` means
  tools execute without an approval prompt, so only point `WORKSPACE_ROOT` at a
  directory you are willing to let the agent modify.

## Requirements

- Node.js 22.12 or newer
- pnpm 12
- The pinned CLI `opencode-ai@1.19.6`, installed by `pnpm install`. This is
  required for embedded mode. A system `opencode` v2 CLI is not compatible with
  the stable V1 SDK.

## Setup

```bash
pnpm install
cp server/.env.example server/.env
# edit server/.env
pnpm dev:server
```

`dev:server`, `build:server`, and `test:server` are thin root wrappers around the
`server` workspace package. The root frontend scripts are unchanged.

## Scripts

Run from the repository root:

| Command | What it does |
| --- | --- |
| `pnpm dev:server` | `tsx watch src/index.ts` in `server/` |
| `pnpm build:server` | TypeScript build to `server/dist/` |
| `pnpm test:server` | Vitest unit and route tests with a mocked gateway |
| `pnpm --filter @redcode/server start` | Run the built server |
| `pnpm --filter @redcode/server typecheck` | Strict typecheck |
| `pnpm --filter @redcode/server smoke` | Manual smoke test against real OpenCode |

The smoke test is intentionally not part of CI. It needs `OPENCODE_MODEL` and,
for embedded mode, `OPENCODE_PROVIDER_API_KEY`. It creates a session, subscribes
to events, sends a short prompt, and prints the assistant reply.

## Environment

See `server/.env.example` for the annotated list. Required variables:

- `APP_AUTH_TOKEN`
- `ALLOWED_ORIGINS`
- `WORKSPACE_ROOT`

Required when `OPENCODE_MODE=remote`:

- `OPENCODE_BASE_URL`

Optional:

- `HOST` (default `127.0.0.1`)
- `PORT` (default `8787`)
- `OPENCODE_MODE` (default `embedded`)
- `OPENCODE_MODEL`
- `OPENCODE_PROVIDER_API_KEY`
- `OPENCODE_SERVER_PASSWORD` (remote mode)
- `OPENCODE_DATA_DIR` (default `server/.data/opencode`)
- `LOG_LEVEL` (default `info`)
- `TRUST_PROXY` (default `false`)

Invalid or missing values stop startup with a list of the offending variables.

## Ports and start order

- Hono listens on `HOST:PORT` (default `127.0.0.1:8787`).
- Embedded mode starts the pinned OpenCode CLI on `127.0.0.1` with a free random
  port. No OpenCode port is exposed publicly.
- Remote mode expects `OPENCODE_BASE_URL` to be reachable before startup. The
  server still starts if it is down; `/health` reports `degraded` and API calls
  return `502`.

## API

All `/api/v1` routes require a bearer token. Errors always use:

```json
{
  "error": {
    "code": "CODE",
    "message": "Human readable message.",
    "requestId": "uuid"
  }
}
```

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Public health and OpenCode reachability |
| GET | `/api/v1/meta` | Server/SDK versions, providers, models, default model |
| GET | `/api/v1/sessions` | List sessions |
| POST | `/api/v1/sessions` | Create a session (`{ "title": "..." }`) |
| GET | `/api/v1/sessions/:id` | Get a session |
| DELETE | `/api/v1/sessions/:id` | Delete a session |
| POST | `/api/v1/sessions/:id/prompt` | Start an async prompt (`{ "text": "...", "model?": { "providerID": "...", "modelID": "..." } }`) |
| POST | `/api/v1/sessions/:id/abort` | Abort the current run |
| POST | `/api/v1/sessions/:id/permissions/:permissionId` | Reply `once`, `always`, or `reject` |
| GET | `/api/v1/events` | SSE stream; optional `?session=<id>` filter |

Every request gets an `X-Request-Id` response header. The same value is in the
error body. Optional `?directory=` values must resolve to an existing directory
inside `WORKSPACE_ROOT`; traversal and symlink escapes are rejected.

SSE uses the `Authorization` header, so browser clients must use `fetch` with a
streaming body. `EventSource` cannot set that header. The stream sends
`: heartbeat` comments every 15 seconds and closes the upstream subscription when
the client disconnects.

## Embedded data directory

Embedded mode stores its database, config, and state under
`OPENCODE_DATA_DIR` (default `server/.data/opencode`). Do not point this at the
same directory as a system OpenCode v2 install: v1 and v2 databases are not
interchangeable. If you see:

```text
Database is not empty and has no session table
```

the embedded server is sharing a v2 database. Delete the embedded data directory
only if you do not need its sessions, or set a fresh `OPENCODE_DATA_DIR`.

## Troubleshooting

- **`Failed to start embedded OpenCode`** — run `pnpm install` so
  `server/node_modules/.bin/opencode` exists; check the data directory permissions.
- **`OPENCODE_AUTH_FAILED`** — the remote server password is wrong, or the
  embedded provider key is missing or invalid.
- **`OPENCODE_UNAVAILABLE`** — the remote OpenCode server is down or the embedded
  process crashed. The embedded gateway retries a single restart after a failed
  health check; after that it needs a process restart.
- **CORS failures** — add the exact browser origin to `ALLOWED_ORIGINS` (scheme
  and port included, no path, no wildcard).
