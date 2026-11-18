# Phase 0 Audit — chat-demo

Audit of the fork of `deepseek-ai/chat-demo` before the RedCode upgrade (Hono backend +
stable OpenCode SDK V1 + animations). This document only records what the code does today.
Nothing here is a fix or a plan; problems are reported, not changed.

Baseline ref: tag `pre-redcode-baseline`, branch `redcode/phase-0`.

---

## 1. Stack

Confirmed from `package.json`, `rspack.config.ts`, `tsconfig.json` and the lockfile — not guessed.

| Area | What is used |
| --- | --- |
| Language | TypeScript 7.0.2 (`tsc`, the native/Go preview compiler) |
| UI runtime | React 18.3.1 + react-dom 18.3.1 (no router, no data-fetching library) |
| Client state | Zustand 4.4.7 (plain stores; no `persist` middleware) |
| Build tool | Rspack 2.0.2 (`@rspack/core`, `@rspack/cli`), dev server `@rspack/dev-server` 2.0.1 |
| Transpile | `builtin:swc-loader` (SWC), automatic JSX runtime |
| CSS pipeline | `builtin:lightningcss-loader`. Plain global CSS + CSS Modules |
| Styling approach | CSS Modules (`.module.css`) for components, plus a few global stylesheets. **No Tailwind, no CSS-in-JS (no styled-components/emotion), no Sass/Less** |
| Animations | No animation library. Hand-written CSS `@keyframes`/transitions, inline SVG SMIL (`ReadingBars`), and a `requestAnimationFrame` canvas-free spectrum (`Spectrum`) |
| Markdown | `mdast-util-from-markdown` + `micromark-extension-gfm`/`-llm-math`; KaTeX 0.16.22, Mermaid 11.10.1, Prism 1.30.0 (all lazy-loaded) |
| Storage | `idb` 8.0.3 (IndexedDB wrapper), `fflate` 0.8.3 (ZIP for history import/export) |
| Misc | `clsx` 2.1.1 |
| Package manager | **pnpm only** (`pnpm-lock.yaml`; CI uses `pnpm/action-setup` v12.6.0; local pnpm 12.21.0) |
| Node | README asks for Node 22.12+; CI uses Node 24 |
| Lint / format | oxlint 1.63.0 (`.oxlintrc.json`, strict) and oxfmt 0.48.0 (`.oxfmtrc.json`) |

Build notes:
- Entry `src/main.tsx`; output to `dist/` with `publicPath: 'auto'` (relative asset URLs, so
  `dist/index.html` can be opened from `file://`).
- `HtmlRspackPlugin` uses `src/index.html` and injects `<meta name="application-version">`.
- `DefinePlugin` injects `__API_ORIGIN__` (default `https://api.deepseek.com`), typed in `src/env.d.ts`.
- CSS Modules use default exports and `localIdentName: '[local]-[hash:6]'`.
- Role in the project: a fully client-side single-page app. There is **no backend and no server
  code** in this repo. `dist/` is deployed to GitHub Pages by `.github/workflows/pages.yml`.

Scripts (`package.json`): `dev`, `build`, `type`, `lint`, `format`. There is **no test script and
no test tooling** at baseline.

---

## 2. File map

Top level:

| Path | Purpose |
| --- | --- |
| `src/` | All application source (155 files, ~19.2k lines) |
| `rspack.config.ts` | Build + dev-server config (`createConfig({ apiOrigin, devServer })`) |
| `tsconfig.json` | Strict TS config; `include: ["src", "rspack.config.ts"]` |
| `.oxlintrc.json` / `.oxfmtrc.json` | Lint / format rules |
| `.github/workflows/pages.yml` | Pages deploy: install → `type` → `lint` → `build` → upload `dist` |
| `README.md` / `README.zh-CN.md` / `LICENSE` | Docs and license (copied into `dist/`) |

`src/` subtrees:

