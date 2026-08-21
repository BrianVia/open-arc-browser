import { BrowserWindow, Menu, WebContentsView, app, clipboard, nativeImage, session, type DownloadItem, type MenuItemConstructorOptions, type Rectangle, type Session, type WebContents } from 'electron'
import { basename, join } from 'node:path'
import { nanoid } from 'nanoid'
import { installChromeWebStore, uninstallExtension } from 'electron-chrome-web-store'
import { IPC_CHANNELS, extensionInfoSchema, extensionsEventSchema, findEventSchema, isInternalUrl, permissionRequestEventSchema, type AppState, type BrowserCommand, type ExtensionInfo, type ExtensionsEvent, type ExtensionsQuery, type FindEvent, type PermissionRequestEvent, type PermissionType, type Tab } from '../../shared'
import { findRememberedPermission } from '../state/transitions'
import { ExtensionBridge, extensionsRootFor } from './extension-bridge'
import { wirePageEvents } from './events'
import { buildPageContextMenu, type ContextMenuParams } from './context-menu'

export interface ViewInsets { sidebarWidth: number; top: number }

export interface EngineDependencies {
  createId?: () => string
  internalPageUrl?: (surface: string) => string
}

interface ViewRecord {
  view: WebContentsView
  tabId: string
  profileId: string
  attached: boolean
  requestedUrl: string
  internal: boolean
}

