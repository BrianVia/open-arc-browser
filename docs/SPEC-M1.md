# M1 Spec — working browser skeleton

Read ARCHITECTURE.md first. It is the authority on module boundaries. This
spec is the work order for milestone 1.

## Objective

A runnable Electron app on Linux: Arc-style sidebar (left, vertical tabs),
one default profile, multiple spaces, real browsing in WebContentsViews.
Pure-TS BrowserState core with unit tests.

## Stack (fixed — do not substitute)

- Electron ≥ 33 (WebContentsView API), electron-vite, TypeScript strict.
- Svelte 5 (runes) — plain Vite renderer, NOT SvelteKit.
- Zod for the IPC contract in `src/shared/`.
- Vitest for unit tests.
- npm scripts: `dev` (electron-vite dev), `build`, `typecheck` (tsc + svelte-check), `test` (vitest run).

## Directory (from ARCHITECTURE.md)

```
src/main/state/    BrowserState: types.ts, transitions.ts, store.ts (persistence)
src/main/engine/   EngineHost: host.ts (sync/reconcile), events.ts
src/main/ipc.ts    bridge wiring (typed, thin)
src/main/index.ts  composition root
src/preload/       contextBridge exposing the typed API
src/ui/            Svelte app. Use src/ui/foundation/* (theme.css, WindowShell, SidebarItem, Button) as the design foundation — adapt freely
src/shared/        Zod schemas + TS types for state and commands
tests/             Vitest unit tests
```

## Domain model (exact shapes, extend only additively)

- Profile: `{id, name, color}` — session partition `persist:profile-<id>`
- Space: `{id, profileId, name, color, split: {panes: [tabId] | [tabId, tabId], focused: 0|1} | null}`
- Tab: `{id, spaceId, url, title, faviconUrl, pinned, muted, lastActiveAt, nav: {entries: [{url, title}], index}}`
- AppState: `{profiles, spaces, tabs, activeSpaceId, activeTabId per space}`
- ids: nanoid/uuid strings minted ONLY by BrowserState transitions.

## Commands (BrowserState Interface, v1 minimum)

createSpace, renameSpace, setActiveSpace, openTab(url, spaceId?),
closeTab, setActiveTab, pinTab/unpinTab, navigate(tabId, url),
tabEvent(tabId, {title?|faviconUrl?|url?|navEntry?}) — engine-reported.
Every transition validates against current state; unknown tabId = no-op
(correlation invariant in ARCHITECTURE.md).

## Persistence

JSON at `app.getPath('userData')/state.json`. Debounced 500ms, atomic
write (tmp+rename), flush on quit. Versioned: `{version: 1, ...}`.
No favicon binary data in the JSON — store favicon URLs only in M1.

## EngineHost rules (ARCHITECTURE.md is binding)

- One WebContentsView per *loaded* tab; only active space's active tab (or
  split panes) are attached/visible. Views for background tabs in the same
  space stay loaded but hidden (M1: keep it simple — detach non-visible).
- `sync(state, insets)`: diff-based, idempotent. Insets come from UI over IPC
  (sidebar width px). EngineHost alone computes view bounds.
- webContents↔tabId Map; every event handler re-validates before emitting.
- Popup policy day one: URL-bearing → openTab; opener-coupled → allow as
  transient frameless child BrowserWindow (see ARCHITECTURE.md).
- Crash of a view must not delete the tab record; show reload affordance.

## UI design intent (Arc-like, use the foundation files)

- Window: frameless (`titleBarStyle: hidden`), the WindowShell header strip
  is the drag region (`-webkit-app-region: drag`), no macOS traffic lights —
  minimal close/min/max on the right, 12px icons.
- Sidebar 260px fixed (resizable later), background tinted by the active
  space color (subtle gradient wash, like Arc), light+dark via theme.css.
- Top of sidebar: URL/search field (pill, shows active tab's URL, Enter
  navigates; plain input in M1 — command bar is M2).
- Space switcher: row of colored dots at sidebar bottom; click switches,
  shows space name. "+" creates a space (inline name input, random color).
- Tab list: pinned section on top (if any), divider, then regular tabs,
  newest on top. Row = favicon (16px) + title ellipsized + close ×
  on hover. Active tab = pill highlight (SidebarItem pattern). Click
  switches, middle-click closes.
- New-tab button at top of tab list: `+ New Tab` → focuses URL field.
- Content area: the WebContentsView occupies everything right of the
  sidebar. When a space has no tabs: centered muted empty state.
- Keep it restrained and polished: aurora tokens, 13px font in sidebar,
  9px radii, no gratuitous shadows.

## Acceptance criteria (all must pass; state actual results)

1. `npm run typecheck` green.
2. `npm test` green with real transition coverage: open/close/pin/switch,
   split invariants (closing a split tab collapses split sensibly),
   unknown-tabId no-op, persistence round-trip (serialize→load→identical),
   debounce (fake timers), atomic-write (tmp file used).
3. `npm run build` completes.
4. DO NOT launch the GUI yourself — the operator validates `npm run dev`
   interactively afterward. Everything non-GUI must be proven by 1–3.

## Out of scope for M1

Extensions (M2+), command bar window, split-view UI (model supports it;
no UI yet), downloads/permissions (M2), auto-archive, multiple profiles UI
(model supports N; UI shows default profile only).

## Constraints

- No `any`, no `@ts-ignore`. Electron APIs only in main/preload.
- `src/main/state/` must not import electron.
- IPC: exactly two channels — `command` (renderer→main, Zod-validated) and
  `state` (main→renderer, full snapshot push on change; fine for M1).
- Keep dependencies minimal: electron, electron-vite, svelte, zod, vitest,
  nanoid. Justify anything else in a comment in package.json.