| Path | Purpose (one line) |
| --- | --- |
| `src/main.tsx` | Mounts `<App/>`, calls `setupTheme()` and `ensureKatex()` |
| `src/index.html` | HTML shell (single `#root` div) |
| `src/env.d.ts` | Ambient types: CSS modules, `__API_ORIGIN__`, Prism/KaTeX side-effect modules |
| `src/app/` | App shell: `App.tsx`, theme (`theme.ts`, `theme.css`), global CSS, mobile viewport hooks |
| `src/components/base/` | Low-level UI primitives: Button, IconButton, Menu, Modal, Select, Toast, Tooltip, icons, anchored-position hooks, toast state |
| `src/components/chatInput/` | Composer: textarea, toggles, attachments, drag mask, voice button/hook, audio spectrum |
| `src/components/files/` | File card + file icon |
| `src/components/markdown/` | Markdown AST renderer, code block, math, Mermaid, link, streaming render throttle |
| `src/components/messages/` | Message list, user/assistant messages, thinking/tool timeline, branch switcher, copy, read-aloud |
| `src/components/search/` | Search result panel, source cards, citation links, hover card, site logo |
| `src/components/session/` | Session view, mobile header, welcome screen |
| `src/components/settings/` | Settings dialog, API key field/form, dialog state |
| `src/components/sider/` | Session sidebar, session item, collapsed sider, mobile drawer state |
| `src/i18n/` | `zh.ts`, `en.ts` (167 keys each), `translate`/`useTranslate` |
| `src/services/api/` | Fetch client, SSE reader, event parser, protocol types, error classification, speech endpoints |
| `src/services/chat/` | Chat store, IndexedDB, branching, stream reducer, drafts, view builders, backup, history import/export |
| `src/services/markdown/` | Markdown parsing, Prism highlight loader, KaTeX loader, Mermaid loader |
| `src/services/speech/` | Recorder (WAV encoding) and read-aloud (TTS PCM playback) |
| `src/utils/` | `format.ts`, `id.ts`, `clipboard.ts` |

Largest files (risk hotspots): `services/chat/store.ts` (1094), `services/uploadExts.ts` (986),
`components/base/icons.tsx` (525), `components/settings/SettingsDialog.tsx` (559),
`services/locationData.ts` (452), `services/chat/view.ts` (400), `components/messages/ReplyArea.tsx` (391).

---

## 3. State and data flow

### Zustand stores (all created without `persist`)

| Store | File | Holds | Persisted? |
| --- | --- | --- | --- |
| `useChatStore` | `services/chat/store.ts` | `ready`, `initError`, `importingHistory`, `sessions` (summaries), `sessionCache` (loaded sessions, LRU 5), `sessionLoadErrors`, `sessionSaveErrors`, `activeId`, `streaming` (per-session `AbortController`) | No (persistence is manual, see below) |
| `useSettings` | `services/settings.ts` | `apiKey`, `locale`, `themePreference`, `location`, `ttsVoice`, `thinking`, `search`, `siderCollapsed` | **Yes — localStorage** |
| `useUploads` | `services/attachments.ts` | Upload tasks keyed by attachment id | No (memory) |
| `useDrafts` | `services/chat/drafts.ts` | Draft text + attachments per `sessionId \| null` | No (memory) |
| `useSearchPanel` | `components/search/searchPanelState.ts` | `entry`, `sources` | No |
| `useSettingsDialog` | `components/settings/settingsDialogState.ts` | `open`, `section` | No |
| `useMobileSider` | `components/sider/mobileSiderState.ts` | `open` | No |
| `useReadAloud` | `services/speech/readAloud.ts` | `messageId`, `status` | No |
| `useToast` | `components/base/toastState.ts` | `id`, `message` | No |

There is also **module-level mutable state** outside Zustand, all in `services/chat/store.ts`:
`sessionAccess` (LRU recency), `unsavedSessions`, `pendingFiles`, `deletingSessions`,
`deletionTasks`, `streamFlushes`, `accessSequence`, `historyEpoch`, `initTask`, `sessionLoads`,
and `titleRequests`. This is important: chat behavior depends on process-wide singletons, not only
on store state.

