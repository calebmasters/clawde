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
