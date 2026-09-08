import { ArrowDownToLine, ArrowUpToLine, CalendarClock, Check, ChevronLeft, ChevronRight, Copy, Image as ImageIcon, Sparkles, Trash2, Type } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { PageHeader } from '../components/layout'
import { Badge, Btn, EmptyState, IDEA_STATUS_META, PLATFORM_LABEL, PlatformIcon, Spinner, fmtDate } from '../components/ui'
import { useStore } from '../store'
import type { Idea, Platform, ScheduleSlot } from '../types'
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

/**
 * A planned day from the Calendar Agent: the hashtag its content will be built from and
 * how many captions and images are expected. Nothing is generated yet, so this card shows
 * intent and progress rather than a preview.
 */
function SlotCard({ slot }: { slot: ScheduleSlot }) {
  const done = slot.captionsGenerated >= slot.captionsPlanned && slot.imagesGenerated >= slot.imagesPlanned
  return (
    <div className="card overflow-hidden border-accent/30" title={slot.rationale}>
      <div className="flex items-center gap-1.5 border-b border-line bg-accent/5 px-2.5 py-1.5">
        <CalendarClock size={11} className="shrink-0 text-accent" />
        <span className="tabular truncate text-[10px] text-ink-2">{slot.scheduledTime}</span>
        <span className="tabular ml-auto shrink-0 text-[9px] text-ink-3">rank {slot.hashtagRank}</span>
      </div>
      <div className="p-2.5">
        <div className="truncate text-xs font-semibold text-magenta-ink" title={`#${slot.displayHashtag}`}>#{slot.displayHashtag}</div>
        {slot.keywordTerm && <div className="mt-0.5 truncate text-[10px] text-ink-3">from “{slot.keywordTerm}”</div>}
        <div className="mt-2 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-ink-2"><Type size={10} className="shrink-0 text-ink-3" /><span>Captions</span><span className="tabular ml-auto">{slot.captionsGenerated} / {slot.captionsPlanned}</span></div>
          <div className="flex items-center gap-1.5 text-[10px] text-ink-2"><ImageIcon size={10} className="shrink-0 text-ink-3" /><span>Images</span><span className="tabular ml-auto">{slot.imagesGenerated} / {slot.imagesPlanned}</span></div>
        </div>
        <div className="mt-2 flex items-center gap-1">
          <PlatformIcon platform={slot.platform} size={11} />
          <span className="truncate text-[10px] text-ink-3">{PLATFORM_LABEL[slot.platform]}</span>
          <Badge tone={done ? 'good' : slot.status === 'planned' ? 'warn' : 'neutral'} className="ml-auto">{done ? 'ready' : slot.status}</Badge>
        </div>
      </div>
    </div>
  )
}

