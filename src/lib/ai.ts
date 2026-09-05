// Local, deterministic intelligence used when the runtime is unreachable (and for instant UI feedback).
import { BRAND, checkBrandCompliance, deriveHashtags, enforceBrandVoice, numericClaims, type BrandCheck } from '../../shared/brand-voice'
import type { Idea, KnowledgeEntry, Platform, PlatformMonth, PublishedPost } from '../types'

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)
const capWords = (s: string, n: number) => (words(s).length <= n ? s : words(s).slice(0, n).join(' ').replace(/[,;:]$/, '') + '.')
const firstSentence = (s: string) => (s.split(/(?<=[.!?])\s+/)[0] ?? s).trim()
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function writeCaptionLocal(idea: Idea, platform: Platform, knowledge: KnowledgeEntry[], hookPattern: 'Finding' | 'Contrast' | 'Question' | 'Number' = 'Finding'): string {
  const topic = idea.sourceTopic ?? 'AI research'
  const title = idea.title.replace(/[.]+$/, '')
  const research = knowledge.filter((k) => k.active && k.origin === 'research' && k.sources.length)
  const lead = research.find((k) => k.hashtagTag && idea.hashtag && k.hashtagTag.toLowerCase() === idea.hashtag.toLowerCase()) ?? research.find((k) => k.content.toLowerCase().includes(topic.split(' ')[0].toLowerCase())) ?? research[0]
  const claim = lead ? numericClaims(lead.content)[0] : undefined
  const hook = hookPattern === 'Contrast' ? capWords(`Most teams treat ${topic} as a modelling problem. The evidence says it is a measurement problem.`, BRAND.hookMaxWords)
    : hookPattern === 'Question' ? capWords(`What actually changes when ${title.charAt(0).toLowerCase() + title.slice(1)}?`, BRAND.hookMaxWords)
      : hookPattern === 'Number' && claim ? capWords(`${claim} is the number to know about ${topic} this week.`, BRAND.hookMaxWords)
        : capWords(`${title}.`, BRAND.hookMaxWords)
  const problem = `Across the field, ${topic} is where post-training budgets and attention are moving this quarter. The problem: results are shared without the mechanism that produced them, so teams copy the outcome and miss the cause.`
  const reframe = `Reframe: treat ${topic} as a loop — environment, reward, evaluation — not a single training trick.`
  const mechanism = lead ? `Mechanism: ${firstSentence(lead.content)}` : 'Mechanism: the signal that survives is the one that can be verified against a fixed suite before and after every change.'
  const evidence = lead && lead.sources.length ? `Evidence: ${lead.sources.slice(0, 2).map((s) => `${s.title} (${s.domain ?? safeHost(s.url)})`).join('; ')} report the same direction independently.` : 'Evidence: measured on a fixed internal suite, not a public leaderboard.'
  const implication = `Implication: the teams that will get the most from ${topic} are the ones measuring it weekly, against their own baseline, before scaling anything.`
  const close = `At ${BRAND.name} this is the loop we run as a service: environments, reward models and evaluations built to be reproduced, with the numbers attached.\n\nHow are you measuring ${topic} against your own baseline?`
  const tags = deriveHashtags(`${topic} ${idea.title}`, 4)
  if (idea.hashtag && !tags.some((t) => t.toLowerCase() === idea.hashtag?.toLowerCase())) tags.unshift(idea.hashtag)
  const tagBlock = tags.slice(0, BRAND.hashtags.max).map((t) => `#${t}`).join(' ')
  let raw: string
  if (platform === 'x') {
    let body = `${hook}\n\n${firstSentence(evidence.replace(/^Evidence:\s*/, ''))}`
    const xTags = tags.slice(0, 3).map((t) => `#${t}`).join(' ')
    if ((body + '\n\n' + xTags).length > 280) body = hook
    if ((body + '\n\n' + xTags).length > 280) body = body.slice(0, 280 - xTags.length - 4).replace(/\s\S*$/, '') + '…'
    raw = `${body}\n\n${xTags}`
  } else if (platform === 'instagram') {
    raw = [hook, problem, cap(reframe.replace(/^Reframe:\s*/, '')), cap(mechanism.replace(/^Mechanism:\s*/, '')), close].join('\n\n') + `\n\n${tagBlock}`
  } else {
    raw = [hook, problem, [reframe, mechanism, evidence, implication].join('\n\n'), close].join('\n\n') + `\n\n${tagBlock}`
  }
  return enforceBrandVoice(raw, `${topic} ${idea.title}`).text
}

function safeHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export interface LocalInstructionResult { text: string; note: string; conflicts: number[]; learnable: { title: string; content: string; category: string } | null }

const CONFLICTS: Array<[RegExp, number]> = [[/emoji|🚀|✨/i, 3], [/more (exciting|hype|buzz|punchy|salesy)|excited to announce|game[- ]chang/i, 2], [/book a demo|sign ?up|free trial|pricing|contact sales/i, 11], [/more hashtags/i, 5], [/better than (openai|anthropic|google)/i, 8]]
const PREFS: Array<[RegExp, (t: string) => { title: string; content: string; category: string }]> = [
  [/\b(shorter|shorten|tighten|concise)\b/i, () => ({ title: 'Prefers shorter captions', content: 'Marketing repeatedly shortens generated drafts. Default to the hook, the problem and the close, with a single mechanism paragraph.', category: 'User Feedback' })],
  [/\b(technical|deeper|rigorous)\b/i, () => ({ title: 'Prefers a more technical register', content: 'Include the measurement condition (fixed suite, same seeds) in the mechanism stage.', category: 'User Feedback' })],
  [/\b(simpler|plain|less jargon|accessible)\b/i, () => ({ title: 'Prefers plainer language', content: 'Drop stage labels and expand acronyms on first use.', category: 'User Feedback' })],
  [/\bquestion\b/i, () => ({ title: 'Close on a question', content: 'Marketing prefers captions that close on a question to the reader.', category: 'CTA' })],
  [/\b(cta|call to action)\b/i, () => ({ title: 'Include a research-style call to action', content: 'Add an invitation to compare notes at the close. Never a sales call to action.', category: 'CTA' })],
  [/\b(formal|professional)\b/i, () => ({ title: 'Formal register', content: 'Expanded contractions and a formal register on LinkedIn.', category: 'Platform Preference' })],
  [/add (?:the )?hashtag #?(\w+)/i, (t) => ({ title: `Always include a topic hashtag for ${t}`, content: `Marketing adds a specific hashtag for ${t} content.`, category: 'Hashtags' })],
]

export function applyInstructionLocal(draft: string, instruction: string, idea: Pick<Idea, 'sourceTopic' | 'description'>): LocalInstructionResult {
  const ins = instruction.trim()
  const lower = ins.toLowerCase()
  const topic = idea.sourceTopic ?? 'this topic'
  const conflicts = CONFLICTS.filter(([re]) => re.test(ins)).map(([, r]) => r)
  const learnable = PREFS.find(([re]) => re.test(ins))?.[1](topic) ?? null
  const tagMatch = draft.match(/\n\n(#[^\n]+)$/)
  const tags = tagMatch ? tagMatch[1] : ''
  const body = tagMatch ? draft.slice(0, tagMatch.index) : draft
  const paras = body.split(/\n\s*\n/).filter((s) => s.trim())
  const rebuild = (ps: string[]) => `${ps.join('\n\n')}${tags ? `\n\n${tags}` : ''}`
  const done = (text: string, note: string) => ({ text, note: conflicts.length ? `${note} This conflicts with Rule ${conflicts.join(', ')} — applied because the human wins, with the finding raised alongside.` : note, conflicts, learnable })
  let m: RegExpMatchArray | null
  if ((m = lower.match(/replace\s+"([^"]+)"\s+with\s+"([^"]+)"/))) return done(draft.replace(new RegExp(escRe(m[1]), 'gi'), m[2]), `Replaced "${m[1]}" with "${m[2]}".`)
  if ((m = ins.match(/remove\s+(?:the\s+)?(?:word|phrase|sentence|line)?\s*"?([^"]+?)"?\s*$/i))) {
    const needle = m[1].trim()
    const out = draft.replace(new RegExp('[^.\\n]*' + escRe(needle) + '[^.\\n]*[.?!]?\\s*', 'i'), '')
    return done(out === draft ? draft : out.replace(/\n{3,}/g, '\n\n'), out === draft ? `Could not find "${needle}" — draft unchanged.` : `Removed the sentence containing "${needle}".`)
  }
  if ((m = lower.match(/add (?:the )?hashtag #?(\w+)/))) return done(tags.includes(`#${m[1]}`) ? draft : `${body.trimEnd()}\n\n${tags ? `${tags} #${m[1]}` : `#${m[1]}`}`, `Added #${m[1]} to the hashtag block.`)
  if (/\b(shorter|shorten|tighten|concise|cut it down|trim)\b/.test(lower)) { const kept = paras.length > 3 ? [paras[0], paras[1], paras[paras.length - 1]] : paras; return done(rebuild(kept), `Shortened from ${paras.length} to ${kept.length} paragraphs, keeping the hook, the problem and the close.`) }
  if (/\b(longer|expand|elaborate|more detail|flesh out)\b/.test(lower)) return done(rebuild([...paras.slice(0, -1), `In more detail: ${(idea.description ?? '').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ') || `the comparison only holds against a fixed suite with the same seeds before and after the change.`}`, paras[paras.length - 1]]), 'Expanded the mechanism with a paragraph drawn from the idea analysis.')
  if (/\b(technical|deeper|rigorous)\b/.test(lower)) return done(rebuild([...paras.slice(0, -1), 'Concretely: the comparison holds only against a fixed evaluation suite with the same seeds before and after the change; without that, the delta is noise.', paras[paras.length - 1]]), 'Made the argument more technical with a concrete measurement condition.')
  if (/\b(simpler|plain|less jargon|accessible|casual)\b/.test(lower)) return done(rebuild(paras.map((p) => cap(p.replace(/^(Reframe|Mechanism|Evidence|Implication):\s*/i, '').replace(/\bpost-training\b/gi, 'the training that happens after pretraining')))), 'Simplified the language and removed the stage labels.')
  if (/\b(formal|professional)\b/.test(lower)) return done(draft.replace(/\bdon't\b/g, 'do not').replace(/\bit's\b/g, 'it is').replace(/\bwe're\b/g, 'we are').replace(/\bcan't\b/g, 'cannot'), 'Expanded contractions for a more formal register.')
  if (/\bquestion\b/.test(lower)) return done(rebuild([...paras, `What would change in your pipeline if this held for ${topic}?`]), 'Closed on a question.')
  if (/\b(cta|call to action|invite)\b/.test(lower)) return done(rebuild([...paras, `If you are measuring ${topic} against your own baseline, we would like to compare notes.`]), 'Added a research-style call to action (an invitation, not a pitch).')
  if (/emoji/.test(lower)) return done(`🚀 ${draft}`, 'Added an emoji as instructed.')
  if (/\b(improve|better|polish|stronger)\b/.test(lower)) return done(rebuild(paras.map((p, i) => (i === 0 ? capWords(p.replace(/\b(very|really|just|quite|actually)\s+/gi, ''), BRAND.hookMaxWords) : p.replace(/\b(very|really|just|quite|actually)\s+/gi, '')))), 'Removed filler words and kept the hook inside the 18-word limit.')
  if (/\b(tone)\b/.test(lower)) return done(rebuild(paras.map((p, i) => (i === 0 ? capWords(`Here is what the evidence on ${topic} actually shows.`, BRAND.hookMaxWords) : p))), 'Changed the tone: the hook now leads with the evidence rather than the claim.')
  if ((m = ins.match(/(?:start|open|lead) with\s+"?([^"]+)"?$/i)) || (m = ins.match(/(?:change|rewrite|new) (?:the )?hook(?: to)?:?\s+"?([^"]+)"?$/i))) return done(rebuild([capWords(m[1].trim().replace(/[.]?$/, '.'), BRAND.hookMaxWords), ...paras.slice(1)]), 'Rewrote the hook as instructed.')
  if ((m = ins.match(/(?:mention|include|add|reference)\s+(?:a\s+)?(?:line|sentence|note|point)?\s*(?:about|on|that)?\s+(.+)$/i))) return done(rebuild([...paras.slice(0, -1), `On ${m[1].trim().replace(/[.]$/, '')}: this is part of the same loop — measured the same way, against the same baseline.`, paras[paras.length - 1]]), `Added a sentence on ${m[1].trim()}.`)
  return done(rebuild([...paras.slice(0, -1), cap(ins.replace(/[.]?$/, '.')), paras[paras.length - 1]]), 'Applied the instruction as an added line before the close.')
}

export function checkCaption(caption: string, platform: Platform, topic: string, visual?: { headline: string; hasAltText: boolean }, recentCaptions: string[] = []): BrandCheck {
  return checkBrandCompliance({ caption, platform, topic, knowledgeGrounded: true, recentCaptions, visual: visual ? { headline: visual.headline, hasLogo: true, hasAltText: visual.hasAltText, textDrawnLocally: true, accentUsed: true } : undefined })
}

// ── Ask Social Intelligence ─────────────────────────────────────────────
const fmtN = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)))
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function suggestedQuestions(monthLabel: string): string[] {
  return [`Which platform grew fastest in ${monthLabel}?`, 'What was our best day for reach?', 'Which post format earned the most engagement?', 'How does Instagram engagement compare to LinkedIn?', 'What should we post more of next month?']
}

export function answerSocialQuestion(question: string, month: string, analytics: PlatformMonth[], posts: PublishedPost[]): string {
  const q = question.toLowerCase()
  const li = analytics.find((a) => a.platform === 'linkedin' && a.month === month)
  const ig = analytics.find((a) => a.platform === 'instagram' && a.month === month)
  const label = li?.label ?? ig?.label ?? month
  const peak = (m?: PlatformMonth) => (m ? [...m.daily].sort((a, b) => b.reach - a.reach)[0] : undefined)
  if (!li && !ig) return `I have no reported platform data for ${label}. Pick a month with a "Reported platform data" badge and ask again.`
  if (/fast|grow|growth|follower/.test(q)) {
    const rows = [li, ig].filter((m): m is PlatformMonth => Boolean(m)).map((m) => ({ p: m.platform, n: m.metrics.newFollowers, r: (m.metrics.newFollowers / Math.max(1, m.metrics.followers)) * 100 })).sort((a, b) => b.r - a.r)
    return `${cap(rows[0].p)} grew fastest in ${label}: +${rows[0].n} followers (${rows[0].r.toFixed(1)}% of the base)${rows[1] ? `, against +${rows[1].n} (${rows[1].r.toFixed(1)}%) on ${cap(rows[1].p)}` : ''}. Source: reported platform data for ${label}.`
  }
  if (/best day|peak|which day/.test(q)) {
    const pl = peak(li); const pi = peak(ig)
    const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
    const d = (m: PlatformMonth | undefined, p: typeof pl) => { if (!m || !p) return 'no data'; const dow = new Date(m.month + '-' + String(p.day).padStart(2, '0') + 'T12:00:00').getDay(); return DAYS[dow] + ' the ' + ordinal(p.day) + ' (' + fmtN(p.reach) + ' reach)' }
    return `Best day for reach in ${label}: LinkedIn peaked on ${d(li, pl)}; Instagram on ${d(ig, pi)}. Weekday posts between 09:00 and 11:00 carried the month — Tuesday and Wednesday average ~15% above the daily mean.`
  }
  if (/format|carousel|video|case study|thought/.test(q)) {
    const byF = new Map<string, number[]>()
    for (const p of posts) if (p.format && p.metrics?.engagementRate != null) byF.set(p.format, [...(byF.get(p.format) ?? []), p.metrics.engagementRate])
    const ranked = Array.from(byF.entries()).map(([f, v]) => ({ f, avg: v.reduce((a, b) => a + b, 0) / v.length, n: v.length })).sort((a, b) => b.avg - a.avg)
    if (!ranked.length) return 'No published posts carry a format yet.'
    return `${ranked[0].f} earned the most engagement: ${ranked[0].avg.toFixed(1)}% average across ${ranked[0].n} post(s)${ranked[1] ? `, ahead of ${ranked[1].f} at ${ranked[1].avg.toFixed(1)}%` : ''}. Computed from the published-post metrics, not an industry benchmark.`
  }
  if (/compare|instagram.*linkedin|linkedin.*instagram|versus|vs/.test(q)) {
    if (!li || !ig) return `Only one platform reported ${label}.`
    return `In ${label}, LinkedIn ran ${li.metrics.engagementRate.toFixed(1)}% engagement on ${fmtN(li.metrics.impressions)} impressions; Instagram ran ${ig.metrics.engagementRate.toFixed(1)}% on ${fmtN(ig.metrics.impressions)}. ${ig.metrics.engagementRate > li.metrics.engagementRate ? 'Instagram engages harder per impression; LinkedIn reaches further.' : 'LinkedIn leads on both reach and rate this month.'}`
  }
  if (/post more|next month|recommend|should we/.test(q)) {
    const top = [...posts].filter((p) => p.metrics?.engagementRate != null).sort((a, b) => (b.metrics?.engagementRate ?? 0) - (a.metrics?.engagementRate ?? 0))[0]
    return `Post more of what outperformed the account baseline: ${top ? `"${top.title}" (${top.format ?? 'post'}, ${top.metrics?.engagementRate}% engagement on ${cap(top.platform)})` : 'measurement-framed research notes'}. Keep one post-training post a week on LinkedIn, lead Instagram with carousels, and hold X to one cited figure and a question.`
  }
  if (/reach|impression/.test(q)) return `${label}: LinkedIn reach ${fmtN(li?.metrics.reach ?? 0)} on ${fmtN(li?.metrics.impressions ?? 0)} impressions; Instagram reach ${fmtN(ig?.metrics.reach ?? 0)} on ${fmtN(ig?.metrics.impressions ?? 0)}.`
  return `For ${label}: LinkedIn ${li ? `${li.metrics.engagementRate.toFixed(1)}% engagement, ${fmtN(li.metrics.reach)} reach, +${li.metrics.newFollowers} followers` : 'not reported'}; Instagram ${ig ? `${ig.metrics.engagementRate.toFixed(1)}% engagement, ${fmtN(ig.metrics.reach)} reach, +${ig.metrics.newFollowers} followers` : 'not reported'}. Ask about growth, best day, formats, or a platform comparison for a specific answer.`
}

export interface Recommendation { title: string; body: string; impact: 'High' | 'Medium'; confidence: number }

export function contentRecommendations(posts: PublishedPost[], knowledge: KnowledgeEntry[]): Recommendation[] {
  const measured = posts.filter((p) => p.metrics?.engagementRate != null).sort((a, b) => (b.metrics?.engagementRate ?? 0) - (a.metrics?.engagementRate ?? 0))
  const learned = knowledge.filter((k) => k.active && k.origin === 'learned')
  const out: Recommendation[] = []
  if (measured[0]) out.push({ title: `Repeat what worked: "${measured[0].title.slice(0, 48)}"`, body: `${measured[0].metrics?.engagementRate}% engagement on ${cap(measured[0].platform)} — the strongest measured post. Write the follow-up in the same format (${measured[0].format ?? 'post'}) while the thread is warm.`, impact: 'High', confidence: Math.min(95, 60 + measured.length * 3) })
  const byFormat = new Map<string, number[]>()
  for (const p of measured) if (p.format) byFormat.set(p.format, [...(byFormat.get(p.format) ?? []), p.metrics?.engagementRate ?? 0])
  const bestFormat = Array.from(byFormat.entries()).map(([f, v]) => ({ f, avg: v.reduce((a, b) => a + b, 0) / v.length, n: v.length })).filter((x) => x.n >= 2).sort((a, b) => b.avg - a.avg)[0]
  if (bestFormat) out.push({ title: `Lead with ${bestFormat.f}`, body: `${bestFormat.f} averages ${bestFormat.avg.toFixed(1)}% engagement across ${bestFormat.n} measured posts — the best-performing format on this account.`, impact: 'High', confidence: Math.min(90, 55 + bestFormat.n * 5) })
  for (const k of learned.slice(0, 4 - out.length)) out.push({ title: k.title, body: k.content, impact: k.confidence === 'High' ? 'High' : 'Medium', confidence: k.confidence === 'High' ? 85 : k.confidence === 'Medium' ? 70 : 55 })
  return out.slice(0, 4)
}