### Persistence

- **localStorage** — settings only, under keys `chat-demo:api-key`, `chat-demo:locale`,
  `chat-demo:location`, `chat-demo:theme-preference`, `chat-demo:tts-voice`, `chat-demo:thinking`,
  `chat-demo:search`, `chat-demo:sider-collapsed`. Reads/writes are wrapped in try/catch; on failure
  the value lives in memory only.
- **IndexedDB** — database `chat-demo`, version 11 (see `services/chat/db.ts`). Object stores:
  - `sessions` (`Session` by `id`) — current conversations with the full message tree.
  - `sessionSummaries` (`id,title,createdAt,updatedAt,fileIds[]`, index `fileIds` multiEntry) —
    list metadata only.
  - `files` (`{ id, blob }`) — original attachment bytes, keyed by local attachment id.
  - `sessionsStaging` / `filesStaging` — temporary area used during history import; swapped into
    the live stores in a single transaction on success (`commitStaging`), cleared on failure.
- **Memory only** — drafts, upload tasks, search panel, and all UI state. A reload loses them.
- No cookies, no service worker, no `sessionStorage`, no server-side persistence.

### Data shapes (from `services/chat/types.ts`)

- `Session = { id, title, createdAt, updatedAt, messages: Message[], rootMessageId?: string|null }`.
- `UserMessage = { id, role:'user', content, files: FileAttachment[], createdAt }`.
- `AssistantMessage` carries `model`, `thinking?`, `search?`, `latestReminder?`, `prefix`, `status`
  (`pending|streaming|done|stopped|error`), `blocks: ReplyBlock[]`, `stopReason?`, `stopDetails?`,
  `usage?`, and `error?`. `ReplyBlock` is `ThinkingPart | TextPart | ServerToolBlock`.
- `FileAttachment = { id, serverId|null, name, size, isImage, mimeType }` — `id` is the local
  IndexedDB key, `serverId` is the Files API `file_id` (uploaded lazily before a request).
- Branching uses `parentId` / `selectedChildId` on each message; `getVisibleMessages()` walks the
  message list from `rootMessageId` following `selectedChildId`.

### Main write path (sending a message)

`ChatInput.send()` → `store.sendMessage()` builds a `UserMessage` + pending `AssistantMessage`,
appends a branch, `persist()`s, then `streamReply()` runs the request and merges SSE events into the
assistant message via `reply.ts:applyEvent`. UI updates are throttled to `requestAnimationFrame`
(or flushed immediately while the tab is hidden); the session is written to IndexedDB after settle.
Persistence is also forced on `visibilitychange`/`pagehide` (`bindChatPersistence`).

---

## 4. API touchpoints

All network access goes through one fetch helper: `request()` in `src/services/api/client.ts`.
There is no `EventSource`, `WebSocket`, or `XMLHttpRequest` anywhere in the app. The base origin is
the compile-time `__API_ORIGIN__` (default `https://api.deepseek.com`); the key is sent from
`useSettings.apiKey` on every call.

| File | Function | Endpoint / method |
| --- | --- | --- |
| `services/api/client.ts` | `verifyApiKey(apiKey)` | `GET {API_ORIGIN}/models` (key check, no cost) |
| `services/api/client.ts` | `uploadFile(apiKey, file, purpose)` | `POST {API_ORIGIN}/anthropic/v1/files` (multipart; header `x-api-key`, `anthropic-beta: files-api-2025-04-14`) |
| `services/api/client.ts` | `deleteFile(apiKey, fileId)` | `DELETE {API_ORIGIN}/anthropic/v1/files/{id}` — **defined but never called (dead export)** |
| `services/api/client.ts` | `streamMessage(apiKey, body, signal)` | `POST {API_ORIGIN}/anthropic/v1/messages` with `stream: true`; returns `AsyncGenerator<MessageStreamEvent>` |
| `services/api/speech.ts` | `transcribe(apiKey, audio, signal)` | `POST {API_ORIGIN}/v1/tools/asr` (multipart WAV/Ogg) |
| `services/api/speech.ts` | `synthesize(apiKey, text, voice, signal)` | `POST {API_ORIGIN}/v1/tools/tts`; returns a raw PCM `ReadableStream` |

