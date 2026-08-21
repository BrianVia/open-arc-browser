import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  appStateSchema,
  commandBarEventSchema,
  commandBarRequestSchema,
  ipcCommandSchema,
  permissionDecisionSchema,
  permissionRequestEventSchema,
  type AppState,
  type BrowserApi,
  type CommandBarEvent,
  type CommandBarRequest,
  type IpcCommand,
  type PermissionDecision,
  type PermissionRequestEvent
} from '../shared'

const api: BrowserApi = {
  command(command: IpcCommand): void {
    ipcRenderer.send(IPC_CHANNELS.command, ipcCommandSchema.parse(command))
  },
  subscribe(listener: (state: AppState) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => listener(appStateSchema.parse(raw))
    ipcRenderer.on(IPC_CHANNELS.state, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.state, handler)
  },
  requestCommandBar(request: CommandBarRequest): void {
    ipcRenderer.send(IPC_CHANNELS.commandBarRequest, commandBarRequestSchema.parse(request))
  },
  onCommandBarEvent(listener: (event: CommandBarEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => listener(commandBarEventSchema.parse(raw))
    ipcRenderer.on(IPC_CHANNELS.commandBarEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.commandBarEvent, handler)
  },
  onPermissionRequest(listener: (event: PermissionRequestEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => listener(permissionRequestEventSchema.parse(raw))
    ipcRenderer.on(IPC_CHANNELS.permissionRequest, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.permissionRequest, handler)
  },
  answerPermission(decision: PermissionDecision): void {
    ipcRenderer.send(IPC_CHANNELS.permissionDecision, permissionDecisionSchema.parse(decision))
  }
}

contextBridge.exposeInMainWorld('browser', api)
