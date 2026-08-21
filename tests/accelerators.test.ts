import { describe, expect, it, vi } from 'vitest'
import type { AppState, BrowserCommand, CommandBarIntent } from '../src/shared'
import { createDefaultState, transition, type TransitionDependencies } from '../src/main/state/transitions'

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() }
}))

import { AcceleratorController } from '../src/main/accelerators'

function harness(): {
  controller: AcceleratorController
  state(): AppState
  commandBarIntents: CommandBarIntent[]
  reloads: boolean[]
  findToggles: number[]
} {
  let id = 0
  const dependencies: TransitionDependencies = { createId: () => `id-${++id}`, now: () => id }
  let state = createDefaultState(dependencies)
  const commandBarIntents: CommandBarIntent[] = []
  const reloads: boolean[] = []
  const findToggles: number[] = []
  const dispatch = (command: BrowserCommand): void => { state = transition(state, command, dependencies) }
  return {
    controller: new AcceleratorController({
      snapshot: () => state,
      dispatch,
      toggleCommandBar: (intent) => commandBarIntents.push(intent),
      reloadFocused: (hard) => reloads.push(hard),
      toggleFindBar: () => { findToggles.push(1) }
    }),
    state: () => state,
    commandBarIntents,
    reloads,
    findToggles
  }
}

describe('main-process accelerator actions', () => {
  it('forwards command-bar, reload, and find intents exactly once', () => {
    const app = harness()
    app.controller.commandBar('new-tab')
    app.controller.commandBar('edit-current-url')
    app.controller.reload(false)
    app.controller.reload(true)
    app.controller.toggleFindBar()
    expect(app.commandBarIntents).toEqual(['new-tab', 'edit-current-url'])
    expect(app.reloads).toEqual([false, true])
    expect(app.findToggles).toEqual([1])
  })

  it('cycles and closes tabs in the active space', () => {
    let id = 0
    const dependencies: TransitionDependencies = { createId: () => `id-${++id}`, now: () => id }
    let next = createDefaultState(dependencies)
    next = transition(next, { type: 'openTab', url: 'one.test' }, dependencies)
    next = transition(next, { type: 'openTab', url: 'two.test' }, dependencies)
    // Exercise through a fresh controller whose dispatch owns this mutable snapshot.
    const controller = new AcceleratorController({ snapshot: () => next, dispatch: (command) => { next = transition(next, command, dependencies) }, toggleCommandBar: () => {}, reloadFocused: () => {}, toggleFindBar: () => {} })
    const second = next.activeTabId[next.activeSpaceId]
    controller.cycleTab(-1)
    expect(next.activeTabId[next.activeSpaceId]).not.toBe(second)
    controller.closeActiveTab()
    expect(next.tabs).toHaveLength(1)
  })

  it('splits the active tab with the next tab and toggles back to one pane', () => {
    let id = 0
    const dependencies: TransitionDependencies = { createId: () => `tab-${++id}`, now: () => id }
    let state = createDefaultState(dependencies)
    state = transition(state, { type: 'openTab', url: 'one.test' }, dependencies)
    const first = state.tabs[0]!
    state = transition(state, { type: 'openTab', url: 'two.test' }, dependencies)
    state = transition(state, { type: 'setActiveTab', tabId: first.id }, dependencies)
    const controller = new AcceleratorController({ snapshot: () => state, dispatch: (command) => { state = transition(state, command, dependencies) }, toggleCommandBar: () => {}, reloadFocused: () => {}, toggleFindBar: () => {} })

    controller.toggleSplit()
    expect(state.spaces[0]?.split).toEqual({ panes: [first.id, state.tabs[1]!.id], focused: 0 })
    controller.toggleSplit()
    expect(state.spaces[0]?.split).toEqual({ panes: [first.id], focused: 0 })
  })
})
