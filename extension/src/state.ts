import { nanoid } from 'nanoid'

export const PALETTE = ['#8b7cf6', '#ee7c94', '#58a6a6', '#e0a85a', '#769bd8', '#aa79b7']

/** Chrome tab-group colors, in the same order as PALETTE. */
const GROUP_COLORS = ['purple', 'red', 'cyan', 'yellow', 'blue', 'pink'] as const

export type ChromeGroupColor = (typeof GROUP_COLORS)[number] | 'grey'

export interface Space {
  id: string
  name: string
  color: string
  /** Regular (unpinned) Chrome tab ids, recency-ordered: oldest first, most recent last. */
  tabIds: number[]
  /** Pinned Chrome tab ids in pin order; disjoint from tabIds. */
  pinnedTabIds: number[]
}

export interface WindowState {
  spaces: Space[]
  activeSpaceId: string
}

/**
 * Domain events applied to one window's state. Pure data: callers own all
 * chrome.* effects (the background worker is the single owner of membership).
 */
export type SpaceEvent =
  | { type: 'windowSeeded'; tabIds: number[]; pinnedTabIds: number[] }
  | { type: 'tabCreated'; tabId: number }
  | { type: 'tabRemoved'; tabId: number }
  | { type: 'tabActivated'; tabId: number }
  | { type: 'spaceCreated'; name: string; color: string }
  | { type: 'spaceFocused'; spaceId: string }
  | { type: 'pinToggled'; tabId: number; pinned: boolean }

export interface TransitionDependencies {
  createId: () => string
}

export function createWindowState(dependencies: TransitionDependencies): WindowState {
  const id = dependencies.createId()
  return {
    spaces: [{ id, name: 'Home', color: PALETTE[0]!, tabIds: [], pinnedTabIds: [] }],
    activeSpaceId: id
  }
}

function spaceOf(state: WindowState, spaceId: string): Space | undefined {
  return state.spaces.find((space) => space.id === spaceId)
}

/** The tab to show when switching to a space: its most recently used regular tab, else any pinned one. */
export function mostRecentTabId(space: Space): number | undefined {
  return space.tabIds.at(-1) ?? space.pinnedTabIds.at(-1)
}

export function transition(state: WindowState | undefined, event: SpaceEvent, dependencies: TransitionDependencies): WindowState {
  if (!state) state = createWindowState(dependencies)
  switch (event.type) {
    case 'windowSeeded':
      // Seeding only fills a fresh default space; later events take over.
      return {
        ...state,
        spaces: state.spaces.map((space) =>
          space.id === state.activeSpaceId ? { ...space, tabIds: [...event.tabIds], pinnedTabIds: [...event.pinnedTabIds] } : space
        )
      }
    case 'tabCreated': {
      if (state.spaces.some((space) => space.tabIds.includes(event.tabId) || space.pinnedTabIds.includes(event.tabId))) return state
      return {
        ...state,
        spaces: state.spaces.map((space) =>
          space.id === state.activeSpaceId ? { ...space, tabIds: [...space.tabIds, event.tabId] } : space
        )
      }
    }
    case 'tabRemoved': {
      if (!state.spaces.some((space) => space.tabIds.includes(event.tabId) || space.pinnedTabIds.includes(event.tabId))) return state
      return {
        ...state,
        spaces: state.spaces.map((space) => ({
          ...space,
          tabIds: space.tabIds.filter((tabId) => tabId !== event.tabId),
          pinnedTabIds: space.pinnedTabIds.filter((tabId) => tabId !== event.tabId)
        }))
      }
    }
    case 'tabActivated': {
      // Moving the activated tab to the end of tabIds is what makes it "most recent".
      return {
        ...state,
        spaces: state.spaces.map((space) => {
          if (!space.tabIds.includes(event.tabId)) return space
          return { ...space, tabIds: [...space.tabIds.filter((tabId) => tabId !== event.tabId), event.tabId] }
        })
      }
    }
    case 'spaceCreated': {
      const id = dependencies.createId()
      const name = event.name.trim() || 'Space'
      return { ...state, spaces: [...state.spaces, { id, name, color: event.color, tabIds: [], pinnedTabIds: [] }], activeSpaceId: id }
    }
    case 'spaceFocused':
      return spaceOf(state, event.spaceId) ? { ...state, activeSpaceId: event.spaceId } : state
    case 'pinToggled': {
      return {
        ...state,
        spaces: state.spaces.map((space) => {
          if (event.pinned && space.tabIds.includes(event.tabId)) {
            return { ...space, tabIds: space.tabIds.filter((tabId) => tabId !== event.tabId), pinnedTabIds: [...space.pinnedTabIds, event.tabId] }
          }
          if (!event.pinned && space.pinnedTabIds.includes(event.tabId)) {
            return { ...space, tabIds: [...space.tabIds, event.tabId], pinnedTabIds: space.pinnedTabIds.filter((tabId) => tabId !== event.tabId) }
          }
          return space
        })
      }
    }
  }
}

