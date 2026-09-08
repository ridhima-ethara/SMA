// Hashtag ranking. Pure and shared by the Scraping Agent (which reports the top tags
// per trending keyword) and the Validation Agent (which pushes them through the verdict
// gate), so both rank identically.
//
// A tag's score blends four parts, deliberately not engagement alone: raw engagement
// rewards reach-bait like #Hiring that happens to share a word with the keyword, so
// topical relevance carries equal weight.
import { BRAND_TOPICS, contentWords } from '../../../shared/brand-voice'
import { HASHTAG_VOCABULARY, normaliseTag } from '../../../shared/keywords'
import type { HashtagCandidate } from './skills/discover'

export interface RankedHashtag {
  rank: number
  tag: string
  displayTag: string
  keywordId: string
  keywordTerm: string
  postCount: number
  totalEngagement: number
  engagementPerPost: number
  feedPostCount: number | null
  feedEngagement: number | null
  feedSource: 'live' | 'fixture' | null
  /** 0–100 topical fit to the keyword, including the curated-vocabulary bonus. */
  relevance: number
  /** 0–100 recency, halving every `halfLifeHours`. */
  recency: number
  /** Weighted final score, 0–100. */
  hashtagScore: number
  /** True when the tag is in this keyword's curated vocabulary in shared/keywords.ts. */
  inVocabulary: boolean
  ageHours: number
  firstSeenAt: string
  lastSeenAt: string
}

export interface HashtagRankWeights {
  relevance: number
  engagementPerPost: number
  volume: number
  recency: number
}

/** Matches the weights previously hardcoded in validation.hashtag.rank. */
export const DEFAULT_HASHTAG_WEIGHTS: HashtagRankWeights = { relevance: 0.3, engagementPerPost: 0.3, volume: 0.2, recency: 0.2 }

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
const norm = (v: number, max: number) => (max > 0 ? (v / max) * 100 : 0)

/** "DeepReinforcementLearning" → "deep reinforcement learning" for topic matching. */
export const pretty = (tag: string): string => tag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()

export function topicOverlap(text: string, extra: string[] = []): number {
  const t = text.toLowerCase()
  let hits = 0
  for (const topic of [...BRAND_TOPICS, ...extra]) if (topic && t.includes(topic.toLowerCase())) hits++
  return hits
}

export interface HashtagRankInput {
  candidates: HashtagCandidate[]
  keywordId: string
  keywordTerm: string
  topN: number
  halfLifeHours: number
  weights?: HashtagRankWeights
  now?: number
}

/**
 * Ranks one keyword's harvested hashtags and returns the strongest `topN`.
 * Uses the independent hashtag-feed reading when the expansion step captured one,
 * since that is an unbiased volume signal rather than a by-product of this keyword.
 */
export function rankHashtagsForKeyword(input: HashtagRankInput): RankedHashtag[] {
  const { candidates, keywordTerm, topN, halfLifeHours } = input
  const weights = input.weights ?? DEFAULT_HASHTAG_WEIGHTS
  const now = input.now ?? Date.now()
  const mine = candidates.filter((h) => h.keywordId === input.keywordId)
  if (!mine.length) return []

  const volumeOf = (h: HashtagCandidate) => h.feedPostCount ?? h.postCount
  const engagementOf = (h: HashtagCandidate) => h.feedEngagement ?? h.totalEngagement
  const eppOf = (h: HashtagCandidate) => engagementOf(h) / Math.max(1, volumeOf(h))

  const maxEpp = Math.max(1, ...mine.map(eppOf))
  const maxVol = Math.max(1, ...mine.map(volumeOf))
  const vocab = (HASHTAG_VOCABULARY[keywordTerm] ?? []).map(normaliseTag)

  return mine
    .map((h) => {
      const inVocabulary = vocab.includes(h.tag)
      const relevance = clamp(40 + topicOverlap(pretty(h.displayTag), [keywordTerm, ...contentWords(keywordTerm)]) * 18 + (inVocabulary ? 25 : 0))
      const ageHours = Math.max(0.5, (now - Date.parse(h.lastSeenAt)) / 3600000)
      const recency = 100 * Math.pow(0.5, ageHours / halfLifeHours)
      const epp = eppOf(h)
      const hashtagScore = clamp(
        Math.round(
          weights.relevance * relevance +
            weights.engagementPerPost * norm(epp, maxEpp) +
            weights.volume * norm(volumeOf(h), maxVol) +
            weights.recency * recency,
        ),
      )
      return {
        rank: 0,
        tag: h.tag,
        displayTag: h.displayTag,
        keywordId: h.keywordId,
        keywordTerm,
        postCount: h.postCount,
        totalEngagement: h.totalEngagement,
        engagementPerPost: Math.round(epp * 100) / 100,
        feedPostCount: h.feedPostCount ?? null,
        feedEngagement: h.feedEngagement ?? null,
        feedSource: h.feedSource ?? null,
        relevance,
        recency: Math.round(recency),
        hashtagScore,
        inVocabulary,
        ageHours: Math.round(ageHours * 10) / 10,
        firstSeenAt: h.firstSeenAt,
        lastSeenAt: h.lastSeenAt,
      }
    })
    // Tie-break toward curated vocabulary, then relevance, so ties resolve on topic fit.
    .sort((a, b) => b.hashtagScore - a.hashtagScore || Number(b.inVocabulary) - Number(a.inVocabulary) || b.relevance - a.relevance)
    .slice(0, Math.max(1, topN))
    .map((h, i) => ({ ...h, rank: i + 1 }))
}
