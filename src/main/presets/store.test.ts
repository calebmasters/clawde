import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PresetsStore } from './store'

let file: string
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'clod-presets-')), 'presets.json')
})

describe('PresetsStore', () => {
  it('starts empty with fileExisted false on first run', () => {
    const store = new PresetsStore(file)
    expect(store.list()).toEqual([])
    expect(store.fileExisted).toBe(false)
  })

  it('creates and persists a full preset; fileExisted true afterwards', () => {
    const store = new PresetsStore(file)
    const p = store.create({
      name: 'Deep work',
      keybind: { kind: 'double-tap', modifier: 'option' },
      projectId: 'proj-1',
      model: 'claude-opus-4-8',
      permissionMode: 'ask',
      startExpanded: true,
    })
    expect(p).not.toBeNull()
    expect(p!.id.length).toBeGreaterThan(0)
    const reloaded = new PresetsStore(file)
    expect(reloaded.list()).toEqual([p])
    expect(reloaded.fileExisted).toBe(true)
  })

  it('accepts projectId null (Scratch) and undefined (keep current)', () => {
    const store = new PresetsStore(file)
    expect(store.create({ name: 'A', keybind: { kind: 'none' }, projectId: null })).not.toBeNull()
    expect(store.create({ name: 'B', keybind: { kind: 'none' } })).not.toBeNull()
    expect(new PresetsStore(file).list()).toHaveLength(2)
  })

  it('rejects invalid input', () => {
    const store = new PresetsStore(file)
    expect(store.create({ name: '  ', keybind: { kind: 'none' } })).toBeNull()
    expect(store.create({ name: 'x'.repeat(65), keybind: { kind: 'none' } })).toBeNull()
    expect(store.create({ name: 'ok', keybind: { kind: 'accelerator', accelerator: '' } })).toBeNull()
    expect(store.create({ name: 'ok', keybind: { kind: 'accelerator', accelerator: '   ' } })).toBeNull()
    // @ts-expect-error runtime validation of bad keybind kind
    expect(store.create({ name: 'ok', keybind: { kind: 'wat' } })).toBeNull()
    // @ts-expect-error runtime validation of bad permission mode
    expect(store.create({ name: 'ok', keybind: { kind: 'none' }, permissionMode: 'yolo' })).toBeNull()
    expect(store.list()).toEqual([])
  })

  it('accepts systemPrompt undefined (leave as-is), null (reset), and a custom string', () => {
    const store = new PresetsStore(file)
    expect(store.create({ name: 'A', keybind: { kind: 'none' } })).not.toBeNull()
    expect(store.create({ name: 'B', keybind: { kind: 'none' }, systemPrompt: null })).not.toBeNull()
    const custom = store.create({
      name: 'C',
      keybind: { kind: 'none' },
      systemPrompt: 'Answer anything.',
      systemPromptMode: 'replace',
    })
    expect(custom).not.toBeNull()
    const reloaded = new PresetsStore(file).list()
    expect(reloaded).toHaveLength(3)
    expect(reloaded[1].systemPrompt).toBeNull()
    expect(reloaded[2]).toMatchObject({ systemPrompt: 'Answer anything.', systemPromptMode: 'replace' })
  })

  it('rejects an over-length prompt, a non-string prompt, and an invalid prompt mode', () => {
    const store = new PresetsStore(file)
    expect(store.create({ name: 'A', keybind: { kind: 'none' }, systemPrompt: 'x'.repeat(8001) })).toBeNull()
    // @ts-expect-error runtime validation of a non-string prompt
    expect(store.create({ name: 'A', keybind: { kind: 'none' }, systemPrompt: 42 })).toBeNull()
    // @ts-expect-error runtime validation of a bad prompt mode
    expect(store.create({ name: 'A', keybind: { kind: 'none' }, systemPromptMode: 'merge' })).toBeNull()
    expect(store.create({ name: 'A', keybind: { kind: 'none' }, systemPrompt: 'x'.repeat(8000) })).not.toBeNull()
    expect(store.list()).toHaveLength(1)
  })

  it('round-trips prompt fields through update', () => {
    const store = new PresetsStore(file)
    const p = store.create({ name: 'A', keybind: { kind: 'none' }, systemPrompt: 'first' })!
    const updated = store.update(p.id, { systemPrompt: 'second', systemPromptMode: 'append' })
    expect(updated).toMatchObject({ systemPrompt: 'second', systemPromptMode: 'append' })
    expect(store.update(p.id, { systemPrompt: 'x'.repeat(8001) })).toBeNull()
    expect(store.list()[0].systemPrompt).toBe('second')
  })

  it('updates fields and clears optionals set to undefined explicitly via patch', () => {
    const store = new PresetsStore(file)
    const p = store.create({ name: 'A', keybind: { kind: 'none' }, model: 'claude-sonnet-5' })!
    const updated = store.update(p.id, { name: 'B', keybind: { kind: 'double-tap', modifier: 'command' } })
    expect(updated).toMatchObject({ name: 'B', keybind: { kind: 'double-tap', modifier: 'command' }, model: 'claude-sonnet-5' })
    expect(store.update('nope', { name: 'X' })).toBeNull()
    expect(store.update(p.id, { name: '' })).toBeNull()
  })

  it('deletes', () => {
    const store = new PresetsStore(file)
    const p = store.create({ name: 'A', keybind: { kind: 'none' } })!
    expect(store.delete(p.id)).toBe(true)
    expect(store.delete(p.id)).toBe(false)
  })

  it('survives corrupt files', () => {
    writeFileSync(file, 'not json')
    const store = new PresetsStore(file)
    expect(store.list()).toEqual([])
    expect(store.fileExisted).toBe(false)
  })

  it('accepts a name whose trimmed length is within the 64-char bound', () => {
    const store = new PresetsStore(file)
    const p = store.create({ name: 'x'.repeat(64) + '   ', keybind: { kind: 'none' } })
    expect(p).not.toBeNull()
    expect(p!.name).toBe('x'.repeat(64))
  })

  it('does not alias caller-owned keybind objects', () => {
    const store = new PresetsStore(file)
    const keybind = { kind: 'accelerator' as const, accelerator: 'Command+J' }
    const p = store.create({ name: 'A', keybind })
    expect(p).not.toBeNull()
    keybind.accelerator = 'Command+K'
    expect(store.list()[0].keybind).toEqual({ kind: 'accelerator', accelerator: 'Command+J' })
  })
})
