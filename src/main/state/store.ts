import { promises as nodeFs } from 'node:fs'
import { dirname } from 'node:path'
import { nanoid } from 'nanoid'
import { appStateSchema, browserCommandSchema, persistedStateSchema } from '../../shared'
import type { AppState, BrowserCommand, PersistedState } from './types'
import { createDefaultState, transition, type TransitionDependencies } from './transitions'

export interface FileOperations {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export async function atomicWriteJson(path: string, value: PersistedState, files: FileOperations = nodeFs): Promise<void> {
  await files.mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp`
  await files.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await files.rename(temporaryPath, path)
}

export async function loadState(path: string, fallback: () => AppState, files: FileOperations = nodeFs): Promise<AppState> {
  try {
    const stored = persistedStateSchema.parse(JSON.parse(await files.readFile(path, 'utf8')))
    const { version: _version, ...state } = stored
    return appStateSchema.parse(state)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return fallback()
    throw error
  }
}

export interface BrowserStateOptions {
  path: string
  initialState: AppState
  createId?: () => string
  now?: () => number
  files?: FileOperations
  debounceMs?: number
}

export class BrowserState {
  readonly #path: string
  readonly #files: FileOperations
  readonly #dependencies: TransitionDependencies
  readonly #debounceMs: number
  readonly #listeners = new Set<(state: AppState) => void>()
  #state: AppState
  #timer: ReturnType<typeof setTimeout> | undefined
  #write: Promise<void> = Promise.resolve()

  constructor(options: BrowserStateOptions) {
    this.#path = options.path
    this.#state = appStateSchema.parse(options.initialState)
    this.#files = options.files ?? nodeFs
    this.#dependencies = { createId: options.createId ?? nanoid, now: options.now ?? Date.now }
    this.#debounceMs = options.debounceMs ?? 500
  }

  get snapshot(): AppState { return structuredClone(this.#state) }

  dispatch(command: BrowserCommand): void {
    const validated = browserCommandSchema.parse(command)
    const next = transition(this.#state, validated, this.#dependencies)
    if (next === this.#state) return
    this.#state = appStateSchema.parse(next)
    for (const listener of this.#listeners) listener(this.snapshot)
    this.#scheduleWrite()
  }

  subscribe(listener: (state: AppState) => void): () => void {
    this.#listeners.add(listener)
    listener(this.snapshot)
    return () => this.#listeners.delete(listener)
  }

  async flush(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    await this.#persist()
  }

  #scheduleWrite(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.#persist()
    }, this.#debounceMs)
  }

  async #persist(): Promise<void> {
    const state = this.snapshot
    this.#write = this.#write.then(() => atomicWriteJson(this.#path, { version: 1, ...state }, this.#files))
    await this.#write
  }
}

export function newDefaultState(createId: () => string = nanoid, now: () => number = Date.now): AppState {
  return createDefaultState({ createId, now })
}
