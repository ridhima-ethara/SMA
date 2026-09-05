import { Brain, ExternalLink, Pin, Plus, Power, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { BRAND } from '../../shared/brand-voice'
import { PageHeader } from '../components/layout'
import { Badge, Btn, EmptyState, Modal, Spinner, fmtDate, timeAgo, timeUntil } from '../components/ui'
import { useStore } from '../store'

const CATEGORIES = ['All', 'Brand Voice', 'Brand Guideline', 'Visual Identity', 'Compliance Rule', 'Research', 'User Feedback', 'Audience Insight', 'Platform Preference', 'High Performer', 'Approved Post', 'Rejected Post', 'Hashtags', 'CTA', 'Topic']

export function BrandIdentityCard() {
  return (
    <div className="rounded-xl bg-gradient-to-r from-accent to-magenta p-px anim-fade-up"><div className="rounded-[11px] bg-surface p-5">
      <div className="text-[11px] uppercase tracking-wide text-magenta-ink">Brand identity · read before every caption and creative</div>
      <div className="display mt-1 text-lg">{BRAND.positioning}</div>
      <div className="mt-4 grid gap-4 md:grid-cols-4 text-xs">
        <div><div className="mb-1 font-semibold text-ink">Voice</div><div className="flex flex-wrap gap-1">{BRAND.voice.map((v) => <Badge key={v}>{v}</Badge>)}</div></div>
        <div><div className="mb-1 font-semibold text-ink">Non-negotiables</div><ul className="space-y-0.5 text-ink-2"><li>Emoji budget: {BRAND.emojiBudget}</li><li>Hashtags: {BRAND.hashtags.min}–{BRAND.hashtags.max}, every platform</li><li>Every number cites a source</li></ul></div>
        <div><div className="mb-1 font-semibold text-ink">Structure</div><div className="text-ink-2 leading-relaxed">{BRAND.captionStructure.join(' → ')}</div></div>
        <div><div className="mb-1 font-semibold text-ink">Visual identity</div><div className="flex items-center gap-2 text-ink-2"><span className="flex">{BRAND.visual.family.map((c) => <span key={c} className="h-4 w-4 rounded-sm" style={{ background: c }} />)}</span>{BRAND.visual.accent}</div><div className="text-ink-2">{BRAND.visual.displayFont} · {BRAND.visual.bodyFont}</div></div>
      </div>
    </div></div>
  )
}

export function KnowledgeBase({ embedded = false }: { embedded?: boolean }) {
  const { knowledge, build, building, toggleKnowledge, addKnowledge, buildKnowledge, nextBuild } = useStore(useShallow((s) => ({ knowledge: s.knowledge, build: s.knowledgeBuild, building: s.building, toggleKnowledge: s.toggleKnowledge, addKnowledge: s.addKnowledge, buildKnowledge: s.buildKnowledge, nextBuild: s.nextKnowledgeBuild })))
  const [q, setQ] = useState(''); const [cat, setCat] = useState('All'); const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', category: 'Topic', content: '' })
  const list = useMemo(() => knowledge.filter((k) => (cat === 'All' || k.category === cat) && (!q || `${k.title} ${k.content} ${k.hashtagTag ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [knowledge, cat, q])
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c, c === 'All' ? knowledge.length : knowledge.filter((k) => k.category === c).length])), [knowledge])
  const actions = <><Btn variant="ghost" icon={building ? <Spinner /> : <RefreshCw size={14} />} disabled={building} onClick={() => buildKnowledge()}>Rebuild now</Btn><Btn variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>Add Entry</Btn></>
  return (
    <div>
      {embedded ? <div className="mb-4 flex justify-end gap-2">{actions}</div> : <PageHeader title="Knowledge Base" subtitle="Everything the platform has learned. Every agent reads from this before it acts; every outcome is written back." agents={['knowledge', 'learning', 'review']} actions={actions} />}
      {!build && <div className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm anim-fade-up"><Brain size={16} className="text-accent" /><span>No Knowledge Base build yet · next scheduled build <b>Sunday 06:00</b> ({timeUntil(nextBuild)}) · Rebuild now runs it immediately through Parallel Web Systems.</span></div>}
      {build && <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm anim-fade-up ${build.status === 'failed' ? 'border-critical/40 bg-critical/10' : 'border-line bg-surface'}`}><Brain size={16} className="text-accent" /><span>Last built <b>{timeAgo(build.finishedAt ?? build.startedAt)}</b> from <b>{build.hashtagsResearched}</b> hashtags · <b>{build.entriesWritten}</b> entries · <b>{build.sourcesCited}</b> sources cited · next build <b>Sunday 06:00</b> ({timeUntil(nextBuild)})</span>{build.status === 'failed' && <Badge tone="critical">{build.error ?? 'Build failed'}</Badge>}{build.fallbackReason && build.status !== 'failed' && <Badge tone="warn">{build.fallbackReason}</Badge>}</div>}
      <BrandIdentityCard />
      <div className="mt-4 flex flex-wrap items-center gap-2"><label className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" /><input placeholder="Search entries…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64 pl-8" /></label><div className="flex flex-wrap gap-1">{CATEGORIES.map((c) => <button key={c} type="button" onClick={() => setCat(c)} className={`rounded-full border px-2.5 py-1 text-[11px] ${cat === c ? 'border-accent bg-accent/15 text-accent-bright' : 'border-line bg-surface-2 text-ink-2 hover:text-ink'}`}>{c} <span className="tabular text-ink-3">{counts[c]}</span></button>)}</div></div>
      {list.length === 0 ? <div className="mt-4"><EmptyState title="No entries match" body="Try another category or clear the search." /></div> : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 stagger-fade">
          {list.map((k, i) => (
            <div key={k.id} className={`card card-hover p-4 transition-opacity ${k.active ? '' : 'opacity-50'}`} style={{ ['--i' as string]: Math.min(i, 20) }}>
              <div className="flex items-start justify-between gap-2"><div className="flex flex-wrap items-center gap-1.5"><Badge tone={k.origin === 'brand' ? 'magenta' : k.origin === 'research' ? 'accent' : k.category === 'Rejected Post' ? 'critical' : 'neutral'}>{k.category}</Badge>{k.origin === 'brand' && <span title="Part of the brand definition — read before every caption and creative" className="text-magenta-ink"><Pin size={13} /></span>}</div><button type="button" onClick={() => toggleKnowledge(k.id)} title={k.active ? 'Switch off' : 'Switch on'} className={`grid h-7 w-7 place-items-center rounded-full border ${k.active ? 'border-good/40 bg-good/15 text-good-ink' : 'border-line bg-surface-2 text-ink-3'}`}><Power size={13} /></button></div>
              <div className="mt-2 text-sm font-semibold leading-snug">{k.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{k.content}</p>
              {k.sources.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{k.sources.slice(0, 4).map((s) => { const host = s.domain ?? (() => { try { return new URL(s.url).hostname.replace(/^www\./, '') } catch { return s.url } })(); return <a key={s.url} href={s.url} target="_blank" rel="noreferrer" title={s.title} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] text-ink-2 hover:text-ink"><img src={`https://www.google.com/s2/favicons?domain=${host}&sz=16`} alt="" width={11} height={11} className="rounded-sm" />{host}<ExternalLink size={9} /></a> })}</div>}
              {k.hashtagTag && <div className="mt-2"><Badge tone="accent">#{k.hashtagTag}</Badge></div>}
              <div className="mt-3 flex items-center justify-between text-[10px] text-ink-3"><span className="truncate">{k.source}</span><span>Confidence: <b className={k.confidence === 'High' ? 'text-good-ink' : k.confidence === 'Low' ? 'text-warn' : 'text-ink-2'}>{k.confidence}</b> · {fmtDate(k.createdAt)}</span></div>
            </div>
          ))}
        </div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add Knowledge Base entry" footer={<div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setAdding(false)}>Cancel</Btn><Btn variant="primary" disabled={form.title.trim().length < 3 || form.content.trim().length < 3} onClick={() => { void addKnowledge(form); setAdding(false); setForm({ title: '', category: 'Topic', content: '' }) }}>Save entry</Btn></div>}>
        <div className="space-y-3"><label className="block text-xs text-ink-2">Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 w-full" /></label><label className="block text-xs text-ink-2">Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full">{CATEGORIES.slice(1).map((c) => <option key={c}>{c}</option>)}</select></label><label className="block text-xs text-ink-2">Content<textarea rows={5} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="mt-1 w-full" /></label></div>
      </Modal>
    </div>
  )
}