interface PendingPermission {
  origin: string
  permission: PermissionType
  profileId: string
  contentsId: number
  decide: (allow: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

interface DisabledExtension {
  path: string
  info: ExtensionInfo
}

const PROGRESS_INTERVAL_MS = 500
const PERMISSION_TIMEOUT_MS = 30_000
const PROMPTED_PERMISSIONS: Record<string, PermissionType> = {
  notifications: 'notifications',
  geolocation: 'geolocation',
  media: 'media',
  'clipboard-read': 'clipboard-read',
  pointerLock: 'pointerLock'
}

export class EngineHost {
  readonly #window: BrowserWindow
  readonly #emit: (command: BrowserCommand) => void
  readonly #createId: () => string
  readonly #internalPageUrl: ((surface: string) => string) | undefined
  readonly #views = new Map<string, ViewRecord>()
  readonly #contentsToTab = new Map<number, string>()
  readonly #sessions = new Map<string, Session>()
  readonly #bridges = new Map<string, ExtensionBridge>()
  readonly #extensionReady = new Map<string, Promise<void>>()
  readonly #disabledExtensions = new Map<string, Map<string, DisabledExtension>>()
  readonly #lastProgressAt = new Map<string, number>()
  readonly #pendingPermissions = new Map<string, PendingPermission>()
  #findOpen = false
  #findContentsId: number | undefined
  #state: AppState

  constructor(window: BrowserWindow, initialState: AppState, emit: (command: BrowserCommand) => void, dependencies: EngineDependencies = {}) {
    this.#window = window
    this.#state = initialState
    this.#emit = emit
    this.#createId = dependencies.createId ?? nanoid
    this.#internalPageUrl = dependencies.internalPageUrl
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
      if (!record.internal && record.requestedUrl !== tab.url && record.view.webContents.getURL() !== tab.url) {
        record.requestedUrl = tab.url
        void record.view.webContents.loadURL(tab.url)
      }
    })
    for (const bridge of this.#bridges.values()) bridge.syncActiveTab(state)
  }

  destroy(): void {
    for (const requestId of [...this.#pendingPermissions.keys()]) this.#settlePermission(requestId, false)
    for (const record of [...this.#views.values()]) this.#destroy(record)
  }

  reloadFocused(hard = false): void {
    const contents = this.#focusedContents()
    if (!contents) return
    if (hard) contents.reloadIgnoringCache()
    else contents.reload()
  }

  toggleFindBar(): void {
    this.#findOpen = !this.#findOpen
    this.#sendFindEvent({ type: 'toggle' })
    if (!this.#findOpen) this.#endFindSession()
  }

  findInPage(text: string, options: { forward?: boolean; findNext?: boolean } = {}): void {
    const contents = this.#focusedContents()
    if (!contents) return
    if (!text.trim()) {
      contents.stopFindInPage('clearSelection')
      return
    }
    this.#findContentsId = contents.id
    contents.findInPage(text, { forward: options.forward ?? true, findNext: options.findNext ?? false })
  }

  closeFind(): void {
    if (!this.#findOpen) return
    this.#findOpen = false
    this.#endFindSession()
  }

  isInternalSurface(contents: WebContents): boolean {
    const tabId = this.#contentsToTab.get(contents.id)
    const record = tabId ? this.#views.get(tabId) : undefined
    return record?.internal ?? false
  }

  async handleExtensionsQuery(query: ExtensionsQuery): Promise<ExtensionsEvent> {
    const profileId = this.#activeProfileId()
    const profileSession = this.#sessionFor(profileId)
    await this.#extensionReady.get(profileId)
    const disabled = this.#disabledExtensions.get(profileId) ?? new Map<string, DisabledExtension>()
    this.#disabledExtensions.set(profileId, disabled)

    if (query.type === 'setEnabled') {
      if (query.enabled) {
        const record = disabled.get(query.id)
        if (record) {
          await profileSession.loadExtension(record.path)
          disabled.delete(query.id)
        }
      } else {
        const extension = profileSession.getExtension(query.id)
        if (extension) {
          disabled.set(query.id, { path: extension.path, info: extensionInfo(extension, false) })
          profileSession.removeExtension(query.id)
        }
      }
    } else if (query.type === 'uninstall') {
      await uninstallExtension(query.id, { session: profileSession, extensionsPath: extensionsRootFor(profileId) })
      disabled.delete(query.id)
    }

    const loaded = profileSession.getAllExtensions().map((extension) => extensionInfo(extension, true))
    for (const extension of loaded) disabled.delete(extension.id)
    const extensions = [...loaded, ...[...disabled.values()].map((record) => record.info)]
      .sort((left, right) => left.name.localeCompare(right.name))
    return extensionsEventSchema.parse({ type: 'list', profileId, extensions })
  }

  #activeProfileId(): string {
    const space = this.#state.spaces.find((item) => item.id === this.#state.activeSpaceId)
    if (!space) throw new Error(`Active space ${this.#state.activeSpaceId} is missing`)
    return space.profileId
  }

  #focusedContents(): WebContents | undefined {
    const space = this.#state.spaces.find((item) => item.id === this.#state.activeSpaceId)
    const tabId = space?.split?.panes[space.split.focused] ?? this.#state.activeTabId[this.#state.activeSpaceId]
    const record = tabId ? this.#views.get(tabId) : undefined
    const contents = record?.view.webContents
    return contents && !contents.isDestroyed() ? contents : undefined
  }

  #endFindSession(): void {
    this.#findContentsId = undefined
    const contents = this.#focusedContents()
    if (!contents) return
    contents.stopFindInPage('clearSelection')
    contents.focus()
  }

  #sendFindEvent(event: FindEvent): void {
    const payload = findEventSchema.parse(event)
    const contents = this.#window.webContents
    if (!contents || contents.isDestroyed()) return
    contents.send(IPC_CHANNELS.findEvent, payload)
  }

  #wireContextMenu(contents: WebContents, tabId: string): void {
    contents.on('context-menu', (_event, params: ContextMenuParams) => {
      const tab = this.#state.tabs.find((item) => item.id === tabId)
      const template = buildPageContextMenu(contents, params, {
        copyText: (text) => clipboard.writeText(text),
        openLinkInNewTab: (url) => {
          if (tab) this.#emit({ type: 'openTab', url, spaceId: tab.spaceId })
        }
      })
      Menu.buildFromTemplate(template as MenuItemConstructorOptions[]).popup({ window: this.#window })
    })
  }

  #create(tab: Tab): ViewRecord {
    const space = this.#state.spaces.find((item) => item.id === tab.spaceId)
    const profile = space && this.#state.profiles.find((item) => item.id === space.profileId)
    if (!profile) throw new Error(`Cannot create a view for tab ${tab.id}: profile is missing`)
    const internal = isInternalUrl(tab.url)
    const requestedUrl = internal ? this.#internalPageUrlFor('extensions') : tab.url
    const view = new WebContentsView({
      webPreferences: internal
        // Internal pages render in the window's default session so extension
        // content (partitioned per profile) can never script them.
        ? {
            preload: join(__dirname, '../preload/index.cjs'),
            sandbox: true,
            contextIsolation: true
          }
        : {
            session: this.#sessionFor(profile.id),
            sandbox: true,
            contextIsolation: true
          }
    })
    const record: ViewRecord = { view, tabId: tab.id, profileId: profile.id, attached: false, requestedUrl, internal }
    this.#views.set(tab.id, record)
    this.#contentsToTab.set(view.webContents.id, tab.id)
    if (internal) {
      this.#emit({ type: 'tabEvent', tabId: tab.id, event: { title: 'Extensions' } })
      view.webContents.on('will-navigate', (event) => event.preventDefault())
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    } else {
      this.#bridges.get(profile.id)?.addTab(view.webContents)
    }
    wirePageEvents(view.webContents, {
      tabFor: (contents) => this.#contentsToTab.get(contents.id),
      state: () => this.#state,
      emit: this.#emit
    }, () => this.#destroy(record))
    if (!internal) this.#wirePopupPolicy(view.webContents, tab.id)
    this.#wireContextMenu(view.webContents, tab.id)
    view.webContents.on('found-in-page', (_event, result) => {
      if (!this.#findOpen || this.#findContentsId !== view.webContents.id) return
      this.#sendFindEvent({ type: 'matches', activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches })
    })
    if (internal) {
      void view.webContents.loadURL(requestedUrl)
    } else if (tab.nav.entries.length) {
      void view.webContents.navigationHistory.restore({ entries: tab.nav.entries, index: tab.nav.index })
    } else {
      void view.webContents.loadURL(tab.url)
    }
    return record
  }

  #internalPageUrlFor(surface: string): string {
    if (!this.#internalPageUrl) throw new Error(`EngineHost: internalPageUrl dependency is required to realize the ${surface} surface`)
    return this.#internalPageUrl(surface)
  }

  #sessionFor(profileId: string): Session {
    let existing = this.#sessions.get(profileId)
    if (!existing) {
      existing = session.fromPartition(`persist:profile-${profileId}`)
      this.#wireDownloads(existing)
      this.#wirePermissions(existing)
      this.#bridges.set(profileId, new ExtensionBridge(existing, {
        profileId,
        window: this.#window,
        emit: this.#emit,
        getState: () => this.#state,
        viewForTab: (tabId) => this.#views.get(tabId)?.view.webContents,
        tabIdFor: (contents) => this.#contentsToTab.get(contents.id)
      }))
      // v0.13 defaults to MV3-only installs. Combined with the extension
      // bridge's partial MV3 implementation, target extensions still require
      // the manual validation called out in SPEC-M3.
      const ready = installChromeWebStore({
        session: existing,
        extensionsPath: extensionsRootFor(profileId),
        allowUnpackedExtensions: true
      }).catch((error) => console.error(`ExtensionBridge: failed to initialize Chrome Web Store for profile ${profileId}`, error))
      this.#extensionReady.set(profileId, ready)
      this.#sessions.set(profileId, existing)
    }
    return existing
  }

  #wirePermissions(profileSession: Session): void {
    profileSession.setPermissionRequestHandler((contents, permission, callback) => {
      this.#handlePermissionRequest(contents, permission, callback)
    })
  }

