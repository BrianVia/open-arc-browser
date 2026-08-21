export const ARC_EXTENSIONS_URL = 'arc://extensions'

const CHROME_EXTENSIONS_ALIAS = /^chrome:\/\/extensions\/?$/i
const INTERNAL_URL_PREFIX = /^arc:\/\//i

/** True for browser-owned pages rendered by our own renderer surfaces. */
export function isInternalUrl(url: string): boolean {
  return INTERNAL_URL_PREFIX.test(url)
}

/**
 * Maps Chrome's extensions page onto our internal surface (any case, optional
 * trailing slash); every other input passes through unchanged.
 */
export function normalizeInternalUrl(url: string): string {
  return CHROME_EXTENSIONS_ALIAS.test(url) ? ARC_EXTENSIONS_URL : url
}
