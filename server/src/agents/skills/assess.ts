// Validation Agent + Analysis Agent skills — stage `assess`.
import { BRAND, BRAND_TOPICS, contentWords, similarity } from '../../../../shared/brand-voice'
import { HASHTAG_ALIASES, HASHTAG_VOCABULARY, normaliseTag } from '../../../../shared/keywords'
import { query } from '../../db/pool'
import { FORMATS, type CompetitorPost, type Format } from '../corpus'
import { registerSkill } from '../runtime'
import type { HashtagCandidate, KeywordRow, ScrapedPost } from './discover'

export type Credibility = 'High' | 'Medium' | 'Low'
export type Verdict = 'validated' | 'needs_review' | 'duplicate' | 'rejected'

export interface KeywordSignalDraft {
  keywordId: string
  term: string
  postCount: number
  totalEngagement: number
  avgEngagement: number
  velocity: number
  growthPct: number
  trendScore: number
  rank: number
  isTrending: boolean
  trendReason: string
  components: { volume: number; engagement: number; velocity: number; growth: number }
}

export interface Candidate {
  kind: 'item' | 'hashtag'
  key: string
  title: string
  text: string
  keywordId: string
  keywordTerm: string
  sourceName: string
  sourceType: string
  trusted: boolean
  ageHours: number
  hashtags: string[]
  externalId?: string
  url?: string
  engagement: number
  engagementNorm: number
  postCount?: number
  engagementPerPost?: number
  hashtagScore?: number
  rank?: number
  credibility: Credibility
  credibilityScore: number
  relevance: number
  freshness: number
  isDuplicate: boolean
  duplicateOfKey?: string
  duplicateOfId?: string
  duplicateOfLabel?: string
  verdict?: Verdict
  verdictReason?: string
}

export interface ReviewRequest {
  kind: 'scraped_item' | 'hashtag'
  key: string
  title: string
  reason: string
  decisionRequested: string
  options: string[]
}

