import React from 'react'

/**
 * Claude-orange border for the input pill.
 *
 * Implemented as pure-CSS gradient rings (the "mask-composite" border trick) that
 * inherit the pill's border-radius and fill it via `inset: 0` — so they always hug
 * the pill exactly, at any height (attachments, multi-line), with no measurement.
 *
 * A solid orange line is always drawn. On top, a slowly drifting gradient "glow"
 * fades in while the input is focused and fades out when focus leaves. The glow is
 * gated by `enabled` (the Input glow setting).
 */

const BORDER_WIDTH = 2

// Ring mask: paint everything, then punch out the inner content-box so only the
// padding (= the border) remains.
const ringBase: React.CSSProperties = {
  position: 'absolute',
  // -1 expands the ring over the pill's 1px glass-surface border so the orange
  // sits exactly on the visible outer edge (an inset:0 child only fills the
  // padding box, i.e. 1px inside the border — which showed as a faint offset).
  inset: -1,
  borderRadius: 'inherit',
  padding: BORDER_WIDTH,
  pointerEvents: 'none',
  WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
  WebkitMaskComposite: 'xor',
  maskComposite: 'exclude',
}

export function AnimatedInputBorder({
  enabled,
  focused,
}: {
  enabled: boolean
  focused: boolean
}) {
  return (
    <>
      {/* Base line — always present, constant thickness. */}
      <div aria-hidden style={{ ...ringBase, background: '#C15F3C' }} />

      {/* Glow — drifting gradient, fades in only while focused. */}
      {enabled && (
        <div
          aria-hidden
          style={{
            ...ringBase,
            // Periodic gradient (base→bright→base→bright→base) sized so the pill
            // always shows exactly one full period. Scrolling by one period keeps
            // the *spatial average* colour constant over time — only the highlight
            // travels — while the colour still varies locally along the border.
            background: 'linear-gradient(100deg, #C15F3C 0%, #FFCFA8 25%, #C15F3C 50%, #FFCFA8 75%, #C15F3C 100%)',
            backgroundSize: '200% 100%',
            animation: 'clod-border-drift 10s linear infinite',
            opacity: focused ? 1 : 0,
            transition: 'opacity 0.9s ease',
          }}
        />
      )}
    </>
  )
}
