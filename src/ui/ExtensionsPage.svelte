<script lang="ts">
  import type { AppState, ExtensionInfo } from '../shared'

  let appState = $state<AppState | null>(null)
  let extensions = $state<ExtensionInfo[]>([])

  const activeProfile = $derived.by(() => {
    const state = appState
    if (!state) return undefined
    const space = state.spaces.find((item) => item.id === state.activeSpaceId)
    return state.profiles.find((profile) => profile.id === space?.profileId)
  })

  $effect(() => {
    void activeProfile?.id
    window.browser.sendExtensionsQuery({ type: 'list' })
  })

  $effect(() => {
    const unsubscribeState = window.browser.subscribe((next) => { appState = next })
    const unsubscribeExtensions = window.browser.onExtensionsEvent((event) => {
      if (event.profileId === activeProfile?.id) extensions = event.extensions
    })
    return () => {
      unsubscribeState()
      unsubscribeExtensions()
    }
  })

  function setExtensionEnabled(extension: ExtensionInfo, enabled: boolean): void {
    window.browser.sendExtensionsQuery({ type: 'setEnabled', id: extension.id, enabled })
  }

  function uninstallExtension(extension: ExtensionInfo): void {
    window.browser.sendExtensionsQuery({ type: 'uninstall', id: extension.id })
  }
</script>

<div class="page">
  <div class="content">
    <header>
      <h1>Extensions</h1>
      {#if activeProfile}
        <p class="subtitle">{activeProfile.name}</p>
      {/if}
    </header>

    {#if extensions.length === 0}
      <div class="empty">
        <span aria-hidden="true">◌</span>
        <p class="empty-title">No extensions installed</p>
        <p class="empty-hint">Add extensions from chromewebstore.google.com and they will show up here.</p>
      </div>
    {:else}
      <ul class="list">
        {#each extensions as extension (extension.id)}
          <li class="row">
            <span class="icon">
              {#if extension.icon}<img src={extension.icon} alt="" />{:else}{extension.name.slice(0, 1).toUpperCase()}{/if}
            </span>
            <span class="copy">
              <strong>{extension.name}</strong>
              <small>Version {extension.version}</small>
            </span>
            <label class="toggle" title={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`}>
              <input type="checkbox" checked={extension.enabled} onchange={(event) => setExtensionEnabled(extension, event.currentTarget.checked)} />
              <span></span>
            </label>
            <button class="remove" title={`Uninstall ${extension.name}`} aria-label={`Uninstall ${extension.name}`} onclick={() => uninstallExtension(extension)}>×</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .page {
    width: 100%; height: 100%; overflow-y: auto;
    background:
      radial-gradient(1100px 480px at 18% -12%, color-mix(in srgb, var(--active) 55%, transparent), transparent 62%),
      var(--shell);
  }
  .content { max-width: 640px; margin: 0 auto; padding: 52px 32px 48px; }
  header { margin-bottom: 26px; }
  h1 { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.01em; color: var(--text); }
  .subtitle { margin: 6px 0 0; font-size: 13px; color: var(--muted); }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .row {
    display: flex; align-items: center; gap: 14px; padding: 13px 16px;
    border-radius: 13px; background: var(--surface-strong); border: 1px solid var(--line);
  }
  .row:hover { border-color: color-mix(in srgb, var(--text) 16%, var(--line)); }
  .icon {
    width: 36px; height: 36px; display: grid; place-items: center; flex: 0 0 36px;
    border-radius: 9px; background: var(--surface); border: 1px solid var(--line);
    color: var(--muted); font-size: 15px; font-weight: 700;
  }
  .icon img { width: 24px; height: 24px; object-fit: contain; }
  .copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; color: var(--text); }
  .copy small { color: var(--muted); font-size: 11.5px; }
  .toggle { position: relative; width: 34px; height: 20px; flex: 0 0 34px; cursor: pointer; }
  .toggle input { position: absolute; opacity: 0; pointer-events: none; }
  .toggle span { display: block; width: 100%; height: 100%; border-radius: 11px; background: var(--line); transition: background 0.15s ease; }
  .toggle span::after {
    content: ''; display: block; width: 14px; height: 14px; margin: 3px; border-radius: 50%;
    background: var(--surface-strong); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); transition: transform 0.15s ease;
  }
  .toggle input:checked + span { background: #8b7cf6; }
  .toggle input:checked + span::after { transform: translateX(14px); }
  .toggle input:focus-visible + span { outline: 2px solid #8b7cf6; outline-offset: 2px; }
  .remove {
    width: 30px; height: 30px; padding: 0; flex: 0 0 30px; border-radius: 8px;
    background: transparent; color: var(--muted); font-size: 16px; cursor: pointer;
  }
  .remove:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
  .empty {
    display: grid; place-content: center; justify-items: center; text-align: center;
    padding: 64px 24px; border: 1px dashed var(--line); border-radius: 16px;
  }
  .empty span { font-size: 32px; opacity: 0.5; }
  .empty-title { margin: 12px 0 4px; font-size: 15px; font-weight: 600; color: var(--text); }
  .empty-hint { margin: 0; max-width: 380px; font-size: 12.5px; line-height: 1.5; color: var(--muted); }
</style>
