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
export const downloadStateSchema = z.enum(['progressing', 'done', 'failed', 'cancelled'])
export const downloadSchema = z.object({
  id,
  tabId: id.nullable(),
  url: z.string(),
  filename: z.string(),
  savePath: z.string(),
  state: downloadStateSchema,
  receivedBytes: z.number().int().min(0),
  totalBytes: z.number().int().min(0),
  startedAt: z.number()
})
export const permissionTypeSchema = z.enum(['notifications', 'geolocation', 'media', 'clipboard-read', 'pointerLock'])
export const permissionRecordSchema = z.object({
  profileId: id,
  origin: z.string().min(1),
  permission: permissionTypeSchema,
  allow: z.boolean()
})
export const appStateSchema = z.object({
  profiles: z.array(profileSchema),
  spaces: z.array(spaceSchema),
  tabs: z.array(tabSchema),
  downloads: z.array(downloadSchema).default([]),
  permissions: z.array(permissionRecordSchema).default([]),
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
  z.object({ type: z.literal('tabEvent'), tabId: id, event: tabEventSchema }),
  z.object({ type: z.literal('downloadEvent'), download: downloadSchema }),
  z.object({ type: z.literal('rememberPermission'), profileId: id, origin: z.string().min(1), permission: permissionTypeSchema, allow: z.boolean() })
])

export const shellCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('windowControl'),
    action: z.enum(['minimize', 'maximize', 'close'])
  }),
  z.object({ type: z.literal('showItemInFolder'), path: z.string().min(1) })
])
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

export const permissionRequestEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('request'), id, origin: z.string().min(1), permission: permissionTypeSchema }),
  z.object({ type: z.literal('closed'), id })
])
export const permissionDecisionSchema = z.object({ id, allow: z.boolean(), remember: z.boolean() })

export const findEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('toggle') }),
  z.object({ type: z.literal('matches'), activeMatchOrdinal: z.number().int().min(0), matches: z.number().int().min(0) })
])
export const findQuerySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('search'), text: z.string(), forward: z.boolean(), findNext: z.boolean() }),
  z.object({ type: z.literal('close') })
])

export type Profile = z.infer<typeof profileSchema>
export type Split = z.infer<typeof splitSchema>
export type Space = z.infer<typeof spaceSchema>
export type Tab = z.infer<typeof tabSchema>
export type Download = z.infer<typeof downloadSchema>
export type PermissionType = z.infer<typeof permissionTypeSchema>
export type PermissionRecord = z.infer<typeof permissionRecordSchema>
export type AppState = z.infer<typeof appStateSchema>
export type PersistedState = z.infer<typeof persistedStateSchema>
export type BrowserCommand = z.infer<typeof browserCommandSchema>
export type IpcCommand = z.infer<typeof ipcCommandSchema>
export type CommandBarIntent = z.infer<typeof commandBarIntentSchema>
export type CommandBarRequest = z.infer<typeof commandBarRequestSchema>
export type CommandBarEvent = z.infer<typeof commandBarEventSchema>
export type PermissionRequestEvent = z.infer<typeof permissionRequestEventSchema>
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>
export type FindEvent = z.infer<typeof findEventSchema>
export type FindQuery = z.infer<typeof findQuerySchema>

export const IPC_CHANNELS = {
  command: 'command',
  state: 'state',
  commandBarRequest: 'commandbar:request',
  commandBarEvent: 'commandbar:event',
  permissionRequest: 'permission:request',
  permissionDecision: 'permission:decision',
  findEvent: 'find:event',
  findQuery: 'find:query'
} as const

export interface BrowserApi {
  command(command: IpcCommand): void
  subscribe(listener: (state: AppState) => void): () => void
  requestCommandBar(request: CommandBarRequest): void
  onCommandBarEvent(listener: (event: CommandBarEvent) => void): () => void
  onPermissionRequest(listener: (event: PermissionRequestEvent) => void): () => void
  answerPermission(decision: PermissionDecision): void
  onFindEvent(listener: (event: FindEvent) => void): () => void
  sendFindQuery(query: FindQuery): void
}
