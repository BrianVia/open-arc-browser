import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { AppState, BrowserCommand, CommandBarIntent } from '../shared'

export interface AcceleratorDependencies {
  snapshot(): AppState
  dispatch(command: BrowserCommand): void
  toggleCommandBar(intent: CommandBarIntent): void
  reloadFocused(hard: boolean): void
  toggleFindBar(): void
}

export class AcceleratorController {
  readonly #dependencies: AcceleratorDependencies

  constructor(dependencies: AcceleratorDependencies) {
    this.#dependencies = dependencies
  }

  commandBar(intent: CommandBarIntent): void {
    this.#dependencies.toggleCommandBar(intent)
  }

  closeActiveTab(): void {
    const state = this.#dependencies.snapshot()
    const tabId = state.activeTabId[state.activeSpaceId]
    if (tabId) this.#dependencies.dispatch({ type: 'closeTab', tabId })
  }

  cycleTab(offset: -1 | 1): void {
    const state = this.#dependencies.snapshot()
    const tabs = state.tabs.filter((tab) => tab.spaceId === state.activeSpaceId)
    if (tabs.length < 2) return
    const activeIndex = tabs.findIndex((tab) => tab.id === state.activeTabId[state.activeSpaceId])
    const next = tabs[(Math.max(0, activeIndex) + offset + tabs.length) % tabs.length]
    if (next) this.#dependencies.dispatch({ type: 'setActiveTab', tabId: next.id })
  }

  activateSpace(index: number): void {
    const state = this.#dependencies.snapshot()
    const space = state.spaces[index]
    if (space) this.#dependencies.dispatch({ type: 'setActiveSpace', spaceId: space.id })
  }

  toggleSplit(): void {
    const state = this.#dependencies.snapshot()
    const space = state.spaces.find((item) => item.id === state.activeSpaceId)
    const activeTabId = state.activeTabId[state.activeSpaceId]
    if (!space || !activeTabId) return
    if (space.split?.panes.length === 2) {
      const focusedTabId = space.split.panes[space.split.focused]
      if (focusedTabId) this.#dependencies.dispatch({ type: 'setSplit', spaceId: space.id, tabIds: [focusedTabId], focused: 0 })
      return
    }
    const tabs = state.tabs.filter((tab) => tab.spaceId === space.id)
    const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId)
    if (tabs.length < 2 || activeIndex < 0) return
    const nextTab = tabs[(activeIndex + 1) % tabs.length]
    if (nextTab) this.#dependencies.dispatch({ type: 'setSplit', spaceId: space.id, tabIds: [activeTabId, nextTab.id], focused: 0 })
  }

  reload(hard: boolean): void {
    this.#dependencies.reloadFocused(hard)
  }

  toggleFindBar(): void {
    this.#dependencies.toggleFindBar()
  }
}

export function installApplicationMenu(actions: AcceleratorController): void {
  const spaceItems: MenuItemConstructorOptions[] = Array.from({ length: 8 }, (_, index) => ({
    label: `Space ${index + 1}`,
    accelerator: `Ctrl+${index + 1}`,
    click: () => actions.activateSpace(index)
  }))
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'Ctrl+T', click: () => actions.commandBar('new-tab') },
        { label: 'Edit Current URL', accelerator: 'Ctrl+L', click: () => actions.commandBar('edit-current-url') },
        { label: 'Close Tab', accelerator: 'Ctrl+W', click: () => actions.closeActiveTab() },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => actions.cycleTab(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => actions.cycleTab(-1) },
        { label: 'Toggle Split View', accelerator: 'Ctrl+D', click: () => actions.toggleSplit() },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'Ctrl+R', click: () => actions.reload(false) },
        { label: 'Hard Reload', accelerator: 'Ctrl+Shift+R', click: () => actions.reload(true) },
        { type: 'separator' },
        { label: 'Find in Page', accelerator: 'Ctrl+F', click: () => actions.toggleFindBar() }
      ]
    },
    { label: 'Spaces', submenu: spaceItems }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
