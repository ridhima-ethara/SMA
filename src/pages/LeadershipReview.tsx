import { CheckCircle2, Inbox, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { PageHeader } from '../components/layout'
import { PlatformPreview } from '../components/previews'
import { Badge, Btn, Modal, PLATFORM_LABEL, PlatformChip, Spinner, fmtDate, timeAgo } from '../components/ui'
import { checkCaption } from '../lib/ai'
import { headlineFor } from '../lib/image-gen'
import { useStore } from '../store'

const PHASES = ['Preparing content', 'Validating platform format', 'Uploading media', 'Publishing', 'Published successfully']
const QUICK = ['Tone is too promotional for a research lab', 'Claim needs a citation before we publish', 'Timing conflicts with the product announcement', "Not aligned with this quarter's positioning"]

export function LeadershipReview() {
  const s = useStore(useShallow((st) => ({ ideas: st.ideas, user: st.user, knowledge: st.knowledge, ensureDraft: st.ensureDraft, leadershipApprove: st.leadershipApprove, leadershipReject: st.leadershipReject, publishPhase: st.publishPhase, publishingIdeaId: st.publishingIdeaId })))
  const queue = useMemo(() => s.ideas.filter((i) => i.status === 'pending_leadership').sort((a, b) => (a.marketingApprovedAt ?? '').localeCompare(b.marketingApprovedAt ?? '')), [s.ideas])
  const [selId, setSelId] = useState<string | null>(null); const [rejecting, setRejecting] = useState(false); const [reason, setReason] = useState('')
  const sel = queue.find((i) => i.id === selId) ?? queue[0]
  if (sel && !sel.drafts[sel.platform]) void s.ensureDraft(sel.id, sel.platform)
  const decided = s.ideas.filter((i) => i.leadershipDecision).sort((a, b) => (b.leadershipDecision?.at ?? '').localeCompare(a.leadershipDecision?.at ?? ''))
  const mine = (d: 'approved' | 'rejected') => decided.filter((i) => i.leadershipDecision?.decision === d && i.leadershipDecision.by === s.user?.name).length
  const caption = sel?.drafts[sel.platform]?.body ?? ''; const media = sel?.media[sel.platform]
  const check = sel ? checkCaption(caption, sel.platform, `${sel.sourceTopic} ${sel.title}`, media ? { headline: headlineFor(caption, sel.title), hasAltText: Boolean(media.altText) } : undefined) : null
  const publishing = sel && s.publishingIdeaId === sel.id && s.publishPhase >= 0
  return (
    <div>
      <PageHeader title="Final Approval" subtitle="Everything Marketing has approved lands here. Nothing publishes until you say so." agents={['review', 'publishing', 'knowledge']} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 stagger-fade">{[['Awaiting your decision', queue.length, queue.length > 0 ? 'text-serious' : ''], ['Approved by you', mine('approved'), 'text-good-ink'], ['Rejected by you', mine('rejected'), ''], ['Lessons stored', s.knowledge.filter((k) => k.category === 'Approved Post' || k.category === 'Rejected Post').length, 'text-accent']].map(([l, v, c], i) => <div key={String(l)} className="card p-3" style={{ ['--i' as string]: i }}><div className="text-[10px] uppercase tracking-wide text-ink-3">{l}</div><div className={`tabular display text-2xl ${c}`}>{v}</div></div>)}</div>
      {!sel ? <div className="card grid place-items-center border-good/40 bg-good/5 px-6 py-14 text-center anim-fade-up"><Inbox size={28} className="mb-2 text-good-ink" /><div className="display text-lg">Your queue is clear</div><div className="text-sm text-ink-3">Marketing has not sent anything new for final approval.</div></div> : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <aside className="card self-start p-2">{queue.map((i, n) => <button key={i.id} type="button" onClick={() => setSelId(i.id)} className={`flex w-full gap-2 rounded-lg p-2.5 text-left ${sel.id === i.id ? 'bg-accent/15' : 'hover:bg-surface-2'}`}><span className="tabular grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-3 text-[11px] font-semibold">{n + 1}</span><span className="min-w-0"><span className="block truncate text-sm font-medium">{i.title}</span><span className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-3"><PlatformChip platform={i.platform} />{fmtDate(i.date)} · {i.time}</span><span className="block text-[10px] text-ink-3">Approved by {i.marketingApprovedBy} {timeAgo(i.marketingApprovedAt)}</span></span></button>)}</aside>
          <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
            <div className="space-y-4 anim-fade-up">
              <div className="flex flex-wrap items-center gap-2"><Badge tone="warn" dot>Awaiting final approval</Badge><Badge>{sel.analysis.format}</Badge><Badge tone="accent">AI confidence {sel.confidence}%</Badge>{check && <Badge tone={check.verdict === 'APPROVED' ? 'good' : check.verdict === 'REVISE' ? 'warn' : 'critical'}>Brand voice · {check.verdict}</Badge>}</div>
              {check && check.violations.length > 0 && <ul className="text-[11px] text-ink-3">{check.violations.slice(0, 4).map((v, i) => <li key={i}>Rule {v.rule} · {v.title}: {v.detail}</li>)}</ul>}
              <div><h2 className="display text-2xl">{sel.title}</h2><p className="mt-1 text-sm text-ink-2">{sel.description}</p></div>
              <div><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">How it will appear on {PLATFORM_LABEL[sel.platform]}</div><div className="max-w-xl">{caption ? <PlatformPreview platform={sel.platform} caption={caption} media={media} /> : <div className="card flex items-center gap-2 p-4 text-sm text-ink-3"><Spinner />Drafting…</div>}</div></div>
              {media && <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Creative <Badge>{media.canvas}</Badge><Badge>{media.model}</Badge></div><img src={media.dataUri} alt={media.altText ?? ''} className="max-h-72 rounded-xl border border-line" /></div>}
            </div>
            <div className="space-y-3 anim-fade-up">
              <div className="card p-4 text-xs"><div className="mb-1 text-[10px] uppercase tracking-wide text-ink-3">Marketing hand-off</div><div>Approved by <b>{sel.marketingApprovedBy}</b> · {timeAgo(sel.marketingApprovedAt)}</div><div className="text-ink-2">Scheduled {fmtDate(sel.date, { weekday: 'long', month: 'short', day: 'numeric' })} · {sel.time}</div>{sel.feedback.length > 0 && <div className="mt-2"><div className="text-[10px] uppercase tracking-wide text-ink-3">Edit instructions applied</div><ul className="mt-1 space-y-1">{sel.feedback.map((f, i) => <li key={i} className="rounded bg-surface-2 px-2 py-1">"{f.instruction}"</li>)}</ul></div>}</div>
              <div className="card p-4 text-xs"><div className="mb-1 text-[10px] uppercase tracking-wide text-ink-3">Why the agents chose this</div><div className="grid grid-cols-2 gap-1.5">{[['Brand relevance', `${sel.analysis.brandRelevance ?? '—'}%`], ['Trend score', `${sel.analysis.trendScore ?? '—'}%`]].map(([l, v]) => <div key={String(l)} className="rounded bg-surface-2 px-2 py-1"><div className="text-[9px] uppercase text-ink-3">{l}</div><div className="tabular font-semibold">{v}</div></div>)}</div><div className="mt-2 text-ink-2"><b>Angle:</b> {sel.analysis.angle}</div><div className="text-ink-2"><b>Audience:</b> {sel.analysis.audience}</div>{sel.hashtag && <div className="mt-1"><Badge tone="accent">#{sel.hashtag}</Badge></div>}</div>
              <div className="card border-accent/50 p-4">
                <div className="mb-2 text-[10px] uppercase tracking-wide text-accent">Your decision</div>
                {publishing ? <div className="space-y-1.5 text-xs">{PHASES.map((p, i) => <div key={p} className={`flex items-center gap-2 ${i <= s.publishPhase ? 'text-ink' : 'text-ink-3'}`}>{i < s.publishPhase ? <CheckCircle2 size={13} className="text-good-ink" /> : i === s.publishPhase ? <Spinner size={12} /> : <span className="h-3 w-3 rounded-full border border-line" />}{p}</div>)}</div> : <>
                  <Btn variant="primary" className="w-full" icon={<CheckCircle2 size={15} />} onClick={() => s.leadershipApprove(sel.id)}>Approve &amp; publish</Btn>
                  <Btn variant="danger" className="mt-2 w-full" icon={<XCircle size={15} />} onClick={() => { setReason(''); setRejecting(true) }}>Reject with a reason</Btn>
                  <p className="mt-2 text-[11px] text-ink-3">Either way, the outcome is written to the Knowledge Base so the agents learn from it.</p></>}
              </div>
            </div>
          </div>
        </div>
      )}
      {decided.length > 0 && <section className="mt-8 anim-fade-up"><h3 className="display mb-3 text-lg">Recent decisions</h3><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 stagger-fade">{decided.slice(0, 6).map((i, n) => <div key={i.id} className="card p-3" style={{ ['--i' as string]: n }}><div className="flex items-center justify-between gap-2"><Badge tone={i.leadershipDecision?.decision === 'approved' ? 'good' : 'critical'}>{i.leadershipDecision?.decision === 'approved' ? 'Approved' : 'Rejected'}{i.status === 'published' ? ' · Published' : ''}</Badge><span className="text-[10px] text-ink-3">{timeAgo(i.leadershipDecision?.at)}</span></div><div className="mt-1.5 text-sm font-medium line-clamp-2">{i.title}</div>{i.leadershipDecision?.reason && <p className="mt-1 text-xs italic text-ink-3">"{i.leadershipDecision.reason}"</p>}<div className="mt-2 flex items-center gap-2 text-[10px] text-ink-3"><PlatformChip platform={i.platform} />{i.leadershipDecision?.by}</div></div>)}</div></section>}
      <Modal open={rejecting} onClose={() => setRejecting(false)} title="Reject with a reason" footer={<div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setRejecting(false)}>Cancel</Btn><Btn variant="danger" disabled={!reason.trim()} onClick={() => { if (sel) void s.leadershipReject(sel.id, reason); setRejecting(false) }}>Reject</Btn></div>}>
        <p className="mb-3 text-xs text-ink-3">A rejection needs a reason — it is what the agents learn from.</p><div className="mb-3 flex flex-wrap gap-1.5">{QUICK.map((q) => <button key={q} type="button" onClick={() => setReason(q)} className={`rounded-full border px-2.5 py-1 text-[11px] ${reason === q ? 'border-critical bg-critical/15 text-critical-ink' : 'border-line bg-surface-2 text-ink-2'}`}>{q}</button>)}</div><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or write your own reason…" className="w-full text-sm" />
      </Modal>
    </div>
  )
}
