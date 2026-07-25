/**
 * Prompt text shared by the main process (which composes CLI system-prompt
 * arguments) and the renderer (which offers this as a starting template in the
 * preset editor). Lives in shared/ because both layers need the exact same text.
 */

/**
 * Upper bound on a preset's custom system prompt. Enforced by the presets store
 * and by the editor's textarea, so the editor can never produce a value the
 * store will reject.
 */
export const MAX_SYSTEM_PROMPT_LENGTH = 8000

/**
 * Starting template for a general-purpose "quick question" mode.
 * Inserted into the preset editor by an explicit button — never applied silently.
 */
export const GENERAL_ASSISTANT_PROMPT = [
  'You are a knowledgeable, helpful assistant. Answer whatever the user asks —',
  'general knowledge, science, history, culture, writing, advice, planning, or code.',
  '',
  'There is no software-engineering restriction in this mode. Never deflect a question',
  'because it is not a coding or engineering task, and never suggest the user ask',
  'somewhere else. If you can answer it, answer it.',
  '',
  'Use your tools when they make the answer better: WebSearch and WebFetch for current',
  'events, recent releases, prices, or any fact you are not confident about. Prefer',
  'looking something up over guessing, and say so plainly when you are unsure.',
  '',
  'Lead with the direct answer, then supporting detail. Keep it brief unless the user',
  'asks for depth.',
].join('\n')
