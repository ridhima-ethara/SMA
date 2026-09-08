// Validation Agent + Analysis Agent skills — stage `assess`.
import { BRAND, similarity } from '../../../../shared/brand-voice'
import { HASHTAG_ALIASES, normaliseTag } from '../../../../shared/keywords'
import { query } from '../../db/pool'
import { FORMATS, type CompetitorPost, type Format } from '../corpus'
import { pretty, rankHashtagsForKeyword, topicOverlap } from '../hashtag-rank'
import { registerSkill } from '../runtime'
import type { HashtagCandidate, KeywordRow, ScrapedPost } from './discover'

export type Credibility = 'High' | 'Medium' | 'Low'
export type Verdict = 'validated' | 'needs_review' | 'duplicate' | 'rejected'

// Scoring lives in ../keyword-trend so the Scraping Agent shares one implementation.
export type { KeywordSignalDraft } from '../keyword-trend'
import { loadTrendBaseline, scoreKeywordTrends, type KeywordSignalDraft } from '../keyword-trend'

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

registerSkill<ValidationPayload>('validation.keyword.trend', async (p, ctx) => {
  const weights = { volume: ctx.num('volumeWeight'), engagement: ctx.num('engagementWeight'), velocity: ctx.num('velocityWeight'), growth: ctx.num('growthWeight') }
  const { priorAverage, priorRuns } = await loadTrendBaseline(ctx.workspaceId, ctx.num('trendWindowRuns'))
  const { signals, trending, weightSum } = scoreKeywordTrends({
    keywords: p.keywords,
    posts: p.rawPosts,
    weights,
    topKeywords: ctx.num('topKeywords'),
    minPostsToRank: ctx.num('minPostsToRank'),
    priorAverage,
    priorRuns,
  })
  if (weightSum !== 100) await ctx.activity(`Trend weights sum to ${weightSum}%, not 100% — scores are rescaled`, 'warn')
  for (const d of trending) ctx.emit('keyword.ranked', `#${d.rank} ${d.term} · trend ${d.trendScore}`, { keywordId: d.keywordId, term: d.term, rank: d.rank, trendScore: d.trendScore, reason: d.trendReason })
  ctx.log(`${trending.length} trending keywords: ${trending.map((t) => t.term).join(', ')}`)
  return { keywordSignals: signals, trendingKeywords: trending }
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
    const scored = rankHashtagsForKeyword({ candidates: p.hashtagCandidates, keywordId: kw.keywordId, keywordTerm: kw.term, topN, halfLifeHours: halfLife })
    for (const s of scored) {
      ranked++
      candidates.push({ kind: 'hashtag', key: `hashtag:${kw.keywordId}:${s.tag}`, title: `#${s.displayTag}`, text: `#${s.displayTag} ${pretty(s.displayTag)} — surfaced by "${kw.term}" in ${s.postCount} posts`, keywordId: kw.keywordId, keywordTerm: kw.term, sourceName: s.feedSource === 'live' ? 'LinkedIn Hashtag Feeds' : 'LinkedIn', sourceType: 'Social', trusted: true, ageHours: s.ageHours, hashtags: [s.tag], engagement: s.feedEngagement ?? s.totalEngagement, engagementNorm: Math.round(s.engagementPerPost), postCount: s.feedPostCount ?? s.postCount, engagementPerPost: s.engagementPerPost, hashtagScore: s.hashtagScore, rank: s.rank, credibility: 'Medium', credibilityScore: 0, relevance: s.relevance, freshness: 0, isDuplicate: false })
    }
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
  /** Position within its own keyword's set, 1-based. */
  keywordRank: number
  /** The verdict Validation gave this hashtag, carried through rather than hidden. */
  verdict: Verdict | 'pending'
  verdictReason: string
  relevance: number
  postCount: number
  engagementPerPost: number
  /** Set when Validation linked this tag to an earlier near-identical one. */
  duplicateOf: string | null
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
  const quota = ctx.num('perKeywordQuota')
  const include = ctx.str('includeVerdicts')
  const dedupe = ctx.bool('deduplicateAcrossKeywords')

  // Which verdicts may be carried forward. 'ranked' keeps everything Validation ranked,
  // which is what produces a full quota-per-keyword set; the verdict travels with each
  // row so a held or duplicate tag is still visible downstream.
  const allowed: Set<string> =
    include === 'validated' ? new Set(['validated'])
      : include === 'validated+needs_review' ? new Set(['validated', 'needs_review'])
        : new Set(['validated', 'needs_review', 'duplicate'])
  const eligible = p.rankedHashtags.filter((h) => allowed.has(h.verdict ?? 'pending'))

  const score = (h: Candidate) => h.hashtagScore ?? 0
  const byScore = (a: Candidate, b: Candidate) => score(b) - score(a) || (a.rank ?? 99) - (b.rank ?? 99)

  // Per-keyword quota first, so a single high-scoring keyword cannot crowd out the rest.
  const withKeywordRank = new Map<string, number>()
  let pool: Candidate[]
  if (quota > 0) {
    const grouped = new Map<string, Candidate[]>()
    for (const h of eligible) {
      const list = grouped.get(h.keywordId)
      if (list) list.push(h)
      else grouped.set(h.keywordId, [h])
    }
    pool = []
    // Keep the trending-keyword order when one is available.
    const order = p.trendingKeywords.length ? p.trendingKeywords.map((t) => t.keywordId) : Array.from(grouped.keys())
    const ids = [...order.filter((id) => grouped.has(id)), ...Array.from(grouped.keys()).filter((id) => !order.includes(id))]
    for (const id of ids) {
      const kept = (grouped.get(id) ?? []).sort(byScore).slice(0, quota)
      kept.forEach((h, i) => withKeywordRank.set(h.key, i + 1))
      pool.push(...kept)
    }
  } else {
    pool = [...eligible]
    pool.forEach((h) => withKeywordRank.set(h.key, h.rank ?? 0))
  }

  if (dedupe) {
    const byCanonical = new Map<string, Candidate>()
    for (const h of pool) {
      const canonical = HASHTAG_ALIASES[h.hashtags[0]] ?? h.hashtags[0]
      const cur = byCanonical.get(canonical)
      if (!cur || score(h) > score(cur)) byCanonical.set(canonical, h)
    }
    pool = Array.from(byCanonical.values())
  }

  const top: TopHashtag[] = pool
    .sort(byScore)
    .slice(0, topN)
    .map((h, i) => ({
      tag: h.hashtags[0],
      displayTag: h.title.replace(/^#/, ''),
      keywordId: h.keywordId,
      keywordTerm: h.keywordTerm,
      hashtagScore: score(h),
      globalRank: i + 1,
      key: h.key,
      keywordRank: withKeywordRank.get(h.key) ?? 0,
      verdict: h.verdict ?? 'pending',
      verdictReason: h.verdictReason ?? '',
      relevance: h.relevance,
      postCount: h.postCount ?? 0,
      engagementPerPost: h.engagementPerPost ?? 0,
      duplicateOf: h.duplicateOfLabel ?? null,
    }))

  const keywordsCovered = new Set(top.map((t) => t.keywordId)).size
  const held = top.filter((t) => t.verdict !== 'validated').length
  ctx.log(
    `Top ${top.length} hashtags from ${p.rankedHashtags.length} ranked · ${eligible.length} eligible (${include})` +
      `${quota > 0 ? ` · quota ${quota}/keyword across ${keywordsCovered} keywords` : ' · global ranking'}` +
      `${dedupe ? ' · de-duplicated across keywords' : ''}${held ? ` · ${held} not yet human-validated` : ''}`,
  )
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
