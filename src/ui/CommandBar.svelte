<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { AppState, CommandBarIntent } from '../shared'
  import { rankCommandBar, resolveCommandBarInput, type CommandBarResult } from './commandBarRanking'

  let appState = $state<AppState | null>(null)
  let intent = $state<CommandBarIntent>('new-tab')
  let query = $state('')
  let selected = $state(0)
  let input: HTMLInputElement

  const results = $derived(appState ? rankCommandBar(appState, query) : [])
  const activeTab = $derived(appState?.tabs.find((tab) => tab.id === appState?.activeTabId[appState.activeSpaceId]))

  onMount(() => {
    const unsubscribeState = window.browser.subscribe((state) => { appState = state })
    const unsubscribeEvents = window.browser.onCommandBarEvent((event) => {
      intent = event.intent
      query = event.intent === 'edit-current-url' ? activeTab?.url ?? '' : ''
      selected = 0
      void tick().then(() => {
        input.focus()
        if (event.intent === 'edit-current-url') input.select()
      })
    })
    window.browser.requestCommandBar({ type: 'query' })
    return () => {
      unsubscribeState()
      unsubscribeEvents()
    }
  })

  function hide(): void {
    window.browser.requestCommandBar({ type: 'hide' })
  }

  function runSelected(result?: CommandBarResult): void {
    if (!appState || !query.trim()) return
    if (intent === 'edit-current-url' && activeTab) {
      window.browser.command({ type: 'navigate', tabId: activeTab.id, url: resolveCommandBarInput(query) })
    } else {
      const target = result ?? results[selected] ?? results[0]
      if (!target) return
      window.browser.command(target.command)
    }
    hide()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      hide()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (results.length) selected = (selected + 1) % results.length
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length) selected = (selected - 1 + results.length) % results.length
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runSelected()
    }
  }
</script>

<section class="palette" aria-label="Command bar">
  <div class="query-row">
    <span class="search-icon" aria-hidden="true">⌕</span>
    <input
      bind:this={input}
      bind:value={query}
      oninput={() => { selected = 0 }}
      onkeydown={handleKeydown}
      aria-label={intent === 'edit-current-url' ? 'Edit current URL' : 'Search tabs, spaces, or the web'}
      placeholder="Search tabs, spaces, or the web"
      autocomplete="off"
      spellcheck="false"
    />
    <kbd>esc</kbd>
  </div>
  {#if results.length}
    <div class="results" role="listbox" aria-label="Results">
      {#each results as result, index (result.key)}
        <button
          class:selected={index === selected}
          role="option"
          aria-selected={index === selected}
          onmouseenter={() => { selected = index }}
          onclick={() => runSelected(result)}
        >
          <span class="kind" aria-hidden="true">{result.kind === 'tab' ? '◫' : result.kind === 'space' ? '●' : result.kind === 'url' ? '↗' : '⌕'}</span>
          <span class="copy"><strong>{result.label}</strong><small>{result.detail}</small></span>
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  :global(html), :global(body), :global(#app) { background: transparent !important; }
  :global(body) { padding: 1px; }
  .palette {
    width: 100%; overflow: hidden; border: 1px solid var(--line); border-radius: 12px;
    background:
      linear-gradient(145deg, color-mix(in srgb, #8b7cf6 10%, transparent), transparent 58%),
      color-mix(in srgb, var(--surface-strong) 94%, transparent);
    box-shadow: 0 18px 55px rgba(12, 10, 18, 0.28), 0 2px 8px rgba(12, 10, 18, 0.14);
    backdrop-filter: blur(24px); color: var(--text);
  }
  .query-row { height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 14px; }
  .search-icon { color: var(--muted); font-size: 20px; }
  input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; font-size: 15px; }
  kbd { padding: 2px 6px; border: 1px solid var(--line); border-radius: 5px; color: var(--muted); font: 10px/1.4 inherit; }
  .results { padding: 4px 6px 6px; border-top: 1px solid var(--line); }
  button { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; background: transparent; text-align: left; }
  button.selected { background: var(--active); }
  .kind { width: 18px; color: var(--muted); text-align: center; font-size: 12px; }
  .copy { min-width: 0; display: flex; flex: 1; align-items: baseline; gap: 9px; }
  strong { min-width: 0; overflow: hidden; color: var(--text); font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  small { min-width: 0; overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
</style>
