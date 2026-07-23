import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { CaretDown, Check, FolderSimple, House, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { useSessionStore, AVAILABLE_MODELS } from '../stores/sessionStore'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../theme'
import type { Project } from '../../shared/types'

/** Compact display path: ~-relative if under home is unknown, else basename-focused */
function compactPath(fullPath: string): string {
  const parts = fullPath.replace(/\/$/, '').split('/')
  if (parts.length <= 3) return fullPath
  return `…/${parts.slice(-2).join('/')}`
}

export function ProjectSwitcher() {
  const projects = useSessionStore((s) => s.projects)
  const activeProjectId = useSessionStore((s) => s.activeProjectId)
  const setActiveProject = useSessionStore((s) => s.setActiveProject)
  const addProject = useSessionStore((s) => s.addProject)
  const editProject = useSessionStore((s) => s.editProject)
  const removeProject = useSessionStore((s) => s.removeProject)
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [open, setOpen] = useState(false)
  // 'list' = project rows; 'new' = name a just-picked directory; string = edit that project id
  const [mode, setMode] = useState<'list' | 'new' | string>('list')
  const [draftName, setDraftName] = useState('')
  const [draftPath, setDraftPath] = useState('')
  const [draftModel, setDraftModel] = useState<string | undefined>(undefined)
  const [draftPerms, setDraftPerms] = useState<'ask' | 'auto' | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) ?? null : null

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 6, left: rect.left })
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
      setMode('list')
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleToggle = () => {
    if (!open) {
      updatePos()
      setMode('list')
      setError(null)
    }
    setOpen((o) => !o)
  }

  const handleSelect = (projectId: string | null) => {
    setOpen(false)
    setMode('list')
    void setActiveProject(projectId)
  }

  const handleNewProject = async () => {
    const dir = await window.clod.selectDirectory()
    if (!dir) return
    setDraftPath(dir)
    setDraftName(dir.replace(/\/$/, '').split('/').pop() || 'Project')
    setError(null)
    setMode('new')
  }

  const handleCreate = async () => {
    if (!draftName.trim() || !draftPath) return
    const project = await addProject(draftName.trim(), draftPath)
    if (!project) {
      setError('Could not create the project — check the log and try again.')
      return
    }
    setError(null)
    setMode('list')
    handleSelect(project.id)
  }

  const startEdit = (p: Project) => {
    setDraftName(p.name)
    setDraftModel(p.defaults?.model)
    setDraftPerms(p.defaults?.permissionMode)
    setError(null)
    setMode(p.id)
  }

  const handleSaveEdit = async (projectId: string) => {
    if (!draftName.trim()) return
    const updated = await editProject(projectId, {
      name: draftName.trim(),
      defaults: (draftModel || draftPerms) ? { model: draftModel, permissionMode: draftPerms } : undefined,
    })
    if (!updated) {
      setError('Could not save changes — check the log and try again.')
      return
    }
    setError(null)
    setMode('list')
  }

  const rowClass = 'w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors text-left rounded-lg'

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex items-center gap-1 flex-shrink-0 rounded-full transition-colors select-none"
        style={{ color: colors.textSecondary, padding: '4px 6px 4px 10px', maxWidth: 150, fontSize: 12, fontWeight: 500 }}
        title={activeProject ? `${activeProject.name} — ${activeProject.path}` : 'Scratch workspace'}
      >
        {activeProject ? <FolderSimple size={13} className="flex-shrink-0" /> : <House size={13} className="flex-shrink-0" />}
        <span className="truncate">{activeProject ? activeProject.name : 'Scratch'}</span>
        <CaretDown size={10} style={{ opacity: 0.6 }} className="flex-shrink-0" />
      </button>

      {popoverLayer && open && createPortal(
        <motion.div
          ref={popoverRef}
          data-clod-ui
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.12 }}
          className="rounded-xl"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: 240,
            pointerEvents: 'auto',
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
            zIndex: 50,
          }}
        >
          <div className="p-1.5">
            {mode === 'new' ? (
              <div className="p-1.5 flex flex-col gap-1.5">
                <div className="text-[10px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>
                  New project
                </div>
                <div className="text-[10px] truncate" style={{ color: colors.textTertiary }} title={draftPath}>
                  {compactPath(draftPath)}
                </div>
                <input
                  autoFocus
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); if (e.key === 'Escape') setMode('list') }}
                  placeholder="Project name"
                  className="w-full rounded-md px-2 py-1 text-[11px]"
                  style={{ background: colors.surfaceSecondary, color: colors.textPrimary, border: `1px solid ${colors.containerBorder}`, outline: 'none' }}
                />
                {error && (
                  <div className="text-[10px]" style={{ color: colors.statusError }}>
                    {error}
                  </div>
                )}
                <div className="flex gap-1 justify-end">
                  <button onClick={() => setMode('list')} className="rounded-md px-2 py-1 text-[11px]" style={{ color: colors.textTertiary }}>
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleCreate()}
                    disabled={!draftName.trim()}
                    className="rounded-md px-2 py-1 text-[11px] font-medium disabled:opacity-40"
                    style={{ background: colors.accent, color: colors.textOnAccent }}
                  >
                    Create
                  </button>
                </div>
              </div>
            ) : mode !== 'list' ? (
              (() => {
                const editing = projects.find((p) => p.id === mode)
                if (!editing) return null
                return (
                  <div className="p-1.5 flex flex-col gap-1.5">
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>
                      Edit project
                    </div>
                    <input
                      autoFocus
                      type="text"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveEdit(editing.id); if (e.key === 'Escape') setMode('list') }}
                      className="w-full rounded-md px-2 py-1 text-[11px]"
                      style={{ background: colors.surfaceSecondary, color: colors.textPrimary, border: `1px solid ${colors.containerBorder}`, outline: 'none' }}
                    />
                    <div className="text-[10px]" style={{ color: colors.textTertiary }}>Default model</div>
                    <div className="flex gap-1">
                      {AVAILABLE_MODELS.map((m) => {
                        const active = draftModel === m.id
                        return (
                          <button
                            key={m.id}
                            onClick={() => setDraftModel(active ? undefined : m.id)}
                            className="flex-1 rounded-md px-1 py-1 text-[10px] font-medium transition-colors"
                            style={{
                              background: active ? colors.accent : colors.surfaceSecondary,
                              color: active ? colors.textOnAccent : colors.textSecondary,
                              border: `1px solid ${active ? colors.accent : colors.containerBorder}`,
                            }}
                          >
                            {m.label}
                          </button>
                        )
                      })}
                    </div>
                    <div className="text-[10px]" style={{ color: colors.textTertiary }}>Default permissions</div>
                    <div className="flex gap-1">
                      {(['ask', 'auto'] as const).map((pm) => {
                        const active = draftPerms === pm
                        return (
                          <button
                            key={pm}
                            onClick={() => setDraftPerms(active ? undefined : pm)}
                            className="flex-1 rounded-md px-1 py-1 text-[10px] font-medium capitalize transition-colors"
                            style={{
                              background: active ? colors.accent : colors.surfaceSecondary,
                              color: active ? colors.textOnAccent : colors.textSecondary,
                              border: `1px solid ${active ? colors.accent : colors.containerBorder}`,
                            }}
                          >
                            {pm}
                          </button>
                        )
                      })}
                    </div>
                    {error && (
                      <div className="text-[10px]" style={{ color: colors.statusError }}>
                        {error}
                      </div>
                    )}
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setMode('list')} className="rounded-md px-2 py-1 text-[11px]" style={{ color: colors.textTertiary }}>
                        Cancel
                      </button>
                      <button
                        onClick={() => void handleSaveEdit(editing.id)}
                        className="rounded-md px-2 py-1 text-[11px] font-medium"
                        style={{ background: colors.accent, color: colors.textOnAccent }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )
              })()
            ) : (
              <>
                <button className={rowClass} onClick={() => handleSelect(null)} style={{ color: colors.textPrimary }}>
                  <House size={13} style={{ color: colors.textTertiary }} />
                  <span className="flex-1">Scratch</span>
                  {activeProjectId === null && <Check size={12} style={{ color: colors.accent }} />}
                </button>

                {projects.map((p) => (
                  <div key={p.id} className="group flex items-center">
                    <button className={`${rowClass} flex-1 min-w-0`} onClick={() => handleSelect(p.id)} style={{ color: colors.textPrimary }}>
                      <FolderSimple size={13} style={{ color: colors.textTertiary }} className="flex-shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p.name}</span>
                        <span className="block truncate text-[9px]" style={{ color: colors.textTertiary }}>{compactPath(p.path)}</span>
                      </span>
                      {activeProjectId === p.id && <Check size={12} style={{ color: colors.accent }} className="flex-shrink-0" />}
                    </button>
                    <button
                      onClick={() => startEdit(p)}
                      className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                      style={{ color: colors.textTertiary }}
                      title="Edit project"
                    >
                      <PencilSimple size={11} />
                    </button>
                    <button
                      onClick={() => void removeProject(p.id)}
                      className="flex-shrink-0 w-5 h-5 mr-1 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                      style={{ color: colors.statusError }}
                      title="Remove project (sessions and files are kept)"
                    >
                      <Trash size={11} />
                    </button>
                  </div>
                ))}

                <div className="mx-1.5 my-1" style={{ height: 1, background: colors.popoverBorder }} />

                <button className={rowClass} onClick={() => void handleNewProject()} style={{ color: colors.accent }}>
                  <Plus size={12} />
                  New project…
                </button>
              </>
            )}
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}
