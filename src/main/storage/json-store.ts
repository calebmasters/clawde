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
  /** True when a corrupt original could not be backed up — saves are refused until it can be. */
  private saveBlocked = false

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
      this.saveBlocked = !this._backupCorrupt()
      return { items: [], fileExisted: false }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || !Array.isArray((parsed as { items?: unknown }).items)) {
      this.saveBlocked = !this._backupCorrupt()
      return { items: [], fileExisted: false }
    }

    const items = ((parsed as { items: unknown[] }).items).filter(this.validateItem)
    return { items, fileExisted: true }
  }

  save(items: T[]): void {
    if (this.saveBlocked) {
      // Retry the backup so the store heals once the filesystem cooperates
      if (!this._backupCorrupt()) {
        log(`Save refused for ${this.filePath}: corrupt original not yet backed up`)
        return
      }
      this.saveBlocked = false
    }

    const tmp = `${this.filePath}.tmp`
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2), { mode: 0o600 })
      renameSync(tmp, this.filePath)
    } catch (err) {
      log(`Save failed for ${this.filePath}: ${(err as Error).message}`)
    }
  }

  private _backupCorrupt(): boolean {
    if (!existsSync(this.filePath)) return true
    try {
      renameSync(this.filePath, `${this.filePath}.bak`)
      log(`Corrupt store backed up: ${this.filePath} → .bak`)
      return true
    } catch (err) {
      log(`Backup of corrupt store failed: ${(err as Error).message}`)
      return false
    }
  }
}
