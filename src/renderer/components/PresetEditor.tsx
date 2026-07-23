import React, { useState, useEffect } from 'react'
import { Lightning, PencilSimple, Plus, Trash, Warning } from '@phosphor-icons/react'
import { useSessionStore, AVAILABLE_MODELS } from '../stores/sessionStore'
import { useColors } from '../theme'
import { toAccelerator } from '../lib/accelerator'
import type { Preset, PresetInput, PresetKeybind } from '../../shared/types'

export function formatKeybind(kb: PresetKeybind): string {
  if (kb.kind === 'double-tap') return kb.modifier === 'option' ? '⌥⌥' : '⌘⌘'
  if (kb.kind === 'accelerator') return kb.accelerator
  return '—'
}

/** Small pill button used for all option rows in the editor. */
function Pill({ active, label, onClick, colors }: {
  active: boolean
  label: string
  onClick: () => void
  colors: ReturnType<typeof useColors>
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors truncate"
      style={{
        background: active ? colors.accent : colors.surfaceSecondary,
        color: active ? colors.textOnAccent : colors.textSecondary,
        border: `1px solid ${active ? colors.accent : colors.containerBorder}`,
      }}
    >
      {label}
    </button>
  )
}

function EditorPanel({ initial, onSave, onCancel }: {
  initial: PresetInput
  onSave: (input: PresetInput) => void
  onCancel: () => void
}) {
  const colors = useColors()
  const projects = useSessionStore((s) => s.projects)
  const [name, setName] = useState(initial.name)
  const [keybind, setKeybind] = useState<PresetKeybind>(initial.keybind)
  const [projectId, setProjectId] = useState<string | null | undefined>(initial.projectId)
  const [model, setModel] = useState<string | undefined>(initial.model)
  const [permissionMode, setPermissionMode] = useState<'ask' | 'auto' | undefined>(initial.permissionMode)
  const [startExpanded, setStartExpanded] = useState<boolean | undefined>(initial.startExpanded)
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setRecording(false); return }
      const accel = toAccelerator(e)
      if (accel) { setKeybind({ kind: 'accelerator', accelerator: accel }); setRecording(false) }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [recording])

  const label = 'text-[10px] uppercase tracking-wider'

  return (
    <div className="flex flex-col gap-1.5 p-1.5 rounded-lg" style={{ background: colors.surfaceHover }}>
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Mode name"
        className="w-full rounded-md px-2 py-1 text-[11px]"
        style={{ background: colors.surfaceSecondary, color: colors.textPrimary, border: `1px solid ${colors.containerBorder}`, outline: 'none' }}
      />

      <div className={label} style={{ color: colors.textTertiary }}>Keybind</div>
      <div className="grid grid-cols-4 gap-1">
        <Pill colors={colors} label="⌥⌥" active={keybind.kind === 'double-tap' && keybind.modifier === 'option'} onClick={() => setKeybind({ kind: 'double-tap', modifier: 'option' })} />
        <Pill colors={colors} label="⌘⌘" active={keybind.kind === 'double-tap' && keybind.modifier === 'command'} onClick={() => setKeybind({ kind: 'double-tap', modifier: 'command' })} />
        <Pill colors={colors} label={recording ? '…' : (keybind.kind === 'accelerator' ? keybind.accelerator : 'Custom')} active={keybind.kind === 'accelerator'} onClick={() => setRecording(true)} />
        <Pill colors={colors} label="None" active={keybind.kind === 'none'} onClick={() => setKeybind({ kind: 'none' })} />
      </div>

      <div className={label} style={{ color: colors.textTertiary }}>Project</div>
      <div className="grid grid-cols-2 gap-1">
        <Pill colors={colors} label="Keep current" active={projectId === undefined} onClick={() => setProjectId(undefined)} />
        <Pill colors={colors} label="Scratch" active={projectId === null} onClick={() => setProjectId(null)} />
        {projects.map((p) => (
          <Pill key={p.id} colors={colors} label={p.name} active={projectId === p.id} onClick={() => setProjectId(p.id)} />
        ))}
      </div>

      <div className={label} style={{ color: colors.textTertiary }}>Model</div>
      <div className="grid grid-cols-4 gap-1">
        <Pill colors={colors} label="—" active={model === undefined} onClick={() => setModel(undefined)} />
        {AVAILABLE_MODELS.map((m) => (
          <Pill key={m.id} colors={colors} label={m.label} active={model === m.id} onClick={() => setModel(m.id)} />
        ))}
      </div>

      <div className={label} style={{ color: colors.textTertiary }}>Permissions</div>
      <div className="grid grid-cols-3 gap-1">
        <Pill colors={colors} label="—" active={permissionMode === undefined} onClick={() => setPermissionMode(undefined)} />
        <Pill colors={colors} label="Ask" active={permissionMode === 'ask'} onClick={() => setPermissionMode('ask')} />
        <Pill colors={colors} label="Auto" active={permissionMode === 'auto'} onClick={() => setPermissionMode('auto')} />
      </div>

      <div className={label} style={{ color: colors.textTertiary }}>Chat on activate</div>
      <div className="grid grid-cols-3 gap-1">
        <Pill colors={colors} label="—" active={startExpanded === undefined} onClick={() => setStartExpanded(undefined)} />
        <Pill colors={colors} label="Expanded" active={startExpanded === true} onClick={() => setStartExpanded(true)} />
        <Pill colors={colors} label="Compact" active={startExpanded === false} onClick={() => setStartExpanded(false)} />
      </div>

      <div className="flex gap-1 justify-end mt-0.5">
        <button onClick={onCancel} className="rounded-md px-2 py-1 text-[11px]" style={{ color: colors.textTertiary }}>
          Cancel
        </button>
        <button
          onClick={() => onSave({ name: name.trim(), keybind, projectId, model, permissionMode, startExpanded })}
          disabled={!name.trim()}
          className="rounded-md px-2 py-1 text-[11px] font-medium disabled:opacity-40"
          style={{ background: colors.accent, color: colors.textOnAccent }}
        >
          Save
        </button>
      </div>
    </div>
  )
}

