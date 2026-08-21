import { BrowserWindow, WebContentsView, type WebContents } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS, type CommandBarEvent, type CommandBarIntent } from '../shared'

const WIDTH = 560
const HEIGHT = 430
const TOP_RATIO = 0.18

export class CommandBarHost {
  readonly view: WebContentsView
  readonly #parent: BrowserWindow
  #loaded = false
  #visible = false
  #pendingIntent: CommandBarIntent | undefined

  constructor(parent: BrowserWindow) {
    this.#parent = parent
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    this.view.setBackgroundColor('#00000000')
    this.view.webContents.on('did-finish-load', () => {
      this.#loaded = true
      if (this.#pendingIntent) this.#reveal(this.#pendingIntent)
    })
    this.view.webContents.on('blur', () => this.hide())
    parent.on('resize', () => this.#layout())
  }

  get webContents(): WebContents {
    return this.view.webContents
  }

  async load(rendererUrl: string | undefined): Promise<void> {
    if (rendererUrl) {
      const url = new URL(rendererUrl)
      url.searchParams.set('surface', 'commandbar')
      await this.view.webContents.loadURL(url.toString())
    } else {
      await this.view.webContents.loadFile(join(__dirname, '../renderer/index.html'), { query: { surface: 'commandbar' } })
    }
  }

  toggle(intent: CommandBarIntent): void {
    if (this.#visible) {
      this.hide()
      return
    }
    this.#pendingIntent = intent
    if (this.#loaded) this.#reveal(intent)
  }

  hide(): void {
    this.#pendingIntent = undefined
    if (!this.#visible || this.#parent.isDestroyed()) {
      this.#visible = false
      return
    }
    this.#visible = false
    this.#parent.contentView.removeChildView(this.view)
  }

  raise(): void {
    if (!this.#visible || this.#parent.isDestroyed()) return
    const { contentView } = this.#parent
    contentView.removeChildView(this.view)
    contentView.addChildView(this.view)
  }

  destroy(): void {
    this.hide()
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
    if (!this.#parent.isDestroyed()) this.#parent.contentView.removeChildView(this.view)
  }

  #reveal(intent: CommandBarIntent): void {
    this.#pendingIntent = undefined
    this.#layout()
    this.#visible = true
    this.raise()
    this.view.webContents.focus()
    const event: CommandBarEvent = { type: 'show', intent }
    this.view.webContents.send(IPC_CHANNELS.commandBarEvent, event)
  }

  #layout(): void {
    if (this.#parent.isDestroyed()) return
    const [contentWidth = 0, contentHeight = 0] = this.#parent.getContentSize()
    const width = Math.min(WIDTH, contentWidth)
    const height = Math.min(HEIGHT, contentHeight)
    this.view.setBounds({
      x: Math.round((contentWidth - width) / 2),
      y: Math.round(contentHeight * TOP_RATIO),
      width,
      height
    })
  }
}
