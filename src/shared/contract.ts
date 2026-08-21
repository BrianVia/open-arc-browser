import { z } from 'zod'

const id = z.string().min(1)
const color = z.string().min(1)

export const navEntrySchema = z.object({ url: z.string(), title: z.string() })
export const navigationSchema = z.object({
  entries: z.array(navEntrySchema),
  index: z.number().int().min(-1)
})

export const profileSchema = z.object({ id, name: z.string(), color })
export const splitSchema = z.object({
  panes: z.union([z.tuple([id]), z.tuple([id, id])]),
  focused: z.union([z.literal(0), z.literal(1)])
}).superRefine((split, context) => {
  if (split.focused >= split.panes.length) {
    context.addIssue({ code: 'custom', message: 'Focused pane must exist' })
  }
})
export const spaceSchema = z.object({
  id,
  profileId: id,
  name: z.string().min(1),
  color,
  split: splitSchema.nullable()
})
export const tabSchema = z.object({
  id,
  spaceId: id,
  url: z.string(),
  title: z.string(),
  faviconUrl: z.string(),
  pinned: z.boolean(),
  muted: z.boolean(),
  lastActiveAt: z.number(),
  nav: navigationSchema,
  crashed: z.boolean().optional()
})
export const appStateSchema = z.object({
  profiles: z.array(profileSchema),
  spaces: z.array(spaceSchema),
  tabs: z.array(tabSchema),
  activeSpaceId: id,
  activeTabId: z.record(id, id.nullable())
})
export const persistedStateSchema = appStateSchema.extend({ version: z.literal(1) })

const tabEventSchema = z.object({
  title: z.string().optional(),
  faviconUrl: z.string().optional(),
  url: z.string().optional(),
  navEntry: navEntrySchema.optional(),
  nav: navigationSchema.optional(),
  crashed: z.boolean().optional()
})

export const browserCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('createSpace'), name: z.string().trim().min(1), color }),
  z.object({ type: z.literal('renameSpace'), spaceId: id, name: z.string().trim().min(1) }),
  z.object({ type: z.literal('setActiveSpace'), spaceId: id }),
  z.object({ type: z.literal('openTab'), url: z.string(), spaceId: id.optional() }),
  z.object({ type: z.literal('closeTab'), tabId: id }),
  z.object({ type: z.literal('setActiveTab'), tabId: id }),
  z.object({ type: z.literal('pinTab'), tabId: id }),
  z.object({ type: z.literal('unpinTab'), tabId: id }),
  z.object({ type: z.literal('navigate'), tabId: id, url: z.string() }),
  z.object({ type: z.literal('setSplit'), spaceId: id, tabIds: z.union([z.tuple([id]), z.tuple([id, id])]), focused: z.union([z.literal(0), z.literal(1)]) }),
  z.object({ type: z.literal('setSplitFocus'), spaceId: id, focused: z.union([z.literal(0), z.literal(1)]) }),
  z.object({ type: z.literal('tabEvent'), tabId: id, event: tabEventSchema })
])

export const shellCommandSchema = z.object({
  type: z.literal('windowControl'),
  action: z.enum(['minimize', 'maximize', 'close'])
})
export const insetCommandSchema = z.object({
  type: z.literal('setInsets'),
  sidebarWidth: z.number().int().min(0),
  top: z.number().int().min(0)
})
export const ipcCommandSchema = z.union([browserCommandSchema, shellCommandSchema, insetCommandSchema])

export const commandBarIntentSchema = z.enum(['new-tab', 'edit-current-url'])
export const commandBarRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('query') }),
  z.object({ type: z.literal('hide') })
])
export const commandBarEventSchema = z.object({
  type: z.literal('show'),
  intent: commandBarIntentSchema
})

export type Profile = z.infer<typeof profileSchema>
export type Split = z.infer<typeof splitSchema>
export type Space = z.infer<typeof spaceSchema>
export type Tab = z.infer<typeof tabSchema>
export type AppState = z.infer<typeof appStateSchema>
export type PersistedState = z.infer<typeof persistedStateSchema>
export type BrowserCommand = z.infer<typeof browserCommandSchema>
export type IpcCommand = z.infer<typeof ipcCommandSchema>
export type CommandBarIntent = z.infer<typeof commandBarIntentSchema>
export type CommandBarRequest = z.infer<typeof commandBarRequestSchema>
export type CommandBarEvent = z.infer<typeof commandBarEventSchema>

export const IPC_CHANNELS = {
  command: 'command',
  state: 'state',
  commandBarRequest: 'commandbar:request',
  commandBarEvent: 'commandbar:event'
} as const

export interface BrowserApi {
  command(command: IpcCommand): void
  subscribe(listener: (state: AppState) => void): () => void
  requestCommandBar(request: CommandBarRequest): void
  onCommandBarEvent(listener: (event: CommandBarEvent) => void): () => void
}