export interface ValidationPayload extends Record<string, unknown> {
  rawPosts: ScrapedPost[]
  hashtagCandidates: HashtagCandidate[]
  keywords: KeywordRow[]
  trustedSources: string[]
  keywordSignals: KeywordSignalDraft[]
  trendingKeywords: KeywordSignalDraft[]
  candidates: Candidate[]
  acceptThreshold: number
  rejectThreshold: number
  bucketCounts: Record<Verdict, number>
  reviewQueue: ReviewRequest[]
  outputCount?: number
  completionNote?: string
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
const norm = (v: number, max: number) => (max > 0 ? (v / max) * 100 : 0)
const pretty = (tag: string) => tag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()

function topicOverlap(text: string, extra: string[] = []): number {
  const t = text.toLowerCase()
  let hits = 0
  for (const topic of [...BRAND_TOPICS, ...extra]) if (topic && t.includes(topic.toLowerCase())) hits++
  return hits
}

registerSkill<ValidationPayload>('validation.keyword.trend', async (p, ctx) => {
  const weights = { volume: ctx.num('volumeWeight'), engagement: ctx.num('engagementWeight'), velocity: ctx.num('velocityWeight'), growth: ctx.num('growthWeight') }
  const sum = weights.volume + weights.engagement + weights.velocity + weights.growth
  if (sum !== 100) await ctx.activity(`Trend weights sum to ${sum}%, not 100% — scores are rescaled`, 'warn')
  const scale = sum > 0 ? 100 / sum : 1
  const windowRuns = ctx.num('trendWindowRuns')
  const minPosts = ctx.num('minPostsToRank')

  const groups = new Map<string, ScrapedPost[]>()
  for (const r of p.rawPosts) groups.set(r.keywordId, [...(groups.get(r.keywordId) ?? []), r])
  const prior = await query<{ keyword_id: string; total_engagement: number }>(
    `SELECT keyword_id, total_engagement FROM (
       SELECT keyword_id, total_engagement, row_number() OVER (PARTITION BY keyword_id ORDER BY captured_at DESC) AS rn
       FROM keyword_signals WHERE workspace_id = $1) s WHERE rn <= $2`,
    [ctx.workspaceId, windowRuns],
  )
  const priorAvg = new Map<string, number>()
  const priorCounts = new Map<string, number>()
  for (const r of prior) {
    priorAvg.set(r.keyword_id, (priorAvg.get(r.keyword_id) ?? 0) + r.total_engagement)
    priorCounts.set(r.keyword_id, (priorCounts.get(r.keyword_id) ?? 0) + 1)
  }
  for (const [k, v] of priorAvg) priorAvg.set(k, v / (priorCounts.get(k) ?? 1))

  const drafts: KeywordSignalDraft[] = []
  for (const kw of p.keywords) {
    const posts = groups.get(kw.id) ?? []
    if (posts.length === 0) continue
    const total = posts.reduce((n, r) => n + r.engagement, 0)
    const velocity = posts.reduce((n, r) => n + r.velocity, 0)
    const base = priorAvg.get(kw.id) ?? 0
    const growthPct = clamp(((total - base) / Math.max(base, 1)) * 100, -100, 100)
    drafts.push({ keywordId: kw.id, term: kw.term, postCount: posts.length, totalEngagement: total, avgEngagement: Math.round((total / posts.length) * 100) / 100, velocity: Math.round(velocity * 100) / 100, growthPct: Math.round(growthPct * 100) / 100, trendScore: 0, rank: 0, isTrending: false, trendReason: '', components: { volume: 0, engagement: 0, velocity: 0, growth: 0 } })
  }
  const maxVol = Math.max(1, ...drafts.map((d) => d.postCount))
  const maxEng = Math.max(1, ...drafts.map((d) => d.totalEngagement))
  const maxVel = Math.max(1, ...drafts.map((d) => d.velocity))
  for (const d of drafts) {
    d.components = { volume: Math.round(norm(d.postCount, maxVol)), engagement: Math.round(norm(d.totalEngagement, maxEng)), velocity: Math.round(norm(d.velocity, maxVel)), growth: Math.round((d.growthPct + 100) / 2) }
    d.trendScore = clamp(Math.round(scale * (d.components.volume * weights.volume + d.components.engagement * weights.engagement + d.components.velocity * weights.velocity + d.components.growth * weights.growth) / 100))
  }
  const rankable = drafts.filter((d) => d.postCount >= minPosts).sort((a, b) => b.trendScore - a.trendScore)
  const volumeOrder = [...drafts].sort((a, b) => b.postCount - a.postCount)
  const growthOrder = [...drafts].sort((a, b) => b.growthPct - a.growthPct)
  const ord = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`)
  const top = ctx.num('topKeywords')
  rankable.forEach((d, i) => {
    d.rank = i + 1
    d.isTrending = i < top
    const volRank = volumeOrder.indexOf(d) + 1
    const growthRank = growthOrder.indexOf(d) + 1
    const base = priorAvg.get(d.keywordId)
    const growthText = base === undefined ? 'no prior runs to compare against yet' : `engagement is ${d.growthPct >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(d.growthPct))}% against its ${priorCounts.get(d.keywordId)}-run average`
    d.trendReason = `${ord(volRank)} highest volume this run (${d.postCount} posts, ${d.totalEngagement.toLocaleString()} engagement)${growthRank === 1 ? ' and the fastest-growing' : growthRank <= 3 ? ` and ${ord(growthRank)} fastest-growing` : ''}: ${growthText}. Velocity ${d.velocity}/h.`
  })
  for (const d of drafts) if (!rankable.includes(d)) { d.rank = rankable.length + 1; d.trendReason = `Only ${d.postCount} post(s) this run — below the ${minPosts}-post minimum to rank.` }
  const trending = rankable.filter((d) => d.isTrending)
  for (const d of trending) ctx.emit('keyword.ranked', `#${d.rank} ${d.term} · trend ${d.trendScore}`, { keywordId: d.keywordId, term: d.term, rank: d.rank, trendScore: d.trendScore, reason: d.trendReason })
  ctx.log(`${trending.length} trending keywords: ${trending.map((t) => t.term).join(', ')}`)
  return { keywordSignals: drafts, trendingKeywords: trending }
})

