export type {
  AppState,
  BrowserCommand,
  PersistedState,
  Profile,
  Space,
  Split,
  Tab
} from '../../shared'

export type IdFactory = () => string
export type Clock = () => number
