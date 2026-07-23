import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync } from 'fs'
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

  it('refuses to save over a corrupt file that could not be backed up', () => {
    const sub = join(dir, 'locked')
    mkdirSync(sub)
    const file = join(sub, 'things.json')
    writeFileSync(file, '{corrupt')
    chmodSync(sub, 0o500) // rename to .bak will fail — directory not writable
    try {
      const store = new JsonFileStore<Thing>(file, isThing)
      expect(store.load()).toEqual({ items: [], fileExisted: false })
      store.save([{ id: 'a', n: 1 }])
    } finally {
      chmodSync(sub, 0o700)
    }
    // corrupt original untouched — the save was refused
    expect(readFileSync(file, 'utf-8')).toBe('{corrupt')
    expect(existsSync(`${file}.bak`)).toBe(false)
  })

  it('retries the blocked backup on save and heals once the directory is writable', () => {
    const sub = join(dir, 'locked2')
    mkdirSync(sub)
    const file = join(sub, 'things.json')
    writeFileSync(file, '{corrupt')
    chmodSync(sub, 0o500)
    let store: JsonFileStore<Thing>
    try {
      store = new JsonFileStore<Thing>(file, isThing)
      store.load()
    } finally {
      chmodSync(sub, 0o700)
    }
    store!.save([{ id: 'a', n: 1 }])
    expect(readFileSync(`${file}.bak`, 'utf-8')).toBe('{corrupt')
    expect(JSON.parse(readFileSync(file, 'utf-8')).items).toEqual([{ id: 'a', n: 1 }])
  })
})
