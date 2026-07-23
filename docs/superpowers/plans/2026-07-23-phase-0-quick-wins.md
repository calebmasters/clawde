# Phase 0: Quick Wins — Chat Expanded by Default + Terminal Launcher

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat conversation is visible by default (with a setting), reply copy button is discoverable, and "Open in CLI" launches the user's actual terminal (Ghostty on this machine) instead of hardcoded Terminal.app.

**Architecture:** Two independent changes. (1) Renderer-only: flip the `isExpanded` default in the Zustand session store, auto-expand on send, add a persisted "Start expanded" setting to the theme store. (2) A new pure main-process module `terminal-launcher.ts` that detects installed terminals, builds per-terminal launch plans (AppleScript or `open -na` args), and replaces the hardcoded AppleScript body of the `OPEN_IN_TERMINAL` IPC handler; a Settings dropdown picks the terminal.

**Tech Stack:** Electron 33 main process (Node), React 19 + Zustand 5 renderer, vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-07-23-clod-expansion-design.md` (Phase 0 section).

## Global Constraints

- TypeScript strict mode: `npm run typecheck` must pass with zero errors before every commit.
- `npm test` (vitest) must pass before every commit.
- Use `IPC.*` constants for IPC channel names — never raw strings. New channels: declare in `src/shared/types.ts`, wire in **both** `src/preload/index.ts` and `src/main/index.ts`.
- Renderer colors only via `useColors()` — never hardcode.
- Renderer and main never import each other; the preload bridge is the only crossing point.
- No new network calls. Do not weaken any security invariant (permission server binds 127.0.0.1, per-launch secret, per-run tokens, `maskSensitiveFields`, 5-minute auto-deny).
- Icons: Phosphor (`@phosphor-icons/react`). Animations: Framer Motion.
- Commit format `<type>: <description>` (feat/fix/refactor/docs/test/chore). No attribution trailers.
- Main-process changes require a full `npm run dev` restart; renderer hot-reloads.
- Existing shell-escaping and validation rules for terminal launch (single-quote shell escaping, AppleScript escaping, UUID-validated sessionId, absolute-path check) must be preserved exactly.

---

### Task 1: Chat expanded by default (+ setting) and visible copy button

**Files:**
- Modify: `src/renderer/theme.ts` (theme store: new `startExpanded` setting)
- Modify: `src/renderer/stores/sessionStore.ts` (initial `isExpanded`, auto-expand on send)
- Modify: `src/renderer/components/SettingsPopover.tsx` (toggle row)
- Modify: `src/renderer/components/ConversationView.tsx` (copy button visibility)

**Interfaces:**
- Consumes: existing `useThemeStore` persistence pattern (`PersistedSettings`, `loadSettings`, `persist()`).
- Produces: `useThemeStore` gains `startExpanded: boolean` and `setStartExpanded(on: boolean): void`. Task 3 of this plan and later phases rely on this exact persistence pattern for further settings.

There is no renderer test infrastructure (vitest covers `src/main` only; the session store imports an mp3 asset and constructs `Audio` at module scope). Verification for this task is `npm run typecheck` + manual smoke test.

- [ ] **Step 1: Add `startExpanded` to the theme store**

In `src/renderer/theme.ts`, apply all of the following:

In `interface ThemeState` (after `openAtLogin: boolean`):

```ts
  /** Whether the chat card starts expanded when the app launches */
  startExpanded: boolean
```

and after `setOpenAtLogin: (on: boolean) => void`:

```ts
  setStartExpanded: (on: boolean) => void
```

In `interface PersistedSettings` (after `openAtLogin: boolean`):

```ts
  startExpanded: boolean
```

In `DEFAULT_SETTINGS` (after `openAtLogin: true,`):

```ts
  startExpanded: true,
```

In `loadSettings()` inside the returned object (after the `openAtLogin` line):

```ts
        startExpanded: typeof p.startExpanded === 'boolean' ? p.startExpanded : true,
```

In the `persist()` snapshot object (after `openAtLogin: s.openAtLogin,`):

```ts
      startExpanded: s.startExpanded,
```

In the store's returned initial state (after `openAtLogin: saved.openAtLogin,`):

```ts
    startExpanded: saved.startExpanded,
```

And the setter, after the `setOpenAtLogin` implementation:

```ts
    setStartExpanded: (on) => {
      set({ startExpanded: on })
      persist()
    },
