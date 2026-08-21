import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, type ExtensionsEvent, type ExtensionsQuery } from '../src/shared'
import { newDefaultState } from '../src/main/state/store'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => void>(),
  removed: [] as string[]
}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: {
    on(channel: string, handler: (...args: unknown[]) => void): void { ipc.handlers.set(channel, handler) },
    removeListener(channel: string): void { ipc.handlers.delete(channel); ipc.removed.push(channel) }
  },
  shell: { showItemInFolder: vi.fn() }
}))

import { wireIpc } from '../src/main/ipc'

beforeEach(() => {
  ipc.handlers.clear()
  ipc.removed.length = 0
})

describe('extensions IPC channel pair', () => {
  it('validates a shell query and sends the engine result back as an event', async () => {
    const sent: Array<{ channel: string; payload: unknown }> = []
    const shellContents = {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
      once: vi.fn()
    }
    const commandBarContents = { isDestroyed: () => false, send: vi.fn(), once: vi.fn() }
    const snapshot = newDefaultState(() => 'stable', () => 1)
    const state = {
      snapshot,
      dispatch: vi.fn(),
      subscribe: vi.fn(() => () => {})
    }
    const result: ExtensionsEvent = {
      type: 'list',
      profileId: snapshot.profiles[0]!.id,
      extensions: [{ id: 'dark-reader', name: 'Dark Reader', version: '4.9.0', icon: null, enabled: true }]
    }
    const onExtensionsQuery = vi.fn(async (_query: ExtensionsQuery) => result)
    const teardown = wireIpc(
      { shell: { webContents: shellContents } as never, commandBar: { webContents: commandBarContents } as never },
      state as never,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      onExtensionsQuery
    )

    const handler = ipc.handlers.get(IPC_CHANNELS.extensionsQuery)!
    handler({ sender: shellContents }, { type: 'list' })

    await vi.waitFor(() => expect(sent.at(-1)).toEqual({ channel: IPC_CHANNELS.extensionsEvent, payload: result }))
    expect(onExtensionsQuery).toHaveBeenCalledWith({ type: 'list' })

    teardown()
    expect(ipc.removed).toContain(IPC_CHANNELS.extensionsQuery)
  })
})
