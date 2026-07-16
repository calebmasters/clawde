import React, { useEffect, useCallback, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TabStrip } from './components/TabStrip'
import { ConversationView } from './components/ConversationView'
import { InputBar } from './components/InputBar'
import { AnimatedInputBorder } from './components/AnimatedInputBorder'
import { StatusBar } from './components/StatusBar'
import { MarketplacePanel } from './components/MarketplacePanel'
import { PopoverLayerProvider } from './components/PopoverLayer'
import { useClaudeEvents } from './hooks/useClaudeEvents'
import { useHealthReconciliation } from './hooks/useHealthReconciliation'
import { useSessionStore } from './stores/sessionStore'
import { useColors, useThemeStore, spacing } from './theme'

const TRANSITION = { duration: 0.26, ease: [0.4, 0, 0.1, 1] as const }

export default function App() {
  useClaudeEvents()
  useHealthReconciliation()

  const activeTabStatus = useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.status)
  const colors = useColors()
  const setSystemTheme = useThemeStore((s) => s.setSystemTheme)
  const expandedUI = useThemeStore((s) => s.expandedUI)
  const windowPosition = useThemeStore((s) => s.windowPosition)
  const borderAnimation = useThemeStore((s) => s.borderAnimation)
  const [inputFocused, setInputFocused] = useState(false)

  // Push persisted window position + hotkey to main on launch (main defaults to
  // center / double-tap Option).
  useEffect(() => {
    const t = useThemeStore.getState()
    try { window.clod.setWindowPosition(t.windowPosition) } catch {}
    try { window.clod.setHotkey(t.hotkeyMode, t.hotkeyAccelerator) } catch {}
    try { window.clod.setOpenAtLogin(t.openAtLogin) } catch {}
  }, [])

  // Position the overlay window: horizontal anchor (center/right) + a small,
  // even gap from the bottom edge. Driven from the renderer via the always-loaded
  // window-drag API so it works without a full restart. Runs on mount and when
  // the position preference changes.
  useEffect(() => {
    const move = () => {
      const scr = window.screen as Screen & { availLeft?: number; availTop?: number }
      const availLeft = scr.availLeft ?? 0
      const availTop = scr.availTop ?? 0
      const winW = window.outerWidth || 1040
      const winH = window.outerHeight || 720
      // Gap from the work-area bottom to the window bottom. The input sits ~10px
      // above the window bottom, so the visible bottom gap ≈ this + 10 ≈ the 16px
      // right-edge inset.
      const WINDOW_BOTTOM_GAP = 6
      const targetX = windowPosition === 'right'
        ? availLeft + scr.availWidth - winW
        : availLeft + Math.round((scr.availWidth - winW) / 2)
      const targetY = availTop + scr.availHeight - winH - WINDOW_BOTTOM_GAP
      const deltaX = Math.round(targetX - window.screenX)
      const deltaY = Math.round(targetY - window.screenY)
      if ((deltaX !== 0 || deltaY !== 0) && window.clod?.startWindowDrag) {
        window.clod.startWindowDrag(deltaX, deltaY)
      }
    }
    // Defer a tick so window.screenX/Y reflect the current native bounds.
    const id = setTimeout(move, 0)
    return () => clearTimeout(id)
  }, [windowPosition])

  // ─── Theme initialization ───
  useEffect(() => {
    // Get initial OS theme — setSystemTheme respects themeMode (system/light/dark)
    window.clod.getTheme().then(({ isDark }) => {
      setSystemTheme(isDark)
    }).catch(() => {})

    // Listen for OS theme changes
    const unsub = window.clod.onThemeChange((isDark) => {
      setSystemTheme(isDark)
    })
    return unsub
  }, [setSystemTheme])

  useEffect(() => {
    useSessionStore.getState().initStaticInfo().then(() => {
      const homeDir = useSessionStore.getState().defaultDirOverride || useSessionStore.getState().staticInfo?.defaultDir || useSessionStore.getState().staticInfo?.homePath || '~'
      const tab = useSessionStore.getState().tabs[0]
      if (tab) {
        // Set working directory to home by default (user hasn't chosen yet)
        useSessionStore.setState((s) => ({
          tabs: s.tabs.map((t, i) => (i === 0 ? { ...t, workingDirectory: homeDir, hasChosenDirectory: false } : t)),
        }))
        window.clod.createTab().then(({ tabId }) => {
          useSessionStore.setState((s) => ({
            tabs: s.tabs.map((t, i) => (i === 0 ? { ...t, id: tabId } : t)),
            activeTabId: tabId,
          }))
        }).catch(() => {})
      }
    })
  }, [])

  // Shared drag ref — must be declared before the setIgnoreMouseEvents effect so both closures can read it
  const dragRef = useRef<{ startX: number; startY: number } | null>(null)

  // Vertical position tracking — window moves first (until macOS clamps it), then CSS overflows
  const PILL_HEIGHT_CONST = 720
  const PILL_BOTTOM_MARGIN_CONST = 24
  const minWindowY = window.screen.availTop   // top of work area (below menu bar)
  const initialWindowY = window.screen.availTop + window.screen.availHeight - PILL_HEIGHT_CONST - PILL_BOTTOM_MARGIN_CONST
  const windowYRef = useRef(initialWindowY)
  const cardYRef = useRef(0) // CSS translateY offset (only used after window hits its y constraint)

  // OS-level click-through (RAF-throttled to avoid per-pixel IPC)
  useEffect(() => {
    if (!window.clod?.setIgnoreMouseEvents) return
    let lastIgnored: boolean | null = null

    const onMouseMove = (e: MouseEvent) => {
      // While dragging, keep full mouse capture — don't toggle ignore-events
      if (dragRef.current) return
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const isUI = !!(el && el.closest('[data-clod-ui]'))
      const shouldIgnore = !isUI
      if (shouldIgnore !== lastIgnored) {
        lastIgnored = shouldIgnore
        if (shouldIgnore) {
          window.clod.setIgnoreMouseEvents(true, { forward: true })
        } else {
          window.clod.setIgnoreMouseEvents(false)
        }
      }
    }

    const onMouseLeave = () => {
      if (dragRef.current) return
      if (lastIgnored !== true) {
        lastIgnored = true
        window.clod.setIgnoreMouseEvents(true, { forward: true })
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseleave', onMouseLeave)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [])

  // Manual window drag — bypasses -webkit-app-region conflicts with setIgnoreMouseEvents
  useEffect(() => {
    if (!window.clod?.startWindowDrag) return

    const onMouseDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      // Skip interactive elements — everything else on the card is draggable
      if (el.closest('button, input, textarea, a, select, [role="button"], [contenteditable], .cm-editor')) return
      if (!el.closest('[data-clod-ui]')) return
      e.preventDefault()
      // Double-click: snap back to default position
      if (e.detail >= 2) {
        window.clod.resetWindowPosition()
        windowYRef.current = initialWindowY
        cardYRef.current = 0
        document.documentElement.style.setProperty('--clod-card-y', '0px')
        return
      }
      // Ensure full mouse capture for the duration of the drag
      window.clod.setIgnoreMouseEvents(false)
      dragRef.current = { startX: e.screenX, startY: e.screenY }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const dx = e.screenX - dragRef.current.startX
      const dy = e.screenY - dragRef.current.startY
      if (dx !== 0 || dy !== 0) {
        // Horizontal: always native window movement (full screen width range)
        if (dx !== 0) window.clod.startWindowDrag(dx, 0)
        // Vertical: move window first (until macOS y constraint), then CSS within window
        if (dy !== 0) {
          if (dy < 0) {
            // Moving up — window first, then CSS overflow
            const windowCanMove = windowYRef.current - minWindowY
            const windowDy = Math.max(-windowCanMove, dy)
            const cssDy = dy - windowDy
            if (windowDy !== 0) {
              window.clod.startWindowDrag(0, windowDy)
              windowYRef.current += windowDy
            }
            if (cssDy !== 0) {
              cardYRef.current += cssDy
              document.documentElement.style.setProperty('--clod-card-y', `${cardYRef.current}px`)
            }
          } else {
            // Moving down — undo CSS first, then move window
            const cssUndo = Math.min(-cardYRef.current, dy)
            const windowDy = dy - cssUndo
            if (cssUndo !== 0) {
              cardYRef.current += cssUndo
              document.documentElement.style.setProperty('--clod-card-y', `${cardYRef.current}px`)
            }
            if (windowDy !== 0) {
              window.clod.startWindowDrag(0, windowDy)
              windowYRef.current += windowDy
            }
          }
        }
        dragRef.current.startX = e.screenX
        dragRef.current.startY = e.screenY
      }
    }

    const onMouseUp = () => {
      dragRef.current = null
    }

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const isExpanded = useSessionStore((s) => s.isExpanded)
  const marketplaceOpen = useSessionStore((s) => s.marketplaceOpen)

  // Layout dimensions — expandedUI widens and heightens the panel
  const contentWidth = expandedUI ? 700 : spacing.contentWidth
  const cardExpandedWidth = expandedUI ? 700 : 460
  const cardCollapsedWidth = expandedUI ? 670 : 430
  const cardCollapsedMargin = expandedUI ? 15 : 15
  const bodyMaxHeight = expandedUI ? 520 : 400

  return (
    <PopoverLayerProvider>
      <div
        className="flex flex-col justify-end h-full"
        style={{
          background: 'transparent',
          // Horizontal anchor: right mode pins the column to the window's right
          // edge (which sits at the screen's right edge); center mode uses margin auto.
          alignItems: windowPosition === 'right' ? 'flex-end' : undefined,
          paddingRight: windowPosition === 'right' ? 16 : 0,
        }}
      >

        {/* ─── content column. Circles overflow left. ─── */}
        <div style={{ width: contentWidth, position: 'relative', margin: windowPosition === 'right' ? '0' : '0 auto', transition: 'width 0.26s cubic-bezier(0.4, 0, 0.1, 1)', transform: 'translateY(var(--clod-card-y, 0px))' }}>

          <AnimatePresence initial={false}>
            {marketplaceOpen && (
              <div
                data-clod-ui
                style={{
                  width: 720,
                  maxWidth: 720,
                  marginLeft: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: 14,
                  position: 'relative',
                  zIndex: 30,
                }}
              >
                <motion.div
                  initial={{ opacity: 0, y: 14, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.985 }}
                  transition={TRANSITION}
                >
                  <div
                    data-clod-ui
                    className="glass-surface overflow-hidden no-drag"
                    style={{
                      borderRadius: 24,
                      maxHeight: 470,
                    }}
                  >
                    <MarketplacePanel />
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/*
            ─── Tabs / message shell ───
            This always remains the chat shell. The marketplace is a separate
            panel rendered above it, never inside it.
          */}
          <motion.div
            data-clod-ui
            className="overflow-hidden flex flex-col drag-region"
            animate={{
              width: isExpanded ? cardExpandedWidth : cardCollapsedWidth,
              // Collapsed: the square bottom runs straight down and tucks behind
              // the input bar. The tab strip's extra bottom padding keeps the
              // visible grey above and below the pill even despite this overlap.
              marginBottom: isExpanded ? 10 : -10,
              marginLeft: isExpanded ? 0 : cardCollapsedMargin,
              marginRight: isExpanded ? 0 : cardCollapsedMargin,
              background: isExpanded ? colors.containerBg : colors.containerBgCollapsed,
              borderColor: colors.containerBorder,
              boxShadow: isExpanded ? colors.cardShadow : colors.cardShadowCollapsed,
              // Compact: rounded top only, square bottom. Expanded: all four rounded.
              borderBottomLeftRadius: isExpanded ? 20 : 0,
              borderBottomRightRadius: isExpanded ? 20 : 0,
            }}
            transition={TRANSITION}
            style={{
              borderWidth: 1,
              borderStyle: 'solid',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              position: 'relative',
              zIndex: isExpanded ? 20 : 10,
            }}
          >
            {/* Tab strip — always mounted */}
            <div className="no-drag">
              <TabStrip />
            </div>

            {/* Body — chat history only; the marketplace is a separate overlay above */}
            <motion.div
              initial={false}
              animate={{
                height: isExpanded ? 'auto' : 0,
                opacity: isExpanded ? 1 : 0,
              }}
              transition={TRANSITION}
              className="overflow-hidden no-drag"
            >
              <div style={{ maxHeight: bodyMaxHeight }}>
                <ConversationView />
                <StatusBar />
              </div>
            </motion.div>
          </motion.div>

          {/* ─── Input row ─── */}
          {/* marginBottom: shadow buffer so the glass-surface drop shadow isn't clipped at the native window edge */}
          <div data-clod-ui className="relative" style={{ minHeight: 46, zIndex: 15, marginBottom: 10 }}>
            {/* Input pill */}
            <div
              data-clod-ui
              className="glass-surface w-full"
              style={{ position: 'relative', minHeight: 50, borderRadius: 20, padding: '0 6px 0 16px', background: colors.inputPillBg }}
              onFocusCapture={() => setInputFocused(true)}
              onBlurCapture={(e) => {
                // Only blur when focus leaves the pill entirely (not when moving
                // between the textarea and the attach/screenshot buttons).
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setInputFocused(false)
              }}
            >
              <AnimatedInputBorder enabled={borderAnimation} focused={inputFocused} />
              <InputBar />
            </div>
          </div>
        </div>
      </div>
    </PopoverLayerProvider>
  )
}
