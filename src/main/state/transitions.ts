import type { AppState, BrowserCommand, Clock, Download, IdFactory, PermissionRecord, PermissionType, Space, Tab } from './types'
import { normalizeInternalUrl } from '../../shared/internal-url'

export interface TransitionDependencies {
  createId: IdFactory
  now: Clock
}

const DEFAULT_URL = 'https://www.google.com/'
const DOWNLOAD_LIMIT = 50

export function findRememberedPermission(state: AppState, profileId: string, origin: string, permission: PermissionType): boolean | undefined {
  return state.permissions.find((item) => item.profileId === profileId && item.origin === origin && item.permission === permission)?.allow
}

export function createDefaultState(dependencies: TransitionDependencies): AppState {
  const profileId = dependencies.createId()
  const spaceId = dependencies.createId()
  return {
    profiles: [{ id: profileId, name: 'Personal', color: '#8b7cf6' }],
    spaces: [{ id: spaceId, profileId, name: 'Home', color: '#8b7cf6', split: null }],
    tabs: [],
    downloads: [],
    permissions: [],
    activeSpaceId: spaceId,
    activeTabId: { [spaceId]: null }
  }
}

function normalizeUrl(raw: string): string {
  const input = raw.trim()
  if (!input) return DEFAULT_URL
  const internal = normalizeInternalUrl(input)
  if (internal !== input) return internal
  try {
    return new URL(input).toString()
  } catch {
    if (/^[^\s.]+(?:\s+[^\s]+)+$/.test(input)) {
      return `https://www.google.com/search?q=${encodeURIComponent(input)}`
    }
    try {
      return new URL(`https://${input}`).toString()
    } catch {
      return `https://www.google.com/search?q=${encodeURIComponent(input)}`
    }
  }
}

function withUpdatedTab(state: AppState, tabId: string, update: (tab: Tab) => Tab): AppState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId)
  if (index < 0) return state
  const tabs = state.tabs.slice()
  const tab = state.tabs[index]
  if (!tab) return state
  tabs[index] = update(tab)
  return { ...state, tabs }
}