Call sites:
- `streamMessage` → `services/chat/store.ts:streamReply()` (the only consumer).
- `uploadFile` → `services/attachments.ts:uploadAttachment()` (queued, max 3 concurrent).
- `verifyApiKey` → `components/settings/useApiKeyForm.ts:submit()`.
- `transcribe` → `components/chatInput/useVoiceInput.ts:finish()`.
- `synthesize` → `services/speech/readAloud.ts:toggleReadAloud()`.

### Streaming

- Transport is SSE over `fetch`. `services/api/sse.ts:readServerSentEvents()` implements a WHATWG
  SSE decoder (byte stream → UTF-8 → CRLF/CR/LF lines → dispatch on blank line), ignoring comments
  and `retry`.
- `streamMessage` requires `Content-Type: text/event-stream`; otherwise it raises a `protocol` error.
  It ends on `message_stop`; if the stream closes first it throws `interrupted`.
- `services/api/parseEvent.ts:readMessageEvent()` validates and normalizes each event; unknown events
  are dropped silently.
- Consumers: `store.streamReply` loops with `for await`, applies each event with
  `reply.ts:applyEvent` (content_block_start/delta/stop, message_start/delta, thinking/signature/
  citations deltas), throttles renders with `requestAnimationFrame`, and finalizes with
  `settleReply`. Stop is an `AbortController` per session (`store.stopReply`).
- Auto-title: when `titleRequests` holds the controller, `message_delta.delta.title` becomes the
  session title.
- Error handling: `services/api/errors.ts` classifies by HTTP status (`unauthorized`, `insufficientBalance`,
  `tooLarge`, `rateLimited`, `serverBusy`, `network`, `other`) and detects file-id 400s
  (`fileIdMissing`, `fileDataMissing`, `invalidFileId`) to trigger re-upload; retry with backoff for
  retryable failures.

Protocol shape (`services/api/types.ts`) is the **Anthropic-compatible DeepSeek Messages API**, not
OpenAI and not OpenCode. Notable non-standard pieces this app relies on:
- `system` string + `safety_check: { level: 'high' }`.
- `tools: [{ type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }]`.
- `title: { enabled: true }` and a `latest_reminder` message role.
- Server-tool blocks (`server_tool_use`, `web_search_tool_result`, `web_fetch_tool_result`) and
  citation deltas.
- Models: `ChatModel = 'deepseek-flash' | 'deepseek-v4-pro'`; the store always requests
  `deepseek-flash` (`MODEL` constant). `deepseek-v4-pro` is declared but never requested.

---

## 5. Features list

Only features that exist in the code are listed.

- **Conversations**: multiple chats, sidebar grouped Today / Yesterday / 7 Days / 30 Days / by month;
  create, select, rename inline, delete (with confirm). Sessions auto-title from the model.
- **Message branching**: edit a prompt (creates a new version), regenerate a reply, switch between
  versions with a `1 / N` switcher, continue a stopped/`max_tokens` reply.
- **Streaming replies** with stop; content blocks (text, thinking, tool) merged in order.
- **Deep thinking**: thinking blocks with signature, shown in a collapsible timeline with elapsed
  time; a "stopped"/ticking title while streaming.
- **Web search / link reading**: smart-search toggle (declares `deepseek_web_search`), always-on
  `deepseek_read_url`; tool timeline rows (search queries, opened pages, in-page find, reading link);
  inline `[citation:N]` badges with hover preview; right-side search results panel.
- **Attachments**: upload / paste / drag-and-drop; images (thumbnail previews) and documents (file
  cards); per-file upload status and retry; image + document/file separation; size/count limits.
- **Voice input (ASR)**: one-shot record → WAV (16 kHz mono 16-bit) → `/v1/tools/asr`; live audio
  spectrum while recording on mobile; 120-second cap.
