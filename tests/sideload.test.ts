import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: (name: string) => `/mock-${name}` } }))

import { ensureSideloadedExtensions, type SideloadOperations } from '../src/main/engine/sideload'

interface MemoryFiles extends SideloadOperations {
  writes: Array<{ path: string; data: Uint8Array }>
  renames: Array<{ from: string; to: string }>
  rms: Array<{ path: string; options: { recursive: boolean; force: boolean } }>
  mkdirs: string[]
}

function memoryFiles(manifestExists = false): MemoryFiles {
  const writes: MemoryFiles['writes'] = []
  const renames: MemoryFiles['renames'] = []
  const rms: MemoryFiles['rms'] = []
  const mkdirs: string[] = []
  return {
    writes,
    renames,
    rms,
    mkdirs,
    async access(path) {
      if (!manifestExists) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      void path
    },
    async mkdir(path) {
      mkdirs.push(path)
    },
    async writeFile(path, data) {
      writes.push({ path, data })
    },
    async rename(from, to) {
      renames.push({ from, to })
    },
    async mkdtemp(prefix) {
      return `${prefix}tmp123`
    },
    async rm(path, options) {
      rms.push({ path, options })
    }
  }
}

const TEMP_ROOT = '/mock-temp/ublock-origin-tmp123'

function chromiumReleaseResponse(): Response {
  return new Response(JSON.stringify({
    assets: [
      { name: 'uBlock0_1.62.0.firefox.xpi', browser_download_url: 'https://github.com/firefox.xpi' },
      { name: 'uBlock0_1.62.0.chromium.zip', browser_download_url: 'https://github.com/uBlock0_1.62.0.chromium.zip' }
    ]
  }), { status: 200 })
}

describe('ensureSideloadedExtensions', () => {
  it('resolves without fetching when manifest.json already exists', async () => {
    const files = memoryFiles(true)
    const fetchMock = vi.fn<typeof fetch>()

    await expect(ensureSideloadedExtensions('/ext', { fetch: fetchMock, execFile: vi.fn(), files })).resolves.toBeUndefined()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(files.renames).toEqual([])
  })

  it('downloads the chromium zip, extracts it with unzip, and renames it into place', async () => {
    const files = memoryFiles()
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(chromiumReleaseResponse())
      .mockResolvedValueOnce(new Response(new Uint8Array([37, 80]), { status: 200 }))
    let unzipArgs: [string, string[]] | undefined

    await ensureSideloadedExtensions('/ext', {
      fetch: fetchMock,
      execFile: async (file, args) => { unzipArgs = [file, [...args]] },
      files
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]).toEqual(['https://api.github.com/repos/gorhill/uBlock/releases/latest'])
    expect(fetchMock.mock.calls[1]).toEqual(['https://github.com/uBlock0_1.62.0.chromium.zip'])
    expect(unzipArgs?.[0]).toBe('unzip')
    expect(unzipArgs?.[1]).toEqual(['-o', '-q', `${TEMP_ROOT}/uBlock0_1.62.0.chromium.zip`, '-d', TEMP_ROOT])
    expect(files.writes[0]?.path).toBe(`${TEMP_ROOT}/uBlock0_1.62.0.chromium.zip`)
    expect(files.mkdirs).toEqual(['/ext'])
    expect(files.renames).toEqual([{ from: `${TEMP_ROOT}/uBlock0.chromium`, to: '/ext/ublock-origin' }])
    expect(files.rms).toEqual([{ path: TEMP_ROOT, options: { recursive: true, force: true } }])
  })

  it('logs one warning and still resolves when the network fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const files = memoryFiles()
      const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'))

      await expect(ensureSideloadedExtensions('/ext', { fetch: fetchMock, execFile: vi.fn(), files })).resolves.toBeUndefined()

      expect(warn).toHaveBeenCalledOnce()
      expect(files.renames).toEqual([])
      expect(files.rms).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })
})
