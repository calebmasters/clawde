import { describe, it, expect } from 'vitest'
import { buildSystemPromptArgs, CLOD_UI_HINT, CLOD_ENGINEER_HINT } from './system-prompt'

describe('buildSystemPromptArgs', () => {
  it('appends the UI hint and the engineer hint when there is no custom prompt', () => {
    const [flag, value] = buildSystemPromptArgs({})
    expect(flag).toBe('--append-system-prompt')
    expect(value).toContain(CLOD_UI_HINT)
    expect(value).toContain(CLOD_ENGINEER_HINT)
  })

  it('drops the engineer hint in append mode so a custom prompt is not contradicted', () => {
    const [flag, value] = buildSystemPromptArgs({ systemPrompt: 'Answer anything.' })
    expect(flag).toBe('--append-system-prompt')
    expect(value).toContain(CLOD_UI_HINT)
    expect(value).not.toContain(CLOD_ENGINEER_HINT)
  })

  it('puts the custom prompt last in append mode, for authority over the base prompt', () => {
    const [, value] = buildSystemPromptArgs({ systemPrompt: 'Answer anything.' })
    expect(value.indexOf('Answer anything.')).toBeGreaterThan(value.indexOf(CLOD_UI_HINT))
  })

  it('replaces the base prompt and keeps the UI hint in replace mode', () => {
    const [flag, value] = buildSystemPromptArgs({
      systemPrompt: 'Answer anything.',
      systemPromptMode: 'replace',
    })
    expect(flag).toBe('--system-prompt')
    expect(value).toContain('Answer anything.')
    expect(value).toContain(CLOD_UI_HINT)
    expect(value).not.toContain(CLOD_ENGINEER_HINT)
    expect(value.indexOf('Answer anything.')).toBeLessThan(value.indexOf(CLOD_UI_HINT))
  })

  it('defaults an unspecified mode to append', () => {
    expect(buildSystemPromptArgs({ systemPrompt: 'x' })[0]).toBe('--append-system-prompt')
  })

  it('treats a blank or whitespace-only prompt as absent', () => {
    for (const systemPrompt of ['', '   \n  ']) {
      const [flag, value] = buildSystemPromptArgs({ systemPrompt, systemPromptMode: 'replace' })
      expect(flag).toBe('--append-system-prompt')
      expect(value).toContain(CLOD_ENGINEER_HINT)
    }
  })

  it('trims surrounding whitespace from the custom prompt', () => {
    const [, value] = buildSystemPromptArgs({ systemPrompt: '  Answer anything.  ' })
    expect(value).toContain('Answer anything.')
    expect(value).not.toContain('  Answer anything.  ')
  })

  it('always returns exactly one flag and one value', () => {
    expect(buildSystemPromptArgs({})).toHaveLength(2)
    expect(buildSystemPromptArgs({ systemPrompt: 'x' })).toHaveLength(2)
    expect(buildSystemPromptArgs({ systemPrompt: 'x', systemPromptMode: 'replace' })).toHaveLength(2)
  })
})
