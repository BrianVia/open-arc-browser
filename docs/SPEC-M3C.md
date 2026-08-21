# M3c Spec — arc://extensions internal page

Authority: docs/ARCHITECTURE.md. Extend the existing codebase; boundaries
binding. Goal: `arc://extensions` renders a full-page extension management
UI inside a normal tab; `chrome://extensions` is an alias.

## URL normalization (owner: BrowserState)

- `src/shared/` gains an internal-url helper: `ARC_EXTENSIONS_URL =
  'arc://extensions'`, `isInternalUrl(url)`, and a normalize step mapping
  `chrome://extensions` (any case, optional trailing slash) →
  `arc://extensions`.
- `openTab`/`navigate` transitions run this normalization alongside the
  existing https-prefix normalization. Transition tests cover it.
- Remove the App.svelte submitUrl special-case for chrome://extensions —
  normalization now owns that mapping; typing it just navigates.

## Internal tab realization (owner: EngineHost)

- EngineHost gains a constructor dependency `internalPageUrl(surface:
  string): string` supplied by the composition root: dev →
  `${process.env.ELECTRON_RENDERER_URL}?surface=<surface>`; prod → a
  `file://` URL to `out/renderer/index.html` with the same query.
- In `#create`, when `tab.url` is `arc://extensions`: build the
  WebContentsView with the app preload (`../preload/index.cjs`,
  contextIsolation + sandbox true, profile session NOT required — use the
  window's default session for internal pages so extension web content
  cannot script it) and load `internalPageUrl('extensions')`.
- Internal tabs: title is fixed to 'Extensions' (set once via tabEvent),
  and url/nav tabEvents from the view are suppressed so the domain record
  keeps `arc://extensions` (guard in the events wiring by checking the
  tab's recorded url via the correlation map).
- Lock navigation: `will-navigate` on internal views calls
  `event.preventDefault()`; window.open denied.
- Popup policy, find, context menu need no changes; reload of an internal
  view just reloads the internal page.

## Extensions IPC from internal pages (owner: thin bridge)

- The `extensions:query` channel currently accepts only the shell sender.
  wireIpc gains a predicate parameter `isInternalSurface(contents:
  WebContents): boolean` (composition root passes a check owned by
  EngineHost: the contents belongs to a live internal extensions view).
  Queries from shell OR internal surfaces are accepted; the reply event
  goes back to the requesting sender (already the case).
- IMPORTANT scoping: the list must be for the ACTIVE profile (existing
  behavior); internal pages don't pick profiles in this milestone.

## The page (renderer)

- `src/ui/main.ts`: `surface=extensions` mounts a new
  `src/ui/ExtensionsPage.svelte`.
- Full-page management UI, aurora tokens, generous layout (max-width
  ~640px, centered, page title 'Extensions', profile name subtitle):
  extension rows with icon, name, version, enabled toggle, uninstall —
  same interactions as the sidebar panel (reuse patterns; extract shared
  row logic only if it stays clean, do not force a shared component).
- Live refresh: re-query on mount and after every toggle/uninstall reply
  (the reply event already carries the new list).
- Empty state: hint text pointing at chromewebstore.google.com.

## Tests

- transitions: chrome://extensions and arc://extensions normalization in
  openTab and navigate; internal url untouched by https-prefixing.
- engine: internal tab creates a view loading internalPageUrl with the
  preload, suppresses url tabEvents, keeps record url arc://extensions;
  will-navigate prevented.
- ipc: extensions query accepted from an internal-surface sender and
  rejected from a random one.

## Constraints

- typecheck/test/build green. No GUI launches, no git. Report files
  changed, pass counts, deviations.
