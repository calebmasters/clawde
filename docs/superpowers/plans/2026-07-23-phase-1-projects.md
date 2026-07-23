# Phase 1: Projects (Workspaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First-class projects: a named directory + its own set of tabs + per-project defaults, persisted in `userData`, with a switcher in the TabStrip, project-scoped session history, and a built-in "Scratch" workspace preserving today's behavior.

**Architecture:** A generic atomic JSON file store in main (`src/main/storage/json-store.ts`) backs a validated `ProjectsStore` (`src/main/projects/store.ts`), exposed over four new IPC channels. The renderer session store gains `projects`, `activeProjectId`, and `tab.projectId`; the TabStrip renders only the active workspace's tabs (pure filter — ControlPlane stays tab-keyed and unaware of grouping, so no process-layer changes). Scratch = `projectId: null`. Phase 2 (presets) reuses both the JSON store and `setActiveProject`.

**Tech Stack:** Electron 33, React 19, Zustand 5, vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-clod-expansion-design.md` (Phase 1 section).

## Global Constraints

- TypeScript strict mode: `npm run typecheck` must pass with zero errors before every commit.
- `npm test` (vitest) must pass before every commit.
- Use `IPC.*` constants; new channels declared in `src/shared/types.ts` and wired in **both** `src/preload/index.ts` and `src/main/index.ts`.
- Renderer colors only via `useColors()`; icons Phosphor; animations Framer Motion.
- Renderer and main never import each other; tab state transitions go through ControlPlane only (this phase adds no new transitions — grouping is renderer-side metadata).
- Immutability in the renderer store: always spread, never mutate.
- Deleting a project never deletes sessions or directories; its tabs move to Scratch.
- Corrupt store files: back up to `<file>.bak`, start with defaults, log — never crash, never silently discard without the backup.
- Commit format `<type>: <description>`, no attribution trailers. Main-process changes need a dev-server restart.

---

### Task 1: Generic atomic JSON file store (TDD)

**Files:**
- Create: `src/main/storage/json-store.ts`
- Test: `src/main/storage/json-store.test.ts`

**Interfaces:**
- Consumes: Node `fs` only.
- Produces (Tasks 2 and Phase 2 depend on this exact shape):
  - `class JsonFileStore<T>` with `constructor(filePath: string, validateItem: (v: unknown) => v is T)`, `load(): { items: T[]; fileExisted: boolean }`, `save(items: T[]): void`.
  - On-disk shape: `{ "version": 1, "items": [...] }`. Invalid items are skipped individually; unparseable files are renamed to `<file>.bak` and treated as absent (`fileExisted: false`).

- [ ] **Step 1: Write the failing tests**

Create `src/main/storage/json-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { JsonFileStore } from './json-store'

interface Thing { id: string; n: number }
const isThing = (v: unknown): v is Thing =>
  !!v && typeof v === 'object'
  && typeof (v as Thing).id === 'string' && (v as Thing).id.length > 0
  && typeof (v as Thing).n === 'number'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clod-json-store-'))
})

