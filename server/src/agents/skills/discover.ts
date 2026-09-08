// Scraping Agent skills — stage `discover`.
import { KEYWORD_SYNONYMS, GENERIC_HASHTAGS, normaliseTag } from '../../../../shared/keywords'
import { COMPETITORS, type CompetitorPost } from '../corpus'
import { apify, extractHashtags, type RawPost } from '../../integrations/apify'
import { query } from '../../db/pool'
import { rankHashtagsForKeyword, type HashtagRankWeights, type RankedHashtag } from '../hashtag-rank'
import { loadTrendBaseline, scoreKeywordTrends, type KeywordSignalDraft } from '../keyword-trend'
import { registerSkill } from '../runtime'

export interface KeywordRow {
  id: string
  term: string
  category: string
  weight: number
  active: boolean
}

export interface ResolvedKeyword {
  id: string
  term: string
  weight: number
  queries: string[]
}

export interface ScrapedPost extends RawPost {
  keywordId: string
  engagement: number
  engagementNorm: number
  velocity: number
  ageHours: number
  /** 1-based position within this post's keyword, set by scraping.post.rank. */
  keywordRank?: number
}

export interface HashtagCandidate {
  tag: string
  displayTag: string
  keywordId: string
  keywordTerm: string
  keywords: string[]
  postCount: number
  totalEngagement: number
  firstSeenAt: string
  lastSeenAt: string
  feedPostCount?: number
  feedEngagement?: number
  feedSource?: 'live' | 'fixture'
}

export interface ScrapePayload extends Record<string, unknown> {
  runOffset: number
  keywords: KeywordRow[]
  resolvedKeywords: ResolvedKeyword[]
  /** Trend score for every keyword that returned posts. */
  keywordSignals: KeywordSignalDraft[]
  /** The top N by trend score — the Scraping Agent's headline answer. */
  trendingKeywords: KeywordSignalDraft[]
  /** Top-scored hashtags for each trending keyword. */
  rankedHashtags: RankedHashtag[]
  mode: 'live' | 'fixture'
  fallbackReason?: string
  sources: string[]
  unreachable: string[]
  rawPosts: ScrapedPost[]
  hashtagCandidates: HashtagCandidate[]
  competitorPosts: CompetitorPost[]
  droppedAsSeen: number
  outputCount?: number
  completionNote?: string
}

const engagementOf = (p: RawPost) => p.reactions + p.comments * 3 + p.reposts * 5

registerSkill<ScrapePayload>('scraping.keyword.resolve', (p, ctx) => {
  const minWeight = ctx.num('minWeight')
  const max = ctx.num('maxKeywordsPerRun')
  const expand = ctx.bool('expandSynonyms')
  const resolved = p.keywords
    .filter((k) => k.active && k.weight >= minWeight)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .map((k) => ({ id: k.id, term: k.term, weight: k.weight, queries: expand ? [k.term, ...(KEYWORD_SYNONYMS[k.term] ?? [])] : [k.term] }))
  ctx.log(`${resolved.length} keywords resolved (weight ≥ ${minWeight}, ${expand ? 'synonyms expanded' : 'no synonyms'})`)
  return { resolvedKeywords: resolved }
})

registerSkill<ScrapePayload>('scraping.source.connect', async (_p, ctx) => {
  // No key, no scrape: the run stops here with the reason instead of inventing data.
  if (!apify.isConfigured()) {
    const reason = apify.unavailableReason()
    await ctx.activity(reason, 'error')
    throw new Error(reason)
  }
  const check = await apify.verifyActors()
  if (check.ok.length === 0) {
    const reason = `Apify actors unreachable: ${check.unreachable.join(', ')}`
    await ctx.activity(reason, 'error')
    throw new Error(reason)
  }
  if (check.unreachable.length) await ctx.activity(`Some Apify actors are unreachable: ${check.unreachable.join(', ')}`, 'warn')
  ctx.log(`Live mode · ${check.ok.length} actors reachable`)
  return { mode: 'live', sources: check.ok, unreachable: check.unreachable }
})

