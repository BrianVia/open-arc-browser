import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

const entry = (path: string): string => new URL(path, import.meta.url).pathname

export default defineConfig({
  plugins: [svelte()],
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        sidebar: entry('./sidebar.html'),
        newtab: entry('./newtab.html'),
        background: entry('./src/background.ts')
      },
      output: {
        // The MV3 service worker must live at a fixed manifest path; pages may keep hashed assets.
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js')
      }
    }
  }
})
