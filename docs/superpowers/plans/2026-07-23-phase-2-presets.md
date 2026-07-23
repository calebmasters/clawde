# Phase 2: Presets (Modes) with Keybinds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Named launch presets — project + model + permission mode + UI state — each bindable to its own global keybind (double-tap ⌥/⌘ or accelerator), with toggle/switch-in-place semantics, a StatusBar mode badge, a Settings editor, and migration of the legacy single hotkey into a "Default" preset.

**Architecture:** Presets persist in `<userData>/presets.json` via the Phase 1 `JsonFileStore`. Main owns keybind dispatch: a pure `buildKeybindMap` maps presets to double-tap modifiers and accelerators; `activatePreset` implements hidden→show / same→hide / different→switch, then broadcasts `PRESET_ACTIVATED`. The renderer owns application: switching project (via Phase 1 `setActiveProject`), model, permission mode, and expansion. Legacy hotkey paths stay functional until a preset claims the binding; first run migrates the legacy hotkey into a Default preset (renderer-driven, guarded by the store's `fileExisted` flag).

**Tech Stack:** Electron 33 (`globalShortcut`, existing uiohook double-tap detector), React 19, Zustand 5, vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-clod-expansion-design.md` (Phase 2 section). **Depends on Phase 1** (JsonFileStore, projects, `setActiveProject`).

## Global Constraints

- TypeScript strict mode + `npm test` green before every commit.
- `IPC.*` constants only; new channels in `src/shared/types.ts`, wired in both `src/preload/index.ts` and `src/main/index.ts`.
- Renderer colors via `useColors()`; Phosphor icons; Framer Motion.
- Renderer and main never import each other.
- Keybind registration failures must surface in the Settings UI (`keybindErrors`) — never silently dropped.
- `CommandOrControl+Shift+K` stays reserved as the always-works fallback; presets cannot claim it.
- Presets are defaults-at-activation, not locks — per-tab user overrides always win afterward.
- Commit format `<type>: <description>`, no attribution trailers. Main-process changes need a dev-server restart.

---

### Task 1: Preset types + PresetsStore (TDD)

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/presets/store.ts`
- Test: `src/main/presets/store.test.ts`

**Interfaces:**
- Consumes: `JsonFileStore` (Phase 1).
- Produces:
  - Shared types:
    ```ts
    type PresetKeybind =
      | { kind: 'double-tap'; modifier: 'option' | 'command' }
      | { kind: 'accelerator'; accelerator: string }
      | { kind: 'none' }
    interface Preset {
      id: string
      name: string
      keybind: PresetKeybind
      /** undefined = keep current project on activation; null = Scratch; string = project id */
      projectId?: string | null
      model?: string
      permissionMode?: 'ask' | 'auto'
      startExpanded?: boolean
    }
    type PresetInput = Omit<Preset, 'id'>
    ```
  - IPC names: `PRESETS_LIST`, `PRESETS_CREATE`, `PRESETS_UPDATE`, `PRESETS_DELETE`, `SET_ACTIVE_PRESET` (renderer→main), `PRESET_ACTIVATED` (main→renderer).
  - `class PresetsStore` with `constructor(filePath: string)`, `readonly fileExisted: boolean`, `list(): Preset[]`, `create(input: PresetInput): Preset | null`, `update(id: string, patch: Partial<PresetInput>): Preset | null`, `delete(id: string): boolean`.

- [ ] **Step 1: Shared types and IPC names**

In `src/shared/types.ts`, after the Projects section added in Phase 1:

```ts
// ─── Presets (modes) ───

export type PresetKeybind =
  | { kind: 'double-tap'; modifier: 'option' | 'command' }
  | { kind: 'accelerator'; accelerator: string }
  | { kind: 'none' }

/** A named launch mode: keybind + optional project/model/permission/UI defaults. */
export interface Preset {
  id: string
  name: string
  keybind: PresetKeybind
  /** undefined = keep current project on activation; null = Scratch; string = project id */
  projectId?: string | null
  model?: string
  permissionMode?: 'ask' | 'auto'
  startExpanded?: boolean
}

export type PresetInput = Omit<Preset, 'id'>
```

In the `IPC` const, after the `PROJECTS_DELETE` entry:

```ts
  // Presets (modes)
  PRESETS_LIST: 'clod:presets-list',
  PRESETS_CREATE: 'clod:presets-create',
  PRESETS_UPDATE: 'clod:presets-update',
  PRESETS_DELETE: 'clod:presets-delete',
  SET_ACTIVE_PRESET: 'clod:set-active-preset',
  // main → renderer: a preset keybind fired
  PRESET_ACTIVATED: 'clod:preset-activated',
```

- [ ] **Step 2: Write the failing store tests**

Create `src/main/presets/store.test.ts`:

```ts
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
    // @ts-expect-error runtime validation of bad keybind kind
    expect(store.create({ name: 'ok', keybind: { kind: 'wat' } })).toBeNull()
    // @ts-expect-error runtime validation of bad permission mode
    expect(store.create({ name: 'ok', keybind: { kind: 'none' }, permissionMode: 'yolo' })).toBeNull()
    expect(store.list()).toEqual([])
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
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- presets/store`
Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 4: Implement**

Create `src/main/presets/store.ts`:

```ts
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
  return typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_NAME_LENGTH
}

function isValidKeybind(v: unknown): v is PresetKeybind {
  if (!v || typeof v !== 'object') return false
  const kb = v as PresetKeybind
  if (kb.kind === 'none') return true
  if (kb.kind === 'double-tap') return kb.modifier === 'option' || kb.modifier === 'command'
  if (kb.kind === 'accelerator') return typeof kb.accelerator === 'string' && kb.accelerator.length > 0
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
    const preset: Preset = { ...input, name: input.name.trim(), id: randomUUID() }
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
    const updated: Preset = { ...merged, name: merged.name.trim(), id }
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- presets/store` — PASS. `npm run typecheck` — exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/presets/store.ts src/main/presets/store.test.ts
git commit -m "feat: preset types and validated presets store"
```

---

### Task 2: Keybind map builder (TDD)

**Files:**
- Create: `src/main/presets/keybinds.ts`
- Test: `src/main/presets/keybinds.test.ts`

**Interfaces:**
- Consumes: `Preset` type.
- Produces (Task 3 depends on this):
  - `interface KeybindMap { doubleTap: Map<'option' | 'command', string>; accelerators: Map<string, string> }` (values are preset ids)
  - `buildKeybindMap(presets: Preset[]): { map: KeybindMap; errors: Record<string, string> }` — first claimant wins; later claimants of the same binding get an error entry keyed by preset id; `kind: 'none'` is skipped; the reserved fallback `CommandOrControl+Shift+K` is rejected with an error.

- [ ] **Step 1: Write the failing tests**

Create `src/main/presets/keybinds.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- presets/keybinds`
Expected: FAIL — cannot resolve `./keybinds`.

- [ ] **Step 3: Implement**

Create `src/main/presets/keybinds.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- presets/keybinds` — PASS. `npm run typecheck` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/presets/keybinds.ts src/main/presets/keybinds.test.ts
git commit -m "feat: preset keybind map builder with conflict detection"
```

---

### Task 3: Main integration — dispatch, activation, IPC

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `PresetsStore`, `buildKeybindMap`/`KeybindMap`, existing `registerModifierDoubleTap`, `globalShortcut`, `showWindow`/`hideWindow`/`toggleWindow`, `broadcast`.
- Produces (Task 4 depends on these):
  - `IPC.PRESETS_LIST` → `{ presets: Preset[]; fileExisted: boolean; keybindErrors: Record<string, string>; activePresetId: string | null }`
  - `IPC.PRESETS_CREATE` `{ input: PresetInput }` → `Preset | null` (re-registers keybinds)
  - `IPC.PRESETS_UPDATE` `{ id, patch }` → `Preset | null` (re-registers)
  - `IPC.PRESETS_DELETE` `{ id }` → `boolean` (re-registers)
  - `IPC.SET_ACTIVE_PRESET` (on) `presetId: string | null` — records renderer-initiated switches
  - `IPC.PRESET_ACTIVATED` broadcast `(presetId: string)` when a keybind fires

- [ ] **Step 1: Store accessor and dispatch state**

In `src/main/index.ts`, add imports:

```ts
import { PresetsStore } from './presets/store'
import { buildKeybindMap, type KeybindMap } from './presets/keybinds'
import type { PresetInput } from '../shared/types'
```

Add module state near `let preferredTerminal` (Phase 0):

```ts
// ─── Preset keybind dispatch ───
let presetsStore: PresetsStore | null = null
function getPresetsStore(): PresetsStore {
  if (!presetsStore) {
    presetsStore = new PresetsStore(join(app.getPath('userData'), 'presets.json'))
  }
  return presetsStore
}
let presetKeybindMap: KeybindMap = { doubleTap: new Map(), accelerators: new Map() }
let presetKeybindErrors: Record<string, string> = {}
let presetAccelerators: string[] = []
let activePresetId: string | null = null
```

- [ ] **Step 2: Activation + registration functions**

Add after the `toggleWindow` function:

```ts
/**
 * Preset keybind semantics: hidden → show with the preset; visible with the
 * same preset → hide (toggle feel); visible with a different preset → switch
 * in place. The renderer applies the preset (project/model/permissions/UI)
 * on PRESET_ACTIVATED — main only owns window visibility and dispatch.
 */
function activatePreset(presetId: string, source: string): void {
  if (!mainWindow) return
  if (!getPresetsStore().list().some((p) => p.id === presetId)) return

  if (mainWindow.isVisible() && activePresetId === presetId) {
    hideWindow()
    return
  }
  activePresetId = presetId
  if (!mainWindow.isVisible()) showWindow(source)
  broadcast(IPC.PRESET_ACTIVATED, presetId)
}

/** (Re)register accelerator keybinds for all presets and rebuild the dispatch map. */
function applyPresetKeybinds(): void {
  for (const acc of presetAccelerators) {
    try { globalShortcut.unregister(acc) } catch {}
  }
  presetAccelerators = []

  const { map, errors } = buildKeybindMap(getPresetsStore().list())
  presetKeybindMap = map

  for (const [acc, presetId] of map.accelerators) {
    try {
      const ok = globalShortcut.register(acc, () => activatePreset(presetId, `preset shortcut ${acc}`))
      if (ok) {
        presetAccelerators.push(acc)
      } else {
        errors[presetId] = `"${acc}" could not be registered (in use by another app?)`
      }
    } catch {
      errors[presetId] = `"${acc}" is not a valid shortcut`
    }
  }
  presetKeybindErrors = errors
  log(`Preset keybinds: ${map.doubleTap.size} double-tap, ${presetAccelerators.length} accelerators, ${Object.keys(errors).length} errors`)
}
```

- [ ] **Step 3: Route the double-tap hook and fallback through presets**

In `app.whenReady().then(...)`, replace the existing `registerModifierDoubleTap(...)` call and the `globalShortcut.register('CommandOrControl+Shift+K', ...)` line with:

```ts
  // Preset keybinds take precedence; the legacy single-hotkey path remains
  // until a preset claims the modifier (pre-migration compatibility).
  registerModifierDoubleTap((mod) => {
    const presetId = presetKeybindMap.doubleTap.get(mod)
    if (presetId) {
      activatePreset(presetId, `double-tap ${mod}`)
      return
    }
    if (mod === 'option' && hotkeyMode === 'double-option') toggleWindow('double-tap Option')
    if (mod === 'command' && hotkeyMode === 'double-command') toggleWindow('double-tap Command')
  })
  // Fallback: always registered. Activates the first preset when one exists.
  globalShortcut.register('CommandOrControl+Shift+K', () => {
    const first = getPresetsStore().list()[0]
    if (first) activatePreset(first.id, 'fallback shortcut')
    else toggleWindow('shortcut Cmd/Ctrl+Shift+K')
  })
  applyPresetKeybinds()
```

Also guard the legacy custom accelerator against preset ownership — in `configureHotkey`, before the `globalShortcut.register(accelerator, ...)` call, add:

```ts
    if (presetKeybindMap.accelerators.has(accelerator)) {
      log(`Hotkey: "${accelerator}" is owned by a preset — skipping legacy registration`)
      return
    }
```

- [ ] **Step 4: IPC handlers**

Add after the projects handlers:

```ts
// ─── Presets (modes) ───

ipcMain.handle(IPC.PRESETS_LIST, () => {
  const store = getPresetsStore()
  return {
    presets: store.list(),
    fileExisted: store.fileExisted,
    keybindErrors: presetKeybindErrors,
    activePresetId,
  }
})

ipcMain.handle(IPC.PRESETS_CREATE, (_event, { input }: { input: PresetInput }) => {
  log(`IPC PRESETS_CREATE: ${input?.name}`)
  const preset = getPresetsStore().create(input)
  if (preset) applyPresetKeybinds()
  return preset
})

ipcMain.handle(IPC.PRESETS_UPDATE, (_event, { id, patch }: { id: string; patch: Partial<PresetInput> }) => {
  log(`IPC PRESETS_UPDATE: ${id}`)
  const preset = getPresetsStore().update(id, patch)
  if (preset) applyPresetKeybinds()
  return preset
})

ipcMain.handle(IPC.PRESETS_DELETE, (_event, { id }: { id: string }) => {
  log(`IPC PRESETS_DELETE: ${id}`)
  const ok = getPresetsStore().delete(id)
  if (ok) {
    if (activePresetId === id) activePresetId = null
    applyPresetKeybinds()
  }
  return ok
})

ipcMain.on(IPC.SET_ACTIVE_PRESET, (_event, presetId: string | null) => {
  activePresetId = typeof presetId === 'string' ? presetId : null
})
```

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck` — exit 0. Run: `npm test` — all pass.

```bash
git add src/main/index.ts
git commit -m "feat: preset keybind dispatch, activation semantics, and IPC"
```

---

### Task 4: Preload + renderer preset state, application, and migration

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/stores/sessionStore.ts`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: Task 3 IPC; Phase 1 `setActiveProject`; theme store legacy hotkey fields (`hotkeyMode`, `hotkeyAccelerator`).
- Produces (Task 5 depends on these):
  - `window.clod.listPresets(): Promise<{ presets: Preset[]; fileExisted: boolean; keybindErrors: Record<string, string>; activePresetId: string | null }>`
  - `window.clod.createPreset(input: PresetInput): Promise<Preset | null>`, `updatePreset(id, patch)`, `deletePreset(id)`, `setActivePreset(id: string | null): void`, `onPresetActivated(cb: (presetId: string) => void): () => void`
  - Session store: `presets: Preset[]`, `presetKeybindErrors: Record<string, string>`, `activePresetId: string | null`; actions `loadPresets(): Promise<void>` (with first-run migration), `applyPreset(presetId: string, notifyMain?: boolean): Promise<void>`, `addPreset(input: PresetInput): Promise<Preset | null>`, `editPreset(id: string, patch: Partial<PresetInput>): Promise<void>`, `removePreset(id: string): Promise<void>`.

- [ ] **Step 1: Preload bridge**

In `src/preload/index.ts`, add `Preset`, `PresetInput` to the type-only import. In `interface ClodAPI`, after the project methods:

```ts
  listPresets(): Promise<{ presets: Preset[]; fileExisted: boolean; keybindErrors: Record<string, string>; activePresetId: string | null }>
  createPreset(input: PresetInput): Promise<Preset | null>
  updatePreset(id: string, patch: Partial<PresetInput>): Promise<Preset | null>
  deletePreset(id: string): Promise<boolean>
  setActivePreset(presetId: string | null): void
  onPresetActivated(callback: (presetId: string) => void): () => void
```

In the `api` object:

```ts
  listPresets: () => ipcRenderer.invoke(IPC.PRESETS_LIST),
  createPreset: (input) => ipcRenderer.invoke(IPC.PRESETS_CREATE, { input }),
  updatePreset: (id, patch) => ipcRenderer.invoke(IPC.PRESETS_UPDATE, { id, patch }),
  deletePreset: (id) => ipcRenderer.invoke(IPC.PRESETS_DELETE, { id }),
  setActivePreset: (presetId) => ipcRenderer.send(IPC.SET_ACTIVE_PRESET, presetId),
  onPresetActivated: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, presetId: string) => callback(presetId)
    ipcRenderer.on(IPC.PRESET_ACTIVATED, handler)
    return () => ipcRenderer.removeListener(IPC.PRESET_ACTIVATED, handler)
  },
```

- [ ] **Step 2: Session store preset state**

In `src/renderer/stores/sessionStore.ts`, add `Preset`, `PresetInput`, `PresetKeybind` to the shared type import. In `interface State` after the projects fields:

```ts
  /** Launch modes. Loaded from main on startup. */
  presets: Preset[]
  /** Keybind registration errors keyed by preset id (shown in Settings). */
  presetKeybindErrors: Record<string, string>
  /** The last-activated preset (badge display). */
  activePresetId: string | null
```

actions:

```ts
  loadPresets: () => Promise<void>
  applyPreset: (presetId: string, notifyMain?: boolean) => Promise<void>
  addPreset: (input: PresetInput) => Promise<Preset | null>
  editPreset: (id: string, patch: Partial<PresetInput>) => Promise<void>
  removePreset: (id: string) => Promise<void>
```

Initial state after `activeProjectId: initialPrefs.activeProjectId,`:

```ts
  presets: [],
  presetKeybindErrors: {},
  activePresetId: null,
```

Implementations after the project actions:

```ts
  loadPresets: async () => {
    try {
      const result = await window.clod.listPresets()
      if (!result.fileExisted && result.presets.length === 0) {
        // First run: migrate the legacy toggle hotkey into a "Default" preset.
        const t = useThemeStore.getState()
        const keybind: PresetKeybind = t.hotkeyMode === 'accelerator' && t.hotkeyAccelerator
          ? { kind: 'accelerator', accelerator: t.hotkeyAccelerator }
          : { kind: 'double-tap', modifier: t.hotkeyMode === 'double-command' ? 'command' : 'option' }
        const created = await window.clod.createPreset({ name: 'Default', keybind }).catch(() => null)
        if (created) {
          set({ presets: [created], presetKeybindErrors: {}, activePresetId: created.id })
          return
        }
      }
      set({
        presets: result.presets,
        presetKeybindErrors: result.keybindErrors,
        activePresetId: result.activePresetId,
      })
    } catch {}
  },

  applyPreset: async (presetId, notifyMain = true) => {
    const preset = get().presets.find((p) => p.id === presetId)
    if (!preset) return
    set({ activePresetId: presetId })
    // Project first: setActiveProject applies the project's own defaults,
    // then the preset's explicit settings override them.
    if (preset.projectId !== undefined) {
      await get().setActiveProject(preset.projectId ?? null)
    }
    if (preset.model) get().setPreferredModel(preset.model)
    if (preset.permissionMode) get().setPermissionMode(preset.permissionMode)
    if (preset.startExpanded !== undefined) set({ isExpanded: preset.startExpanded })
    if (notifyMain) {
      try { window.clod.setActivePreset(presetId) } catch {}
    }
  },

  addPreset: async (input) => {
    const preset = await window.clod.createPreset(input).catch(() => null)
    if (preset) {
      // Refresh from main so keybindErrors reflect the new registration state
      await get().loadPresets()
    }
    return preset
  },

  editPreset: async (id, patch) => {
    const updated = await window.clod.updatePreset(id, patch).catch(() => null)
    if (updated) await get().loadPresets()
  },

  removePreset: async (id) => {
    const ok = await window.clod.deletePreset(id).catch(() => false)
    if (ok) await get().loadPresets()
  },
```

- [ ] **Step 3: App wiring — load, listen, apply**

In `src/renderer/App.tsx`:

In the startup effect (rewritten in Phase 1 Task 6), add after `await useSessionStore.getState().loadProjects()`:

```ts
      await useSessionStore.getState().loadPresets()
```

Add a new effect after it:

```ts
  // Preset keybind fired in main → apply the preset here (main already
  // handled window visibility; notifyMain=false avoids an echo).
  useEffect(() => {
    const unsub = window.clod.onPresetActivated((presetId) => {
      void useSessionStore.getState().applyPreset(presetId, false)
    })
    return unsub
  }, [])
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck` — exit 0. Run: `npm test` — all pass.

Manual (dev-server restart): on first launch after this change, `<userData>/presets.json` appears containing a "Default" preset with your legacy hotkey (double-⌥ unless changed); double-tap ⌥ still toggles the overlay; `Cmd+Shift+K` still works.

```bash
git add src/preload/index.ts src/renderer/stores/sessionStore.ts src/renderer/App.tsx
git commit -m "feat: renderer preset state, activation, and legacy hotkey migration"
```

---

### Task 5: Mode badge + Settings editor

**Files:**
- Create: `src/renderer/lib/accelerator.ts` (move `toAccelerator` so two components share it)
- Create: `src/renderer/components/PresetEditor.tsx`
- Modify: `src/renderer/components/StatusBar.tsx` (mode badge)
- Modify: `src/renderer/components/SettingsPopover.tsx` (Modes section replaces the legacy Shortcut section)

**Interfaces:**
- Consumes: session store preset state/actions (Task 4), `usePopoverLayer`/`useColors` patterns, `AVAILABLE_MODELS`.
- Produces: `formatKeybind(kb: PresetKeybind): string` and `<PresetsSection />` (exported from `PresetEditor.tsx`); `toAccelerator(e: KeyboardEvent): string | null` exported from `src/renderer/lib/accelerator.ts`.

- [ ] **Step 1: Extract the accelerator helper**

Create `src/renderer/lib/accelerator.ts` containing the `toAccelerator` function currently defined at the top of `SettingsPopover.tsx` (move it verbatim, add `export`):

```ts
/** Build an Electron accelerator string from a keydown event, or null if it's
 *  just a modifier / has no modifier (globals need at least one modifier). */
export function toAccelerator(e: KeyboardEvent): string | null {
  const key = e.key
  if (key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') return null
  const mods: string[] = []
  if (e.metaKey) mods.push('Command')
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (mods.length === 0) return null
  const arrows: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }
  let name: string
  if (key === ' ') name = 'Space'
  else if (arrows[key]) name = arrows[key]
  else if (key.length === 1) name = key.toUpperCase()
  else name = key // Enter, Tab, F1…F24, etc.
  return [...mods, name].join('+')
}
```

In `SettingsPopover.tsx`, delete the local definition and add `import { toAccelerator } from '../lib/accelerator'`. (The import becomes unused in Step 4 when the Shortcut section is removed — delete it then.)

- [ ] **Step 2: PresetEditor component**

Create `src/renderer/components/PresetEditor.tsx`:

```tsx
import React, { useState, useEffect } from 'react'
import { Lightning, PencilSimple, Plus, Trash, Warning } from '@phosphor-icons/react'
import { useSessionStore, AVAILABLE_MODELS } from '../stores/sessionStore'
import { useColors } from '../theme'
import { toAccelerator } from '../lib/accelerator'
import type { Preset, PresetInput, PresetKeybind } from '../../shared/types'

export function formatKeybind(kb: PresetKeybind): string {
  if (kb.kind === 'double-tap') return kb.modifier === 'option' ? '⌥⌥' : '⌘⌘'
  if (kb.kind === 'accelerator') return kb.accelerator
  return '—'
}

/** Small pill button used for all option rows in the editor. */
function Pill({ active, label, onClick, colors }: {
  active: boolean
  label: string
  onClick: () => void
  colors: ReturnType<typeof useColors>
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors truncate"
      style={{
        background: active ? colors.accent : colors.surfaceSecondary,
        color: active ? colors.textOnAccent : colors.textSecondary,
        border: `1px solid ${active ? colors.accent : colors.containerBorder}`,
      }}
    >
      {label}
    </button>
  )
}

function EditorPanel({ initial, onSave, onCancel }: {
  initial: PresetInput
  onSave: (input: PresetInput) => void
  onCancel: () => void
}) {
  const colors = useColors()
  const projects = useSessionStore((s) => s.projects)
  const [name, setName] = useState(initial.name)
  const [keybind, setKeybind] = useState<PresetKeybind>(initial.keybind)
  const [projectId, setProjectId] = useState<string | null | undefined>(initial.projectId)
  const [model, setModel] = useState<string | undefined>(initial.model)
  const [permissionMode, setPermissionMode] = useState<'ask' | 'auto' | undefined>(initial.permissionMode)
  const [startExpanded, setStartExpanded] = useState<boolean | undefined>(initial.startExpanded)
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setRecording(false); return }
      const accel = toAccelerator(e)
      if (accel) { setKeybind({ kind: 'accelerator', accelerator: accel }); setRecording(false) }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [recording])

  const label = 'text-[10px] uppercase tracking-wider'

  return (
    <div className="flex flex-col gap-1.5 p-1.5 rounded-lg" style={{ background: colors.surfaceHover }}>
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Mode name"
        className="w-full rounded-md px-2 py-1 text-[11px]"
        style={{ background: colors.surfaceSecondary, color: colors.textPrimary, border: `1px solid ${colors.containerBorder}`, outline: 'none' }}
      />

      <div className={label} style={{ color: colors.textTertiary }}>Keybind</div>
      <div className="grid grid-cols-4 gap-1">
        <Pill colors={colors} label="⌥⌥" active={keybind.kind === 'double-tap' && keybind.modifier === 'option'} onClick={() => setKeybind({ kind: 'double-tap', modifier: 'option' })} />
        <Pill colors={colors} label="⌘⌘" active={keybind.kind === 'double-tap' && keybind.modifier === 'command'} onClick={() => setKeybind({ kind: 'double-tap', modifier: 'command' })} />
        <Pill colors={colors} label={recording ? '…' : (keybind.kind === 'accelerator' ? keybind.accelerator : 'Custom')} active={keybind.kind === 'accelerator'} onClick={() => setRecording(true)} />
        <Pill colors={colors} label="None" active={keybind.kind === 'none'} onClick={() => setKeybind({ kind: 'none' })} />
      </div>

      <div className={label} style={{ color: colors.textTertiary }}>Project</div>
      <div className="grid grid-cols-2 gap-1">
        <Pill colors={colors} label="Keep current" active={projectId === undefined} onClick={() => setProjectId(undefined)} />
        <Pill colors={colors} label="Scratch" active={projectId === null} onClick={() => setProjectId(null)} />
        {projects.map((p) => (
          <Pill key={p.id} colors={colors} label={p.name} active={projectId === p.id} onClick={() => setProjectId(p.id)} />
        ))}
      </div>

      <div className={label} style={{ color: colors.textTertiary }}>Model</div>
      <div className="grid grid-cols-4 gap-1">
        <Pill colors={colors} label="—" active={model === undefined} onClick={() => setModel(undefined)} />
        {AVAILABLE_MODELS.map((m) => (
          <Pill key={m.id} colors={colors} label={m.label} active={model === m.id} onClick={() => setModel(m.id)} />
        ))}
      </div>

      <div className={label} style={{ color: colors.textTertiary }}>Permissions</div>
      <div className="grid grid-cols-3 gap-1">
        <Pill colors={colors} label="—" active={permissionMode === undefined} onClick={() => setPermissionMode(undefined)} />
        <Pill colors={colors} label="Ask" active={permissionMode === 'ask'} onClick={() => setPermissionMode('ask')} />
        <Pill colors={colors} label="Auto" active={permissionMode === 'auto'} onClick={() => setPermissionMode('auto')} />
      </div>

      <div className={label} style={{ color: colors.textTertiary }}>Chat on activate</div>
      <div className="grid grid-cols-3 gap-1">
        <Pill colors={colors} label="—" active={startExpanded === undefined} onClick={() => setStartExpanded(undefined)} />
        <Pill colors={colors} label="Expanded" active={startExpanded === true} onClick={() => setStartExpanded(true)} />
        <Pill colors={colors} label="Compact" active={startExpanded === false} onClick={() => setStartExpanded(false)} />
      </div>

      <div className="flex gap-1 justify-end mt-0.5">
        <button onClick={onCancel} className="rounded-md px-2 py-1 text-[11px]" style={{ color: colors.textTertiary }}>
          Cancel
        </button>
        <button
          onClick={() => onSave({ name: name.trim(), keybind, projectId, model, permissionMode, startExpanded })}
          disabled={!name.trim()}
          className="rounded-md px-2 py-1 text-[11px] font-medium disabled:opacity-40"
          style={{ background: colors.accent, color: colors.textOnAccent }}
        >
          Save
        </button>
      </div>
    </div>
  )
}

/** The "Modes" section rendered inside SettingsPopover. */
export function PresetsSection() {
  const colors = useColors()
  const presets = useSessionStore((s) => s.presets)
  const keybindErrors = useSessionStore((s) => s.presetKeybindErrors)
  const addPreset = useSessionStore((s) => s.addPreset)
  const editPreset = useSessionStore((s) => s.editPreset)
  const removePreset = useSessionStore((s) => s.removePreset)
  // null = list view; 'new' = creating; string = editing that preset id
  const [editing, setEditing] = useState<'new' | string | null>(null)

  const handleSave = async (input: PresetInput) => {
    if (editing === 'new') await addPreset(input)
    else if (editing) await editPreset(editing, input)
    setEditing(null)
  }

  return (
    <div>
      <div className="flex items-center gap-2 min-w-0 mb-1.5">
        <Lightning size={14} style={{ color: colors.textTertiary }} />
        <div className="text-[12px] font-medium flex-1" style={{ color: colors.textPrimary }}>
          Modes
        </div>
        {editing === null && (
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
            style={{ color: colors.accent }}
            title="Add a mode"
          >
            <Plus size={10} /> Add
          </button>
        )}
      </div>

      {editing === 'new' && (
        <EditorPanel initial={{ name: '', keybind: { kind: 'none' } }} onSave={handleSave} onCancel={() => setEditing(null)} />
      )}

      {editing === null && presets.length === 0 && (
        <div className="text-[11px]" style={{ color: colors.textTertiary }}>
          No modes yet — add one to bind a keybind.
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {presets.map((p: Preset) => (
          editing === p.id ? (
            <EditorPanel
              key={p.id}
              initial={{ name: p.name, keybind: p.keybind, projectId: p.projectId, model: p.model, permissionMode: p.permissionMode, startExpanded: p.startExpanded }}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
            />
          ) : editing === null ? (
            <div key={p.id} className="group flex items-center gap-1.5 rounded-md px-1 py-0.5">
              <span className="text-[11px] truncate flex-1" style={{ color: colors.textPrimary }}>{p.name}</span>
              {keybindErrors[p.id] && (
                <span title={keybindErrors[p.id]}>
                  <Warning size={11} weight="fill" style={{ color: '#f59e0b' }} />
                </span>
              )}
              <span className="text-[10px] flex-shrink-0" style={{ color: colors.textTertiary }}>{formatKeybind(p.keybind)}</span>
              <button onClick={() => setEditing(p.id)} className="w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100" style={{ color: colors.textTertiary }} title="Edit mode">
                <PencilSimple size={11} />
              </button>
              <button onClick={() => void removePreset(p.id)} className="w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100" style={{ color: colors.statusError }} title="Delete mode">
                <Trash size={11} />
              </button>
            </div>
          ) : null
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: StatusBar mode badge**

In `src/renderer/components/StatusBar.tsx`:

Add imports: `Lightning` to the Phosphor list, and:

```ts
import { formatKeybind } from './PresetEditor'
```

Add a `PresetBadge` component after `PermissionModePicker` (same popover pattern as `ModelPicker` — trigger + portal + outside-click close):

```tsx
/* ─── Preset (mode) badge ─── */

function PresetBadge() {
  const presets = useSessionStore((s) => s.presets)
  const activePresetId = useSessionStore((s) => s.activePresetId)
  const applyPreset = useSessionStore((s) => s.applyPreset)
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ bottom: 0, left: 0 })

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (presets.length === 0) return null
  const active = activePresetId ? presets.find((p) => p.id === activePresetId) ?? null : null

  const handleToggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ bottom: window.innerHeight - rect.top + 6, left: rect.left })
    }
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 transition-colors"
        style={{ color: active ? colors.accent : colors.textTertiary, cursor: 'pointer' }}
        title="Switch mode"
      >
        <Lightning size={11} weight={active ? 'fill' : 'regular'} />
        {active ? active.name : 'Mode'}
        <CaretDown size={10} style={{ opacity: 0.6 }} />
      </button>

      {popoverLayer && open && createPortal(
        <motion.div
          ref={popoverRef}
          data-clod-ui
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.12 }}
          className="rounded-xl"
          style={{
            position: 'fixed',
            bottom: pos.bottom,
            left: pos.left,
            width: 200,
            pointerEvents: 'auto',
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
          }}
        >
          <div className="py-1">
            {presets.map((p) => {
              const isActive = p.id === activePresetId
              return (
                <button
                  key={p.id}
                  onClick={() => { void applyPreset(p.id); setOpen(false) }}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors"
                  style={{ color: isActive ? colors.textPrimary : colors.textSecondary, fontWeight: isActive ? 600 : 400 }}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[10px]" style={{ color: colors.textTertiary }}>{formatKeybind(p.keybind)}</span>
                    {isActive && <Check size={12} style={{ color: colors.accent }} />}
                  </span>
                </button>
              )
            })}
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}
```

Mount it in `StatusBar`'s left cluster after the `<PermissionModePicker />`:

```tsx
        <PermissionModePicker />

        <span style={{ color: colors.textMuted, fontSize: 10 }}>|</span>

        <PresetBadge />
