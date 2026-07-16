import type { ClodAPI } from '../preload/index'

declare global {
  interface Window {
    clod: ClodAPI
  }

  // Non-standard but present on macOS: usable screen area excluding the menu bar.
  interface Screen {
    availTop: number
    availLeft: number
  }
}
