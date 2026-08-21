import { BrowserWindow, WebContentsView, session, type Rectangle, type WebContents } from 'electron'
import type { AppState, BrowserCommand, Tab } from '../../shared'
import { wirePageEvents } from './events'

export interface ViewInsets { sidebarWidth: number; top: number }

interface ViewRecord {
  view: WebContentsView
  tabId: string
  attached: boolean
  requestedUrl: string
}

export class EngineHost {
  readonly #window: BrowserWindow
  readonly #emit: (command: BrowserCommand) => void
  readonly #views = new Map<string, ViewRecord>()
  readonly #contentsToTab = new Map<number, string>()
  #state: AppState

  constructor(window: BrowserWindow, initialState: AppState, emit: (command: BrowserCommand) => void) {
    this.#window = window
    this.#state = initialState
    this.#emit = emit
  }

  sync(state: AppState, insets: ViewInsets): void {
    this.#state = state
    const validTabIds = new Set(state.tabs.map((tab) => tab.id))
    for (const [tabId, record] of this.#views) {
      if (!validTabIds.has(tabId)) this.#destroy(record)
    }

    const activeSpace = state.spaces.find((space) => space.id === state.activeSpaceId)
    const visibleIds = activeSpace?.split?.panes ?? (state.activeTabId[state.activeSpaceId] ? [state.activeTabId[state.activeSpaceId]] : [])
    for (const record of this.#views.values()) this.#detach(record)

    const visibleTabs = visibleIds
      .map((id) => state.tabs.find((tab) => tab.id === id && tab.spaceId === state.activeSpaceId))
      .filter((tab): tab is Tab => tab !== undefined)
    const bounds = this.#paneBounds(visibleTabs.length, insets)
    visibleTabs.forEach((tab, index) => {
      const record = this.#views.get(tab.id) ?? this.#create(tab)
      const rectangle = bounds[index]
      if (!rectangle) return
      if (!record.attached) {
        this.#window.contentView.addChildView(record.view)
        record.attached = true
      }
      record.view.setBounds(rectangle)
      if (record.requestedUrl !== tab.url && record.view.webContents.getURL() !== tab.url) {
        record.requestedUrl = tab.url
        void record.view.webContents.loadURL(tab.url)
      }
    })
  }

  destroy(): void {
    for (const record of [...this.#views.values()]) this.#destroy(record)
  }

  reloadFocused(hard = false): void {
    const space = this.#state.spaces.find((item) => item.id === this.#state.activeSpaceId)
    const tabId = space?.split?.panes[space.split.focused] ?? this.#state.activeTabId[this.#state.activeSpaceId]
    const contents = tabId ? this.#views.get(tabId)?.view.webContents : undefined
    if (!contents || contents.isDestroyed()) return
    if (hard) contents.reloadIgnoringCache()
    else contents.reload()
  }

  #create(tab: Tab): ViewRecord {
    const space = this.#state.spaces.find((item) => item.id === tab.spaceId)
    const profile = space && this.#state.profiles.find((item) => item.id === space.profileId)
    if (!profile) throw new Error(`Cannot create a view for tab ${tab.id}: profile is missing`)
    const view = new WebContentsView({
      webPreferences: {
        session: session.fromPartition(`persist:profile-${profile.id}`),
        sandbox: true,
        contextIsolation: true
      }
    })
    const record: ViewRecord = { view, tabId: tab.id, attached: false, requestedUrl: tab.url }
    this.#views.set(tab.id, record)
    this.#contentsToTab.set(view.webContents.id, tab.id)
    wirePageEvents(view.webContents, {
      tabFor: (contents) => this.#contentsToTab.get(contents.id),
      state: () => this.#state,
      emit: this.#emit
    }, () => this.#destroy(record))
    this.#wirePopupPolicy(view.webContents, tab.id)
    if (tab.nav.entries.length) {
      void view.webContents.navigationHistory.restore({ entries: tab.nav.entries, index: tab.nav.index })
    } else {
      void view.webContents.loadURL(tab.url)
    }
    return record
  }

  #wirePopupPolicy(contents: WebContents, tabId: string): void {
    contents.setWindowOpenHandler((details) => {
      const openerCoupled = details.url === 'about:blank' || details.url === ''
      if (!openerCoupled) {
        const tab = this.#state.tabs.find((item) => item.id === tabId)
        if (tab) this.#emit({ type: 'openTab', url: details.url, spaceId: tab.spaceId })
        return { action: 'deny' }
      }
      return {
        action: 'allow',
        createWindow: (options) => {
          const child = new BrowserWindow({
            ...options,
            parent: this.#window,
            frame: false,
            show: true,
            width: options.width && options.width > 0 ? options.width : 520,
            height: options.height && options.height > 0 ? options.height : 680,
            webPreferences: { ...options.webPreferences, sandbox: true, contextIsolation: true, nodeIntegration: false }
          })
          return child.webContents
        }
      }
    })
  }

  #paneBounds(count: number, insets: ViewInsets): Rectangle[] {
    if (count === 0) return []
    const [width = 0, height = 0] = this.#window.getContentSize()
    const contentWidth = Math.max(0, width - insets.sidebarWidth)
    const contentHeight = Math.max(0, height - insets.top)
    if (count === 1) return [{ x: insets.sidebarWidth, y: insets.top, width: contentWidth, height: contentHeight }]
    const firstWidth = Math.floor(contentWidth / 2)
    return [
      { x: insets.sidebarWidth, y: insets.top, width: firstWidth, height: contentHeight },
      { x: insets.sidebarWidth + firstWidth, y: insets.top, width: contentWidth - firstWidth, height: contentHeight }
    ]
  }

  #detach(record: ViewRecord): void {
    if (!record.attached) return
    this.#window.contentView.removeChildView(record.view)
    record.attached = false
  }

  #destroy(record: ViewRecord): void {
    this.#detach(record)
    this.#views.delete(record.tabId)
    this.#contentsToTab.delete(record.view.webContents.id)
    if (!record.view.webContents.isDestroyed()) record.view.webContents.close()
  }
}
