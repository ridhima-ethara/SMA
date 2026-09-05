// Traced brand logomark: a ring enclosing a five-petal lotus — one upright petal, two diagonal,
// two horizontal — with crossed stems, a seed pod and two dots. Drawn as outlined line art so it
// renders in any ink colour at any size; the brand layer and the sign-in animation use these paths.
export const LOGO_VIEWBOX = '0 0 100 100'
export const LOGO_STROKE = 3.2
export const LOGO_RING = { cx: 50, cy: 50, r: 44, stroke: 5.5 }
export const LOGO_DISC = '#0b1a10'

/**
 * Outlined shapes, outside-in: ring first, then the petals, the crossed stems and the seed pod.
 * The sign-in animation draws them in this order.
 */
export const LOGO_PATHS: string[] = [
  // Upright petal
  'M50 11 Q65 26 50 41 Q35 26 50 11 Z',
  // Diagonal petals, upper-left and upper-right
  'M22 26 Q23.8 46.1 44 45 Q42.2 24.9 22 26 Z',
  'M78 26 Q76.2 46.1 56 45 Q57.8 24.9 78 26 Z',
  // Horizontal petals, left and right
  'M10 50 Q27.3 62.4 42 47 Q24.7 34.6 10 50 Z',
  'M90 50 Q72.7 62.4 58 47 Q75.3 34.6 90 50 Z',
  // Crossed stems
  'M39.5 40 L60.5 65',
  'M60.5 40 L39.5 65',
  // Seed pod
  'M50 68 Q61 79 50 90 Q39 79 50 68 Z',
]

/** Solid shapes: the seed inside the pod. */
export const LOGO_FILLED_PATHS: string[] = ['M50 74 Q54.4 79.5 50 85 Q45.6 79.5 50 74 Z']

export const LOGO_DOTS = [
  { cx: 38.5, cy: 70, r: 2.2 },
  { cx: 61.5, cy: 70, r: 2.2 },
]

/** Standalone SVG string: white line art on a dark disc, as on the source emblem. */
export function logoMarkSvg(size = 100, ink = '#ffffff', disc: string | null = LOGO_DISC): string {
  const stroked = LOGO_PATHS.map((d) => `<path d="${d}"/>`).join('')
  const filled = LOGO_FILLED_PATHS.map((d) => `<path d="${d}" fill="${ink}" stroke="none"/>`).join('')
  const dots = LOGO_DOTS.map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="${ink}" stroke="none"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${LOGO_VIEWBOX}">` +
    (disc ? `<circle cx="50" cy="50" r="50" fill="${disc}"/>` : '') +
    `<g fill="none" stroke="${ink}" stroke-width="${LOGO_STROKE}" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="${LOGO_RING.cx}" cy="${LOGO_RING.cy}" r="${LOGO_RING.r}" stroke-width="${LOGO_RING.stroke}"/>` +
    stroked + filled + dots + `</g></svg>`
}
