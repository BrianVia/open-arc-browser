import type { MenuItemConstructorOptions } from 'electron'

export interface ContextMenuParams {
  x: number
  y: number
  linkURL: string
  editFlags: { canCut?: boolean; canCopy?: boolean; canPaste?: boolean }
}

export interface ContextMenuTarget {
  navigationHistory: { canGoBack(): boolean; canGoForward(): boolean }
  goBack(): void
  goForward(): void
  reload(): void
  cut(): void
  copy(): void
  paste(): void
  inspectElement(x: number, y: number): void
}

export interface ContextMenuActions {
  copyText(text: string): void
  openLinkInNewTab(url: string): void
}

export function buildPageContextMenu(target: ContextMenuTarget, params: ContextMenuParams, actions: ContextMenuActions): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [
    { label: 'Back', enabled: target.navigationHistory.canGoBack(), click: () => target.goBack() },
    { label: 'Forward', enabled: target.navigationHistory.canGoForward(), click: () => target.goForward() },
    { label: 'Reload', click: () => target.reload() },
    { type: 'separator' },
    { label: 'Cut', enabled: Boolean(params.editFlags.canCut), click: () => target.cut() },
    { label: 'Copy', enabled: Boolean(params.editFlags.canCopy), click: () => target.copy() },
    { label: 'Paste', enabled: Boolean(params.editFlags.canPaste), click: () => target.paste() }
  ]
  if (params.linkURL) {
    template.push(
      { type: 'separator' },
      { label: 'Copy Link Address', click: () => actions.copyText(params.linkURL) },
      { label: 'Open Link in New Tab', click: () => actions.openLinkInNewTab(params.linkURL) }
    )
  }
  template.push(
    { type: 'separator' },
    { label: 'Inspect Element', click: () => target.inspectElement(params.x, params.y) }
  )
  return template
}
