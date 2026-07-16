import { describe, it, expect, vi } from 'vitest'
import { StreamParser } from './stream-parser'

describe('StreamParser', () => {
  it('emits one event per complete JSON line', () => {
    const p = new StreamParser()
    const events: any[] = []
    p.on('event', (e) => events.push(e))
    p.feed('{"type":"a"}\n{"type":"b"}\n')
    expect(events).toEqual([{ type: 'a' }, { type: 'b' }])
  })

  it('buffers a partial line until its newline arrives', () => {
    const p = new StreamParser()
    const events: any[] = []
    p.on('event', (e) => events.push(e))
    p.feed('{"type":"a","x":')
    expect(events).toHaveLength(0) // incomplete — nothing emitted yet
    p.feed('1}\n')
    expect(events).toEqual([{ type: 'a', x: 1 }])
  })

  it('ignores blank lines', () => {
    const p = new StreamParser()
    const events: any[] = []
    p.on('event', (e) => events.push(e))
    p.feed('\n\n{"type":"a"}\n\n')
    expect(events).toEqual([{ type: 'a' }])
  })

  it('emits parse-error for non-JSON lines without crashing', () => {
    const p = new StreamParser()
    const events: any[] = []
    const errors: string[] = []
    p.on('event', (e) => events.push(e))
    p.on('parse-error', (line) => errors.push(line))
    p.feed('not json\n{"type":"ok"}\n')
    expect(errors).toEqual(['not json'])
    expect(events).toEqual([{ type: 'ok' }])
  })

  it('flush emits a trailing line with no newline', () => {
    const p = new StreamParser()
    const events: any[] = []
    p.on('event', (e) => events.push(e))
    p.feed('{"type":"a"}\n{"type":"b"}')
    expect(events).toEqual([{ type: 'a' }])
    p.flush()
    expect(events).toEqual([{ type: 'a' }, { type: 'b' }])
  })

  it('flush is a no-op on an empty buffer', () => {
    const p = new StreamParser()
    const fn = vi.fn()
    p.on('event', fn)
    p.on('parse-error', fn)
    p.feed('{"type":"a"}\n')
    p.flush()
    p.flush()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
