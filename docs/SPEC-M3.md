# M3 Spec — Chrome extensions

Authority: docs/ARCHITECTURE.md ("Extensions are not free"). Extend the
existing codebase. Library: `electron-chrome-extensions` (pin exact
version) + `electron-chrome-web-store` for store installs.

## Chunk 1 — ExtensionBridge core

- New module `src/main/engine/extension-bridge.ts`: one `ElectronChromeExtensions`
  instance per profile session, created lazily in `EngineHost#sessionFor`.
- The bridge implements the library's tab-management callbacks
  (`createTab`, `selectTab`, `removeTab`, `windowsGetCurrent` etc.) by
  dispatching BrowserState commands (`openTab` in the profile's active
  space, `setActiveTab`, `closeTab`) and reading the current snapshot —
  scoped to that profile's tabs only.
- Every WebContentsView the engine creates/destroys for a profile is
  registered/unregistered with that profile's bridge (`addTab`/`removeTab`),
  and the active tab is reported on every sync (`selectTab`).
- Extensions load from `<userData>/extensions/<profileId>/` at session
  creation (`loadExtension` for each subdirectory, unpacked format).
- Preload note: the library needs its preload injected into view sessions —
  follow the library README exactly.
- Keyboard/UI surfaces come in chunk 2; chunk 1 is engine-side only.
- Tests: bridge callbacks scoped per profile (openTab lands in the
  profile's active space; other profiles' tabs invisible), register/
  unregister on view create/destroy. Mock the library — do NOT require
  real Chromium in tests.

## Chunk 2 — Web Store install + management UI

- `electron-chrome-web-store` wired per session: navigating to a
  chromewebstore.google.com install button works in-app.
- Sidebar footer gains a puzzle-piece button → small panel listing
  installed extensions per active profile: name, icon, enabled toggle
  (session `removeExtension`/`loadExtension`), uninstall (delete dir +
  remove). Browser-action buttons (toolbar icons + popups) render via the
  library's `browser-action-list` custom element in the sidebar top area,
  or — if that element cannot work in our layout — a minimal actions row
  emitting `activateBrowserAction`; note which path was taken.
- State: extensions are NOT BrowserState records (Chromium owns them);
  the panel reads live from the session via a thin IPC query channel.
  Do not grow the bridge a brain.
- Tests: management IPC round-trip with a mocked session; enable/disable
  path.

## Constraints

- typecheck/test/build green after each chunk. No GUI launches, no git.
- Pin exact dependency versions; note MV3 limitations found in the
  library's docs in a comment.
- Target validation extensions (manual, operator-run): uBlock Origin Lite,
  dark reader.
