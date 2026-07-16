import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { DotsThree, Bell, ArrowsOutSimple, Moon, ShieldCheck, FolderOpen, Cpu, Warning, AlignBottom, Keyboard, Sparkle, TextAa, Power } from '@phosphor-icons/react'
import { useThemeStore } from '../theme'
import { useSessionStore, AVAILABLE_MODELS } from '../stores/sessionStore'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../theme'

/** Build an Electron accelerator string from a keydown event, or null if it's
 *  just a modifier / has no modifier (globals need at least one modifier). */
function toAccelerator(e: KeyboardEvent): string | null {
  const key = e.key
  if (key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') return null
  const mods: string[] = []
  if (e.metaKey) mods.push('Command')
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (mods.length === 0) return null
  const arrows: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }
  let name: string
  if (key === ' ') name = 'Space'
  else if (arrows[key]) name = arrows[key]
  else if (key.length === 1) name = key.toUpperCase()
  else name = key // Enter, Tab, F1…F24, etc.
  return [...mods, name].join('+')
}

function RowToggle({
  checked,
  onChange,
  colors,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  colors: ReturnType<typeof useColors>
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className="relative w-9 h-5 rounded-full transition-colors"
      style={{
        background: checked ? colors.accent : colors.surfaceSecondary,
        border: `1px solid ${checked ? colors.accent : colors.containerBorder}`,
      }}
    >
      <span
        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-all"
        style={{
          left: checked ? 18 : 2,
          background: '#fff',
        }}
      />
    </button>
  )
}

/* ─── Settings popover ─── */

