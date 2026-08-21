import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clipboard, Menu, type BrowserWindow, type MenuItemConstructorOptions, type Rectangle } from 'electron'
import type { AppState, BrowserCommand, Tab } from '../src/shared'
import { createDefaultState, transition, type TransitionDependencies } from '../src/main/state/transitions'

interface MockViewRecord {
  options: Record<string, unknown>
  webContents: {
    id: number
    closed: boolean
    currentUrl: string
    reloadCount: number
    hardReloadCount: number
    goBackCount: number
    goForwardCount: number
    canGoBack: boolean
    canGoForward: boolean
    inspectCalls: Array<[number, number]>
    findCalls: Array<{ text: string; options: Record<string, unknown> }>
    stopFindCalls: string[]
    focusCount: number
    handlers: Map<string, Array<(...args: unknown[]) => void>>
    windowOpenHandler: ((details: { url: string }) => unknown) | undefined
    getURL(): string
    loadURL(url: string): Promise<void>
    isDestroyed(): boolean
    on(event: string, handler: (...args: unknown[]) => void): unknown
    fire(event: string, ...args: unknown[]): Promise<void>
  }
  bounds: Rectangle | undefined
}

interface MockDownloadItem {
  savePath: string
  getURL(): string
  getFilename(): string
  setSavePath(path: string): void
  getReceivedBytes(): number
  getTotalBytes(): number
  on(event: string, handler: (...args: unknown[]) => void): unknown
  once(event: string, handler: (...args: unknown[]) => void): unknown
  fire(event: string, ...args: unknown[]): Promise<void>
}

interface MockPermissionHandler {
  (contents: { id: number; getURL(): string; isDestroyed(): boolean }, permission: string, callback: (allow: boolean) => void): void
}

interface MockExtensionsInstance {
  options: {
    license?: string
    session?: unknown
    createTab?: (details: { url?: string }) => Promise<[unknown, unknown]>
    selectTab?: (tab: unknown) => void
    removeTab?: (tab: unknown) => void
  }
  added: Array<{ tab: unknown; window: unknown }>
  removed: unknown[]
  selected: unknown[]
}

const crx = vi.hoisted(() => ({ instances: [] as unknown[] }))
const extensionInstances = (): MockExtensionsInstance[] => crx.instances as MockExtensionsInstance[]
const webStore = vi.hoisted(() => ({ installs: [] as unknown[], uninstalls: [] as unknown[] }))

vi.mock('electron-chrome-web-store', () => ({
  installChromeWebStore: vi.fn(async (options: unknown) => { webStore.installs.push(options) }),
  uninstallExtension: vi.fn(async (id: string, options: { session: MockProfileSession }) => {
    webStore.uninstalls.push({ id, options })
    options.session.removeExtension(id)
  })
}))

vi.mock('electron-chrome-extensions', () => ({
  ElectronChromeExtensions: class {
    options: MockExtensionsInstance['options']
    added: MockExtensionsInstance['added'] = []
    removed: unknown[] = []
    selected: unknown[] = []
    constructor(options: MockExtensionsInstance['options']) {
      this.options = options
      crx.instances.push(this)
    }
    addTab(tab: unknown, window: unknown): void { this.added.push({ tab, window }) }
    removeTab(tab: unknown): void { this.removed.push(tab) }
    selectTab(tab: unknown): void { this.selected.push(tab) }
  }
}))

interface MockExtension {
  id: string
  name: string
  version: string
  path: string
  url: string
  manifest: { icons?: Record<string, string> }
}

interface MockProfileSession {
  on(event: string, handler: (...args: unknown[]) => void): void
  fire(event: string, ...args: unknown[]): Promise<void>
  handlers: Map<string, Array<(...args: unknown[]) => void>>
  permissionHandler?: MockPermissionHandler
  setPermissionRequestHandler(handler: MockPermissionHandler): void
  extensions: Map<string, MockExtension>
  removedExtensions: Map<string, MockExtension>
  loadedPaths: string[]
  getAllExtensions(): MockExtension[]
  getExtension(id: string): MockExtension | null
  loadExtension(path: string): Promise<MockExtension>
  removeExtension(id: string): void
}

