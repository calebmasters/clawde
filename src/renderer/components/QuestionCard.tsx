import React, { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ChatCircleDots, Check } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'
import type { QuestionRequest } from '../../shared/types'

interface Props {
  tabId: string
  request: QuestionRequest
}

/**
 * Inline selectable answers for an AskUserQuestion request. Multiple
 * questions answer sequentially; the response is sent once, after the last.
 * Keyboard: ↑/↓ move, Enter selects (or submits multi-select), typing in
 * "Other" answers free-form.
 */
export function QuestionCard({ tabId, request }: Props) {
  const respondQuestion = useSessionStore((s) => s.respondQuestion)
  const colors = useColors()

  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [highlight, setHighlight] = useState(0)
  const [multiPicks, setMultiPicks] = useState<Set<number>>(new Set())
  const [otherText, setOtherText] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const question = request.questions[qIndex]

  // A pending question demands attention — move keyboard focus to the card.
  useEffect(() => {
    containerRef.current?.focus()
  }, [request.questionId, qIndex])

  if (!question || submitted) return null

  const optionCount = question.options.length

  const finishQuestion = (value: string | string[]) => {
    const nextAnswers = { ...answers, [question.question]: value }
    if (qIndex + 1 < request.questions.length) {
      setAnswers(nextAnswers)
      setQIndex(qIndex + 1)
      setHighlight(0)
      setMultiPicks(new Set())
      setOtherText('')
    } else {
      setSubmitted(true)
      respondQuestion(tabId, request.questionId, nextAnswers)
    }
  }

  const selectSingle = (i: number) => finishQuestion(question.options[i].label)

  const toggleMulti = (i: number) => {
    setMultiPicks((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const submitMulti = () => {
    const picks = question.options.filter((_, i) => multiPicks.has(i)).map((o) => o.label)
    const extra = otherText.trim()
    if (extra) picks.push(extra)
    if (picks.length === 0) return
    finishQuestion(picks)
  }

  const submitOther = () => {
    if (!otherText.trim()) return
    finishQuestion(otherText.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => (h + 1) % optionCount)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => (h - 1 + optionCount) % optionCount)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (question.multiSelect) {
        if (multiPicks.size > 0) submitMulti()
        else toggleMulti(highlight)
      } else {
        selectSingle(highlight)
      }
    } else if (e.key === ' ') {
      e.preventDefault()
      if (question.multiSelect) toggleMulti(highlight)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      transition={{ duration: 0.2 }}
      className="mx-4 mt-2 mb-2"
    >
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        style={{
          background: colors.containerBg,
          border: `1px solid ${colors.accentBorderMedium}`,
          borderRadius: 12,
          outline: 'none',
        }}
        className="overflow-hidden"
      >
        {/* Header */}
        <div
          className="flex items-center gap-1.5 px-3 py-1.5"
          style={{ background: colors.accentLight, borderBottom: `1px solid ${colors.accentBorder}` }}
        >
          <ChatCircleDots size={12} style={{ color: colors.accent }} />
          <span className="text-[11px] font-semibold" style={{ color: colors.accent }}>
            {question.header || 'Question'}
          </span>
          {request.questions.length > 1 && (
            <span className="text-[10px] ml-auto" style={{ color: colors.textTertiary }}>
              {qIndex + 1} / {request.questions.length}
            </span>
          )}
        </div>

        <div className="px-3 py-2.5">
          <p className="text-[12px] leading-[1.5] mb-2" style={{ color: colors.textPrimary }}>
            {question.question}
          </p>

          <div className="flex flex-col gap-1">
            {question.options.map((opt, i) => {
              const picked = question.multiSelect && multiPicks.has(i)
              const highlighted = highlight === i
              return (
                <button
                  key={`${i}-${opt.label}`}
                  onClick={() => (question.multiSelect ? toggleMulti(i) : selectSingle(i))}
                  onMouseEnter={() => setHighlight(i)}
                  className="w-full text-left rounded-lg px-2.5 py-1.5 transition-colors"
                  style={{
                    background: picked ? colors.accentSoft : highlighted ? colors.surfaceHover : 'transparent',
                    border: `1px solid ${picked || highlighted ? colors.accentBorderMedium : colors.containerBorder}`,
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    {question.multiSelect && (
                      <span
                        className="w-3 h-3 rounded-sm flex items-center justify-center flex-shrink-0"
                        style={{ border: `1px solid ${picked ? colors.accent : colors.textTertiary}`, background: picked ? colors.accent : 'transparent' }}
                      >
                        {picked && <Check size={9} weight="bold" style={{ color: colors.textOnAccent }} />}
                      </span>
                    )}
                    <span className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                      {opt.label}
                    </span>
                  </span>
                  {opt.description && (
                    <span className="block text-[11px] mt-0.5 leading-[1.4]" style={{ color: colors.textTertiary }}>
                      {opt.description}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Other + multi-select submit row */}
          <div className="flex items-center gap-1.5 mt-2">
            <input
              type="text"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  if (question.multiSelect) submitMulti()
                  else submitOther()
                }
              }}
              placeholder="Other…"
              className="flex-1 rounded-md px-2 py-1 text-[11px]"
              style={{ background: colors.surfaceSecondary, color: colors.textPrimary, border: `1px solid ${colors.containerBorder}`, outline: 'none' }}
            />
            {question.multiSelect ? (
              <button
                onClick={submitMulti}
                disabled={multiPicks.size === 0 && !otherText.trim()}
                className="text-[11px] font-medium px-3 py-1 rounded-full disabled:opacity-40"
                style={{ background: colors.accent, color: colors.textOnAccent }}
              >
                Continue
              </button>
            ) : otherText.trim() ? (
              <button
                onClick={submitOther}
                className="text-[11px] font-medium px-3 py-1 rounded-full"
                style={{ background: colors.accent, color: colors.textOnAccent }}
              >
                Send
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
