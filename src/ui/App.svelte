<script lang="ts">
  import type { AppState, Download, ExtensionInfo, PermissionRequestEvent, Tab } from '../shared'
  import Button from './foundation/Button.svelte'
  import SidebarItem from './foundation/SidebarItem.svelte'
  import WindowShell from './foundation/WindowShell.svelte'

  const colors = ['#8b7cf6', '#ee7c94', '#58a6a6', '#e0a85a', '#769bd8', '#aa79b7']
  let appState = $state<AppState | null>(null)
  let urlInput = $state('')
  let addingSpace = $state(false)
  let newSpaceName = $state('')
  let openingNewTab = $state(false)
  let urlField: HTMLInputElement
  let permissionPrompts = $state<PermissionRequestEvent[]>([])
  let rememberChoices = $state<Record<string, boolean>>({})
  let findOpen = $state(false)
  let findText = $state('')
  let findOrdinal = $state(0)
  let findTotal = $state(0)
  let findField: HTMLInputElement | undefined = $state()
  let extensionsOpen = $state(false)
  let extensions = $state<ExtensionInfo[]>([])

  const activeSpace = $derived(appState?.spaces.find((space) => space.id === appState?.activeSpaceId))
  const activeTab = $derived(appState?.tabs.find((tab) => tab.id === appState?.activeTabId[appState.activeSpaceId]))
  const visibleTabs = $derived((appState?.tabs.filter((tab) => tab.spaceId === appState?.activeSpaceId) ?? []).slice().reverse().sort((a, b) => b.lastActiveAt - a.lastActiveAt))
  const activeSplit = $derived(activeSpace?.split?.panes.length === 2 ? activeSpace.split : null)
  const pinnedTabs = $derived(visibleTabs.filter((tab) => tab.pinned))
  const regularTabs = $derived(visibleTabs.filter((tab) => !tab.pinned))
  const visibleDownloads = $derived((appState?.downloads ?? []).filter((download) => Date.now() - download.startedAt < 86_400_000))
  const activeProfileId = $derived(activeSpace?.profileId)

  $effect(() => {
    if (activeTab) urlInput = activeTab.url
    else urlInput = ''
  })

  $effect(() => {
    if (findOpen) findField?.focus()
  })

  $effect(() => {
    if (extensionsOpen && activeProfileId) {
      extensions = []
      window.browser.sendExtensionsQuery({ type: 'list' })
    }
  })

  $effect(() => {
    window.browser.command({ type: 'setInsets', sidebarWidth: 260, top: 36 })
    const unsubscribeState = window.browser.subscribe((next) => { appState = next })
    const unsubscribePermissions = window.browser.onPermissionRequest((event) => {
      if (event.type === 'request') {
        rememberChoices[event.id] = false
        permissionPrompts = [...permissionPrompts.filter((item) => item.id !== event.id), event]
      } else {
        permissionPrompts = permissionPrompts.filter((item) => item.id !== event.id)
        delete rememberChoices[event.id]
      }
    })
    const unsubscribeFind = window.browser.onFindEvent((event) => {
      if (event.type === 'toggle') {
        findOpen = !findOpen
        findText = ''
        findOrdinal = 0
        findTotal = 0
      } else {
        findOrdinal = event.activeMatchOrdinal
        findTotal = event.matches
      }
    })
    const unsubscribeExtensions = window.browser.onExtensionsEvent((event) => {
      if (event.profileId === activeProfileId) extensions = event.extensions
    })
    return () => {
      unsubscribeState()
      unsubscribePermissions()
      unsubscribeFind()
      unsubscribeExtensions()
    }
  })

  function submitUrl(): void {
    const input = urlInput.trim()
    if (!input) return
    // chrome:// pages don't exist in Electron; the extensions one maps to our
    // own management panel instead of a dead tab.
    if (/^chrome:\/\/extensions\/?$/i.test(input)) {
      extensionsOpen = true
      urlInput = activeTab?.url ?? ''
      openingNewTab = false
      return
    }
    if (activeTab && !openingNewTab) window.browser.command({ type: 'navigate', tabId: activeTab.id, url: input })
    else window.browser.command({ type: 'openTab', url: input })
    openingNewTab = false
  }

  function selectTab(tab: Tab): void {
    openingNewTab = false
    if (tab.crashed) window.browser.command({ type: 'navigate', tabId: tab.id, url: tab.url })
    const pane = activeSplit?.panes.indexOf(tab.id) ?? -1
    if (pane >= 0 && activeSpace) window.browser.command({ type: 'setSplitFocus', spaceId: activeSpace.id, focused: pane as 0 | 1 })
    else window.browser.command({ type: 'setActiveTab', tabId: tab.id })
  }

  function closeTab(event: MouseEvent, tabId: string): void {
    event.stopPropagation()
    window.browser.command({ type: 'closeTab', tabId })
  }

  function splitWith(event: MouseEvent, tabId: string): void {
    event.stopPropagation()
    if (!activeSpace || !activeTab || activeSplit || tabId === activeTab.id) return
    window.browser.command({ type: 'setSplit', spaceId: activeSpace.id, tabIds: [activeTab.id, tabId], focused: 0 })
  }

  function unsplit(event: MouseEvent): void {
    event.stopPropagation()
    if (!activeSpace || !activeSplit) return
    const focusedTabId = activeSplit.panes[activeSplit.focused]
    if (!focusedTabId) return
    window.browser.command({ type: 'setSplit', spaceId: activeSpace.id, tabIds: [focusedTabId], focused: 0 })
  }

  function createSpace(): void {
    const name = newSpaceName.trim()
    if (!name) return
    const color = colors[Math.floor(Math.random() * colors.length)] ?? colors[0]!
    window.browser.command({ type: 'createSpace', name, color })
    newSpaceName = ''
    addingSpace = false
  }

  function revealDownload(download: Download): void {
    window.browser.command({ type: 'showItemInFolder', path: download.savePath })
  }

  const permissionLabels: Record<Extract<PermissionRequestEvent, { type: 'request' }>['permission'], string> = {
    notifications: 'show notifications',
    geolocation: 'know your location',
    media: 'use your camera and microphone',
    'clipboard-read': 'read copied text',
    pointerLock: 'lock your pointer'
  }

  function answerPermission(prompt: Extract<PermissionRequestEvent, { type: 'request' }>, allow: boolean): void {
    window.browser.answerPermission({ id: prompt.id, allow, remember: rememberChoices[prompt.id] ?? false })
    permissionPrompts = permissionPrompts.filter((item) => item.id !== prompt.id)
    delete rememberChoices[prompt.id]
  }

  function runFind(findNext: boolean, forward = true): void {
    window.browser.sendFindQuery({ type: 'search', text: findText, forward, findNext })
  }

  function closeFind(): void {
    findOpen = false
    findText = ''
    findOrdinal = 0
    findTotal = 0
    window.browser.sendFindQuery({ type: 'close' })
  }

  function toggleExtensions(): void {
    extensionsOpen = !extensionsOpen
  }

  function setExtensionEnabled(extension: ExtensionInfo, enabled: boolean): void {
    window.browser.sendExtensionsQuery({ type: 'setEnabled', id: extension.id, enabled })
  }

  function uninstallExtension(extension: ExtensionInfo): void {
    window.browser.sendExtensionsQuery({ type: 'uninstall', id: extension.id })
  }