registerSkill<ScrapePayload>('scraping.linkedin.fetch', async (p, ctx) => {
  const maxItems = ctx.num('maxItemsPerKeyword')
  const minFollowers = ctx.num('minAuthorFollowers')
  const posts: ScrapedPost[] = []
  const failures: string[] = []
  for (const kw of p.resolvedKeywords) {
    let raw: RawPost[] = []
    try {
      raw = await apify.run({ keyword: kw.queries[0], maxItems, sortBy: ctx.str('sortBy') as 'relevance' | 'date', datePosted: ctx.str('datePosted') as 'past-24h' | 'past-week' | 'past-month', retries: ctx.num('retries') })
      raw = raw.map((r) => ({ ...r, keyword: kw.term }))
    } catch (err) {
      const reason = `Apify failed for "${kw.term}": ${err instanceof Error ? err.message : String(err)}`
      failures.push(reason)
      await ctx.activity(reason, 'warn')
      continue
    }
    for (const r of raw) {
      if (r.authorFollowers < minFollowers) continue
      const ageHours = Math.max(0.5, (Date.now() - Date.parse(r.postedAt)) / 3600000)
      posts.push({ ...r, keywordId: kw.id, engagement: engagementOf(r), engagementNorm: 0, velocity: 0, ageHours })
    }
    ctx.emit('activity', `Scraped ${raw.length} posts for "${kw.term}"`, { keyword: kw.term, keywordId: kw.id, count: raw.length, source: 'live' })
  }
  if (posts.length === 0) throw new Error(failures.length ? `Apify returned no posts. ${failures[0]}` : 'Apify returned no posts for any keyword')
  ctx.log(`${posts.length} posts fetched across ${p.resolvedKeywords.length} keywords${failures.length ? ` · ${failures.length} keyword(s) failed` : ''}`)
  return { rawPosts: posts }
})

registerSkill<ScrapePayload>('scraping.hashtag.harvest', (p, ctx) => {
  const minOcc = ctx.num('minOccurrences')
  const dropGeneric = ctx.bool('dropGeneric')
  const maxPer = ctx.num('maxPerKeyword')
  const byKey = new Map<string, HashtagCandidate & { casing: Map<string, number> }>()
  for (const post of p.rawPosts) {
    for (const raw of extractHashtags(post.text)) {
      const key = normaliseTag(raw)
      if (!key) continue
      if (dropGeneric && GENERIC_HASHTAGS.includes(key)) continue
      const k = `${post.keywordId}|${key}`
      const cur = byKey.get(k) ?? { tag: key, displayTag: raw, keywordId: post.keywordId, keywordTerm: post.keyword, keywords: [post.keyword], postCount: 0, totalEngagement: 0, firstSeenAt: post.postedAt, lastSeenAt: post.postedAt, casing: new Map() }
      cur.postCount++
      cur.totalEngagement += post.engagement
      cur.casing.set(raw, (cur.casing.get(raw) ?? 0) + 1)
      if (post.postedAt < cur.firstSeenAt) cur.firstSeenAt = post.postedAt
      if (post.postedAt > cur.lastSeenAt) cur.lastSeenAt = post.postedAt
      byKey.set(k, cur)
    }
  }
  const perKeyword = new Map<string, number>()
  const out: HashtagCandidate[] = []
  const sorted = Array.from(byKey.values()).sort((a, b) => b.totalEngagement - a.totalEngagement)
  for (const c of sorted) {
    if (c.postCount < minOcc) continue
    const n = perKeyword.get(c.keywordId) ?? 0
    if (n >= maxPer) continue
    perKeyword.set(c.keywordId, n + 1)
    const display = Array.from(c.casing.entries()).sort((a, b) => b[1] - a[1])[0][0]
    const { casing: _casing, ...rest } = c
    out.push({ ...rest, displayTag: display })
  }
  ctx.log(`${out.length} hashtag candidates from ${byKey.size} distinct tags`)
  return { hashtagCandidates: out }
})