const mock = vi.hoisted(() => ({
  views: [] as MockViewRecord[],
  nextContentsId: 0,
  sessions: new Map<string, MockProfileSession>()
}))

vi.mock('electron', () => {
  class MockWebContents {
    readonly id = ++mock.nextContentsId
    readonly navigationHistory = {
      restore: async ({ entries, index }: { entries: Array<{ url: string }>; index?: number }) => {
        this.currentUrl = entries[index ?? entries.length - 1]?.url ?? ''
      },
      canGoBack: () => this.canGoBack,
      canGoForward: () => this.canGoForward
    }
    closed = false
    currentUrl = ''
    reloadCount = 0
    hardReloadCount = 0
    goBackCount = 0
    goForwardCount = 0
    canGoBack = false
    canGoForward = false
    inspectCalls: Array<[number, number]> = []
    findCalls: Array<{ text: string; options: Record<string, unknown> }> = []
    stopFindCalls: string[] = []
    focusCount = 0
    handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    windowOpenHandler: ((details: { url: string }) => unknown) | undefined
    on(event: string, handler: (...args: unknown[]) => void): this {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
      return this
    }
    async fire(event: string, ...args: unknown[]): Promise<void> {
      for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args)
    }
    setWindowOpenHandler(handler: (details: { url: string }) => unknown): void {
      this.windowOpenHandler = handler
    }
    getURL(): string { return this.currentUrl }
    async loadURL(url: string): Promise<void> { this.currentUrl = url }
    isDestroyed(): boolean { return this.closed }
    close(): void { this.closed = true }
    reload(): void { this.reloadCount += 1 }
    reloadIgnoringCache(): void { this.hardReloadCount += 1 }
    goBack(): void { this.goBackCount += 1 }
    goForward(): void { this.goForwardCount += 1 }
    cut(): void {}
    copy(): void {}
    paste(): void {}
    inspectElement(x: number, y: number): void { this.inspectCalls.push([x, y]) }
    focus(): void { this.focusCount += 1 }
    findInPage(text: string, options?: Record<string, unknown>): void { this.findCalls.push({ text, options: options ?? {} }) }
    stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void { this.stopFindCalls.push(action) }
  }
  class MockWebContentsView {
    readonly webContents = new MockWebContents()
    readonly options: Record<string, unknown>
    bounds: Rectangle | undefined
    constructor(options: Record<string, unknown> = {}) {
      this.options = options
      mock.views.push(this)
    }
    setBounds(bounds: Rectangle): void { this.bounds = bounds }
  }
  return {
    app: { getPath: (name: string) => (name === 'downloads' ? '/downloads' : `/mock-${name}`) },
    BrowserWindow: class {},
    WebContentsView: MockWebContentsView,
    Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
    clipboard: { writeText: vi.fn() },
    nativeImage: {
      createFromPath: (path: string) => ({
        isEmpty: () => false,
        toDataURL: () => `data:image/mock;base64,${path}`
      })
    },
    session: {
      fromPartition: (partition: string) => {
        let existing = mock.sessions.get(partition)
        if (!existing) {
          const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
          const extensions = new Map<string, MockExtension>()
          const removedExtensions = new Map<string, MockExtension>()
          const created: MockProfileSession = {
            handlers,
            extensions,
            removedExtensions,
            loadedPaths: [],
            setPermissionRequestHandler(handler): void {
              created.permissionHandler = handler
            },
            on(event: string, handler: (...args: unknown[]) => void): void {
              handlers.set(event, [...(handlers.get(event) ?? []), handler])
            },
            async fire(event: string, ...args: unknown[]): Promise<void> {
              for (const handler of handlers.get(event) ?? []) handler(...args)
            },
            getAllExtensions: () => [...extensions.values()],
            getExtension: (id) => extensions.get(id) ?? null,
            async loadExtension(path) {
              created.loadedPaths.push(path)
              const extension = [...removedExtensions.values()].find((item) => item.path === path)
              if (!extension) throw new Error(`Unknown extension path: ${path}`)
              removedExtensions.delete(extension.id)
              extensions.set(extension.id, extension)
              return extension
            },
            removeExtension(id) {
              const extension = extensions.get(id)
              if (!extension) return
              extensions.delete(id)
              removedExtensions.set(id, extension)
            }
          }
          existing = created
          mock.sessions.set(partition, created)
        }
        return existing
      }
    }
  }
})

