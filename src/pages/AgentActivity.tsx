import { AlertTriangle, RotateCcw, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AGENTS, AGENT_BY_ID, SKILLS_BY_AGENT, STAGES, type AgentId } from '../../shared/agent-registry'
import { PageHeader, STAGES as UI_STAGES } from '../components/layout'
import { PlayButton } from '../components/play-button'
import { Badge, Btn, Spinner, timeAgo } from '../components/ui'
import { AGENT_STATUS_META, useStore } from '../store'

const VB = { w: 1060, h: 640 }
const COL_W = VB.w / 6
const MEMORY_Y = 560
const POS: Record<AgentId, { x: number; y: number }> = Object.fromEntries(AGENTS.map((a) => { const stage = STAGES.find((s) => s.id === a.stage)!; const idx = stage.agentIds.indexOf(a.id); const n = stage.agentIds.length; const x = COL_W * (stage.order - 1) + COL_W / 2; const y = n === 1 ? 300 : 150 + idx * (300 / (n - 1)) ; return [a.id, { x, y }] })) as Record<AgentId, { x: number; y: number }>
const MEMORY_AGENTS: AgentId[] = ['knowledge', 'learning']
const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => `M${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`
const STATUS_COLOR = { idle: 'var(--color-ink-3)', running: 'var(--color-accent)', completed: 'var(--color-good)', waiting: 'var(--color-warn)', needs_review: 'var(--color-serious)', failed: 'var(--color-critical)' } as const
const dots = Array.from({ length: 34 }, (_, i) => ({ x: (i * 173) % VB.w, y: (i * 97) % 520 + 20, d: (i % 7) * 0.5 }))