export function transition(state: AppState, command: BrowserCommand, dependencies: TransitionDependencies): AppState {
  switch (command.type) {
    case 'createSpace': {
      const profile = state.profiles.find((item) => item.id === state.spaces.find((space) => space.id === state.activeSpaceId)?.profileId)
      if (!profile) return state
      const id = dependencies.createId()
      const space: Space = { id, profileId: profile.id, name: command.name.trim(), color: command.color, split: null }
      return { ...state, spaces: [...state.spaces, space], activeSpaceId: id, activeTabId: { ...state.activeTabId, [id]: null } }
    }
    case 'renameSpace': {
      if (!state.spaces.some((space) => space.id === command.spaceId)) return state
      return { ...state, spaces: state.spaces.map((space) => space.id === command.spaceId ? { ...space, name: command.name.trim() } : space) }
    }
    case 'setActiveSpace':
      return state.spaces.some((space) => space.id === command.spaceId) ? { ...state, activeSpaceId: command.spaceId } : state
    case 'openTab': {
      const spaceId = command.spaceId ?? state.activeSpaceId
      if (!state.spaces.some((space) => space.id === spaceId)) return state
      const url = normalizeUrl(command.url)
      const id = dependencies.createId()
      const tab: Tab = {
        id, spaceId, url, title: 'New Tab', faviconUrl: '', pinned: false, muted: false,
        lastActiveAt: dependencies.now(), nav: { entries: [{ url, title: 'New Tab' }], index: 0 }
      }
      return { ...state, tabs: [...state.tabs, tab], activeSpaceId: spaceId, activeTabId: { ...state.activeTabId, [spaceId]: id } }
    }
    case 'closeTab': {
      const closing = state.tabs.find((tab) => tab.id === command.tabId)
      if (!closing) return state
      const remaining = state.tabs.filter((tab) => tab.id !== closing.id)
      const candidates = remaining.filter((tab) => tab.spaceId === closing.spaceId)
      const closingSpace = state.spaces.find((space) => space.id === closing.spaceId)
      const splitSurvivor = closingSpace?.split?.panes.find((id) => id !== closing.id)
      const wasActive = state.activeTabId[closing.spaceId] === closing.id
      const activeTabId = wasActive
        ? { ...state.activeTabId, [closing.spaceId]: splitSurvivor ?? candidates.at(-1)?.id ?? null }
        : state.activeTabId
      const spaces = state.spaces.map((space) => {
        if (space.id !== closing.spaceId || !space.split?.panes.includes(closing.id)) return space
        const panes = space.split.panes.filter((id) => id !== closing.id)
        if (panes.length === 0) return { ...space, split: null }
        return { ...space, split: { panes: [panes[0] as string] as [string], focused: 0 as const } }
      })
      return { ...state, tabs: remaining, spaces, activeTabId }
    }
    case 'setActiveTab': {
      const tab = state.tabs.find((item) => item.id === command.tabId)
      if (!tab) return state
      const spaces = state.spaces.map((space) => {
        if (space.id !== tab.spaceId || !space.split) return space
        const existingIndex = space.split.panes.indexOf(tab.id)
        if (existingIndex >= 0) return { ...space, split: { ...space.split, focused: existingIndex as 0 | 1 } }
        const panes = space.split.panes.slice() as [string] | [string, string]
        panes[space.split.focused] = tab.id
        return { ...space, split: { ...space.split, panes } }
      })
      return {
        ...withUpdatedTab(state, tab.id, (item) => ({ ...item, lastActiveAt: dependencies.now() })),
        spaces,
        activeSpaceId: tab.spaceId,
        activeTabId: { ...state.activeTabId, [tab.spaceId]: tab.id }
      }
    }
    case 'pinTab':
      return withUpdatedTab(state, command.tabId, (tab) => ({ ...tab, pinned: true }))
    case 'unpinTab':
      return withUpdatedTab(state, command.tabId, (tab) => ({ ...tab, pinned: false }))
    case 'navigate': {
      const url = normalizeUrl(command.url)
      return withUpdatedTab(state, command.tabId, (tab) => ({
        ...tab, url, title: url, crashed: false, lastActiveAt: dependencies.now(),
        nav: { entries: [...tab.nav.entries.slice(0, tab.nav.index + 1), { url, title: url }], index: tab.nav.index + 1 }
      }))
    }
    case 'setSplit': {
      const space = state.spaces.find((item) => item.id === command.spaceId)
      const valid = space && command.tabIds.every((tabId) => state.tabs.some((tab) => tab.id === tabId && tab.spaceId === space.id))
      if (!valid || command.focused >= command.tabIds.length || new Set(command.tabIds).size !== command.tabIds.length) return state
      if (space.split?.focused === command.focused && space.split.panes.length === command.tabIds.length && space.split.panes.every((tabId, index) => tabId === command.tabIds[index])) return state
      return {
        ...state,
        spaces: state.spaces.map((item) => item.id === space.id ? { ...item, split: { panes: command.tabIds, focused: command.focused } } : item),
        activeTabId: { ...state.activeTabId, [space.id]: command.tabIds[command.focused] ?? null }
      }
    }
    case 'setSplitFocus': {
      const space = state.spaces.find((item) => item.id === command.spaceId)
      const tabId = space?.split?.panes[command.focused]
      if (!space?.split || !tabId || space.split.focused === command.focused) return state
      const split = { ...space.split, focused: command.focused }
      const activated = withUpdatedTab(state, tabId, (tab) => ({ ...tab, lastActiveAt: dependencies.now() }))
      return {
        ...activated,
        spaces: state.spaces.map((item) => item.id === space.id ? { ...item, split } : item),
        activeSpaceId: space.id,
        activeTabId: { ...state.activeTabId, [space.id]: tabId }
      }
    }
    case 'downloadEvent': {
      const incoming = command.download
      const existing = state.downloads.find((item) => item.id === incoming.id)
      const record: Download = existing ? { ...existing, ...incoming } : incoming
      const others = state.downloads.filter((item) => item.id !== incoming.id)
      const downloads = [record, ...others].slice(0, DOWNLOAD_LIMIT)
      return { ...state, downloads }
    }
    case 'rememberPermission': {
      const record: PermissionRecord = { profileId: command.profileId, origin: command.origin, permission: command.permission, allow: command.allow }
      const permissions = [
        ...state.permissions.filter((item) => item.profileId !== record.profileId || item.origin !== record.origin || item.permission !== record.permission),
        record
      ]
      return { ...state, permissions }
    }
    case 'tabEvent': {
      return withUpdatedTab(state, command.tabId, (tab) => {
        const event = command.event
        let nav = event.nav ?? tab.nav
        if (!event.nav && event.navEntry) {
          const entries = [...nav.entries.slice(0, nav.index + 1), event.navEntry]
          nav = { entries, index: entries.length - 1 }
        }
        return {
          ...tab,
          ...(event.title !== undefined ? { title: event.title } : {}),
          ...(event.faviconUrl !== undefined ? { faviconUrl: event.faviconUrl } : {}),
          ...(event.url !== undefined ? { url: event.url } : {}),
          ...(event.crashed !== undefined ? { crashed: event.crashed } : {}),
          nav
        }
      })
    }
  }
}
