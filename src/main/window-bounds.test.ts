import { describe, it, expect } from 'vitest'
import { clampRectToArea, type Rect } from './window-bounds'

// The real failure: a 2056x1290 work area with the overlay dragged to x=1524,
// putting its right edge at 2564 — 508px past the screen edge and unrecoverable.
const WORK_AREA: Rect = { x: 0, y: 39, width: 2056, height: 1290 }
const OVERLAY = { width: 1040, height: 720 }

describe('clampRectToArea', () => {
  it('pulls a window dragged off the right edge back on screen', () => {
    const dragged = { x: 1524, y: 603, ...OVERLAY }
    const clamped = clampRectToArea(dragged, WORK_AREA)

    expect(clamped.x).toBe(1016) // 0 + 2056 - 1040
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(WORK_AREA.x + WORK_AREA.width)
  })

  it('pulls a window dragged off the left edge back on screen', () => {
    const clamped = clampRectToArea({ x: -600, y: 603, ...OVERLAY }, WORK_AREA)
    expect(clamped.x).toBe(0)
  })

  it('respects the work area origin when clamping vertically', () => {
    const aboveMenuBar = clampRectToArea({ x: 1016, y: -200, ...OVERLAY }, WORK_AREA)
    expect(aboveMenuBar.y).toBe(39) // work area starts below the menu bar

    const belowDock = clampRectToArea({ x: 1016, y: 5000, ...OVERLAY }, WORK_AREA)
    expect(belowDock.y).toBe(609) // 39 + 1290 - 720
  })

  it('leaves an already on-screen window untouched', () => {
    const onScreen = { x: 1016, y: 545, ...OVERLAY }
    expect(clampRectToArea(onScreen, WORK_AREA)).toEqual(onScreen)
  })

  it('pins to the area origin when the window is larger than the screen', () => {
    const huge = { x: -50, y: -50, width: 4000, height: 3000 }
    const clamped = clampRectToArea(huge, WORK_AREA)
    expect(clamped.x).toBe(0)
    expect(clamped.y).toBe(39)
  })

  it('preserves width and height', () => {
    const clamped = clampRectToArea({ x: 9999, y: 9999, ...OVERLAY }, WORK_AREA)
    expect(clamped.width).toBe(1040)
    expect(clamped.height).toBe(720)
  })
})
