import type { AppState, BrowserCommand } from '../shared'

export interface CommandBarResult {
  key: string
  kind: 'tab' | 'space' | 'url' | 'search'
  label: string
  detail: string
  command: BrowserCommand
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
  return results.sort((a, b) => a.score - b.score || a.result.label.localeCompare(b.result.label)).map(({ result }) => result)
}

export function rankCommandBar(state: AppState, rawQuery: string, limit = 8): CommandBarResult[] {
  const query = rawQuery.trim()
  const currentTabs: ScoredResult[] = []
  const otherTabs: ScoredResult[] = []
  const spaces: ScoredResult[] = []

  for (const tab of state.tabs) {
    const score = fuzzyScore(`${tab.title} ${tab.url}`, query)
    if (score === undefined) continue
    const space = state.spaces.find((item) => item.id === tab.spaceId)
    const result: CommandBarResult = {
      key: `tab:${tab.id}`,
      kind: 'tab',
      label: tab.title || tab.url,
      detail: tab.spaceId === state.activeSpaceId ? tab.url : `${space?.name ?? 'Space'} · ${tab.url}`,
      command: { type: 'setActiveTab', tabId: tab.id }
    }
    ;(tab.spaceId === state.activeSpaceId ? currentTabs : otherTabs).push({ score, result })
  }

  for (const space of state.spaces) {
    const score = fuzzyScore(space.name, query)
    if (score === undefined) continue
    spaces.push({
      score,
      result: {
        key: `space:${space.id}`,
        kind: 'space',
        label: space.name,
        detail: 'Space',
        command: { type: 'setActiveSpace', spaceId: space.id }
      }
    })
  }

  const ranked = [...sortedMatches(currentTabs), ...sortedMatches(otherTabs), ...sortedMatches(spaces)]
  if (query) {
    ranked.push(isUrlish(query)
      ? { key: `url:${query}`, kind: 'url', label: query, detail: 'Open address', command: { type: 'openTab', url: query } }
      : {
          key: `search:${query}`,
          kind: 'search',
          label: query,
          detail: 'Search DuckDuckGo',
          command: { type: 'openTab', url: resolveCommandBarInput(query) }
        })
  }
  return ranked.slice(0, Math.min(8, Math.max(0, limit)))
}
