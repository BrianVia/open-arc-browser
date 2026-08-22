/**
 * Port of src/ui/commandBarRanking.ts adapted to extension inputs:
 * real Chrome tabs (numeric ids, windowId) + Space records instead of AppState.
 * Tabs arrive most-recent-first; equal scores keep that order (stable sort),
 * so the initial empty-query view shows spaces then recent tabs.
 */

export interface CommandBarTab {
  id: number
  windowId: number
  title: string
  url: string
  spaceId: string
}

export interface CommandBarSpace {
  id: string
  name: string
}

export interface CommandBarInput {
  /** Most-recent-first across all spaces/windows. */
  tabs: CommandBarTab[]
  spaces: CommandBarSpace[]
  activeSpaceId?: string
}

export type CommandBarAction =
  | { type: 'activateTab'; tabId: number; windowId: number }
  | { type: 'focusSpace'; spaceId: string }
  | { type: 'openUrl'; url: string }

export interface CommandBarResult {
  key: string
  kind: 'tab' | 'space' | 'url' | 'search'
  label: string
  detail: string
  action: CommandBarAction
}

interface ScoredResult {
  score: number
  result: CommandBarResult
}

function fuzzyScore(value: string, query: string): number | undefined {
  if (!query) return 0
  const haystack = value.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  const direct = haystack.indexOf(needle)
  if (direct >= 0) return direct

  let cursor = 0
  let gap = 0
  for (const character of needle) {
    const index = haystack.indexOf(character, cursor)
    if (index < 0) return undefined
    gap += index - cursor
    cursor = index + 1
  }
  return 100 + gap
}

function isUrlish(input: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|localhost(?::\d+)?(?:\/|$)|[^\s]+\.[^\s]+)$/i.test(input)
}

export function resolveCommandBarInput(rawInput: string): string {
  const input = rawInput.trim()
  return isUrlish(input) ? input : `https://duckduckgo.com/?q=${encodeURIComponent(input)}`
}

function sortedMatches(results: ScoredResult[]): CommandBarResult[] {
  // Array#sort is stable, so ties preserve the caller's recency order.
  return results.sort((a, b) => a.score - b.score).map(({ result }) => result)
}

export function rankCommandBar(input: CommandBarInput, rawQuery: string, limit = 8): CommandBarResult[] {
  const query = rawQuery.trim()
  const currentTabs: ScoredResult[] = []
  const otherTabs: ScoredResult[] = []
  const spaces: ScoredResult[] = []

  for (const tab of input.tabs) {
    const score = fuzzyScore(`${tab.title} ${tab.url}`, query)
    if (score === undefined) continue
    const space = input.spaces.find((item) => item.id === tab.spaceId)
    const result: CommandBarResult = {
      key: `tab:${tab.id}`,
      kind: 'tab',
      label: tab.title || tab.url,
      detail: tab.spaceId === input.activeSpaceId ? tab.url : `${space?.name ?? 'Space'} · ${tab.url}`,
      action: { type: 'activateTab', tabId: tab.id, windowId: tab.windowId }
    }
    ;(tab.spaceId === input.activeSpaceId ? currentTabs : otherTabs).push({ score, result })
  }

  for (const space of input.spaces) {
    const score = fuzzyScore(space.name, query)
    if (score === undefined) continue
    spaces.push({
      score,
      result: {
        key: `space:${space.id}`,
        kind: 'space',
        label: space.name,
        detail: 'Space',
        action: { type: 'focusSpace', spaceId: space.id }
      }
    })
  }

  const ranked =
    query === ''
      ? [...sortedMatches(spaces), ...sortedMatches(currentTabs), ...sortedMatches(otherTabs)]
      : [...sortedMatches(currentTabs), ...sortedMatches(otherTabs), ...sortedMatches(spaces)]

  if (query) {
    ranked.push(
      isUrlish(query)
        ? { key: `url:${query}`, kind: 'url', label: query, detail: 'Open address', action: { type: 'openUrl', url: query } }
        : { key: `search:${query}`, kind: 'search', label: query, detail: 'Search DuckDuckGo', action: { type: 'openUrl', url: resolveCommandBarInput(query) } }
    )
  }
  return ranked.slice(0, Math.min(8, Math.max(0, limit)))
}
