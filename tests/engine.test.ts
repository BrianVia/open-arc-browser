import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, Rectangle } from 'electron'
import type { AppState, BrowserCommand } from '../src/shared'
import { createDefaultState, transition, type TransitionDependencies } from '../src/main/state/transitions'

interface MockViewRecord {
  webContents: { closed: boolean; currentUrl: string; reloadCount: number; hardReloadCount: number }
  bounds: Rectangle | undefined
}

const mock = vi.hoisted(() => ({ views: [] as MockViewRecord[], nextContentsId: 0 }))

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
    BrowserWindow: class {},
    WebContentsView: MockWebContentsView,
    session: { fromPartition: (partition: string) => ({ partition }) }
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
})

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
})
