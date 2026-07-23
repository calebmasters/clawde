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