</script>

<WindowShell />

<aside style:--space-color={activeSpace?.color ?? '#8b7cf6'}>
  <form class="url" onsubmit={(event) => { event.preventDefault(); submitUrl() }}>
    <span aria-hidden="true">⌕</span>
    <input bind:this={urlField} bind:value={urlInput} aria-label="URL or search" placeholder="Search or enter URL" />
  </form>

  {#if activeProfileId}
    <div class="browser-actions" aria-label="Extension actions">
      {#key activeProfileId}
        <browser-action-list partition={`persist:profile-${activeProfileId}`} alignment="bottom left"></browser-action-list>
      {/key}
    </div>
  {/if}

  {#each permissionPrompts as prompt (prompt.id)}
    {#if prompt.type === 'request'}
      <div class="permission" role="alert">
        <span class="permission-text"><strong>{prompt.origin}</strong> wants to {permissionLabels[prompt.permission]}.</span>
        <div class="permission-actions">
          <label class="permission-remember">
            <input type="checkbox" bind:checked={rememberChoices[prompt.id]} /> Remember
          </label>
          <button class="permission-button" onclick={() => answerPermission(prompt, false)}>Block</button>
          <button class="permission-button allow" onclick={() => answerPermission(prompt, true)}>Allow</button>
        </div>
      </div>
    {/if}
  {/each}

  {#if findOpen}
    <form class="find" onsubmit={(event) => event.preventDefault()}>
      <input
        bind:this={findField}
        bind:value={findText}
        aria-label="Find in page"
        placeholder="Find in page"
        oninput={() => runFind(true)}
        onkeydown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); runFind(false, !event.shiftKey) }
          else if (event.key === 'Escape') closeFind()
        }}
      />
      <span class="find-count">{findTotal > 0 ? `${findOrdinal}/${findTotal}` : ''}</span>
    </form>
  {/if}

  <button class="new-tab" onclick={() => { openingNewTab = true; urlInput = ''; urlField.focus() }}><span>＋</span> New Tab</button>

  <div class="tabs">
    {#if pinnedTabs.length}
      <div class="section-label">Pinned</div>
      {#each pinnedTabs as tab (tab.id)}
        {@render TabRow(tab, selectTab, closeTab, splitWith, unsplit)}
      {/each}
      <div class="divider"></div>
    {/if}
    {#each regularTabs as tab (tab.id)}
      {@render TabRow(tab, selectTab, closeTab, splitWith, unsplit)}
    {/each}
  </div>

  {#if visibleDownloads.length}
    <div class="downloads" aria-label="Downloads">
      {#each visibleDownloads as download (download.id)}
        <button class="download" title={`Show ${download.filename} in folder`} onclick={() => revealDownload(download)}>
          <span class="download-name">{download.filename}</span>
          {#if download.state === 'progressing'}
            <span class="download-bar"><span class="download-fill" style:width={`${download.totalBytes > 0 ? Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100)) : 0}%`}></span></span>
          {:else}
            <span class="download-state" class:failed={download.state !== 'done'}>{download.state}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <footer>
    {#if extensionsOpen}
      <section class="extensions-panel" aria-label="Extensions">
        <div class="extensions-heading">Extensions</div>
        {#if extensions.length === 0}
          <p class="extensions-empty">No extensions installed</p>
        {:else}
          {#each extensions as extension (extension.id)}
            <div class="extension-row">
              <span class="extension-icon">
                {#if extension.icon}<img src={extension.icon} alt="" />{:else}{extension.name.slice(0, 1).toUpperCase()}{/if}
              </span>
              <span class="extension-copy">
                <strong>{extension.name}</strong>
                <small>v{extension.version}</small>
              </span>
              <label class="extension-toggle" title={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`}>
                <input type="checkbox" checked={extension.enabled} onchange={(event) => setExtensionEnabled(extension, event.currentTarget.checked)} />
                <span></span>
              </label>
              <button class="extension-remove" title={`Uninstall ${extension.name}`} aria-label={`Uninstall ${extension.name}`} onclick={() => uninstallExtension(extension)}>×</button>
            </div>
          {/each}
        {/if}
      </section>
    {/if}
    <div class="space-name">{activeSpace?.name ?? ''}</div>
    <div class="spaces">
      {#each appState?.spaces ?? [] as space (space.id)}
        <button class:active={space.id === appState?.activeSpaceId} class="space-dot" style:--dot={space.color} title={space.name} aria-label={`Switch to ${space.name}`} onclick={() => window.browser.command({ type: 'setActiveSpace', spaceId: space.id })}></button>
      {/each}
      <Button subtle title="Extensions" onclick={toggleExtensions}>🧩</Button>
      <Button subtle title="Create space" onclick={() => { addingSpace = !addingSpace }}>＋</Button>
    </div>
    {#if addingSpace}
      <form class="space-form" onsubmit={(event) => { event.preventDefault(); createSpace() }}>
        <input bind:value={newSpaceName} aria-label="Space name" placeholder="Space name" />
      </form>
    {/if}
  </footer>
</aside>

<main>
  {#if appState && visibleTabs.length === 0}
    <div class="empty"><span>⌁</span><p>This space is ready for a new tab.</p></div>
  {/if}
</main>

{#snippet TabRow(tab: Tab, selectTab: (tab: Tab) => void, closeTab: (event: MouseEvent, tabId: string) => void, splitWith: (event: MouseEvent, tabId: string) => void, unsplit: (event: MouseEvent) => void)}
  {@const splitIndex = activeSplit?.panes.indexOf(tab.id) ?? -1}
  {@const active = splitIndex >= 0 ? splitIndex === activeSplit?.focused : tab.id === activeTab?.id}
  {@const secondary = splitIndex >= 0 && splitIndex !== activeSplit?.focused}
  <SidebarItem {active} {secondary} onclick={() => selectTab(tab)} onauxclick={(event) => event.button === 1 && closeTab(event, tab.id)}>
    <span class="favicon">
      {#if tab.faviconUrl}<img src={tab.faviconUrl} alt="" />{:else}{tab.crashed ? '!' : '◌'}{/if}
    </span>
    <span class:crashed={tab.crashed} class="tab-title">{tab.crashed ? `Reload ${tab.title}` : tab.title}</span>
    {#if secondary}
      <button class="row-action unsplit" title="Exit split view" aria-label="Exit split view" onclick={unsplit}>×</button>
    {:else}
      {#if !activeSplit && tab.id !== activeTab?.id}
        <button class="row-action split" title={`Split with ${tab.title}`} aria-label={`Split with ${tab.title}`} onclick={(event) => splitWith(event, tab.id)}>◫</button>
      {/if}
      <button class="row-action close" aria-label={`Close ${tab.title}`} onclick={(event) => closeTab(event, tab.id)}>×</button>
    {/if}
  </SidebarItem>
{/snippet}

<style>
  aside {
    position: fixed; top: 36px; bottom: 0; left: 0; width: 260px; z-index: 1;
    display: flex; flex-direction: column; padding: 11px 9px 8px;
    background:
      linear-gradient(145deg, color-mix(in srgb, var(--space-color) 22%, transparent), transparent 58%),
      var(--shell);
    border-right: 1px solid var(--line); font-size: 13px;
  }
  .url {
    height: 34px; display: flex; align-items: center; gap: 7px; margin: 0 2px 10px;
    padding: 0 10px; border-radius: 17px; background: var(--surface-strong); border: 1px solid var(--line);
  }
  .browser-actions { min-height: 0; display: flex; justify-content: flex-end; margin: 0 3px 6px; }
  browser-action-list { --browser-action-hover-bg: var(--hover); }
  browser-action-list::part(action) { width: 26px; height: 26px; border-radius: 7px; }
  .url span { color: var(--muted); font-size: 16px; }
  .url input, .space-form input { min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; }
  .find {
    height: 30px; display: flex; align-items: center; gap: 7px; margin: -4px 2px 10px;
    padding: 0 10px; border-radius: 15px; background: var(--surface-strong); border: 1px solid var(--line);
  }
  .find input { min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; font-size: 12px; }
  .find-count { color: var(--muted); font-size: 11px; white-space: nowrap; }
  .permission {
    display: flex; flex-direction: column; gap: 8px; margin: 0 2px 10px;
    padding: 10px 11px; border-radius: 12px; background: var(--surface-strong); border: 1px solid var(--line);
  }
  .permission-text { font-size: 12px; line-height: 1.4; color: var(--text); overflow-wrap: anywhere; }
  .permission-text strong { font-weight: 600; }
  .permission-actions { display: flex; align-items: center; gap: 6px; }
  .permission-remember { display: flex; align-items: center; gap: 5px; margin-right: auto; color: var(--muted); font-size: 11px; cursor: pointer; }
  .permission-remember input { accent-color: var(--space-color); margin: 0; }
  .permission-button {
    padding: 4px 10px; border-radius: 8px; background: transparent; color: var(--muted);
    font-size: 12px; border: 1px solid var(--line); cursor: pointer;
  }
  .permission-button:hover { color: var(--text); background: var(--hover); }
  .permission-button.allow { color: var(--shell); background: var(--space-color); border-color: transparent; }
  .permission-button.allow:hover { filter: brightness(1.08); }
  .new-tab {
    display: flex; align-items: center; width: 100%; gap: 8px; padding: 7px 9px; border-radius: 9px;
    background: transparent; text-align: left; color: var(--muted);
  }
  .new-tab:hover { color: var(--text); background: var(--hover); }
  .tabs { flex: 1; min-height: 0; overflow-y: auto; padding-top: 4px; }
  .section-label { padding: 7px 8px 3px; color: var(--muted); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
  .divider { height: 1px; margin: 7px 8px; background: var(--line); }
  .favicon { width: 16px; height: 16px; display: grid; place-items: center; flex: 0 0 16px; color: var(--muted); font-size: 12px; }
  .favicon img { width: 16px; height: 16px; object-fit: contain; }
  .tab-title { min-width: 0; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tab-title.crashed { color: var(--danger); }
  .row-action { width: 20px; height: 20px; padding: 0; border-radius: 6px; background: transparent; color: var(--muted); opacity: 0; }
  :global([role='button']:hover) .row-action, .row-action:focus-visible, .unsplit { opacity: 1; }
  .row-action:hover { background: var(--hover); color: var(--text); }
  .split { font-size: 11px; }
  footer { position: relative; padding: 8px 2px 0; border-top: 1px solid var(--line); }
  .extensions-panel {
    position: absolute; left: 0; right: 0; bottom: calc(100% + 8px); max-height: 260px; overflow-y: auto;
    padding: 8px; border: 1px solid var(--line); border-radius: 13px;
    background: var(--surface-strong); box-shadow: 0 14px 36px rgba(20, 16, 28, 0.22); backdrop-filter: blur(18px);
  }
  .extensions-heading { padding: 2px 3px 7px; font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .extensions-empty { margin: 8px 3px; color: var(--muted); font-size: 12px; }
  .extension-row { display: flex; align-items: center; gap: 8px; padding: 7px 5px; border-radius: 9px; }
  .extension-row:hover { background: var(--hover); }
  .extension-icon { width: 24px; height: 24px; display: grid; place-items: center; flex: 0 0 24px; border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 11px; font-weight: 700; }
  .extension-icon img { width: 18px; height: 18px; object-fit: contain; }
  .extension-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .extension-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; }
  .extension-copy small { color: var(--muted); font-size: 10px; }
  .extension-toggle { position: relative; width: 28px; height: 16px; flex: 0 0 28px; cursor: pointer; }
  .extension-toggle input { position: absolute; opacity: 0; pointer-events: none; }
  .extension-toggle span { display: block; width: 100%; height: 100%; border-radius: 9px; background: var(--line); transition: background 0.15s ease; }
  .extension-toggle span::after { content: ''; display: block; width: 12px; height: 12px; margin: 2px; border-radius: 50%; background: var(--surface-strong); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); transition: transform 0.15s ease; }
  .extension-toggle input:checked + span { background: var(--space-color); }
  .extension-toggle input:checked + span::after { transform: translateX(12px); }
  .extension-toggle input:focus-visible + span { outline: 2px solid var(--space-color); outline-offset: 2px; }
  .extension-remove { width: 22px; height: 22px; padding: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; }
  .extension-remove:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
  .downloads { padding: 4px 0 2px; border-top: 1px solid var(--line); }
  .download { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 9px; border-radius: 9px; background: transparent; text-align: left; color: var(--muted); }
  .download:hover { color: var(--text); background: var(--hover); }
  .download-name { min-width: 0; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
  .download-bar { flex: 0 0 48px; height: 3px; border-radius: 2px; background: var(--line); overflow: hidden; }
  .download-fill { display: block; height: 100%; border-radius: 2px; background: var(--space-color); transition: width 0.25s ease; }
  .download-state { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.8; }
  .download-state.failed { color: var(--danger); }
  .space-name { margin: 0 7px 6px; color: var(--muted); font-size: 11px; }
  .spaces { display: flex; align-items: center; gap: 7px; padding: 0 4px; }
  .space-dot { width: 12px; height: 12px; padding: 0; border-radius: 50%; background: var(--dot); opacity: 0.55; outline: 0 solid color-mix(in srgb, var(--dot) 40%, transparent); outline-offset: 2px; }
  .space-dot:hover { opacity: 0.82; }
  .space-dot.active { opacity: 1; outline-width: 2px; }
  .space-form { margin: 7px 3px 0; padding: 6px 8px; border-radius: 8px; background: var(--surface); }
  main { position: fixed; inset: 36px 0 0 260px; background: var(--shell); }
  .empty { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; color: var(--muted); font-size: 13px; }
  .empty span { font-size: 30px; opacity: 0.5; }
  .empty p { margin: 8px 0; }
</style>
