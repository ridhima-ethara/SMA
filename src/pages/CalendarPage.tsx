import { ArrowDownToLine, ArrowUpToLine, Check, ChevronLeft, ChevronRight, Copy, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CalendarAssistant } from '../components/calendar-assistant'
import { PageHeader } from '../components/layout'
import { Badge, Btn, EmptyState, IDEA_STATUS_META, PLATFORM_LABEL, PlatformIcon, fmtDate } from '../components/ui'
import { useStore } from '../store'
import type { Idea, Platform } from '../types'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const PLATFORMS: Platform[] = ['linkedin', 'instagram', 'x']

function IdeaCard({ idea, onOpen, onApprove, onDuplicate, onDemote, onDelete, flying }: { idea: Idea; onOpen: () => void; onApprove: () => void; onDuplicate: () => void; onDemote: () => void; onDelete: () => void; flying?: boolean }) {
  const m = idea.media[idea.platform]; const st = IDEA_STATUS_META[idea.status]
  return (
    <div draggable onDragStart={(e) => e.dataTransfer.setData('text/idea', idea.id)} onClick={onOpen} className={`group card card-hover cursor-pointer overflow-hidden ${flying ? 'anim-pop-in' : ''}`}>
      <div className="relative overflow-hidden" style={{ aspectRatio: '1.91 / 1' }}>{m ? <img src={m.dataUri} alt={m.altText ?? ''} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /> : <div className="h-full w-full bg-gradient-to-br from-accent/40 via-surface-3 to-magenta/30" />}<span className="absolute left-1.5 top-1.5 rounded-full bg-page/70 px-1.5 text-[9px] text-ink-2 backdrop-blur">{m?.model ?? 'not rendered'}</span>{idea.isNewTrend && <span className="absolute right-1.5 top-1.5 rounded-full bg-magenta/80 px-1.5 text-[8px] font-semibold uppercase tracking-wide text-white">New trend</span>}</div>
      <div className="p-2.5">
        <div className="text-xs font-semibold leading-snug line-clamp-2">{idea.title}</div>
        <p className="mt-1 text-[11px] text-ink-3 line-clamp-2">{idea.description}</p>
        <div className="mt-1.5 flex flex-wrap gap-1 text-[9px] text-ink-3">{idea.drafts[idea.platform] && <span className="rounded bg-surface-3 px-1">Caption</span>}{m && <span className="rounded bg-surface-3 px-1">Image</span>}</div>
        <div className="mt-1.5 flex items-center gap-1 whitespace-nowrap text-[10px] text-ink-2"><PlatformIcon platform={idea.platform} size={11} /><span className="truncate">{PLATFORM_LABEL[idea.platform]} · {idea.time}</span><span className="tabular ml-auto shrink-0">{idea.confidence}%</span></div>
        <div className="mt-1"><Badge tone={st.tone}>{st.label}</Badge></div>
        <div className="mt-2 hidden gap-1 group-hover:flex" onClick={(e) => e.stopPropagation()}>{['suggested', 'drafted', 'in_review'].includes(idea.status) && <button type="button" onClick={onApprove} title="Approve" className="rounded bg-good/20 p-1 text-good-ink"><Check size={12} /></button>}<button type="button" onClick={onDuplicate} title="Duplicate" className="rounded bg-surface-3 p-1 text-ink-2"><Copy size={12} /></button><button type="button" onClick={onDemote} title="Demote to suggestions" className="rounded bg-surface-3 p-1 text-ink-2"><ArrowDownToLine size={12} /></button><button type="button" onClick={onDelete} title="Delete" className="rounded bg-critical/20 p-1 text-critical-ink"><Trash2 size={12} /></button></div>
      </div>
    </div>
  )
}