registerSkill<ValidationPayload>('validation.hashtag.rank', (p, ctx) => {
  const topN = ctx.num('topHashtagsPerKeyword')
  const halfLife = ctx.num('freshnessHalfLifeHours')
  const trustedSet = new Set(p.trustedSources.map((s) => s.toLowerCase()))
  const candidates: Candidate[] = []

  // Every scraped item goes through the gate.
  for (const r of p.rawPosts) {
    candidates.push({ kind: 'item', key: `item:${r.externalId}`, title: r.text.split(/[.!?\n]/)[0].slice(0, 110).trim(), text: r.text, keywordId: r.keywordId, keywordTerm: r.keyword, sourceName: r.sourceName, sourceType: r.sourceType, trusted: trustedSet.has(r.sourceName.toLowerCase()), ageHours: r.ageHours, hashtags: r.hashtags.map(normaliseTag), externalId: r.externalId, url: r.url, engagement: r.engagement, engagementNorm: r.engagementNorm, credibility: 'Medium', credibilityScore: 0, relevance: 0, freshness: 0, isDuplicate: false })
  }
  // Per trending keyword, rank its hashtags and push the top set through the same gate.
  let ranked = 0
  for (const kw of p.trendingKeywords) {
    const mine = p.hashtagCandidates.filter((h) => h.keywordId === kw.keywordId)
    if (!mine.length) continue
    const maxEpp = Math.max(1, ...mine.map((h) => (h.feedEngagement ?? h.totalEngagement) / Math.max(1, h.feedPostCount ?? h.postCount)))
    const maxVol = Math.max(1, ...mine.map((h) => h.feedPostCount ?? h.postCount))
    const vocab = (HASHTAG_VOCABULARY[kw.term] ?? []).map(normaliseTag)
    const scored = mine.map((h) => {
      const epp = (h.feedEngagement ?? h.totalEngagement) / Math.max(1, h.feedPostCount ?? h.postCount)
      const rel = clamp(40 + topicOverlap(pretty(h.displayTag), [kw.term, ...contentWords(kw.term)]) * 18 + (vocab.includes(h.tag) ? 25 : 0))
      const ageHours = Math.max(0.5, (Date.now() - Date.parse(h.lastSeenAt)) / 3600000)
      const recency = 100 * Math.pow(0.5, ageHours / halfLife)
      const score = clamp(Math.round(0.3 * rel + 0.3 * norm(epp, maxEpp) + 0.2 * norm(h.feedPostCount ?? h.postCount, maxVol) + 0.2 * recency))
      return { h, rel, epp, score, ageHours }
    }).sort((a, b) => b.score - a.score).slice(0, topN)
    scored.forEach((s, i) => {
      ranked++
      candidates.push({ kind: 'hashtag', key: `hashtag:${kw.keywordId}:${s.h.tag}`, title: `#${s.h.displayTag}`, text: `#${s.h.displayTag} ${pretty(s.h.displayTag)} — surfaced by "${kw.term}" in ${s.h.postCount} posts`, keywordId: kw.keywordId, keywordTerm: kw.term, sourceName: s.h.feedSource === 'live' ? 'LinkedIn Hashtag Feeds' : 'LinkedIn', sourceType: 'Social', trusted: true, ageHours: s.ageHours, hashtags: [s.h.tag], engagement: s.h.feedEngagement ?? s.h.totalEngagement, engagementNorm: Math.round(norm(s.epp, maxEpp)), postCount: s.h.feedPostCount ?? s.h.postCount, engagementPerPost: Math.round(s.epp * 100) / 100, hashtagScore: s.score, rank: i + 1, credibility: 'Medium', credibilityScore: 0, relevance: s.rel, freshness: 0, isDuplicate: false })
    })
  }
  ctx.log(`${ranked} hashtags ranked across ${p.trendingKeywords.length} trending keywords; ${candidates.length} candidates enter the gate`)
  return { candidates }
})

registerSkill<ValidationPayload>('validation.credibility.score', (p, ctx) => {
  const bonus = ctx.num('trustedBonus')
  const penalty = ctx.num('communityPenalty')
  for (const c of p.candidates) {
    const tier = c.sourceType === 'News' || c.sourceType === 'Website' ? 80 : c.sourceType === 'Social' ? 55 : 30
    let score = tier + (c.trusted ? bonus : 0) - (c.sourceType === 'Community' ? penalty : 0)
    if (c.kind === 'hashtag') score = Math.max(score, 55)
    c.credibilityScore = clamp(score)
    c.credibility = c.credibilityScore >= 70 ? 'High' : c.credibilityScore >= 45 ? 'Medium' : 'Low'
  }
  const counts = p.candidates.reduce<Record<string, number>>((a, c) => ({ ...a, [c.credibility]: (a[c.credibility] ?? 0) + 1 }), {})
  ctx.log(`Credibility: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`)
  return { candidates: p.candidates }
})