```

- [ ] **Step 2: Use it in the session store and auto-expand on send**

In `src/renderer/stores/sessionStore.ts`:

Change the initial value (currently `isExpanded: false,` near the top of the `create<State>` initializer):

```ts
  isExpanded: useThemeStore.getState().startExpanded,
```

(`useThemeStore` is already imported at the top of the file.)

In `sendMessage`, the optimistic update currently starts with `set((s) => ({ tabs: s.tabs.map((t) => {`. Add `isExpanded: true` to the returned partial so sending always reveals the conversation:

```ts
    set((s) => ({
      isExpanded: true,
      tabs: s.tabs.map((t) => {
```

(only the first line changes — the `tabs` mapping body stays as is).

- [ ] **Step 3: Settings toggle row**

In `src/renderer/components/SettingsPopover.tsx`:

Add `ChatCircle` to the Phosphor import list at the top:

```ts
import { DotsThree, Bell, ArrowsOutSimple, Moon, ShieldCheck, FolderOpen, Cpu, Warning, AlignBottom, Keyboard, Sparkle, TextAa, Power, ChatCircle } from '@phosphor-icons/react'
```

Add store hooks near the other theme-store hooks (after the `setOpenAtLogin` line):

```ts
  const startExpanded = useThemeStore((s) => s.startExpanded)
  const setStartExpanded = useThemeStore((s) => s.setStartExpanded)
```

Add a new row directly after the "Full width" section's closing `</div>` and its divider (`<div style={{ height: 1, background: colors.popoverBorder }} />`):

```tsx
            {/* Start expanded */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ChatCircle size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Start expanded
                  </div>
                </div>
                <RowToggle
                  checked={startExpanded}
                  onChange={setStartExpanded}
                  colors={colors}
                  label="Open the chat expanded by default"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />
```

- [ ] **Step 4: Make the reply copy button discoverable**

In `src/renderer/components/ConversationView.tsx`, in `AssistantMessage`, the copy button wrapper is currently:

```tsx
        <div className="absolute bottom-0 right-0 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-100">
```

Change to always faintly visible, full opacity on hover:

```tsx
        <div className="absolute bottom-0 right-0 opacity-60 group-hover/msg:opacity-100 transition-opacity duration-100">
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: exit 0, no errors.

Run: `npm test`
Expected: all existing tests pass (no new tests in this task).

Manual (requires `npm run dev` and a dev restart since nothing in main changed, renderer hot-reload is enough): summon overlay → chat card is expanded before any message; send a prompt while collapsed → card expands; Settings shows "Start expanded" on by default; toggling it off + reloading the renderer starts collapsed; the Copy button on a reply is faintly visible without hover.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/theme.ts src/renderer/stores/sessionStore.ts src/renderer/components/SettingsPopover.tsx src/renderer/components/ConversationView.tsx
git commit -m "feat: start chat expanded by default with setting, visible copy button"
```

---

### Task 2: Terminal launcher module (TDD)

**Files:**
- Create: `src/main/terminal-launcher.ts`
- Test: `src/main/terminal-launcher.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks. Node `fs.existsSync`, `os.homedir`, `child_process.execFile`.
- Produces (Task 3 depends on these exact signatures):
  - `type TerminalId = 'ghostty' | 'iterm2' | 'wezterm' | 'kitty' | 'alacritty' | 'warp' | 'terminal'`
  - `TERMINALS: TerminalDef[]` (priority-ordered; `TerminalDef = { id: TerminalId; name: string; bundleNames: string[]; processNames: string[] }`)
  - `detectInstalled(deps?: { exists: (p: string) => boolean; home: string }): TerminalId[]`
  - `detectRunning(candidates: TerminalId[], isRunning?: (processName: string) => Promise<boolean>): Promise<TerminalId | null>`
  - `resolveTerminal(preferred: string, installed: TerminalId[], running: TerminalId | null): TerminalId`
  - `buildLaunchPlan(terminal: TerminalId, cwd: string, command: string[]): LaunchPlan` where `LaunchPlan = { kind: 'osascript'; script: string } | { kind: 'open'; args: string[] }`
  - `launchInTerminal(req: { preferred: string; cwd: string; command: string[] }): Promise<{ ok: boolean; terminal: TerminalId; fellBack: boolean }>`

Ghostty facts verified on this machine (Ghostty 1.3.1): macOS launch must go through `open -na Ghostty.app --args …`; `-e <command…>` runs a command; config keys pass as `--key=value` flags (`--working-directory=<dir>`). `+new-window` is NOT supported on macOS.

- [ ] **Step 1: Write the failing tests**

Create `src/main/terminal-launcher.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  TERMINALS,
  detectInstalled,
  resolveTerminal,
  buildLaunchPlan,
  type TerminalId,
} from './terminal-launcher'

const CMD = ['claude', '--resume', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']

describe('detectInstalled', () => {
  it('returns terminals in priority order based on bundle presence', () => {
    const present = new Set([
      '/Applications/Ghostty.app',
      '/Users/u/Applications/iTerm.app',
      '/System/Applications/Utilities/Terminal.app',
    ])
    const result = detectInstalled({ exists: (p) => present.has(p), home: '/Users/u' })
    expect(result).toEqual(['ghostty', 'iterm2', 'terminal'])
  })

  it('always includes terminal (Terminal.app ships with macOS)', () => {
    const result = detectInstalled({ exists: () => false, home: '/Users/u' })
    expect(result).toEqual(['terminal'])
  })
})

describe('resolveTerminal', () => {
  it('explicit preference wins when installed', () => {
    expect(resolveTerminal('kitty', ['ghostty', 'kitty', 'terminal'], 'ghostty')).toBe('kitty')
  })
  it('ignores preference not installed, falls to running', () => {
    expect(resolveTerminal('kitty', ['ghostty', 'terminal'], 'ghostty')).toBe('ghostty')
  })
  it('auto → running terminal first', () => {
    expect(resolveTerminal('auto', ['ghostty', 'iterm2', 'terminal'], 'iterm2')).toBe('iterm2')
  })
  it('auto with nothing running → first installed', () => {
    expect(resolveTerminal('auto', ['ghostty', 'terminal'], null)).toBe('ghostty')
  })
  it('empty installed → terminal', () => {
    expect(resolveTerminal('auto', [], null)).toBe('terminal')
  })
})

describe('buildLaunchPlan', () => {
  it('terminal (Terminal.app) uses AppleScript with shell-quoted cd', () => {
    const plan = buildLaunchPlan('terminal', '/Users/u/dev/proj', CMD)
    expect(plan.kind).toBe('osascript')
    if (plan.kind !== 'osascript') return
    expect(plan.script).toContain('tell application "Terminal"')
    expect(plan.script).toContain(`cd '/Users/u/dev/proj' && claude --resume aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`)
  })

  it('escapes single quotes in the cwd for AppleScript terminals', () => {
    const plan = buildLaunchPlan('terminal', "/Users/u/it's here", ['claude'])
    if (plan.kind !== 'osascript') throw new Error('expected osascript')
    // shell single-quote escaping: ' → '\''
    expect(plan.script).toContain(`cd '/Users/u/it'\\''s here' && claude`)
  })

  it('iterm2 uses create window + write text', () => {
    const plan = buildLaunchPlan('iterm2', '/tmp', ['claude'])
    if (plan.kind !== 'osascript') throw new Error('expected osascript')
    expect(plan.script).toContain('tell application "iTerm2"')
    expect(plan.script).toContain('create window with default profile')
    expect(plan.script).toContain(`write text "cd '/tmp' && claude"`)
  })

  it('ghostty uses open -na with --working-directory and -e', () => {
    const plan = buildLaunchPlan('ghostty', '/Users/u/dev/proj', CMD)
    expect(plan).toEqual({
      kind: 'open',
      args: ['-na', 'Ghostty.app', '--args', '--working-directory=/Users/u/dev/proj', '-e', ...CMD],
    })
  })

  it('kitty uses --directory', () => {
    const plan = buildLaunchPlan('kitty', '/tmp', ['claude'])
    expect(plan).toEqual({ kind: 'open', args: ['-na', 'kitty.app', '--args', '--directory', '/tmp', 'claude'] })
  })

  it('alacritty uses --working-directory and -e', () => {
    const plan = buildLaunchPlan('alacritty', '/tmp', ['claude'])
    expect(plan).toEqual({ kind: 'open', args: ['-na', 'Alacritty.app', '--args', '--working-directory', '/tmp', '-e', 'claude'] })
  })

  it('wezterm uses start --cwd', () => {
    const plan = buildLaunchPlan('wezterm', '/tmp', ['claude'])
    expect(plan).toEqual({ kind: 'open', args: ['-na', 'WezTerm.app', '--args', 'start', '--cwd', '/tmp', '--', 'claude'] })
  })

  it('warp opens at path via URI (no command support)', () => {
    const plan = buildLaunchPlan('warp', '/Users/u/my dir', ['claude'])
    expect(plan).toEqual({ kind: 'open', args: ['warp://action/new_window?path=%2FUsers%2Fu%2Fmy%20dir'] })
  })
})

describe('TERMINALS priority', () => {
  it('is ordered ghostty, iterm2, wezterm, kitty, alacritty, warp, terminal', () => {
    expect(TERMINALS.map((t) => t.id)).toEqual<TerminalId[]>([
      'ghostty', 'iterm2', 'wezterm', 'kitty', 'alacritty', 'warp', 'terminal',
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- terminal-launcher`
Expected: FAIL — cannot resolve `./terminal-launcher`.

- [ ] **Step 3: Implement the module**

Create `src/main/terminal-launcher.ts`:

```ts
/**
 * Terminal launcher — opens the user's preferred terminal at a working
 * directory, optionally running a command (`claude --resume <id>`).
 *
 * macOS has no "default terminal" concept, so resolution is:
 *   explicit setting → a supported terminal currently running → first
 *   installed by priority → Terminal.app.
 *
 * Launch strategies:
 *   - Terminal.app / iTerm2: AppleScript (typed command, shell-quoted)
 *   - Ghostty / Kitty / Alacritty / WezTerm: `open -na <App> --args …`
 *     (Ghostty 1.3.1 verified: macOS supports only `open -na Ghostty.app
 *     --args --working-directory=<dir> -e <cmd…>`)
 *   - Warp: URI scheme, cwd only (no documented command support)
 */
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { log as _log } from './logger'

function log(msg: string): void {
  _log('TerminalLauncher', msg)
}

export type TerminalId = 'ghostty' | 'iterm2' | 'wezterm' | 'kitty' | 'alacritty' | 'warp' | 'terminal'

export interface TerminalDef {
  id: TerminalId
  name: string
  /** .app bundle names searched under /Applications, ~/Applications (+ /System/Applications/Utilities for Terminal.app) */
  bundleNames: string[]
  /** Exact process names for `pgrep -x` running detection */
  processNames: string[]
}

/** Priority order for auto-detection (first installed wins). */
export const TERMINALS: TerminalDef[] = [
  { id: 'ghostty', name: 'Ghostty', bundleNames: ['Ghostty.app'], processNames: ['ghostty'] },
  { id: 'iterm2', name: 'iTerm2', bundleNames: ['iTerm.app'], processNames: ['iTerm2'] },
  { id: 'wezterm', name: 'WezTerm', bundleNames: ['WezTerm.app'], processNames: ['wezterm-gui'] },
  { id: 'kitty', name: 'kitty', bundleNames: ['kitty.app'], processNames: ['kitty'] },
  { id: 'alacritty', name: 'Alacritty', bundleNames: ['Alacritty.app'], processNames: ['alacritty'] },
  { id: 'warp', name: 'Warp', bundleNames: ['Warp.app'], processNames: ['Warp'] },
  { id: 'terminal', name: 'Terminal', bundleNames: ['Terminal.app'], processNames: ['Terminal'] },
]

const TERMINAL_IDS = new Set<string>(TERMINALS.map((t) => t.id))

export function isTerminalId(v: string): v is TerminalId {
  return TERMINAL_IDS.has(v)
}

export interface DetectDeps {
  exists: (p: string) => boolean
  home: string
}

export function detectInstalled(
  deps: DetectDeps = { exists: existsSync, home: homedir() },
): TerminalId[] {
  const found: TerminalId[] = []
  for (const t of TERMINALS) {
    const roots = ['/Applications', join(deps.home, 'Applications')]
    if (t.id === 'terminal') roots.push('/System/Applications/Utilities')
    const installed = t.bundleNames.some((b) => roots.some((r) => deps.exists(join(r, b))))
    // Terminal.app ships with macOS — treat it as always present
    if (installed || t.id === 'terminal') found.push(t.id)
  }
  return found
}

async function pgrepRunning(processName: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('/usr/bin/pgrep', ['-x', processName], (err) => resolve(!err))
  })
}

export async function detectRunning(
  candidates: TerminalId[],
  isRunning: (processName: string) => Promise<boolean> = pgrepRunning,
): Promise<TerminalId | null> {
  for (const t of TERMINALS) {
    if (!candidates.includes(t.id)) continue
    for (const p of t.processNames) {
      if (await isRunning(p)) return t.id
    }
  }
  return null
}

export function resolveTerminal(
  preferred: string,
  installed: TerminalId[],
  running: TerminalId | null,
): TerminalId {
  if (preferred !== 'auto' && isTerminalId(preferred) && installed.includes(preferred)) {
    return preferred
  }
  if (running && installed.includes(running)) return running
  return installed[0] ?? 'terminal'
}

// ─── Launch plan construction ───

export type LaunchPlan =
  | { kind: 'osascript'; script: string }
  | { kind: 'open'; args: string[] }

/** Shell-safe single-quote escaping: ' → '\'' (blocks all shell expansion). */
export function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/** AppleScript string escaping: backslashes doubled, double quotes escaped. */
export function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildLaunchPlan(terminal: TerminalId, cwd: string, command: string[]): LaunchPlan {
  const cmdStr = command.join(' ')
  const shellCmd = `cd ${shellSingleQuote(cwd)} && ${cmdStr}`

  switch (terminal) {
    case 'terminal':
      return {
        kind: 'osascript',
        script: `tell application "Terminal"\n  activate\n  do script "${escapeAppleScript(shellCmd)}"\nend tell`,
      }
    case 'iterm2':
      return {
        kind: 'osascript',
        script: [
          'tell application "iTerm2"',
          '  activate',
          '  set newWindow to (create window with default profile)',
          '  tell current session of newWindow',
          `    write text "${escapeAppleScript(shellCmd)}"`,
          '  end tell',
          'end tell',
        ].join('\n'),
      }
    case 'ghostty':
      return { kind: 'open', args: ['-na', 'Ghostty.app', '--args', `--working-directory=${cwd}`, '-e', ...command] }
    case 'kitty':
      return { kind: 'open', args: ['-na', 'kitty.app', '--args', '--directory', cwd, ...command] }
    case 'alacritty':
      return { kind: 'open', args: ['-na', 'Alacritty.app', '--args', '--working-directory', cwd, '-e', ...command] }
    case 'wezterm':
      return { kind: 'open', args: ['-na', 'WezTerm.app', '--args', 'start', '--cwd', cwd, '--', ...command] }
    case 'warp':
      // Warp has no documented "run command" launch; open a window at the path.
      return { kind: 'open', args: [`warp://action/new_window?path=${encodeURIComponent(cwd)}`] }
  }
}

// ─── Execution ───

function execPlan(plan: LaunchPlan): Promise<void> {
  return new Promise((resolve, reject) => {
    const [bin, args] = plan.kind === 'osascript'
      ? ['/usr/bin/osascript', ['-e', plan.script]] as const
      : ['/usr/bin/open', plan.args] as const
    execFile(bin, args as string[], (err) => (err ? reject(err) : resolve()))
  })
}

export interface LaunchRequest {
  preferred: string
  cwd: string
  command: string[]
}

export interface LaunchResult {
  ok: boolean
  terminal: TerminalId
  fellBack: boolean
}

export async function launchInTerminal(req: LaunchRequest): Promise<LaunchResult> {
  const installed = detectInstalled()
  const running = await detectRunning(installed).catch(() => null)
  const terminal = resolveTerminal(req.preferred, installed, running)

  try {
    await execPlan(buildLaunchPlan(terminal, req.cwd, req.command))
    log(`Opened ${terminal} at ${req.cwd}`)
    return { ok: true, terminal, fellBack: false }
  } catch (err) {
    log(`Launch failed for ${terminal}: ${(err as Error).message}`)
    if (terminal === 'terminal') return { ok: false, terminal, fellBack: false }
  }

  // Fall back to Terminal.app
  try {
    await execPlan(buildLaunchPlan('terminal', req.cwd, req.command))
    log(`Fell back to Terminal.app at ${req.cwd}`)
    return { ok: true, terminal: 'terminal', fellBack: true }
  } catch (err) {
    log(`Terminal.app fallback failed: ${(err as Error).message}`)
    return { ok: false, terminal: 'terminal', fellBack: true }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- terminal-launcher`
Expected: PASS (all tests). Also run `npm run typecheck` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/terminal-launcher.ts src/main/terminal-launcher.test.ts
git commit -m "feat: terminal launcher with detection and per-terminal launch plans"
```

---

### Task 3: Wire terminal launcher into IPC + Settings UI

**Files:**
- Modify: `src/shared/types.ts` (two IPC channels)
- Modify: `src/main/index.ts` (replace `OPEN_IN_TERMINAL` handler body; add `SET_TERMINAL`, `LIST_TERMINALS`)
- Modify: `src/preload/index.ts` (expose `setTerminal`, `listTerminals`)
- Modify: `src/renderer/theme.ts` (persisted `preferredTerminal`)
- Modify: `src/renderer/App.tsx` (push setting to main on launch)
- Modify: `src/renderer/components/SettingsPopover.tsx` (Terminal section)

**Interfaces:**
- Consumes: `launchInTerminal`, `detectInstalled`, `isTerminalId`, `TERMINALS` from Task 2.
- Produces: `window.clod.setTerminal(id: string): void`; `window.clod.listTerminals(): Promise<Array<{ id: string; name: string }>>`; theme store gains `preferredTerminal: string` ('auto' or a `TerminalId`) + `setPreferredTerminal(id: string): void`.

- [ ] **Step 1: IPC channel names**

In `src/shared/types.ts`, inside the `IPC` const, after the `SET_HOTKEY` entry:

```ts
  // Preferred terminal app for "Open in CLI" ('auto' = detect)
  SET_TERMINAL: 'clod:set-terminal',
  LIST_TERMINALS: 'clod:list-terminals',
```

- [ ] **Step 2: Main-process handlers**

In `src/main/index.ts`:

Add to the imports near the top (after the `clampRectToArea` import):

```ts
import { launchInTerminal, detectInstalled, isTerminalId, TERMINALS } from './terminal-launcher'
```

Add module state near the other config vars (after `let registeredAccelerator: string | null = null`):

```ts
// Preferred terminal for "Open in CLI" ('auto' = detect). Renderer pushes the
// persisted value on launch, same pattern as SET_HOTKEY.
let preferredTerminal = 'auto'
```

Add handlers next to the `SET_HOTKEY` handler:

```ts
ipcMain.on(IPC.SET_TERMINAL, (_event, id: string) => {
  if (id === 'auto' || isTerminalId(id)) {
    preferredTerminal = id
    log(`IPC SET_TERMINAL: ${id}`)
  } else {
    log(`IPC SET_TERMINAL: invalid "${id}" — ignoring`)
  }
})

ipcMain.handle(IPC.LIST_TERMINALS, () => {
  const installed = new Set(detectInstalled())
  return TERMINALS.filter((t) => installed.has(t.id)).map((t) => ({ id: t.id, name: t.name }))
})
```

Replace the `OPEN_IN_TERMINAL` handler. Keep the existing validation (UUID regex, path checks) and arg parsing verbatim; replace everything from the escaping helpers (`shellSingleQuote`, `escapeAppleScript`, `safeDir`, `cmd`, `script`, the `execFile('/usr/bin/osascript', …)` call and its try/catch) with:

```ts
  const command = sessionId ? [claudeBin, '--resume', sessionId] : [claudeBin]
  const result = await launchInTerminal({ preferred: preferredTerminal, cwd: projectPath, command })
  if (!result.ok) log(`OPEN_IN_TERMINAL: all launch attempts failed`)
  return result.ok
```

and change the handler callback to `async`:

```ts
ipcMain.handle(IPC.OPEN_IN_TERMINAL, async (_event, arg: string | null | { sessionId?: string | null; projectPath?: string }) => {
```

Delete the now-unused `const { execFile } = require('child_process')` line at the top of the handler (the launcher owns execution now).

- [ ] **Step 3: Preload bridge**

In `src/preload/index.ts`:

In `interface ClodAPI`, after `setHotkey(...)`:

```ts
  setTerminal(id: string): void
  listTerminals(): Promise<Array<{ id: string; name: string }>>
```

In the `api` object, after the `setHotkey` entry:

```ts
  setTerminal: (id) => ipcRenderer.send(IPC.SET_TERMINAL, id),
  listTerminals: () => ipcRenderer.invoke(IPC.LIST_TERMINALS),
```

- [ ] **Step 4: Theme store setting**

In `src/renderer/theme.ts`, same pattern as Task 1's `startExpanded`:

- `ThemeState`: add `preferredTerminal: string` and `setPreferredTerminal: (id: string) => void`
- `PersistedSettings`: add `preferredTerminal: string`
- `DEFAULT_SETTINGS`: add `preferredTerminal: 'auto',`
- `loadSettings()`: add `preferredTerminal: typeof p.preferredTerminal === 'string' ? p.preferredTerminal : 'auto',`
- `persist()`: add `preferredTerminal: s.preferredTerminal,`
- store init: add `preferredTerminal: saved.preferredTerminal,`
- setter:

```ts
    setPreferredTerminal: (id) => {
      set({ preferredTerminal: id })
      persist()
      try { window.clod.setTerminal(id) } catch {}
    },
```

- [ ] **Step 5: Push on launch**

In `src/renderer/App.tsx`, in the existing mount effect that pushes persisted settings (`window.clod.setWindowPosition` / `setHotkey` / `setOpenAtLogin`), add:

```ts
    try { window.clod.setTerminal(t.preferredTerminal) } catch {}
```

- [ ] **Step 6: Settings UI — Terminal section**

In `src/renderer/components/SettingsPopover.tsx`:

Add `Terminal` to the Phosphor import list. Add hooks:

```ts
  const preferredTerminal = useThemeStore((s) => s.preferredTerminal)
  const setPreferredTerminal = useThemeStore((s) => s.setPreferredTerminal)
  const [terminals, setTerminals] = useState<Array<{ id: string; name: string }>>([])
```

Fetch when the popover opens (alongside the existing accessibility-check effect):

```ts
  useEffect(() => {
    if (!open) return
    let cancelled = false
    window.clod.listTerminals().then((list) => {
      if (!cancelled) setTerminals(list)
    }).catch(() => { if (!cancelled) setTerminals([]) })
    return () => { cancelled = true }
  }, [open])
```

Add a section after the "Shortcut" section (after its closing `</div>` and divider):

```tsx
            {/* Terminal for "Open in CLI" */}
            <div>
              <div className="flex items-center gap-2 min-w-0 mb-1.5">
                <Terminal size={14} style={{ color: colors.textTertiary }} />
                <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                  Open CLI in
                </div>
              </div>
              <div className="flex gap-1 flex-wrap">
                {[{ id: 'auto', name: 'Auto' }, ...terminals].map((t) => {
                  const active = preferredTerminal === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setPreferredTerminal(t.id)}
                      className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
                      style={{
                        background: active ? colors.accent : colors.surfaceSecondary,
                        color: active ? colors.textOnAccent : colors.textSecondary,
                        border: `1px solid ${active ? colors.accent : colors.containerBorder}`,
                      }}
                    >
                      {t.name}
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />
```

- [ ] **Step 7: Surface launch failure in the conversation**

In `src/renderer/components/StatusBar.tsx`, the `StatusBar` component's `handleOpenInTerminal` currently fires and forgets. Add the store action hook next to the existing ones:

```ts
  const addSystemMessage = useSessionStore((s) => s.addSystemMessage)
```

and replace the handler:

```ts
  const handleOpenInTerminal = async () => {
    const ok = await window.clod.openInTerminal(tab.claudeSessionId, tab.workingDirectory).catch(() => false)
    if (!ok) {
      addSystemMessage('Could not open a terminal — check Settings → "Open CLI in".')
    }
  }
```

(the button's `onClick={handleOpenInTerminal}` needs no change — an async handler is fine).

- [ ] **Step 8: Verify**

Run: `npm run typecheck` — exit 0.
Run: `npm test` — all pass.

Manual (restart `npm run dev` — main-process change): Settings → "Open CLI in" shows Auto + Ghostty + Terminal (on this machine); with Auto, "Open in CLI" opens Ghostty at the tab's working directory running `claude` (or `claude --resume <id>` for a session); selecting Terminal opens Terminal.app instead.

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/main/index.ts src/preload/index.ts src/renderer/theme.ts src/renderer/App.tsx src/renderer/components/SettingsPopover.tsx src/renderer/components/StatusBar.tsx
git commit -m "feat: open CLI in the user's preferred terminal with auto-detection"
```
