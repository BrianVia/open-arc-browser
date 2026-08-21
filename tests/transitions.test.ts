import { describe, expect, it } from 'vitest'
import type { AppState, BrowserCommand } from '../src/shared'
import { createDefaultState, transition, type TransitionDependencies } from '../src/main/state/transitions'

function harness(): { state: AppState; run: (command: BrowserCommand) => AppState } {
  let sequence = 0
  const dependencies: TransitionDependencies = { createId: () => `id-${++sequence}`, now: () => 1000 + sequence }
  let state = createDefaultState(dependencies)
  return {
    get state() { return state },
    run(command) { state = transition(state, command, dependencies); return state }
  }
}

describe('BrowserState transitions', () => {
  it('opens, activates, navigates, pins and closes tabs', () => {
    const app = harness()
    const spaceId = app.state.activeSpaceId
    app.run({ type: 'openTab', url: 'example.com' })
    const first = app.state.tabs[0]!
    expect(first.url).toBe('https://example.com/')
    expect(app.state.activeTabId[spaceId]).toBe(first.id)

    app.run({ type: 'pinTab', tabId: first.id })
    expect(app.state.tabs[0]?.pinned).toBe(true)
    app.run({ type: 'unpinTab', tabId: first.id })
    expect(app.state.tabs[0]?.pinned).toBe(false)
    app.run({ type: 'pinTab', tabId: first.id })
    app.run({ type: 'navigate', tabId: first.id, url: 'example.org/docs' })
    expect(app.state.tabs[0]?.nav.entries).toHaveLength(2)

    app.run({ type: 'openTab', url: 'https://second.test' })
    const second = app.state.tabs[1]!
    app.run({ type: 'setActiveTab', tabId: first.id })
    expect(app.state.activeTabId[spaceId]).toBe(first.id)
    app.run({ type: 'closeTab', tabId: first.id })
    expect(app.state.tabs.map((tab) => tab.id)).toEqual([second.id])
    expect(app.state.activeTabId[spaceId]).toBe(second.id)
  })

  it('creates, renames and switches spaces', () => {
    const app = harness()
    const original = app.state.activeSpaceId
    app.run({ type: 'createSpace', name: ' Work ', color: '#123456' })
    const created = app.state.spaces.at(-1)!
    expect(created.name).toBe('Work')
    expect(app.state.activeSpaceId).toBe(created.id)
    app.run({ type: 'renameSpace', spaceId: created.id, name: 'Focus' })
    app.run({ type: 'setActiveSpace', spaceId: original })
    expect(app.state.spaces.at(-1)?.name).toBe('Focus')
    expect(app.state.activeSpaceId).toBe(original)
  })

  it('collapses a two-pane split when either split tab closes', () => {
    const app = harness()
    const spaceId = app.state.activeSpaceId
    app.run({ type: 'openTab', url: 'https://one.test' })
    const one = app.state.tabs.at(-1)!
    app.run({ type: 'openTab', url: 'https://two.test' })
    const two = app.state.tabs.at(-1)!
    app.run({ type: 'setSplit', spaceId, tabIds: [one.id, two.id], focused: 1 })
    expect(app.state.spaces[0]?.split).toEqual({ panes: [one.id, two.id], focused: 1 })
    app.run({ type: 'closeTab', tabId: two.id })
    expect(app.state.spaces[0]?.split).toEqual({ panes: [one.id], focused: 0 })
    app.run({ type: 'closeTab', tabId: one.id })
    expect(app.state.spaces[0]?.split).toBeNull()
  })

  it('rejects invalid split membership and focus', () => {
    const app = harness()
    const before = app.state
    expect(app.run({ type: 'setSplit', spaceId: before.activeSpaceId, tabIds: ['missing'], focused: 0 })).toBe(before)
  })

  it('treats every command for an unknown tab as a no-op', () => {
    const commands: BrowserCommand[] = [
      { type: 'closeTab', tabId: 'unknown' },
      { type: 'setActiveTab', tabId: 'unknown' },
      { type: 'pinTab', tabId: 'unknown' },
      { type: 'unpinTab', tabId: 'unknown' },
      { type: 'navigate', tabId: 'unknown', url: 'https://example.com' },
      { type: 'tabEvent', tabId: 'unknown', event: { title: 'stale event' } }
    ]
    const app = harness()
    for (const command of commands) {
      const before = app.state
      expect(app.run(command)).toBe(before)
    }
  })

  it('adds committed navigation without discarding tab identity', () => {
    const app = harness()
    app.run({ type: 'openTab', url: 'https://one.test' })
    const tab = app.state.tabs[0]!
    app.run({ type: 'tabEvent', tabId: tab.id, event: { url: 'https://two.test/', title: 'Two', navEntry: { url: 'https://two.test/', title: 'Two' } } })
    expect(app.state.tabs[0]).toMatchObject({ id: tab.id, url: 'https://two.test/', title: 'Two', nav: { index: 1 } })
  })
})
