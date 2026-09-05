// LinkedIn scraping adapter (Apify). Requires APIFY_API_TOKEN — there is no fabricated fallback data.
import { env } from '../config'

export interface ServiceAdapter<TIn, TOut> {
  readonly id: string
  readonly label: string
  isConfigured(): boolean
  unavailableReason(): string
  run(input: TIn): Promise<TOut>
}

export interface RawPost {
  externalId: string
  text: string
  authorName: string
  authorHeadline: string
  authorFollowers: number
  url: string
  postedAt: string
  reactions: number
  comments: number
  reposts: number
  hashtags: string[]
  keyword: string
  sourceName: string
  sourceType: 'Social' | 'News' | 'Competitor' | 'Community' | 'Website'
  source: 'live' | 'fixture'
  fallbackReason?: string
}

export interface ApifyPostsInput {
  keyword: string
  maxItems: number
  sortBy: 'relevance' | 'date'
  datePosted: 'past-24h' | 'past-week' | 'past-month'
  retries: number
}

export interface HashtagFeedReading {
  tag: string
  postCount: number
  totalEngagement: number
  source: 'live' | 'fixture'
  fallbackReason?: string
}

export const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu

export function extractHashtags(text: string): string[] {
  return Array.from(text.matchAll(HASHTAG_RE)).map((m) => m[0].slice(1))
}

type Item = Record<string, unknown>
const pick = (o: Item, keys: string[]): unknown => {
  for (const k of keys) {
    const v = k.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Item)[part] : undefined), o)
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}
const asNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? '0').replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

/** Normalises the many dataset item shapes the LinkedIn actors emit into one RawPost. */
export function normaliseItem(item: Item, keyword: string): RawPost | null {
  const text = String(pick(item, ['text', 'postText', 'content', 'commentary', 'description']) ?? '').trim()
  if (!text) return null
  const url = String(pick(item, ['url', 'postUrl', 'post_url', 'linkedinUrl']) ?? '')
  const externalId = String(pick(item, ['id', 'postId', 'urn', 'activityId']) ?? url ?? text.slice(0, 40))
  const postedRaw = pick(item, ['postedAt', 'postedAtISO', 'posted_at', 'publishedAt', 'date', 'postedAtTimestamp'])
  const postedAt = typeof postedRaw === 'number' ? new Date(postedRaw).toISOString() : postedRaw ? new Date(String(postedRaw)).toISOString() : new Date().toISOString()
  return {
    externalId,
    text,
    authorName: String(pick(item, ['author.name', 'authorName', 'author', 'authorFullName']) ?? 'LinkedIn member'),
    authorHeadline: String(pick(item, ['author.headline', 'authorHeadline', 'headline']) ?? ''),
    authorFollowers: asNum(pick(item, ['author.followers', 'authorFollowers', 'followers', 'author.followerCount'])),
    url,
    postedAt: Number.isNaN(Date.parse(postedAt)) ? new Date().toISOString() : postedAt,
    reactions: asNum(pick(item, ['numLikes', 'reactions', 'likesCount', 'stats.reactions', 'stats.likes', 'totalReactionCount'])),
    comments: asNum(pick(item, ['numComments', 'comments', 'commentsCount', 'stats.comments'])),
    reposts: asNum(pick(item, ['numShares', 'reposts', 'repostsCount', 'stats.reposts', 'stats.shares'])),
    hashtags: extractHashtags(text),
    keyword,
    sourceName: 'LinkedIn',
    sourceType: 'Social',
    source: 'live',
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function callActor(actor: string, body: Record<string, unknown>, retries: number): Promise<Item[]> {
  const cfg = env().apify
  const url = `${cfg.baseUrl}/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(cfg.token)}`
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      })
      if (!res.ok) throw new Error(`Apify ${actor} responded ${res.status}${res.status === 401 ? ' (check APIFY_API_TOKEN)' : ''}`)
      const json: unknown = await res.json()
      if (!Array.isArray(json)) throw new Error(`Apify ${actor} returned a non-array body`)
      return json as Item[]
    } catch (err) {
      lastErr = err
      if (attempt < retries) await sleep(400 * 2 ** attempt)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

const NOT_CONFIGURED = 'APIFY_API_TOKEN is not set — add it to server/.env so the Scraping Agent can call the LinkedIn actors'

export const apify: ServiceAdapter<ApifyPostsInput, RawPost[]> & {
  fetchHashtagFeed(tag: string, items: number): Promise<HashtagFeedReading>
  fetchProfilePosts(profileUrl: string, limit: number): Promise<RawPost[]>
  verifyActors(): Promise<{ ok: string[]; unreachable: string[] }>
} = {
  id: 'apify',
  label: 'Apify · LinkedIn',
  isConfigured: () => env().apify.token.length > 0,
  unavailableReason: () => (env().apify.token ? '' : NOT_CONFIGURED),
  async run(input) {
    if (!this.isConfigured()) throw new Error(NOT_CONFIGURED)
    const cfg = env().apify
    const items = await callActor(cfg.postsActor, {
      searchQuery: input.keyword,
      maxItems: input.maxItems,
      sortBy: input.sortBy,
      datePosted: input.datePosted,
      memory: cfg.memoryMbytes,
    }, input.retries)
    return items.map((i) => normaliseItem(i, input.keyword)).filter((p): p is RawPost => p !== null)
  },
  async fetchHashtagFeed(tag, items) {
    if (!this.isConfigured()) throw new Error(NOT_CONFIGURED)
    const cfg = env().apify
    const rows = await callActor(cfg.hashtagActor, { hashtag: tag, maxItems: items, memory: cfg.memoryMbytes }, 1)
    const posts = rows.map((i) => normaliseItem(i, `#${tag}`)).filter((p): p is RawPost => p !== null)
    return { tag, postCount: posts.length, totalEngagement: posts.reduce((n, p) => n + p.reactions + p.comments * 3 + p.reposts * 5, 0), source: 'live' }
  },
  async fetchProfilePosts(profileUrl, limit) {
    if (!this.isConfigured()) throw new Error(NOT_CONFIGURED)
    const cfg = env().apify
    const rows = await callActor(cfg.profileActor, { profileUrl, maxItems: limit, memory: cfg.memoryMbytes }, 1)
    return rows.map((i) => normaliseItem(i, profileUrl)).filter((p): p is RawPost => p !== null)
  },
  async verifyActors() {
    const cfg = env().apify
    const ok: string[] = []
    const unreachable: string[] = []
    for (const actor of [cfg.postsActor, cfg.hashtagActor, cfg.profileActor]) {
      try {
        const res = await fetch(`${cfg.baseUrl}/acts/${actor}?token=${encodeURIComponent(cfg.token)}`, { signal: AbortSignal.timeout(8000) })
        if (res.ok) ok.push(actor)
        else unreachable.push(actor)
      } catch {
        unreachable.push(actor)
      }
    }
    return { ok, unreachable }
  },
}
