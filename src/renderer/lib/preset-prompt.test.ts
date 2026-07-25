import { describe, it, expect } from 'vitest'
import { resolvePromptState, type PromptState } from './preset-prompt'

const custom: PromptState = { systemPrompt: 'Answer anything.', systemPromptMode: 'replace' }
const cleared: PromptState = { systemPrompt: null, systemPromptMode: 'append' }

describe('resolvePromptState', () => {
  it('leaves state untouched when the preset sets no prompt', () => {
    expect(resolvePromptState(custom, {})).toBe(custom)
  })

  it('clears a custom prompt when the preset explicitly resets to default', () => {
    expect(resolvePromptState(custom, { systemPrompt: null })).toEqual(cleared)
  })

  it('applies a custom prompt with its mode', () => {
    expect(resolvePromptState(cleared, { systemPrompt: 'Be terse.', systemPromptMode: 'replace' }))
      .toEqual({ systemPrompt: 'Be terse.', systemPromptMode: 'replace' })
  })

  it('defaults an unspecified mode to append', () => {
    expect(resolvePromptState(custom, { systemPrompt: 'Be terse.' }))
      .toEqual({ systemPrompt: 'Be terse.', systemPromptMode: 'append' })
  })

  it('does not mutate the current state', () => {
    const before = { ...custom }
    resolvePromptState(custom, { systemPrompt: null })
    expect(custom).toEqual(before)
  })
})
