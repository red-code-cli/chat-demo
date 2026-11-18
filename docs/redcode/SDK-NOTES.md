# OpenCode SDK notes (V1)

Reference for every later phase. Everything below was checked against the
installed package types and a running server, not against memory.

## Versions and compatibility

| Component | Version | Why |
| --- | --- | --- |
| `@opencode-ai/sdk` | `1.19.6` | Latest stable V1 SDK |
| `opencode-ai` (CLI) | `1.19.6` | Matching V1 server used by embedded mode |
| Node.js | 22.12+ | Matches the server `engines` field |

The machine also has a system `opencode` CLI at `/root/.opencode/bin/opencode`
with version **2.3.2**. That binary serves the **V2** API at `/api` with
`{ "data": ... }` envelopes and basic auth; it does not expose the V1 `/session`
routes. The stable V1 SDK cannot talk to it. Embedded mode therefore relies on the
pinned `opencode-ai@1.19.6` dependency and puts
`server/node_modules/.bin` first on `PATH` before spawning. Do not replace this
with the system CLI.

## Creating a client

The package exports two families:

```ts
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";
```

- `createOpencode(options?)` starts a server and returns `{ client, server }`.
- `createOpencodeServer(options?)` starts only the server and returns
  `{ url, close() }`.
- `createOpencodeClient(config?)` creates a client for an existing server.

The RedCode gateways use the lower-level pair because the gateway needs to set
the workspace directory, the embedded basic-auth password, and a request timeout
fetch. `createOpencode()` does not expose those settings.

Embedded shape:

```ts
const server = await createOpencodeServer({
  hostname: "127.0.0.1",
  port: freePort,
  timeout: 20_000,
  config: {
    model: "deepseek/deepseek-chat",
    permission: { edit: "allow", bash: "allow" },
    provider: { deepseek: { options: { apiKey: process.env.OPENCODE_PROVIDER_API_KEY } } },
  },
});

const client = createOpencodeClient({
  baseUrl: server.url,
  directory: "/absolute/workspace",
  headers: { Authorization: "Basic " + Buffer.from(`opencode:${password}`).toString("base64") },
});
```

Remote shape is the same client without the spawn:

```ts
const client = createOpencodeClient({
  baseUrl: process.env.OPENCODE_BASE_URL,
  directory: process.env.WORKSPACE_ROOT,
  ...(password ? { headers: { Authorization: basicAuth(password) } } : {}),
});
```

`directory` makes the client send `x-opencode-directory` (and a `directory` query
for GET requests), so the server works inside the configured workspace even when
the Node process was started elsewhere.

## Method call style

Every generated method takes one object with `path`, `query`, and `body` keys,
mirroring the HTTP route. Examples that exist in `1.19.6`:

```ts
await client.session.create({ body: { title: "New chat" }, query: { directory } });
await client.session.list({ query: { directory } });
await client.session.get({ path: { id }, query: { directory } });
await client.session.delete({ path: { id }, query: { directory } });
await client.session.promptAsync({
  path: { id: sessionID },
  body: {
    parts: [{ type: "text", text: "Hello" }],
    model: { providerID: "deepseek", modelID: "deepseek-chat" },
  },
  query: { directory },
});
await client.session.abort({ path: { id }, query: { directory } });
```

Results default to the `"fields"` style:

```ts
const result = await client.session.list();
// { data, error, request, response }
```

The client does not throw on HTTP errors by default. Check `result.error` and
`result.response.ok`. Passing `throwOnError: true` changes the result to a plain
data value or a thrown error. The gateway uses the default style and maps failures
to `GatewayError` once, so routes never see raw SDK shapes.

Other useful calls:

- `client.provider.list()` -> `{ all, default, connected }`; no API keys in the
  response. `all[].models` is a record, not an array.
- `client.config.get()` -> full config, **including provider API keys**. Never
  return this from an HTTP route or log it.
- `client.path.get()` -> `{ home, state, config, worktree, directory }`; used as a
  cheap health probe because V1 has no dedicated health method.
- `client.app.agents()` -> agent list; useful in Phase 3.

## Event stream

The global event stream is an SSE endpoint wrapped as an async generator:

