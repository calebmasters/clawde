/**
 * Validation for AskUserQuestion tool_input (schema per Claude Code docs,
 * confirmed by scripts/spike-ask-question.mjs). Fail-closed: anything
 * malformed returns null and the hook denies.
 */
import type { QuestionItem, QuestionOption } from '../../shared/types'

const MAX_QUESTIONS = 4
const MAX_OPTIONS = 12
const MAX_TEXT = 4000

function parseOption(v: unknown): QuestionOption | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { label?: unknown; description?: unknown }
  if (typeof o.label !== 'string' || o.label.length === 0 || o.label.length > MAX_TEXT) return null
  const description = typeof o.description === 'string' && o.description.length <= MAX_TEXT
    ? o.description
    : undefined
  return description !== undefined ? { label: o.label, description } : { label: o.label }
}

function parseQuestion(v: unknown): QuestionItem | null {
  if (!v || typeof v !== 'object') return null
  const q = v as { question?: unknown; header?: unknown; options?: unknown; multiSelect?: unknown }
  if (typeof q.question !== 'string' || q.question.length === 0 || q.question.length > MAX_TEXT) return null
  if (!Array.isArray(q.options) || q.options.length === 0 || q.options.length > MAX_OPTIONS) return null
  const options: QuestionOption[] = []
  for (const raw of q.options) {
    const opt = parseOption(raw)
    if (!opt) return null
    options.push(opt)
  }
  return {
    question: q.question,
    header: typeof q.header === 'string' ? q.header : undefined,
    options,
    multiSelect: q.multiSelect === true,
  }
}

export function parseQuestions(toolInput: Record<string, unknown> | undefined): QuestionItem[] | null {
  if (!toolInput || !Array.isArray(toolInput.questions)) return null
  if (toolInput.questions.length === 0 || toolInput.questions.length > MAX_QUESTIONS) return null
  const items: QuestionItem[] = []
  for (const raw of toolInput.questions) {
    const q = parseQuestion(raw)
    if (!q) return null
    items.push(q)
  }
  return items
}
