/**
 * PresetsStore — validated CRUD over presets.json in userData.
 * `fileExisted` (from the underlying JsonFileStore load) lets the renderer
 * run first-run migration of the legacy hotkey exactly once.
 */
import { randomUUID } from 'crypto'
import { JsonFileStore } from '../storage/json-store'
import type { Preset, PresetInput, PresetKeybind } from '../../shared/types'

const MAX_NAME_LENGTH = 64

function isValidName(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const trimmed = v.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH
}

function isValidKeybind(v: unknown): v is PresetKeybind {
  if (!v || typeof v !== 'object') return false
  const kb = v as PresetKeybind
  if (kb.kind === 'none') return true
  if (kb.kind === 'double-tap') return kb.modifier === 'option' || kb.modifier === 'command'
  if (kb.kind === 'accelerator') return typeof kb.accelerator === 'string' && kb.accelerator.trim().length > 0
  return false
}

function isValidInput(v: PresetInput): boolean {
  if (!isValidName(v.name) || !isValidKeybind(v.keybind)) return false
  if (v.projectId !== undefined && v.projectId !== null && typeof v.projectId !== 'string') return false
  if (v.model !== undefined && typeof v.model !== 'string') return false
  if (v.permissionMode !== undefined && v.permissionMode !== 'ask' && v.permissionMode !== 'auto') return false
  if (v.startExpanded !== undefined && typeof v.startExpanded !== 'boolean') return false
  return true
}

export function isPreset(v: unknown): v is Preset {
  if (!v || typeof v !== 'object') return false
  const p = v as Preset
  if (typeof p.id !== 'string' || p.id.length === 0) return false
  const { id: _id, ...input } = p
  return isValidInput(input)
}

export class PresetsStore {
  private store: JsonFileStore<Preset>
  private presets: Preset[]
  readonly fileExisted: boolean

  constructor(filePath: string) {
    this.store = new JsonFileStore<Preset>(filePath, isPreset)
    const loaded = this.store.load()
    this.presets = loaded.items
    this.fileExisted = loaded.fileExisted
  }

  list(): Preset[] {
    return [...this.presets]
  }

  create(input: PresetInput): Preset | null {
    if (!isValidInput(input)) return null
    const preset: Preset = { ...input, name: input.name.trim(), keybind: { ...input.keybind }, id: randomUUID() }
    this.presets = [...this.presets, preset]
    this.store.save(this.presets)
    return preset
  }

  update(id: string, patch: Partial<PresetInput>): Preset | null {
    const existing = this.presets.find((p) => p.id === id)
    if (!existing) return null
    const { id: _id, ...existingInput } = existing
    const merged: PresetInput = { ...existingInput, ...patch }
    if (!isValidInput(merged)) return null
    const updated: Preset = { ...merged, name: merged.name.trim(), keybind: { ...merged.keybind }, id }
    this.presets = this.presets.map((p) => (p.id === id ? updated : p))
    this.store.save(this.presets)
    return updated
  }

  delete(id: string): boolean {
    if (!this.presets.some((p) => p.id === id)) return false
    this.presets = this.presets.filter((p) => p.id !== id)
    this.store.save(this.presets)
    return true
  }
}
