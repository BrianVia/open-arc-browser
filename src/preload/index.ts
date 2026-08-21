import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, appStateSchema, ipcCommandSchema, type AppState, type BrowserApi, type IpcCommand } from '../shared'

const api: BrowserApi = {
  command(command: IpcCommand): void {
    ipcRenderer.send(IPC_CHANNELS.command, ipcCommandSchema.parse(command))
  },
  subscribe(listener: (state: AppState) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => listener(appStateSchema.parse(raw))
    ipcRenderer.on(IPC_CHANNELS.state, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.state, handler)
  }
}

contextBridge.exposeInMainWorld('browser', api)
