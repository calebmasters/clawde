import { describe, it, expect, vi } from 'vitest'
import { createDoubleTapDetector } from './double-tap-detector'

const LEFT_OPT = 56
const RIGHT_OPT = 3640
const KEY_C = 46

function setup(overrides: { tapMaxMs?: number; gapMs?: number } = {}) {
  let t = 1000
  const onDoubleTap = vi.fn()
  const det = createDoubleTapDetector({
    tapMaxMs: 250,
    gapMs: 400,
    ...overrides,
    onDoubleTap,
    isTargetKey: (k) => k === LEFT_OPT || k === RIGHT_OPT,
    now: () => t,
  })
  const advance = (ms: number) => { t += ms }
  const tap = (key = LEFT_OPT, holdMs = 20) => {
    det.keydown(key)
    advance(holdMs)
    det.keyup(key)
  }
  return { det, onDoubleTap, advance, tap }
}

describe('createDoubleTapDetector', () => {
  it('fires on two quick taps within the gap window', () => {
    const { onDoubleTap, advance, tap } = setup()
    tap()
    advance(100)
    tap()
    expect(onDoubleTap).toHaveBeenCalledTimes(1)
  })

  it('does not fire on a single tap', () => {
    const { onDoubleTap, tap } = setup()
    tap()
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('does not fire when the gap between taps is too long', () => {
    const { onDoubleTap, advance, tap } = setup()
    tap()
    advance(500) // > gapMs (400)
    tap()
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('does not fire when the key is held too long (deliberate hold)', () => {
    const { onDoubleTap, advance, det } = setup()
    det.keydown(LEFT_OPT)
    advance(1000) // held > tapMaxMs
    det.keyup(LEFT_OPT)
    advance(50)
    // even a following quick tap should not complete a double from the hold
    det.keydown(LEFT_OPT)
    advance(20)
    det.keyup(LEFT_OPT)
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('treats a chord (⌥+C) as a modifier press, not a tap', () => {
    const { onDoubleTap, advance, det } = setup()
    det.keydown(LEFT_OPT)
    det.keydown(KEY_C) // another key while Option is down → chord
    advance(20)
    det.keyup(KEY_C)
    det.keyup(LEFT_OPT)
    // one clean tap after the chord is not enough to fire
    advance(50)
    det.keydown(LEFT_OPT)
    advance(20)
    det.keyup(LEFT_OPT)
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('never fires while rapidly typing ⌥+letter combos in sequence', () => {
    const { onDoubleTap, advance, det } = setup()
    for (let i = 0; i < 6; i++) {
      det.keydown(LEFT_OPT)
      det.keydown(KEY_C)
      advance(15)
      det.keyup(KEY_C)
      det.keyup(LEFT_OPT)
      advance(15)
    }
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('works across left and right Option keys', () => {
    const { onDoubleTap, advance, tap } = setup()
    tap(LEFT_OPT)
    advance(100)
    tap(RIGHT_OPT)
    expect(onDoubleTap).toHaveBeenCalledTimes(1)
  })

  it('ignores key-repeat on hold (multiple keydowns before keyup)', () => {
    const { onDoubleTap, advance, det } = setup()
    // first tap
    det.keydown(LEFT_OPT)
    advance(20)
    det.keyup(LEFT_OPT)
    advance(50)
    // second press with OS key-repeat firing extra keydowns
    det.keydown(LEFT_OPT)
    det.keydown(LEFT_OPT)
    det.keydown(LEFT_OPT)
    advance(30) // still within tapMax measured from the FIRST keydown
    det.keyup(LEFT_OPT)
    expect(onDoubleTap).toHaveBeenCalledTimes(1)
  })

  it('requires a fresh pair after firing (three taps = one fire)', () => {
    const { onDoubleTap, advance, tap } = setup()
    tap(); advance(100); tap() // fires
    advance(100); tap()        // lone third tap — no second fire
    expect(onDoubleTap).toHaveBeenCalledTimes(1)
  })
})
