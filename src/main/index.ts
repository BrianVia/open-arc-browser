import { app, BrowserWindow } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { join } from 'node:path'
import { nanoid } from 'nanoid'
import { EngineHost, type ViewInsets } from './engine/host'
import { AcceleratorController, installApplicationMenu } from './accelerators'
import { CommandBarHost } from './command-bar'
import { wireIpc } from './ipc'
import { BrowserState, loadState, newDefaultState } from './state/store'

let browserState: BrowserState | undefined
let engine: EngineHost | undefined
let commandBar: CommandBarHost | undefined
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
  ElectronChromeExtensions.handleCRXProtocol(window.webContents.session)
  engine = new EngineHost(window, initial, (command) => browserState?.dispatch(command))
  commandBar = new CommandBarHost(window)
  const syncEngine = (): void => {
    engine?.sync(browserState?.snapshot ?? initial, insets)
    commandBar?.raise()
  }
  teardownIpc = wireIpc({ shell: window, commandBar }, browserState, (nextInsets) => {
    insets = nextInsets
    syncEngine()
  }, () => commandBar?.hide(), (decision) => engine?.answerPermission(decision.id, decision.allow, decision.remember), (query) => {
    if (query.type === 'close') engine?.closeFind()
    else engine?.findInPage(query.text, { forward: query.forward, findNext: query.findNext })
  }, async (query) => {
    if (!engine) throw new Error('Extension engine is unavailable')
    return engine.handleExtensionsQuery(query)
  })
  const accelerators = new AcceleratorController({
    snapshot: () => browserState?.snapshot ?? initial,
    dispatch: (command) => browserState?.dispatch(command),
    toggleCommandBar: (intent) => commandBar?.toggle(intent),
    reloadFocused: (hard) => engine?.reloadFocused(hard),
    toggleFindBar: () => engine?.toggleFindBar()
  })
  installApplicationMenu(accelerators)
  browserState.subscribe(() => syncEngine())
  window.on('resize', () => syncEngine())
  window.on('closed', () => {
    teardownIpc?.()
    engine?.destroy()
    commandBar?.destroy()
    teardownIpc = undefined
    engine = undefined
    commandBar = undefined
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  await Promise.all([
    rendererUrl ? window.loadURL(rendererUrl) : window.loadFile(join(__dirname, '../renderer/index.html')),
    commandBar.load(rendererUrl)
  ])
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
