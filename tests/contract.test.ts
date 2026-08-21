import { describe, expect, it } from 'vitest'
import { appStateSchema, browserCommandSchema, commandBarEventSchema, commandBarRequestSchema, extensionsEventSchema, extensionsQuerySchema, ipcCommandSchema } from '../src/shared'
import { newDefaultState } from '../src/main/state/store'

describe('IPC contract', () => {
  it('round-trips full state snapshots', () => {
    const state = newDefaultState(() => 'stable', () => 1)
    expect(appStateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  it('accepts browser and shell commands and rejects malformed input', () => {
    expect(browserCommandSchema.parse({ type: 'openTab', url: 'example.com' })).toEqual({ type: 'openTab', url: 'example.com' })
    expect(ipcCommandSchema.parse({ type: 'windowControl', action: 'minimize' })).toEqual({ type: 'windowControl', action: 'minimize' })
    expect(browserCommandSchema.parse({ type: 'setSplitFocus', spaceId: 'space', focused: 1 })).toEqual({ type: 'setSplitFocus', spaceId: 'space', focused: 1 })
    expect(commandBarRequestSchema.parse({ type: 'query' })).toEqual({ type: 'query' })
    expect(commandBarEventSchema.parse({ type: 'show', intent: 'new-tab' })).toEqual({ type: 'show', intent: 'new-tab' })
    expect(() => ipcCommandSchema.parse({ type: 'closeTab' })).toThrow()
  })

  it('round-trips extension management queries and live session results', () => {
    expect(extensionsQuerySchema.parse({ type: 'setEnabled', id: 'dark-reader', enabled: false }))
      .toEqual({ type: 'setEnabled', id: 'dark-reader', enabled: false })
    expect(extensionsQuerySchema.parse({ type: 'uninstall', id: 'dark-reader' }))
      .toEqual({ type: 'uninstall', id: 'dark-reader' })
    const event = {
      type: 'list' as const,
      profileId: 'profile-a',
      extensions: [{ id: 'dark-reader', name: 'Dark Reader', version: '4.9.0', icon: null, enabled: true }]
    }
    expect(extensionsEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event)
  })
})