import { EngineHost } from '../src/main/engine/host'

class MockWindow {
  readonly children = new Set<MockViewRecord>()
  readonly webContents = {
    sent: [] as Array<{ channel: string; payload: unknown }>,
    isDestroyed(): boolean { return false },
    send(channel: string, payload: unknown): void { this.sent.push({ channel, payload }) }
  }
  readonly contentView = {
    addChildView: (view: MockViewRecord) => this.children.add(view),
    removeChildView: (view: MockViewRecord) => this.children.delete(view)
  }
  getContentSize(): [number, number] { return [1000, 700] }
}

function stateHarness(): { get: () => AppState; run: (command: BrowserCommand) => AppState } {
  let id = 0
  const dependencies: TransitionDependencies = { createId: () => `id-${++id}`, now: () => id }
  let state = createDefaultState(dependencies)
  return {
    get: () => state,
    run(command) { state = transition(state, command, dependencies); return state }
  }
}

beforeEach(() => {
  mock.views.length = 0
  mock.nextContentsId = 0
  mock.sessions.clear()
  crx.instances.length = 0
  webStore.installs.length = 0
  webStore.uninstalls.length = 0
})

function makeDownloadItem(url: string, filename: string, totalBytes: number): MockDownloadItem {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  return {
    savePath: '',
    getURL: () => url,
    getFilename: () => filename,
    setSavePath(path: string) { this.savePath = path },
    getReceivedBytes: () => 0,
    getTotalBytes: () => totalBytes,
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return this
    },
    once(event: string, handler: (...args: unknown[]) => void) {
      return this.on(event, handler)
    },
    async fire(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args)
    }
  }
}