- **Read aloud (TTS)**: `/v1/tools/tts` raw PCM streamed into an `AudioContext`; animated playing bars;
  voice selection (Stella/Tide).
- **Markdown rendering**: GFM (tables, task lists), syntax highlighting (Prism, lazy per language),
  KaTeX math, Mermaid diagrams (with code/diagram toggle), copy code button.
- **i18n**: Simplified Chinese / English (167 keys), affecting UI and `latest_reminder`.
- **Themes**: light / dark / system, synced to `theme-color`, `color-scheme` and `data-ds-dark-theme`.
- **Settings dialog**: General (theme, language, read-aloud voice, location) and Data (API Key,
  import, export, delete-all) sections; centered modal on desktop, bottom sheet on mobile.
- **Location**: country/region selector; province/city selector when the browser language is Chinese.
- **History export/import**: export a ZIP (`deepseek_data-YYYY-MM-DD.zip`, `export_format_version: 3`)
  of all conversations and locally available images; import replaces all local data with atomic
  staging; "delete all chats" clears conversations and files but keeps the API key/settings.
- **Mobile layout**: drawer sidebar, mobile header with new-chat, visual-viewport keyboard handling,
  recording spectrum, no auto-focus.
- **Misc UI**: toasts, tooltips (desktop only), anchored menus/selects, copy message/code.

---

## 6. LOCKED UX LIST

Every item below is existing behavior that must not change. Any future change that would alter one of
these needs explicit sign-off first. This is the checklist the test suite (and later visual
snapshots) protects.

**Shell & layout**
- [ ] App boots to the welcome screen with the greeting and a centered composer (desktop).
- [ ] Desktop sidebar shows app name, collapse button, "New chat", time-grouped chat list, and a
      Settings entry at the bottom.
- [ ] Collapsing the sidebar shows the collapsed rail; the collapsed state persists.
- [ ] Mobile (<768px) shows the mobile header; the sidebar becomes a drawer opened from the header
      menu and closed by tapping the mask or switching/creating a chat.
- [ ] Mobile input is bottom-pinned and follows the visual viewport when the keyboard opens.

**Composer (ChatInput)**
- [ ] Auto-growing textarea; Enter sends, Shift+Enter newlines; IME composition is respected.
- [ ] DeepThink and Search toggles are visible and reflect/persist their on/off state.
- [ ] Attach (paperclip), voice button, and send/stop button are in the function row.
- [ ] Send is enabled only when there is text or attached files and all uploads succeeded.
- [ ] While generating, the send button becomes a stop button.
- [ ] Drag-and-drop over the page shows the full-screen drop mask.

**Messages**
- [ ] User messages show a bubble, optional file previews, copy and edit actions.
- [ ] Assistant messages show the thinking/tool timeline, then the answer, then actions.
- [ ] Thinking timeline is collapsible and shows duration ("Thought for N seconds") when done.
- [ ] Search/read-link steps render as timeline rows and open the results panel when clicked.
- [ ] Citations render as numbered badges with hover previews; the summary row opens all results.
- [ ] Regenerate and Continue appear in the places they do today; copy and read-aloud stay available.
- [ ] Version switcher (`1 / N`) appears for branched messages and keeps scroll position on switch.
- [ ] Code blocks have language label, copy button; Mermaid blocks toggle diagram/code.
- [ ] Streaming shows the waiting dots before the first content, and follows the bottom while sticky.

**Settings & data**
- [ ] Settings opens as a modal with General and Data tabs.
- [ ] General: theme (Light/Dark/System), language, read-aloud voice, location.
- [ ] Data: API Key (masked when saved, verify before save), import, export, delete-all.
- [ ] Import shows a confirm step, then replaces all local data on success.
- [ ] Export downloads a ZIP including conversations and locally stored images.
- [ ] Delete-all confirms, clears conversations/files/drafts, keeps the API key.
- [ ] With no API key, the settings dialog opens automatically on start; type/upload/send actions
      prompt for a key instead of failing.