describe('JsonFileStore', () => {
  it('load on a missing file returns empty with fileExisted false', () => {
    const store = new JsonFileStore<Thing>(join(dir, 'things.json'), isThing)
    expect(store.load()).toEqual({ items: [], fileExisted: false })
  })

  it('save then load round-trips and reports fileExisted true', () => {
    const file = join(dir, 'things.json')
    const store = new JsonFileStore<Thing>(file, isThing)
    store.save([{ id: 'a', n: 1 }, { id: 'b', n: 2 }])
    expect(store.load()).toEqual({ items: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }], fileExisted: true })
    // On-disk shape is versioned
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ version: 1, items: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }] })
  })

  it('skips invalid items individually', () => {
    const file = join(dir, 'things.json')
    writeFileSync(file, JSON.stringify({ version: 1, items: [{ id: 'ok', n: 1 }, { id: '', n: 2 }, { nope: true }, 'junk'] }))
    const store = new JsonFileStore<Thing>(file, isThing)
    expect(store.load()).toEqual({ items: [{ id: 'ok', n: 1 }], fileExisted: true })
  })

  it('backs up a corrupt file to .bak and starts fresh', () => {
    const file = join(dir, 'things.json')
    writeFileSync(file, '{not json at all')
    const store = new JsonFileStore<Thing>(file, isThing)
    expect(store.load()).toEqual({ items: [], fileExisted: false })
    expect(existsSync(`${file}.bak`)).toBe(true)
    expect(readFileSync(`${file}.bak`, 'utf-8')).toBe('{not json at all')
  })

  it('treats a non-object root or missing items array as corrupt', () => {
    const file = join(dir, 'things.json')
    writeFileSync(file, JSON.stringify([1, 2, 3]))
    const store = new JsonFileStore<Thing>(file, isThing)
    expect(store.load()).toEqual({ items: [], fileExisted: false })
    expect(existsSync(`${file}.bak`)).toBe(true)
  })

  it('save is atomic: no partial temp file remains and content is valid JSON', () => {
    const file = join(dir, 'things.json')
    const store = new JsonFileStore<Thing>(file, isThing)
    store.save([{ id: 'a', n: 1 }])
    store.save([{ id: 'a', n: 2 }])
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(JSON.parse(readFileSync(file, 'utf-8')).items).toEqual([{ id: 'a', n: 2 }])
  })

  it('creates parent directories on save', () => {
    const file = join(dir, 'nested', 'deep', 'things.json')
    const store = new JsonFileStore<Thing>(file, isThing)
    store.save([{ id: 'a', n: 1 }])
    expect(store.load().items).toEqual([{ id: 'a', n: 1 }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- json-store`
Expected: FAIL — cannot resolve `./json-store`.

- [ ] **Step 3: Implement**

Create `src/main/storage/json-store.ts`:

```ts
/**
 * Generic atomic JSON file store for small config collections
 * (projects, presets). On-disk shape: { version: 1, items: T[] }.
 *
 * Failure policy: an unparseable or malformed file is renamed to
 * `<file>.bak` and treated as absent; individually invalid items are
 * skipped on load. Saves write a temp file then rename (atomic on APFS).
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { log as _log } from '../logger'

function log(msg: string): void {
  _log('JsonStore', msg)
}

export interface JsonStoreLoadResult<T> {
  items: T[]
  /** False when the file was missing OR corrupt (backed up) — callers use this for first-run migration. */
  fileExisted: boolean
}

export class JsonFileStore<T> {
  constructor(
    private filePath: string,
    private validateItem: (v: unknown) => v is T,
  ) {}

  load(): JsonStoreLoadResult<T> {
    if (!existsSync(this.filePath)) {
      return { items: [], fileExisted: false }
    }

    let raw: string
    try {
      raw = readFileSync(this.filePath, 'utf-8')
    } catch (err) {
      log(`Read failed for ${this.filePath}: ${(err as Error).message}`)
      return { items: [], fileExisted: false }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this._backupCorrupt()
      return { items: [], fileExisted: false }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || !Array.isArray((parsed as { items?: unknown }).items)) {
      this._backupCorrupt()
      return { items: [], fileExisted: false }
    }

    const items = ((parsed as { items: unknown[] }).items).filter(this.validateItem)
    return { items, fileExisted: true }
  }

  save(items: T[]): void {
    const tmp = `${this.filePath}.tmp`
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2), { mode: 0o600 })
      renameSync(tmp, this.filePath)
    } catch (err) {
      log(`Save failed for ${this.filePath}: ${(err as Error).message}`)
    }
  }

  private _backupCorrupt(): void {
    try {
      renameSync(this.filePath, `${this.filePath}.bak`)
      log(`Corrupt store backed up: ${this.filePath} → .bak`)
    } catch (err) {
      log(`Backup of corrupt store failed: ${(err as Error).message}`)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- json-store`
Expected: PASS. Also `npm run typecheck` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/json-store.ts src/main/storage/json-store.test.ts
git commit -m "feat: generic atomic JSON file store with corrupt-file backup"
```

---

### Task 2: Project types + validated ProjectsStore (TDD)

**Files:**
- Modify: `src/shared/types.ts` (Project types, `projectId` on TabState, IPC channels)
- Create: `src/main/projects/store.ts`
- Test: `src/main/projects/store.test.ts`

**Interfaces:**
- Consumes: `JsonFileStore` from Task 1.
- Produces:
  - Shared types (renderer + main): `ProjectDefaults { model?: string; permissionMode?: 'ask' | 'auto' }`, `Project { id: string; name: string; path: string; defaults?: ProjectDefaults; createdAt: number; lastUsedAt: number }`.
  - `TabState.projectId: string | null` (null = Scratch).
  - IPC names: `PROJECTS_LIST`, `PROJECTS_CREATE`, `PROJECTS_UPDATE`, `PROJECTS_DELETE`.
  - `class ProjectsStore` with `constructor(filePath: string)`, `list(): Project[]`, `create(input: { name: string; path: string }): Project | null`, `update(id: string, patch: { name?: string; path?: string; defaults?: ProjectDefaults; lastUsedAt?: number }): Project | null`, `delete(id: string): boolean`.

- [ ] **Step 1: Shared types**

In `src/shared/types.ts`:

After the `SessionLoadMessage` interface, add:

```ts
// ─── Projects (workspaces) ───

export interface ProjectDefaults {
  model?: string
  permissionMode?: 'ask' | 'auto'
}

/** A named workspace: directory + its own tab set + default settings. */
export interface Project {
  id: string
  name: string
  /** Absolute directory path */
  path: string
  defaults?: ProjectDefaults
  createdAt: number
  lastUsedAt: number
}
```

In `interface TabState`, after `additionalDirs: string[]`:

```ts
  /** Workspace this tab belongs to (null = built-in Scratch workspace) */
  projectId: string | null
```

In the `IPC` const, after `DELETE_SESSION`:

```ts
  // Projects (workspaces)
  PROJECTS_LIST: 'clod:projects-list',
  PROJECTS_CREATE: 'clod:projects-create',
  PROJECTS_UPDATE: 'clod:projects-update',
  PROJECTS_DELETE: 'clod:projects-delete',
```

Note: adding `projectId` to `TabState` breaks the build until `makeLocalTab()` in `src/renderer/stores/sessionStore.ts` initializes it. Add `projectId: null,` to the object returned by `makeLocalTab()` (after `additionalDirs: [],`) in this same task so typecheck stays green.

- [ ] **Step 2: Write the failing store tests**

Create `src/main/projects/store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ProjectsStore } from './store'

let file: string
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'clod-projects-')), 'projects.json')
})

describe('ProjectsStore', () => {
  it('starts empty', () => {
    expect(new ProjectsStore(file).list()).toEqual([])
  })

  it('creates a project with generated id and timestamps', () => {
    const store = new ProjectsStore(file)
    const p = store.create({ name: 'Clawde', path: '/Users/u/dev/clawde' })
    expect(p).not.toBeNull()
    expect(p!.name).toBe('Clawde')
    expect(p!.path).toBe('/Users/u/dev/clawde')
    expect(p!.id.length).toBeGreaterThan(0)
    expect(p!.createdAt).toBeGreaterThan(0)
    expect(p!.lastUsedAt).toBe(p!.createdAt)
    // Persisted: a fresh store instance sees it
    expect(new ProjectsStore(file).list()).toEqual([p])
  })

  it('rejects empty names, overlong names, and relative paths', () => {
    const store = new ProjectsStore(file)
    expect(store.create({ name: '   ', path: '/ok' })).toBeNull()
    expect(store.create({ name: 'x'.repeat(65), path: '/ok' })).toBeNull()
    expect(store.create({ name: 'ok', path: 'relative/path' })).toBeNull()
    expect(store.create({ name: 'ok', path: '/bad\npath' })).toBeNull()
    expect(store.list()).toEqual([])
  })

  it('updates name, defaults, and lastUsedAt', () => {
    const store = new ProjectsStore(file)
    const p = store.create({ name: 'A', path: '/a' })!
    const updated = store.update(p.id, { name: 'B', defaults: { model: 'claude-sonnet-5', permissionMode: 'auto' }, lastUsedAt: 123456 })
    expect(updated).toMatchObject({ name: 'B', defaults: { model: 'claude-sonnet-5', permissionMode: 'auto' }, lastUsedAt: 123456 })
    expect(new ProjectsStore(file).list()[0]).toMatchObject({ name: 'B' })
  })

  it('update on unknown id returns null; invalid patch values are rejected', () => {
    const store = new ProjectsStore(file)
    const p = store.create({ name: 'A', path: '/a' })!
    expect(store.update('nope', { name: 'X' })).toBeNull()
    expect(store.update(p.id, { name: '' })).toBeNull()
    expect(store.update(p.id, { path: 'not-absolute' })).toBeNull()
    expect(store.list()[0].name).toBe('A')
  })

  it('deletes and reports success', () => {
    const store = new ProjectsStore(file)
    const p = store.create({ name: 'A', path: '/a' })!
    expect(store.delete(p.id)).toBe(true)
    expect(store.delete(p.id)).toBe(false)
    expect(new ProjectsStore(file).list()).toEqual([])
  })

  it('survives a corrupt file (backed up, starts empty)', () => {
    writeFileSync(file, 'garbage{{{')
    expect(new ProjectsStore(file).list()).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- projects/store`
Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 4: Implement**

Create `src/main/projects/store.ts`:

```ts
/**
 * ProjectsStore — validated CRUD over projects.json in userData.
 * Backed by JsonFileStore (atomic writes, corrupt-file backup).
 */
import { randomUUID } from 'crypto'
import { JsonFileStore } from '../storage/json-store'
import type { Project, ProjectDefaults } from '../../shared/types'

const MAX_NAME_LENGTH = 64

function isValidName(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_NAME_LENGTH
}

function isValidPath(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('/') && !/[\0\r\n]/.test(v)
}

function isValidDefaults(v: unknown): v is ProjectDefaults {
  if (v === undefined) return true
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const d = v as ProjectDefaults
  if (d.model !== undefined && typeof d.model !== 'string') return false
  if (d.permissionMode !== undefined && d.permissionMode !== 'ask' && d.permissionMode !== 'auto') return false
  return true
}

export function isProject(v: unknown): v is Project {
  if (!v || typeof v !== 'object') return false
  const p = v as Project
  return typeof p.id === 'string' && p.id.length > 0
    && isValidName(p.name)
    && isValidPath(p.path)
    && isValidDefaults(p.defaults)
    && typeof p.createdAt === 'number'
    && typeof p.lastUsedAt === 'number'
}

export interface ProjectPatch {
  name?: string
  path?: string
  defaults?: ProjectDefaults
  lastUsedAt?: number
}

export class ProjectsStore {
  private store: JsonFileStore<Project>
  private projects: Project[]

  constructor(filePath: string) {
    this.store = new JsonFileStore<Project>(filePath, isProject)
    this.projects = this.store.load().items
  }

  list(): Project[] {
    return [...this.projects]
  }

  create(input: { name: string; path: string }): Project | null {
    if (!isValidName(input.name) || !isValidPath(input.path)) return null
    const now = Date.now()
    const project: Project = {
      id: randomUUID(),
      name: input.name.trim(),
      path: input.path,
      createdAt: now,
      lastUsedAt: now,
    }
    this.projects = [...this.projects, project]
    this.store.save(this.projects)
    return project
  }

  update(id: string, patch: ProjectPatch): Project | null {
    const existing = this.projects.find((p) => p.id === id)
    if (!existing) return null
    if (patch.name !== undefined && !isValidName(patch.name)) return null
    if (patch.path !== undefined && !isValidPath(patch.path)) return null
    if (patch.defaults !== undefined && !isValidDefaults(patch.defaults)) return null
    if (patch.lastUsedAt !== undefined && typeof patch.lastUsedAt !== 'number') return null

    const updated: Project = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.path !== undefined ? { path: patch.path } : {}),
      ...(patch.defaults !== undefined ? { defaults: patch.defaults } : {}),
      ...(patch.lastUsedAt !== undefined ? { lastUsedAt: patch.lastUsedAt } : {}),
    }
    this.projects = this.projects.map((p) => (p.id === id ? updated : p))
    this.store.save(this.projects)
    return updated
  }

  delete(id: string): boolean {
    if (!this.projects.some((p) => p.id === id)) return false
    this.projects = this.projects.filter((p) => p.id !== id)
    this.store.save(this.projects)
    return true
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- projects/store`
Expected: PASS. Then `npm run typecheck` — exit 0 (confirm the `makeLocalTab` addition from Step 1 landed).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/projects/store.ts src/main/projects/store.test.ts src/renderer/stores/sessionStore.ts
git commit -m "feat: project types and validated projects store"
```

---

### Task 3: Main IPC handlers + preload API

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `ProjectsStore` (Task 2), `IPC.PROJECTS_*` constants.
- Produces (Task 4 depends on these):
  - `window.clod.listProjects(): Promise<Project[]>`
  - `window.clod.createProject(name: string, path: string): Promise<Project | null>`
  - `window.clod.updateProject(id: string, patch: { name?: string; path?: string; defaults?: ProjectDefaults; lastUsedAt?: number }): Promise<Project | null>`
  - `window.clod.deleteProject(id: string): Promise<boolean>`

- [ ] **Step 1: Main handlers**

In `src/main/index.ts`, add to imports:

```ts
import { ProjectsStore } from './projects/store'
import type { ProjectPatch } from './projects/store'
```

Add lazy store accessor near the other module-level state (`app.getPath('userData')` is safe by the time any handler fires):

```ts
let projectsStore: ProjectsStore | null = null
function getProjectsStore(): ProjectsStore {
  if (!projectsStore) {
    projectsStore = new ProjectsStore(join(app.getPath('userData'), 'projects.json'))
  }
  return projectsStore
}
```

Add handlers after the `DELETE_SESSION` handler (search for `IPC.DELETE_SESSION`):

```ts
// ─── Projects (workspaces) ───

ipcMain.handle(IPC.PROJECTS_LIST, () => {
  return getProjectsStore().list()
})

ipcMain.handle(IPC.PROJECTS_CREATE, (_event, { name, path }: { name: string; path: string }) => {
  log(`IPC PROJECTS_CREATE: ${name} → ${path}`)
  return getProjectsStore().create({ name, path })
})

ipcMain.handle(IPC.PROJECTS_UPDATE, (_event, { id, patch }: { id: string; patch: ProjectPatch }) => {
  log(`IPC PROJECTS_UPDATE: ${id}`)
  return getProjectsStore().update(id, patch)
})

ipcMain.handle(IPC.PROJECTS_DELETE, (_event, { id }: { id: string }) => {
  log(`IPC PROJECTS_DELETE: ${id}`)
  return getProjectsStore().delete(id)
})
```

- [ ] **Step 2: Preload bridge**

In `src/preload/index.ts`:

Add `Project` and `ProjectDefaults` to the type-only import from `../shared/types`.

In `interface ClodAPI`, after `deleteSession(...)`:

```ts
  listProjects(): Promise<Project[]>
  createProject(name: string, path: string): Promise<Project | null>
  updateProject(id: string, patch: { name?: string; path?: string; defaults?: ProjectDefaults; lastUsedAt?: number }): Promise<Project | null>
  deleteProject(id: string): Promise<boolean>
```

In the `api` object, after the `deleteSession` entry:

```ts
  listProjects: () => ipcRenderer.invoke(IPC.PROJECTS_LIST),
  createProject: (name, path) => ipcRenderer.invoke(IPC.PROJECTS_CREATE, { name, path }),
  updateProject: (id, patch) => ipcRenderer.invoke(IPC.PROJECTS_UPDATE, { id, patch }),
  deleteProject: (id) => ipcRenderer.invoke(IPC.PROJECTS_DELETE, { id }),
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck` — exit 0. Run: `npm test` — all pass.

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "feat: projects IPC handlers and preload API"
```

---

### Task 4: Session store — workspace state and tab lifecycle

**Files:**
- Modify: `src/renderer/stores/sessionStore.ts`

**Interfaces:**
- Consumes: `window.clod.listProjects/createProject/updateProject/deleteProject` (Task 3), `Project` type.
- Produces (Tasks 5–6 and Phase 2 depend on these):
  - State: `projects: Project[]`, `activeProjectId: string | null` (persisted in `SessionPrefs`).
  - Actions: `loadProjects(): Promise<void>`, `setActiveProject(projectId: string | null): Promise<void>`, `addProject(name: string, path: string): Promise<Project | null>`, `editProject(id: string, patch: { name?: string; defaults?: ProjectDefaults }): Promise<void>`, `removeProject(id: string): Promise<void>`.
  - Semantics: `setActiveProject` persists the choice, applies the project's defaults to the global model/permission pickers, focuses the workspace's most recent tab or creates one, and bumps `lastUsedAt`.

- [ ] **Step 1: Prefs persistence for `activeProjectId`**

In `src/renderer/stores/sessionStore.ts`:

Extend `SessionPrefs`:

```ts
interface SessionPrefs {
  preferredModel: string | null
  permissionMode: 'ask' | 'auto'
  defaultDirOverride: string | null
  activeProjectId: string | null
}
```

`DEFAULT_PREFS` gains `activeProjectId: null,`. In `loadPrefs()`, add to the returned object:

```ts
        activeProjectId: typeof p.activeProjectId === 'string' ? p.activeProjectId : null,
```

Replace the three existing `savePrefs({ ... })` call bodies (in `setPreferredModel`, `setPermissionMode`, `setDefaultDirOverride`) with a shared snapshot helper. Add above the store creation:

```ts
function prefsSnapshot(s: Pick<State, 'preferredModel' | 'permissionMode' | 'defaultDirOverride' | 'activeProjectId'>): SessionPrefs {
  return {
    preferredModel: s.preferredModel,
    permissionMode: s.permissionMode,
    defaultDirOverride: s.defaultDirOverride,
    activeProjectId: s.activeProjectId,
  }
}
```

and change each setter to `savePrefs(prefsSnapshot(get()))` after its `set(...)` call.

- [ ] **Step 2: State fields, types, and actions**

Add to the type-only import from `../../shared/types`: `Project`, `ProjectDefaults`.

In `interface State`, after `defaultDirOverride`:

```ts
  /** Known projects (workspaces), loaded from main on startup. */
  projects: Project[]
  /** Active workspace (null = Scratch). Persisted. */
  activeProjectId: string | null
```

and in the actions section:

```ts
  loadProjects: () => Promise<void>
  setActiveProject: (projectId: string | null) => Promise<void>
  addProject: (name: string, path: string) => Promise<Project | null>
  editProject: (id: string, patch: { name?: string; defaults?: ProjectDefaults }) => Promise<void>
  removeProject: (id: string) => Promise<void>
```

Initial state (after `defaultDirOverride: initialPrefs.defaultDirOverride,`):

```ts
  projects: [],
  activeProjectId: initialPrefs.activeProjectId,
```

Add implementations after `setDefaultDirOverride`:

```ts
  loadProjects: async () => {
    try {
      const projects = await window.clod.listProjects()
      set((s) => ({
        projects,
        // Drop a persisted active project that no longer exists
        activeProjectId: s.activeProjectId && projects.some((p) => p.id === s.activeProjectId)
          ? s.activeProjectId
          : null,
      }))
      savePrefs(prefsSnapshot(get()))
    } catch {}
  },

  setActiveProject: async (projectId) => {
    const s = get()
    const project = projectId ? s.projects.find((p) => p.id === projectId) : null
    if (projectId && !project) return

    set({ activeProjectId: projectId, marketplaceOpen: false })
    savePrefs(prefsSnapshot(get()))

    // Defaults-at-activation: apply the project's defaults to the global pickers
    if (project?.defaults?.model) get().setPreferredModel(project.defaults.model)
    if (project?.defaults?.permissionMode) get().setPermissionMode(project.defaults.permissionMode)

    // Focus the workspace's most recent tab, or create one
    const visible = get().tabs.filter((t) => (t.projectId ?? null) === (projectId ?? null))
    if (visible.length > 0) {
      set({ activeTabId: visible[visible.length - 1].id })
    } else {
      await get().createTab()
    }

    if (project) {
      const now = Date.now()
      window.clod.updateProject(project.id, { lastUsedAt: now }).catch(() => {})
      set((prev) => ({
        projects: prev.projects.map((p) => (p.id === project.id ? { ...p, lastUsedAt: now } : p)),
      }))
    }
  },

  addProject: async (name, path) => {
    const project = await window.clod.createProject(name, path).catch(() => null)
    if (!project) return null
    set((s) => ({ projects: [...s.projects, project] }))
    return project
  },

  editProject: async (id, patch) => {
    const updated = await window.clod.updateProject(id, patch).catch(() => null)
    if (updated) {
      set((s) => ({ projects: s.projects.map((p) => (p.id === id ? updated : p)) }))
    }
  },

  removeProject: async (id) => {
    const ok = await window.clod.deleteProject(id).catch(() => false)
    if (!ok) return
    // Never delete sessions or directories; move the project's tabs to Scratch
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      tabs: s.tabs.map((t) => (t.projectId === id ? { ...t, projectId: null } : t)),
    }))
    if (get().activeProjectId === id) {
      await get().setActiveProject(null)
    }
  },
```

- [ ] **Step 3: `createTab` inherits the active workspace**

Replace the body of `createTab` with:

```ts
  createTab: async () => {
    const s0 = get()
    const activeProject = s0.activeProjectId
      ? s0.projects.find((p) => p.id === s0.activeProjectId) ?? null
      : null
    const homeDir = s0.defaultDirOverride || s0.staticInfo?.defaultDir || s0.staticInfo?.homePath || '~'
    const dir = activeProject ? activeProject.path : homeDir
    const projectId = activeProject?.id ?? null
    try {
      const { tabId } = await window.clod.createTab()
      const tab: TabState = {
        ...makeLocalTab(),
        id: tabId,
        workingDirectory: dir,
        hasChosenDirectory: !!activeProject,
        projectId,
      }
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
      }))
      return tabId
    } catch {
      const tab = makeLocalTab()
      tab.workingDirectory = dir
      tab.hasChosenDirectory = !!activeProject
      tab.projectId = projectId
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
      }))
      return tab.id
    }
  },
```

(`TabState` is already imported as a type.)

- [ ] **Step 4: `closeTab` scoped to the workspace**

Replace the body of `closeTab` with:

```ts
  closeTab: (tabId) => {
    window.clod.closeTab(tabId).catch(() => {})

    const s = get()
    const closing = s.tabs.find((t) => t.id === tabId)
    const remaining = s.tabs.filter((t) => t.id !== tabId)

    if (s.activeTabId !== tabId) {
      set({ tabs: remaining })
      return
    }

    const scope = closing?.projectId ?? null
    const visibleBefore = s.tabs.filter((t) => (t.projectId ?? null) === scope)
    const visibleRemaining = remaining.filter((t) => (t.projectId ?? null) === scope)

    if (visibleRemaining.length > 0) {
      const closedIndex = visibleBefore.findIndex((t) => t.id === tabId)
      const newActive = visibleRemaining[Math.min(closedIndex, visibleRemaining.length - 1)]
      set({ tabs: remaining, activeTabId: newActive.id })
      return
    }

    // Last visible tab in this workspace — replace with a fresh one (local
    // immediately, real backend tab id swapped in when available).
    const project = scope ? s.projects.find((p) => p.id === scope) ?? null : null
    const newTab = makeLocalTab()
    newTab.projectId = scope
    if (project) {
      newTab.workingDirectory = project.path
      newTab.hasChosenDirectory = true
    } else {
      newTab.workingDirectory = s.defaultDirOverride || s.staticInfo?.defaultDir || s.staticInfo?.homePath || '~'
    }
    set({ tabs: [...remaining, newTab], activeTabId: newTab.id })
    window.clod.createTab().then(({ tabId: realId }) => {
      set((prev) => ({
        tabs: prev.tabs.map((t) => (t.id === newTab.id ? { ...t, id: realId } : t)),
        activeTabId: prev.activeTabId === newTab.id ? realId : prev.activeTabId,
      }))
    }).catch(() => {})
  },
```

- [ ] **Step 5: `resumeSession` joins the matching workspace**

In `resumeSession`, after `const defaultDir = ...`, add:

```ts
    const matchedProject = get().projects.find((p) => p.path === defaultDir) ?? null
```

In the success branch, add to the constructed tab object:

```ts
        projectId: matchedProject?.id ?? null,
```

and change that branch's `set` call to also switch the workspace so the resumed tab is visible:

```ts
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        activeProjectId: matchedProject?.id ?? null,
        isExpanded: true,
      }))
      savePrefs(prefsSnapshot(get()))
```

Mirror both changes in the catch branch (`tab.projectId = matchedProject?.id ?? null` plus the same `activeProjectId` + `savePrefs` handling).

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck` — exit 0. Run: `npm test` — all pass.

Manual: no visible UI change yet (switcher lands in Task 5); confirm the app still launches, tabs open/close, sessions resume.

```bash
git add src/renderer/stores/sessionStore.ts
git commit -m "feat: workspace state and project-scoped tab lifecycle in session store"
```

---

### Task 5: TabStrip filtering + ProjectSwitcher UI

**Files:**
- Create: `src/renderer/components/ProjectSwitcher.tsx`
- Modify: `src/renderer/components/TabStrip.tsx`

**Interfaces:**
- Consumes: session store fields/actions from Task 4; `usePopoverLayer`, `useColors` patterns (copy `ModelPicker` in `StatusBar.tsx`).
- Produces: `<ProjectSwitcher />` component (no props), rendered at the left edge of the TabStrip.

- [ ] **Step 1: Filter the TabStrip to the active workspace**

In `src/renderer/components/TabStrip.tsx`:

Add to the `TabStrip` component's store hooks:

```ts
  const activeProjectId = useSessionStore((s) => s.activeProjectId)
```

Add after the hooks:

```ts
  const visibleTabs = tabs.filter((t) => (t.projectId ?? null) === (activeProjectId ?? null))
```

Change `{tabs.map((tab) => {` to `{visibleTabs.map((tab) => {` and the close-button guard `{tabs.length > 1 && (` to `{visibleTabs.length > 1 && (`.

Import and mount the switcher: add `import { ProjectSwitcher } from './ProjectSwitcher'` and insert `<ProjectSwitcher />` as the first child of the root flex div, before the scrollable tabs area:

```tsx
      <ProjectSwitcher />

      {/* Scrollable tabs area — clipped by master card edge */}
```

- [ ] **Step 2: Create the ProjectSwitcher component**

Create `src/renderer/components/ProjectSwitcher.tsx`:

```tsx
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { CaretDown, Check, FolderSimple, House, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { useSessionStore, AVAILABLE_MODELS } from '../stores/sessionStore'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../theme'
import type { Project } from '../../shared/types'

/** Compact display path: ~-relative if under home is unknown, else basename-focused */
function compactPath(fullPath: string): string {
  const parts = fullPath.replace(/\/$/, '').split('/')
  if (parts.length <= 3) return fullPath
  return `…/${parts.slice(-2).join('/')}`
}

export function ProjectSwitcher() {
  const projects = useSessionStore((s) => s.projects)
  const activeProjectId = useSessionStore((s) => s.activeProjectId)
  const setActiveProject = useSessionStore((s) => s.setActiveProject)
  const addProject = useSessionStore((s) => s.addProject)
  const editProject = useSessionStore((s) => s.editProject)
  const removeProject = useSessionStore((s) => s.removeProject)
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [open, setOpen] = useState(false)
  // 'list' = project rows; 'new' = name a just-picked directory; string = edit that project id
  const [mode, setMode] = useState<'list' | 'new' | string>('list')
  const [draftName, setDraftName] = useState('')
  const [draftPath, setDraftPath] = useState('')
  const [draftModel, setDraftModel] = useState<string | undefined>(undefined)
  const [draftPerms, setDraftPerms] = useState<'ask' | 'auto' | undefined>(undefined)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) ?? null : null

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 6, left: rect.left })
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
      setMode('list')
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleToggle = () => {
    if (!open) {
      updatePos()
      setMode('list')
    }
    setOpen((o) => !o)
  }

  const handleSelect = (projectId: string | null) => {
    setOpen(false)
    setMode('list')
    void setActiveProject(projectId)
  }

  const handleNewProject = async () => {
    const dir = await window.clod.selectDirectory()
    if (!dir) return
    setDraftPath(dir)
    setDraftName(dir.replace(/\/$/, '').split('/').pop() || 'Project')
    setMode('new')
  }

  const handleCreate = async () => {
    if (!draftName.trim() || !draftPath) return
    const project = await addProject(draftName.trim(), draftPath)
    setMode('list')
    if (project) handleSelect(project.id)
  }

  const startEdit = (p: Project) => {
    setDraftName(p.name)
    setDraftModel(p.defaults?.model)
    setDraftPerms(p.defaults?.permissionMode)
    setMode(p.id)
  }

  const handleSaveEdit = async (projectId: string) => {
    if (!draftName.trim()) return
    await editProject(projectId, {
      name: draftName.trim(),
      defaults: (draftModel || draftPerms) ? { model: draftModel, permissionMode: draftPerms } : undefined,
    })
    setMode('list')
  }

  const rowClass = 'w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors text-left rounded-lg'

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex items-center gap-1 flex-shrink-0 rounded-full transition-colors select-none"
        style={{ color: colors.textSecondary, padding: '4px 6px 4px 10px', maxWidth: 150, fontSize: 12, fontWeight: 500 }}
        title={activeProject ? `${activeProject.name} — ${activeProject.path}` : 'Scratch workspace'}
      >
        {activeProject ? <FolderSimple size={13} className="flex-shrink-0" /> : <House size={13} className="flex-shrink-0" />}
        <span className="truncate">{activeProject ? activeProject.name : 'Scratch'}</span>
        <CaretDown size={10} style={{ opacity: 0.6 }} className="flex-shrink-0" />
      </button>

      {popoverLayer && open && createPortal(
        <motion.div
          ref={popoverRef}
          data-clod-ui
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.12 }}
          className="rounded-xl"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: 240,
            pointerEvents: 'auto',
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
            zIndex: 50,
          }}
        >
          <div className="p-1.5">
            {mode === 'new' ? (
              <div className="p-1.5 flex flex-col gap-1.5">
                <div className="text-[10px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>
                  New project
                </div>
                <div className="text-[10px] truncate" style={{ color: colors.textTertiary }} title={draftPath}>
                  {compactPath(draftPath)}
                </div>
                <input
                  autoFocus
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); if (e.key === 'Escape') setMode('list') }}
                  placeholder="Project name"
                  className="w-full rounded-md px-2 py-1 text-[11px]"
                  style={{ background: colors.surfaceSecondary, color: colors.textPrimary, border: `1px solid ${colors.containerBorder}`, outline: 'none' }}
                />
                <div className="flex gap-1 justify-end">
                  <button onClick={() => setMode('list')} className="rounded-md px-2 py-1 text-[11px]" style={{ color: colors.textTertiary }}>
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleCreate()}
                    disabled={!draftName.trim()}
                    className="rounded-md px-2 py-1 text-[11px] font-medium disabled:opacity-40"
                    style={{ background: colors.accent, color: colors.textOnAccent }}
                  >
                    Create
                  </button>
                </div>
              </div>
            ) : mode !== 'list' ? (
              (() => {
                const editing = projects.find((p) => p.id === mode)
                if (!editing) return null
                return (
                  <div className="p-1.5 flex flex-col gap-1.5">
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>
                      Edit project
                    </div>
                    <input
                      autoFocus
                      type="text"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveEdit(editing.id); if (e.key === 'Escape') setMode('list') }}
                      className="w-full rounded-md px-2 py-1 text-[11px]"
                      style={{ background: colors.surfaceSecondary, color: colors.textPrimary, border: `1px solid ${colors.containerBorder}`, outline: 'none' }}
                    />
                    <div className="text-[10px]" style={{ color: colors.textTertiary }}>Default model</div>
                    <div className="flex gap-1">
                      {AVAILABLE_MODELS.map((m) => {
                        const active = draftModel === m.id
                        return (
                          <button
                            key={m.id}
                            onClick={() => setDraftModel(active ? undefined : m.id)}
                            className="flex-1 rounded-md px-1 py-1 text-[10px] font-medium transition-colors"
                            style={{
                              background: active ? colors.accent : colors.surfaceSecondary,
                              color: active ? colors.textOnAccent : colors.textSecondary,
                              border: `1px solid ${active ? colors.accent : colors.containerBorder}`,
                            }}
                          >
                            {m.label}
                          </button>
                        )
                      })}
                    </div>
                    <div className="text-[10px]" style={{ color: colors.textTertiary }}>Default permissions</div>
                    <div className="flex gap-1">
                      {(['ask', 'auto'] as const).map((pm) => {
                        const active = draftPerms === pm
                        return (
                          <button
                            key={pm}
                            onClick={() => setDraftPerms(active ? undefined : pm)}
                            className="flex-1 rounded-md px-1 py-1 text-[10px] font-medium capitalize transition-colors"
                            style={{
                              background: active ? colors.accent : colors.surfaceSecondary,
                              color: active ? colors.textOnAccent : colors.textSecondary,
                              border: `1px solid ${active ? colors.accent : colors.containerBorder}`,
                            }}
                          >
                            {pm}
                          </button>
                        )
                      })}
                    </div>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setMode('list')} className="rounded-md px-2 py-1 text-[11px]" style={{ color: colors.textTertiary }}>
                        Cancel
                      </button>
                      <button
                        onClick={() => void handleSaveEdit(editing.id)}
                        className="rounded-md px-2 py-1 text-[11px] font-medium"
                        style={{ background: colors.accent, color: colors.textOnAccent }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )
              })()
            ) : (
              <>
                <button className={rowClass} onClick={() => handleSelect(null)} style={{ color: colors.textPrimary }}>
                  <House size={13} style={{ color: colors.textTertiary }} />
                  <span className="flex-1">Scratch</span>
                  {activeProjectId === null && <Check size={12} style={{ color: colors.accent }} />}
                </button>

                {projects.map((p) => (
                  <div key={p.id} className="group flex items-center">
                    <button className={`${rowClass} flex-1 min-w-0`} onClick={() => handleSelect(p.id)} style={{ color: colors.textPrimary }}>
                      <FolderSimple size={13} style={{ color: colors.textTertiary }} className="flex-shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p.name}</span>
                        <span className="block truncate text-[9px]" style={{ color: colors.textTertiary }}>{compactPath(p.path)}</span>
                      </span>
                      {activeProjectId === p.id && <Check size={12} style={{ color: colors.accent }} className="flex-shrink-0" />}
                    </button>
                    <button
                      onClick={() => startEdit(p)}
                      className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                      style={{ color: colors.textTertiary }}
                      title="Edit project"
                    >
                      <PencilSimple size={11} />
                    </button>
                    <button
                      onClick={() => void removeProject(p.id)}
                      className="flex-shrink-0 w-5 h-5 mr-1 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                      style={{ color: colors.statusError }}
                      title="Remove project (sessions and files are kept)"
                    >
                      <Trash size={11} />
                    </button>
                  </div>
                ))}

                <div className="mx-1.5 my-1" style={{ height: 1, background: colors.popoverBorder }} />

                <button className={rowClass} onClick={() => void handleNewProject()} style={{ color: colors.accent }}>
                  <Plus size={12} />
                  New project…
                </button>
              </>
            )}
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — exit 0. Run: `npm test` — all pass.

Manual: switcher shows "Scratch" at TabStrip left; "New project…" opens the directory dialog then the naming panel; creating switches to the project with a fresh tab at its path (StatusBar folder shows the project dir); switching back to Scratch swaps the tab set; tabs keep running across switches (start a long prompt, switch away and back); edit renames and sets defaults; delete moves its tabs to Scratch.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ProjectSwitcher.tsx src/renderer/components/TabStrip.tsx
git commit -m "feat: project switcher and workspace-filtered tab strip"
```

---

### Task 6: Project-aware history + startup restore

**Files:**
- Modify: `src/renderer/components/HistoryPicker.tsx`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `window.clod.listSessions(projectPath)` (existing — lists `~/.claude/projects/<encoded-path>/*.jsonl` for one directory), session store from Task 4.
- Produces: HistoryPicker "All projects" toggle; startup lands in the persisted active workspace.

- [ ] **Step 1: HistoryPicker — active project by default, "All" on demand**

In `src/renderer/components/HistoryPicker.tsx`:

Add a store hook after `staticInfo`:

```ts
  const projects = useSessionStore((s) => s.projects)
```

Add state next to `sessions`:

```ts
  const [allProjects, setAllProjects] = useState(false)
```

Sessions need to remember which directory they came from (so resume targets the right workspace). Change the sessions state type and loader:

```ts
  type TaggedSession = SessionMeta & { projectPath: string }
  const [sessions, setSessions] = useState<TaggedSession[]>([])
```

Replace `loadSessions` with:

```ts
  const loadSessions = useCallback(async () => {
    setLoading(true)
    try {
      const paths = allProjects
        ? Array.from(new Set([effectiveProjectPath, ...projects.map((p) => p.path)]))
        : [effectiveProjectPath]
      const results = await Promise.all(paths.map(async (p) => {
        const list = await window.clod.listSessions(p).catch(() => [] as SessionMeta[])
        return list.map((s) => ({ ...s, projectPath: p }))
      }))
      const merged = results.flat().sort(
        (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
      )
      setSessions(merged)
    } catch {
      setSessions([])
    }
    setLoading(false)
  }, [effectiveProjectPath, allProjects, projects])
```

Reload when the toggle flips while open:

```ts
  useEffect(() => {
    if (open) void loadSessions()
  }, [allProjects])  // eslint-disable-line react-hooks/exhaustive-deps
```

In `handleSelect`, resume with the session's own path:

```ts
    void resumeSession(session.sessionId, title, session.projectPath)
```

(where `session: TaggedSession`), and in `handleDelete` use `session.projectPath` instead of `effectiveProjectPath`.

In the header row (`Recent Sessions`), add the toggle button — replace the header div with:

```tsx
          <div className="px-3 py-2 text-[11px] font-medium flex-shrink-0 flex items-center justify-between" style={{ color: colors.textTertiary, borderBottom: `1px solid ${colors.popoverBorder}` }}>
            <span>Recent Sessions</span>
            <button
              onClick={() => setAllProjects((v) => !v)}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors"
              style={{
                background: allProjects ? colors.accent : colors.surfaceSecondary,
                color: allProjects ? colors.textOnAccent : colors.textSecondary,
                border: `1px solid ${allProjects ? colors.accent : colors.containerBorder}`,
              }}
              title={allProjects ? 'Showing sessions from all projects' : 'Showing this workspace only'}
            >
              All
            </button>
          </div>
```

When `allProjects` is on, show which project a session belongs to — inside the session row metadata (the div with `formatTimeAgo`), append:

```tsx
                      {allProjects && (
                        <span className="truncate" style={{ color: colors.textTertiary }}>
                          {projects.find((p) => p.path === session.projectPath)?.name
                            ?? session.projectPath.split('/').pop()}
                        </span>
                      )}
```

- [ ] **Step 2: Startup lands in the persisted workspace**

In `src/renderer/App.tsx`, replace the existing startup effect body (the one calling `initStaticInfo().then(...)`) with:

```ts
  useEffect(() => {
    useSessionStore.getState().initStaticInfo().then(async () => {
      await useSessionStore.getState().loadProjects()
      const st = useSessionStore.getState()
      const project = st.activeProjectId ? st.projects.find((p) => p.id === st.activeProjectId) ?? null : null
      const homeDir = st.defaultDirOverride || st.staticInfo?.defaultDir || st.staticInfo?.homePath || '~'
      const dir = project ? project.path : homeDir
      const tab = st.tabs[0]
      if (tab) {
        // Point the initial tab at the restored workspace (or home for Scratch)
        useSessionStore.setState((s) => ({
          tabs: s.tabs.map((t, i) => (i === 0
            ? { ...t, workingDirectory: dir, hasChosenDirectory: !!project, projectId: project?.id ?? null }
            : t)),
        }))
        window.clod.createTab().then(({ tabId }) => {
          useSessionStore.setState((s) => ({
            tabs: s.tabs.map((t, i) => (i === 0 ? { ...t, id: tabId } : t)),
            activeTabId: tabId,
          }))
        }).catch(() => {})
      }
    })
  }, [])
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — exit 0. Run: `npm test` — all pass.

Manual checklist (restart dev server):
1. Create two projects; quit and relaunch → app opens in the last active project with a tab at its path.
2. History picker in a project shows only that project's sessions; "All" merges Scratch + all projects, labeled by project, sorted newest-first.
3. Resuming an "All"-list session from another project switches to that project's workspace.
4. Deleting a session works from both views.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/HistoryPicker.tsx src/renderer/App.tsx
git commit -m "feat: project-scoped session history and workspace restore on launch"
```