registerSkill<ScrapePayload>('scraping.hashtag.expand', async (p, ctx) => {
  if (!ctx.bool('enabled')) { ctx.log('Feed expansion switched off'); return }
  const top = ctx.num('expandTop')
  const items = ctx.num('itemsPerHashtag')
  const targets = [...p.hashtagCandidates].sort((a, b) => b.totalEngagement - a.totalEngagement).slice(0, top)
  let live = 0
  for (const t of targets) {
    try {
      const reading = await apify.fetchHashtagFeed(t.displayTag, items)
      t.feedPostCount = reading.postCount
      t.feedEngagement = reading.totalEngagement
      t.feedSource = reading.source
      if (reading.source === 'live') live++
    } catch (err) {
      ctx.log(`feed for #${t.displayTag} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  ctx.log(`${targets.length} hashtag feeds expanded (${live} live)`)
  return { hashtagCandidates: p.hashtagCandidates }
})

registerSkill<ScrapePayload>('scraping.engagement.capture', (p, ctx) => {
  const normalise = ctx.bool('normalise')
  const window = ctx.num('velocityWindowHours')
  const max = Math.max(1, ...p.rawPosts.map((r) => r.engagement))
  for (const r of p.rawPosts) {
    r.engagementNorm = normalise ? Math.round((r.engagement / max) * 100) : r.engagement
    r.velocity = Math.round((r.engagement / Math.min(window, Math.max(1, r.ageHours))) * 100) / 100
  }
  ctx.log(`Engagement normalised against batch max ${max}`)
  return { rawPosts: p.rawPosts }
})

registerSkill<ScrapePayload>('scraping.competitor.track', async (_p, ctx) => {
  const tier = ctx.str('tier') as 'P0 only' | 'P0+P1' | 'All'
  const per = ctx.num('postsPerCompetitor')
  const out: CompetitorPost[] = []
  for (const c of COMPETITORS.filter((c) => (tier === 'P0 only' ? c.tier === 'P0' : true))) {
    try {
      const posts = await apify.fetchProfilePosts(c.url, per)
      for (const post of posts) out.push({ competitor: c.name, tier: c.tier, title: post.text.slice(0, 90), format: post.text.length > 600 ? 'Thought Leadership' : 'Short Post', engagementIndex: Math.min(100, Math.round(engagementOf(post) / 20)), ageHours: (Date.now() - Date.parse(post.postedAt)) / 3600000 })
    } catch (err) {
      ctx.log(`${c.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  ctx.log(`${out.length} competitor posts tracked (${tier})`)
  return { competitorPosts: out }
})

registerSkill<ScrapePayload>('scraping.dedupe.prefilter', async (p, ctx) => {
  const days = ctx.num('historyDays')
  const rows = await query<{ external_id: string | null; url: string | null }>(
    `SELECT external_id, url FROM scraped_items WHERE workspace_id = $1 AND scraped_at > now() - ($2 || ' days')::interval`,
    [ctx.workspaceId, String(days)],
  )
  const seenIds = new Set(rows.map((r) => r.external_id).filter(Boolean))
  const seenUrls = new Set(rows.map((r) => r.url).filter(Boolean))
  const before = p.rawPosts.length
  const kept = p.rawPosts.filter((r) => !seenIds.has(r.externalId) && !seenUrls.has(r.url))
  const dropped = before - kept.length
  ctx.log(`${dropped} already captured in the last ${days} days dropped`)
  return { rawPosts: kept, droppedAsSeen: dropped, outputCount: kept.length, completionNote: `Scraped ${kept.length} new posts · ${p.hashtagCandidates.length} hashtags` }
})

registerSkill<ScrapePayload>('scraping.keyword.trend', async (p, ctx) => {
  const weights = { volume: ctx.num('volumeWeight'), engagement: ctx.num('engagementWeight'), velocity: ctx.num('velocityWeight'), growth: ctx.num('growthWeight') }
  const { priorAverage, priorRuns } = await loadTrendBaseline(ctx.workspaceId, ctx.num('trendWindowRuns'))
  // Score against the keywords actually scraped this run, not the whole workspace list.
  const scraped = p.resolvedKeywords.length ? p.resolvedKeywords.map((k) => ({ id: k.id, term: k.term })) : p.keywords
  const { signals, trending, weightSum } = scoreKeywordTrends({
    keywords: scraped,
    posts: p.rawPosts,
    weights,
    topKeywords: ctx.num('topKeywords'),
    minPostsToRank: ctx.num('minPostsToRank'),
    priorAverage,
    priorRuns,
  })
  if (weightSum !== 100) await ctx.activity(`Trend weights sum to ${weightSum}%, not 100% — scores are rescaled`, 'warn')
  for (const d of trending) {
    ctx.emit('keyword.ranked', `#${d.rank} ${d.term} · trend ${d.trendScore}`, { keywordId: d.keywordId, term: d.term, rank: d.rank, trendScore: d.trendScore, reason: d.trendReason })
  }
  const unranked = signals.length - signals.filter((d) => d.postCount >= ctx.num('minPostsToRank')).length
  ctx.log(`top ${trending.length} of ${signals.length} scored: ${trending.map((t) => `${t.term} (${t.trendScore})`).join(', ')}${unranked ? ` · ${unranked} below the post minimum` : ''}`)
  return { keywordSignals: signals, trendingKeywords: trending }
})

registerSkill<ScrapePayload>('scraping.hashtag.rank', async (p, ctx) => {
  const topN = ctx.num('topHashtagsPerKeyword')
  const halfLifeHours = ctx.num('freshnessHalfLifeHours')
  const raw = { relevance: ctx.num('relevanceWeight'), engagementPerPost: ctx.num('engagementWeight'), volume: ctx.num('volumeWeight'), recency: ctx.num('recencyWeight') }
  const sum = raw.relevance + raw.engagementPerPost + raw.volume + raw.recency
  if (sum !== 100) await ctx.activity(`Hashtag weights sum to ${sum}%, not 100% — scores are rescaled`, 'warn')
  // Weights are percentages in the registry but fractions in the scorer.
  const scale = sum > 0 ? 1 / sum : 0
  const weights: HashtagRankWeights = { relevance: raw.relevance * scale, engagementPerPost: raw.engagementPerPost * scale, volume: raw.volume * scale, recency: raw.recency * scale }

  const ranked: RankedHashtag[] = []
  for (const kw of p.trendingKeywords) {
    ranked.push(...rankHashtagsForKeyword({ candidates: p.hashtagCandidates, keywordId: kw.keywordId, keywordTerm: kw.term, topN, halfLifeHours, weights }))
  }
  const withoutTags = p.trendingKeywords.filter((kw) => !ranked.some((h) => h.keywordId === kw.keywordId))
  ctx.log(`${ranked.length} hashtags ranked across ${p.trendingKeywords.length} trending keywords${withoutTags.length ? ` · no candidates for ${withoutTags.map((k) => k.term).join(', ')}` : ''}`)
  for (const h of ranked) {
    ctx.emit('hashtag.validated', `#${h.displayTag} · score ${h.hashtagScore}`, { tag: h.tag, keyword: h.keywordTerm, keywordId: h.keywordId, rank: h.rank, hashtagScore: h.hashtagScore, relevance: h.relevance, inVocabulary: h.inVocabulary })
  }
  return { rankedHashtags: ranked }
})

export type PostRankMetric = 'engagement' | 'engagementNorm' | 'velocity' | 'reactions'

const metricOf = (r: ScrapedPost, rankBy: PostRankMetric): number =>
  rankBy === 'engagementNorm' ? r.engagementNorm : rankBy === 'velocity' ? r.velocity : rankBy === 'reactions' ? r.reactions : r.engagement

/**
 * Keeps the `top` strongest posts for each keyword and stamps each with its 1-based
 * keywordRank. Output is grouped in resolved-keyword order, then by rank, so the
 * hand-off reads keyword by keyword. Pure so it can be exercised without Apify.
 */
export function rankPostsPerKeyword(
  posts: ScrapedPost[],
  keywordOrder: string[],
  top: number,
  rankBy: PostRankMetric = 'engagement',
): { kept: ScrapedPost[]; keywordCount: number } {
  const limit = Math.max(1, top)
  const grouped = new Map<string, ScrapedPost[]>()
  for (const post of posts) {
    const list = grouped.get(post.keywordId)
    if (list) list.push(post)
    else grouped.set(post.keywordId, [post])
  }
  // Any keyword present in the posts but absent from the declared order still gets ranked.
  const order = [...keywordOrder.filter((id) => grouped.has(id)), ...Array.from(grouped.keys()).filter((id) => !keywordOrder.includes(id))]
  const kept: ScrapedPost[] = []
  for (const keywordId of order) {
    const list = grouped.get(keywordId)
    if (!list) continue
    // Tie-break on recency so equal-metric posts rank deterministically.
    list.sort((a, b) => metricOf(b, rankBy) - metricOf(a, rankBy) || Date.parse(b.postedAt) - Date.parse(a.postedAt))
    for (const [i, post] of list.slice(0, limit).entries()) {
      post.keywordRank = i + 1
      kept.push(post)
    }
  }
  return { kept, keywordCount: grouped.size }
}

registerSkill<ScrapePayload>('scraping.post.rank', (p, ctx) => {
  const top = ctx.num('topPerKeyword')
  const rankBy = ctx.str('rankBy') as PostRankMetric
  const before = p.rawPosts.length
  const { kept, keywordCount } = rankPostsPerKeyword(p.rawPosts, p.resolvedKeywords.map((k) => k.id), top, rankBy)
  ctx.log(`top ${top} per keyword by ${rankBy} · ${kept.length} kept of ${before} across ${keywordCount} keywords`)
  return {
    rawPosts: kept,
    outputCount: kept.length,
    completionNote: `Top ${top} per keyword · ${kept.length} posts across ${keywordCount} keywords · ${p.hashtagCandidates.length} hashtags`,
  }
})
