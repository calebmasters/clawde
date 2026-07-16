import { uIOhook, UiohookKey } from 'uiohook-napi'
import { log as _log } from './logger'
import { createDoubleTapDetector } from './double-tap-detector'

function log(msg: string): void {
  _log('DoubleTap', msg)
}

// Left Option = 56, Right Option = 3640
const OPTION_KEYS = new Set<number>([UiohookKey.Alt, UiohookKey.AltRight])

export function registerOptionDoubleTap(onDoubleTap: () => void): void {
  const detector = createDoubleTapDetector({
    onDoubleTap,
    isTargetKey: (keycode) => OPTION_KEYS.has(keycode),
    // TAP_MAX_MS = 250, DOUBLE_TAP_GAP_MS = 400 (detector defaults)
  })

  uIOhook.on('keydown', (e) => detector.keydown(e.keycode))
  uIOhook.on('keyup', (e) => detector.keyup(e.keycode))

  try {
    uIOhook.start()
    log('Key hook started — double-tap Option to toggle')
  } catch (err) {
    log(`Key hook failed to start: ${(err as Error).message}`)
  }
}

export function stopOptionDoubleTap(): void {
  try {
    uIOhook.stop()
  } catch {}
}
