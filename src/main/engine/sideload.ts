import { execFile as nodeExecFile } from 'node:child_process'
import { promises as nodeFs } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'

const RELEASE_API = 'https://api.github.com/repos/gorhill/uBlock/releases/latest'
const EXTRACTED_FOLDER = 'uBlock0.chromium'
const TARGET_FOLDER = 'ublock-origin'

type ExecFileFn = (file: string, args: string[]) => Promise<unknown>

/** Filesystem surface used by the sideloader — mirrors the store's FileOperations pattern. */
export interface SideloadOperations {
  access(path: string): Promise<void>
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  writeFile(path: string, data: Uint8Array): Promise<void>
  rename(from: string, to: string): Promise<void>
  mkdtemp(prefix: string): Promise<string>
  rm(path: string, options: { recursive: true; force: true }): Promise<void>
}

export interface SideloadDependencies {
  fetch?: typeof fetch
  execFile?: ExecFileFn
  files?: SideloadOperations
}

const defaultFiles: SideloadOperations = {
  access: (path) => nodeFs.access(path),
  mkdir: (path, options) => nodeFs.mkdir(path, options),
  writeFile: (path, data) => nodeFs.writeFile(path, data),
  rename: (from, to) => nodeFs.rename(from, to),
  mkdtemp: (prefix) => nodeFs.mkdtemp(prefix),
  rm: (path, options) => nodeFs.rm(path, options)
}

/**
 * Provisions uBlock Origin into `<extensionsDir>/ublock-origin/` from its
 * official GitHub releases (Chrome Web Store no longer distributes MV2).
 * Never throws: any failure is a single warning and startup proceeds; the
 * manifest guard makes the next launch retry.
 */
export async function ensureSideloadedExtensions(extensionsDir: string, dependencies: SideloadDependencies = {}): Promise<void> {
  try {
    await provision(extensionsDir, dependencies)
  } catch (error) {
    console.warn(`sideload: could not provision uBlock Origin (${error instanceof Error ? error.message : String(error)}); retrying on next launch`)
  }
}

async function provision(extensionsDir: string, dependencies: SideloadDependencies): Promise<void> {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  // ponytail: system `unzip` is Linux-first with a known ceiling; upgrade path
  // is a zip dependency when packaging for other platforms.
  const execFile = dependencies.execFile ?? promisify(nodeExecFile)
  const files = dependencies.files ?? defaultFiles
  const targetDir = join(extensionsDir, TARGET_FOLDER)
  try {
    await files.access(join(targetDir, 'manifest.json'))
    return
  } catch {
    // Not sideloaded yet — fall through to download.
  }

  const asset = await chromiumAsset(fetchImpl)
  const tempRoot = await files.mkdtemp(join(app.getPath('temp'), `${TARGET_FOLDER}-`))
  try {
    const zipPath = join(tempRoot, asset.name)
    const zipResponse = await fetchImpl(asset.url)
    if (!zipResponse.ok) throw new Error(`uBlock download responded ${zipResponse.status}`)
    await files.writeFile(zipPath, new Uint8Array(await zipResponse.arrayBuffer()))
    await execFile('unzip', ['-o', '-q', zipPath, '-d', tempRoot])
    await files.mkdir(extensionsDir, { recursive: true })
    await files.rename(join(tempRoot, EXTRACTED_FOLDER), targetDir)
  } finally {
    await files.rm(tempRoot, { recursive: true, force: true })
  }
}

/** Fetches the latest release and picks its `*.chromium.zip` asset. */
async function chromiumAsset(fetchImpl: typeof fetch): Promise<{ name: string; url: string }> {
  const response = await fetchImpl(RELEASE_API)
  if (!response.ok) throw new Error(`GitHub release API responded ${response.status}`)
  const payload = (await response.json()) as { assets?: Array<{ name?: unknown; browser_download_url?: unknown }> }
  for (const asset of payload.assets ?? []) {
    if (typeof asset.name === 'string' && asset.name.endsWith('.chromium.zip') && typeof asset.browser_download_url === 'string') {
      return { name: asset.name, url: asset.browser_download_url }
    }
  }
  throw new Error('latest uBlock release has no .chromium.zip asset')
}
