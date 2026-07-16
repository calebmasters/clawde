import { describe, it, expect } from 'vitest'
import { normalize } from './event-normalizer'
import type { ClaudeEvent } from '../../shared/types'

const ev = (o: unknown) => o as ClaudeEvent

describe('normalize', () => {
  it('maps a system/init event to session_init', () => {
    const out = normalize(ev({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      tools: ['Read', 'Write'],
      model: 'claude-sonnet-5',
      mcp_servers: ['github'],
      skills: ['pdf'],
      claude_code_version: '1.2.3',
    }))
    expect(out).toEqual([{
      type: 'session_init',
      sessionId: 'sess-1',
      tools: ['Read', 'Write'],
      model: 'claude-sonnet-5',
      mcpServers: ['github'],
      skills: ['pdf'],
      version: '1.2.3',
    }])
  })

  it('ignores non-init system subtypes', () => {
    expect(normalize(ev({ type: 'system', subtype: 'other' }))).toEqual([])
  })

  it('maps a text_delta stream event to a text_chunk', () => {
    const out = normalize(ev({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
    }))
    expect(out).toEqual([{ type: 'text_chunk', text: 'hello' }])
  })

  it('maps a successful result to task_complete', () => {
    const out = normalize(ev({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      total_cost_usd: 0.02,
      duration_ms: 1500,
      num_turns: 3,
      usage: { input_tokens: 10 },
      session_id: 'sess-1',
    }))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      type: 'task_complete',
      result: 'done',
      costUsd: 0.02,
      durationMs: 1500,
      numTurns: 3,
      sessionId: 'sess-1',
    })
  })

  it('maps an error result to an error event', () => {
    const out = normalize(ev({
      type: 'result',
      subtype: 'error',
      is_error: true,
      result: 'boom',
      session_id: 'sess-1',
    }))
    expect(out).toEqual([{ type: 'error', message: 'boom', isError: true, sessionId: 'sess-1' }])
  })

  it('maps a permission_request with options', () => {
    const out = normalize(ev({
      type: 'permission_request',
      question_id: 'q1',
      tool: { name: 'Bash', description: 'run', input: { cmd: 'ls' } },
      options: [{ id: 'allow', label: 'Allow', kind: 'allow' }, { id: 'deny', label: 'Deny', kind: 'deny' }],
    }))
    expect(out).toEqual([{
      type: 'permission_request',
      questionId: 'q1',
      toolName: 'Bash',
      toolDescription: 'run',
      toolInput: { cmd: 'ls' },
      options: [
        { id: 'allow', label: 'Allow', kind: 'allow' },
        { id: 'deny', label: 'Deny', kind: 'deny' },
      ],
    }])
  })

  it('returns [] for unknown event types', () => {
    expect(normalize(ev({ type: 'totally_unknown' }))).toEqual([])
  })
})
