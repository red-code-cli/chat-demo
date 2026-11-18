# AGENTS.md — RedCode upgrade rules

This repository is a fork of `deepseek-ai/chat-demo` being upgraded in phases to a
production app on the stable OpenCode SDK V1 with a Hono (Node) backend.

Read `docs/redcode/AUDIT.md` before touching anything and `docs/redcode/PLAN.md`
before starting a phase. They are the source of truth for current behavior and scope.

## Locked UX

Every item in **`docs/redcode/AUDIT.md` → section 6, LOCKED UX LIST** must keep working
exactly as it does today: layout, controls, wording, keyboard behavior, mobile behavior,
persistence, import/export, themes, and error flows.

- Do not remove, rename, move, or restyle existing UI without explicit sign-off.
- If a phase changes visible UI, list the affected locked items in the PR/commit message
  and update tests in the same phase.
- Regenerating a visual baseline is a **behavior change**: ask the user first.

## Package and SDK policy

- **pnpm only.** Never run `npm` or `yarn`. Commit `pnpm-lock.yaml` with dependency changes.
- Use the **stable V1 SDK**: `@opencode-ai/sdk`.
- Never add beta/next packages: `@opencode/sdk`, `@opencode/client`, `@opencode/plugin`,
  `sdk-next`, or any `@next`/`@beta` dist-tag of the OpenCode SDK.
- Do not upgrade existing dependencies unless the phase explicitly requires it.
- New runtime dependencies need a reason in the commit message; prefer platform APIs and
  existing libraries.

## Required checks

Run these after **every** change, in this order, and do not commit if they fail:

```bash
pnpm lint
pnpm type
pnpm build
pnpm test:e2e
pnpm test:visual
```

- `pnpm test:e2e` and `pnpm test:visual` build `dist/` and serve it on `127.0.0.1:4173`.
  Tests mock all network calls; never use a real API key or reach the real API.
- Baseline screenshots live in `tests/visual/`. Do **not** run
  `playwright test --update-snapshots` (or `-u`) without explicit user approval.
- A flaky test is a bug in the test, not a reason to raise timeouts or skip cases.

## Working rules

- **One phase per branch**, named `redcode/phase-N`; branch from the previous phase's
  merged state. Keep `pre-redcode-baseline` intact for diffing.
- **Small, focused commits.** Use `feat:`, `fix:`, `test:`, `docs:`, `chore:` prefixes.
- Keep `src/` behavior changes inside the phase that owns them. Phase 0 is audit and
  safety net only: docs, tests, test config, devDependencies — no product code changes.
- Never delete or rename user files to "clean up" unless the task requires it.
- Prefer minimal, local changes; do not refactor unrelated code or "fix" unrelated issues.
- Update `docs/redcode/PLAN.md` checkboxes as work is completed.

## Code conventions

- Language: TypeScript, strict; React 18 function components; Zustand for state.
- English for identifiers, comments, file names, and commit messages.
- User-facing strings go through `src/i18n/` (`zh.ts` and `en.ts` both updated).
- Styling stays on CSS Modules + the existing global CSS/design tokens. No Tailwind,
  CSS-in-JS, or animation library without a recorded decision.
- Animations must respect `prefers-reduced-motion` and must not block input or streaming.
  Existing animations (thinking timeline, reading bars, spectrum, transitions) are locked UI.
- Backend code (from Phase 1) lives outside `src/`; secrets and OpenCode credentials stay
  server-side, never in browser storage or bundles.

## Phase definition of done

A phase is done only when: all plan checkboxes are complete, the checks above pass,
locked UX is unchanged (or explicitly approved), visual baselines are stable, docs are
updated, and the phase is a single reviewable branch.
