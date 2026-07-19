/**
 * Capturing a value from a login/interactive shell is unreliable: rc files
 * routinely print banners (fastfetch, motd, version-manager notices) and those
 * land on stdout alongside the value we asked for. Treating all of stdout as the
 * value yields absurd results — e.g. a 1.8KB "binary path" of ANSI art, which
 * fails spawn with ENAMETOOLONG.
 *
 * Fencing the value in sentinels lets us recover it regardless of surrounding
 * noise, whether the banner prints before or after our command.
 */

export const CAPTURE_MARKER = '__CLOD_CAPTURE__'

/**
 * Build a shell snippet printing `expr`'s value fenced by markers.
 * Uses only double quotes so callers can safely wrap it in single quotes.
 *
 * `expr` is interpolated into a shell command — pass only trusted literals
 * (`$PATH`, `$(whence -p claude)`), never user input.
 */
export function markedCommand(expr: string): string {
  return `printf "${CAPTURE_MARKER}%s${CAPTURE_MARKER}" "${expr}"`
}

/** Recover the fenced value from noisy shell output, or null if not present. */
export function extractMarked(output: string): string | null {
  const start = output.indexOf(CAPTURE_MARKER)
  if (start === -1) return null

  const valueStart = start + CAPTURE_MARKER.length
  const end = output.indexOf(CAPTURE_MARKER, valueStart)
  if (end === -1) return null

  return output.slice(valueStart, end).trim()
}

/** Longest path macOS will accept in an exec call. */
export const MAX_PATH_LENGTH = 1024

/**
 * Whether a string is plausibly a usable absolute path — absolute, no control
 * characters (ANSI escapes), and short enough for the OS to exec.
 * A second line of defence if shell output is contaminated some other way.
 */
export function isPlausiblePath(value: string): boolean {
  if (!value.startsWith('/')) return false
  if (value.length >= MAX_PATH_LENGTH) return false
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x1f\x7f]/.test(value)
}
