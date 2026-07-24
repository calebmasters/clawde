/**
 * Installed-skills scanner for the / picker. Reads ~/.claude/skills/<dir>/SKILL.md
 * frontmatter (name/description). Read-only; failures skip entries.
 */
import { readdirSync, readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { InstalledSkill } from '../../shared/types'

function stripQuotes(v: string): string {
  const t = v.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

export function parseSkillFrontmatter(content: string): { name: string | null; description: string | null } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return { name: null, description: null }
  const fm = m[1]
  const grab = (key: string): string | null => {
    const line = fm.match(new RegExp(`^${key}:[^\\S\\r\\n]*(.+)$`, 'm'))
    return line ? stripQuotes(line[1]) : null
  }
  return { name: grab('name'), description: grab('description') }
}

export function defaultSkillsDir(): string {
  return join(homedir(), '.claude', 'skills')
}

export function listInstalledSkills(skillsDir: string = defaultSkillsDir()): InstalledSkill[] {
  if (!existsSync(skillsDir)) return []
  let entries: string[]
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }

  const skills: InstalledSkill[] = []
  for (const folder of entries) {
    const skillMd = join(skillsDir, folder, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    try {
      const fm = parseSkillFrontmatter(readFileSync(skillMd, 'utf-8'))
      skills.push({ name: fm.name || folder, description: fm.description || '' })
    } catch {
      // unreadable SKILL.md — skip this entry
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}
