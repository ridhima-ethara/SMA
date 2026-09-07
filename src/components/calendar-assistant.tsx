import { Bot, ChevronRight, Send, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { parseCalendarCommand } from '../lib/ai'
import { useStore } from '../store'
import type { ChatMessage, Idea } from '../types'
import { Btn, PLATFORM_LABEL, Spinner, fmtDate } from './ui'

const CHIPS = ['Regenerate the calendar', 'Reshuffle the suggestions in', 'Spread the week evenly', 'What is on the calendar?']
const HELP = 'I can: **regenerate** the calendar (runs the Scraping Agent again so new ideas are generated and suggested) · **reshuffle** (the suggested ideas take the slots and the current posts move to More suggestions) · **spread the week evenly** · **move "<title>" to Thursday** · **move everything on Friday to Monday** · **promote / demote / remove "<title>"** · **switch "<title>" to Instagram** · **approve "<title>"** · **open "<title>"**. Ideas already with Leadership, approved or scheduled keep their slot.'

function Bubble({ m }: { m: ChatMessage }) {
  const parts = m.text.split(/(\*\*[^*]+\*\*)/g)
  return <div className={`flex ${m.role === 'user' ? 'justify-end' : 'gap-2'}`}>{m.role === 'assistant' && <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/20 text-accent"><Bot size={12} /></span>}<div className={`max-w-[92%] rounded-xl px-3 py-2 text-xs leading-relaxed anim-pop-in ${m.role === 'user' ? 'bg-accent/20 text-ink' : 'bg-surface-2 text-ink-2'}`}>{parts.map((p, i) => (p.startsWith('**') ? <b key={i} className="text-ink">{p.slice(2, -2)}</b> : <span key={i}>{p}</span>))}</div></div>
}

export function CalendarAssistant({ weekStart, weekDays }: { weekStart: string; weekDays: string[] }) {
  const s = useStore(useShallow((st) => ({ ideas: st.ideas, apiMode: st.apiMode, runScraping: st.runScraping, reshuffleCalendar: st.reshuffleCalendar, spreadCalendar: st.spreadCalendar, moveIdea: st.moveIdea, promoteIdea: st.promoteIdea, demoteIdea: st.demoteIdea, deleteIdea: st.deleteIdea, approveIdea: st.approveIdea, openReview: st.openReview, setIdeaPlatform: st.setIdeaPlatform, running: st.scrapeRun.running, top: st.settings.topPerPlatform })))
  const [open, setOpen] = useState(true); const [chat, setChat] = useState<ChatMessage[]>([]); const [input, setInput] = useState(''); const [busy, setBusy] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [chat.length, busy])
  const say = (role: ChatMessage['role'], text: string) => setChat((c) => [...c, { id: Date.now() + Math.random(), role, text, at: new Date().toISOString() }])
  const live = (i: Idea) => i.status !== 'published' && i.status !== 'rejected'
  const status = () => {
    const ideas = s.ideas.filter(live); const week = ideas.filter((i) => i.calendarSlot === 'primary' && weekDays.includes(i.date))
    const per = (['linkedin', 'instagram', 'x'] as const).map((p) => `${PLATFORM_LABEL[p]} ${ideas.filter((i) => i.platform === p && i.calendarSlot === 'primary').length}/${s.top}`).join(' · ')
    return `${week.length} post(s) on this week's calendar (${per} overall) and ${ideas.filter((i) => i.calendarSlot === 'suggestion').length} in More suggestions. ${ideas.filter((i) => i.status === 'pending_leadership').length} waiting on Leadership.`
  }
  const run = async (text: string) => {
    if (!text.trim() || busy) return
    say('user', text); setInput('')
    const pool = s.ideas.filter(live).map((i) => ({ id: i.id, title: i.title, date: i.date }))
    const intent = parseCalendarCommand(text, pool, weekStart)
    try {
      switch (intent.kind) {
        case 'help': say('assistant', HELP); break
        case 'status': say('assistant', status()); break
        case 'regenerate': {
          setBusy('Running the Scraping Agent — scraping, validating and planning…')
          const before = new Set(s.ideas.map((i) => i.id))
          const r = await s.runScraping()
          setBusy(null)
          if (!r) say('assistant', 'The run could not start. Check the Agent Activity screen for the reason.')
          else if (r.status === 'failed') say('assistant', `The pipeline stopped: ${r.error ?? 'unknown error'}`)
          else { const fresh = useStore.getState().ideas.filter((i) => !before.has(i.id)); say('assistant', `Regenerated: ${r.summary.postsScraped} posts scraped, ${r.trendingKeywords.length} trending keywords, **${fresh.length} new idea(s)** — ${fresh.filter((i) => i.calendarSlot === 'primary').length} took a calendar slot and ${fresh.filter((i) => i.calendarSlot === 'suggestion').length} went to More suggestions. Say **reshuffle** to bring the suggestions onto the calendar.`) }
          break
        }
        case 'reshuffle': {
          setBusy('Reshuffling — suggestions are taking the slots…')
          const r = await s.reshuffleCalendar(weekStart)
          setBusy(null)
          say('assistant', r.promoted.length ? `Reshuffled. On the calendar now: ${r.promoted.map((p) => `"${p.title}"`).join(', ')}. Moved to More suggestions: ${r.demoted.map((p) => `"${p.title}"`).join(', ')}. Dates were re-spread across the week; posts with Leadership or already approved kept their slot.` : 'Nothing to reshuffle — there are no suggestions waiting. Say **regenerate** to scrape for new ideas first.')
          break
        }
        case 'spread': { setBusy('Spreading the week…'); const n = await s.spreadCalendar(weekStart); setBusy(null); say('assistant', n ? `Spread ${n} post(s) evenly across ${fmtDate(weekDays[0])} – ${fmtDate(weekDays[4])}.` : 'Nothing movable on the calendar to spread.'); break }
        case 'move': { await s.moveIdea(intent.ideaId, intent.date); say('assistant', `Moved "${intent.title}" to ${intent.label} (${fmtDate(intent.date, { weekday: 'long', month: 'short', day: 'numeric' })}).`); break }
        case 'move-day': { const ids = s.ideas.filter((i) => live(i) && i.date === intent.fromDate); for (const i of ids) await s.moveIdea(i.id, intent.toDate); say('assistant', ids.length ? `Moved ${ids.length} post(s) from ${intent.fromLabel} to ${intent.toLabel}.` : `Nothing is scheduled on ${intent.fromLabel}.`); break }
        case 'promote': await s.promoteIdea(intent.ideaId); say('assistant', `Promoted "${intent.title}" to the calendar.`); break
        case 'demote': await s.demoteIdea(intent.ideaId); say('assistant', `Moved "${intent.title}" to More suggestions.`); break
        case 'remove': await s.deleteIdea(intent.ideaId); say('assistant', `Removed "${intent.title}" from the calendar (kept as rejected — nothing is deleted).`); break
        case 'approve': await s.approveIdea(intent.ideaId); say('assistant', `Approved "${intent.title}" and sent it to Leadership.`); break
        case 'open': s.openReview(intent.ideaId); say('assistant', `Opening "${intent.title}".`); break
        case 'platform': { setBusy(`Re-drafting for ${PLATFORM_LABEL[intent.platform]}…`); await s.setIdeaPlatform(intent.ideaId, intent.platform); setBusy(null); say('assistant', `"${intent.title}" is now a ${PLATFORM_LABEL[intent.platform]} post — the caption and creative were regenerated for it.`); break }
        default: say('assistant', `I did not catch that. ${HELP}`)
      }
    } catch (e) { setBusy(null); say('assistant', `That failed: ${e instanceof Error ? e.message : String(e)}`) }
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="card card-hover fixed bottom-5 right-5 z-30 flex items-center gap-2 px-3 py-2 text-sm"><span className="relative grid h-7 w-7 place-items-center rounded-full bg-accent/20 text-accent"><span className="absolute inset-0 rounded-full border border-accent anim-ping-slow" /><Bot size={14} /></span>Calendar Assistant</button>
  return (
    <aside className="card flex h-full min-h-0 flex-col anim-slide-in">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5"><span className="relative grid h-7 w-7 place-items-center rounded-full bg-accent/20 text-accent"><span className="absolute inset-0 rounded-full border border-accent anim-ping-slow" /><Bot size={14} /></span><div className="min-w-0 flex-1"><div className="text-sm font-semibold">Calendar Assistant</div><div className="truncate text-[10px] text-ink-3">Calendar &amp; Ideas Agent · {s.apiMode === 'live' ? 'connected to the runtime' : 'runtime offline — regenerate needs the API'}</div></div><button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Collapse"><ChevronRight size={14} /></button></div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {chat.length === 0 && <div className="space-y-2"><p className="text-xs text-ink-2">Ask me to change this calendar. I can regenerate it (a fresh scrape brings new ideas), reshuffle the suggestions in, or move, promote, demote and re-platform individual posts.</p><div className="flex flex-wrap gap-1.5">{CHIPS.map((c) => <button key={c} type="button" onClick={() => run(c)} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink"><Sparkles size={10} className="text-magenta-ink" />{c}</button>)}</div></div>}
        {chat.map((m) => <Bubble key={m.id} m={m} />)}
        {busy && <div className="flex items-center gap-2 text-[11px] text-ink-3"><Spinner />{busy}</div>}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void run(input) }} className="flex gap-1.5 border-t border-line p-2"><input value={input} onChange={(e) => setInput(e.target.value)} placeholder='e.g. move "GRPO" to Thursday' className="flex-1 text-xs" disabled={busy !== null || s.running} /><Btn size="sm" variant="primary" type="submit" disabled={!input.trim() || busy !== null || s.running} aria-label="Send"><Send size={13} /></Btn></form>
    </aside>
  )
}
