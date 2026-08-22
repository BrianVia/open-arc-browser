import { describe, expect, it } from 'vitest'
import type { CommandBarInput } from '../src/commandBarRanking'
import { rankCommandBar, resolveCommandBarInput } from '../src/commandBarRanking'

// Ported from tests/command-bar-ranking.test.ts to the extension input shape:
// numeric Chrome tab ids + windowId, spaces instead of AppState.
const input: CommandBarInput = {
  tabs: [
    { id: 2, windowId: 7, title: 'Example other', url: 'https://other.example.com', spaceId: 'work' },
    { id: 1, windowId: 7, title: 'Example current', url: 'https://example.com', spaceId: 'home' }
  ],
  spaces: [
    { id: 'home', name: 'Home' },
    { id: 'work', name: 'Work' }
  ],
  activeSpaceId: 'home'
}

describe('command bar ranking', () => {
  it('ranks current-space tabs before other tabs', () => {
    const results = rankCommandBar(input, 'example')
    expect(results.slice(0, 2).map((result) => result.key)).toEqual(['tab:1', 'tab:2'])
    expect(results[1]?.action).toEqual({ type: 'activateTab', tabId: 2, windowId: 7 })
    expect(results[1]?.detail).toBe('Work · https://other.example.com')
  })

  it('shows spaces first, then recent tabs, on an empty query', () => {
    // Input order is most-recent-first, and ties keep it (stable sort).
    expect(rankCommandBar(input, '').map((result) => result.key)).toEqual([
      'space:home', 'space:work', 'tab:1', 'tab:2'
    ])
  })

  it('adds URL and DuckDuckGo fallback actions after state matches', () => {
    expect(rankCommandBar(input, 'localhost:3000').at(-1)?.action).toEqual({ type: 'openUrl', url: 'localhost:3000' })
    expect(rankCommandBar(input, 'unmatched words').at(-1)?.action).toEqual({
      type: 'openUrl',
      url: 'https://duckduckgo.com/?q=unmatched%20words'
    })
    expect(resolveCommandBarInput('mailto:hello@example.com')).toBe('mailto:hello@example.com')
  })

  it('fuzzy matches and caps the result list at eight', () => {
    expect(rankCommandBar(input, 'excr')[0]?.key).toBe('tab:1')
    expect(rankCommandBar(input, '', 1)).toHaveLength(1)
    expect(rankCommandBar(input, '', 99).length).toBeLessThanOrEqual(8)
  })
})
