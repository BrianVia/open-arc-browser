import { BrowserWindow, ipcMain, shell, type WebContents } from 'electron'
import { IPC_CHANNELS, browserCommandSchema, commandBarRequestSchema, extensionsEventSchema, extensionsQuerySchema, findQuerySchema, ipcCommandSchema, permissionDecisionSchema, type AppState, type ExtensionsEvent, type ExtensionsQuery, type FindQuery, type PermissionDecision } from '../shared'
import type { BrowserState } from './state/store'

export interface IpcWindows {
  shell: BrowserWindow
  commandBar: { readonly webContents: WebContents }
}

export function wireIpc(
  windows: IpcWindows,
  state: BrowserState,
  onInsets: (insets: { sidebarWidth: number; top: number }) => void,
  hideCommandBar: () => void,
  onPermissionDecision: (decision: PermissionDecision) => void,
  onFindQuery: (query: FindQuery) => void,
  onExtensionsQuery: (query: ExtensionsQuery) => Promise<ExtensionsEvent>
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
    if (command.type === 'showItemInFolder') {
      shell.showItemInFolder(command.path)
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

  const sendState = (target: { readonly webContents: WebContents }, snapshot: AppState): void => {
    if (!target.webContents.isDestroyed()) target.webContents.send(IPC_CHANNELS.state, snapshot)
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

  const onPermissionDecisionEvent = (event: Electron.IpcMainEvent, raw: unknown): void => {
    if (event.sender !== windows.shell.webContents) return
    onPermissionDecision(permissionDecisionSchema.parse(raw))
  }
  ipcMain.on(IPC_CHANNELS.permissionDecision, onPermissionDecisionEvent)

  const onFindQueryEvent = (event: Electron.IpcMainEvent, raw: unknown): void => {
    if (event.sender !== windows.shell.webContents) return
    onFindQuery(findQuerySchema.parse(raw))
  }
  ipcMain.on(IPC_CHANNELS.findQuery, onFindQueryEvent)

  const onExtensionsQueryEvent = (event: Electron.IpcMainEvent, raw: unknown): void => {
    if (event.sender !== windows.shell.webContents) return
    const query = extensionsQuerySchema.parse(raw)
    void onExtensionsQuery(query).then((result) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.extensionsEvent, extensionsEventSchema.parse(result))
    }).catch((error) => console.error('Extensions query failed', error))
  }
  ipcMain.on(IPC_CHANNELS.extensionsQuery, onExtensionsQueryEvent)

  windows.shell.webContents.once('did-finish-load', () => sendState(windows.shell, state.snapshot))
  windows.commandBar.webContents.once('did-finish-load', () => sendState(windows.commandBar, state.snapshot))
  return () => {
    unsubscribe()
    ipcMain.removeListener(IPC_CHANNELS.command, onCommand)
    ipcMain.removeListener(IPC_CHANNELS.commandBarRequest, onCommandBarRequest)
    ipcMain.removeListener(IPC_CHANNELS.permissionDecision, onPermissionDecisionEvent)
    ipcMain.removeListener(IPC_CHANNELS.findQuery, onFindQueryEvent)
    ipcMain.removeListener(IPC_CHANNELS.extensionsQuery, onExtensionsQueryEvent)
  }
}
