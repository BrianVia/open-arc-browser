# M2a Spec — command bar, split view, accelerators

Authority: docs/ARCHITECTURE.md. Builds on the M1 codebase (read it first —
extend, don't rewrite; M1 module boundaries are binding).

## 1. Keyboard accelerators (single owner: main-process Menu)

Application Menu built in main with accelerators (works even though the
window is frameless):

- Ctrl+T → toggle command bar (new-tab intent)
- Ctrl+L → toggle command bar (edit-current-URL intent, prefills active tab URL)
- Ctrl+W → closeTab(active)
- Ctrl+Tab / Ctrl+Shift+Tab → next/previous tab in active space
- Ctrl+1..8 → setActiveSpace by index
- Ctrl+D → toggle split: if active space has 2+ tabs and no split, split
  active tab with the next tab (focused stays on active); if split, unsplit
  (keep focused pane's tab active)
- Ctrl+R → reload focused pane; Ctrl+Shift+R hard reload
- Accelerators dispatch BrowserState commands or CommandBar toggles — no
  logic in the menu handlers beyond one dispatch each.

## 2. Command bar (frameless transparent child window)

Per ARCHITECTURE.md the palette is a separate always-on-top frameless
transparent child BrowserWindow, centered over the main window
(width ~560px, top ~18% of parent), hidden by default. Same preload, same
two IPC channels + one extra channel pair for commandbar
show/hide/query — keep the bridge thin.

Behavior:

- Opens via Ctrl+T / Ctrl+L (menu) — and Escape or blur hides it.
- One text input + result list (max 8). Sources, ranked:
  1. Open tabs in current space (fuzzy match on title+url) → switch
  2. Open tabs in other spaces → switch (switches space too)
  3. Spaces by name → setActiveSpace
  4. URL-ish input (has dot/scheme/localhost) → openTab(url)
  5. Fallback → openTab(https://duckduckgo.com/?q=<query>)
- Enter runs top result; Up/Down move selection; results update per
  keystroke from the latest state snapshot (renderer-side filtering only —
  no new main-process authority).
- Ctrl+L intent: input prefilled with active tab URL, selected; Enter
  navigates the ACTIVE tab (navigate command), not a new tab.
- Visual: aurora tokens, rounded 12px, subtle border, backdrop blur-ish
  translucent surface, dark/light aware. Match the sidebar's restraint.

## 3. Split view UI

Model + engine layout already exist (M1). Add the UI affordances:

- Sidebar tab row context/hover action: a small split icon on hover →
  setSplit(active tab, this tab, focused 0). Only when not already split
  and target ≠ active.
- When split: both panes render (engine already does); sidebar shows both
  tabs highlighted (primary = focused pane, secondary = other pane, visually
  distinct); clicking a split tab focuses that pane (new command
  setSplitFocus(spaceId, 0|1) or reuse setSplit with same panes).
- Unsplit: an × affordance on the secondary highlight, and Ctrl+D toggle.
- A 1px divider hairline between panes is fine to skip in M2a (views butt
  together) — note it as deferred.

## 4. Empty-state fix (small M1 bug)

The centered empty state ("space is ready…") did not render in validation.
Find why (likely covered by view stacking or missing state condition) and
make it show when the active space has no tabs.

## Constraints

- All M1 constraints hold (typecheck/test/build green, no any/ts-ignore,
  state module pure, thin IPC).
- New commands (`setSplit` variants, space-index activation if needed) get
  transition tests: split toggle idempotence, focus switching, split
  collapse on close (already covered — extend for setSplitFocus).
- Command bar ranking gets a pure unit test (extract ranking into a pure
  function in src/ui or src/shared — no DOM in the test).
- Do NOT launch the GUI. Do NOT run git. Acceptance: typecheck, test,
  build green; report pass counts and deviations.
