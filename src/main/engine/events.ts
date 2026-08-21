import type { WebContents } from 'electron'
import type { AppState, BrowserCommand } from '../../shared'

export interface EventCorrelation {
  tabFor(contents: WebContents): string | undefined
  state(): AppState
  emit(command: BrowserCommand): void
}

export function correlatedTabId(contents: WebContents, correlation: EventCorrelation): string | undefined {
  const tabId = correlation.tabFor(contents)
  return tabId && correlation.state().tabs.some((tab) => tab.id === tabId) ? tabId : undefined
}

export function wirePageEvents(contents: WebContents, correlation: EventCorrelation, onCrash: () => void): void {
  contents.on('page-title-updated', (_event, title) => {
    const tabId = correlatedTabId(contents, correlation)
    if (tabId) correlation.emit({ type: 'tabEvent', tabId, event: { title } })
  })
  contents.on('page-favicon-updated', (_event, favicons) => {
    const tabId = correlatedTabId(contents, correlation)
    const faviconUrl = favicons[0]
    if (tabId && faviconUrl) correlation.emit({ type: 'tabEvent', tabId, event: { faviconUrl } })
  })
  contents.on('did-navigate', (_event, url) => {
    const tabId = correlatedTabId(contents, correlation)
    if (!tabId) return
    const title = contents.getTitle() || url
    const history = contents.navigationHistory
    const nav = {
      entries: history.getAllEntries().map((entry) => ({ url: entry.url, title: entry.title })),
      index: history.getActiveIndex()
    }
    correlation.emit({ type: 'tabEvent', tabId, event: { url, title, nav, crashed: false } })
  })
  contents.on('render-process-gone', () => {
    const tabId = correlatedTabId(contents, correlation)
    if (tabId) correlation.emit({ type: 'tabEvent', tabId, event: { crashed: true } })
    onCrash()
  })
}
