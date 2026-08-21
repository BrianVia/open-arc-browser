import { readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow, type Session, type WebContents } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import type { AppState, BrowserCommand, Space } from '../../shared'

// MV3 caveats (library v4.9.0 README/docs): background scripts are all
// persistent (no MV3 service-worker suspension semantics), Electron's own
// webRequest usage suppresses chrome.webRequest listeners, extensions are
// unsupported in non-persistent sessions, and MV3 support is partial — the
// dependency is pinned exact and target extensions (uBlock Origin Lite,
// Dark Reader) must be validated manually per SPEC-M3.
const LICENSE = 'GPL-3.0'

export interface ExtensionBridgeOptions {
  profileId: string
  window: BrowserWindow
  emit: (command: BrowserCommand) => void
  getState: () => AppState
  viewForTab: (tabId: string) => WebContents | undefined
  tabIdFor: (contents: WebContents) => string | undefined
}

interface CreateTabDetails {
  url?: string
}

export class ExtensionBridge {
  readonly #options: ExtensionBridgeOptions
  readonly #extensions: ElectronChromeExtensions

  constructor(session: Session, options: ExtensionBridgeOptions) {
    this.#options = options
    // Instantiating with the session registers the library's preload scripts
    // on it (frame + service worker); view webPreferences must keep
    // sandbox: true + contextIsolation: true for that preload to run —
    // EngineHost already does both.
    this.#extensions = new ElectronChromeExtensions({
      license: LICENSE,
      session,
      createTab: async (details) => this.#createTab(details),
      selectTab: (webContents) => this.#selectTab(webContents),
      removeTab: (webContents) => this.#removeTab(webContents)
    })
  }

  addTab(tab: WebContents): void {
    this.#extensions.addTab(tab, this.#options.window)
  }

  removeTab(tab: WebContents): void {
    this.#extensions.removeTab(tab)
  }

  /** Report this profile's scoped active tab to the extension system. */
  syncActiveTab(state: AppState): void {
    const tabId = activeTabIdOfProfile(state, this.#options.profileId)
    if (!tabId) return
    const view = this.#options.viewForTab(tabId)
    if (view) this.#extensions.selectTab(view)
  }

  async #createTab(details: CreateTabDetails): Promise<[WebContents, BrowserWindow]> {
    const state = this.#options.getState()
    const space = activeSpaceOfProfile(state, this.#options.profileId)
    if (!space) throw new Error(`ExtensionBridge: profile ${this.#options.profileId} has no space to open a tab in`)
    const known = new Set(state.tabs.filter((tab) => tab.spaceId === space.id).map((tab) => tab.id))
    this.#options.emit({ type: 'openTab', url: details.url ?? '', spaceId: space.id })
    const created = this.#options.getState().tabs.find((tab) => tab.spaceId === space.id && !known.has(tab.id))
    const contents = created ? this.#options.viewForTab(created.id) : undefined
    if (!created || !contents) throw new Error('ExtensionBridge: extension-created tab did not produce a view')
    return [contents, this.#options.window]
  }

  #tabIdForContents(contents: WebContents): string | undefined {
    const tabId = this.#options.tabIdFor(contents)
    return tabId && this.#options.getState().tabs.some((tab) => tab.id === tabId) ? tabId : undefined
  }

  #selectTab(contents: WebContents): void {
    const tabId = this.#tabIdForContents(contents)
    if (tabId) this.#options.emit({ type: 'setActiveTab', tabId })
  }

  #removeTab(contents: WebContents): void {
    const tabId = this.#tabIdForContents(contents)
    if (tabId) this.#options.emit({ type: 'closeTab', tabId })
  }
}

/** The profile's active space: the globally active one when owned by this profile,
 * else the profile's most recently touched space, else its first space. */
export function activeSpaceOfProfile(state: AppState, profileId: string) {
  const spaces = state.spaces.filter((space) => space.profileId === profileId)
  return spaces.find((space) => space.id === state.activeSpaceId) ?? mostRecentlyUsedSpace(state, spaces)
}

export function activeTabIdOfProfile(state: AppState, profileId: string): string | undefined {
  const space = activeSpaceOfProfile(state, profileId)
  const tabId = space ? state.activeTabId[space.id] : undefined
  if (!tabId || !space) return undefined
  return state.tabs.some((tab) => tab.id === tabId && tab.spaceId === space.id) ? tabId : undefined
}

function mostRecentlyUsedSpace(state: AppState, spaces: Space[]) {
  let best = spaces[0]
  let bestAt = -1
  for (const space of spaces) {
    const lastActiveAt = Math.max(-1, ...state.tabs.filter((tab) => tab.spaceId === space.id).map((tab) => tab.lastActiveAt))
    if (lastActiveAt > bestAt) {
      best = space
      bestAt = lastActiveAt
    }
  }
  return best
}

/**
 * Loads unpacked extensions from `<userData>/extensions/<profileId>/` into the
 * profile session; each subdirectory is one unpacked extension. Failures are
 * contained per directory so one bad extension cannot break startup.
 */
export async function loadUnpackedExtensions(session: Session, directory: string): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      await session.loadExtension(join(directory, entry.name))
    } catch (error) {
      console.error(`ExtensionBridge: failed to load extension "${entry.name}"`, error)
    }
  }
}

export function extensionsRootFor(profileId: string): string {
  return join(app.getPath('userData'), 'extensions', profileId)
}
