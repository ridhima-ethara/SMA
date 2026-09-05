// Image model catalogue + the vector brand layer every creative is composited under.
import type { Platform } from './brand-voice'
import { BRAND } from './brand-voice'
import { LOGO_DOTS, LOGO_FILLED_PATHS, LOGO_PATHS, LOGO_RING, LOGO_STROKE } from './logo-mark'

export type ImageProvider = 'local' | 'gcp' | 'z-image'

export interface ImageModelSpec {
  id: string
  label: string
  provider: ImageProvider
  licence: string
  needsRuntime: boolean
  envVar?: string
  description: string
  paintsBackground: boolean
}

export const IMAGE_MODELS: ImageModelSpec[] = [
  { id: 'brand-svg', label: 'Ethara Brand Renderer', provider: 'local', licence: 'Proprietary · local', needsRuntime: false, description: 'Vector brand layer drawn locally: headline, kicker, accent bar, logomark, footer on a generated gradient field. Always available.', paintsBackground: false },
  { id: 'imagen-4', label: 'Imagen 4', provider: 'gcp', licence: 'Google Cloud · commercial', needsRuntime: true, envVar: 'GCP_API_KEY', description: 'Google Imagen paints an abstract background. The brand layer is still drawn locally on top.', paintsBackground: true },
  { id: 'gemini-flash-image', label: 'Gemini 2.5 Flash Image', provider: 'gcp', licence: 'Google Cloud · commercial', needsRuntime: true, envVar: 'GCP_API_KEY', description: 'Fast Gemini image generation for background textures. Never asked to draw text.', paintsBackground: true },
  { id: 'z-image-turbo', label: 'Z-Image Turbo', provider: 'z-image', licence: 'Apache-2.0', needsRuntime: true, envVar: 'Z_IMAGE_API_KEY', description: 'Open-weight turbo renderer for background fields via a self-hosted endpoint.', paintsBackground: true },
]

export const IMAGE_MODEL_BY_ID: Record<string, ImageModelSpec> = Object.fromEntries(IMAGE_MODELS.map((m) => [m.id, m]))

export interface Canvas {
  width: number
  height: number
  label: string
}

export const CANVASES: Record<Platform, Canvas> = {
  linkedin: { width: 1200, height: 627, label: '1200×627' },
  instagram: { width: 1080, height: 1350, label: '1080×1350' },
  x: { width: 1600, height: 900, label: '1600×900' },
}

export const IMAGE_CONCEPTS = ['Signal field', 'Reward landscape', 'Agent graph', 'Evaluation grid', 'Policy gradient', 'Environment lattice'] as const
export type ImageConcept = (typeof IMAGE_CONCEPTS)[number]

export interface BrandLayerInput {
  platform: Platform
  headline: string
  kicker: string
  footer?: string
  concept?: string
  seed?: number
  /** Optional model-painted background as a data URI. Drawn under the vector layer. */
  backgroundDataUri?: string
  variant?: number
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) {
      lines.push(cur)
      cur = w
    } else cur = (cur + ' ' + w).trim()
    if (lines.length === maxLines) break
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s?\S*$/, '…')
  }
  return lines
}