registerSkill<ValidationPayload>('validation.relevance.score', (p, ctx) => {
  const accept = ctx.num('acceptThreshold')
  const reject = ctx.num('rejectThreshold')
  for (const c of p.candidates) {
    if (c.kind === 'hashtag') continue // hashtags were scored in the ranking step
    const overlap = topicOverlap(c.text, [c.keywordTerm])
    const kwHit = c.text.toLowerCase().includes(c.keywordTerm.toLowerCase()) ? 12 : 0
    const domainHit = BRAND.domains.some((d) => c.text.toLowerCase().includes(d.toLowerCase().split(' ')[0])) ? 6 : 0
    const pitch = /book a demo|sign up|hiring|dm me|free trial|unlock the full potential/i.test(c.text) ? -60 : 0
    // Neutral base; overlap only pushes up. Pitch/hiring content is not research signal.
    c.relevance = clamp(Math.round(50 + Math.min(45, overlap * 9) + kwHit + domainHit + pitch))
  }
  ctx.log(`Thresholds accept ≥ ${accept}, reject < ${reject}`)
  return { candidates: p.candidates, acceptThreshold: accept, rejectThreshold: reject }
})

registerSkill<ValidationPayload>('validation.freshness.score', (p, ctx) => {
  const half = ctx.num('halfLifeHours')
  for (const c of p.candidates) c.freshness = clamp(Math.round(100 * Math.pow(0.5, c.ageHours / half)))
  ctx.log(`Freshness half-life ${half}h`)
  return { candidates: p.candidates }
})

registerSkill<ValidationPayload>('validation.duplicate.detect', async (p, ctx) => {
  const threshold = ctx.num('similarityThreshold') / 100
  const windowDays = ctx.num('compareWindow')
  const withinBatch = ctx.bool('withinBatch')
  const aliases = ctx.bool('aliasMapEnabled')
  const history = await query<{ id: string; title: string; external_id: string | null; kind: string }>(
    `SELECT id, title, external_id, 'item' AS kind FROM scraped_items WHERE workspace_id = $1 AND validation = 'validated' AND scraped_at > now() - ($2 || ' days')::interval
     UNION ALL
     SELECT id, display_tag AS title, tag AS external_id, 'hashtag' AS kind FROM hashtags WHERE workspace_id = $1 AND validation = 'validated' AND created_at > now() - ($2 || ' days')::interval`,
    [ctx.workspaceId, String(windowDays)],
  )
  const seen: Candidate[] = []
  let dupes = 0
  for (const c of p.candidates) {
    const tag = c.kind === 'hashtag' ? c.hashtags[0] : null
    const canonical = tag && aliases ? (HASHTAG_ALIASES[tag] ?? tag) : tag
    // A hashtag can trend again next week — history checks apply to items; hashtags are compared within the batch.
    if (c.kind === 'item') {
      // (a) exact against history
      const exact = history.find((h) => h.kind === 'item' && h.external_id && h.external_id === c.externalId)
      if (exact) { c.isDuplicate = true; c.duplicateOfId = exact.id; c.duplicateOfLabel = exact.title; dupes++; continue }
      // (b) near against history
      const near = history.find((h) => h.kind === 'item' && similarity(h.title, c.text) >= threshold)
      if (near) { c.isDuplicate = true; c.duplicateOfId = near.id; c.duplicateOfLabel = near.title; dupes++; continue }
    }
    if (withinBatch) {
      // (a) exact within batch, (c) alias within batch, (b) near within batch
      const prior = seen.find((s) => s.kind === c.kind && (
        (c.kind === 'item' && s.externalId === c.externalId) ||
        (c.kind === 'hashtag' && (s.hashtags[0] === tag || (aliases && (HASHTAG_ALIASES[s.hashtags[0]] ?? s.hashtags[0]) === canonical))) ||
        similarity(s.kind === 'item' ? s.text : pretty(s.title), c.kind === 'item' ? c.text : pretty(c.title)) >= threshold
      ))
      if (prior) { c.isDuplicate = true; c.duplicateOfKey = prior.key; c.duplicateOfLabel = prior.title; dupes++; continue }
    }
    seen.push(c)
  }
  ctx.log(`${dupes} duplicates linked to their originals (threshold ${Math.round(threshold * 100)}%, window ${windowDays}d)`)
  return { candidates: p.candidates }
})

