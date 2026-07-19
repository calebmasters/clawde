import { describe, it, expect } from 'vitest'
import { markedCommand, extractMarked, isPlausiblePath, CAPTURE_MARKER } from './shell-capture'

// Shape of the real failure: an rc file prints a fastfetch banner with ANSI
// escapes before the value, and cursor-restore escapes immediately precede it.
const BANNER = '[33C[0mOS[0m: macOS 26.3.1\n[?25h[?7h'

describe('markedCommand', () => {
  it('fences the expression in markers', () => {
    expect(markedCommand('$PATH')).toBe(`printf "${CAPTURE_MARKER}%s${CAPTURE_MARKER}" "$PATH"`)
  })

  it('uses no single quotes, so it is safe inside a single-quoted shell arg', () => {
    expect(markedCommand('$(whence -p claude)')).not.toContain("'")
  })
})

describe('extractMarked', () => {
  it('recovers the value when a banner precedes it', () => {
    const out = `${BANNER}${CAPTURE_MARKER}/Users/me/.local/bin/claude${CAPTURE_MARKER}`
    expect(extractMarked(out)).toBe('/Users/me/.local/bin/claude')
  })

  it('recovers the value when noise follows it', () => {
    const out = `${CAPTURE_MARKER}/usr/bin/claude${CAPTURE_MARKER}\nsome trailing motd\n`
    expect(extractMarked(out)).toBe('/usr/bin/claude')
  })

  it('recovers a PATH containing colons intact', () => {
    const path = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
    expect(extractMarked(`${BANNER}${CAPTURE_MARKER}${path}${CAPTURE_MARKER}`)).toBe(path)
  })

  it('returns null when markers are absent', () => {
    expect(extractMarked(BANNER)).toBeNull()
    expect(extractMarked('')).toBeNull()
  })

  it('returns null when the closing marker is missing', () => {
    expect(extractMarked(`${CAPTURE_MARKER}/usr/bin/claude`)).toBeNull()
  })
})

describe('isPlausiblePath', () => {
  it('rejects the 1823-char ANSI blob that caused ENAMETOOLONG', () => {
    const blob = `${BANNER}/Users/me/.local/bin/claude`.padEnd(1823, ' ')
    expect(isPlausiblePath(blob)).toBe(false)
  })

  it('rejects paths at or beyond the OS limit', () => {
    expect(isPlausiblePath('/' + 'a'.repeat(1024))).toBe(false)
  })

  it('rejects relative paths and embedded escapes', () => {
    expect(isPlausiblePath('claude')).toBe(false)
    expect(isPlausiblePath('/usr/bin/[0mclaude')).toBe(false)
  })

  it('accepts a normal absolute path', () => {
    expect(isPlausiblePath('/Users/me/.local/bin/claude')).toBe(true)
  })
})
