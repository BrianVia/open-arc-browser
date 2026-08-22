<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children, title, onclick, subtle = false }: {
    children: Snippet
    title?: string
    onclick?: (event: MouseEvent) => void
    subtle?: boolean
  } = $props()
</script>

<button class:subtle {title} {onclick}>{@render children()}</button>

<style>
  button {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 28px; height: 28px; padding: 0 8px; border-radius: 8px;
    background: var(--surface); cursor: default;
  }
  button:hover { background: var(--active); }
  button.subtle { background: transparent; }
  button.subtle:hover { background: var(--hover); }
</style>