```ts
const controller = new AbortController();
const { stream } = await client.event.subscribe({
  signal: controller.signal,
  query: { directory },
  sseMaxRetryAttempts: 1, // one attempt, no automatic reconnect loop
});

for await (const event of stream) {
  // event.type and event.properties
}
```

With `sseMaxRetryAttempts: 1`, a failed connection ends the generator instead of
retrying forever. The HTTP layer can reconnect. The SDK sends
`Last-Event-ID` if the stream provided one; V1 events do not include a top-level
id, so the bridge forwards them without an `id:` field.

The event envelope is `{ type, properties }`. Session ids live in different
places per event family:

- `properties.sessionID` for `session.status`, `session.idle`, `session.error`,
  `permission.updated`, `todo.updated`, `file.edited` (when present).
- `properties.info.sessionID` for `message.updated`.
- `properties.info.id` for `session.created`, `session.updated`,
  `session.deleted` (the `info` object has `directory`/`version`).
- `properties.part.sessionID` for `message.part.updated`.

`src/opencode/events.ts` handles all of these. Global events without a session id
are dropped when `?session=` is used.

## Permission replies

A permission request arrives as:

```ts
{
  type: "permission.updated",
  properties: {
    id: "per_...",
    sessionID: "ses_...",
    messageID: "...",
    title: "Run shell command",
    metadata: { /* tool-specific */ },
    time: { created: 1234567890 }
  }
}
```

Reply with one of `once`, `always`, or `reject`:

```ts
await client.postSessionIdPermissionsPermissionId({
  path: { id: sessionID, permissionID: permission.id },
  body: { response: "once" },
  query: { directory },
});
```

The response is a boolean. A matching `permission.replied` event follows.

## Config: model and permissions

The inline `Config` object accepts:

```ts
{
  model: "provider/model",
  small_model: "provider/model",
  permission: {
    edit: "ask" | "allow" | "deny",
    bash: "ask" | "allow" | "deny" | { "pattern": "ask" | "allow" | "deny" },
    webfetch: "ask" | "allow" | "deny",
    external_directory: "ask" | "allow" | "deny",
  },
  provider: {
    [providerID]: {
      options: { apiKey: "..." },
    },
  },
}
```

RedCode sets `permission.edit` and `permission.bash` to `"allow"` in the
embedded inline config so tool actions run without an interactive approval step.
This is an explicit product decision requested for the local deployment; the
permission-reply API remains available for remote/legacy flows. The provider id
is the first segment of `OPENCODE_MODEL`; the rest is the model id. For a remote
server the gateway reads `client.config.get()` and only checks the permission
values; it does not log or return the config.

## Isolation requirements

Two non-obvious requirements are mandatory for embedded mode:

1. **Separate data/config/state directories.** V1 and V2 OpenCode databases are
   not interchangeable. Sharing a data directory with a V2 CLI fails with
   `Database is not empty and has no session table`. RedCode sets:
   - `XDG_DATA_HOME=<OPENCODE_DATA_DIR>/data`
   - `XDG_CONFIG_HOME=<OPENCODE_DATA_DIR>/config`
   - `XDG_STATE_HOME=<OPENCODE_DATA_DIR>/state`
2. **Do not inherit the user's global config.** Without the isolated
   `XDG_CONFIG_HOME`, V1 reads `~/.config/opencode/opencode.json`, including MCP
   servers and credentials. The inline config is enough for model, permissions,
   and the provider key.

## Embedded auth

`opencode serve` is unsecured unless `OPENCODE_SERVER_PASSWORD` is set. RedCode
generates a random 32-byte password per process, sets the env var before
spawning, and sends `Authorization: Basic base64("opencode:<password>")`.
`createOpencodeServer` inherits `process.env`, so this works without patching the
SDK. The password is never logged or exposed.

## Lifecycle limitations

- `createOpencodeServer()` returns only `{ url, close() }`; it does not expose the
  child process. Crash recovery is therefore driven by a health probe
  (`client.path.get()` every 15 seconds). RedCode attempts one restart, then logs
  that a manual restart is required.
- Startup on a busy port is retried once with a newly selected free port.
- The embedded process binds to `127.0.0.1` only. The public listener is Hono.
