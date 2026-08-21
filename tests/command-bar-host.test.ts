import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

interface MockPaletteContents {
  handlers: Map<string, Array<(...args: unknown[]) => void>>
  sent: Array<{ channel: string; payload: unknown }>
  focusCount: number
  closed: boolean
  loadedUrls: string[]
  loadedFiles: Array<{ path: string; query?: Record<string, string> }>
  on(event: string, handler: (...args: unknown[]) => void): unknown
  fire(event: string, ...args: unknown[]): Promise<void>
}

const mock = vi.hoisted(() => ({ views: [] as Array<{
  webContents: {
    handlers: Map<string, Array<(...args: unknown[]) => void>>
    sent: Array<{ channel: string; payload: unknown }>
    focusCount: number
    closed: boolean
    loadedUrls: string[]
    loadedFiles: Array<{ path: string; query?: Record<string, string> }>
    on(event: string, handler: (...args: unknown[]) => void): unknown
    fire(event: string, ...args: unknown[]): Promise<void>
  }
  bounds: unknown
  backgroundColors: string[]
  setBackgroundColor(color: string): void
  setBounds(bounds: unknown): void
}> }))

vi.mock('electron', () => {
  class MockWebContents {
    readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    readonly sent: Array<{ channel: string; payload: unknown }> = []
    focusCount = 0
    closed = false
    readonly loadedUrls: string[] = []
    readonly loadedFiles: Array<{ path: string; query?: Record<string, string> }> = []
    on(event: string, handler: (...args: unknown[]) => void): this {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
      return this
    }
    async fire(event: string, ...args: unknown[]): Promise<void> {
      for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args)
    }
    send(channel: string, payload: unknown): void { this.sent.push({ channel, payload }) }
    focus(): void { this.focusCount += 1 }
    async loadURL(url: string): Promise<void> { this.loadedUrls.push(url) }
    async loadFile(path: string, options?: { query?: Record<string, string> }): Promise<void> {
      if (options?.query !== undefined) this.loadedFiles.push({ path, query: options.query })
      else this.loadedFiles.push({ path })
    }
    isDestroyed(): boolean { return this.closed }
    close(): void { this.closed = true }
  }
  class MockWebContentsView {
    readonly webContents = new MockWebContents()
    bounds: unknown
    readonly backgroundColors: string[] = []
    setBackgroundColor(color: string): void { this.backgroundColors.push(color) }
    setBounds(bounds: unknown): void { this.bounds = bounds }
    constructor() { mock.views.push(this as unknown as (typeof mock.views)[number]) }
  }
  return { WebContentsView: MockWebContentsView }
})

import { CommandBarHost } from '../src/main/command-bar'

class MockParentWindow {
  readonly children: unknown[] = []
  resizeListeners: Array<(...args: unknown[]) => void> = []
  readonly contentView = {
    addChildView: (view: unknown) => this.children.push(view),
    removeChildView: (view: unknown) => {
      const index = this.children.indexOf(view)
      if (index >= 0) this.children.splice(index, 1)
    }
  }
  on(event: string, handler: (...args: unknown[]) => void): void {
    if (event === 'resize') this.resizeListeners.push(handler)
  }
  getContentSize(): [number, number] { return [1000, 700] }
  isDestroyed(): boolean { return false }
}

function harness(): { host: CommandBarHost; parent: MockParentWindow; view: typeof mock.views[number]; contents: MockPaletteContents } {
  const parent = new MockParentWindow()
  const host = new CommandBarHost(parent as unknown as BrowserWindow)
  const view = mock.views.at(-1)!
  return { host, parent, view, contents: view.webContents as unknown as MockPaletteContents }
}

beforeEach(() => {
  mock.views.length = 0
})

async function revealedHost(): Promise<ReturnType<typeof harness>> {
  const context = harness()
  await context.host.load(undefined)
  await context.contents.fire('did-finish-load')
  return context
}

describe('CommandBarHost palette view', () => {
  it('loads the commandbar surface with a transparent background', async () => {
    const { host, view } = harness()
    await host.load(undefined)
    expect(view.backgroundColors).toEqual(['#00000000'])
    expect(view.webContents.loadedFiles[0]?.query).toEqual({ surface: 'commandbar' })
    await host.load('http://localhost:5173/index.html')
    expect(view.webContents.loadedUrls[0]).toBe('http://localhost:5173/index.html?surface=commandbar')
  })

  it('reveals above page views with centered bounds and focuses the palette', async () => {
    const { host, parent, view, contents } = await revealedHost()
    parent.contentView.addChildView({})
    host.toggle('new-tab')
    expect(parent.children.at(-1)).toBe(host.view)
    expect(view.bounds).toEqual({ x: 220, y: 126, width: 560, height: 430 })
    expect(contents.focusCount).toBe(1)
    expect(contents.sent).toEqual([{ channel: 'commandbar:event', payload: { type: 'show', intent: 'new-tab' } }])
  })

  it('defers reveal until the surface finishes loading', async () => {
    const { host, parent, contents } = harness()
    host.toggle('edit-current-url')
    expect(parent.children).toHaveLength(0)
    expect(contents.sent).toHaveLength(0)
    await host.load(undefined)
    await contents.fire('did-finish-load')
    expect(parent.children).toContain(host.view)
    expect(contents.sent).toEqual([{ channel: 'commandbar:event', payload: { type: 'show', intent: 'edit-current-url' } }])
  })

  it('re-raises above views added after reveal and stays detached when hidden', async () => {
    const { host, parent } = await revealedHost()
    host.toggle('new-tab')
    parent.contentView.addChildView({})
    host.raise()
    expect(parent.children.at(-1)).toBe(host.view)

    host.hide()
    expect(parent.children).not.toContain(host.view)
    host.raise()
    expect(parent.children).not.toContain(host.view)
  })

  it('hides on blur or repeated toggle and clamps bounds to small windows', async () => {
    const { host, parent, view, contents } = await revealedHost()

    host.toggle('new-tab')
    await contents.fire('blur')
    expect(parent.children).not.toContain(host.view)

    host.toggle('new-tab')
    expect(parent.children).toContain(host.view)
    host.toggle('new-tab')
    expect(parent.children).not.toContain(host.view)

    parent.getContentSize = () => [500, 400]
    for (const listener of parent.resizeListeners) listener()
    host.toggle('new-tab')
    expect(view.bounds).toEqual({ x: 0, y: 72, width: 500, height: 400 })
  })

  it('destroys the palette webContents and detaches it from the window', async () => {
    const { host, parent, view, contents } = await revealedHost()
    host.toggle('new-tab')
    host.destroy()
    expect(contents.closed).toBe(true)
    expect(parent.children).not.toContain(view)
  })
})
