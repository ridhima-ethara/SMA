import { LOGO_DISC, LOGO_DOTS, LOGO_FILLED_PATHS, LOGO_PATHS, LOGO_RING, LOGO_STROKE, LOGO_VIEWBOX } from './logo-paths'

/** Brand logomark as line art in the current text colour. `animated` draws it outside-in (sign-in). */
export function Logo({ size = 28, animated = false, className = '', disc = false }: { size?: number; animated?: boolean; className?: string; disc?: boolean }) {
  const step = 0.16
  const solidsAt = 0.15 + (LOGO_PATHS.length + 1) * step
  return (
    <svg width={size} height={size} viewBox={LOGO_VIEWBOX} className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth={LOGO_STROKE} strokeLinecap="round" strokeLinejoin="round">
      {disc && <circle cx={50} cy={50} r={50} fill={LOGO_DISC} stroke="none" />}
      <circle cx={LOGO_RING.cx} cy={LOGO_RING.cy} r={LOGO_RING.r} strokeWidth={LOGO_RING.stroke} pathLength={200} className={animated ? 'mark-path' : ''} style={animated ? { animationDelay: '0.15s' } : undefined} />
      {LOGO_PATHS.map((d, i) => <path key={i} d={d} pathLength={200} className={animated ? 'mark-path' : ''} style={animated ? { animationDelay: `${0.15 + (i + 1) * step}s` } : undefined} />)}
      {LOGO_FILLED_PATHS.map((d, i) => <path key={`f${i}`} d={d} fill="currentColor" stroke="none" className={animated ? 'mark-fill' : ''} style={animated ? { animationDelay: `${solidsAt}s` } : undefined} />)}
      {LOGO_DOTS.map((c, i) => <circle key={`d${i}`} cx={c.cx} cy={c.cy} r={c.r} fill="currentColor" stroke="none" className={animated ? 'mark-fill' : ''} style={animated ? { animationDelay: `${solidsAt + 0.1 + i * 0.08}s` } : undefined} />)}
    </svg>
  )
}

/** The emblem as it appears on the source artwork: white line art on a dark disc. */
export function Roundel({ size = 28, animated = false }: { size?: number; animated?: boolean }) {
  return <div className="grid shrink-0 place-items-center rounded-full text-white" style={{ width: size, height: size }}><Logo size={size} animated={animated} disc /></div>
}

/** The wordmark is always "Ethara.AI" — the ".AI" in magenta, never "Ethara AI". */
export function Wordmark({ className = '', animated = false }: { className?: string; animated?: boolean }) {
  if (!animated) return <span className={`display ${className}`}>Ethara<span className="text-magenta-ink">.AI</span></span>
  return (
    <span className={`display ${className}`} aria-label="Ethara.AI">
      {'Ethara'.split('').map((ch, i) => <span key={i} className="auth-letter" style={{ animationDelay: `${0.9 + i * 0.08}s` }}>{ch}</span>)}
      <span className="auth-letter-ai text-magenta-ink" style={{ animationDelay: '1.5s' }}>.AI</span>
    </span>
  )
}