**Cross-cutting**
- [ ] Theme switch updates background, `theme-color`, and `color-scheme` without breaking layout.
- [ ] Language switch updates the whole UI and the `latest_reminder`.
- [ ] Errors (invalid key, no balance, rate limit, server busy, network, upload) show the existing
      wording and actions (Change API key / Top up).
- [ ] Toasts show one at a time and auto-dismiss.
- [ ] Tooltips are desktop-only; menus/selects close on outside click or Esc.

---

## 7. Risks and breakage points for OpenCode integration

Ranked by how likely they are to break the locked UX above.

1. **`services/chat/store.ts` (1094 lines) is the linchpin.** It owns message creation, branching,
   attachment re-upload, retry/backoff, persistence, and the streaming loop. Any OpenCode session
   wiring has to either live inside it or replace it. There is also process-wide singleton state
   (`historyEpoch`, `pendingFiles`, `streamFlushes`, `sessionLoads`) that assumes one chat engine.
2. **The wire protocol is DeepSeek/Anthropic-specific, not OpenCode.** `types.ts` + `client.ts` +
   `parseEvent.ts` + `reply.ts` are built around `deepseek_web_search`/`deepseek_read_url`,
   `latest_reminder`, `safety_check`, server-tool blocks, and citation deltas. The stable
   `@opencode-ai/sdk` exposes a different event/stream model; mapping between them is the single
   biggest piece of work and the easiest place to lose features (search, citations, thinking).
3. **All API calls are direct browser calls with the key in `localStorage`** (`request()` is the one
   choke point, which helps). Adding a Hono backend means changing the base URL, headers, and auth
   flow for every endpoint — chat, files, ASR, TTS, and key verification.
4. **Custom branching model** (`parentId` / `selectedChildId`, `branches.ts`) has no direct OpenCode
   equivalent; OpenCode revert/fork semantics differ. A naive swap can break edit/regenerate/version
   switching, which are locked.
5. **IndexedDB schema v11 is bespoke** (`sessions`/`sessionSummaries`/`files` + staging). If OpenCode
   sessions become the source of truth, local data must be mirrored or migrated without data loss or
   breaking import/export.
6. **History export format v3 is DeepSeek's format**, and the export/import UI is locked. It is also
   tied to the current message model (`toArchive.ts`/`toLocal.ts`), so changing `ReplyBlock` shapes
   can silently break round-trips.
7. **DeepSeek-specific tool UI** (`services/chat/view.ts`, `ReplyArea.tsx`) assumes search/open/find/
   read-link steps. Agent-style tool cards (Phase 3) will sit next to these; the existing timeline
   must keep rendering for plain chats.
8. **`__API_ORIGIN__` is a compile-time constant.** A runtime-configurable backend URL (and the loss
   of the `file://` direct-open mode) needs build/config changes without breaking `pnpm build`.
9. **Strict lint + strict TS.** `no-console`, `import/no-default-export`, `no-explicit-any`,
   `import/no-cycle`, `react/exhaustive-deps` are all errors; new backend/shared code must comply.
10. **No test infrastructure yet.** There is nothing protecting the locked UX today; the safety net
    in Step 3 is the first guard, and visual snapshots will be hypersensitive to CSS/theme changes.
11. **Build topology.** The app is rspack-only and browser-only. A Hono/Node backend is a separate
    build/runtime that must be added without touching `src/` behavior, and TS 7.0.2 native must cope
    with server + shared code.
12. **Animated UI is hand-rolled** (CSS/SMIL/rAF). Introducing a new animation approach can conflict
    with these (e.g. reduced-motion handling in `ReadingBars`, rAF loops in `Spectrum`).

Minor findings (recorded only, not changed):
- `deleteFile` in `services/api/client.ts` is exported but never called.
- `ChatModel` declares `'deepseek-v4-pro'`, but the store only ever requests `'deepseek-flash'`.
- The first `pnpm type` run in this environment failed with a transient
  `Cannot find module '@rspack/cli'` while `pnpm install` was still finishing; a clean re-run passes.
  This is an environment race, not a repo defect.
