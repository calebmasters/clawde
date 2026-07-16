import { describe, it, expect } from 'vitest'
import {
  buildUserContent,
  approxDecodedBytes,
  canInline,
  MAX_INLINE_IMAGE_BYTES,
} from './message-content'
import type { InlineImage } from '../../shared/types'

// A valid 1x1 transparent PNG (tiny, well under the size cap).
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// Base64 string whose decoded length exceeds the inline cap.
const OVERSIZED = 'A'.repeat(Math.ceil((MAX_INLINE_IMAGE_BYTES * 4) / 3) + 8)

describe('approxDecodedBytes', () => {
  it('returns 0 for empty input', () => {
    expect(approxDecodedBytes('')).toBe(0)
  })

  it('accounts for base64 padding', () => {
    expect(approxDecodedBytes('AAAA')).toBe(3) // no padding
    expect(approxDecodedBytes('AAA=')).toBe(2) // one pad char
    expect(approxDecodedBytes('AA==')).toBe(1) // two pad chars
  })
})

describe('canInline', () => {
  it('accepts a small supported image', () => {
    expect(canInline({ mediaType: 'image/png', data: PNG_1x1 })).toBe(true)
    expect(canInline({ mediaType: 'image/jpeg', data: PNG_1x1 })).toBe(true)
  })

  it('rejects empty data', () => {
    expect(canInline({ mediaType: 'image/png', data: '' })).toBe(false)
  })

  it('rejects unsupported types (svg)', () => {
    expect(canInline({ mediaType: 'image/svg+xml', data: PNG_1x1 })).toBe(false)
  })

  it('rejects oversized data', () => {
    expect(canInline({ mediaType: 'image/png', data: OVERSIZED })).toBe(false)
  })
})

describe('buildUserContent', () => {
  it('returns a single text block when there are no images', () => {
    expect(buildUserContent('hello')).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('always returns at least one block, even for an empty prompt', () => {
    expect(buildUserContent('')).toEqual([{ type: 'text', text: '' }])
  })

  it('places the image block before the text block', () => {
    const imgs: InlineImage[] = [{ mediaType: 'image/png', data: PNG_1x1, path: '/tmp/a.png' }]
    expect(buildUserContent('what is this?', imgs)).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1x1 } },
      { type: 'text', text: 'what is this?' },
    ])
  })

  it('omits the empty text block when an image is present and prompt is empty', () => {
    const imgs: InlineImage[] = [{ mediaType: 'image/png', data: PNG_1x1, path: '/tmp/a.png' }]
    expect(buildUserContent('', imgs)).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1x1 } },
    ])
  })

  it('falls back to a path note for unsupported image types', () => {
    const imgs: InlineImage[] = [{ mediaType: 'image/svg+xml', data: PNG_1x1, path: '/tmp/logo.svg' }]
    expect(buildUserContent('render this', imgs)).toEqual([
      { type: 'text', text: '[Attached image: /tmp/logo.svg]\n\nrender this' },
    ])
  })

  it('falls back to a path note for oversized images', () => {
    const imgs: InlineImage[] = [{ mediaType: 'image/png', data: OVERSIZED, path: '/tmp/huge.png' }]
    expect(buildUserContent('look', imgs)).toEqual([
      { type: 'text', text: '[Attached image: /tmp/huge.png]\n\nlook' },
    ])
  })

  it('mixes inline images with path fallbacks', () => {
    const imgs: InlineImage[] = [
      { mediaType: 'image/png', data: PNG_1x1, path: '/tmp/ok.png' },
      { mediaType: 'image/png', data: OVERSIZED, path: '/tmp/huge.png' },
    ]
    expect(buildUserContent('compare', imgs)).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1x1 } },
      { type: 'text', text: '[Attached image: /tmp/huge.png]\n\ncompare' },
    ])
  })

  it('silently drops an uninlineable image that has no path', () => {
    const imgs: InlineImage[] = [{ mediaType: 'image/svg+xml', data: PNG_1x1 }]
    expect(buildUserContent('hi', imgs)).toEqual([{ type: 'text', text: 'hi' }])
  })
})
