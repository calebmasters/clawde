/**
 * Pure mapping from presets to keybind dispatch tables.
 * Registration side effects (globalShortcut) live in main/index.ts;
 * this module only decides who owns which binding and reports conflicts.
 */
import type { Preset } from '../../shared/types'

export const RESERVED_ACCELERATOR = 'CommandOrControl+Shift+K'

export interface KeybindMap {
  doubleTap: Map<'option' | 'command', string>
  accelerators: Map<string, string>
}

export function buildKeybindMap(presets: Preset[]): { map: KeybindMap; errors: Record<string, string> } {
  const map: KeybindMap = { doubleTap: new Map(), accelerators: new Map() }
  const errors: Record<string, string> = {}

  for (const p of presets) {
    const kb = p.keybind
    if (kb.kind === 'none') continue

    if (kb.kind === 'double-tap') {
      if (map.doubleTap.has(kb.modifier)) {
        errors[p.id] = `Double-tap ${kb.modifier === 'option' ? '⌥' : '⌘'} is already used by another mode`
      } else {
        map.doubleTap.set(kb.modifier, p.id)
      }
      continue
    }

    if (kb.accelerator === RESERVED_ACCELERATOR) {
      errors[p.id] = `${RESERVED_ACCELERATOR} is reserved as the fallback shortcut`
      continue
    }
    if (map.accelerators.has(kb.accelerator)) {
      errors[p.id] = `"${kb.accelerator}" is already used by another mode`
    } else {
      map.accelerators.set(kb.accelerator, p.id)
    }
  }

  return { map, errors }
}
