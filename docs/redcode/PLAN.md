# RedCode upgrade plan

Phased upgrade of this `deepseek-ai/chat-demo` fork to a production app backed by a Hono
(Node) server and the **stable OpenCode SDK V1** (`@opencode-ai/sdk`).

Rules: see `AGENTS.md`. Current behavior and locked UX: `docs/redcode/AUDIT.md`.
One branch per phase (`redcode/phase-N`), one phase per PR. Every phase ships with tests,
docs, and its animation work — animations are never "Phase 6 cleanup".

Legend: `[ ]` not started · `[x]` done. A phase is complete only when every box is checked.

---

## Phase 0 — Audit + safety net

Goal: know exactly what exists today and put a test net under it. No product changes.

- [x] Tag `pre-redcode-baseline` and branch `redcode/phase-0` from a clean tree.
- [x] Record baseline: install, typecheck, lint, build, dev server.
- [x] `docs/redcode/AUDIT.md`: stack, file map, state/data flow, API touchpoints,
      features, locked UX checklist, OpenCode integration risks.
- [x] Add Playwright as a devDependency only.
- [x] Smoke tests: app loads, settings opens, mocked send/stream, export + import,
      theme switch, mobile viewport drawer.
- [x] Visual baselines in `tests/visual/` (desktop light/dark, settings, chat, mobile).
- [x] `AGENTS.md` and this plan.
- [x] Final verification equals or beats baseline; `git diff pre-redcode-baseline --stat`
      proves zero `src/` changes.

**Definition of done**
- All checks pass: `pnpm lint`, `pnpm type`, `pnpm build`, `pnpm test:e2e`, `pnpm test:visual`.
- No `src/` file is added, modified, deleted, or renamed; no dependency upgrades.
- **Animations:** shipped animations are untouched and covered by stable visual baselines;
  `prefers-reduced-motion` behavior is preserved.

---

## Phase 1 — Backend foundation (Hono + OpenCode host + auth)

Goal: a real server next to the SPA; browser no longer talks to the model provider directly.

- [ ] Add `server/` (Hono on Node 22+) with a clean `src/`-independent build and scripts
      (`dev:server`, `build:server`, `start`), without changing existing app scripts' meaning.
- [ ] Runtime config (env) for port, OpenCode host URL, allowed origins, session/auth secret;
      no secrets in the bundle.
- [ ] OpenCode host: stable `@opencode-ai/sdk` client, health check, graceful shutdown,
      single host per process, structured logs.
- [ ] Auth: signed HTTP-only session cookie (or equivalent) gating `/api/*`; CSRF-safe
      mutations; CORS restricted to the app origin.
- [ ] API skeleton: `/api/health`, `/api/config`, `/api/opencode/*` proxy + SSE/event
      passthrough; error envelope shared by all routes.
- [ ] Frontend integration behind a build/config flag; existing DeepSeek direct mode still
      works until Phase 2 swaps the chat transport.
- [ ] Server tests (Hono `app.request`) plus an e2e smoke for boot + health; no network mocks
      leaking to real providers.
- [ ] Docs: runbook (env vars, start order, ports), update `AUDIT.md` deployment notes.

**Definition of done**
- `pnpm type`, `lint`, `build`, `test:e2e`, `test:visual` pass; server typecheck/tests pass.
- Existing UI and all locked UX unchanged; visual baselines unchanged (or approved diffs).
- **Animations:** no new flicker or layout shift during auth/bootstrap; loading states reuse
  existing styles and respect `prefers-reduced-motion`; no shipped animation is altered.

---

## Phase 2 — Core chat on OpenCode sessions

Goal: prompt, event stream, and interrupt run through OpenCode sessions while the chat UI
feels identical to today.

- [ ] Session mapping: local chat/session IDs ↔ OpenCode session IDs, created lazily, with
      idempotent recovery after reload.
- [ ] Prompt pipeline: send message, stream assistant text/thinking, usage and stop reason
      through the backend event bridge.
- [ ] Interrupt/stop: abort the OpenCode run; UI stop button, stopped status, and continue
      affordance behave as locked.
- [ ] Regenerate, edit-and-resend, and continue mapped onto OpenCode semantics; message
      versions remain visible and switchable.
- [ ] Persistence: OpenCode session is the source of truth; local IndexedDB mirrors enough
      for offline list/read; no data loss on upgrade from existing local history.
- [ ] Error mapping: auth, rate limit, provider/network, interrupted, and unknown errors keep
      the current wording and actions.
- [ ] Tests: mocked OpenCode event streams for happy path, thinking, stop, regenerate,
      reconnect, and error; e2e chat smoke; visual baseline for a streamed reply.