describe('EngineHost reconciliation', () => {
  it('is idempotent and detaches background tabs without destroying them', () => {
    const states = stateHarness()
    const window = new MockWindow()
    const host = new EngineHost(window as unknown as BrowserWindow, states.get(), () => {})
    const insets = { sidebarWidth: 260, top: 36 }

    states.run({ type: 'openTab', url: 'https://one.test' })
    host.sync(states.get(), insets)
    host.sync(states.get(), insets)
    expect(mock.views).toHaveLength(1)
    expect(window.children.size).toBe(1)
    expect(mock.views[0]?.bounds).toEqual({ x: 260, y: 36, width: 740, height: 664 })

    states.run({ type: 'openTab', url: 'https://two.test' })
    host.sync(states.get(), insets)
    expect(mock.views).toHaveLength(2)
    expect(window.children).toEqual(new Set([mock.views[1]]))
    expect(mock.views[0]?.webContents.closed).toBe(false)
  })

  it('lays out split panes and destroys only records removed from domain state', () => {
    const states = stateHarness()
    const window = new MockWindow()
    const emitted: BrowserCommand[] = []
    const host = new EngineHost(window as unknown as BrowserWindow, states.get(), (command) => emitted.push(command))
    states.run({ type: 'openTab', url: 'https://one.test' })
    const one = states.get().tabs[0]!
    host.sync(states.get(), { sidebarWidth: 260, top: 36 })
    states.run({ type: 'openTab', url: 'https://two.test' })
    const two = states.get().tabs[1]!
    states.run({ type: 'setSplit', spaceId: states.get().activeSpaceId, tabIds: [one.id, two.id], focused: 1 })
    host.sync(states.get(), { sidebarWidth: 260, top: 36 })
    expect(window.children.size).toBe(2)
    expect(mock.views.map((view) => view.bounds)).toEqual([
      { x: 260, y: 36, width: 370, height: 664 },
      { x: 630, y: 36, width: 370, height: 664 }
    ])
    host.reloadFocused()
    host.reloadFocused(true)
    expect(mock.views[0]?.webContents.reloadCount).toBe(0)
    expect(mock.views[1]?.webContents.reloadCount).toBe(1)
    expect(mock.views[1]?.webContents.hardReloadCount).toBe(1)

    states.run({ type: 'closeTab', tabId: two.id })
    host.sync(states.get(), { sidebarWidth: 260, top: 36 })
    expect(mock.views[1]?.webContents.closed).toBe(true)
    expect(mock.views[0]?.webContents.closed).toBe(false)
    expect(emitted).toEqual([])
  })

  it('flows a will-download mock into download records with throttled progress', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1000)
      const states = stateHarness()
      const window = new MockWindow()
      const emitted: BrowserCommand[] = []
      let sequence = 0
      const host = new EngineHost(window as unknown as BrowserWindow, states.get(), (command) => {
        emitted.push(command)
        states.run(command)
      }, { createId: () => `dl-${++sequence}` })

      states.run({ type: 'openTab', url: 'https://files.test' })
      const tabId = states.get().tabs[0]!.id
      host.sync(states.get(), { sidebarWidth: 260, top: 36 })

      const item = makeDownloadItem('https://files.test/a.zip', 'a.zip', 100)
      const profileSession = mock.sessions.get(`persist:profile-${states.get().profiles[0]!.id}`)
      expect(profileSession).toBeDefined()
      await profileSession!.fire('will-download', {}, item, mock.views[0]!.webContents)

      expect(item.savePath).toBe('/downloads/a.zip')
      expect(emitted).toHaveLength(1)
      expect(states.get().downloads[0]).toMatchObject({
        id: 'dl-1', tabId, url: 'https://files.test/a.zip', filename: 'a.zip',
        savePath: '/downloads/a.zip', state: 'progressing', totalBytes: 100, startedAt: 1000
      })

      vi.setSystemTime(1300)
      await item.fire('updated', {}, 'progressing')
      expect(emitted).toHaveLength(1)

      vi.setSystemTime(1600)
      await item.fire('updated', {}, 'progressing')
      expect(emitted).toHaveLength(2)
      expect(states.get().downloads[0]).toMatchObject({ id: 'dl-1', state: 'progressing' })

      await item.fire('done', {}, 'completed')
      expect(emitted).toHaveLength(3)
      expect(states.get().downloads[0]).toMatchObject({ id: 'dl-1', state: 'done' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('consults remembered permission decisions before emitting a request', () => {
    const states = stateHarness()
    const window = new MockWindow()
    const emitted: BrowserCommand[] = []
    let sequence = 0
    const insets = { sidebarWidth: 260, top: 36 }
    const host = new EngineHost(window as unknown as BrowserWindow, states.get(), (command) => {
      emitted.push(command)
      host.sync(states.run(command), insets)
    }, { createId: () => `perm-${++sequence}` })

    states.run({ type: 'openTab', url: 'https://perms.test' })
    const profileId = states.get().profiles[0]!.id
    host.sync(states.get(), insets)

    const profileSession = mock.sessions.get(`persist:profile-${profileId}`)
    expect(profileSession?.permissionHandler).toBeDefined()
    const handler = profileSession!.permissionHandler!
    const contents = mock.views[0]!.webContents

    const fullscreen: boolean[] = []
    handler(contents, 'fullscreen', (allow) => fullscreen.push(allow))
    expect(fullscreen).toEqual([true])

    const unhandled: boolean[] = []
    handler(contents, 'midi', (allow) => unhandled.push(allow))
    expect(unhandled).toEqual([false])
    expect(window.webContents.sent).toHaveLength(0)

    const decisions: boolean[] = []
    handler(contents, 'notifications', (allow) => decisions.push(allow))
    expect(decisions).toEqual([])
    expect(window.webContents.sent.at(-1)?.channel).toBe('permission:request')
    expect(window.webContents.sent.at(-1)?.payload).toEqual({ type: 'request', id: 'perm-1', origin: 'https://perms.test', permission: 'notifications' })

    host.answerPermission('perm-1', true, true)
    expect(decisions).toEqual([true])
    expect(window.webContents.sent.at(-1)?.payload).toEqual({ type: 'closed', id: 'perm-1' })
    expect(emitted.at(-1)).toEqual({ type: 'rememberPermission', profileId, origin: 'https://perms.test', permission: 'notifications', allow: true })
    expect(states.get().permissions).toEqual([{ profileId, origin: 'https://perms.test', permission: 'notifications', allow: true }])

    const again: boolean[] = []
    handler(contents, 'notifications', (allow) => again.push(allow))
    expect(again).toEqual([true])
    expect(window.webContents.sent.filter((message) => (message.payload as { type: string }).type === 'request')).toHaveLength(1)

    const deniedAgain: boolean[] = []
    handler(contents, 'media', (allow) => deniedAgain.push(allow))
    expect(deniedAgain).toEqual([])
    host.answerPermission('perm-2', false, true)
    expect(deniedAgain).toEqual([false])
    const secondRequest: boolean[] = []
    handler(contents, 'media', (allow) => secondRequest.push(allow))
    expect(secondRequest).toEqual([false])
    expect(window.webContents.sent.filter((message) => (message.payload as { type: string }).type === 'request')).toHaveLength(2)

    host.answerPermission('perm-1', true, false)
    expect(decisions).toEqual([true])
  })

  it('denies unanswered permission requests after 30s or when the requesting tab closes', () => {
    vi.useFakeTimers()
    try {
      const states = stateHarness()
      const window = new MockWindow()
      const host = new EngineHost(window as unknown as BrowserWindow, states.get(), (command) => states.run(command))

      states.run({ type: 'openTab', url: 'https://slow.test' })
      host.sync(states.get(), { sidebarWidth: 260, top: 36 })
      const handler = mock.sessions.get(`persist:profile-${states.get().profiles[0]!.id}`)!.permissionHandler!
      const contents = mock.views[0]!.webContents

      const timedOut: boolean[] = []
      handler(contents, 'geolocation', (allow) => timedOut.push(allow))
      const timeoutId = (window.webContents.sent.at(-1)!.payload as { id: string }).id
      expect(timedOut).toEqual([])

      vi.advanceTimersByTime(30_000)
      expect(timedOut).toEqual([false])
      expect(window.webContents.sent.at(-1)?.payload).toEqual({ type: 'closed', id: timeoutId })

      const tabClosed: boolean[] = []
      handler(contents, 'media', (allow) => tabClosed.push(allow))
      const openId = (window.webContents.sent.at(-1)!.payload as { id: string }).id
      expect(tabClosed).toEqual([])

      states.run({ type: 'closeTab', tabId: states.get().tabs[0]!.id })
      host.sync(states.get(), { sidebarWidth: 260, top: 36 })
      expect(tabClosed).toEqual([false])
      expect(window.webContents.sent.at(-1)?.payload).toEqual({ type: 'closed', id: openId })
    } finally {
      vi.useRealTimers()
    }
  })

  it('builds page context-menu items from params and dispatches their actions', async () => {
    const states = stateHarness()
    const window = new MockWindow()
    const emitted: BrowserCommand[] = []
    const host = new EngineHost(window as unknown as BrowserWindow, states.get(), (command) => {
      emitted.push(command)
      states.run(command)
    })
    const insets = { sidebarWidth: 260, top: 36 }

    states.run({ type: 'openTab', url: 'https://menu.test' })
    host.sync(states.get(), insets)
    const contents = mock.views[0]!.webContents

    await contents.fire('context-menu', {}, { x: 12, y: 34, linkURL: '', editFlags: {} })
    expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1)
    const clickItem = (template: MenuItemConstructorOptions[], label: string) => template.find((item) => item.label === label)?.click?.(undefined as never, undefined as never, undefined as never)
    const labeled = (template: MenuItemConstructorOptions[]) => template.filter((item) => item.label).map((item) => [item.label, item.enabled])
    const templateAt = (index: number) => vi.mocked(Menu.buildFromTemplate).mock.calls[index]![0] as MenuItemConstructorOptions[]

    const plain = templateAt(0)
    expect(labeled(plain)).toEqual([
      ['Back', false], ['Forward', false], ['Reload', undefined],
      ['Cut', false], ['Copy', false], ['Paste', false],
      ['Inspect Element', undefined]
    ])
    clickItem(plain, 'Back')
    clickItem(plain, 'Reload')
    clickItem(plain, 'Inspect Element')
    expect(contents.goBackCount).toBe(1)
    expect(contents.reloadCount).toBe(1)
    expect(contents.inspectCalls).toEqual([[12, 34]])
    expect(vi.mocked(Menu.buildFromTemplate).mock.results[0]!.value.popup).toHaveBeenCalledWith({ window })

    contents.canGoBack = true
    await contents.fire('context-menu', {}, { x: 5, y: 6, linkURL: 'https://linked.test/a', editFlags: { canCut: true, canCopy: true, canPaste: true } })
    const linked = templateAt(1)
    expect(labeled(linked)).toEqual([
      ['Back', true], ['Forward', false], ['Reload', undefined],
      ['Cut', true], ['Copy', true], ['Paste', true],
      ['Copy Link Address', undefined], ['Open Link in New Tab', undefined],
      ['Inspect Element', undefined]
    ])

    clickItem(linked, 'Open Link in New Tab')
    const spaceId = states.get().spaces[0]!.id
    expect(emitted.at(-1)).toEqual({ type: 'openTab', url: 'https://linked.test/a', spaceId })
    expect(states.get().tabs.at(-1)).toMatchObject({ url: 'https://linked.test/a', spaceId })
    clickItem(linked, 'Copy Link Address')
    expect(vi.mocked(clipboard.writeText)).toHaveBeenCalledWith('https://linked.test/a')
  })

  it('realizes arc://extensions as an isolated internal surface with a frozen domain record', async () => {
    const states = stateHarness()
    const window = new MockWindow()
    const emitted: BrowserCommand[] = []
    const host = new EngineHost(window as unknown as BrowserWindow, states.get(), (command) => {
      emitted.push(command)
      states.run(command)
    }, { internalPageUrl: (surface) => `https://renderer.test/?surface=${surface}` })
    const insets = { sidebarWidth: 260, top: 36 }

    states.run({ type: 'openTab', url: 'arc://extensions' })
    host.sync(states.get(), insets)
    const tabId = states.get().tabs[0]!.id
    const view = mock.views[0]!

    expect(view.webContents.currentUrl).toBe('https://renderer.test/?surface=extensions')
    expect(view.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true })
    expect(String((view.options.webPreferences as { preload?: string }).preload)).toMatch(/preload[/\\]index\.cjs$/)
    expect(mock.sessions.size).toBe(0)
    expect(emitted).toContainEqual({ type: 'tabEvent', tabId, event: { title: 'Extensions' } })

    await view.webContents.fire('did-navigate', {}, 'https://renderer.test/?surface=extensions')
    expect(emitted.filter((command) => command.type === 'tabEvent')).toHaveLength(1)
    expect(states.get().tabs[0]).toMatchObject({ url: 'arc://extensions', title: 'Extensions' })

    const navigation = { preventDefault: vi.fn(), url: 'https://escape.test' }
    await view.webContents.fire('will-navigate', navigation)
    expect(navigation.preventDefault).toHaveBeenCalled()
    expect(view.webContents.windowOpenHandler?.({ url: 'https://popup.test' })).toEqual({ action: 'deny' })

    host.sync(states.get(), insets)
    host.sync(states.get(), insets)
    expect(mock.views).toHaveLength(1)
    expect(view.webContents.reloadCount).toBe(0)
    expect(view.webContents.currentUrl).toBe('https://renderer.test/?surface=extensions')

    states.run({ type: 'closeTab', tabId })
    host.sync(states.get(), insets)
    expect(view.webContents.closed).toBe(true)
  })

  it('never hands internal views to the extension bridge (session mismatch throws there)', () => {
    const states = stateHarness()
    const window = new MockWindow()
    const host = new EngineHost(window as unknown as BrowserWindow, states.get(), (command) => states.run(command), {
      internalPageUrl: (surface) => `https://renderer.test/?surface=${surface}`
    })
    const insets = { sidebarWidth: 260, top: 36 }

    states.run({ type: 'openTab', url: 'https://normal.test' })
    host.sync(states.get(), insets)
    const bridge = extensionInstances()[0]!
    const normalContents = mock.views[0]!.webContents

    states.run({ type: 'openTab', url: 'arc://extensions' })
    host.sync(states.get(), insets)
    const internalContents = mock.views[1]!.webContents

    expect(bridge.added.map((entry) => entry.tab)).toEqual([normalContents])
    expect(bridge.selected).not.toContain(internalContents)
    expect(bridge.removed).not.toContain(internalContents)
  })

  it('routes find-in-page to the focused pane only', async () => {
    const states = stateHarness()
    const window = new MockWindow()
    const host = new EngineHost(window as unknown as BrowserWindow, states.get(), (command) => states.run(command))
    const insets = { sidebarWidth: 260, top: 36 }

    states.run({ type: 'openTab', url: 'https://one.test' })
    const one = states.get().tabs[0]!
    states.run({ type: 'openTab', url: 'https://two.test' })
    const two = states.get().tabs[1]!
    states.run({ type: 'setSplit', spaceId: states.get().activeSpaceId, tabIds: [one.id, two.id], focused: 1 })
    host.sync(states.get(), insets)
    expect(mock.views).toHaveLength(2)
    const unfocused = mock.views[0]!.webContents
    const focused = mock.views[1]!.webContents

    host.findInPage('hello', { forward: true, findNext: true })
    expect(focused.findCalls).toEqual([{ text: 'hello', options: { forward: true, findNext: true } }])
    expect(unfocused.findCalls).toHaveLength(0)

    host.toggleFindBar()
    expect(window.webContents.sent.at(-1)).toEqual({ channel: 'find:event', payload: { type: 'toggle' } })

    await focused.fire('found-in-page', {}, { requestId: 1, finalUpdate: true, activeMatchOrdinal: 2, matches: 7 })
    expect(window.webContents.sent.at(-1)).toEqual({ channel: 'find:event', payload: { type: 'matches', activeMatchOrdinal: 2, matches: 7 } })

    await unfocused.fire('found-in-page', {}, { requestId: 2, finalUpdate: true, activeMatchOrdinal: 1, matches: 3 })
    expect(window.webContents.sent.at(-1)?.payload).toEqual({ type: 'matches', activeMatchOrdinal: 2, matches: 7 })

    host.closeFind()
    expect(focused.stopFindCalls).toEqual(['clearSelection'])
    expect(focused.focusCount).toBe(1)
    expect(unfocused.stopFindCalls).toEqual([])

    host.findInPage('   ')
    expect(focused.stopFindCalls).toEqual(['clearSelection', 'clearSelection'])
  })
})

