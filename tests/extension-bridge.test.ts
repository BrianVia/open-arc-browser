import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { AppState, BrowserCommand, Profile, Space, Tab } from '../src/shared'
import { transition, type TransitionDependencies } from '../src/main/state/transitions'
import { activeTabIdOfProfile, ExtensionBridge, loadUnpackedExtensions } from '../src/main/engine/extension-bridge'

interface MockExtensionInstance {
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
const instances = (): MockExtensionInstance[] => crx.instances as MockExtensionInstance[]

vi.mock('electron-chrome-extensions', () => ({
  ElectronChromeExtensions: class {
    options: MockExtensionInstance['options']
    added: MockExtensionInstance['added'] = []
    removed: unknown[] = []
    selected: unknown[] = []
    constructor(options: MockExtensionInstance['options']) {
      this.options = options
      crx.instances.push(this)
    }
    addTab(tab: unknown, window: unknown): void {
      this.added.push({ tab, window })
    }
    removeTab(tab: unknown): void {
      this.removed.push(tab)
    }
    selectTab(tab: unknown): void {
      this.selected.push(tab)
    }
  }
}))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => `/mock-${name}` },
  BrowserWindow: class {}
}))

function makeContents(): WebContents {
  return { id: Math.floor(Math.random() * 1e9) } as unknown as WebContents
}

const profileA: Profile = { id: 'pa', name: 'A', color: '#111111' }
const profileB: Profile = { id: 'pb', name: 'B', color: '#222222' }
const spaceA: Space = { id: 'sa', profileId: 'pa', name: 'A Space', color: '#111111', split: null }
const spaceB: Space = { id: 'sb', profileId: 'pb', name: 'B Space', color: '#222222', split: null }

function tab(id: string, spaceId: string, lastActiveAt = 1): Tab {
  return { id, spaceId, url: `https://${id}.test`, title: id, faviconUrl: '', pinned: false, muted: false, lastActiveAt, nav: { entries: [], index: -1 } }
}

/** State where profile B owns the globally active space. */
function twoProfileState(): AppState {
  return {
    profiles: [profileA, profileB],
    spaces: [spaceA, spaceB],
    tabs: [tab('a1', 'sa'), tab('b1', 'sb')],
    downloads: [],
    permissions: [],
    activeSpaceId: 'sb',
    activeTabId: { sa: 'a1', sb: 'b1' }
  }
}

function makeBridge(profileId: string, initial: AppState) {
  let sequence = 0
  const dependencies: TransitionDependencies = { createId: () => `new-${++sequence}`, now: () => 1000 }
  let state = initial
  const emitted: BrowserCommand[] = []
  const viewsByTab = new Map<string, WebContents>()
  const bridge = new ExtensionBridge({} as never, {
    profileId,
    window: {} as never,
    emit: (command) => {
      emitted.push(command)
      const next = transition(state, command, dependencies)
      if (next === state) return
      state = next
      for (const item of next.tabs) if (!viewsByTab.has(item.id)) viewsByTab.set(item.id, makeContents())
    },
    getState: () => state,
    viewForTab: (tabId) => viewsByTab.get(tabId),
    tabIdFor: (contents) => [...viewsByTab.entries()].find((entry) => entry[1] === contents)?.[0]
  })
  return {
    bridge,
    emitted,
    contentsFor: (tabId: string) => viewsByTab.get(tabId),
    registerView: (tabId: string, contents: WebContents) => viewsByTab.set(tabId, contents),
    snapshot: (): AppState => state
  }
}

beforeEach(() => {
  crx.instances.length = 0
})

