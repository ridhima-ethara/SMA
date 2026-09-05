// SVG neural graph of scrape → validate. Never owns state; SMIL pulses pause via svg.pauseAnimations().
import { useEffect, useRef } from 'react'

export type NodeState = 'idle' | 'working' | 'done'
export interface GraphSource { id: string; label: string; count: number; state: NodeState }
export interface GraphBuckets { validated: number; needs_review: number; duplicate: number; rejected: number }
export interface PipelineGraphProps { sources: GraphSource[]; scraping: { state: NodeState; count: number }; validation: { state: NodeState; count: number }; buckets: GraphBuckets; paused: boolean; filter: string | null; onFilter: (key: string | null) => void }

const W = 760, H = 420
const BUCKETS: Array<{ key: keyof GraphBuckets; label: string; color: string }> = [
  { key: 'validated', label: 'Validated', color: 'var(--color-good)' }, { key: 'needs_review', label: 'Needs review', color: 'var(--color-serious)' }, { key: 'duplicate', label: 'Duplicate', color: 'var(--color-warn)' }, { key: 'rejected', label: 'Rejected', color: 'var(--color-critical)' },
]
const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1} ${y1} C ${x1 + (x2 - x1) * 0.5} ${y1}, ${x1 + (x2 - x1) * 0.5} ${y2}, ${x2} ${y2}`

export function PipelineGraph({ sources, scraping, validation, buckets, paused, filter, onFilter }: PipelineGraphProps) {
  const ref = useRef<SVGSVGElement>(null)
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  useEffect(() => { const svg = ref.current; if (!svg) return; if (paused) svg.pauseAnimations(); else svg.unpauseAnimations() }, [paused])
  const srcX = 150, scrX = 350, valX = 530, bktX = 690
  const scrY = H / 2, valY = H / 2
  const srcYs = sources.map((_, i) => 30 + (i * (H - 60)) / Math.max(1, sources.length - 1))
  const bktYs = BUCKETS.map((_, i) => 70 + i * ((H - 140) / 3))
  const edgeClass = (state: NodeState) => (state === 'working' ? 'stroke-accent' : state === 'done' ? 'stroke-line-strong' : 'stroke-line')
  const Pulse = ({ d, active, color = 'var(--color-magenta)' }: { d: string; active: boolean; color?: string }) => (!active || reduce ? null : <circle r={3.5} fill={color}><animateMotion dur="1.4s" repeatCount="indefinite" path={d} /></circle>)
  const Node = ({ x, y, r, label, state, count, color, onClick, active, sub }: { x: number; y: number; r: number; label: string; state: NodeState; count: number; color?: string; onClick?: () => void; active?: boolean; sub?: string }) => (
    <g transform={`translate(${x} ${y})`} onClick={onClick} className={onClick ? 'cursor-pointer' : ''} opacity={filter && !active && onClick ? 0.55 : 1}>
      {state === 'working' && !reduce && <circle r={r} fill="none" stroke={color ?? 'var(--color-accent)'} strokeWidth={2} className="neural-halo" />}
      <circle r={r} fill="var(--color-surface-2)" stroke={state === 'working' ? (color ?? 'var(--color-accent)') : state === 'done' ? (color ?? 'var(--color-good)') : 'var(--color-line-strong)'} strokeWidth={active ? 3 : 1.5} />
      <text textAnchor="middle" y={4} fontSize={r > 28 ? 15 : 12} fontWeight={600} fill="var(--color-ink)" className="tabular">{count}</text>
      {r <= 18 ? <text textAnchor="end" x={-r - 6} y={4} fontSize={11} fill="var(--color-ink-2)">{label}</text> : <text textAnchor="middle" y={r + 14} fontSize={11} fill="var(--color-ink-2)">{label}</text>}
      {sub && <text textAnchor="middle" y={r + 26} fontSize={9} fill="var(--color-ink-3)">{sub}</text>}
    </g>
  )
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Pipeline graph">
      {sources.map((s, i) => { const d = curve(srcX + 22, srcYs[i], scrX - 34, scrY); return <g key={s.id}><path d={d} fill="none" strokeWidth={s.state === 'working' ? 2.5 : 1.5} className={edgeClass(s.state)} /><Pulse d={d} active={s.state === 'working'} /></g> })}
      {(() => { const d = curve(scrX + 34, scrY, valX - 34, valY); return <g><path d={d} fill="none" strokeWidth={validation.state === 'working' ? 2.5 : 1.5} className={edgeClass(validation.state === 'working' ? 'working' : scraping.state === 'done' ? 'done' : 'idle')} /><Pulse d={d} active={validation.state === 'working'} /></g> })()}
      {BUCKETS.map((b, i) => { const d = curve(valX + 34, valY, bktX - 26, bktYs[i]); const on = validation.state === 'working' && buckets[b.key] > 0; return <g key={b.key}><path d={d} fill="none" strokeWidth={on ? 2.5 : 1.5} className={on ? 'stroke-accent' : validation.state === 'done' ? 'stroke-line-strong' : 'stroke-line'} /><Pulse d={d} active={on} color={b.color} /></g> })}
      {sources.map((s, i) => <Node key={s.id} x={srcX} y={srcYs[i]} r={18} label={s.label} state={s.state} count={s.count} onClick={s.state !== 'idle' ? () => onFilter(filter === `src:${s.id}` ? null : `src:${s.id}`) : undefined} active={filter === `src:${s.id}`} />)}
      <Node x={scrX} y={scrY} r={34} label="Scraping Agent" state={scraping.state} count={scraping.count} sub="posts captured" />
      <Node x={valX} y={valY} r={34} label="Validation Agent" state={validation.state} count={validation.count} sub="verdicts issued" />
      {BUCKETS.map((b, i) => <Node key={b.key} x={bktX} y={bktYs[i]} r={22} label={b.label} state={buckets[b.key] > 0 ? (validation.state === 'done' ? 'done' : 'working') : 'idle'} count={buckets[b.key]} color={b.color} onClick={buckets[b.key] > 0 ? () => onFilter(filter === `bucket:${b.key}` ? null : `bucket:${b.key}`) : undefined} active={filter === `bucket:${b.key}`} />)}
    </svg>
  )
}
