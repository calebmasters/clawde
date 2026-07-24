import { describe, it, expect } from 'vitest'
import { parseQuestions } from './questions'

const valid = {
  questions: [{
    question: 'Which color do you prefer?',
    header: 'Color',
    options: [
      { label: 'red', description: 'Warm' },
      { label: 'blue' },
    ],
    multiSelect: false,
  }],
}

describe('parseQuestions', () => {
  it('parses a valid single question', () => {
    expect(parseQuestions(valid)).toEqual([{
      question: 'Which color do you prefer?',
      header: 'Color',
      options: [{ label: 'red', description: 'Warm' }, { label: 'blue' }],
      multiSelect: false,
    }])
  })

  it('defaults multiSelect to false and header to undefined', () => {
    const result = parseQuestions({ questions: [{ question: 'Q?', options: [{ label: 'a' }] }] })
    expect(result).toEqual([{ question: 'Q?', header: undefined, options: [{ label: 'a' }], multiSelect: false }])
  })

  it('rejects missing/empty questions array', () => {
    expect(parseQuestions(undefined)).toBeNull()
    expect(parseQuestions({})).toBeNull()
    expect(parseQuestions({ questions: [] })).toBeNull()
    expect(parseQuestions({ questions: 'nope' })).toBeNull()
  })

  it('rejects a question with no valid options or empty text', () => {
    expect(parseQuestions({ questions: [{ question: 'Q?', options: [] }] })).toBeNull()
    expect(parseQuestions({ questions: [{ question: '', options: [{ label: 'a' }] }] })).toBeNull()
    expect(parseQuestions({ questions: [{ question: 'Q?', options: [{ label: '' }] }] })).toBeNull()
  })

  it('drops non-string descriptions but keeps the option', () => {
    const result = parseQuestions({ questions: [{ question: 'Q?', options: [{ label: 'a', description: 42 }] }] })
    expect(result).toEqual([{ question: 'Q?', header: undefined, options: [{ label: 'a' }], multiSelect: false }])
  })

  it('caps at 4 questions and 12 options (defensive)', () => {
    const q = { question: 'Q?', options: [{ label: 'a' }] }
    expect(parseQuestions({ questions: [q, q, q, q, q] })).toBeNull()
    const manyOpts = { question: 'Q?', options: Array.from({ length: 13 }, (_, i) => ({ label: `o${i}` })) }
    expect(parseQuestions({ questions: [manyOpts] })).toBeNull()
  })

  it('drops an oversized header but keeps the question', () => {
    const result = parseQuestions({ questions: [{ question: 'Q?', header: 'h'.repeat(5000), options: [{ label: 'a' }] }] })
    expect(result).toEqual([{ question: 'Q?', header: undefined, options: [{ label: 'a' }], multiSelect: false }])
  })
})
