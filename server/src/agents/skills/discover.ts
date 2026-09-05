// Scraping Agent skills — stage `discover`.
import { KEYWORD_SYNONYMS, GENERIC_HASHTAGS, normaliseTag } from '../../../../shared/keywords'
import { COMPETITORS, type CompetitorPost } from '../corpus'
import { apify, extractHashtags, type RawPost } from '../../integrations/apify'
import { query } from '../../db/pool'
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
