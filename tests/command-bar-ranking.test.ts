import { describe, expect, it } from 'vitest'
import type { AppState } from '../src/shared'
import { rankCommandBar, resolveCommandBarInput } from '../src/ui/commandBarRanking'

const state: AppState = {
  profiles: [{ id: 'profile', name: 'Personal', color: '#888' }],
  spaces: [
    { id: 'home', profileId: 'profile', name: 'Home', color: '#888', split: null },
    { id: 'work', profileId: 'profile', name: 'Work', color: '#777', split: null }
  ],
  tabs: [
    { id: 'current', spaceId: 'home', title: 'Example current', url: 'https://example.com', faviconUrl: '', pinned: false, muted: false, lastActiveAt: 1, nav: { entries: [], index: -1 } },
    { id: 'other', spaceId: 'work', title: 'Example other', url: 'https://other.example.com', faviconUrl: '', pinned: false, muted: false, lastActiveAt: 2, nav: { entries: [], index: -1 } }
  ],
  activeSpaceId: 'home',
  activeTabId: { home: 'current', work: 'other' }
}

describe('command bar ranking', () => {
  it('ranks current-space tabs before other tabs and spaces', () => {
    const results = rankCommandBar(state, 'example')
    expect(results.slice(0, 2).map((result) => result.key)).toEqual(['tab:current', 'tab:other'])
    expect(results[1]?.command).toEqual({ type: 'setActiveTab', tabId: 'other' })
    expect(rankCommandBar(state, '').slice(0, 4).map((result) => result.key)).toEqual([
      'tab:current', 'tab:other', 'space:home', 'space:work'
    ])
  })

  it('adds URL and DuckDuckGo fallback actions after state matches', () => {
    expect(rankCommandBar(state, 'localhost:3000').at(-1)?.command).toEqual({ type: 'openTab', url: 'localhost:3000' })
    expect(rankCommandBar(state, 'unmatched words').at(-1)?.command).toEqual({
      type: 'openTab',
      url: 'https://duckduckgo.com/?q=unmatched%20words'
    })
    expect(resolveCommandBarInput('mailto:hello@example.com')).toBe('mailto:hello@example.com')
  })

  it('fuzzy matches and caps the result list at eight', () => {
    expect(rankCommandBar(state, 'excr')[0]?.key).toBe('tab:current')
    expect(rankCommandBar(state, '', 1)).toHaveLength(1)
    expect(rankCommandBar(state, '', 99).length).toBeLessThanOrEqual(8)
  })
})
