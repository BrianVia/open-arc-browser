# Architecture

An Arc-style browser for Linux: Electron shell (Chromium engine), Svelte 5 UI
(aurora-linux foundation).

## Feature scope (v1)

- Sidebar with vertical tabs
- Profiles (isolated cookies/logins/extensions), N Spaces per profile
- Shared extensions per profile, pinned tabs per Space
- Command Bar (search, switch tabs, jump spaces)
- Split View (2 panes)
- Auto-archive: designed in, shipped later
- Deferred, not blocked: auto-Picture-in-Picture — an EngineHost-internal
  policy (on tab switch, pop out a playing video). Touches no domain state,
  so skipping it now paints no corners.
- Explicitly out: Boosts, Little Arc, Easels/Notes

## Design principle

One source of truth for browser state, owned by one module in the main
process. The UI and the Chromium engine are both *subscribers* that render or
realize that state. Neither may invent its own. This kills the classic
browser bug class where the sidebar and the real tabs disagree.

## Modules

### 1. BrowserState (the domain core)

- **Owns:** the entire durable state tree — profiles, spaces, tabs, pinned
  tabs, split layout, archive — and every transition on it. Also owns
  persistence: one JSON store, atomic writes, versioned schema.
- **Must never own:** anything Electron. No windows, views, sessions, DOM.
  Pure TypeScript, testable without a browser.
- **Interface:** commands in (`createSpace`, `openTab`, `moveTab`, `pinTab`,
  `setSplit`, `archiveTab`, …) → validated transitions; `subscribe()` out —
  consumers get state snapshots/patches.
- **Key model decision:** a **Tab is a domain record**
  (`id, url, title, spaceId, pinned, muted, lastActiveAt, nav`), not a live
  web view. A tab can exist with no Chromium view attached (unloaded,
  archived). This one decision gives us lazy loading, session restore, and
  auto-archive later as *policies over existing state* — zero new concepts.
- **`nav` is the persisted back/forward stack** (`{entries: [{url, title}],
  index}`), updated on navigation commit and on view unload. `url` alone
  would restore tabs with dead back buttons. On attach, EngineHost replays
  it via `webContents.navigationHistory.restore()`.
- **Persistence policy:** transitions update in-memory state immediately;
  disk writes are debounced (~500ms) and flushed on quit. Favicons and other
  binary blobs live in per-profile sidecar files, never base64 in the JSON —
  otherwise navigation churn rewrites an ever-growing tree on every title
  tick.

### 2. EngineHost (Chromium adapter)

- **Owns:** everything Electron-web-content: one `session` per profile
  (partition = profile id), extension loading per session
  (`electron-chrome-extensions`), `WebContentsView` lifecycle, attaching
  views for the active space's visible tabs, laying out 1–2 panes for
  Split View, and reporting page events (title, favicon, url changes)
  back as BrowserState commands.
- **Must never own:** state truth. It realizes what BrowserState says and
  reports what Chromium did. If EngineHost crashes a view, the tab record
  survives.
- **Interface:** `sync(state, insets)` — reconcile live views against
  desired state (like a tiny React for web views); event callbacks that emit
  BrowserState commands.
- **Correlation invariant (the hard part of "engine as subscriber"):**
  EngineHost keeps a `webContents ↔ tabId` map; every Chromium event
  re-validates that mapping against *current* state before emitting a
  command, and `sync()` is diff-based and idempotent. Otherwise stale events
  from destroyed/re-pointed views (fast tab switches, crashes) corrupt state.
- **Popup policy (day one):** `WebContentsView` cannot adopt a popup's
  webContents, and denying `window.open` kills `window.opener` — which
  breaks OAuth popups (Google/Slack sign-in). Rule: URL-bearing popup
  dispositions → `openTab(url)`; opener-coupled popups (`about:blank`,
  auth flows) → allow as a transient frameless child `BrowserWindow` that
  lives until it self-closes. It is a popup surface, not a tab.
- **Layout contract:** web views z-stack *above* the window's DOM — the
  Svelte UI can never overlay a page. Shell UI publishes insets (sidebar
  width, topbar height) over IPC; EngineHost alone computes pane rects from
  state + insets. The command-bar palette therefore renders as a separate
  frameless transparent child window, not a DOM overlay.