  answerPermission(id: string, allow: boolean, remember: boolean): void {
    const pending = this.#pendingPermissions.get(id)
    if (!pending) return
    if (remember) this.#emit({ type: 'rememberPermission', profileId: pending.profileId, origin: pending.origin, permission: pending.permission, allow })
    this.#settlePermission(id, allow)
  }

  #handlePermissionRequest(contents: WebContents, permission: string, callback: (allow: boolean) => void): void {
    if (permission === 'fullscreen') {
      callback(true)
      return
    }
    const mapped = PROMPTED_PERMISSIONS[permission]
    const origin = originOf(contents.getURL())
    const profileId = mapped && origin ? this.#profileIdForContents(contents) : undefined
    if (!mapped || !origin || !profileId || contents.isDestroyed()) {
      callback(false)
      return
    }
    const remembered = findRememberedPermission(this.#state, profileId, origin, mapped)
    if (remembered !== undefined) {
      callback(remembered)
      return
    }
    const id = this.#createId()
    const timer = setTimeout(() => this.#settlePermission(id, false), PERMISSION_TIMEOUT_MS)
    this.#pendingPermissions.set(id, { origin, permission: mapped, profileId, contentsId: contents.id, decide: callback, timer })
    this.#sendPermissionEvent({ type: 'request', id, origin, permission: mapped })
  }

  #settlePermission(id: string, allow: boolean): void {
    const pending = this.#pendingPermissions.get(id)
    if (!pending) return
    this.#pendingPermissions.delete(id)
    clearTimeout(pending.timer)
    pending.decide(allow)
    this.#sendPermissionEvent({ type: 'closed', id })
  }

