import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, Rectangle } from 'electron'
import type { AppState, BrowserCommand } from '../src/shared'
import { createDefaultState, transition, type TransitionDependencies } from '../src/main/state/transitions'

interface MockViewRecord {
  webContents: { closed: boolean; currentUrl: string; reloadCount: number; hardReloadCount: number }
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

const mock = vi.hoisted(() => ({
  views: [] as MockViewRecord[],
  nextContentsId: 0,
  sessions: new Map<string, {
    on(event: string, handler: (...args: unknown[]) => void): void
    fire(event: string, ...args: unknown[]): Promise<void>
    handlers: Map<string, Array<(...args: unknown[]) => void>>
  }>()
}))

vi.mock('electron', () => {
  class MockWebContents {
    readonly id = ++mock.nextContentsId
    readonly navigationHistory = {
      restore: async ({ entries, index }: { entries: Array<{ url: string }>; index?: number }) => {
        this.currentUrl = entries[index ?? entries.length - 1]?.url ?? ''
      }
    }
    closed = false
    currentUrl = ''
    reloadCount = 0
    hardReloadCount = 0
    on(): this { return this }
    setWindowOpenHandler(): void {}
    getURL(): string { return this.currentUrl }
    async loadURL(url: string): Promise<void> { this.currentUrl = url }
    isDestroyed(): boolean { return this.closed }
    close(): void { this.closed = true }
    reload(): void { this.reloadCount += 1 }
    reloadIgnoringCache(): void { this.hardReloadCount += 1 }
  }
  class MockWebContentsView {
    readonly webContents = new MockWebContents()
    bounds: Rectangle | undefined
    constructor() { mock.views.push(this) }
    setBounds(bounds: Rectangle): void { this.bounds = bounds }
  }
  return {
    app: { getPath: (name: string) => (name === 'downloads' ? '/downloads' : `/mock-${name}`) },
    BrowserWindow: class {},
    WebContentsView: MockWebContentsView,
    session: {
      fromPartition: (partition: string) => {
        let existing = mock.sessions.get(partition)
        if (!existing) {
          const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
          existing = {
            handlers,
            on(event: string, handler: (...args: unknown[]) => void): void {
              handlers.set(event, [...(handlers.get(event) ?? []), handler])
            },
            async fire(event: string, ...args: unknown[]): Promise<void> {
              for (const handler of handlers.get(event) ?? []) handler(...args)
            }
          }
          mock.sessions.set(partition, existing)
        }
        return existing
      }
    }
  }
})

import { EngineHost } from '../src/main/engine/host'

class MockWindow {
  readonly children = new Set<MockViewRecord>()
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
})
