import { Play } from 'lucide-react'

/** No ping rings: a breathing glow, a light sweep every ~5 s, an arrow nudge on hover, a progress ring while running. */
export function PlayButton({ label, hint, onClick, running = false, progress = 0, size = 'md', disabled = false }: { label: string; hint?: string; onClick: () => void; running?: boolean; progress?: number; size?: 'md' | 'lg'; disabled?: boolean }) {
  const d = size === 'lg' ? 72 : 40
  const r = d / 2 - 3
  const c = 2 * Math.PI * r
  return (
    <button type="button" onClick={onClick} disabled={disabled || running} className={`group play-enter inline-flex items-center gap-3 rounded-full text-left disabled:cursor-default ${size === 'lg' ? 'p-1.5 pr-6' : 'p-1 pr-4'} bg-surface-2 border border-line hover:border-line-strong transition-colors`}>
      <span className={`relative grid place-items-center overflow-hidden rounded-full bg-gradient-to-br from-accent to-magenta text-white ${running ? '' : 'play-breathe'}`} style={{ width: d, height: d }}>
        {!running && <span className="play-sheen" />}
        <Play size={size === 'lg' ? 28 : 16} fill="currentColor" className="translate-x-px transition-transform duration-200 group-hover:translate-x-1" />
        {running && <svg className="absolute inset-0 -rotate-90" width={d} height={d}><circle cx={d / 2} cy={d / 2} r={r} stroke="rgba(255,255,255,0.25)" strokeWidth={3} fill="none" /><circle cx={d / 2} cy={d / 2} r={r} stroke="#fff" strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - progress / 100)} style={{ transition: 'stroke-dashoffset 300ms' }} /></svg>}
      </span>
      <span>
        <span className={`block font-semibold ${size === 'lg' ? 'text-base' : 'text-sm'}`}>{running ? `Running · ${Math.round(progress)}%` : label}</span>
        {hint && <span className="block text-[11px] text-ink-3">{running ? 'Agents are working — watch it live' : hint}</span>}
      </span>
    </button>
  )
}