export function AgentActivity() {
  const s = useStore(useShallow((st) => ({ agents: st.agents, activity: st.activity, failedAgent: st.failedAgent, simulateFailure: st.simulateFailure, retryFailed: st.retryFailed, runValidation: st.runValidation, runScraping: st.runScraping, running: st.scrapeRun.running, validating: st.validating })))
  const [view, setView] = useState<'network' | 'list'>('network'); const [tour, setTour] = useState(false); const [pinned, setPinned] = useState<AgentId | null>(null); const [tourIdx, setTourIdx] = useState(0); const [transit, setTransit] = useState(false)
  const runningAgent = s.agents.find((a) => a.status === 'running')?.id
  const active: AgentId = pinned ?? runningAgent ?? (tour ? AGENTS[tourIdx].id : 'scraping')
  useEffect(() => { if (!tour) return; const t = setInterval(() => setTourIdx((i) => (i + 1) % AGENTS.length), 3200); return () => clearInterval(t) }, [tour])
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  useEffect(() => { if (reduce) return; setTransit(true); const t = setTimeout(() => setTransit(false), 900); return () => clearTimeout(t) }, [active, reduce])
  const state = (id: AgentId) => s.agents.find((a) => a.id === id)
  const edges = useMemo(() => AGENTS.flatMap((a) => a.handsOffTo.map((to) => ({ from: a.id, to, kind: MEMORY_AGENTS.includes(a.id) || MEMORY_AGENTS.includes(to) ? 'memory' : 'flow' as 'memory' | 'flow' }))), [])
  const feeding = edges.filter((e) => e.to === active)
  const spec = AGENT_BY_ID[active]; const st = state(active); const receives = AGENTS.filter((a) => a.handsOffTo.includes(active)).map((a) => a.id)
  const recent = s.activity.filter((a) => a.agentId === active).slice(0, 4)
  const pin = (id: AgentId) => { setPinned(id); setTour(false) }
  return (
    <div>
      <PageHeader title="Agent Orchestration" subtitle="Eleven agents in six stages, one network. Work travels along the synapses; start the tour to follow the signal, or click any agent to hold it." actions={<><Btn variant="ghost" icon={<Zap size={14} />} onClick={s.simulateFailure}>Simulate Failure</Btn><Btn variant="ghost" icon={s.validating ? <Spinner /> : undefined} onClick={() => s.runValidation()} disabled={s.validating}>Run Validation</Btn><PlayButton label="Run Pipeline" hint="Scrape → Validate → Plan" running={s.running} onClick={() => { void s.runScraping() }} /></>} />
      {s.failedAgent && <div className="card mb-4 flex items-center gap-3 border-critical/50 bg-critical/10 px-4 py-3 anim-fade-up"><AlertTriangle size={16} className="text-critical-ink" /><div className="text-sm"><b>{AGENT_BY_ID[s.failedAgent].name}</b> failed — {state(s.failedAgent)?.currentTask}</div><Btn size="sm" variant="primary" className="ml-auto" icon={<RotateCcw size={12} />} onClick={() => s.retryFailed()}>Retry</Btn></div>}
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <div className="card p-3 anim-fade-up">
            <div className="mb-2 flex items-center justify-between"><div className="inline-flex rounded-full border border-line bg-surface-2 p-0.5">{(['network', 'list'] as const).map((v) => <button key={v} type="button" onClick={() => setView(v)} className={`rounded-full px-3 py-1 text-xs capitalize ${view === v ? 'bg-accent text-on-accent' : 'text-ink-2'}`}>{v}</button>)}</div><Btn size="sm" variant={tour ? 'primary' : 'ghost'} onClick={() => { setTour((t) => !t); setPinned(null) }}>{tour ? 'End tour' : 'Start tour'}</Btn></div>
            {view === 'network' ? (
              <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="w-full" role="img" aria-label="Agent network">
                {STAGES.map((sg) => <g key={sg.id}><rect x={COL_W * (sg.order - 1) + 8} y={40} width={COL_W - 16} height={470} rx={18} fill="var(--color-surface-2)" fillOpacity={0.5} stroke="var(--color-line)" /><text x={COL_W * (sg.order - 1) + COL_W / 2} y={64} textAnchor="middle" fontSize={10} letterSpacing={2} fill="var(--color-ink-3)">STEP {sg.order}</text><text x={COL_W * (sg.order - 1) + COL_W / 2} y={82} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--color-ink)">{sg.name.toUpperCase()}</text></g>)}
                {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={1.5} fill="var(--color-accent)" className={reduce ? '' : 'neural-twinkle'} style={{ animationDelay: `${d.d}s` }} />)}
                <rect x={12} y={MEMORY_Y - 22} width={VB.w - 24} height={44} rx={22} fill="var(--color-magenta)" fillOpacity={0.08} stroke="var(--color-magenta)" strokeOpacity={0.4} strokeDasharray="6 6" /><text x={VB.w / 2} y={MEMORY_Y + 4} textAnchor="middle" fontSize={10} letterSpacing={2} fill="var(--color-magenta-ink)">MEMORY · KNOWLEDGE BASE · READ AND WRITTEN BY EVERY STAGE</text>
                {AGENTS.map((a) => { const p = POS[a.id]; return <path key={`m-${a.id}`} d={`M${p.x} ${p.y + 40} L${p.x} ${MEMORY_Y - 22}`} stroke="var(--color-magenta)" strokeOpacity={0.25} strokeDasharray="2 6" /> })}
                {edges.map((e, i) => { const a = POS[e.from]; const b = POS[e.to]; const hot = e.to === active; const d = curve(a, b); return <g key={i}><path d={d} fill="none" stroke={hot ? 'var(--color-accent)' : e.kind === 'memory' ? 'var(--color-magenta)' : 'var(--color-line-strong)'} strokeOpacity={hot ? 1 : e.kind === 'memory' ? 0.5 : 0.8} strokeWidth={hot ? 2.5 : 1.5} strokeDasharray={e.kind === 'memory' ? '5 6' : undefined} className={reduce ? '' : hot ? 'nn-dashflow' : 'neural-flow-slow'} />{hot && !reduce && <circle r={4} fill="var(--color-magenta)"><animateMotion dur="0.9s" repeatCount="indefinite" path={d} /></circle>}</g> })}
                {AGENTS.map((a, i) => { const p = POS[a.id]; const stt = state(a.id); const status = stt?.status ?? 'idle'; const isActive = a.id === active; return (
                  <g key={a.id} transform={`translate(${p.x} ${p.y})`} onClick={() => pin(a.id)} className="cursor-pointer">
                    {transit && isActive && feeding.length > 0 && !reduce && <circle r={4} fill="var(--color-magenta)" className="neural-burst" />}
                    {(status === 'running' || status === 'needs_review') && !reduce && <circle r={30} fill="none" stroke={STATUS_COLOR[status]} strokeWidth={2} className="nn-ping" />}
                    <circle r={28} fill="var(--color-surface)" stroke={isActive ? 'var(--color-accent)' : STATUS_COLOR[status]} strokeWidth={isActive ? 3 : 2} />
                    {status === 'running' && !reduce && <circle r={24} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeDasharray="30 120" className="animate-[ring-spin_1.2s_linear_infinite]" style={{ transformOrigin: 'center', transformBox: 'fill-box' }} />}
                    <circle r={14} fill={STATUS_COLOR[status]} fillOpacity={0.25} /><text y={5} textAnchor="middle" fontSize={13} fontWeight={700} fill={STATUS_COLOR[status]}>{i + 1}</text>
                    <circle cx={22} cy={-20} r={5} fill={STATUS_COLOR[status]} stroke="var(--color-surface)" strokeWidth={2} />
                    <text y={46} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--color-ink)">{a.shortName}</text><text y={60} textAnchor="middle" fontSize={10} fill="var(--color-ink-3)">{AGENT_STATUS_META[status].label}</text>
                  </g>
                ) })}
              </svg>
            ) : (
              <div className="flex flex-wrap items-center gap-2 p-2">{AGENTS.map((a, i) => { const status = state(a.id)?.status ?? 'idle'; return <div key={a.id} className="flex items-center gap-2"><button type="button" onClick={() => pin(a.id)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs ${active === a.id ? 'border-accent bg-accent/10' : 'border-line bg-surface-2'}`}><span className={`h-2 w-2 rounded-full ${AGENT_STATUS_META[status].dot}`} /><span><span className="block font-medium">{i + 1}. {a.name}</span><span className="text-[10px] text-ink-3">{STAGES.find((sg) => sg.id === a.stage)?.name}</span></span></button>{i < AGENTS.length - 1 && <span className="h-px w-5 bg-line-strong overflow-hidden relative"><span className="absolute inset-y-0 w-2 bg-accent" style={{ animation: reduce ? 'none' : 'flow-right 1.6s linear infinite', animationDelay: `${i * 0.15}s` }} /></span>}</div> })}</div>
            )}
            <div className="mt-2 flex flex-wrap gap-4 px-1 text-[11px] text-ink-3"><span className="inline-flex items-center gap-1.5"><span className="h-px w-5 bg-line-strong" />hand-off</span><span className="inline-flex items-center gap-1.5"><span className="h-px w-5 border-t border-dashed border-magenta" />memory read/write</span><span className="inline-flex items-center gap-1.5"><span className="h-px w-5 bg-accent" />feeding the active agent</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-magenta" />signal in transit</span></div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="card p-4 anim-fade-up" key={active}>
            {transit ? <div className="py-8"><div className="mb-2 text-center text-xs text-ink-3">Signal in flight → {spec.shortName}</div><div className="h-1 w-full overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-gradient-to-r from-accent to-magenta neural-transit" /></div></div> : <>
              <div className="flex items-start gap-3"><span className="tabular grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-bold" style={{ background: `color-mix(in srgb, ${STATUS_COLOR[st?.status ?? 'idle']} 22%, transparent)`, color: STATUS_COLOR[st?.status ?? 'idle'] }}>{AGENTS.indexOf(spec) + 1}</span><div className="min-w-0"><div className="display text-base">{spec.name}</div><div className="mt-1 flex flex-wrap gap-1"><Badge tone="accent">{STAGES.find((sg) => sg.id === spec.stage)?.name}</Badge><Badge tone={st?.status === 'failed' ? 'critical' : st?.status === 'needs_review' ? 'serious' : st?.status === 'running' ? 'accent' : st?.status === 'waiting' ? 'warn' : 'good'} dot>{AGENT_STATUS_META[st?.status ?? 'idle'].label}</Badge></div></div></div>
              <div className="mt-2 text-xs text-accent">{spec.role}</div><p className="mt-1 text-xs text-ink-2">{st?.currentTask ?? 'Idle'}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">{[['Processed', st?.processed ?? 0], ['Success', `${st?.successRate ?? 100}%`], ['Last run', timeAgo(st?.lastRun)]].map(([l, v]) => <div key={String(l)} className="rounded-lg bg-surface-2 px-2 py-2"><div className="text-[9px] uppercase tracking-wide text-ink-3">{l}</div><div className="tabular text-sm font-semibold">{v}</div></div>)}</div>
              {[['Receives from', receives], ['Hands to', spec.handsOffTo]].map(([l, ids]) => <div key={String(l)} className="mt-3"><div className="text-[10px] uppercase tracking-wide text-ink-3">{l}</div><div className="mt-1 flex flex-wrap gap-1">{(ids as AgentId[]).length === 0 && <span className="text-[11px] text-ink-3">—</span>}{(ids as AgentId[]).map((id) => <button key={id} type="button" onClick={() => pin(id)} className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] hover:border-accent">{AGENT_BY_ID[id].shortName}</button>)}</div></div>)}
              <div className="mt-3"><div className="text-[10px] uppercase tracking-wide text-ink-3">Skills</div><div className="mt-1 flex flex-wrap gap-1">{SKILLS_BY_AGENT[active].slice(0, 6).map((sk) => <Badge key={sk.id}>{sk.name}</Badge>)}{SKILLS_BY_AGENT[active].length > 6 && <Badge tone="accent">+{SKILLS_BY_AGENT[active].length - 6} more in Agent Studio</Badge>}</div></div>
              {recent.length > 0 && <div className="mt-3"><div className="text-[10px] uppercase tracking-wide text-ink-3">Recent</div><ul className="mt-1 space-y-1 text-[11px] text-ink-2">{recent.map((r) => <li key={r.id} className="truncate">· {r.message}</li>)}</ul></div>}
            </>}
          </div>
          <div className="card p-4 anim-fade-up"><div className="mb-2 text-sm font-semibold">Activity Timeline</div><div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">{s.activity.map((a) => <div key={a.id} className="flex gap-2 text-xs"><span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${a.status === 'error' ? 'bg-critical' : a.status === 'warn' ? 'bg-serious' : a.status === 'running' ? 'bg-accent anim-pulse-dot' : 'bg-good'}`} /><div className="min-w-0"><div className="text-ink">{a.message}</div><div className="text-[10px] text-ink-3">{a.agentId !== 'system' ? AGENT_BY_ID[a.agentId as AgentId]?.name : 'System'} · {timeAgo(a.at)}</div></div></div>)}</div></div>
        </div>
      </div>
      <div className="hidden">{UI_STAGES.length}</div>
    </div>
  )
}
