export type {
  AppState,
  BrowserCommand,
  Download,
  PermissionRecord,
  PermissionType,
  PersistedState,
  Profile,
  Space,
  Split,
  Tab
} from '../../shared'

export type IdFactory = () => string
export type Clock = () => number
