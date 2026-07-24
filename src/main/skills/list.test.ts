import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listInstalledSkills, parseSkillFrontmatter } from './list'

describe('parseSkillFrontmatter', () => {
  it('extracts name and description from YAML frontmatter', () => {
    const md = `---\nname: pdf-tools\ndescription: Work with PDF files\n---\n\n# PDF Tools\n`
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'pdf-tools', description: 'Work with PDF files' })
  })

  it('strips surrounding quotes', () => {
    const md = `---\nname: "quoted"\ndescription: 'single quoted value'\n---\nbody`
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'quoted', description: 'single quoted value' })
  })

  it('returns nulls without frontmatter or without the keys', () => {
    expect(parseSkillFrontmatter('# Just a heading')).toEqual({ name: null, description: null })
    expect(parseSkillFrontmatter('---\nversion: 1\n---\nbody')).toEqual({ name: null, description: null })
  })

  it('treats an empty-valued key as absent instead of swallowing the next line', () => {
    const md = `---\nname:\ndescription: x\n---\nbody`
    expect(parseSkillFrontmatter(md)).toEqual({ name: null, description: 'x' })
  })

  it('handles CRLF line endings', () => {
    const md = `---\r\nname: pdf-tools\r\ndescription: Work with PDFs\r\n---\r\nbody`
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'pdf-tools', description: 'Work with PDFs' })
  })
})

describe('listInstalledSkills', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clod-skills-'))
  })

  const addSkill = (folder: string, frontmatter: string | null) => {
    mkdirSync(join(dir, folder), { recursive: true })
    if (frontmatter !== null) writeFileSync(join(dir, folder, 'SKILL.md'), frontmatter)
  }

  it('lists skills sorted by name, falling back to the folder name', () => {
    addSkill('zeta', `---\nname: zeta\ndescription: Z skill\n---\n`)
    addSkill('alpha-folder', `---\ndescription: no name key\n---\n`)
    const result = listInstalledSkills(dir)
    expect(result).toEqual([
      { name: 'alpha-folder', description: 'no name key' },
      { name: 'zeta', description: 'Z skill' },
    ])
  })

  it('skips folders without SKILL.md and tolerates a missing directory', () => {
    addSkill('empty-folder', null)
    expect(listInstalledSkills(dir)).toEqual([])
    expect(listInstalledSkills(join(dir, 'does-not-exist'))).toEqual([])
  })
})
