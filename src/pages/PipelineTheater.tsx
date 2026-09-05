import { Check, Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Roundel } from '../components/logo'
import { PipelineGraph, type GraphSource } from '../components/pipeline-graph'
import { Badge, Btn, PLATFORM_LABEL, PlatformIcon, Progress, VALIDATION_META } from '../components/ui'
import { AGENT_STATUS_META, useStore } from '../store'
import type { PipelineResult, TheaterVerdict, Validation } from '../types'

type Step = { at: number; run: () => void }
type FeedItem = { id: string; kind: 'note' | 'capture' | 'hashtags' | 'verdict'; keyword?: string; text?: string; item?: { id: string; title: string; engagement: number; sourceName: string; sourceType: string; relevance: number }; tags?: string[]; verdict?: TheaterVerdict }
const TICK = 50

export function PipelineTheater() {
  const s = useStore(useShallow((st) => ({ close: st.closeTheater, runScraping: st.runScraping, setPage: st.setPage, agents: st.agents, keywords: st.keywords, resolveReview: st.resolveReview, reviewQueue: st.reviewQueue, top: st.settings.topPerPlatform })))
  const [clock, setClock] = useState(0); const [paused, setPaused] = useState(false); const [result, setResult] = useState<PipelineResult | null>(null)
  const [stage, setStage] = useState<'scrape' | 'validate' | 'plan' | 'done'>('scrape'); const [feed, setFeed] = useState<FeedItem[]>([]); const [sources, setSources] = useState<GraphSource[]>([]); const [captured, setCaptured] = useState(0)
  const [buckets, setBuckets] = useState({ validated: 0, needs_review: 0, duplicate: 0, rejected: 0 }); const [scoring, setScoring] = useState<TheaterVerdict | null>(null); const [verdictsDone, setVerdictsDone] = useState(0); const [filter, setFilter] = useState<string | null>(null); const [decided, setDecided] = useState<Record<string, string>>({})
  const steps = useRef<Step[]>([]); const nextStep = useRef(0); const feedEnd = useRef<HTMLDivElement>(null)
  const kwCount = Math.min(12, s.keywords.filter((k) => k.active && k.weight >= 40).length)
  useEffect(() => { void s.runScraping().then((r) => setResult(r)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const h = (e: KeyboardEvent) => { const tag = (e.target as HTMLElement)?.tagName; if (e.key === ' ' && tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); setPaused((p) => !p) } if (e.key === 'Escape') s.close() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [s.close]) // eslint-disable-line react-hooks/exhaustive-deps
  // Virtual clock: accumulates real elapsed time only while not paused, so Pause freezes every pending step exactly.
  useEffect(() => { if (paused) return; let last = performance.now(); const t = setInterval(() => { const now = performance.now(); const dt = Math.min(1000, now - last); last = now; setClock((c) => c + dt) }, TICK); return () => clearInterval(t) }, [paused])
  // Build the timeline once the result arrives, starting from the current virtual clock.
  useEffect(() => {
    if (!result) return
    const list: Step[] = []; let t = clock + 200
    const push = (fn: () => void, dt: number) => { list.push({ at: t, run: fn }); t += dt }
    setSources(result.theater.keywords.map((k) => ({ id: k.id, label: k.term.length > 14 ? `${k.term.slice(0, 13)}…` : k.term, count: 0, state: 'idle' })))
    push(() => setFeed((f) => [...f, { id: 'n0', kind: 'note', text: `Scraping Agent · ${result.summary.source === 'fixture' ? 'fixture corpus' : 'Apify live'} · ${result.theater.keywords.length} keywords` }]), 400)
    result.theater.keywords.forEach((k) => {
      push(() => setSources((src) => src.map((x) => (x.id === k.id ? { ...x, state: 'working' } : x))), 250)
      k.items.forEach((it) => push(() => { setCaptured((c) => c + 1); setSources((src) => src.map((x) => (x.id === k.id ? { ...x, count: x.count + 1 } : x))); setFeed((f) => [...f, { id: `c-${it.id}`, kind: 'capture', keyword: k.term, item: it }]) }, 140))
      const tags = Array.from(new Set(k.items.flatMap((i) => i.hashtags))).slice(0, 8)
      push(() => { setSources((src) => src.map((x) => (x.id === k.id ? { ...x, state: 'done' } : x))); if (tags.length) setFeed((f) => [...f, { id: `h-${k.id}`, kind: 'hashtags', keyword: k.term, tags }]) }, 220)
    })
    push(() => { setStage('validate'); setFeed((f) => [...f, { id: 'n1', kind: 'note', text: `Validation Agent · ranking ${result.trendingKeywords.length} trending keywords and ${result.theater.verdicts.length} candidates` }]) }, 600)
    result.theater.verdicts.forEach((v) => { push(() => setScoring(v), 180); push(() => { setScoring(null); setVerdictsDone((n) => n + 1); setBuckets((b) => ({ ...b, [v.verdict]: b[v.verdict as keyof typeof b] + 1 })); setFeed((f) => [...f, { id: `v-${v.id}`, kind: 'verdict', keyword: v.keyword, verdict: v }]) }, 90) })
    push(() => { setStage('plan'); setFeed((f) => [...f, { id: 'n2', kind: 'note', text: `Calendar Agent · placing ${result.summary.ideas} ideas (top ${s.top} per platform)` }]) }, 900)
    push(() => setStage('done'), 0)
    steps.current = list; nextStep.current = 0
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { while (nextStep.current < steps.current.length && steps.current[nextStep.current].at <= clock) { steps.current[nextStep.current].run(); nextStep.current++ } }, [clock])
  useEffect(() => { feedEnd.current?.scrollIntoView({ block: 'end' }) }, [feed.length])
  const totalItems = result?.theater.verdicts.length ?? 0; const totalCaptures = result?.theater.keywords.reduce((n, k) => n + k.items.length, 0) ?? 1
  const progress = stage === 'scrape' ? Math.min(45, (captured / Math.max(1, totalCaptures)) * 45) : stage === 'validate' ? 45 + (verdictsDone / Math.max(1, totalItems)) * 55 : 100
  const shown = useMemo(() => feed.filter((f) => !filter || (filter.startsWith('src:') ? f.keyword === result?.theater.keywords.find((k) => k.id === filter.slice(4))?.term : f.kind === 'verdict' && f.verdict?.verdict === filter.slice(7))), [feed, filter, result])
  const failed = result?.status === 'failed'
  const title = failed ? 'Pipeline stopped' : stage === 'scrape' ? `Scraping LinkedIn for ${kwCount} keywords` : stage === 'validate' ? 'Validation Agent at work' : stage === 'plan' ? 'Calendar Agent placing ideas' : 'Pipeline run complete'
  const subtitle = failed ? (result?.error ?? 'The run failed') : stage === 'scrape' ? `${captured} posts captured so far` : stage === 'validate' ? `${verdictsDone} of ${totalItems} verdicts issued` : stage === 'done' ? 'The Calendar Agent placed the strongest trends into the week.' : 'Ranking and spreading ideas across the horizon'
  const decide = (v: TheaterVerdict, outcome: 'Approve' | 'Reject') => { const r = s.reviewQueue.find((x) => x.entityId === v.id) ?? result?.theater.reviewQueue.find((x) => x.entityId === v.id); setDecided((d) => ({ ...d, [v.id]: outcome })); if (r) void s.resolveReview(r.id, outcome) }
  const pending = (result?.theater.verdicts ?? []).filter((v) => v.verdict === 'needs_review' && !decided[v.id])
  return (
    <div className="fixed inset-0 z-[86] flex flex-col bg-page/97 backdrop-blur-xl anim-fade-in">
      <header className="flex items-center gap-4 border-b border-line px-5 py-3"><Roundel size={28} /><div className="min-w-0"><div className="display text-base">{title}</div><div className="text-xs text-ink-3">{subtitle}</div></div>
        <div className="ml-4 hidden gap-1.5 md:flex">{(['scraping', 'validation', 'analysis', 'calendar'] as const).map((id) => { const a = s.agents.find((x) => x.id === id); const m = AGENT_STATUS_META[a?.status ?? 'idle']; return <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2"><span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />{id}</span> })}</div>
        <div className="ml-auto hidden items-center gap-2 text-[11px] text-ink-3 lg:flex">{[['1 · Scrape', 'scrape'], ['2 · Validate', 'validate'], ['3 · Plan', 'plan']].map(([l, k], i) => <span key={k} className="flex items-center gap-2"><span className={stage === k || (stage === 'done' && k === 'plan') ? 'font-semibold text-accent' : ['scrape', 'validate', 'plan', 'done'].indexOf(stage) > i ? 'text-good-ink' : ''}>{l}</span>{i < 2 && <span>→</span>}</span>)}</div>
        <Btn variant="ghost" size="sm" icon={paused ? <Play size={13} /> : <Pause size={13} />} onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'}</Btn><button type="button" onClick={s.close} className="rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close"><X size={18} /></button></header>
      {paused && <div className="border-b border-warn/40 bg-warn/10 px-5 py-1.5 text-center text-xs text-warn">Paused — every pending step is held exactly where it is. Press Space or Resume to continue.</div>}
      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="card flex min-h-0 flex-col p-3"><PipelineGraph sources={sources} scraping={{ state: stage === 'scrape' ? 'working' : 'done', count: captured }} validation={{ state: stage === 'validate' ? 'working' : stage === 'scrape' ? 'idle' : 'done', count: verdictsDone }} buckets={buckets} paused={paused} filter={filter} onFilter={setFilter} /><div className="mt-auto flex flex-wrap gap-4 px-2 text-[11px] text-ink-3"><span><span className="mr-1 inline-block h-2 w-4 bg-accent align-middle" />working</span><span><span className="mr-1 inline-block h-2 w-4 bg-line-strong align-middle" />done</span><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-magenta align-middle" />signal pulse</span><span>Click a source or bucket to filter the feed{filter && <button type="button" onClick={() => setFilter(null)} className="ml-2 text-accent">clear</button>}</span></div></div>
        <div className="card flex min-h-0 flex-col overflow-hidden">
          {failed ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 p-5 anim-fade-up"><div className="rounded-xl border border-critical/40 bg-critical/10 p-4"><div className="display text-lg">The Scraping Agent could not start</div><p className="mt-1 text-sm text-ink-2">{result?.error}</p></div><p className="text-xs text-ink-3">Add the key to <code className="mono">server/.env</code>, restart the API, and run again. Nothing was fabricated — the calendar and intelligence screens stay as they were.</p><div className="flex gap-2"><Btn variant="primary" onClick={() => { s.close(); s.setPage('settings') }}>Open Settings</Btn><Btn variant="ghost" onClick={s.close}>Close</Btn></div></div>
          ) : stage === 'done' && result ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 anim-fade-up">
              <div className="rounded-xl border border-good/40 bg-good/10 p-4"><div className="display text-lg">Pipeline run complete</div><div className="text-sm text-ink-2">The Calendar Agent placed the strongest trends into the week.</div></div>
              <div><div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Top {result.trendingKeywords.length} keywords</div><div className="flex flex-wrap gap-1.5">{result.trendingKeywords.map((t) => <span key={t.keywordId} title={t.trendReason} className="rounded-full border border-magenta/40 bg-magenta/10 px-2.5 py-1 text-xs"><b className="tabular text-magenta-ink">#{t.rank}</b> {t.term} · {t.trendScore}</span>)}</div></div>
              <div><div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Top {result.topHashtags.length} hashtags</div><div className="flex flex-wrap gap-1">{result.topHashtags.map((h) => <Badge key={h.tag} tone="accent">#{h.displayTag}</Badge>)}{result.topHashtags.length === 0 && <span className="text-xs text-ink-3">No hashtag reached the validated set this run.</span>}</div></div>
              <div className="grid grid-cols-4 gap-2">{(['validated', 'needs_review', 'duplicate', 'rejected'] as Validation[]).map((b) => <button key={b} type="button" onClick={() => setFilter(filter === `bucket:${b}` ? null : `bucket:${b}`)} className={`rounded-lg border p-2 text-center ${filter === `bucket:${b}` ? 'border-accent' : 'border-line bg-surface-2'}`}><div className="tabular display text-xl">{buckets[b as keyof typeof buckets]}</div><div className="text-[10px] text-ink-3">{VALIDATION_META[b].label}</div></button>)}</div>
              {pending.length > 0 && <div className="rounded-xl border border-warn/40 bg-warn/10 p-3"><div className="text-xs font-semibold text-warn">{pending.length} still need a human decision</div><div className="mt-2 space-y-2">{pending.map((v) => <div key={v.id} className="flex items-start gap-2 rounded-lg bg-surface/70 p-2 text-xs"><div className="min-w-0 flex-1"><div className="font-medium">{v.title}</div><div className="text-ink-3">{v.reason}</div></div><Btn size="sm" variant="primary" onClick={() => decide(v, 'Approve')}>Approve</Btn><Btn size="sm" variant="danger" onClick={() => decide(v, 'Reject')}>Reject</Btn></div>)}</div></div>}
              <div><div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">New trends added to the calendar</div><div className="space-y-1">{result.ideas.map((i) => <div key={i.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs"><PlatformIcon platform={i.platform} size={12} /><span className="min-w-0 flex-1 truncate">{i.title}</span><span className="tabular text-ink-3">{PLATFORM_LABEL[i.platform]} #{i.platformRank}</span><Badge tone={i.calendarSlot === 'primary' ? 'good' : 'neutral'}>{i.calendarSlot === 'primary' ? 'On the calendar' : 'More suggestions'}</Badge></div>)}{result.ideas.length === 0 && <div className="text-xs text-ink-3">No new ideas this run — everything validated was already on the calendar.</div>}</div></div>
              <div className="flex flex-wrap gap-2 pt-2"><Btn variant="primary" onClick={() => { s.close(); s.setPage('calendar') }}>Open Weekly Calendar</Btn><Btn variant="ghost" onClick={() => { s.close(); s.setPage('intelligence') }}>View Content Intelligence</Btn><Btn variant="ghost" onClick={s.close}>Close</Btn></div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!result && <div className="flex items-center gap-2 py-6 text-sm text-ink-3"><span className="h-3 w-3 rounded-full bg-accent anim-pulse-dot" />Agents are running — waiting for the first captures…</div>}
              <div className="space-y-1.5">{shown.map((f) => {
                if (f.kind === 'note') return <div key={f.id} className="anim-stream-in rounded-lg bg-accent/10 px-3 py-1.5 text-xs text-accent-bright">{f.text}</div>
                if (f.kind === 'capture' && f.item) return <div key={f.id} className="anim-stream-in flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs"><Badge tone="neutral">{f.keyword}</Badge><span className="text-[10px] text-ink-3">{f.item.sourceType}</span><span className="min-w-0 flex-1 truncate">{f.item.title}</span><span className="tabular text-ink-3">{f.item.engagement}</span><Badge tone={f.item.relevance >= 70 ? 'good' : f.item.relevance >= 40 ? 'warn' : 'critical'}>Rel {f.item.relevance}%</Badge></div>
                if (f.kind === 'hashtags') return <div key={f.id} className="anim-stream-in flex flex-wrap items-center gap-1 px-1 text-[11px]"><span className="text-ink-3">{f.keyword} →</span>{f.tags?.map((t) => <span key={t} className="rounded-full border border-accent/30 bg-accent/10 px-1.5 text-accent-bright">#{t}</span>)}</div>
                const v = f.verdict as TheaterVerdict; const m = VALIDATION_META[v.verdict]; const d = decided[v.id]
                return <div key={f.id} className="anim-stream-in flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${v.verdict === 'validated' ? 'bg-good' : v.verdict === 'needs_review' ? 'bg-serious' : v.verdict === 'duplicate' ? 'bg-warn' : 'bg-critical'}`} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-medium">{v.title}</span><Badge tone={m.tone}>{m.label}</Badge></div><div className="text-[11px] text-ink-3">{v.reason}</div>{v.verdict === 'needs_review' && (d ? <div className="mt-1 text-[11px] text-good-ink"><Check size={11} className="inline" /> {d === 'Approve' ? 'Approved' : 'Rejected'} by you</div> : <div className="mt-1 flex gap-1"><Btn size="sm" variant="primary" onClick={() => decide(v, 'Approve')}>Approve</Btn><Btn size="sm" variant="danger" onClick={() => decide(v, 'Reject')}>Reject</Btn></div>)}</div></div>
              })}
              {scoring && <div className="anim-pop-in rounded-lg border border-accent/40 bg-accent/5 p-2.5 text-xs"><div className="mb-1.5 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent anim-pulse-dot" /><span className="font-medium">scoring…</span><span className="truncate text-ink-3">{scoring.title}</span></div>{[['Credibility', scoring.credibility === 'High' ? 90 : scoring.credibility === 'Medium' ? 60 : 30], ['Relevance', scoring.relevance], ['Freshness', scoring.freshness], ['Unique', scoring.isDuplicate ? 8 : 96]].map(([l, v], i) => <div key={String(l)} className="mb-1 flex items-center gap-2"><span className="w-16 text-[10px] text-ink-3">{l}</span><div className="h-1.5 flex-1 rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent" style={{ width: paused ? undefined : `${v}%`, transition: `width ${140 + i * 30}ms ease-out` }} /></div><span className="tabular w-7 text-right text-[10px]">{v}</span></div>)}</div>}
              <div ref={feedEnd} /></div>
            </div>
          )}
        </div>
      </div>
      <footer className="flex items-center gap-4 border-t border-line px-5 py-3"><Progress value={progress} className="flex-1" /><span className="tabular w-12 text-right text-sm font-semibold">{Math.round(progress)}%</span><span className="hidden text-xs text-ink-3 md:inline">{captured} captured · {verdictsDone} verdicts · {buckets.validated} validated · {buckets.needs_review} review</span><Badge tone="neutral">Space · pause</Badge></footer>
    </div>
  )
}
