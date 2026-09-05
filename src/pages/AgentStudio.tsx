import { Lock, RotateCcw, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AGENTS, SKILLS, STAGES, defaultSkillConfig, type AgentId, type ConfigField } from '../../shared/agent-registry'
import { PageHeader } from '../components/layout'
import { api } from '../lib/api'
import { Badge, Spinner, Switch } from '../components/ui'
import { useStore } from '../store'
import type { RegistrySkill } from '../types'

const staticRegistry = (): RegistrySkill[] => SKILLS.map((s) => ({ ...s, enabled: s.enabledByDefault, values: defaultSkillConfig(s.id), isOverridden: false, stats: { runs: 0, failures: 0, avgMs: 0 } }))

function Knob({ f, value, onChange }: { f: ConfigField; value: string | number | boolean; onChange: (v: string | number | boolean) => void }) {
  if (f.type === 'boolean') return <div className="flex items-center justify-between gap-3"><span className="text-sm">{f.label}</span><Switch checked={Boolean(value)} onChange={onChange} /></div>
  if (f.type === 'enum') return <label className="block text-sm">{f.label}<select value={String(value)} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full py-1 text-sm">{f.options?.map((o) => <option key={o}>{o}</option>)}</select></label>
  if (f.type === 'text') return <label className="block text-sm">{f.label}<input value={String(value)} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full py-1 text-sm" /></label>
  const min = f.min ?? 0; const max = f.max ?? (f.type === 'percent' ? 100 : 1000)
  return <div><div className="flex items-center justify-between text-sm"><span>{f.label}</span><span className="tabular text-xs text-ink-2">{value}{f.unit ?? (f.type === 'percent' ? '%' : '')}</span></div><div className="mt-1 flex items-center gap-2"><input type="range" min={min} max={max} step={f.step ?? 1} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} className="flex-1" /><input type="number" min={min} max={max} step={f.step ?? 1} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} className="w-20 py-0.5 text-right text-xs tabular" /></div></div>
}