  #sendPermissionEvent(event: PermissionRequestEvent): void {
    const payload = permissionRequestEventSchema.parse(event)
    const contents = this.#window.webContents
    if (!contents || contents.isDestroyed()) return
    contents.send(IPC_CHANNELS.permissionRequest, payload)
  }

  #profileIdForContents(contents: WebContents): string | undefined {
    const tabId = this.#contentsToTab.get(contents.id)
    const tab = tabId ? this.#state.tabs.find((item) => item.id === tabId) : undefined
    const space = tab && this.#state.spaces.find((item) => item.id === tab.spaceId)
    return space?.profileId
  }

  #wireDownloads(profileSession: Session): void {
    profileSession.on('will-download', (_event, item, contents) => {
      const id = this.#createId()
      const filename = basename(item.getFilename())
      const savePath = join(app.getPath('downloads'), filename)
      item.setSavePath(savePath)
      const tabId = this.#contentsToTab.get(contents.id) ?? null
      const base = {
        id,
        tabId,
        url: item.getURL(),
        filename,
        savePath,
        receivedBytes: 0,
        totalBytes: item.getTotalBytes(),
        startedAt: Date.now()
      }
      this.#emit({ type: 'downloadEvent', download: { ...base, state: 'progressing' } })
      this.#lastProgressAt.set(id, Date.now())
      item.on('updated', (_updateEvent, updateState) => {
        if (updateState !== 'progressing') return
        const now = Date.now()
        const last = this.#lastProgressAt.get(id) ?? 0
        if (now - last < PROGRESS_INTERVAL_MS) return
        this.#lastProgressAt.set(id, now)
        this.#emit({ type: 'downloadEvent', download: { ...base, state: 'progressing', receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes() } })
      })
      item.once('done', (_doneEvent, doneState) => {
        this.#lastProgressAt.delete(id)
        const state = doneState === 'completed' ? 'done' : doneState === 'cancelled' ? 'cancelled' : 'failed'
        this.#emit({ type: 'downloadEvent', download: { ...base, state, receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes() } })
      })
    })
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
    for (const [id, pending] of this.#pendingPermissions) {
      if (pending.contentsId === record.view.webContents.id) this.#settlePermission(id, false)
    }
    if (!record.view.webContents.isDestroyed() && !record.internal) {
      this.#bridges.get(record.profileId)?.removeTab(record.view.webContents)
    }
    this.#views.delete(record.tabId)
    this.#contentsToTab.delete(record.view.webContents.id)
    if (!record.view.webContents.isDestroyed()) record.view.webContents.close()
  }
}

function extensionInfo(extension: Electron.Extension, enabled: boolean): ExtensionInfo {
  const icons = Object.entries(extension.manifest?.icons ?? {})
    .map(([size, path]) => ({ size: Number(size), path }))
    .filter((icon): icon is { size: number; path: string } => Number.isFinite(icon.size) && typeof icon.path === 'string')
    .sort((left, right) => right.size - left.size)
  const iconPath = icons[0]?.path
  const icon = iconPath ? nativeImage.createFromPath(join(extension.path, iconPath)) : undefined
  return extensionInfoSchema.parse({
    id: extension.id,
    name: extension.name,
    version: extension.version,
    icon: icon && !icon.isEmpty() ? icon.toDataURL() : null,
    enabled
  })
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}
