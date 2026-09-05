import { LOGO_DISC, LOGO_SHAPES, LOGO_SIZE, LOGO_VIEWBOX } from './logo-paths'

/**
 * Brand logomark — the traced source emblem. Renders in the current text colour; `disc` adds the dark ground
 * from the artwork. `animated` settles it in on sign-in (a traced fill cannot be stroke-drawn).
 */
export function Logo({ size = 28, animated = false, className = '', disc = false }: { size?: number; animated?: boolean; className?: string; disc?: boolean }) {
  const half = LOGO_SIZE / 2
  return (
    <svg width={size} height={size} viewBox={LOGO_VIEWBOX} className={`${animated ? 'auth-settle' : ''} ${className}`} style={animated ? { animationDuration: '1.4s', animationDelay: '0.2s', animationFillMode: 'both' } : undefined} aria-hidden>
      {disc && <circle cx={half} cy={half} r={half} fill={LOGO_DISC} />}
      {LOGO_SHAPES.map((s, i) => <path key={i} d={s.d} fill={s.fill === 'ink' ? 'currentColor' : disc ? LOGO_DISC : 'none'} fillRule={s.rule} />)}
    </svg>
  )
}

/** The emblem exactly as on the source artwork: white on the dark disc. */
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
