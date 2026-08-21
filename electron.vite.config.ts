import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: 'src/main/index.ts' } }
  },
  preload: {
    build: { rollupOptions: { input: 'src/preload/index.ts' } }
  },
  renderer: {
    root: 'src/ui',
    plugins: [svelte({ configFile: '../../svelte.config.js' })],
    build: { rollupOptions: { input: 'src/ui/index.html' } }
  }
})