export function CalendarPage() {
  const s = useStore(useShallow((st) => ({
    ideas: st.ideas, openReview: st.openReview, moveIdea: st.moveIdea, approveIdea: st.approveIdea,
    duplicateIdea: st.duplicateIdea, demoteIdea: st.demoteIdea, promoteIdea: st.promoteIdea, deleteIdea: st.deleteIdea,
    top: st.settings.topPerPlatform, apiMode: st.apiMode,
    schedule: st.weekSchedule, loading: st.scheduleLoading, planning: st.schedulePlanning, generating: st.scheduleGenerating,
    loadSchedule: st.loadSchedule, planSchedule: st.planSchedule, generateContent: st.generateScheduleContent,
  })))
  const [offset, setOffset] = useState(0); const [expanded, setExpanded] = useState<Record<string, boolean>>({}); const [flying, setFlying] = useState<string | null>(null)
  const [hashtags, setHashtags] = useState(5); const [captions, setCaptions] = useState(1); const [images, setImages] = useState(1)
  const [landed, setLanded] = useState(false)
  const thisMonday = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d }, [])
  const monday = useMemo(() => { const d = new Date(thisMonday); d.setDate(d.getDate() + offset * 7); return d }, [thisMonday, offset])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d }), [monday])
  const today = iso(new Date())
  const weekStart = iso(monday)

  // First load asks the backend for its most recent plan and jumps the grid to that week, so a
  // schedule built for a future week is visible instead of hiding behind the week arrows.
  useEffect(() => { setLanded(false) }, [s.apiMode])
  useEffect(() => {
    if (landed) return
    let cancelled = false
    void (async () => {
      await s.loadSchedule()
      if (cancelled) return
      const latest = useStore.getState().weekSchedule
      if (latest) {
        const t = new Date(`${latest.weekStart}T00:00:00`)
        setOffset(Math.round((t.getTime() - thisMonday.getTime()) / 604800000))
      }
      setLanded(true)
    })()
    return () => { cancelled = true }
  }, [landed, thisMonday])
  // Afterwards every week change refetches from the API; nothing is cached client-side.
  useEffect(() => {
    if (!landed || s.schedule?.weekStart === weekStart) return
    void s.loadSchedule(weekStart)
  }, [weekStart, landed])
  useEffect(() => {
    if (!s.schedule || s.schedule.weekStart !== weekStart) return
    setHashtags(s.schedule.hashtagCount); setCaptions(s.schedule.captionsPerDay); setImages(s.schedule.imagesPerDay)
  }, [s.schedule?.id, s.schedule?.weekStart, weekStart])

  const plan = s.schedule && s.schedule.weekStart === weekStart ? s.schedule : null
  const slotFor = (key: string) => plan?.slots.find((x) => x.slotDate === key)

  // Once a week is planned the plan owns the grid: a day shows its slot, and once the Caption Agent has
  // run against that slot it shows the resulting idea instead — the same card as everywhere else, so
  // clicking it opens the normal review drawer with the caption, creative and model controls. Ideas left
  // over from earlier runs are never mixed in; the grid only renders what a slot points at.
  const ideaById = useMemo(() => new Map(s.ideas.map((i) => [i.id, i])), [s.ideas])
  const ideaForSlot = (slot: ScheduleSlot | undefined): Idea | undefined => (slot?.ideaId ? ideaById.get(slot.ideaId) : undefined)

  const live = plan ? [] : s.ideas.filter((i) => i.status !== 'rejected')
  const primary = live.filter((i) => i.calendarSlot === 'primary' || i.status === 'published')
  const suggestions = live.filter((i) => i.calendarSlot === 'suggestion' && i.status !== 'published').sort((a, b) => (a.platformRank ?? 99) - (b.platformRank ?? 99))
  const promote = (id: string) => { setFlying(id); void s.promoteIdea(id); setTimeout(() => setFlying(null), 600) }

  const captionsDone = plan ? plan.slots.reduce((n, x) => n + x.captionsGenerated, 0) : 0
  const captionsWanted = plan ? plan.slots.reduce((n, x) => n + x.captionsPlanned, 0) : 0
  const imagesDone = plan ? plan.slots.reduce((n, x) => n + x.imagesGenerated, 0) : 0
  const imagesWanted = plan ? plan.slots.reduce((n, x) => n + x.imagesPlanned, 0) : 0
  const outstanding = Math.max(0, captionsWanted - captionsDone) + Math.max(0, imagesWanted - imagesDone)

  const num = (label: string, value: number, set: (v: number) => void, min: number, max: number) => (
    <label className="flex items-center gap-1.5 text-[11px] text-ink-3">{label}
      <input type="number" min={min} max={max} value={value} onChange={(e) => set(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        className="tabular w-14 rounded border border-line bg-surface px-1.5 py-1 text-xs text-ink" />
    </label>
  )

  return (
    <div>
      <PageHeader title="Weekly Calendar" subtitle="One hashtag per day from the Analysis Agent's top set. Captions and images are planned here, then generated later." agents={['calendar', 'caption', 'image', 'review']}
        actions={<><div className="flex items-center gap-1"><Btn size="sm" variant="ghost" onClick={() => setOffset((o) => o - 1)} aria-label="Previous week"><ChevronLeft size={14} /></Btn><span className="tabular px-2 text-sm">{fmtDate(iso(days[0]))} – {fmtDate(iso(days[6]), { month: 'short', day: 'numeric', year: 'numeric' })}</span><Btn size="sm" variant="ghost" onClick={() => setOffset((o) => o + 1)} aria-label="Next week"><ChevronRight size={14} /></Btn><Btn size="sm" variant="ghost" onClick={() => setOffset(0)}>Today</Btn></div></>} />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/50 p-2.5">
        {num('Hashtags', hashtags, setHashtags, 1, 31)}{num('Captions/day', captions, setCaptions, 0, 10)}{num('Images/day', images, setImages, 0, 10)}
        <Btn size="sm" variant="primary" disabled={s.planning} icon={s.planning ? <Spinner size={12} /> : <CalendarClock size={13} />}
          onClick={() => void s.planSchedule({ weekStart, hashtagCount: hashtags, captionsPerDay: captions, imagesPerDay: images, replace: true })}>
          {s.planning ? 'Planning…' : plan ? 'Re-plan week' : 'Plan this week'}
        </Btn>
        {plan && (
          <Btn size="sm" variant={outstanding === 0 ? 'subtle' : 'primary'} disabled={s.generating || captionsWanted + imagesWanted === 0}
            icon={s.generating ? <Spinner size={12} /> : <Sparkles size={13} />}
            onClick={() => void s.generateContent({ weekStart, regenerate: outstanding === 0 })}>
            {s.generating ? 'Generating…' : outstanding === 0 ? 'Regenerate week' : `Generate ${outstanding} item${outstanding === 1 ? '' : 's'}`}
          </Btn>
        )}
        {plan && <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
          <Badge tone="accent">{plan.days} days</Badge><Badge>{plan.hashtagCount} hashtags</Badge>
          <Badge tone={captionsWanted > 0 && captionsDone >= captionsWanted ? 'good' : 'warn'}><Type size={10} />{captionsDone}/{captionsWanted}</Badge>
          <Badge tone={imagesWanted > 0 && imagesDone >= imagesWanted ? 'good' : 'warn'}><ImageIcon size={10} />{imagesDone}/{imagesWanted}</Badge>
          <span>from {plan.hashtagSourceRef ?? plan.hashtagSource}</span>
        </div>}
      </div>

      {landed && !plan && !s.loading && (
        <EmptyState title="This week is not planned yet"
          body={s.apiMode === 'live' ? 'Plan the week to assign one top hashtag to each day, with the captions and images you want against it.' : 'The agent runtime is not reachable, so there is nothing to show. Start the API so the calendar can load from the backend.'} />
      )}

      {(plan || s.loading || !landed) && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {days.map((d) => {
            const key = iso(d); const slot = slotFor(key); const scheduled = ideaForSlot(slot)
            const mine = primary.filter((i) => i.date === key).sort((a, b) => a.time.localeCompare(b.time))
            const isToday = key === today
            return (
              <div key={key} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData('text/idea'); if (id) void s.moveIdea(id, key) }}
                className={`min-h-[240px] rounded-xl border p-2 transition-colors ${isToday ? 'border-accent/50 bg-accent/5' : 'border-line bg-surface/50'}`}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <span className={`text-xs font-semibold ${isToday ? 'text-accent' : ''}`}>{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                  <span className={`tabular text-[11px] ${isToday ? 'text-accent' : 'text-ink-3'}`}>{d.getDate()}</span>
                </div>
                <div className="space-y-2">
                  {slot && scheduled && (
                    <>
                      <div className="flex items-center gap-1 px-0.5 text-[10px] text-ink-3">
                        <CalendarClock size={10} className="shrink-0 text-accent" />
                        <span className="truncate text-magenta-ink">#{slot.displayHashtag}</span>
                        <span className="tabular ml-auto shrink-0">{slot.scheduledTime}</span>
                      </div>
                      <IdeaCard idea={scheduled} flying={flying === scheduled.id} onOpen={() => s.openReview(scheduled.id)} onApprove={() => s.approveIdea(scheduled.id)} onDuplicate={() => s.duplicateIdea(scheduled.id)} onDemote={() => s.demoteIdea(scheduled.id)} onDelete={() => s.deleteIdea(scheduled.id)} />
                    </>
                  )}
                  {slot && !scheduled && <SlotCard slot={slot} />}
                  {mine.map((i) => <IdeaCard key={i.id} idea={i} flying={flying === i.id} onOpen={() => s.openReview(i.id)} onApprove={() => s.approveIdea(i.id)} onDuplicate={() => s.duplicateIdea(i.id)} onDemote={() => s.demoteIdea(i.id)} onDelete={() => s.deleteIdea(i.id)} />)}
                  {!slot && mine.length === 0 && <div className="grid h-24 place-items-center rounded-lg border border-dashed border-line text-[11px] text-ink-3">{s.loading || !landed ? 'Loading…' : 'No plan for this day'}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {plan && plan.hashtagCoverage.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">{plan.hashtagCoverage.map((c) => (
          <span key={c.displayHashtag} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-ink-2">
            <span className="font-medium">#{c.displayHashtag}</span> <span className="text-ink-3">rank {c.rank} · {c.days.length} day{c.days.length === 1 ? '' : 's'}</span>
          </span>
        ))}</div>
      )}

      {suggestions.length > 0 && (
        <section className="mt-8 anim-fade-up"><h2 className="display text-xl">More suggestions</h2><p className="text-sm text-ink-3">Ranked {s.top + 1} and below. The agents placed these but kept them off the calendar — promote any of them to take a slot.</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">{PLATFORMS.map((p) => { const mine = suggestions.filter((i) => i.platform === p); const show = expanded[p] ? mine : mine.slice(0, 6); return (
            <div key={p} className="card p-3"><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><PlatformIcon platform={p} size={14} />{PLATFORM_LABEL[p]}<span className="tabular text-xs text-ink-3">· {mine.length}</span></div>
              {mine.length === 0 && <div className="py-4 text-center text-xs text-ink-3">Every {PLATFORM_LABEL[p]} idea is on the calendar.</div>}
              <div className="space-y-2">{show.map((i) => <div key={i.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2"><span className="tabular grid h-6 w-8 shrink-0 place-items-center rounded bg-surface-3 text-[10px] font-semibold">#{i.platformRank}</span>{i.media[i.platform] ? <img src={i.media[i.platform]?.dataUri} alt="" className="h-9 w-14 shrink-0 rounded object-cover" /> : <div className="h-9 w-14 shrink-0 rounded bg-gradient-to-br from-accent/40 to-magenta/30" />}<button type="button" onClick={() => s.openReview(i.id)} className="min-w-0 flex-1 text-left"><div className="truncate text-xs font-medium">{i.title}</div><div className="text-[10px] text-ink-3">{fmtDate(i.date)} · {i.time} · <span className="tabular">{i.confidence}%</span></div></button><Btn size="sm" variant="primary" icon={<ArrowUpToLine size={12} />} onClick={() => promote(i.id)}>Promote</Btn></div>)}</div>
              {mine.length > 6 && <button type="button" onClick={() => setExpanded((e) => ({ ...e, [p]: !e[p] }))} className="mt-2 w-full text-center text-xs text-accent">{expanded[p] ? 'Show fewer' : `Show all ${mine.length}`}</button>}
            </div>
          ) })}</div>
        </section>
      )}
    </div>
  )
}
