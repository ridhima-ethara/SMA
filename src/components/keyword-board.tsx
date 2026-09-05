import { Pencil, Trash2 } from 'lucide-react'
import type { Keyword, KeywordSignal } from '../types'
import { Badge, ScoreRing, Switch, fmt } from './ui'

const scoreTone = (n: number) => (n >= 75 ? 'text-good-ink' : n >= 50 ? 'text-warn' : 'text-ink-3')

export function TrendingStrip({ signals }: { signals: KeywordSignal[] }) {
  const top = signals.filter((s) => s.isTrending).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 5)
  if (!top.length) return null
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5 stagger-fade">
      {top.map((s, i) => (
        <div key={s.id} className="card card-hover p-3" style={{ ['--i' as string]: i }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><div className="text-[10px] uppercase tracking-wide text-ink-3">Rank #{s.rank}</div><div className="mt-0.5 truncate text-sm font-semibold" title={s.term}>{s.term}</div></div>
            <ScoreRing value={s.trendScore} size={46} stroke={4} />
          </div>
          <div className="mt-2 space-y-1">
            {(['volume', 'engagement', 'velocity', 'growth'] as const).map((k) => (
              <div key={k} className="flex items-center gap-2 text-[10px]"><span className="w-16 capitalize text-ink-3">{k}</span><div className="h-1 flex-1 rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent" style={{ width: `${s.components[k] ?? 0}%` }} /></div><span className="tabular w-6 text-right text-ink-2">{s.components[k] ?? 0}</span></div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-ink-3 line-clamp-3" title={s.trendReason}>{s.trendReason}</p>
        </div>
      ))}
    </div>
  )
}

export function KeywordBoard({ keywords, signals, onWeight, onToggle, onEdit, onDelete }: { keywords: Keyword[]; signals: KeywordSignal[]; onWeight: (id: string, w: number) => void; onToggle: (id: string, active: boolean) => void; onEdit: (k: Keyword) => void; onDelete: (id: string) => void }) {
  const sig = new Map(signals.map((s) => [s.keywordId, s]))
  const rows = [...keywords].sort((a, b) => (sig.get(a.id)?.rank ?? 99) - (sig.get(b.id)?.rank ?? 99) || b.weight - a.weight)
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-ink-3"><tr className="border-b border-line">{['Keyword', 'Category', 'Weight', 'Posts', 'Engagement', 'Velocity', 'Growth', 'Trend', 'Rank', 'Active', ''].map((h) => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((k) => { const s = sig.get(k.id); return (
            <tr key={k.id} className={`border-b border-line/60 last:border-0 hover:bg-surface-2/60 ${k.active ? '' : 'opacity-50'}`}>
              <td className="px-3 py-2 font-medium">{k.term}{s?.isTrending && <Badge tone="magenta" className="ml-2">Trending</Badge>}</td>
              <td className="px-3 py-2"><Badge tone={k.category === 'Core' ? 'accent' : 'neutral'}>{k.category}</Badge></td>
              <td className="px-3 py-2"><div className="flex items-center gap-2"><input type="range" min={0} max={100} value={k.weight} onChange={(e) => onWeight(k.id, Number(e.target.value))} className="w-24" aria-label={`Weight for ${k.term}`} /><span className="tabular w-7 text-xs text-ink-2">{k.weight}</span></div></td>
              <td className="tabular px-3 py-2">{s?.postCount ?? '—'}</td>
              <td className="tabular px-3 py-2">{s ? fmt(s.totalEngagement) : '—'}</td>
              <td className="tabular px-3 py-2">{s ? `${s.velocity}/h` : '—'}</td>
              <td className={`tabular px-3 py-2 ${s ? (s.growthPct >= 0 ? 'text-good-ink' : 'text-critical-ink') : ''}`}>{s ? `${s.growthPct >= 0 ? '+' : ''}${Math.round(s.growthPct)}%` : '—'}</td>
              <td className={`tabular px-3 py-2 font-semibold ${s ? scoreTone(s.trendScore) : ''}`}>{s?.trendScore ?? '—'}</td>
              <td className="tabular px-3 py-2">{s?.rank ? `#${s.rank}` : '—'}</td>
              <td className="px-3 py-2"><Switch checked={k.active} onChange={(v) => onToggle(k.id, v)} label={`Active ${k.term}`} /></td>
              <td className="px-3 py-2"><div className="flex gap-1"><button type="button" onClick={() => onEdit(k)} className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Edit"><Pencil size={13} /></button><button type="button" onClick={() => onDelete(k.id)} className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-critical-ink" aria-label="Deactivate"><Trash2 size={13} /></button></div></td>
            </tr>
          ) })}
        </tbody>
      </table>
    </div>
  )
}