### 3. Shell UI (Svelte, aurora-linux)

- **Owns:** rendering and input only — sidebar, space switcher, command bar,
  settings. The command bar is *pure UI*: it queries BrowserState (tabs,
  spaces, history) plus a search-suggestion provider and emits ordinary
  commands. No new authority.
- **Must never own:** orchestration, persistence, or direct Electron access.
- Runs in the window's renderer; talks only through the IPC bridge.

### 4. IPC Bridge

- **Owns:** the single typed contract between renderer and main: one channel
  for commands (UI → BrowserState), one for state updates
  (BrowserState → UI). Zod-validated at the boundary.
- Thin by design — no logic. If the bridge grows a brain, that's a review
  blocker.

## How the features fall out

| Feature | Where it lives | New concepts |
|---|---|---|
| Profiles | BrowserState records + one Electron session each (EngineHost) | 0 — maps 1:1 to Chromium sessions |
| Spaces | Pure BrowserState data (`spaceId` on tabs) | 1 (the Space record) |
| Shared extensions per profile | One `ExtensionBridge` per session (see below) | 1 (the bridge) |
| Pinned tabs per space | Boolean on the Tab record, sidebar renders a pinned section | 0 |
| Command bar | UI in a frameless transparent child window + queries over existing state | 0 |
| Split view | `split: {panes: [tabId, tabId?], focused: 0\|1}` on the Space | 1 (the split field) |

**Split view focus:** `focused` is required, not optional — two visible tabs
with an ambiguous "active tab" breaks keyboard nav, find-in-page, extension
`activeTab`, and DevTools targeting. The field resolves all of them.

**Extensions are not free.** `electron-chrome-extensions` requires the host
to implement the tab registry (add/select/remove), browser-action popups,
and routing of `chrome.tabs.create` into our state. Per-partition instances
(one per profile) are the intended usage. The `ExtensionBridge` adapter (one
per session, inside EngineHost) feeds it from BrowserState snapshots scoped
to that profile's tabs; extension-created tabs land in the profile's active
Space. MV3 support is partial — pin the library version and test the target
extensions (uBlock, 1Password) early.
| Auto-archive (later) | Timer policy in main: `archiveTab` on stale `lastActiveAt` | 0 |

## Directory shape

```
src/
  main/
    state/     # BrowserState: model, transitions, persistence (pure TS)
    engine/    # EngineHost: sessions, views, extensions, layout
    ipc.ts     # bridge wiring
    index.ts   # composition root: create state, engine, window
  ui/          # Svelte app (aurora-linux foundation): sidebar, command bar
  shared/      # the IPC contract types/schemas (imported by both sides)
```

## Day-one subsystems (browsers die without these)

All are EngineHost-owned session handlers with Shell-owned surfaces:

- **Downloads** — `session.on('will-download')` per profile → download
  manager records + sidebar UI. Ship-blocking.
- **Permission prompts** — `setPermissionRequestHandler` per session;
  Electron's default (silent grant/deny) is unacceptable. Prompt over IPC,
  remember decisions per profile. Ship-blocking.
- **Context menus** — page context menu + extension contributions.
- **Find-in-page** — targets the focused pane.
- **Keyboard accelerators** — single owner: main-process `Menu`. UI never
  registers its own global shortcuts; forked shortcut handling is a review
  blocker.

## Requirement ledger (owner / deletion condition)

- **One JSON store for all state** — owner: BrowserState. Revisit only if
  profiles need cross-machine sync (then per-profile files).
- **2-pane split cap** — owner: Space model. Lift to a pane-tree only when a
  real user need appears; the field is already structured to extend.
- **`electron-chrome-extensions` dependency** — owner: EngineHost. Deletion
  condition: Electron ships first-party extension support.

## Validation

- BrowserState: pure unit tests on transitions (no Electron needed).
- EngineHost: reconciliation tests — given state X then X', assert views
  created/destroyed/moved correctly.
- Contract: schema round-trip tests on the IPC types.
- Crash: kill a WebContentsView, assert tab record survives and reloads.
- Restore: serialize → restart → assert identical sidebar.
