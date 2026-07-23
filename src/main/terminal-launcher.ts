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