registerSkill<ValidationPayload>('validation.verdict.route', (p, ctx) => {
  const escalate = ctx.bool('escalateUncertain')
  const lowReviews = ctx.bool('lowCredibilityAlwaysReviews')
  const counts: Record<Verdict, number> = { validated: 0, needs_review: 0, duplicate: 0, rejected: 0 }
  for (const c of p.candidates) {
    const label = c.kind === 'hashtag' ? c.title : `"${c.title}"`
    if (c.isDuplicate) {
      c.verdict = 'duplicate'
      c.verdictReason = `Duplicate of ${c.duplicateOfLabel ?? 'an earlier item'} — linked, not deleted.`
    } else if (c.relevance < p.rejectThreshold) {
      c.verdict = 'rejected'
      c.verdictReason = `Relevance ${c.relevance}% is below the reject threshold of ${p.rejectThreshold}%: ${label} does not overlap the brand topics (${c.keywordTerm}).`
    } else if (c.credibility === 'Low' && lowReviews) {
      c.verdict = escalate ? 'needs_review' : 'rejected'
      c.verdictReason = `Low credibility (${c.credibilityScore}/100 from a ${c.sourceType.toLowerCase()} source, ${c.sourceName}) with relevance ${c.relevance}% — ${escalate ? 'a human should decide' : 'rejected because escalation is off'}.`
    } else if (c.relevance < p.acceptThreshold) {
      c.verdict = escalate ? 'needs_review' : 'rejected'
      c.verdictReason = `Relevance ${c.relevance}% sits between the reject (${p.rejectThreshold}%) and accept (${p.acceptThreshold}%) thresholds; credibility ${c.credibility}, freshness ${c.freshness}%.`
    } else {
      c.verdict = 'validated'
      c.verdictReason = `Relevance ${c.relevance}% ≥ ${p.acceptThreshold}%, credibility ${c.credibility} (${c.credibilityScore}), freshness ${c.freshness}%, no duplicate found.`
    }
    counts[c.verdict]++
  }
  ctx.emit('activity', `Verdicts: ${counts.validated} validated · ${counts.needs_review} need review · ${counts.duplicate} duplicate · ${counts.rejected} rejected`, { bucketCounts: counts })
  ctx.log(`${counts.validated} validated, ${counts.needs_review} need review, ${counts.duplicate} duplicate, ${counts.rejected} rejected`)
  return { candidates: p.candidates, bucketCounts: counts }
})

registerSkill<ValidationPayload>('validation.review.queue', (p, ctx) => {
  const max = ctx.num('maxQueueSize')
  const queue: ReviewRequest[] = p.candidates.filter((c) => c.verdict === 'needs_review').slice(0, max).map((c) => ({
    kind: c.kind === 'item' ? 'scraped_item' : 'hashtag',
    key: c.key,
    title: c.title,
    reason: c.verdictReason ?? '',
    decisionRequested: c.kind === 'item' ? `Should this post from ${c.sourceName} count as validated signal for "${c.keywordTerm}"?` : `Should ${c.title} be validated as a hashtag for "${c.keywordTerm}"?`,
    options: ['Approve', 'Reject'],
  }))
  const validated = p.candidates.filter((c) => c.verdict === 'validated').length
  ctx.log(`${queue.length} decisions queued for a human`)
  return { reviewQueue: queue, outputCount: p.candidates.length, completionNote: `${validated} validated · ${queue.length} awaiting review` }
})

// ── ANALYSIS AGENT ────────────────────────────────────────────────────────
export interface Cluster {
  id: number
  title: string
  items: Candidate[]
  hashtags: string[]
  keywordTerm: string
  keywordId: string
  sourceKey: string
  hashtagTag?: string
  hashtagDisplay?: string
  brandRelevance: number
  trendScore: number
  engagementLevel: 'High' | 'Medium' | 'Low'
  engagementScore: number
  format: Format
  angle: string
  audience: string
  competitorNote: string
  explanation: string
  bestDay: string
}

export interface TopHashtag {
  tag: string
  displayTag: string
  keywordId: string
  keywordTerm: string
  hashtagScore: number
  globalRank: number
  key: string
}