export function chromeGroupColor(colorHex: string): ChromeGroupColor {
  const index = PALETTE.indexOf(colorHex)
  return index >= 0 ? GROUP_COLORS[index]! : 'grey'
}

/**
 * Structural subset of chrome.storage.local's promise API so tests can hand-roll
 * a mock without loading @types/chrome behavior.
 */
export interface ChromeStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export const STORAGE_KEY = 'arcSpaces'

interface PersistedShape {
  version: 1
  windows: Record<string, WindowState>
}

export function parsePersisted(value: unknown): Record<string, WindowState> {
  const shape = value as PersistedShape | undefined
  return shape?.version === 1 && typeof shape.windows === 'object' && shape.windows !== null ? shape.windows : {}
}

/**
 * Single owner of per-window space membership. Mirrors the BrowserState pattern:
 * pure `transition` for logic, debounced persistence for the durable record.
 */
export class SpaceStore {
  readonly #storage: ChromeStorageArea
  readonly #dependencies: TransitionDependencies
  readonly #debounceMs: number
  readonly #windows = new Map<string, WindowState>()
  #hydrated = false
  #timer: ReturnType<typeof setTimeout> | undefined
  #write: Promise<void> = Promise.resolve()

  constructor(options: { storage: ChromeStorageArea; createId?: () => string; debounceMs?: number }) {
    this.#storage = options.storage
    this.#dependencies = { createId: options.createId ?? nanoid }
    this.#debounceMs = options.debounceMs ?? 500
  }

  async hydrate(): Promise<void> {
    if (this.#hydrated) return
    this.#hydrated = true
    const stored = await this.#storage.get(STORAGE_KEY)
    for (const [windowId, state] of Object.entries(parsePersisted(stored[STORAGE_KEY]))) {
      this.#windows.set(windowId, structuredClone(state))
    }
  }

  has(windowId: number): boolean {
    return this.#windows.has(String(windowId))
  }

  snapshot(windowId: number): WindowState {
    return structuredClone(this.#state(windowId))
  }

  dispatch(windowId: number, event: SpaceEvent): void {
    const key = String(windowId)
    const next = transition(this.#windows.get(key), event, this.#dependencies)
    this.#windows.set(key, next)
    this.#scheduleWrite()
  }

  forget(windowId: number): void {
    this.#windows.delete(String(windowId))
    this.#scheduleWrite()
  }

  async flush(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    await this.#persist()
  }

  #state(windowId: number): WindowState {
    const key = String(windowId)
    let state = this.#windows.get(key)
    if (!state) {
      state = createWindowState(this.#dependencies)
      this.#windows.set(key, state)
    }
    return state
  }

  #scheduleWrite(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.#persist()
    }, this.#debounceMs)
  }

  async #persist(): Promise<void> {
    const windows: Record<string, WindowState> = {}
    for (const [key, state] of this.#windows) windows[key] = structuredClone(state)
    const record: PersistedShape = { version: 1, windows }
    this.#write = this.#write.then(() => this.#storage.set({ [STORAGE_KEY]: record }))
    await this.#write
  }
}
