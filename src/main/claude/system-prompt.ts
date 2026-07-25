/**
 * Composes the system-prompt CLI arguments for a run.
 *
 * Clod always tells Claude it is rendering into a rich markdown GUI (CLOD_UI_HINT).
 * The software-engineering framing (CLOD_ENGINEER_HINT) is Claude Code's default
 * posture, and Clod only reinforces it when the active mode has no custom prompt —
 * a "quick question" mode replaces it so general-knowledge questions get answered
 * instead of deflected.
 *
 * Replace mode composes the whole prompt here and emits a single --system-prompt.
 * The CLI documents --append-system-prompt as appending to *the default* prompt;
 * its behavior alongside a replacement prompt is unspecified, so we don't rely on it.
 */
import type { RunOptions } from '../../shared/types'

/** Rich-UI guidance. Applied in every mode. */
export const CLOD_UI_HINT = [
  'IMPORTANT: You are NOT running in a terminal. You are running inside CLOD,',
  'a desktop chat application with a rich UI that renders full markdown.',
  'CLOD is a GUI wrapper around Claude Code — the user sees your output in a',
  'styled conversation view, not a raw terminal.',
  '',
  'Because CLOD renders markdown natively, you MUST use rich formatting when it helps:',
  '- Always use clickable markdown links: [label](https://url) — they render as real buttons.',
  '- When the user asks for images, and public web images are appropriate, proactively find and render them in CLOD.',
  '- Workflow: WebSearch for relevant public pages -> WebFetch those pages -> extract real image URLs -> render with markdown ![alt](url).',
  '- Do not guess, fabricate, or construct image URLs from memory.',
  '- Only embed images when the URL is a real publicly accessible image URL found through tools or explicitly provided by the user.',
  '- If real image URLs cannot be obtained confidently, fall back to clickable links and briefly say so.',
  '- Do not ask whether CLOD can render images; assume it can.',
  '- Use tables, bold, headers, and bullet lists freely — they all render beautifully.',
  '- Use code blocks with language tags for syntax highlighting.',
  '',
  'The user expects a polished chat experience, not raw terminal text.',
].join('\n')

/** Software-engineering framing. Applied only when the mode has no custom prompt. */
export const CLOD_ENGINEER_HINT = [
  'You are still a software engineering assistant. Keep using your tools (Read, Edit, Bash, etc.)',
  'normally. But when presenting information, links, resources, or explanations to the user,',
  'take full advantage of the rich UI.',
].join('\n')

export function buildSystemPromptArgs(
  options: Pick<RunOptions, 'systemPrompt' | 'systemPromptMode'>,
): string[] {
  const custom = options.systemPrompt?.trim()
  if (!custom) {
    return ['--append-system-prompt', `${CLOD_UI_HINT}\n\n${CLOD_ENGINEER_HINT}`]
  }
  if (options.systemPromptMode === 'replace') {
    return ['--system-prompt', `${custom}\n\n${CLOD_UI_HINT}`]
  }
  return ['--append-system-prompt', `${CLOD_UI_HINT}\n\n${custom}`]
}
