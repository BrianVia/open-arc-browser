// Service-worker preload that fills chrome.* API gaps left by
// electron-chrome-extensions with inert event objects, so extension
// workers boot instead of crashing on `undefined.addListener`.
//
// Observed needs: uBlock Origin Lite (permissions.onAdded/onRemoved),
// 1Password (tabs.onRemoved, contextMenus.onClicked,
// notifications.onClicked). Only fills what is missing (??=) — real
// implementations from the library or Electron always win.
//
// ponytail: inert events mean those callbacks never fire (e.g. an
// extension won't see a context-menu click routed through a stubbed
// event). Upgrade path: implement the event in the library and delete
// the stub here.

interface InertEvent {
  addListener(): void
  removeListener(): void
  hasListener(): boolean
  hasListeners(): boolean
}

function inertEvent(): InertEvent {
  return {
    addListener() {},
    removeListener() {},
    hasListener: () => false,
    hasListeners: () => false
  }
}

type ChromeLike = Record<string, Record<string, unknown> | undefined>

const GAPS: Record<string, string[]> = {
  permissions: ['onAdded', 'onRemoved'],
  tabs: ['onCreated', 'onUpdated', 'onRemoved', 'onActivated', 'onReplaced'],
  contextMenus: ['onClicked'],
  notifications: ['onClicked', 'onClosed', 'onButtonClicked'],
  commands: ['onCommand'],
  windows: ['onCreated', 'onRemoved', 'onFocusChanged']
}

const chromeGlobal = (globalThis as { chrome?: ChromeLike }).chrome
if (chromeGlobal) {
  for (const [namespace, events] of Object.entries(GAPS)) {
    const target = (chromeGlobal[namespace] ??= {})
    for (const event of events) target[event] ??= inertEvent()
  }
}

export {}
