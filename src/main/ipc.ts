import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS, browserCommandSchema, commandBarRequestSchema, ipcCommandSchema, type AppState } from '../shared'
import type { BrowserState } from './state/store'

export interface IpcWindows {
  shell: BrowserWindow
  commandBar: BrowserWindow
}

export function wireIpc(
  windows: IpcWindows,
  state: BrowserState,
  onInsets: (insets: { sidebarWidth: number; top: number }) => void,
  hideCommandBar: () => void
): () => void {
  const onCommand = (event: Electron.IpcMainEvent, raw: unknown): void => {
    const fromShell = event.sender === windows.shell.webContents
    const fromCommandBar = event.sender === windows.commandBar.webContents
    if (!fromShell && !fromCommandBar) return
    if (fromCommandBar) {
      state.dispatch(browserCommandSchema.parse(raw))
      return
    }
    const command = ipcCommandSchema.parse(raw)
    if (command.type === 'setInsets') {
      onInsets({ sidebarWidth: command.sidebarWidth, top: command.top })
      return
    }
    if (command.type === 'windowControl') {
      if (command.action === 'close') windows.shell.close()
      else if (command.action === 'minimize') windows.shell.minimize()
      else if (windows.shell.isMaximized()) windows.shell.unmaximize()
      else windows.shell.maximize()
      return
    }
    state.dispatch(browserCommandSchema.parse(command))
  }
  ipcMain.on(IPC_CHANNELS.command, onCommand)

  const sendState = (window: BrowserWindow, snapshot: AppState): void => {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.state, snapshot)
  }
  const unsubscribe = state.subscribe((snapshot: AppState) => {
    sendState(windows.shell, snapshot)
    sendState(windows.commandBar, snapshot)
  })

  const onCommandBarRequest = (event: Electron.IpcMainEvent, raw: unknown): void => {
    if (event.sender !== windows.commandBar.webContents) return
    const request = commandBarRequestSchema.parse(raw)
    if (request.type === 'hide') hideCommandBar()
    else sendState(windows.commandBar, state.snapshot)
  }
  ipcMain.on(IPC_CHANNELS.commandBarRequest, onCommandBarRequest)
  windows.shell.webContents.once('did-finish-load', () => sendState(windows.shell, state.snapshot))
  windows.commandBar.webContents.once('did-finish-load', () => sendState(windows.commandBar, state.snapshot))
  return () => {
    unsubscribe()
    ipcMain.removeListener(IPC_CHANNELS.command, onCommand)
    ipcMain.removeListener(IPC_CHANNELS.commandBarRequest, onCommandBarRequest)
  }
}