/** The "Modes" section rendered inside SettingsPopover. */
export function PresetsSection() {
  const colors = useColors()
  const presets = useSessionStore((s) => s.presets)
  const keybindErrors = useSessionStore((s) => s.presetKeybindErrors)
  const addPreset = useSessionStore((s) => s.addPreset)
  const editPreset = useSessionStore((s) => s.editPreset)
  const removePreset = useSessionStore((s) => s.removePreset)
  // null = list view; 'new' = creating; string = editing that preset id
  const [editing, setEditing] = useState<'new' | string | null>(null)

  const handleSave = async (input: PresetInput) => {
    if (editing === 'new') await addPreset(input)
    else if (editing) await editPreset(editing, input)
    setEditing(null)
  }

  return (
    <div>
      <div className="flex items-center gap-2 min-w-0 mb-1.5">
        <Lightning size={14} style={{ color: colors.textTertiary }} />
        <div className="text-[12px] font-medium flex-1" style={{ color: colors.textPrimary }}>
          Modes
        </div>
        {editing === null && (
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
            style={{ color: colors.accent }}
            title="Add a mode"
          >
            <Plus size={10} /> Add
          </button>
        )}
      </div>

      {editing === 'new' && (
        <EditorPanel initial={{ name: '', keybind: { kind: 'none' } }} onSave={handleSave} onCancel={() => setEditing(null)} />
      )}

      {editing === null && presets.length === 0 && (
        <div className="text-[11px]" style={{ color: colors.textTertiary }}>
          No modes yet — add one to bind a keybind.
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {presets.map((p: Preset) => (
          editing === p.id ? (
            <EditorPanel
              key={p.id}
              initial={{ name: p.name, keybind: p.keybind, projectId: p.projectId, model: p.model, permissionMode: p.permissionMode, startExpanded: p.startExpanded }}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
            />
          ) : editing === null ? (
            <div key={p.id} className="group flex items-center gap-1.5 rounded-md px-1 py-0.5">
              <span className="text-[11px] truncate flex-1" style={{ color: colors.textPrimary }}>{p.name}</span>
              {keybindErrors[p.id] && (
                <span title={keybindErrors[p.id]}>
                  <Warning size={11} weight="fill" style={{ color: '#f59e0b' }} />
                </span>
              )}
              <span className="text-[10px] flex-shrink-0" style={{ color: colors.textTertiary }}>{formatKeybind(p.keybind)}</span>
              <button onClick={() => setEditing(p.id)} className="w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100" style={{ color: colors.textTertiary }} title="Edit mode">
                <PencilSimple size={11} />
              </button>
              <button onClick={() => void removePreset(p.id)} className="w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100" style={{ color: colors.statusError }} title="Delete mode">
                <Trash size={11} />
              </button>
            </div>
          ) : null
        ))}
      </div>
    </div>
  )
}
