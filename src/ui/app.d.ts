import type { BrowserApi } from '../shared'

declare global {
  interface Window { browser: BrowserApi }
}

export {}
