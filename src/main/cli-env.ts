import { execSync } from 'child_process'
import { markedCommand, extractMarked, isPlausiblePath } from './shell-capture'

let cachedPath: string | null = null

function appendPathEntries(target: string[], seen: Set<string>, rawPath: string | undefined): void {
  if (!rawPath) return
  for (const entry of rawPath.split(':')) {
    const p = entry.trim()
    // Drop anything that isn't a usable absolute directory — shell rc banners can
    // otherwise inject ANSI escape sequences as bogus PATH entries.
    if (!p || seen.has(p) || !isPlausiblePath(p)) continue
    seen.add(p)
    target.push(p)
  }
}

export function getCliPath(): string {
  if (cachedPath) return cachedPath

  const ordered: string[] = []
  const seen = new Set<string>()

  // Start from current process PATH.
  appendPathEntries(ordered, seen, process.env.PATH)

  // Add common binary locations used on macOS (Homebrew + system).
  appendPathEntries(ordered, seen, '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')

  // Try interactive login shell first so nvm/asdf/etc. PATH hooks are loaded.
  // The value is marker-fenced because interactive rc files often print banners.
  const capture = markedCommand('$PATH')
  const pathCommands = [
    `/bin/zsh -ilc '${capture}'`,
    `/bin/zsh -lc '${capture}'`,
    `/bin/bash -lc '${capture}'`,
  ]

  for (const cmd of pathCommands) {
    try {
      const raw = execSync(cmd, { encoding: 'utf-8', timeout: 3000 })
      const discovered = extractMarked(raw)
      if (discovered) appendPathEntries(ordered, seen, discovered)
    } catch {
      // Keep trying fallbacks.
    }
  }

  cachedPath = ordered.join(':')
  return cachedPath
}

export function getCliEnv(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv,
    PATH: getCliPath(),
  }
  delete env.CLAUDECODE
  return env
}

