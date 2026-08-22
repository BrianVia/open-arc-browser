import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chromeGroupColor,
  createWindowState,
  mostRecentTabId,
  parsePersisted,
  SpaceStore,
  STORAGE_KEY,
  transition,
  type ChromeStorageArea,
  type Space,
  type SpaceEvent,
  type TransitionDependencies,
  type WindowState
} from '../src/state'

function mockStorage(): ChromeStorageArea & { dump(): Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  return {
    get: vi.fn(async () => structuredClone(data)),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items))
    }),
    dump: () => data
  }
}

function idFactory(): TransitionDependencies['createId'] {
  let n = 0
  return () => `id${++n}`
}

describe('pure space transitions', () => {
  const dependencies = { createId: idFactory() }
  const apply = (state: WindowState | undefined, event: SpaceEvent): WindowState =>
    transition(state, event, dependencies)
  const active = (state: WindowState): Space =>
    state.spaces.find((space) => space.id === state.activeSpaceId)!

  it('creates a default Home space for an unknown window', () => {
    const state = createWindowState(dependencies)
    expect(active(state).name).toBe('Home')
    expect(state.spaces).toHaveLength(1)
  })

  it('adds new tabs to the active space', () => {
    let state = apply(undefined, { type: 'tabCreated', tabId: 1 })
    state = apply(state, { type: 'tabCreated', tabId: 2 })
    expect(active(state).tabIds).toEqual([1, 2])
  })

  it('removes closed tabs from whichever space held them', () => {
    let state = apply(undefined, { type: 'tabCreated', tabId: 1 })
    state = apply(state, { type: 'spaceCreated', name: 'Work', color: '#ee7c94' })
    state = apply(state, { type: 'tabCreated', tabId: 2 })
    state = apply(state, { type: 'tabRemoved', tabId: 2 })
    expect(active(state).tabIds).toEqual([])
    const home = state.spaces.find((space) => space.name === 'Home')!
    expect(home.tabIds).toEqual([1])
  })

  it('ignores duplicate membership and unknown removals', () => {
    let state = apply(undefined, { type: 'windowSeeded', tabIds: [5], pinnedTabIds: [] })
    const before = structuredClone(state)
    state = apply(state, { type: 'tabCreated', tabId: 5 })
    state = apply(state, { type: 'tabRemoved', tabId: 999 })
    expect(state).toEqual(before)
  })

  it('tracks recency on activation and switches spaces to the most recent tab', () => {
    let state = apply(undefined, { type: 'windowSeeded', tabIds: [1, 2, 3], pinnedTabIds: [] })
    const homeId = state.activeSpaceId
    state = apply(state, { type: 'tabActivated', tabId: 1 })
    expect(active(state).tabIds).toEqual([2, 3, 1])
    expect(mostRecentTabId(active(state))).toBe(1)

    state = apply(state, { type: 'spaceCreated', name: 'Work', color: '#58a6a6' })
    expect(mostRecentTabId(active(state))).toBeUndefined()

    state = apply(state, { type: 'spaceFocused', spaceId: homeId })
    expect(state.activeSpaceId).toBe(homeId)
    expect(mostRecentTabId(active(state))).toBe(1)
    expect(apply(state, { type: 'spaceFocused', spaceId: 'nope' })).toEqual(state)
  })

  it('toggles pins between the regular and pinned lists', () => {
    let state = apply(undefined, { type: 'windowSeeded', tabIds: [1, 2], pinnedTabIds: [] })
    state = apply(state, { type: 'pinToggled', tabId: 1, pinned: true })
    expect(active(state).pinnedTabIds).toEqual([1])
    expect(active(state).tabIds).toEqual([2])

    // Most-recent falls back to pinned when a space has only pinned tabs.
    state = apply(state, { type: 'pinToggled', tabId: 2, pinned: true })
    expect(mostRecentTabId(active(state))).toBe(2)

    state = apply(state, { type: 'pinToggled', tabId: 1, pinned: false })
    expect(active(state).tabIds).toEqual([1])
    expect(active(state).pinnedTabIds).toEqual([2])
  })

  it('maps palette colors onto chrome group colors', () => {
    expect(chromeGroupColor('#8b7cf6')).toBe('purple')
    expect(chromeGroupColor('#e0a85a')).toBe('yellow')
    expect(chromeGroupColor('#123abc')).toBe('grey')
  })
})

describe('SpaceStore', () => {
  let storage: ReturnType<typeof mockStorage>

  beforeEach(() => {
    storage = mockStorage()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeStore(): SpaceStore {
    return new SpaceStore({ storage, createId: idFactory() })
  }

  it('debounces persistence at 500ms across bursts', async () => {
    const store = makeStore()
    await store.hydrate()
    store.dispatch(1, { type: 'tabCreated', tabId: 1 })
    store.dispatch(1, { type: 'tabCreated', tabId: 2 })
    store.dispatch(1, { type: 'tabCreated', tabId: 3 })

    await vi.advanceTimersByTimeAsync(499)
    expect(storage.set).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(storage.set).toHaveBeenCalledTimes(1)
    const windows = parsePersisted(storage.dump()[STORAGE_KEY])
    expect(windows['1']!.spaces[0]!.tabIds).toEqual([1, 2, 3])
  })

  it('keeps windows isolated from each other', async () => {
    const store = makeStore()
    await store.hydrate()
    store.dispatch(1, { type: 'tabCreated', tabId: 1 })
    store.dispatch(2, { type: 'tabCreated', tabId: 9 })
    await store.flush()

    const windows = parsePersisted(storage.dump()[STORAGE_KEY])
    expect(windows['1']!.spaces[0]!.tabIds).toEqual([1])
    expect(windows['2']!.spaces[0]!.tabIds).toEqual([9])
  })

  it('round-trips through mocked chrome.storage.local', async () => {
    const store = makeStore()
    await store.hydrate()
    store.dispatch(42, { type: 'tabCreated', tabId: 7 })
    store.dispatch(42, { type: 'spaceCreated', name: 'Docs', color: '#769bd8' })
    await store.flush()

    const revived = makeStore()
    await revived.hydrate()
    expect(revived.snapshot(42)).toEqual(store.snapshot(42))
    expect(revived.snapshot(42).spaces.map((space) => space.name)).toEqual(['Home', 'Docs'])
    expect(revived.snapshot(42).activeSpaceId).toBe(revived.snapshot(42).spaces[1]!.id)
  })

  it('drops forgotten windows from storage', async () => {
    const store = makeStore()
    await store.hydrate()
    store.dispatch(1, { type: 'tabCreated', tabId: 1 })
    await store.flush()
    expect(Object.keys(parsePersisted(storage.dump()[STORAGE_KEY]))).toContain('1')

    store.forget(1)
    await store.flush()
    expect(parsePersisted(storage.dump()[STORAGE_KEY])['1']).toBeUndefined()
  })
})
