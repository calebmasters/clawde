import { describe, it, expect } from 'vitest'
import { buildKeybindMap } from './keybinds'
import type { Preset } from '../../shared/types'

const preset = (id: string, keybind: Preset['keybind']): Preset => ({ id, name: id, keybind })

describe('buildKeybindMap', () => {
  it('maps double-taps and accelerators to preset ids', () => {
    const { map, errors } = buildKeybindMap([
      preset('a', { kind: 'double-tap', modifier: 'option' }),
      preset('b', { kind: 'double-tap', modifier: 'command' }),
      preset('c', { kind: 'accelerator', accelerator: 'Control+Alt+Space' }),
    ])
    expect(map.doubleTap.get('option')).toBe('a')
    expect(map.doubleTap.get('command')).toBe('b')
    expect(map.accelerators.get('Control+Alt+Space')).toBe('c')
    expect(errors).toEqual({})
  })

  it('skips kind none', () => {
    const { map, errors } = buildKeybindMap([preset('a', { kind: 'none' })])
    expect(map.doubleTap.size).toBe(0)
    expect(map.accelerators.size).toBe(0)
    expect(errors).toEqual({})
  })

  it('first claimant wins; later duplicates get errors', () => {
    const { map, errors } = buildKeybindMap([
      preset('a', { kind: 'double-tap', modifier: 'option' }),
      preset('b', { kind: 'double-tap', modifier: 'option' }),
      preset('c', { kind: 'accelerator', accelerator: 'Command+J' }),
      preset('d', { kind: 'accelerator', accelerator: 'Command+J' }),
    ])
    expect(map.doubleTap.get('option')).toBe('a')
    expect(map.accelerators.get('Command+J')).toBe('c')
    expect(errors['b']).toMatch(/already/i)
    expect(errors['d']).toMatch(/already/i)
    expect(errors['a']).toBeUndefined()
    expect(errors['c']).toBeUndefined()
  })

  it('rejects the reserved fallback shortcut', () => {
    const { map, errors } = buildKeybindMap([
      preset('a', { kind: 'accelerator', accelerator: 'CommandOrControl+Shift+K' }),
    ])
    expect(map.accelerators.size).toBe(0)
    expect(errors['a']).toMatch(/reserved/i)
  })
})
