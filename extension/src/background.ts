import { chromeGroupColor, mostRecentTabId, SpaceStore } from './state'

// The background worker is the single owner of space membership. UI pages only
// send messages or call tabs/windows directly; every membership change flows
// through this store and is persisted debounced.
const store = new SpaceStore({ storage: chrome.storage.local })

/** Runtime-only tab-group ids per `windowId:spaceId`; groups do not survive restarts, so this map is not persisted. */
const groups = new Map<string, number>()

function groupKey(windowId: number, spaceId: string): string {
  return `${windowId}:${spaceId}`
}

/**
 * Invariant: seed a window's state from real Chrome tabs before any event for
 * that window is dispatched, so passive events never materialize empty windows.
 */
async function ensureWindow(windowId: number): Promise<void> {
  await store.hydrate()
  if (store.has(windowId)) return
  const [tabs, activeTabs] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabs.query({ windowId, active: true })
  ])
  const activeId = activeTabs[0]?.id
  const pinned = tabs.filter((tab) => tab.pinned).map((tab) => tab.id!).filter((id) => id !== undefined)
  // Recency order: creation order, except the active tab is most recent.
  const ordered = tabs.map((tab) => tab.id!).filter((id) => id !== undefined && !pinned.includes(id))
  const regular = activeId !== undefined && !pinned.includes(activeId) ? [...ordered.filter((id) => id !== activeId), activeId] : ordered
  store.dispatch(windowId, { type: 'windowSeeded', tabIds: regular, pinnedTabIds: pinned })
  await regroupWindow(windowId)
}

/** Keep one named/colored Chrome tab group per space so the native strip maps spaces visually. */
async function regroupWindow(windowId: number): Promise<void> {
  const state = store.snapshot(windowId)
  const tabs = await chrome.tabs.query({ windowId })
  const byId = new Map(tabs.map((tab) => [tab.id!, tab]))
  for (const space of state.spaces) {
    const key = groupKey(windowId, space.id)
    try {
      const regular = space.tabIds.filter((tabId) => byId.has(tabId))
      if (regular.length === 0) {
        groups.delete(key)
        continue
      }
      // Reuse an existing group after service-worker restarts when the tabs still share one.
      const existing = groups.get(key) ?? byId.get(regular[0]!)?.groupId
      const groupId = await chrome.tabs.group(existing === undefined ? { tabIds: regular } : { tabIds: regular, groupId: existing })
      groups.set(key, groupId)
      await chrome.tabGroups.update(groupId, { title: space.name, color: chromeGroupColor(space.color) })
    } catch {
      // Grouping is cosmetic (stage 1); never let it break membership.
    }
  }
}

function dispatchAndRegroup(windowId: number, event: Parameters<SpaceStore['dispatch']>[1]): Promise<void> {
  store.dispatch(windowId, event)
  return regroupWindow(windowId).catch(() => {})
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

chrome.tabs.onCreated.addListener((tab) => {
  void (async () => {
    if (tab.id === undefined || tab.windowId === chrome.windows.WINDOW_ID_NONE) return
    await ensureWindow(tab.windowId)
    await dispatchAndRegroup(tab.windowId, { type: 'tabCreated', tabId: tab.id })
  })()
})

chrome.tabs.onRemoved.addListener((tabId, info) => {
  void (async () => {
    await store.hydrate()
    if (!store.has(info.windowId)) return
    await dispatchAndRegroup(info.windowId, { type: 'tabRemoved', tabId })
  })()
})

chrome.tabs.onActivated.addListener((info) => {
  void (async () => {
    await ensureWindow(info.windowId)
    store.dispatch(info.windowId, { type: 'tabActivated', tabId: info.tabId })
  })()
})

chrome.tabs.onAttached.addListener((tabId, info) => {
  void (async () => {
    await ensureWindow(info.newWindowId)
    await dispatchAndRegroup(info.newWindowId, { type: 'tabCreated', tabId })
  })()
})

chrome.tabs.onDetached.addListener((tabId, info) => {
  void (async () => {
    await store.hydrate()
    if (!store.has(info.oldWindowId)) return
    await dispatchAndRegroup(info.oldWindowId, { type: 'tabRemoved', tabId })
  })()
})

chrome.windows.onRemoved.addListener((windowId) => {
  store.forget(windowId)
})

interface MessageResponse {
  ok: boolean
  spaces?: ReturnType<SpaceStore['snapshot']>['spaces']
  activeSpaceId?: string
  error?: string
}

function sendCurrent(windowId: number, sendResponse: (response: MessageResponse) => void): void {
  const state = store.snapshot(windowId)
  sendResponse({ ok: true, spaces: state.spaces, activeSpaceId: state.activeSpaceId })
}

chrome.runtime.onMessage.addListener((message: { type?: string; [key: string]: unknown }, _sender, sendResponse: (response: MessageResponse) => void) => {
  void (async () => {
    try {
      switch (message.type) {
        case 'switchSpace': {
          const windowId = Number(message.windowId)
          const spaceId = String(message.spaceId)
          await ensureWindow(windowId)
          store.dispatch(windowId, { type: 'spaceFocused', spaceId })
          const space = store.snapshot(windowId).spaces.find((item) => item.id === spaceId)
          const tabId = space ? mostRecentTabId(space) : undefined
          if (tabId !== undefined) {
            await chrome.tabs.update(tabId, { active: true })
            await chrome.windows.update(windowId, { focused: true })
          }
          sendCurrent(windowId, sendResponse)
          break
        }
        case 'createSpace': {
          const windowId = Number(message.windowId)
          await ensureWindow(windowId)
          store.dispatch(windowId, { type: 'spaceCreated', name: String(message.name ?? ''), color: String(message.color ?? '#8b7cf6') })
          sendCurrent(windowId, sendResponse)
          break
        }
        case 'getState': {
          const windowId = Number(message.windowId)
          await ensureWindow(windowId)
          sendCurrent(windowId, sendResponse)
          break
        }
        case 'togglePin': {
          const tabId = Number(message.tabId)
          const pinned = Boolean(message.pinned)
          const tab = await chrome.tabs.get(tabId)
          await ensureWindow(tab.windowId)
          // Pinning ungroups automatically; our membership record follows here.
          await chrome.tabs.update(tabId, { pinned })
          store.dispatch(tab.windowId, { type: 'pinToggled', tabId, pinned })
          await regroupWindow(tab.windowId).catch(() => {})
          sendCurrent(tab.windowId, sendResponse)
          break
        }
        default:
          sendResponse({ ok: false, error: 'unknown message' })
      }
    } catch (error) {
      sendResponse({ ok: false, error: String(error) })
    }
  })()
  return true // async sendResponse
})
