import { uIOhook, UiohookKey } from 'uiohook-napi'
import { log as _log } from './logger'
import { createDoubleTapDetector } from './double-tap-detector'

function log(msg: string): void {
  _log('DoubleTap', msg)
}

/** Modifier keys that can be double-tapped to toggle the overlay. */
export type DoubleTapModifier = 'option' | 'command'

// Left Option = 56, Right Option = 3640, Left Command = 3675, Right Command = 3676
const MODIFIER_KEYS: Record<DoubleTapModifier, ReadonlySet<number>> = {
  option: new Set<number>([UiohookKey.Alt, UiohookKey.AltRight]),
  command: new Set<number>([UiohookKey.Meta, UiohookKey.MetaRight]),
}

/**
 * Watches every modifier in MODIFIER_KEYS and reports which one was double-tapped.
 * Callers decide whether to act on it — the hook stays on so the user can switch
 * modes without restarting the key hook.
 */
export function registerModifierDoubleTap(onDoubleTap: (mod: DoubleTapModifier) => void): void {
  // One detector per modifier so each tracks its own tap sequence. Every detector
  // sees every key, so pressing Option mid-Command-tap correctly reads as a chord.
  const detectors = (Object.keys(MODIFIER_KEYS) as DoubleTapModifier[]).map((mod) =>
    createDoubleTapDetector({
      onDoubleTap: () => onDoubleTap(mod),
      isTargetKey: (keycode) => MODIFIER_KEYS[mod].has(keycode),
      // TAP_MAX_MS = 250, DOUBLE_TAP_GAP_MS = 400 (detector defaults)
    }),
  )

  uIOhook.on('keydown', (e) => {
    for (const d of detectors) d.keydown(e.keycode)
  })
  uIOhook.on('keyup', (e) => {
    for (const d of detectors) d.keyup(e.keycode)
  })

  try {
    uIOhook.start()
    log('Key hook started — double-tap Option or Command to toggle')
  } catch (err) {
    log(`Key hook failed to start: ${(err as Error).message}`)
  }
}

export function stopModifierDoubleTap(): void {
  try {
    uIOhook.stop()
  } catch {}
}