```

- [ ] **Step 4: Settings — Modes section replaces the legacy Shortcut section**

In `src/renderer/components/SettingsPopover.tsx`:

- Delete the entire "Shortcut" section block (the `<div>` with the `Keyboard` icon header, the three hotkey buttons, and the "Cmd+Shift+K always works too." hint) **and** its trailing divider.
- Delete the now-unused: `recording` state, the recording `useEffect`, the `toAccelerator` import (from Step 1), the `hotkeyMode`/`hotkeyAccelerator`/`setHotkey` store hooks, and `Keyboard` from the icon imports. Keep `window.clod.setHotkey` in `App.tsx` untouched (pre-migration compatibility).
- In its place, render the Modes section:

```tsx
            {/* Modes (presets with keybinds) */}
            <PresetsSection />
            <div className="text-[10px] -mt-1" style={{ color: colors.textTertiary }}>
              Cmd+Shift+K always activates the first mode.
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />
```

with `import { PresetsSection } from './PresetEditor'` added at the top.

- [ ] **Step 5: Verify**

Run: `npm run typecheck` — exit 0. Run: `npm test` — all pass.

Manual checklist (dev-server restart):
1. Settings → Modes shows "Default" with your migrated keybind.
2. Add "Deep work": ⌘⌘, project clawde, Opus, Ask, Expanded. Add "Quick fix": custom accelerator, Scratch, Haiku, Auto.
3. ⌥⌥ (Default) toggles show/hide. ⌘⌘ while hidden opens in clawde workspace with Opus/Ask and the badge reads "Deep work". ⌘⌘ again hides. ⌥⌥ while visible switches in place (badge changes, window stays).
4. Two modes claiming ⌥⌥ → the second shows a warning icon with a tooltip in Settings.
5. StatusBar badge menu switches modes without touching window visibility.
6. Per-tab overrides after activation stick (change model in StatusBar — preset doesn't fight it).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/accelerator.ts src/renderer/components/PresetEditor.tsx src/renderer/components/StatusBar.tsx src/renderer/components/SettingsPopover.tsx
git commit -m "feat: mode badge, preset editor UI, and legacy shortcut section replacement"
```