export interface AnalysisPayload extends Record<string, unknown> {
  validatedItems: Candidate[]
  rankedHashtags: Candidate[]
  trendingKeywords: KeywordSignalDraft[]
  competitorPosts: CompetitorPost[]
  clusters: Cluster[]
  topHashtags: TopHashtag[]
  opportunities: Cluster[]
  outputCount?: number
  completionNote?: string
}

registerSkill<AnalysisPayload>('analysis.trend.cluster', (p, ctx) => {
  const threshold = ctx.num('mergeThreshold') / 100
  const maxClusters = ctx.num('maxClusters')
  const clusters: Cluster[] = []
  const sorted = [...p.validatedItems].sort((a, b) => b.engagement - a.engagement)
  for (const item of sorted) {
    const home = clusters.find((c) => similarity(c.title, item.text) >= threshold || similarity(c.items[0].text, item.text) >= threshold)
    if (home) { home.items.push(item); continue }
    if (clusters.length >= maxClusters) continue
    const kwSignal = p.trendingKeywords.find((k) => k.keywordId === item.keywordId)
    const hashtagForKw = p.rankedHashtags.filter((h) => h.keywordId === item.keywordId && h.verdict === 'validated').sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9))[0]
    clusters.push({ id: clusters.length + 1, title: item.title, items: [item], hashtags: item.hashtags, keywordTerm: item.keywordTerm, keywordId: item.keywordId, sourceKey: item.key, hashtagTag: hashtagForKw?.hashtags[0], hashtagDisplay: hashtagForKw?.title.replace(/^#/, ''), brandRelevance: 0, trendScore: kwSignal?.trendScore ?? 50, engagementLevel: 'Medium', engagementScore: 0, format: 'Thought Leadership', angle: '', audience: '', competitorNote: '', explanation: '', bestDay: 'Tuesday' })
  }
  ctx.log(`${clusters.length} clusters from ${p.validatedItems.length} validated items`)
  return { clusters }
})

registerSkill<AnalysisPayload>('analysis.brand.fit', (p, ctx) => {
  const min = ctx.num('minBrandFit')
  for (const c of p.clusters) {
    const text = c.items.map((i) => i.text).join(' ')
    const overlap = topicOverlap(text)
    const domain = BRAND.domains.filter((d) => text.toLowerCase().includes(d.toLowerCase().split(' ')[0].toLowerCase())).length
    c.brandRelevance = clamp(Math.round(45 + Math.min(40, overlap * 5) + domain * 5 + (c.items[0].relevance - 50) / 4))
  }
  const kept = p.clusters.filter((c) => c.brandRelevance >= min)
  ctx.log(`${kept.length}/${p.clusters.length} clusters at or above ${min}% brand fit`)
  return { clusters: kept }
})

registerSkill<AnalysisPayload>('analysis.engagement.predict', (p, ctx) => {
  const vel = ctx.num('velocityInfluence') / 100
  for (const c of p.clusters) {
    const engNorm = Math.max(...c.items.map((i) => i.engagementNorm))
    const velocity = Math.min(100, c.items.reduce((n, i) => n + i.engagement / Math.max(1, i.ageHours), 0) * 2)
    c.engagementScore = clamp(Math.round((1 - vel) * engNorm + vel * velocity + c.brandRelevance * 0.1))
    c.engagementLevel = c.engagementScore >= 65 ? 'High' : c.engagementScore >= 35 ? 'Medium' : 'Low'
  }
  ctx.log(`Engagement predicted for ${p.clusters.length} clusters`)
  return { clusters: p.clusters }
})

registerSkill<AnalysisPayload>('analysis.format.recommend', (p, ctx) => {
  const forced = ctx.str('preferredFormat')
  for (const c of p.clusters) {
    if (forced !== 'Auto' && (FORMATS as readonly string[]).includes(forced)) { c.format = forced as Format; continue }
    const text = c.items[0].text
    const numbers = (text.match(/\d+%|\d+ points|\d+x/g) ?? []).length
    c.format = /we (ran|measured|built|tried|tested)/i.test(text) && numbers >= 2 ? 'Case Study' : numbers >= 3 || /\b(three|four|five|\d) (things|lessons|hacks|failures)/i.test(text) ? 'Carousel' : text.length < 180 ? 'Short Post' : /demo|walkthrough|show/i.test(text) ? 'Video' : 'Thought Leadership'
  }
  ctx.log('Formats recommended from the evidence in each cluster')
  return { clusters: p.clusters }
})

registerSkill<AnalysisPayload>('analysis.angle.propose', (p, ctx) => {
  const stance = ctx.str('stance')
  for (const c of p.clusters) {
    const topic = c.keywordTerm
    c.angle = stance === 'Challenge the consensus' ? `Why the common reading of ${topic} is incomplete — and what the evidence in this cluster shows instead.` : stance === 'Report the evidence' ? `What ${c.items.length} recent practitioner report(s) on ${topic} agree on, with the numbers.` : `The mechanism behind ${topic}: what actually changes when ${c.title.toLowerCase().replace(/[.:]$/, '')}.`
    c.audience = c.brandRelevance >= 75 ? 'ML researchers and post-training engineers' : /leader|cto|enterprise/i.test(c.items[0].text) ? 'Engineering leaders evaluating agentic systems' : 'ML engineers building agents and evals'
    c.bestDay = ['Tuesday', 'Wednesday', 'Thursday'][c.id % 3]
  }
  ctx.log(`Angles proposed (${stance})`)
  return { clusters: p.clusters }
})

registerSkill<AnalysisPayload>('analysis.competitor.compare', (p, ctx) => {
  const lookback = ctx.num('lookbackDays') * 24
  for (const c of p.clusters) {
    const recent = p.competitorPosts.filter((cp) => cp.ageHours <= lookback)
    const match = recent.map((cp) => ({ cp, s: similarity(cp.title, c.title) })).filter((m) => m.s > 0.12).sort((a, b) => b.s - a.s)[0]
    c.competitorNote = match ? `${match.cp.competitor} (${match.cp.tier}) posted on this ${Math.round(match.cp.ageHours / 24)}d ago as a ${match.cp.format} with engagement index ${match.cp.engagementIndex}.` : 'No competitor has posted on this in the lookback window.'
  }
  ctx.log('Competitor overlap checked')
  return { clusters: p.clusters }
})

registerSkill<AnalysisPayload>('analysis.hashtag.consolidate', (p, ctx) => {
  const topN = ctx.num('topHashtags')
  const byCanonical = new Map<string, Candidate>()
  for (const h of p.rankedHashtags) {
    if (h.verdict !== 'validated') continue
    const tag = h.hashtags[0]
    const canonical = HASHTAG_ALIASES[tag] ?? tag
    const cur = byCanonical.get(canonical)
    if (!cur || (h.hashtagScore ?? 0) > (cur.hashtagScore ?? 0)) byCanonical.set(canonical, h)
  }
  const top: TopHashtag[] = Array.from(byCanonical.values()).sort((a, b) => (b.hashtagScore ?? 0) - (a.hashtagScore ?? 0)).slice(0, topN).map((h, i) => ({ tag: h.hashtags[0], displayTag: h.title.replace(/^#/, ''), keywordId: h.keywordId, keywordTerm: h.keywordTerm, hashtagScore: h.hashtagScore ?? 0, globalRank: i + 1, key: h.key }))
  ctx.log(`Top ${top.length} hashtags consolidated from ${p.rankedHashtags.length} ranked (${byCanonical.size} after cross-keyword de-duplication)`)
  return { topHashtags: top }
})

registerSkill<AnalysisPayload>('analysis.recommendation.explain', (p, ctx) => {
  const maxS = ctx.num('maxSentences')
  const opportunities = [...p.clusters].sort((a, b) => (b.brandRelevance * 0.5 + b.engagementScore * 0.3 + b.trendScore * 0.2) - (a.brandRelevance * 0.5 + a.engagementScore * 0.3 + a.trendScore * 0.2))
  for (const c of opportunities) {
    const lead = c.items[0]
    const sentences = [
      `"${c.keywordTerm}" is trending at ${c.trendScore}/100 and this cluster carries ${c.items.length} validated post(s) with ${lead.engagement.toLocaleString()} engagement at the top.`,
      `Brand fit is ${c.brandRelevance}% and predicted engagement is ${c.engagementLevel.toLowerCase()} (${c.engagementScore}), so a ${c.format} is the recommended format.`,
      c.competitorNote,
    ]
    c.explanation = sentences.slice(0, maxS).join(' ')
  }
  ctx.log(`${opportunities.length} opportunities explained`)
  return { opportunities, outputCount: opportunities.length, completionNote: `${opportunities.length} opportunities · top ${p.topHashtags.length} hashtags` }
})
