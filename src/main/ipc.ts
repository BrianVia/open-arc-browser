import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS, browserCommandSchema, ipcCommandSchema, type AppState } from '../shared'
import type { BrowserState } from './state/store'

export function wireIpc(window: BrowserWindow, state: BrowserState, onInsets: (insets: { sidebarWidth: number; top: number }) => void): () => void {
  const onCommand = (event: Electron.IpcMainEvent, raw: unknown): void => {
    if (event.sender !== window.webContents) return
    const command = ipcCommandSchema.parse(raw)
    if (command.type === 'setInsets') {
      onInsets({ sidebarWidth: command.sidebarWidth, top: command.top })
      return
    }
    if (command.type === 'windowControl') {
      if (command.action === 'close') window.close()
      else if (command.action === 'minimize') window.minimize()
      else if (window.isMaximized()) window.unmaximize()
      else window.maximize()
      return
    }
    state.dispatch(browserCommandSchema.parse(command))
  }
  ipcMain.on(IPC_CHANNELS.command, onCommand)
  const unsubscribe = state.subscribe((snapshot: AppState) => {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.state, snapshot)
  })
  window.webContents.once('did-finish-load', () => window.webContents.send(IPC_CHANNELS.state, state.snapshot))
  return () => {
    unsubscribe()
    ipcMain.removeListener(IPC_CHANNELS.command, onCommand)
  }
}
