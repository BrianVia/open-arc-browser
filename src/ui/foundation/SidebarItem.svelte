<script lang="ts">
  import type { Snippet } from 'svelte'

  let { active = false, children, onclick, onauxclick }: {
    active?: boolean
    children: Snippet
    onclick?: (event: MouseEvent) => void
    onauxclick?: (event: MouseEvent) => void
  } = $props()
</script>

<div class:active role="button" tabindex="0" {onclick} {onauxclick} onkeydown={(event) => event.key === 'Enter' && onclick?.(event as unknown as MouseEvent)}>
  {@render children()}
</div>

<style>
  div {
    min-height: 34px; display: flex; align-items: center; gap: 9px;
    padding: 5px 8px; border-radius: 9px; color: var(--text); cursor: default;
  }
  div:hover { background: var(--hover); }
  div.active { background: var(--active); }
</style>
