import { contextBridge, ipcRenderer } from 'electron'
import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
import {
  IPC_CHANNELS,
  appStateSchema,
  commandBarEventSchema,
  commandBarRequestSchema,
  findEventSchema,
  findQuerySchema,
  extensionsEventSchema,
  extensionsQuerySchema,
  ipcCommandSchema,
  permissionDecisionSchema,
  permissionRequestEventSchema,
  type AppState,
  type BrowserApi,
  type CommandBarEvent,
  type CommandBarRequest,
  type FindEvent,
  type FindQuery,
  type ExtensionsEvent,
  type ExtensionsQuery,
  type IpcCommand,
  type PermissionDecision,
  type PermissionRequestEvent
} from '../shared'

// The bundled preload lets the library install its context-isolated custom
// element without exposing Node or disabling the renderer sandbox.
injectBrowserAction()

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
  },
  onExtensionsEvent(listener: (event: ExtensionsEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => listener(extensionsEventSchema.parse(raw))
    ipcRenderer.on(IPC_CHANNELS.extensionsEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.extensionsEvent, handler)
  },
  sendExtensionsQuery(query: ExtensionsQuery): void {
    ipcRenderer.send(IPC_CHANNELS.extensionsQuery, extensionsQuerySchema.parse(query))
  }
}

contextBridge.exposeInMainWorld('browser', api)
