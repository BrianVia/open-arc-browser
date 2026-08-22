<script lang="ts">
  import type { Space } from '../state'
  import { PALETTE, parsePersisted, STORAGE_KEY } from '../state'
  import { resolveCommandBarInput } from '../commandBarRanking'
  import Button from '../foundation/Button.svelte'
  import SidebarItem from '../foundation/SidebarItem.svelte'

  interface LiveTab {
    id: number
    title: string
    url: string
    favIconUrl: string
  }

  interface StatePayload {
    ok?: boolean
    spaces?: Space[]
    activeSpaceId?: string
  }

  let windowId = $state(0)
  let spaces = $state<Space[]>([])
  let activeSpaceId = $state('')
  let live = $state<Record<number, LiveTab>>({})
  let activeTabId = $state<number | null>(null)
  let urlInput = $state('')
  let addingSpace = $state(false)
  let newSpaceName = $state('')
  let openingNewTab = $state(false)
  let urlField: HTMLInputElement

  const activeSpace = $derived(spaces.find((space) => space.id === activeSpaceId))
  const activeTab = $derived(activeTabId === null ? undefined : live[activeTabId])
  // Stable order: newest tab on top (tabIds are oldest-first by recency).
  const visibleTabs = $derived((activeSpace?.tabIds ?? []).flatMap((id) => (live[id] ? [live[id]!] : [])).reverse())
  const pinnedTabs = $derived((activeSpace?.pinnedTabIds ?? []).flatMap((id) => (live[id] ? [live[id]!] : [])))

  function toLive(tab: chrome.tabs.Tab): LiveTab | undefined {
    if (tab.id === undefined) return undefined
    return { id: tab.id, title: tab.title ?? '', url: tab.url ?? '', favIconUrl: tab.favIconUrl ?? '' }
  }

  function faviconUrl(tab: LiveTab): string {
    return tab.favIconUrl || chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(tab.url)}&size=32`)
  }

  function applyState(payload: unknown): boolean {
    const next = payload as StatePayload | undefined
    if (!next?.ok || !next.spaces) return false
    spaces = next.spaces
    if (next.activeSpaceId) activeSpaceId = next.activeSpaceId
    return true
  }

  async function refreshSpaces(): Promise<void> {
    // The background owns membership; its snapshot is fresher than storage during the persist debounce.
    const response = (await chrome.runtime.sendMessage({ type: 'getState', windowId }).catch(() => undefined)) as StatePayload | undefined
    if (applyState(response)) return
    const stored = await chrome.storage.local.get(STORAGE_KEY)
    const mine = parsePersisted(stored[STORAGE_KEY])[String(windowId)]
    if (!mine) return
    spaces = mine.spaces
    activeSpaceId = mine.activeSpaceId
  }

  $effect(() => {
    urlInput = openingNewTab ? '' : activeTab?.url ?? ''
  })

  $effect(() => {
    const unsubs: Array<() => void> = []
    let disposed = false
    void (async () => {
      const current = await chrome.windows.getCurrent()
      windowId = current.id ?? 0
      await refreshSpaces()
      const tabs = await chrome.tabs.query({})
      const next: Record<number, LiveTab> = {}
      for (const tab of tabs) {
        const item = toLive(tab)
        if (item) next[item.id] = item
      }
      live = next
      const [active] = await chrome.tabs.query({ active: true, windowId })
      activeTabId = active?.id ?? null

      const onCreated = (tab: chrome.tabs.Tab): void => {
        if (tab.windowId !== windowId) return
        const item = toLive(tab)
        if (item) live[item.id] = item
      }
      const onRemoved = (tabId: number): void => {
        delete live[tabId]
        if (activeTabId === tabId) activeTabId = null
      }
      const onUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo): void => {
        const item = live[tabId]
        if (!item) return
        if (changeInfo.title !== undefined) item.title = changeInfo.title
        if (changeInfo.url !== undefined) item.url = changeInfo.url
        if (changeInfo.favIconUrl !== undefined) item.favIconUrl = changeInfo.favIconUrl
      }
      const onActivated = (info: chrome.tabs.TabActiveInfo): void => {
        if (info.windowId === windowId) activeTabId = info.tabId
      }
      const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
        if (area === 'local' && changes[STORAGE_KEY]) void refreshSpaces()
      }
      chrome.tabs.onCreated.addListener(onCreated)
      unsubs.push(() => chrome.tabs.onCreated.removeListener(onCreated))
      chrome.tabs.onRemoved.addListener(onRemoved)
      unsubs.push(() => chrome.tabs.onRemoved.removeListener(onRemoved))
      chrome.tabs.onUpdated.addListener(onUpdated)
      unsubs.push(() => chrome.tabs.onUpdated.removeListener(onUpdated))
      chrome.tabs.onActivated.addListener(onActivated)
      unsubs.push(() => chrome.tabs.onActivated.removeListener(onActivated))
      chrome.storage.onChanged.addListener(onStorage)
      unsubs.push(() => chrome.storage.onChanged.removeListener(onStorage))
      if (disposed) for (const fn of unsubs.splice(0)) fn()
    })()
    return () => {
      disposed = true
      for (const fn of unsubs.splice(0)) fn()
    }
  })

  function submitUrl(): void {
    const input = urlInput.trim()
    if (!input) return
    const url = resolveCommandBarInput(input)
    if (activeTab && !openingNewTab) void chrome.tabs.update(activeTab.id, { url })
    else void chrome.tabs.create({ windowId, url })
    openingNewTab = false
  }

  function selectTab(tabId: number): void {
    openingNewTab = false
    activeTabId = tabId
    void chrome.tabs.update(tabId, { active: true })
  }

  function closeTab(event: MouseEvent, tabId: number): void {
    event.stopPropagation()
    void chrome.tabs.remove(tabId)
  }

  function togglePin(event: MouseEvent, tabId: number, pinned: boolean): void {
    event.stopPropagation()
    void chrome.runtime.sendMessage({ type: 'togglePin', tabId, pinned: !pinned }).then(applyState)
  }

  async function selectSpace(spaceId: string): Promise<void> {
    applyState(await chrome.runtime.sendMessage({ type: 'switchSpace', windowId, spaceId }))
  }

  function createSpace(): void {
    const name = newSpaceName.trim()
    if (!name) return
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)]!
    void chrome.runtime.sendMessage({ type: 'createSpace', windowId, name, color }).then(applyState)
    newSpaceName = ''
    addingSpace = false
  }
</script>

<aside style:--space-color={activeSpace?.color ?? '#8b7cf6'}>
  <form class="url" onsubmit={(event) => { event.preventDefault(); submitUrl() }}>
    <span aria-hidden="true">⌕</span>
    <input bind:this={urlField} bind:value={urlInput} aria-label="URL or search" placeholder="Search or enter URL" />
  </form>

  <button class="new-tab" onclick={() => { openingNewTab = true; urlInput = ''; urlField.focus() }}><span>＋</span> New Tab</button>

  <div class="tabs">
    {#if pinnedTabs.length}
      <div class="section-label">Pinned</div>
      {#each pinnedTabs as tab (tab.id)}
        {@render TabRow(tab, true)}
      {/each}
      <div class="divider"></div>
    {/if}
    {#each visibleTabs as tab (tab.id)}
      {@render TabRow(tab, false)}
    {/each}
  </div>

  <footer>
    <div class="space-name">{activeSpace?.name ?? ''}</div>
    <div class="spaces">
      {#each spaces as space (space.id)}
        <button class:active={space.id === activeSpaceId} class="space-dot" style:--dot={space.color} title={space.name} aria-label={`Switch to ${space.name}`} onclick={() => selectSpace(space.id)}></button>
      {/each}
      <Button subtle title="Create space" onclick={() => { addingSpace = !addingSpace }}>＋</Button>
    </div>
    {#if addingSpace}
      <form class="space-form" onsubmit={(event) => { event.preventDefault(); createSpace() }}>
        <input bind:value={newSpaceName} aria-label="Space name" placeholder="Space name" />
      </form>
    {/if}
  </footer>
</aside>

{#snippet TabRow(tab: LiveTab, pinned: boolean)}
  {@const active = tab.id === activeTabId}
  <SidebarItem {active} onclick={() => selectTab(tab.id)} onauxclick={(event) => event.button === 1 && closeTab(event, tab.id)}>
    <span class="favicon">
      {#if faviconUrl(tab)}<img src={faviconUrl(tab)} alt="" onerror={(event) => ((event.currentTarget as HTMLElement).style.display = 'none')} />{:else}◌{/if}
    </span>
    <span class="tab-title">{tab.title || tab.url}</span>
    <button class="row-action" title={pinned ? `Unpin ${tab.title}` : `Pin ${tab.title}`} aria-label={pinned ? `Unpin ${tab.title}` : `Pin ${tab.title}`} onclick={(event) => togglePin(event, tab.id, pinned)}>{pinned ? '○' : '◎'}</button>
    <button class="row-action close" aria-label={`Close ${tab.title}`} onclick={(event) => closeTab(event, tab.id)}>×</button>
  </SidebarItem>
{/snippet}

<style>
  aside {
    width: 100%; height: 100vh; display: flex; flex-direction: column; padding: 11px 9px 8px;
    background:
      linear-gradient(145deg, color-mix(in srgb, var(--space-color) 22%, transparent), transparent 58%),
      var(--shell);
    font-size: 13px;
  }
  .url {
    height: 34px; display: flex; align-items: center; gap: 7px; margin: 0 2px 10px;
    padding: 0 10px; border-radius: 17px; background: var(--surface-strong); border: 1px solid var(--line);
  }
  .url span { color: var(--muted); font-size: 16px; }
  .url input, .space-form input { min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; }
  .new-tab {
    display: flex; align-items: center; width: 100%; gap: 8px; padding: 7px 9px; border-radius: 9px;
    background: transparent; text-align: left; color: var(--muted); cursor: pointer;
  }
  .new-tab:hover { color: var(--text); background: var(--hover); }
  .tabs { flex: 1; min-height: 0; overflow-y: auto; padding-top: 4px; }
  .section-label { padding: 7px 8px 3px; color: var(--muted); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
  .divider { height: 1px; margin: 7px 8px; background: var(--line); }
  .favicon { width: 16px; height: 16px; display: grid; place-items: center; flex: 0 0 16px; color: var(--muted); font-size: 12px; }
  .favicon img { width: 16px; height: 16px; object-fit: contain; }
  .tab-title { min-width: 0; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row-action { width: 20px; height: 20px; padding: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; opacity: 0; }
  .row-action.close { font-size: 14px; line-height: 1; }
  :global([role='button']:hover) .row-action, .row-action:focus-visible { opacity: 1; }
  .row-action:hover { background: var(--hover); color: var(--text); }
  footer { position: relative; padding: 8px 2px 0; border-top: 1px solid var(--line); }
  .space-name { margin: 0 7px 6px; color: var(--muted); font-size: 11px; }
  .spaces { display: flex; align-items: center; gap: 7px; padding: 0 4px; }
  .space-dot { width: 12px; height: 12px; padding: 0; border-radius: 50%; background: var(--dot); opacity: 0.55; outline: 0 solid color-mix(in srgb, var(--dot) 40%, transparent); outline-offset: 2px; cursor: pointer; }
  .space-dot:hover { opacity: 0.82; }
  .space-dot.active { opacity: 1; outline-width: 2px; }
  .space-form { margin: 7px 3px 0; padding: 6px 8px; border-radius: 8px; background: var(--surface); }
</style>
