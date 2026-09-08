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

/** Epoch values below this are seconds, not milliseconds (≈ year 2001 in ms). */
const EPOCH_SECONDS_CEILING = 1e12

/**
 * Converts whatever the actors put in the date field into an ISO string, falling back
 * to now when it is unparseable. Date.prototype.toISOString() throws RangeError on an
 * invalid date, so the validity check has to happen before formatting, not after.
 */
export function toIsoDate(raw: unknown): string {
  const now = new Date().toISOString()
  if (raw === undefined || raw === null || raw === '') return now
  let date: Date
  if (typeof raw === 'number') {
    date = new Date(raw < EPOCH_SECONDS_CEILING ? raw * 1000 : raw)
  } else {
    const text = String(raw).trim()
    // Numeric strings are epochs, not date strings.
    date = /^\d+$/.test(text) ? new Date(Number(text) < EPOCH_SECONDS_CEILING ? Number(text) * 1000 : Number(text)) : new Date(text)
  }
  return Number.isNaN(date.getTime()) ? now : date.toISOString()
}

/**
 * The apimaestro actors report a company's audience inside the headline
 * ("14,523 followers") rather than a numeric field, so recover it from there.
 */
function followersFrom(item: Item, headline: string): number {
  const explicit = asNum(pick(item, ['author.follower_count', 'author.followers', 'authorFollowers', 'followers', 'author.followerCount']))
  if (explicit > 0) return explicit
  const match = /([\d,.]+)\s*followers?/i.exec(headline)
  return match ? asNum(match[1]) : 0
}

/** Normalises the many dataset item shapes the LinkedIn actors emit into one RawPost. */
export function normaliseItem(item: Item, keyword: string): RawPost | null {
  const text = String(pick(item, ['text', 'postText', 'content.text', 'commentary', 'description']) ?? '').trim()
  if (!text) return null
  const url = String(pick(item, ['post_url', 'url', 'postUrl', 'linkedinUrl']) ?? '')
  const externalId = String(pick(item, ['activity_id', 'activity_urn', 'full_urn', 'id', 'postId', 'urn', 'activityId']) ?? url ?? text.slice(0, 40))
  // posted_at is an object on these actors; reach into it rather than stringifying it.
  const postedRaw = pick(item, ['posted_at.timestamp', 'posted_at.date', 'postedAt', 'postedAtISO', 'publishedAt', 'date', 'postedAtTimestamp'])
  const headline = String(pick(item, ['author.headline', 'authorHeadline', 'headline']) ?? '')
  // stats.reactions is a per-type breakdown array; the scalar total lives in total_reactions.
  const declaredTags = pick(item, ['hashtags'])
  const tags = Array.isArray(declaredTags) ? declaredTags.map((t) => String(t).replace(/^#/, '')) : []
  return {
    externalId,
    text,
    authorName: String(pick(item, ['author.name', 'authorName', 'author', 'authorFullName']) ?? 'LinkedIn member'),
    authorHeadline: headline,
    authorFollowers: followersFrom(item, headline),
    url,
    postedAt: toIsoDate(postedRaw),
    reactions: asNum(pick(item, ['stats.total_reactions', 'numLikes', 'likesCount', 'stats.likes', 'totalReactionCount', 'reactions'])),
    comments: asNum(pick(item, ['stats.comments', 'numComments', 'commentsCount', 'comments'])),
    reposts: asNum(pick(item, ['stats.shares', 'stats.reposts', 'numShares', 'repostsCount', 'reposts'])),
    hashtags: Array.from(new Set([...tags, ...extractHashtags(text)])),
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
    // Field names come from the actor's own input schema. Sending the wrong keys makes
    // the actor fall back to an empty keyword and return an unfiltered generic feed.
    const items = await callActor(cfg.postsActor, {
      keyword: input.keyword,
      limit: input.maxItems,
      sort_type: input.sortBy === 'date' ? 'date_posted' : 'relevance',
      date_filter: input.datePosted,
      page_number: 1,
    }, input.retries)
    return items.map((i) => normaliseItem(i, input.keyword)).filter((p): p is RawPost => p !== null)
  },
  async fetchHashtagFeed(tag, items) {
    if (!this.isConfigured()) throw new Error(NOT_CONFIGURED)
    const cfg = env().apify
    // No dedicated hashtag actor is published, so search for the tag as a query. When
    // APIFY_LINKEDIN_HASHTAG_ACTOR names a real actor it is used instead.
    const useSearch = !cfg.hashtagActor || cfg.hashtagActor === cfg.postsActor
    const rows = useSearch
      ? await callActor(cfg.postsActor, { keyword: `#${tag}`, limit: items, sort_type: 'relevance', page_number: 1 }, 1)
      : await callActor(cfg.hashtagActor, { hashtag: tag, limit: items, page_number: 1 }, 1)
    const posts = rows.map((i) => normaliseItem(i, `#${tag}`)).filter((p): p is RawPost => p !== null)
    return { tag, postCount: posts.length, totalEngagement: posts.reduce((n, p) => n + p.reactions + p.comments * 3 + p.reposts * 5, 0), source: 'live' }
  },
  async fetchProfilePosts(profileUrl, limit) {
    if (!this.isConfigured()) throw new Error(NOT_CONFIGURED)
    const cfg = env().apify
    // The company-posts actor takes a company name or URL as `company_name`.
    const rows = await callActor(cfg.profileActor, { company_name: profileUrl, limit, sort: 'recent', page_number: 1 }, 1)
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