export function SettingsPopover() {
  const soundEnabled = useThemeStore((s) => s.soundEnabled)
  const setSoundEnabled = useThemeStore((s) => s.setSoundEnabled)
  const themeMode = useThemeStore((s) => s.themeMode)
  const setThemeMode = useThemeStore((s) => s.setThemeMode)
  const expandedUI = useThemeStore((s) => s.expandedUI)
  const setExpandedUI = useThemeStore((s) => s.setExpandedUI)
  const windowPosition = useThemeStore((s) => s.windowPosition)
  const setWindowPosition = useThemeStore((s) => s.setWindowPosition)
  const inputPlaceholder = useThemeStore((s) => s.inputPlaceholder)
  const setInputPlaceholder = useThemeStore((s) => s.setInputPlaceholder)
  const borderAnimation = useThemeStore((s) => s.borderAnimation)
  const setBorderAnimation = useThemeStore((s) => s.setBorderAnimation)
  const openAtLogin = useThemeStore((s) => s.openAtLogin)
  const setOpenAtLogin = useThemeStore((s) => s.setOpenAtLogin)
  const hotkeyMode = useThemeStore((s) => s.hotkeyMode)
  const hotkeyAccelerator = useThemeStore((s) => s.hotkeyAccelerator)
  const setHotkey = useThemeStore((s) => s.setHotkey)
  const [recording, setRecording] = useState(false)
  const isExpanded = useSessionStore((s) => s.isExpanded)
  const preferredModel = useSessionStore((s) => s.preferredModel)
  const setPreferredModel = useSessionStore((s) => s.setPreferredModel)
  const permissionMode = useSessionStore((s) => s.permissionMode)
  const setPermissionMode = useSessionStore((s) => s.setPermissionMode)
  const defaultDirOverride = useSessionStore((s) => s.defaultDirOverride)
  const setDefaultDirOverride = useSessionStore((s) => s.setDefaultDirOverride)
  const staticInfo = useSessionStore((s) => s.staticInfo)
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [open, setOpen] = useState(false)
  const [accessibilityOk, setAccessibilityOk] = useState<boolean | null>(null)

  const effectiveDefaultDir = defaultDirOverride || staticInfo?.defaultDir || staticInfo?.homePath || '~'
  const defaultDirName = effectiveDefaultDir.replace(/\/$/, '').split('/').pop() || effectiveDefaultDir
  const activeModelId = preferredModel || AVAILABLE_MODELS[0].id

  // Re-check Accessibility permission each time the panel opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    window.clod.checkAccessibility().then((ok) => {
      if (!cancelled) setAccessibilityOk(ok)
    }).catch(() => { if (!cancelled) setAccessibilityOk(null) })
    return () => { cancelled = true }
  }, [open])

  // While recording a custom shortcut, capture the next key combo.
  useEffect(() => {
    if (!recording) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setRecording(false); return }
      const accel = toAccelerator(e)
      if (accel) { setHotkey('accelerator', accel); setRecording(false) }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [recording, setHotkey])

  const handleChooseFolder = useCallback(async () => {
    const dir = await window.clod.selectDirectory()
    if (dir) setDefaultDirOverride(dir)
  }, [setDefaultDirOverride])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number; maxHeight?: number }>({ right: 0 })

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const gap = 6 // Match HistoryPicker spacing exactly.
    const margin = 8
    const right = window.innerWidth - rect.right

    if (isExpanded) {
      // Keep anchored below trigger (so it never covers the dots button),
      // and shrink if needed instead of shifting upward onto the trigger.
      const top = rect.bottom + gap
      setPos({
        top,
        right,
        maxHeight: Math.max(120, window.innerHeight - top - margin),
      })
      return
    }

    // Collapsed: open upward from trigger. Cap height to the space above the
    // trigger (so it never runs off the top of the screen) and to 440px so the
    // panel stays compact; overflow scrolls.
    const spaceAbove = rect.top - gap - margin
    setPos({
      bottom: window.innerHeight - rect.top + gap,
      right,
      maxHeight: Math.min(spaceAbove, 440),
    })
  }, [isExpanded])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onResize = () => updatePos()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, updatePos])

  // Keep panel tracking the trigger continuously while open so it follows
  // width/position animations of the top bar without feeling "stuck in space."
  useEffect(() => {
    if (!open) return
    let raf = 0
    const tick = () => {
      updatePos()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      if (raf) cancelAnimationFrame(raf)
    }
  }, [open, expandedUI, isExpanded, updatePos])

  const handleToggle = () => {
    if (!open) updatePos()
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors"
        style={{ color: colors.textTertiary }}
        title="Settings"
      >
        <DotsThree size={16} weight="bold" />
      </button>

      {popoverLayer && open && createPortal(
        <motion.div
          ref={popoverRef}
          data-clod-ui
          initial={{ opacity: 0, y: isExpanded ? -4 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: isExpanded ? -4 : 4 }}
          transition={{ duration: 0.12 }}
          className="rounded-xl"
          style={{
            position: 'fixed',
            ...(pos.top != null ? { top: pos.top } : {}),
            ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
            right: pos.right,
            width: 240,
            pointerEvents: 'auto',
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
            ...(pos.maxHeight != null ? { maxHeight: pos.maxHeight, overflowY: 'auto' as const } : {}),
          }}
        >
          <div className="p-3 flex flex-col gap-2" style={{ minHeight: 0 }}>
            {/* Accessibility warning — only when the double-tap hook can't get events */}
            {accessibilityOk === false && (
              <>
                <button
                  type="button"
                  onClick={() => window.clod.openAccessibilitySettings()}
                  className="flex items-start gap-2 rounded-lg p-2 text-left transition-colors"
                  style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)' }}
                >
                  <Warning size={14} weight="fill" style={{ color: '#f59e0b', marginTop: 1, flexShrink: 0 }} />
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                      Double-tap needs Accessibility
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: colors.textTertiary }}>
                      Click to grant it. Cmd+Shift+K works meanwhile.
                    </div>
                  </div>
                </button>
                <div style={{ height: 1, background: colors.popoverBorder }} />
              </>
            )}

            {/* Full width */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ArrowsOutSimple size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Full width
                  </div>
                </div>
                <RowToggle
                  checked={expandedUI}
                  onChange={(next) => {
                    setExpandedUI(next)
                  }}
                  colors={colors}
                  label="Toggle full width panel"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Screen position */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <AlignBottom size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Screen position
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {(['center', 'right'] as const).map((pos) => {
                    const active = windowPosition === pos
                    return (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => setWindowPosition(pos)}
                        className="rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors"
                        style={{
                          background: active ? colors.accent : colors.surfaceSecondary,
                          color: active ? '#fff' : colors.textSecondary,
                          border: `1px solid ${active ? colors.accent : colors.containerBorder}`,
                        }}
                      >
                        {pos}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Shortcut */}
            <div>
              <div className="flex items-center gap-2 min-w-0 mb-1.5">
                <Keyboard size={14} style={{ color: colors.textTertiary }} />
                <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                  Shortcut
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setHotkey('double-option', hotkeyAccelerator)}
                  className="flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors"
                  style={{
                    background: hotkeyMode === 'double-option' ? colors.accent : colors.surfaceSecondary,
                    color: hotkeyMode === 'double-option' ? '#fff' : colors.textSecondary,
                    border: `1px solid ${hotkeyMode === 'double-option' ? colors.accent : colors.containerBorder}`,
                  }}
                >
                  Double-tap ⌥
                </button>
                <button
                  type="button"
                  onClick={() => setRecording(true)}
                  className="flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors truncate"
                  style={{
                    background: hotkeyMode === 'accelerator' ? colors.accent : colors.surfaceSecondary,
                    color: hotkeyMode === 'accelerator' ? '#fff' : colors.textSecondary,
                    border: `1px solid ${hotkeyMode === 'accelerator' ? colors.accent : colors.containerBorder}`,
                  }}
                  title="Click, then press a key combo"
                >
                  {recording ? 'Press keys…' : (hotkeyMode === 'accelerator' && hotkeyAccelerator ? hotkeyAccelerator : 'Custom…')}
                </button>
              </div>
              <div className="text-[10px] mt-1" style={{ color: colors.textTertiary }}>
                Cmd+Shift+K always works too.
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Input prompt text */}
            <div>
              <div className="flex items-center gap-2 min-w-0 mb-1.5">
                <TextAa size={14} style={{ color: colors.textTertiary }} />
                <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                  Input prompt
                </div>
              </div>
              <input
                type="text"
                value={inputPlaceholder}
                onChange={(e) => setInputPlaceholder(e.target.value)}
                placeholder="What do you want this time ..."
                className="w-full rounded-md px-2 py-1 text-[11px]"
                style={{ background: colors.surfaceSecondary, color: colors.textPrimary, border: `1px solid ${colors.containerBorder}`, outline: 'none' }}
              />
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Input glow animation */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkle size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Input glow
                  </div>
                </div>
                <RowToggle
                  checked={borderAnimation}
                  onChange={setBorderAnimation}
                  colors={colors}
                  label="Toggle input glow animation"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Notification sound */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Bell size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Notification sound
                  </div>
                </div>
                <RowToggle
                  checked={soundEnabled}
                  onChange={setSoundEnabled}
                  colors={colors}
                  label="Toggle notification sound"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Theme */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Moon size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Dark theme
                  </div>
                </div>
                <RowToggle
                  checked={themeMode === 'dark'}
                  onChange={(next) => setThemeMode(next ? 'dark' : 'light')}
                  colors={colors}
                  label="Toggle dark theme"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Open at login */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Power size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Open at login
                  </div>
                </div>
                <RowToggle
                  checked={openAtLogin}
                  onChange={setOpenAtLogin}
                  colors={colors}
                  label="Toggle open at login"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Default model */}
            <div>
              <div className="flex items-center gap-2 min-w-0 mb-1.5">
                <Cpu size={14} style={{ color: colors.textTertiary }} />
                <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                  Default model
                </div>
              </div>
              <div className="flex gap-1">
                {AVAILABLE_MODELS.map((m) => {
                  const active = m.id === activeModelId
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPreferredModel(m.id)}
                      className="flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors"
                      style={{
                        background: active ? colors.accent : colors.surfaceSecondary,
                        color: active ? '#fff' : colors.textSecondary,
                        border: `1px solid ${active ? colors.accent : colors.containerBorder}`,
                      }}
                      title={m.id}
                    >
                      {m.label.replace(/^Claude /, '')}
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Default folder */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderOpen size={14} style={{ color: colors.textTertiary }} />
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                      Default folder
                    </div>
                    <div className="text-[11px] truncate" style={{ color: colors.textTertiary }} title={effectiveDefaultDir}>
                      {defaultDirName}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={handleChooseFolder}
                    className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
                    style={{ background: colors.surfaceSecondary, color: colors.textSecondary, border: `1px solid ${colors.containerBorder}` }}
                  >
                    Change
                  </button>
                  {defaultDirOverride && (
                    <button
                      type="button"
                      onClick={() => setDefaultDirOverride(null)}
                      className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
                      style={{ background: 'transparent', color: colors.textTertiary, border: `1px solid ${colors.containerBorder}` }}
                      title="Reset to the default scratch folder"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Auto-approve tools (permission mode) */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldCheck size={14} style={{ color: permissionMode === 'auto' ? '#f59e0b' : colors.textTertiary }} />
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                      Auto-approve tools
                    </div>
                    <div className="text-[11px]" style={{ color: colors.textTertiary }}>
                      {permissionMode === 'auto' ? 'Runs tools without asking' : 'Asks before each tool'}
                    </div>
                  </div>
                </div>
                <RowToggle
                  checked={permissionMode === 'auto'}
                  onChange={(next) => setPermissionMode(next ? 'auto' : 'ask')}
                  colors={colors}
                  label="Toggle auto-approve tools"
                />
              </div>
            </div>
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}
