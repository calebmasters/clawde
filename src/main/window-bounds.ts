/**
 * Pure geometry helpers for overlay placement — no Electron imports so they can be
 * unit tested. `index.ts` supplies the real display work area.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Constrain a rectangle so it lies fully inside `area`.
 *
 * The overlay is frameless and click-through, so a drag that pushes it past a
 * screen edge leaves nothing to grab — the window becomes unrecoverable without
 * restarting the app. Clamping every move keeps it reachable.
 *
 * If the rectangle is larger than the area on an axis it is pinned to the area's
 * origin on that axis rather than pushed to a negative offset.
 */
export function clampRectToArea(rect: Rect, area: Rect): Rect {
  const maxX = area.x + Math.max(0, area.width - rect.width)
  const maxY = area.y + Math.max(0, area.height - rect.height)

  return {
    ...rect,
    x: Math.round(Math.min(Math.max(rect.x, area.x), maxX)),
    y: Math.round(Math.min(Math.max(rect.y, area.y), maxY)),
  }
}