function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Composes the two-layer creative: generated/painted field beneath, vector brand layer on top. */
export function composeBrandSvg(input: BrandLayerInput): string {
  const { width: W, height: H } = CANVASES[input.platform]
  const rnd = prng((input.seed ?? 7) * 31 + (input.variant ?? 0) * 977)
  const fam = BRAND.visual.family
  const concept = input.concept ?? IMAGE_CONCEPTS[Math.floor(rnd() * IMAGE_CONCEPTS.length)]
  const portrait = H > W
  const pad = Math.round(W * 0.07)
  const headSize = portrait ? Math.round(W * 0.085) : Math.round(H * 0.11)
  const headLines = wrap(input.headline, portrait ? 20 : 26, 3)
  const kickSize = Math.round(headSize * 0.36)
  const footer = input.footer ?? `${BRAND.name} · ${BRAND.tagline}`
  const logo = Math.round(headSize * 1.1)

  let field = ''
  if (input.backgroundDataUri) {
    field = `<image href="${input.backgroundDataUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" opacity="0.9"/>`
  } else {
    const parts: string[] = []
    if (concept === 'Agent graph' || concept === 'Environment lattice') {
      const n = 14
      const pts = Array.from({ length: n }, () => ({ x: W * (0.45 + rnd() * 0.55), y: H * rnd() }))
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rnd() < 0.22) parts.push(`<line x1="${pts[i].x}" y1="${pts[i].y}" x2="${pts[j].x}" y2="${pts[j].y}" stroke="${fam[2]}" stroke-opacity="0.25" stroke-width="2"/>`)
      for (const p of pts) parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${6 + rnd() * 10}" fill="${fam[Math.floor(rnd() * 3)]}" fill-opacity="0.8"/>`)
    } else if (concept === 'Evaluation grid') {
      const cols = 9, rows = 6
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const v = rnd()
        parts.push(`<rect x="${W * 0.42 + c * (W * 0.06)}" y="${H * 0.12 + r * (H * 0.12)}" width="${W * 0.05}" height="${H * 0.1}" rx="8" fill="${fam[v > 0.7 ? 0 : v > 0.4 ? 1 : 2]}" fill-opacity="${0.15 + v * 0.7}"/>`)
      }
    } else if (concept === 'Reward landscape' || concept === 'Policy gradient') {
      for (let k = 0; k < 7; k++) {
        const y0 = H * (0.25 + k * 0.1)
        let d = `M0 ${y0}`
        for (let x = 0; x <= W; x += W / 12) d += ` Q ${x + W / 24} ${y0 - 40 - rnd() * 120} ${x + W / 12} ${y0 + rnd() * 20}`
        parts.push(`<path d="${d}" fill="none" stroke="${fam[k % 4]}" stroke-opacity="${0.18 + k * 0.06}" stroke-width="${2 + k * 0.6}"/>`)
      }
    } else {
      for (let k = 0; k < 40; k++) parts.push(`<circle cx="${W * (0.4 + rnd() * 0.6)}" cy="${H * rnd()}" r="${2 + rnd() * 14}" fill="${fam[Math.floor(rnd() * 4)]}" fill-opacity="${0.15 + rnd() * 0.6}"/>`)
      for (let k = 0; k < 5; k++) parts.push(`<circle cx="${W * (0.6 + rnd() * 0.4)}" cy="${H * rnd()}" r="${H * (0.2 + rnd() * 0.3)}" fill="url(#halo)"/>`)
    }
    field = parts.join('')
  }

  const headY = portrait ? H * 0.5 : H * 0.42
  const headSvg = headLines.map((l, i) => `<text x="${pad}" y="${headY + i * headSize * 1.12}" font-family="${BRAND.visual.displayFont}, Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="${headSize}" fill="#ffffff">${esc(l)}</text>`).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(input.headline)}">` +
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0e14"/><stop offset="1" stop-color="#1a1130"/></linearGradient>` +
    `<radialGradient id="halo"><stop offset="0" stop-color="${fam[0]}" stop-opacity="0.35"/><stop offset="1" stop-color="${fam[0]}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="veil" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0b0e14" stop-opacity="0.92"/><stop offset="0.55" stop-color="#0b0e14" stop-opacity="0.55"/><stop offset="1" stop-color="#0b0e14" stop-opacity="0.1"/></linearGradient>` +
    `</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
    field +
    `<rect width="${W}" height="${H}" fill="url(#veil)"/>` +
    // Brand layer — always local, never model-drawn.
    `<rect x="${pad}" y="${headY - headSize * 1.9}" width="${Math.round(W * 0.06)}" height="8" rx="4" fill="${fam[0]}"/>` +
    `<text x="${pad}" y="${headY - headSize * 1.15}" font-family="${BRAND.visual.bodyFont}, Inter, Helvetica, Arial, sans-serif" font-weight="600" font-size="${kickSize}" letter-spacing="${kickSize * 0.12}" fill="${fam[2]}">${esc(input.kicker.toUpperCase())}</text>` +
    headSvg +
    `<g transform="translate(${W - pad - logo} ${pad}) scale(${logo / 100})" fill="none" stroke="#ffffff" stroke-width="${LOGO_STROKE}" stroke-linecap="round" stroke-linejoin="round"><circle cx="${LOGO_RING.cx}" cy="${LOGO_RING.cy}" r="${LOGO_RING.r}" stroke-width="${LOGO_RING.stroke}"/>${LOGO_PATHS.map((d) => `<path d="${d}"/>`).join('')}${LOGO_FILLED_PATHS.map((d) => `<path d="${d}" fill="#ffffff" stroke="none"/>`).join('')}${LOGO_DOTS.map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="#ffffff" stroke="none"/>`).join('')}</g>` +
    `<text x="${pad}" y="${H - pad * 0.8}" font-family="${BRAND.visual.bodyFont}, Inter, Helvetica, Arial, sans-serif" font-weight="500" font-size="${Math.round(kickSize * 0.95)}" fill="#c5cbe9">${esc(footer)}</text>` +
    `<text x="${W - pad}" y="${H - pad * 0.8}" text-anchor="end" font-family="${BRAND.visual.bodyFont}, Inter, Helvetica, Arial, sans-serif" font-size="${Math.round(kickSize * 0.8)}" fill="#8a8fa5">${esc(concept)}</text>` +
    `</svg>`
}

export function svgToDataUri(svg: string): string {
  const encoded = typeof btoa === 'function'
    ? btoa(unescape(encodeURIComponent(svg)))
    : Buffer.from(svg, 'utf8').toString('base64')
  return `data:image/svg+xml;base64,${encoded}`
}

export function buildAltText(headline: string, concept: string, platform: Platform): string {
  return `${BRAND.name} creative for ${platform}: "${headline}" on a ${concept.toLowerCase()} background in the brand accent family, with the Ethara logomark.`
}

