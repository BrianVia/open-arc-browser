import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  appStateSchema,
  commandBarEventSchema,
  commandBarRequestSchema,
  findEventSchema,
  findQuerySchema,
  ipcCommandSchema,
  permissionDecisionSchema,
  permissionRequestEventSchema,
  type AppState,
  type BrowserApi,
  type CommandBarEvent,
  type CommandBarRequest,
  type FindEvent,
  type FindQuery,
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
  },
  onFindEvent(listener: (event: FindEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => listener(findEventSchema.parse(raw))
    ipcRenderer.on(IPC_CHANNELS.findEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.findEvent, handler)
  },
  sendFindQuery(query: FindQuery): void {
    ipcRenderer.send(IPC_CHANNELS.findQuery, findQuerySchema.parse(query))
  }
}

contextBridge.exposeInMainWorld('browser', api)
