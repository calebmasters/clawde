import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowUp, Camera, Paperclip } from '@phosphor-icons/react'
import { useSessionStore, AVAILABLE_MODELS } from '../stores/sessionStore'
import { AttachmentChips } from './AttachmentChips'
import { SlashCommandMenu, getFilteredCommandsWithExtras, type SlashCommand } from './SlashCommandMenu'
import { useColors, useThemeStore, DEFAULT_PLACEHOLDER } from '../theme'

const INPUT_MIN_HEIGHT = 20
const INPUT_MAX_HEIGHT = 140
const MULTILINE_ENTER_HEIGHT = 52
const MULTILINE_EXIT_HEIGHT = 50
const INLINE_CONTROLS_RESERVED_WIDTH = 104

/**
 * InputBar renders inside a glass-surface rounded-full pill provided by App.tsx.
 * It provides: textarea + attach/screenshot/send buttons. Attachment chips render above when present.
 */
export function InputBar() {
  const [input, setInput] = useState('')
  const [slashFilter, setSlashFilter] = useState<string | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [isMultiLine, setIsMultiLine] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLTextAreaElement | null>(null)

  const sendMessage = useSessionStore((s) => s.sendMessage)
  const clearTab = useSessionStore((s) => s.clearTab)
  const addSystemMessage = useSessionStore((s) => s.addSystemMessage)
  const addAttachments = useSessionStore((s) => s.addAttachments)
  const removeAttachment = useSessionStore((s) => s.removeAttachment)

  const handleScreenshot = useCallback(async () => {
    const result = await window.clod.takeScreenshot()
    if (result) addAttachments([result])
  }, [addAttachments])

  const handleAttachFile = useCallback(async () => {
    const files = await window.clod.attachFiles()
    if (files && files.length > 0) addAttachments(files)
  }, [addAttachments])

  const setPreferredModel = useSessionStore((s) => s.setPreferredModel)
  const staticInfo = useSessionStore((s) => s.staticInfo)
  const preferredModel = useSessionStore((s) => s.preferredModel)
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const tab = useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const colors = useColors()
  const inputPlaceholder = useThemeStore((s) => s.inputPlaceholder) || DEFAULT_PLACEHOLDER
  const isBusy = tab?.status === 'running' || tab?.status === 'connecting'
  const isConnecting = tab?.status === 'connecting'
  const hasContent = input.trim().length > 0 || (tab?.attachments?.length ?? 0) > 0
  const canSend = !!tab && !isConnecting && hasContent
  const attachments = tab?.attachments || []
  const showSlashMenu = slashFilter !== null && !isConnecting
  const skillCommands: SlashCommand[] = (tab?.sessionSkills || []).map((skill) => ({
    command: `/${skill}`,
    description: `Run skill: ${skill}`,
    icon: <span className="text-[11px]">✦</span>,
  }))

  useEffect(() => {
    textareaRef.current?.focus()
  }, [activeTabId])

  // Focus textarea when window is shown (shortcut toggle, screenshot return)
  useEffect(() => {
    const unsub = window.clod.onWindowShown(() => {
      textareaRef.current?.focus()
    })
    return unsub
  }, [])

  const measureInlineHeight = useCallback((value: string): number => {
    if (typeof document === 'undefined') return 0
    if (!measureRef.current) {
      const m = document.createElement('textarea')
      m.setAttribute('aria-hidden', 'true')
      m.tabIndex = -1
      m.style.position = 'absolute'
      m.style.top = '-99999px'
      m.style.left = '0'
      m.style.height = '0'
      m.style.minHeight = '0'
      m.style.overflow = 'hidden'
      m.style.visibility = 'hidden'
      m.style.pointerEvents = 'none'
      m.style.zIndex = '-1'
      m.style.resize = 'none'
      m.style.border = '0'
      m.style.outline = '0'
      m.style.boxSizing = 'border-box'
      document.body.appendChild(m)
      measureRef.current = m
    }

    const m = measureRef.current
    const hostWidth = wrapperRef.current?.clientWidth ?? 0
    const inlineWidth = Math.max(120, hostWidth - INLINE_CONTROLS_RESERVED_WIDTH)
    m.style.width = `${inlineWidth}px`
    m.style.fontSize = '14px'
    m.style.lineHeight = '20px'
    m.style.paddingTop = '15px'
    m.style.paddingBottom = '15px'
    m.style.paddingLeft = '0'
    m.style.paddingRight = '0'

    const computed = textareaRef.current ? window.getComputedStyle(textareaRef.current) : null
    if (computed) {
      m.style.fontFamily = computed.fontFamily
      m.style.letterSpacing = computed.letterSpacing
      m.style.fontWeight = computed.fontWeight
    }

    m.value = value || ' '
    return m.scrollHeight
  }, [])

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = `${INPUT_MIN_HEIGHT}px`
    const naturalHeight = el.scrollHeight
    const clampedHeight = Math.min(naturalHeight, INPUT_MAX_HEIGHT)
    el.style.height = `${clampedHeight}px`
    el.style.overflowY = naturalHeight > INPUT_MAX_HEIGHT ? 'auto' : 'hidden'
    if (naturalHeight <= INPUT_MAX_HEIGHT) {
      el.scrollTop = 0
    }
    // Decide multiline mode against fixed inline-width measurement to avoid
    // expand/collapse bounce when layout switches between modes.
    const inlineHeight = measureInlineHeight(input)
    setIsMultiLine((prev) => {
      if (!prev) return inlineHeight > MULTILINE_ENTER_HEIGHT
      return inlineHeight > MULTILINE_EXIT_HEIGHT
    })
  }, [input, measureInlineHeight])

  useLayoutEffect(() => { autoResize() }, [input, isMultiLine, autoResize])

  useEffect(() => {
    return () => {
      if (measureRef.current) {
        measureRef.current.remove()
        measureRef.current = null
      }
    }
  }, [])

  // ─── Slash command detection ───
  const updateSlashFilter = useCallback((value: string) => {
    const match = value.match(/^(\/[a-zA-Z-]*)$/)
    if (match) {
      setSlashFilter(match[1])
      setSlashIndex(0)
    } else {
      setSlashFilter(null)
    }
  }, [])

  // ─── Handle slash commands ───
  const executeCommand = useCallback((cmd: SlashCommand) => {
    switch (cmd.command) {
      case '/clear':
        clearTab()
        addSystemMessage('Conversation cleared.')
        break
      case '/cost': {
        if (tab?.lastResult) {
          const r = tab.lastResult
          const parts = [`$${r.totalCostUsd.toFixed(4)}`, `${(r.durationMs / 1000).toFixed(1)}s`, `${r.numTurns} turn${r.numTurns !== 1 ? 's' : ''}`]
          if (r.usage.input_tokens) {
            parts.push(`${r.usage.input_tokens.toLocaleString()} in / ${(r.usage.output_tokens || 0).toLocaleString()} out`)
          }
          addSystemMessage(parts.join(' · '))
        } else {
          addSystemMessage('No cost data yet — send a message first.')
        }
        break
      }
      case '/model': {
        const model = tab?.sessionModel || null
        const version = tab?.sessionVersion || staticInfo?.version || null
        const current = preferredModel || model || 'default'
        const lines = AVAILABLE_MODELS.map((m) => {
          const active = m.id === current || (!preferredModel && m.id === model)
          return `  ${active ? '\u25CF' : '\u25CB'} ${m.label} (${m.id})`
        })
        const header = version ? `Claude Code ${version}` : 'Claude Code'
        addSystemMessage(`${header}\n\n${lines.join('\n')}\n\nSwitch model: type /model <name>\n  e.g. /model sonnet`)
        break
      }
      case '/mcp': {
        if (tab?.sessionMcpServers && tab.sessionMcpServers.length > 0) {
          const lines = tab.sessionMcpServers.map((s) => {
            const icon = s.status === 'connected' ? '\u2713' : s.status === 'failed' ? '\u2717' : '\u25CB'
            return `  ${icon} ${s.name} — ${s.status}`
          })
          addSystemMessage(`MCP Servers (${tab.sessionMcpServers.length}):\n${lines.join('\n')}`)
        } else if (tab?.claudeSessionId) {
          addSystemMessage('No MCP servers connected in this session.')
        } else {
          addSystemMessage('No MCP data yet — send a message to start a session.')
        }
        break
      }
      case '/skills': {
        if (tab?.sessionSkills && tab.sessionSkills.length > 0) {
          const lines = tab.sessionSkills.map((s) => `/${s}`)
          addSystemMessage(`Available skills (${tab.sessionSkills.length}):\n${lines.join('\n')}`)
        } else if (tab?.claudeSessionId) {
          addSystemMessage('No skills available in this session.')
        } else {
          addSystemMessage('No session metadata yet — send a message first.')
        }
        break
      }
      case '/help': {
        const lines = [
          '/clear — Clear conversation history',
          '/cost — Show token usage and cost',
          '/model — Show model info & switch models',
          '/mcp — Show MCP server status',
          '/skills — Show available skills',
          '/help — Show this list',
        ]
        addSystemMessage(lines.join('\n'))
        break
      }
    }
  }, [tab, clearTab, addSystemMessage, staticInfo, preferredModel])

  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    const isSkillCommand = !!tab?.sessionSkills?.includes(cmd.command.replace(/^\//, ''))
    if (isSkillCommand) {
      setInput(`${cmd.command} `)
      setSlashFilter(null)
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }
    setInput('')
    setSlashFilter(null)
    executeCommand(cmd)
  }, [executeCommand, tab?.sessionSkills])

  // ─── Send ───
  const handleSend = useCallback(() => {
    if (showSlashMenu) {
      const filtered = getFilteredCommandsWithExtras(slashFilter!, skillCommands)
      if (filtered.length > 0) {
        handleSlashSelect(filtered[slashIndex])
        return
      }
    }
    const prompt = input.trim()
    const modelMatch = prompt.match(/^\/model\s+(\S+)/i)
    if (modelMatch) {
      const query = modelMatch[1].toLowerCase()
      const match = AVAILABLE_MODELS.find((m: { id: string; label: string }) =>
        m.id.toLowerCase().includes(query) || m.label.toLowerCase().includes(query)
      )
      if (match) {
        setPreferredModel(match.id)
        setInput('')
        setSlashFilter(null)
        addSystemMessage(`Model switched to ${match.label} (${match.id})`)
      } else {
        setInput('')
        setSlashFilter(null)
        addSystemMessage(`Unknown model "${modelMatch[1]}". Available: opus, sonnet, haiku`)
      }
      return
    }
    if (!prompt && attachments.length === 0) return
    if (isConnecting) return
    setInput('')
    setSlashFilter(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = `${INPUT_MIN_HEIGHT}px`
    }
    sendMessage(prompt || 'See attached files')
    // Refocus after React re-renders from the state update
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [input, isBusy, sendMessage, attachments.length, showSlashMenu, slashFilter, slashIndex, handleSlashSelect])

  // ─── Keyboard ───
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashMenu) {
      const filtered = getFilteredCommandsWithExtras(slashFilter!, skillCommands)
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((i) => (i + 1) % filtered.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex((i) => (i - 1 + filtered.length) % filtered.length); return }
      if (e.key === 'Tab') { e.preventDefault(); if (filtered.length > 0) handleSlashSelect(filtered[slashIndex]); return }
      if (e.key === 'Escape') { e.preventDefault(); setSlashFilter(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape' && !showSlashMenu) { window.clod.hideWindow() }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)
    updateSlashFilter(value)
  }

  // ─── Paste image ───
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) return
        const reader = new FileReader()
        reader.onload = async () => {
          const dataUrl = reader.result as string
          const attachment = await window.clod.pasteImage(dataUrl)
          if (attachment) addAttachments([attachment])
        }
        reader.readAsDataURL(blob)
        return
      }
    }
  }, [addAttachments])

  const hasAttachments = attachments.length > 0

  return (
    <div ref={wrapperRef} data-clod-ui className="flex flex-col w-full relative">
      {/* Slash command menu */}
      <AnimatePresence>
        {showSlashMenu && (
          <SlashCommandMenu
            filter={slashFilter!}
            selectedIndex={slashIndex}
            onSelect={handleSlashSelect}
            anchorRect={wrapperRef.current?.getBoundingClientRect() ?? null}
            extraCommands={skillCommands}
          />
        )}
      </AnimatePresence>

      {/* Attachment chips — renders inside the pill, above textarea */}
      {hasAttachments && (
        <div style={{ paddingTop: 6, marginLeft: -6 }}>
          <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
        </div>
      )}

      {/* Single-line: inline controls. Multi-line: controls in bottom row */}
      <div className="w-full" style={{ minHeight: 50 }}>
        {isMultiLine ? (
          <div className="w-full">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                isConnecting
                  ? 'Initializing...'
                  : isBusy
                    ? 'Type to queue a message...'
                    : inputPlaceholder
              }
              rows={1}
              className="w-full bg-transparent resize-none"
              style={{
                fontSize: 14,
                lineHeight: '20px',
                color: colors.textPrimary,
                minHeight: 20,
                maxHeight: INPUT_MAX_HEIGHT,
                paddingTop: 11,
                paddingBottom: 2,
              }}
            />

            <div className="flex items-center justify-end gap-1" style={{ marginTop: 0, paddingBottom: 6 }}>
              <AttachControls colors={colors} disabled={isBusy} onScreenshot={handleScreenshot} onAttach={handleAttachFile} />
              <AnimatePresence>
                {canSend && (
                  <motion.div key="send" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.1 }}>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleSend}
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                      style={{ background: colors.sendBg, color: colors.textOnAccent }}
                      title={isBusy ? 'Queue message' : 'Send (Enter)'}
                    >
                      <ArrowUp size={16} weight="bold" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        ) : (
          <div className="flex items-center w-full" style={{ minHeight: 50 }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                isConnecting
                  ? 'Initializing...'
                  : isBusy
                    ? 'Type to queue a message...'
                    : inputPlaceholder
              }
              rows={1}
              className="flex-1 bg-transparent resize-none"
              style={{
                fontSize: 14,
                lineHeight: '20px',
                color: colors.textPrimary,
                minHeight: 20,
                maxHeight: INPUT_MAX_HEIGHT,
                paddingTop: 15,
                paddingBottom: 15,
              }}
            />

            <div className="flex items-center gap-1 shrink-0 ml-2">
              <AttachControls colors={colors} disabled={isBusy} onScreenshot={handleScreenshot} onAttach={handleAttachFile} />
              <AnimatePresence>
                {canSend && (
                  <motion.div key="send" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.1 }}>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleSend}
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                      style={{ background: colors.sendBg, color: colors.textOnAccent }}
                      title={isBusy ? 'Queue message' : 'Send (Enter)'}
                    >
                      <ArrowUp size={16} weight="bold" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Attach controls (screenshot + attach file) ───

function AttachControls({ colors, disabled, onScreenshot, onAttach }: {
  colors: ReturnType<typeof useColors>
  disabled: boolean
  onScreenshot: () => void
  onAttach: () => void
}) {
  const cls = 'w-9 h-9 rounded-full flex items-center justify-center transition-colors'
  return (
    <div className="flex items-center gap-1">
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={onScreenshot}
        disabled={disabled}
        className={cls}
        style={{ background: colors.micBg, color: colors.micColor }}
        title="Screenshot"
      >
        <Camera size={16} />
      </button>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={onAttach}
        disabled={disabled}
        className={cls}
        style={{ background: colors.micBg, color: colors.micColor }}
        title="Attach file"
      >
        <Paperclip size={16} />
      </button>
    </div>
  )
}
