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
    expect(plan.script).toContain(`cd '/Users/u/it'\\\\''s here' && claude`)
    // The AppleScript source must carry a DOUBLED backslash so osascript
    // delivers a single literal backslash to the shell.
    expect(plan.script.includes("\\\\")).toBe(true)
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