export function CalendarPage() {
  const s = useStore(useShallow((st) => ({ ideas: st.ideas, openReview: st.openReview, moveIdea: st.moveIdea, approveIdea: st.approveIdea, duplicateIdea: st.duplicateIdea, demoteIdea: st.demoteIdea, promoteIdea: st.promoteIdea, deleteIdea: st.deleteIdea, openTheater: st.openTheater, top: st.settings.topPerPlatform })))
  const [offset, setOffset] = useState(0); const [expanded, setExpanded] = useState<Record<string, boolean>>({}); const [flying, setFlying] = useState<string | null>(null)
  const monday = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7); return d }, [offset])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d }), [monday])
  const today = iso(new Date())
  const live = s.ideas.filter((i) => i.status !== 'rejected')
  const primary = live.filter((i) => i.calendarSlot === 'primary' || i.status === 'published')
  const suggestions = live.filter((i) => i.calendarSlot === 'suggestion' && i.status !== 'published').sort((a, b) => (a.platformRank ?? 99) - (b.platformRank ?? 99))
  const counts = PLATFORMS.map((p) => ({ p, n: live.filter((i) => i.platform === p && i.calendarSlot === 'primary' && i.status !== 'published').length }))
  const weekHas = primary.some((i) => days.some((d) => iso(d) === i.date))
  const promote = (id: string) => { setFlying(id); void s.promoteIdea(id); setTimeout(() => setFlying(null), 600) }
  return (
    <div>
      <PageHeader title="Weekly Calendar" subtitle="The top ten per platform take a slot. Everything else waits in More suggestions until you promote it." agents={['calendar', 'caption', 'image', 'review']} actions={<><div className="flex items-center gap-1"><Btn size="sm" variant="ghost" onClick={() => setOffset((o) => o - 1)} aria-label="Previous week"><ChevronLeft size={14} /></Btn><span className="tabular px-2 text-sm">{fmtDate(iso(days[0]))} – {fmtDate(iso(days[6]), { month: 'short', day: 'numeric', year: 'numeric' })}</span><Btn size="sm" variant="ghost" onClick={() => setOffset((o) => o + 1)} aria-label="Next week"><ChevronRight size={14} /></Btn><Btn size="sm" variant="ghost" onClick={() => setOffset(0)}>Today</Btn></div><div className="tabular rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-2">{counts.map((c) => `${PLATFORM_LABEL[c.p]} ${c.n}/${s.top}`).join(' · ')} on the calendar · {suggestions.length} in suggestions</div></>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]"><div className="min-w-0">
      {!weekHas ? <EmptyState title="No scheduled content this week" body="Move to another week, run the Scraping Agent, or ask the assistant to regenerate the calendar." action={<Btn variant="primary" onClick={s.openTheater}>Run Scraping</Btn>} /> : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {days.map((d) => { const key = iso(d); const mine = primary.filter((i) => i.date === key).sort((a, b) => a.time.localeCompare(b.time)); const isToday = key === today; return (
            <div key={key} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData('text/idea'); if (id) void s.moveIdea(id, key) }} className={`min-h-[240px] rounded-xl border p-2 transition-colors ${isToday ? 'border-accent/50 bg-accent/5' : 'border-line bg-surface/50'}`}>
              <div className="mb-2 flex items-baseline justify-between px-1"><span className={`text-xs font-semibold ${isToday ? 'text-accent' : ''}`}>{d.toLocaleDateString('en-US', { weekday: 'short' })}</span><span className={`tabular text-[11px] ${isToday ? 'text-accent' : 'text-ink-3'}`}>{d.getDate()}</span></div>
              <div className="space-y-2">{mine.map((i) => <IdeaCard key={i.id} idea={i} flying={flying === i.id} onOpen={() => s.openReview(i.id)} onApprove={() => s.approveIdea(i.id)} onDuplicate={() => s.duplicateIdea(i.id)} onDemote={() => s.demoteIdea(i.id)} onDelete={() => s.deleteIdea(i.id)} />)}{mine.length === 0 && <div className="grid h-24 place-items-center rounded-lg border border-dashed border-line text-[11px] text-ink-3">Drop content here</div>}</div>
            </div>
          ) })}
        </div>
      )}
      <section className="mt-8 anim-fade-up"><h2 className="display text-xl">More suggestions</h2><p className="text-sm text-ink-3">Ranked {s.top + 1} and below. The agents placed these but kept them off the calendar — promote any of them to take a slot.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">{PLATFORMS.map((p) => { const mine = suggestions.filter((i) => i.platform === p); const show = expanded[p] ? mine : mine.slice(0, 6); return (
          <div key={p} className="card p-3"><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><PlatformIcon platform={p} size={14} />{PLATFORM_LABEL[p]}<span className="tabular text-xs text-ink-3">· {mine.length}</span></div>
            {mine.length === 0 && <div className="py-4 text-center text-xs text-ink-3">Every {PLATFORM_LABEL[p]} idea is on the calendar.</div>}
            <div className="space-y-2">{show.map((i) => <div key={i.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2"><span className="tabular grid h-6 w-8 shrink-0 place-items-center rounded bg-surface-3 text-[10px] font-semibold">#{i.platformRank}</span>{i.media[i.platform] ? <img src={i.media[i.platform]?.dataUri} alt="" className="h-9 w-14 shrink-0 rounded object-cover" /> : <div className="h-9 w-14 shrink-0 rounded bg-gradient-to-br from-accent/40 to-magenta/30" />}<button type="button" onClick={() => s.openReview(i.id)} className="min-w-0 flex-1 text-left"><div className="truncate text-xs font-medium">{i.title}</div><div className="text-[10px] text-ink-3">{fmtDate(i.date)} · {i.time} · <span className="tabular">{i.confidence}%</span></div></button><Btn size="sm" variant="primary" icon={<ArrowUpToLine size={12} />} onClick={() => promote(i.id)}>Promote</Btn></div>)}</div>
            {mine.length > 6 && <button type="button" onClick={() => setExpanded((e) => ({ ...e, [p]: !e[p] }))} className="mt-2 w-full text-center text-xs text-accent">{expanded[p] ? 'Show fewer' : `Show all ${mine.length}`}</button>}
          </div>
        ) })}</div>
      </section>
      </div><div className="xl:sticky xl:top-0 xl:h-[calc(100vh-7.5rem)]"><CalendarAssistant weekStart={iso(days[0])} weekDays={days.map(iso)} /></div></div>
    </div>
  )
}
