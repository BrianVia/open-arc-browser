<script lang="ts">
  import Button from './Button.svelte'
</script>

<header>
  <div class="brand">Open Arc</div>
  <div class="controls">
    <Button subtle title="Minimize" onclick={() => window.browser.command({ type: 'windowControl', action: 'minimize' })}>−</Button>
    <Button subtle title="Maximize" onclick={() => window.browser.command({ type: 'windowControl', action: 'maximize' })}>□</Button>
    <Button subtle title="Close" onclick={() => window.browser.command({ type: 'windowControl', action: 'close' })}>×</Button>
  </div>
</header>

<style>
  header {
    position: fixed; inset: 0 0 auto 0; z-index: 2; height: 36px;
    display: flex; align-items: center; justify-content: space-between;
    padding-left: 12px; background: var(--shell); border-bottom: 1px solid var(--line);
    -webkit-app-region: drag; user-select: none;
  }
  .brand { color: var(--muted); font-size: 11px; font-weight: 650; letter-spacing: 0.02em; }
  .controls { display: flex; align-items: center; height: 100%; -webkit-app-region: no-drag; }
  .controls :global(button) { width: 38px; height: 100%; border-radius: 0; font-size: 12px; }
</style>