- [ ] Docs: architecture note for the event bridge and ID mapping.

**Definition of done**
- All checks pass; locked chat behaviors (send, stream, stop, regenerate, edit, branch,
  continue, copy, read-aloud, search panel if still served) verified.
- No direct model-provider calls from the browser in OpenCode mode; no API keys in storage.
- **Animations:** streaming text stays smooth (no full-list reflow per delta), stop/interrupt
  is reflected within one frame, waiting dots and thinking timeline keep their timing and
  reduced-motion behavior; visual diffs reviewed and approved.

---

## Phase 3 — Agent UI

Goal: first-class Agent experience layered onto the existing chat, without breaking plain chat.

- [ ] Tool call cards: running/succeeded/failed states, collapsible output, copy, keyboard
      accessible; reuse existing timeline styling where possible.
- [ ] Permission prompts: allow once / always / reject, queued and race-safe, visible while
      streaming; server remains authoritative.
- [ ] Diff viewer: unified diff with add/remove counts, per-file collapse, copy path; large
      diffs virtualized or capped.
- [ ] Model picker and agent picker (build/plan or custom), persisted per chat with safe
      fallback when unavailable.
- [ ] Compact and fork actions wired to OpenCode, with confirmation for destructive forks.
- [ ] Composer and message extensions fit the locked layout on desktop and mobile.
- [ ] Tests: tool card states, permission accept/reject, diff rendering, picker persistence,
      compact/fork e2e with mocked backend.
- [ ] Docs: user-facing behavior notes; update locked UX list only with explicit approval.

**Definition of done**
- All checks pass; existing plain-chat timeline, search, citations, and markdown unchanged.
- New UI is keyboard accessible and translated in `zh.ts` + `en.ts`.
- **Animations:** tool cards, permission sheets, diff expand, and pickers use short
  (≈150–250 ms) ease-out enter/exit motion; no layout jump when states change; every new
  animation respects `prefers-reduced-motion`; snapshots updated only after approval.

---

## Phase 4 — Power features

Goal: expose OpenCode's ecosystem safely.

- [ ] MCP servers: list/connect/disconnect, health and tool counts; failures isolated and
      surfaced without blocking chat.
- [ ] Skills: discovery, enable/disable, invocation from chat; clear provenance in messages.
- [ ] Custom commands: list, parameter prompts, run in the active session.
- [ ] Worktrees: create/switch/remove with dirty-state protection and clear active indicator.
- [ ] Web search and custom tools: status, results, and citations mapped into the existing
      source panel/timeline.
- [ ] Permissions and secrets: least privilege, server-side credentials, audit log of risky
      actions.
- [ ] Tests: mocked MCP/skills/commands/worktree flows, failure paths, e2e for each entry
      point; visual baselines for new panels.
- [ ] Docs: operator guide (MCP config, worktree disk usage, troubleshooting).

**Definition of done**
- All checks pass; no feature blocks the core chat path when disabled or failing.
- Locked UX preserved; new strings translated; no secret reaches the client.
- **Animations:** panel/table transitions and worktree switches feel immediate (no white
  flash); optimistic states are visually distinguishable from confirmed states; reduced-motion
  path verified; snapshots reviewed.

---

## Phase 5 — Hardening and deploy

Goal: production readiness — security, performance, observability, release.

- [ ] Security pass: dependency audit, auth/session hardening, rate limits, request size caps,
      SSRF/path-traversal review for tools and files, CSP/headers.
- [ ] Performance: bundle budget, lazy-load heavy renderers, stream rendering profile on
      mid-range mobile, memory check for long sessions.
- [ ] Reliability: timeouts, retries with jitter, graceful restart, data migration/rollback,
      backup of local history before schema changes.
- [ ] Observability: structured logs, request IDs, health/readiness, error reporting hooks
      without leaking prompts or keys.
- [ ] Deploy: container or Node service + static assets, HTTPS, env/secrets management, CI
      gates (type/lint/build/e2e/visual), preview environment.
- [ ] Docs: deployment, rollback, incident checklist, final architecture diagram, updated
      README; close out `AUDIT.md` risks with status.
- [ ] Release: version bump, changelog, tag; post-deploy smoke against production URL (read-only).

**Definition of done**
- All checks green in CI on the release commit; e2e and visual tests run against the built
  artifact; no high/critical vulnerabilities; rollback rehearsed.
- **Animations:** frame budget verified on mobile (no long tasks during streaming or panel
  transitions), reduced-motion mode fully usable, no animation-driven layout shift; final
  visual baseline approved and tagged.
