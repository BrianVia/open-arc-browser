# M4 Spec — Arc UI on the Chromium fork (stage 1: pure extension)

Goal: our Arc UI (sidebar, spaces, command bar) running on the local
Chromium build (~/Development/chromium/src/out/Default/chrome) as an MV3
extension — ZERO Chromium patches in this stage.

## New top-level dir: `extension/`

Self-contained Vite + Svelte 5 project (own package.json; reuse the repo's
Svelte/TS versions). Output `extension/dist/` is a loadable unpacked MV3
extension. Scripts: `dev` (vite build --watch), `build`, `test` (vitest),
`typecheck`.

## Manifest (MV3)

- `side_panel.default_path`: sidebar.html — opens on toolbar click
  (`side_panel.setPanelBehavior({openPanelOnActionClick:true})`).
- `chrome_url_overrides.newtab`: newtab.html — the command bar surface.
- Background service worker: background.ts.
- Permissions: tabs, tabGroups, sidePanel, storage, favicon.
- Use `chrome.runtime` typing via `@types/chrome` (devDependency — justify
  in package.json comment).

## Domain: spaces over real Chrome tabs

Module `extension/src/state.ts` (pure TS + thin chrome adapter):

- Space: `{id, name, color, tabIds: number[] (Chrome tab ids, ordered),
  pinnedTabIds: number[]}`; store spaces + activeSpaceId per window in
  `chrome.storage.local`; nanoid ids (reuse dependency).
- The background worker is the single owner of space membership: new tabs
  join the active space of their window (tabs.onCreated), removed tabs
  leave (tabs.onRemoved); persisted debounced (reuse the 500ms pattern).
- Switching spaces: show/activate the space's most-recent tab; DO NOT try
  to hide other tabs (Chrome cannot hide tabs; the native strip shows all
  until stage 2). Optionally group each space's tabs into one
  chrome.tabGroups group named/colored per space so the native strip stays
  organized — do this; it is cheap and visually maps spaces today.
- Pure transition logic separated from chrome.* calls (mirror the
  BrowserState/EngineHost split from src/ — but do NOT import src/main;
  copy the minimal patterns).

## Sidebar (side panel, sidebar.html)

Port `src/ui/App.svelte`'s look with the foundation files (copy
`src/ui/foundation/theme.css`, SidebarItem, Button into
`extension/src/foundation/`): space-tinted background, URL/search pill
(Enter → chrome.tabs.update active tab / chrome.tabs.create), pinned
section, tab rows (favicon via chrome://favicon2 or tab.favIconUrl, title,
close ×, middle-click close), space dots + create-space at bottom.
Live updates via chrome.tabs events + storage.onChanged. Drop: downloads
section, permission prompts, find bar (native Chrome owns all three now).

## Command bar (newtab.html)

Ctrl+T opens a new tab → our page: centered palette (port CommandBar.svelte
styling), fuzzy ranking REUSED from `src/ui/commandBarRanking.ts` — copy
the pure module + its test, adapting inputs (chrome tabs + spaces instead
of AppState). Enter: switch to tab (chrome.tabs.update + windows.update,
then close the newtab tab), switch space, or navigate current tab /
search DuckDuckGo. Esc closes the tab. Show top-8 results as you type;
initial state shows spaces + recent tabs.

## Launcher

`extension/bin/arc` shell script: launches
`~/Development/chromium/src/out/Default/chrome` with
`--user-data-dir=$HOME/.config/open-arc-fork`,
`--load-extension=<repo>/extension/dist`, `--ozone-platform=wayland`,
`--no-sandbox` (ponytail: until the SUID helper is set up — comment it),
`--no-first-run`. Plus `--silent-debugger-extension-api` not needed.

## Tests (vitest, no real Chrome)

- state.ts transitions: tab joins active space on create, leaves on
  remove, space switch picks most-recent tab, pinned toggling, persistence
  debounce (fake timers), storage round-trip with a mocked chrome.storage.
- ranking: port the existing command-bar-ranking tests to the new input
  shape.
- Mock `chrome.*` with a tiny hand-rolled object — no sinon-chrome dep.

## Constraints

- Do not modify anything under src/ (the Electron app keeps working).
- typecheck/test/build green in extension/. No GUI launches, no git.
- Final message: files, pass counts, deviations.
