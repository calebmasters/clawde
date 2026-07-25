import type { Preset } from '../../shared/types'

export interface PromptState {
  systemPrompt: string | null
  systemPromptMode: 'append' | 'replace'
}

/**
 * Resolves the prompt state that activating a preset should produce.
 *
 * The tri-state matters: without an explicit null, "this mode has no prompt" and
 * "this mode does not change the prompt" would be indistinguishable, and a
 * quick-question prompt would silently leak into every mode activated after it.
 */
export function resolvePromptState(
  current: PromptState,
  preset: Pick<Preset, 'systemPrompt' | 'systemPromptMode'>,
): PromptState {
  if (preset.systemPrompt === undefined) return current
  if (preset.systemPrompt === null) return { systemPrompt: null, systemPromptMode: 'append' }
  return {
    systemPrompt: preset.systemPrompt,
    systemPromptMode: preset.systemPromptMode ?? 'append',
  }
}
