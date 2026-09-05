import { Pause, Play, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AGENT_BY_ID, SKILL_BY_ID } from '../../shared/agent-registry'
import { PageHeader } from '../components/layout'
import { PlayButton } from '../components/play-button'
import { Badge, Btn, EmptyState, VALIDATION_META } from '../components/ui'
import { useStore } from '../store'
import type { PipelineEventType } from '../types'

const TONE: Record<PipelineEventType, { icon: string; cls: string }> = {
  'pipeline.started': { icon: '▶', cls: 'text-magenta-ink' }, 'pipeline.finished': { icon: '■', cls: 'text-magenta-ink' }, 'agent.started': { icon: '◆', cls: 'text-accent' }, 'agent.finished': { icon: '◆', cls: 'text-good-ink' }, 'agent.failed': { icon: '✕', cls: 'text-critical-ink' },
  'skill.started': { icon: '·', cls: 'text-ink-3' }, 'skill.finished': { icon: '✓', cls: 'text-good-ink' }, 'skill.skipped': { icon: '↷', cls: 'text-warn' }, 'skill.failed': { icon: '✕', cls: 'text-critical-ink' }, 'item.scraped': { icon: '＋', cls: 'text-accent' }, 'item.validated': { icon: '⚖', cls: 'text-ink-2' },
  'hashtag.captured': { icon: '#', cls: 'text-accent' }, 'hashtag.validated': { icon: '#', cls: 'text-good-ink' }, 'keyword.ranked': { icon: '↑', cls: 'text-magenta-ink' }, 'idea.created': { icon: '✦', cls: 'text-accent' }, 'idea.ranked': { icon: '≡', cls: 'text-ink-2' }, 'draft.generated': { icon: '✎', cls: 'text-accent' },
  'post.published': { icon: '➤', cls: 'text-good-ink' }, 'knowledge.written': { icon: '◉', cls: 'text-magenta-ink' }, 'knowledge.build.started': { icon: '◎', cls: 'text-magenta-ink' }, 'knowledge.build.finished': { icon: '◎', cls: 'text-good-ink' }, activity: { icon: '›', cls: 'text-ink-3' },
}
type Filter = 'all' | 'agents' | 'skills' | 'items' | 'knowledge'
const FILTERS: Record<Filter, (t: PipelineEventType) => boolean> = { all: () => true, agents: (t) => t.startsWith('agent.') || t.startsWith('pipeline.'), skills: (t) => t.startsWith('skill.'), items: (t) => t.startsWith('item.') || t.startsWith('hashtag.') || t.startsWith('idea.') || t.startsWith('keyword.'), knowledge: (t) => t.startsWith('knowledge.') || t === 'draft.generated' || t === 'post.published' }

export function RunConsole() {
  const { events, apiMode, clearEvents, runScraping, running } = useStore(useShallow((s) => ({ events: s.events, apiMode: s.apiMode, clearEvents: s.clearEvents, runScraping: s.runScraping, running: s.scrapeRun.running })))
  const [paused, setPaused] = useState(false); const [filter, setFilter] = useState<Filter>('all'); const [frozen, setFrozen] = useState(events)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!paused) setFrozen(events) }, [events, paused])
  useEffect(() => { if (!paused) endRef.current?.scrollIntoView({ block: 'end' }) }, [frozen, paused])
  const list = useMemo(() => frozen.filter((e) => FILTERS[filter](e.type)), [frozen, filter])
  const skillsDone = frozen.filter((e) => e.type === 'skill.finished'); const failures = frozen.filter((e) => e.type.endsWith('.failed')).length; const avg = skillsDone.length ? Math.round(skillsDone.reduce((n, e) => n + Number(e.data?.durationMs ?? 0), 0) / skillsDone.length) : 0
  if (apiMode !== 'live') return <div><PageHeader title="Run Console" subtitle="Every agent and skill execution, streamed live from the runtime as it happens." /><EmptyState title="Not connected to the agent runtime" body="Start the API and reload to stream events." action={<code className="mono rounded bg-surface-2 px-3 py-1.5 text-xs">cd server &amp;&amp; npm run dev &nbsp;·&nbsp; or &nbsp;npm run dev:full</code>} /></div>
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Run Console" subtitle="Every agent and skill execution, streamed live from the runtime as it happens." actions={<><Btn variant="ghost" icon={<Trash2 size={14} />} onClick={clearEvents}>Clear</Btn><Btn variant="ghost" icon={paused ? <Play size={14} /> : <Pause size={14} />} onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'}</Btn><PlayButton label="Run Pipeline" hint="Scrape → Validate → Plan" running={running} onClick={() => { void runScraping() }} /></>} />
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs"><span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${paused ? 'bg-warn' : 'bg-good anim-pulse-dot'}`} />{paused ? 'Paused' : 'Live'}</span><span className="tabular text-ink-3">{frozen.length} events · {skillsDone.length} skills completed · {failures} failures · {avg}ms avg skill</span><div className="ml-auto flex gap-1">{(Object.keys(FILTERS) as Filter[]).map((f) => <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-full border px-2.5 py-0.5 text-[11px] capitalize ${filter === f ? 'border-accent bg-accent/15 text-accent-bright' : 'border-line bg-surface-2 text-ink-2'}`}>{f}</button>)}</div></div>
      <div className="card mono min-h-0 flex-1 overflow-y-auto p-3 text-[12px] leading-relaxed">
        {list.length === 0 && <div className="py-10 text-center text-ink-3">Waiting for events… run the pipeline to see every skill stream in.</div>}
        {list.map((e) => { const t = TONE[e.type] ?? TONE.activity; const verdict = e.data?.verdict as string | undefined; const dur = e.data?.durationMs as number | undefined; return (
          <div key={e.id} className="anim-stream-in flex items-start gap-2 rounded px-1 py-0.5 hover:bg-surface-2"><span className="tabular text-ink-3">{new Date(e.at).toLocaleTimeString('en-GB', { hour12: false })}</span><span className={`w-3 text-center ${t.cls}`}>{t.icon}</span><span className={`w-24 shrink-0 truncate ${t.cls}`}>{e.agentId ? AGENT_BY_ID[e.agentId]?.shortName : e.type.split('.')[0]}</span><span className="min-w-0 flex-1 text-ink-2">{e.skillId && <span className="text-ink">{SKILL_BY_ID[e.skillId]?.name ?? e.skillId} — </span>}{e.message}</span>{dur != null && <Badge tone="neutral">{dur}ms</Badge>}{verdict && VALIDATION_META[verdict] && <Badge tone={VALIDATION_META[verdict].tone}>{VALIDATION_META[verdict].label}</Badge>}</div>
        ) })}
        <div ref={endRef} />
      </div>
    </div>
  )
}
