import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS, type CommandBarEvent, type CommandBarIntent } from '../shared'

const WIDTH = 560
const HEIGHT = 430

export class CommandBarHost {
  readonly window: BrowserWindow
  readonly #parent: BrowserWindow
  #loaded = false
  #pendingIntent: CommandBarIntent | undefined

  constructor(parent: BrowserWindow) {
    this.#parent = parent
    this.window = new BrowserWindow({
      parent,
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      show: false,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    this.window.on('blur', () => this.hide())
    parent.on('move', () => this.#position())
    parent.on('resize', () => this.#position())
    this.window.webContents.on('did-finish-load', () => {
      this.#loaded = true
      if (this.#pendingIntent) this.#reveal(this.#pendingIntent)
    })
  }

  async load(rendererUrl: string | undefined): Promise<void> {
    if (rendererUrl) {
      const url = new URL(rendererUrl)
      url.searchParams.set('surface', 'commandbar')
      await this.window.loadURL(url.toString())
    } else {
      await this.window.loadFile(join(__dirname, '../renderer/index.html'), { query: { surface: 'commandbar' } })
    }
  }

  toggle(intent: CommandBarIntent): void {
    if (this.window.isVisible()) {
      this.hide()
      return
    }
    this.#pendingIntent = intent
    if (this.#loaded) this.#reveal(intent)
  }

  hide(): void {
    this.#pendingIntent = undefined
    if (!this.window.isDestroyed()) this.window.hide()
  }

  destroy(): void {
    if (!this.window.isDestroyed()) this.window.destroy()
  }

  #reveal(intent: CommandBarIntent): void {
    this.#pendingIntent = undefined
    this.#position()
    this.window.show()
    this.window.focus()
    const event: CommandBarEvent = { type: 'show', intent }
    this.window.webContents.send(IPC_CHANNELS.commandBarEvent, event)
  }

  #position(): void {
    if (this.window.isDestroyed()) return
    const parentBounds = this.#parent.getBounds()
    this.window.setPosition(
      parentBounds.x + Math.round((parentBounds.width - WIDTH) / 2),
      parentBounds.y + Math.round(parentBounds.height * 0.18)
    )
  }
}
