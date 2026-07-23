/** Build an Electron accelerator string from a keydown event, or null if it's
 *  just a modifier / has no modifier (globals need at least one modifier). */
export function toAccelerator(e: KeyboardEvent): string | null {
  const key = e.key
  if (key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') return null
  const mods: string[] = []
  if (e.metaKey) mods.push('Command')
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (mods.length === 0) return null
  const arrows: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }
  let name: string
  if (key === ' ') name = 'Space'
  else if (arrows[key]) name = arrows[key]
  else if (key.length === 1) name = key.toUpperCase()
  else name = key // Enter, Tab, F1…F24, etc.
  return [...mods, name].join('+')
}