export function AgentStudio() {
  const { apiMode, toast } = useStore(useShallow((s) => ({ apiMode: s.apiMode, toast: s.toast })))
  const [skills, setSkills] = useState<RegistrySkill[]>(staticRegistry())
  const [agentId, setAgentId] = useState<AgentId>('scraping'); const [q, setQ] = useState(''); const [saving, setSaving] = useState<string | null>(null)
  useEffect(() => { if (apiMode !== 'live') return; api.registry().then((r) => setSkills(r.skills)).catch(() => undefined) }, [apiMode])
  const agent = AGENTS.find((a) => a.id === agentId)!
  const mine = useMemo(() => skills.filter((s) => s.agentId === agentId && (!q || `${s.name} ${s.summary} ${s.id}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a.order - b.order), [skills, agentId, q])
  const sections = agent.sections ?? ['skills']
  const patch = async (skill: RegistrySkill, p: { enabled?: boolean; config?: Record<string, string | number | boolean> }) => {
    if (p.enabled === false && skill.critical) { toast('error', 'Cannot switch off a critical skill', `${skill.name} always runs.`); return }
    setSkills((all) => all.map((s) => (s.id === skill.id ? { ...s, enabled: p.enabled ?? s.enabled, values: { ...s.values, ...(p.config ?? {}) }, isOverridden: true } : s)))
    if (apiMode !== 'live') return
    setSaving(skill.id)
    try { const r = await api.patchSkill(skill.id, p); setSkills((all) => all.map((s) => (s.id === skill.id ? { ...s, enabled: r.enabled, values: r.values, isOverridden: r.isOverridden } : s))) } catch (e) { toast('error', 'Could not save', String(e)) }
    setSaving(null)
  }
  const reset = async (skill: RegistrySkill) => {
    setSkills((all) => all.map((s) => (s.id === skill.id ? { ...s, enabled: s.enabledByDefault, values: defaultSkillConfig(s.id), isOverridden: false } : s)))
    if (apiMode === 'live') { try { await api.resetSkill(skill.id) } catch { /* soft */ } }
  }
  const summary = [['Agents', AGENTS.length], ['Skills', SKILLS.length], ['Tunable settings', SKILLS.reduce((n, s) => n + s.config.length, 0)], ['Customised', skills.filter((s) => s.isOverridden).length], ['Switched off', skills.filter((s) => !s.enabled).length]]
  return (
    <div>
      <PageHeader title="Agent Studio" subtitle="Every agent, every skill, every knob — declared once in the registry and adjustable here." actions={<Badge tone={apiMode === 'live' ? 'good' : 'warn'} dot>{apiMode === 'live' ? 'Connected to agent runtime' : 'Standalone — changes are local only'}</Badge>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5 stagger-fade">{summary.map(([l, v], i) => <div key={String(l)} className="card p-3" style={{ ['--i' as string]: i }}><div className="text-[10px] uppercase tracking-wide text-ink-3">{l}</div><div className="tabular display text-2xl">{v}</div></div>)}</div>
      <div className="flex gap-4">
        <aside className="w-[280px] shrink-0 space-y-3">{STAGES.map((st) => <div key={st.id} className="card p-2"><div className="px-2 pb-1 text-[10px] uppercase tracking-wide text-ink-3">Step {st.order} · {st.name}</div>{st.agentIds.map((id) => { const a = AGENTS.find((x) => x.id === id)!; const n = skills.filter((s) => s.agentId === id); const off = n.some((s) => !s.enabled); return <button key={id} type="button" onClick={() => setAgentId(id)} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm ${agentId === id ? 'bg-accent/15 text-ink' : 'text-ink-2 hover:bg-surface-2'}`}><span className="flex items-center gap-2">{off && <span className="h-1.5 w-1.5 rounded-full bg-warn" />}{a.name}</span><span className="tabular text-[11px] text-ink-3">{n.length} skills</span></button> })}</div>)}</aside>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="card p-5 anim-fade-up"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="display text-xl">{agent.name}</div><div className="text-sm text-accent">{agent.role}</div><p className="mt-1 max-w-2xl text-sm text-ink-2">{agent.description}</p></div><label className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" /><input placeholder="Find a skill…" value={q} onChange={(e) => setQ(e.target.value)} className="w-56 pl-8" /></label></div>
            <div className="mt-4 grid gap-3 md:grid-cols-3 text-xs">{[['Consumes', agent.consumes], ['Produces', agent.produces], ['Hands off to', agent.handsOffTo.map((h) => AGENTS.find((a) => a.id === h)?.name ?? h)]].map(([l, items]) => <div key={String(l)}><div className="mb-1 font-semibold">{l}</div><div className="flex flex-wrap gap-1">{(items as string[]).map((x) => <Badge key={x}>{x}</Badge>)}</div></div>)}</div></div>
          {sections.map((sec) => { const list = mine.filter((s) => !s.section || s.section === sec); if (!list.length) return null; return (
            <div key={sec}>{agent.sections && <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-3">{sec}</div>}
              <div className="grid gap-3 xl:grid-cols-2 stagger-fade">{list.map((s, i) => (
                <div key={s.id} className={`card p-4 ${s.enabled ? '' : 'opacity-70'}`} style={{ ['--i' as string]: i }}>
                  <div className="flex items-start justify-between gap-2"><div className="flex flex-wrap items-center gap-1.5"><span className="tabular grid h-5 w-5 place-items-center rounded bg-surface-3 text-[10px] font-semibold">{s.order}</span><span className="text-sm font-semibold">{s.name}</span>{s.critical && <Badge tone="accent" title="Required — always runs"><Lock size={9} /> Required</Badge>}{s.isOverridden && <Badge tone="magenta">Customised</Badge>}{!s.enabled && <Badge tone="warn">Off</Badge>}</div><div className="flex items-center gap-2">{saving === s.id && <span className="text-[10px] text-ink-3 inline-flex items-center gap-1"><Spinner size={10} />Saving…</span>}<button type="button" onClick={() => reset(s)} title="Reset to defaults" className="text-ink-3 hover:text-ink"><RotateCcw size={13} /></button><Switch checked={s.enabled} disabled={Boolean(s.critical)} onChange={(v) => patch(s, { enabled: v })} /></div></div>
                  <p className="mt-1.5 text-xs text-ink-2">{s.summary}</p>
                  <div className="mt-1.5 text-[11px] text-ink-3"><span>In: {s.inputs.join(', ')}</span> · <span>Out: {s.outputs.join(', ')}</span></div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]"><code className="mono rounded bg-surface-2 px-1.5 py-0.5 text-ink-2">{s.id}</code><Badge tone="neutral">{s.stats.runs} runs · {s.stats.avgMs}ms avg · {s.stats.failures} failures</Badge></div>
                  {s.config.length === 0 ? <div className="mt-3 text-xs italic text-ink-3">This skill has no settings — it either runs or it does not.</div> : <div className="mt-3 space-y-3 border-t border-line pt-3">{s.config.map((f) => <div key={f.key}><Knob f={f} value={s.values[f.key] ?? f.default} onChange={(v) => patch(s, { config: { [f.key]: v } })} /><div className="mt-0.5 text-[11px] text-ink-3">{f.description}</div></div>)}</div>}
                </div>
              ))}</div>
            </div>
          ) })}
          {mine.length === 0 && <div className="card p-6 text-center text-sm text-ink-3">No skill matches "{q}".</div>}
          <div className="card p-3 text-[11px] text-ink-3">{apiMode === 'live' ? 'A past run\'s resolved config is recoverable from skill_runs.config_used — see the Run Console.' : 'The runtime is not reachable, so this screen shows the static registry. Start the API (npm run dev:server) to persist changes.'}</div>
        </div>
      </div>
    </div>
  )
}