describe('EngineHost extension-bridge wiring', () => {
  const profiles = [
    { id: 'pa', name: 'A', color: '#111111' },
    { id: 'pb', name: 'B', color: '#222222' }
  ]
  const spaces = [
    { id: 'sa', profileId: 'pa', name: 'A Space', color: '#111111', split: null },
    { id: 'sb', profileId: 'pb', name: 'B Space', color: '#222222', split: null }
  ]
  const makeTab = (id: string, spaceId: string): Tab => ({
    id, spaceId, url: `https://${id}.test`, title: id, faviconUrl: '', pinned: false, muted: false,
    lastActiveAt: 1, nav: { entries: [], index: -1 }
  })

  function twoProfileState(): AppState {
    return {
      profiles,
      spaces,
      tabs: [makeTab('a1', 'sa'), makeTab('b1', 'sb')],
      downloads: [],
      permissions: [],
      activeSpaceId: 'sb',
      activeTabId: { sa: 'a1', sb: 'b1' }
    }
  }

  it('registers views per profile bridge, reports scoped active tabs, and unregisters on destroy', () => {
    const states = stateHarness()
    const window = new MockWindow()
    const host = new EngineHost(window as unknown as BrowserWindow, twoProfileState(), () => {})
    const insets = { sidebarWidth: 260, top: 36 }

    host.sync(twoProfileState(), insets)
    expect(extensionInstances()).toHaveLength(1)
    expect(extensionInstances()[0]?.added.map((entry) => entry.tab)).toEqual([mock.views[0]?.webContents])
    expect(extensionInstances()[0]?.selected).toEqual([mock.views[0]?.webContents])

    host.sync({ ...twoProfileState(), activeSpaceId: 'sa', activeTabId: { ...twoProfileState().activeTabId, sb: null } }, insets)
    expect(mock.views).toHaveLength(2)
    expect(extensionInstances()).toHaveLength(2)
    const bridgeB = extensionInstances()[0]!
    const bridgeA = extensionInstances()[1]!
    expect(bridgeA.added.map((entry) => entry.tab)).toEqual([mock.views[1]?.webContents])
    expect(bridgeA.selected).toEqual([mock.views[1]?.webContents])
    expect(bridgeB.selected).toEqual([mock.views[0]?.webContents])

    states.run({ type: 'closeTab', tabId: 'a1' })
    host.sync(states.get(), insets)
    expect(bridgeA.removed).toEqual([mock.views[1]?.webContents])
    expect(mock.views[1]?.webContents.closed).toBe(true)
    expect(webStore.installs).toEqual(expect.arrayContaining([
      expect.objectContaining({ extensionsPath: '/mock-userData/extensions/pa', allowUnpackedExtensions: true }),
      expect.objectContaining({ extensionsPath: '/mock-userData/extensions/pb', allowUnpackedExtensions: true })
    ]))
  })

  it('round-trips the active profile extension list and enable/disable/uninstall operations', async () => {
    const window = new MockWindow()
    const host = new EngineHost(window as unknown as BrowserWindow, twoProfileState(), () => {})
    host.sync(twoProfileState(), { sidebarWidth: 260, top: 36 })
    const profileSession = mock.sessions.get('persist:profile-pb')!
    profileSession.extensions.set('dark-reader', {
      id: 'dark-reader', name: 'Dark Reader', version: '4.9.0', path: '/extensions/dark-reader/4.9.0',
      url: 'chrome-extension://dark-reader/', manifest: { icons: { '128': 'icon.png' } }
    })

    await expect(host.handleExtensionsQuery({ type: 'list' })).resolves.toEqual({
      type: 'list', profileId: 'pb',
      extensions: [{ id: 'dark-reader', name: 'Dark Reader', version: '4.9.0', icon: 'data:image/mock;base64,/extensions/dark-reader/4.9.0/icon.png', enabled: true }]
    })

    const disabled = await host.handleExtensionsQuery({ type: 'setEnabled', id: 'dark-reader', enabled: false })
    expect(disabled.extensions[0]).toMatchObject({ id: 'dark-reader', enabled: false })
    expect(profileSession.getExtension('dark-reader')).toBeNull()

    const enabled = await host.handleExtensionsQuery({ type: 'setEnabled', id: 'dark-reader', enabled: true })
    expect(enabled.extensions[0]).toMatchObject({ id: 'dark-reader', enabled: true })
    expect(profileSession.loadedPaths).toEqual(['/extensions/dark-reader/4.9.0'])

    const uninstalled = await host.handleExtensionsQuery({ type: 'uninstall', id: 'dark-reader' })
    expect(uninstalled.extensions).toEqual([])
    expect(webStore.uninstalls).toHaveLength(1)
    expect(webStore.uninstalls[0]).toMatchObject({ id: 'dark-reader' })
  })

  it('routes extension createTab through BrowserState into the profile\'s active space and resolves the engine view', async () => {
    const window = new MockWindow()
    const insets = { sidebarWidth: 260, top: 36 }
    const dependencies: TransitionDependencies = { createId: (() => { let n = 0; return () => `ext-${++n}` })(), now: () => 1000 }
    let state = twoProfileState()
    const host = new EngineHost(window as unknown as BrowserWindow, state, (command) => {
      state = transition(state, command, dependencies)
      host.sync(state, insets)
    })
    host.sync(state, insets)

    const [contents] = await extensionInstances()[0]!.options.createTab!({ url: 'https://extension.test/page' })
    const created = state.tabs.find((tab) => tab.url === 'https://extension.test/page')
    expect(created?.spaceId).toBe('sb')
    expect(contents).toBe(mock.views.at(-1)?.webContents)

    const before = state.tabs.length
    await extensionInstances()[0]!.options.removeTab!(contents)
    expect(state.tabs).toHaveLength(before - 1)
  })
})
