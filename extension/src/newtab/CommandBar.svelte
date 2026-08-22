<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { CommandBarInput, CommandBarResult } from '../commandBarRanking'
  import { rankCommandBar } from '../commandBarRanking'
  import { STORAGE_KEY, type Space } from '../state'

  let catalog = $state<CommandBarInput>({ tabs: [], spaces: [] })
  let query = $state('')
  let selected = $state(0)
  let input: HTMLInputElement
  let selfTabId: number | undefined
  let selfWindowId = $state(0)

  const results = $derived(rankCommandBar(catalog, query))

  onMount(() => {
    void (async () => {
      const [self, tabs, stored] = await Promise.all([
        chrome.tabs.getCurrent(),
        chrome.tabs.query({}),
        chrome.storage.local.get(STORAGE_KEY)
      ])
      selfTabId = self?.id
      const windowId = self?.windowId ?? 0
      selfWindowId = windowId
      // The background owns membership; ask it directly so a just-opened tab is never stale.
      const response = await chrome.runtime.sendMessage({ type: 'getState', windowId }).catch(() => undefined)
      const mine =
        response?.ok === true
          ? { spaces: response.spaces as Space[], activeSpaceId: response.activeSpaceId as string }
          : parseStored(stored[STORAGE_KEY], String(windowId))
      const byId = new Map(tabs.flatMap((tab) => (tab.id === undefined ? [] : [[tab.id, tab] as const])))
      // Recency across spaces: each space's tabIds are oldest-first; later spaces are newer.
      const recency: CommandBarInput['tabs'] = []
      for (const space of mine.spaces) {
        for (const id of [...space.tabIds].reverse()) {
          if (id === selfTabId) continue
          const tab = byId.get(id)
          if (!tab) continue
          recency.push({ id, windowId: tab.windowId, title: tab.title ?? '', url: tab.url ?? '', spaceId: space.id })
        }
      }
      catalog = { tabs: recency, spaces: mine.spaces.map(({ id, name }) => ({ id, name })), activeSpaceId: mine.activeSpaceId }
    })()
    void tick().then(() => input.focus())
  })

  function parseStored(value: unknown, windowKey: string): { spaces: Space[]; activeSpaceId: string } {
    const windows = (value as { version?: number; windows?: Record<string, { spaces: Space[]; activeSpaceId: string }> } | undefined)?.windows
    const mine = windows?.[windowKey]
    return mine ?? { spaces: [], activeSpaceId: '' }
  }

  async function closeSelf(): Promise<void> {
    if (selfTabId !== undefined) {
      await chrome.tabs.remove(selfTabId)
      return
    }
    window.close()
  }

  async function runSelected(result?: CommandBarResult): Promise<void> {
    const target = result ?? results[selected] ?? results[0]
    if (!target) return
    switch (target.action.type) {
      case 'activateTab': {
        await chrome.tabs.update(target.action.tabId, { active: true })
        await chrome.windows.update(target.action.windowId, { focused: true })
        await closeSelf()
        break
      }
      case 'focusSpace': {
        if (selfTabId !== undefined) {
          await chrome.runtime.sendMessage({ type: 'switchSpace', windowId: selfWindowId, spaceId: target.action.spaceId })
        }
        await closeSelf()
        break
      }
      case 'openUrl': {
        // Navigating the newtab itself is the natural "open" here.
        if (selfTabId !== undefined) await chrome.tabs.update(selfTabId, { url: target.action.url })
        else await chrome.tabs.create({ url: target.action.url })
        break
      }
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      void closeSelf()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (results.length) selected = (selected + 1) % results.length
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length) selected = (selected - 1 + results.length) % results.length
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void runSelected()
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
      aria-label="Search tabs, spaces, or the web"
      placeholder="Search tabs, spaces, or the web"
      autocomplete="off"
      spellcheck="false"
    />
    <kbd>esc closes</kbd>
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
  :global(html), :global(body), :global(#app) { width: 100%; height: 100%; margin: 0; }
  :global(body) {
    background:
      radial-gradient(60% 50% at 50% 0%, color-mix(in srgb, #8b7cf6 9%, transparent), transparent),
      var(--shell);
  }
  /* #app is the full-size box, so center the palette here, not on body. */
  :global(#app) { display: grid; justify-items: center; align-content: start; padding-top: 18vh; }
  .palette {
    width: min(620px, calc(100vw - 48px)); overflow: hidden; border: 1px solid var(--line); border-radius: 12px;
    background:
      linear-gradient(145deg, color-mix(in srgb, #8b7cf6 10%, transparent), transparent 58%),
      color-mix(in srgb, var(--surface-strong) 94%, transparent);
    box-shadow: 0 18px 55px rgba(12, 10, 18, 0.28), 0 2px 8px rgba(12, 10, 18, 0.14);
    backdrop-filter: blur(24px); color: var(--text);
  }
  .query-row { height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 14px; }
  .search-icon { color: var(--muted); font-size: 20px; }
  input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; font-size: 15px; }
  kbd { padding: 2px 6px; border: 1px solid var(--line); border-radius: 5px; color: var(--muted); font: 10px/1.4 inherit; white-space: nowrap; }
  .results { padding: 4px 6px 6px; border-top: 1px solid var(--line); }
  button { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; background: transparent; text-align: left; cursor: pointer; }
  button.selected { background: var(--active); }
  .kind { width: 18px; color: var(--muted); text-align: center; font-size: 12px; }
  .copy { min-width: 0; display: flex; flex: 1; align-items: baseline; gap: 9px; }
  strong { min-width: 0; overflow: hidden; color: var(--text); font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  small { min-width: 0; overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
</style>
