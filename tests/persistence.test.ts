import { afterEach, describe, expect, it, vi } from 'vitest'
import { appStateSchema, persistedStateSchema, type PersistedState } from '../src/shared'
import { atomicWriteJson, BrowserState, loadState, newDefaultState, type FileOperations } from '../src/main/state/store'

function memoryFiles(initial?: PersistedState): FileOperations & { writes: Array<{ path: string; data: string }>; renames: Array<{ from: string; to: string }> } {
  const values = new Map<string, string>()
  if (initial) values.set('/data/state.json', JSON.stringify(initial))
  const writes: Array<{ path: string; data: string }> = []
  const renames: Array<{ from: string; to: string }> = []
  return {
    writes,
    renames,
    async mkdir() {},
    async readFile(path) {
      const value = values.get(path)
      if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return value
    },
    async writeFile(path, data) { writes.push({ path, data }); values.set(path, data) },
    async rename(from, to) {
      renames.push({ from, to })
      const value = values.get(from)
      if (value === undefined) throw new Error('temporary file missing')
      values.set(to, value)
      values.delete(from)
    }
  }
}

afterEach(() => vi.useRealTimers())

describe('BrowserState persistence', () => {
  it('round-trips a versioned state identically', async () => {
    const state = newDefaultState(() => 'fixed-id', () => 1)
    const stored: PersistedState = { version: 1, ...state }
    const files = memoryFiles(stored)
    expect(await loadState('/data/state.json', () => { throw new Error('fallback used') }, files)).toEqual(state)
    expect(appStateSchema.parse(state)).toEqual(state)
    expect(persistedStateSchema.parse(stored)).toEqual(stored)
  })

  it('uses a tmp file followed by an atomic rename', async () => {
    const state = newDefaultState(() => 'id', () => 1)
    const files = memoryFiles()
    await atomicWriteJson('/data/state.json', { version: 1, ...state }, files)
    expect(files.writes[0]?.path).toBe('/data/state.json.tmp')
    expect(files.renames).toEqual([{ from: '/data/state.json.tmp', to: '/data/state.json' }])
  })

  it('debounces writes for 500ms and persists the latest snapshot', async () => {
    vi.useFakeTimers()
    const files = memoryFiles()
    let id = 0
    const store = new BrowserState({
      path: '/data/state.json', files, initialState: newDefaultState(() => `seed-${++id}`, () => 1),
      createId: () => `tab-${++id}`, now: () => 5
    })
    store.dispatch({ type: 'openTab', url: 'one.test' })
    await vi.advanceTimersByTimeAsync(300)
    store.dispatch({ type: 'openTab', url: 'two.test' })
    await vi.advanceTimersByTimeAsync(499)
    expect(files.writes).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(files.writes).toHaveLength(1)
    const written = persistedStateSchema.parse(JSON.parse(files.writes[0]!.data))
    expect(written.tabs.map((tab) => tab.url)).toEqual(['https://one.test/', 'https://two.test/'])
  })

  it('flush writes immediately and cancels the pending debounce', async () => {
    vi.useFakeTimers()
    const files = memoryFiles()
    const store = new BrowserState({ path: '/data/state.json', files, initialState: newDefaultState(() => 'id', () => 1), createId: () => 'tab' })
    store.dispatch({ type: 'openTab', url: 'example.com' })
    await store.flush()
    await vi.runAllTimersAsync()
    expect(files.writes).toHaveLength(1)
  })
})
