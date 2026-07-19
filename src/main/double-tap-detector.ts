/**
 * Pure double-tap state machine — no OS/hook dependencies so it can be unit
 * tested with an injectable clock. `modifier-double-tap.ts` wires this to uiohook.
 *
 * A "tap" is a target key pressed and released quickly with no other key pressed
 * in between (chord detection). Two taps within the gap window fire onDoubleTap.
 */

export interface DoubleTapOptions {
  onDoubleTap: () => void
  /** Which keycodes count as the trigger key (e.g. left/right Option). */
  isTargetKey: (keycode: number) => boolean
  /** Longest hold that still counts as a tap rather than a deliberate hold. */
  tapMaxMs?: number
  /** Longest gap allowed between the two taps. */
  gapMs?: number
  /** Injectable clock (defaults to Date.now) — override in tests. */
  now?: () => number
}

export interface DoubleTapDetector {
  keydown: (keycode: number) => void
  keyup: (keycode: number) => void
}

export function createDoubleTapDetector(opts: DoubleTapOptions): DoubleTapDetector {
  const tapMaxMs = opts.tapMaxMs ?? 250
  const gapMs = opts.gapMs ?? 400
  const now = opts.now ?? Date.now

  let downAt = 0
  let chorded = false
  let lastTapAt = 0

  return {
    keydown(keycode: number): void {
      if (opts.isTargetKey(keycode)) {
        if (downAt === 0) downAt = now() // ignore key-repeat
        return
      }
      if (downAt !== 0) chorded = true // target key is being used as a modifier
    },

    keyup(keycode: number): void {
      if (!opts.isTargetKey(keycode)) return
      const held = now() - downAt
      const wasChord = chorded
      downAt = 0
      chorded = false

      // A chord (e.g. ⌥C) or a deliberate hold is not a tap — reset the sequence.
      if (wasChord || held > tapMaxMs) {
        lastTapAt = 0
        return
      }

      const t = now()
      if (lastTapAt !== 0 && t - lastTapAt <= gapMs) {
        lastTapAt = 0
        opts.onDoubleTap()
      } else {
        lastTapAt = t
      }
    },
  }
}
