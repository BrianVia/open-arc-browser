# M2b Spec — downloads, permission prompts, context menu, find-in-page

Authority: docs/ARCHITECTURE.md ("Day-one subsystems"). Extend the existing
codebase; module boundaries are binding. All M1/M2a constraints hold.

## 1. Downloads

- EngineHost registers `session.on('will-download')` per profile session.
- New domain records owned by BrowserState: `downloads: [{id, tabId|null,
  url, filename, savePath, state: 'progressing'|'done'|'failed'|'cancelled',
  receivedBytes, totalBytes, startedAt}]` (additive AppState field —
  bump persisted schema handling additively; missing field = []).
- Engine reports progress via new engine-reported commands
  (`downloadEvent`), throttled to ≤2 updates/sec per item.
- Keep at most 50 most-recent download records; persist them.
- UI: a small downloads section above the space switcher in the sidebar,
  visible only when there are downloads from the last 24h: filename,
  progress bar while progressing, click opens containing folder
  (`shell.showItemInFolder` — via a shellCommand, main-side).
- Save path: default download dir, no prompt in this milestone.

## 2. Permission prompts

- `setPermissionRequestHandler` per profile session in EngineHost.
- New IPC surface (thin): main → renderer `permissionRequest {id,
  origin, permission}`; renderer → main decision {id, allow,
  remember}.
- UI: an inline prompt bar pinned at the top of the sidebar (not a modal):
  "example.com wants to use your camera" Allow / Block + "remember"
  checkbox.
- Remembered decisions live in BrowserState: `permissions: [{profileId,
  origin, permission, allow}]` — checked before prompting. Additive field.
- Unanswered requests deny after 30s or when the requesting tab closes.
- Handle at minimum: notifications, geolocation, media (camera/mic),
  clipboard-read, pointerLock, fullscreen (fullscreen: auto-allow).

## 3. Context menu (page)

- Main-process `Menu.buildFromTemplate` on `context-menu` event of each
  view's webContents: Back/Forward/Reload (enabled per canGoBack etc.),
  separator, Copy/Paste/Cut (per editFlags), Copy Link Address (when
  linkURL), Open Link in New Tab (→ openTab in same space), separator,
  Inspect Element.
- No renderer involvement.

## 4. Find-in-page

- Ctrl+F accelerator → toggles a small find bar in the SIDEBAR top area
  (below URL pill; the page area cannot be overlaid — layout contract).
- Input + match count (`found-in-page` event) + next/prev (Enter /
  Shift+Enter) + Escape closes and `stopFindInPage('clearSelection')`.
- Targets the focused pane's webContents via EngineHost
  (`findInPage(text, {forward, findNext})` passthrough — thin command).

## Constraints

- Transition tests for download/permission records (add, throttle-agnostic
  progress update, 50-cap, remembered-permission lookup). Engine tests: a
  will-download mock flows into state; permission handler consults
  remembered decisions before emitting a request.
- typecheck/test/build green. No GUI. No git. Report pass counts and
  deviations.
