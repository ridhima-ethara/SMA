// Keyword trend scoring. Pure and DB-free so both the Scraping Agent (which reports
// trending keywords straight out of a scrape) and the Validation Agent (which persists
// them) score identically. Callers supply the historical baseline.
import type { ScrapedPost } from './skills/discover'

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

export interface TrendWeights {
  volume: number
  engagement: number
  velocity: number
  growth: number
}

export interface TrendInput {
  keywords: Array<{ id: string; term: string }>
  posts: ScrapedPost[]
  weights: TrendWeights
  topKeywords: number
  minPostsToRank: number
  /** keywordId → mean total engagement across the baseline window. Empty on a first run. */
  priorAverage?: Map<string, number>
  /** keywordId → how many prior runs contributed to that mean. */
  priorRuns?: Map<string, number>
}

export interface TrendResult {
  signals: KeywordSignalDraft[]
  trending: KeywordSignalDraft[]
  /** Sum of the four weights. Anything other than 100 means scores were rescaled. */
  weightSum: number
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
const norm = (v: number, max: number) => (max > 0 ? (v / max) * 100 : 0)
const ord = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`)

/**
 * Scores each keyword on volume, engagement, velocity and growth, then ranks them and
 * flags the top `topKeywords` as trending. Keywords with fewer than `minPostsToRank`
 * posts are scored but never ranked, so a single lucky post cannot top the list.
 */
export function scoreKeywordTrends(input: TrendInput): TrendResult {
  const { weights, priorAverage = new Map(), priorRuns = new Map() } = input
  const weightSum = weights.volume + weights.engagement + weights.velocity + weights.growth
  const scale = weightSum > 0 ? 100 / weightSum : 1

  const groups = new Map<string, ScrapedPost[]>()
  for (const post of input.posts) {
    const list = groups.get(post.keywordId)
    if (list) list.push(post)
    else groups.set(post.keywordId, [post])
  }

  const signals: KeywordSignalDraft[] = []
  for (const kw of input.keywords) {
    const posts = groups.get(kw.id) ?? []
    if (posts.length === 0) continue
    const total = posts.reduce((n, r) => n + r.engagement, 0)
    const velocity = posts.reduce((n, r) => n + r.velocity, 0)
    const base = priorAverage.get(kw.id) ?? 0
    const growthPct = clamp(((total - base) / Math.max(base, 1)) * 100, -100, 100)
    signals.push({
      keywordId: kw.id,
      term: kw.term,
      postCount: posts.length,
      totalEngagement: total,
      avgEngagement: Math.round((total / posts.length) * 100) / 100,
      velocity: Math.round(velocity * 100) / 100,
      growthPct: Math.round(growthPct * 100) / 100,
      trendScore: 0,
      rank: 0,
      isTrending: false,
      trendReason: '',
      components: { volume: 0, engagement: 0, velocity: 0, growth: 0 },
    })
  }

  const maxVol = Math.max(1, ...signals.map((d) => d.postCount))
  const maxEng = Math.max(1, ...signals.map((d) => d.totalEngagement))
  const maxVel = Math.max(1, ...signals.map((d) => d.velocity))
  for (const d of signals) {
    d.components = {
      volume: Math.round(norm(d.postCount, maxVol)),
      engagement: Math.round(norm(d.totalEngagement, maxEng)),
      velocity: Math.round(norm(d.velocity, maxVel)),
      // growthPct is -100..100; map onto 0..100 so a first run sits neutrally at 50.
      growth: Math.round((d.growthPct + 100) / 2),
    }
    d.trendScore = clamp(
      Math.round(
        (scale *
          (d.components.volume * weights.volume +
            d.components.engagement * weights.engagement +
            d.components.velocity * weights.velocity +
            d.components.growth * weights.growth)) /
          100,
      ),
    )
  }

  const rankable = signals.filter((d) => d.postCount >= input.minPostsToRank).sort((a, b) => b.trendScore - a.trendScore)
  const volumeOrder = [...signals].sort((a, b) => b.postCount - a.postCount)
  const growthOrder = [...signals].sort((a, b) => b.growthPct - a.growthPct)

  rankable.forEach((d, i) => {
    d.rank = i + 1
    d.isTrending = i < input.topKeywords
    const volRank = volumeOrder.indexOf(d) + 1
    const growthRank = growthOrder.indexOf(d) + 1
    const hasBase = priorAverage.get(d.keywordId) !== undefined
    const growthText = hasBase
      ? `engagement is ${d.growthPct >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(d.growthPct))}% against its ${priorRuns.get(d.keywordId)}-run average`
      : 'no prior runs to compare against yet'
    d.trendReason = `${ord(volRank)} highest volume this run (${d.postCount} posts, ${d.totalEngagement.toLocaleString()} engagement)${growthRank === 1 ? ' and the fastest-growing' : growthRank <= 3 ? ` and ${ord(growthRank)} fastest-growing` : ''}: ${growthText}. Velocity ${d.velocity}/h.`
  })
  for (const d of signals) {
    if (!rankable.includes(d)) {
      d.rank = rankable.length + 1
      d.trendReason = `Only ${d.postCount} post(s) this run — below the ${input.minPostsToRank}-post minimum to rank.`
    }
  }

  return { signals, trending: rankable.filter((d) => d.isTrending), weightSum }
}

/**
 * Loads the growth baseline from the last `windowRuns` recorded signals per keyword.
 * Returns empty maps when no history exists, which leaves growth neutral for every
 * keyword rather than favouring one — relative ranking is unaffected on a first run.
 */
export async function loadTrendBaseline(
  workspaceId: string,
  windowRuns: number,
): Promise<{ priorAverage: Map<string, number>; priorRuns: Map<string, number> }> {
  const { query } = await import('../db/pool')
  const rows = await query<{ keyword_id: string; total_engagement: number }>(
    `SELECT keyword_id, total_engagement FROM (
       SELECT keyword_id, total_engagement, row_number() OVER (PARTITION BY keyword_id ORDER BY captured_at DESC) AS rn
       FROM keyword_signals WHERE workspace_id = $1) s WHERE rn <= $2`,
    [workspaceId, windowRuns],
  )
  const totals = new Map<string, number>()
  const priorRuns = new Map<string, number>()
  for (const r of rows) {
    totals.set(r.keyword_id, (totals.get(r.keyword_id) ?? 0) + r.total_engagement)
    priorRuns.set(r.keyword_id, (priorRuns.get(r.keyword_id) ?? 0) + 1)
  }
  const priorAverage = new Map<string, number>()
  for (const [id, sum] of totals) priorAverage.set(id, sum / (priorRuns.get(id) ?? 1))
  return { priorAverage, priorRuns }
}