describe('ExtensionBridge', () => {
  it('constructs one library instance bound to the given session and license', () => {
    makeBridge('pa', twoProfileState())
    expect(instances()).toHaveLength(1)
    expect(instances()[0]?.options.license).toBe('GPL-3.0')
  })

  it('routes createTab into the owning profile\'s active space and resolves the new view', async () => {
    const harness = makeBridge('pa', twoProfileState())
    const [contents, window] = await instances()[0]!.options.createTab!({ url: 'https://extension.test/page' })

    expect(harness.emitted[0]).toEqual({ type: 'openTab', url: 'https://extension.test/page', spaceId: 'sa' })
    const created = harness.snapshot().tabs.find((item) => item.url === 'https://extension.test/page')
    expect(created?.spaceId).toBe('sa')
    expect(harness.snapshot().activeTabId.sa).toBe(created!.id)
    expect(contents).toBe(harness.contentsFor(created!.id))
    expect(window).toBeDefined()
    expect(harness.snapshot().tabs.filter((item) => item.spaceId === 'sb')).toHaveLength(1)
  })

  it('falls back to the profile\'s most recently touched space when another profile is frontmost', async () => {
    const state = { ...twoProfileState(), tabs: [tab('a1', 'sa', 5), tab('a2', 'sa', 9), tab('b1', 'sb', 7)] }
    const harness = makeBridge('pa', state)
    await instances()[0]!.options.createTab!({ url: 'https://fallback.test' })
    expect(harness.emitted[0]).toMatchObject({ type: 'openTab', spaceId: 'sa' })
  })

  it('maps selectTab and removeTab callbacks onto setActiveTab/closeTab and ignores foreign contents', () => {
    const harness = makeBridge('pb', twoProfileState())
    harness.registerView('b1', makeContents())
    const options = instances()[0]!.options

    options.selectTab!(harness.contentsFor('b1'))
    expect(harness.emitted.at(-1)).toEqual({ type: 'setActiveTab', tabId: 'b1' })

    options.removeTab!(harness.contentsFor('b1'))
    expect(harness.emitted.at(-1)).toEqual({ type: 'closeTab', tabId: 'b1' })

    options.selectTab!(makeContents())
    options.removeTab!(makeContents())
    expect(harness.emitted).toHaveLength(2)
  })

  it('reports only the owning profile\'s active tab on sync', () => {
    const bridgeA = makeBridge('pa', twoProfileState())
    const bridgeB = makeBridge('pb', twoProfileState())
    const contentsA = makeContents()
    const contentsB = makeContents()
    bridgeA.registerView('a1', contentsA)
    bridgeB.registerView('b1', contentsB)

    bridgeA.bridge.syncActiveTab(twoProfileState())
    expect(instances()[0]!.selected).toEqual([contentsA])

    bridgeB.bridge.syncActiveTab(twoProfileState())
    expect(instances()[1]!.selected).toEqual([contentsB])
    expect(instances()[1]!.selected).not.toContain(contentsA)
  })

  it('skips the active-tab report when the profile has no resolvable active view', () => {
    const state = twoProfileState()
    const harness = makeBridge('pa', state)
    harness.bridge.syncActiveTab({ ...state, tabs: [] })
    expect(instances()[0]!.selected).toEqual([])
  })

  it('derives the scoped active tab id through the shared helper', () => {
    expect(activeTabIdOfProfile(twoProfileState(), 'pa')).toBe('a1')
    expect(activeTabIdOfProfile(twoProfileState(), 'pb')).toBe('b1')
    expect(activeTabIdOfProfile(twoProfileState(), 'missing')).toBeUndefined()
  })
})

describe('loadUnpackedExtensions', () => {
  it('loads each subdirectory unpacked, skips plain files, and contains per-directory failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-arc-ext-'))
    await mkdir(join(root, 'alpha'))
    await mkdir(join(root, 'beta'))
    await mkdir(join(root, 'gamma'))
    await writeFile(join(root, 'notes.txt'), 'not an extension')

    const loaded: string[] = []
    const session = {
      loadExtension: async (path: string) => {
        if (path.includes('beta')) throw new Error('bad manifest')
        loaded.push(path)
      }
    }

    await loadUnpackedExtensions(session as never, root)

    expect(loaded.map((path) => path.split('/').at(-1))).toEqual(['alpha', 'gamma'])
  })

  it('resolves silently when the extensions directory does not exist', async () => {
    const session = { loadExtension: async () => {} }
    await expect(loadUnpackedExtensions(session as never, '/nonexistent/extensions')).resolves.toBeUndefined()
  })
})
