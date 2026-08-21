import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { nanoid } from 'nanoid'
import { EngineHost, type ViewInsets } from './engine/host'
import { wireIpc } from './ipc'
import { BrowserState, loadState, newDefaultState } from './state/store'

let browserState: BrowserState | undefined
let engine: EngineHost | undefined
let teardownIpc: (() => void) | undefined
let insets: ViewInsets = { sidebarWidth: 260, top: 36 }

async function createApplication(): Promise<void> {
  const statePath = join(app.getPath('userData'), 'state.json')
  const initial = await loadState(statePath, () => newDefaultState(nanoid, Date.now))
  browserState = new BrowserState({ path: statePath, initialState: initial })
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    titleBarStyle: 'hidden',
    frame: false,
    backgroundColor: '#15151a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  engine = new EngineHost(window, initial, (command) => browserState?.dispatch(command))
  teardownIpc = wireIpc(window, browserState, (nextInsets) => {
    insets = nextInsets
    engine?.sync(browserState?.snapshot ?? initial, insets)
  })
  browserState.subscribe((state) => engine?.sync(state, insets))
  window.on('resize', () => engine?.sync(browserState?.snapshot ?? initial, insets))
  window.on('closed', () => {
    teardownIpc?.()
    engine?.destroy()
    teardownIpc = undefined
    engine = undefined
  })

  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(createApplication)
app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (!browserState) return
  event.preventDefault()
  const state = browserState
  browserState = undefined
  void state.flush().finally(() => app.quit())
})
