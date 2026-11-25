import type { MaestriBridgeApi } from '../shared/ipc-contract'

declare global {
  interface Window {
    maestri: MaestriBridgeApi
  }
}

export {}
