import type { InlineImage } from '../../shared/types'

/**
 * Content blocks for a stream-json `user` message written to the `claude` CLI
 * stdin. Mirrors the Anthropic Messages API content shape.
 */
export type OutboundContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/** Raster formats the vision model accepts. SVG is intentionally excluded. */
export const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

/**
 * Per-image cap on decoded size. The API rejects images larger than ~5 MB
 * (base64-encoded); we cap the decoded byte count a little under that so an
 * oversized screenshot degrades to a path reference instead of erroring the run.
 */
export const MAX_INLINE_IMAGE_BYTES = 4.5 * 1024 * 1024

/** Approximate decoded byte length of a base64 string (no data: prefix). */
export function approxDecodedBytes(base64: string): number {
  if (!base64) return 0
  const len = base64.length
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((len * 3) / 4) - padding
}

/** True if an image can be embedded inline (supported type, non-empty, within cap). */
export function canInline(img: InlineImage): boolean {
  return (
    !!img.data &&
    SUPPORTED_IMAGE_TYPES.has(img.mediaType) &&
    approxDecodedBytes(img.data) <= MAX_INLINE_IMAGE_BYTES
  )
}

/**
 * Build the `content` array for a stream-json user message.
 *
 * Inlineable images become base64 image blocks (placed before the text so the
 * model reads image-then-question). Images that can't be inlined (too large,
 * unsupported type) fall back to a `[Attached image: <path>]` line prepended to
 * the prompt text, so the agent can still Read them from disk.
 *
 * Always returns at least one block.
 */
export function buildUserContent(
  prompt: string,
  images?: InlineImage[],
): OutboundContentBlock[] {
  const content: OutboundContentBlock[] = []
  const fallbackNotes: string[] = []

  for (const img of images ?? []) {
    if (canInline(img)) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.data },
      })
    } else if (img.path) {
      fallbackNotes.push(`[Attached image: ${img.path}]`)
    }
  }

  const text =
    fallbackNotes.length > 0 ? `${fallbackNotes.join('\n')}\n\n${prompt}` : prompt

  // Include the text block unless it's empty AND we already have image blocks
  // (a message that is just an image is valid; an empty content array is not).
  if (text.length > 0 || content.length === 0) {
    content.push({ type: 'text', text })
  }

  return content
}
