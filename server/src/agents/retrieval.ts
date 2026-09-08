// Hybrid retrieval over the knowledge-base vector store, in four explicit stages:
//
//   1. RETRIEVE  dense pgvector k-NN + Postgres full-text, run per source so a large
//                corpus cannot hide a smaller one during candidate generation.
//   2. FUSE      Reciprocal Rank Fusion over the GLOBAL union of both legs. Ranks are
//                recomputed across all sources rather than within each, so scores are
//                genuinely comparable — fusing per source makes every source's rank-1
//                score identical and produces cross-source ties.
//   3. RE-RANK   a second scoring pass over the fused candidates: query-term coverage,
//                exact-phrase hits and dense similarity, or a Gemini relevance judgement.
//   4. SELECT    diversity caps (per document) and a per-source quota, so the final set
//                stays representative of both sources and does not repeat one document.
//
// Every result reports its rrfScore, rerankScore and finalScore plus the rank it held at
// each stage, so a ranking decision can always be explained.
import { env } from '../config'
import { effectiveConfig } from './runtime'
import {
  CORPUS_SOURCE_TYPES,
  populatedSources,
  searchLexicalChunks,
  searchSimilarChunks,
  SOURCE_LABELS,
  type CorpusSourceType,
  type LexicalChunk,
  type SimilarChunk,
} from '../db/vector-store'
import { embedQuery } from '../integrations/embeddings'
import { gcpText } from '../integrations/gcp-llm'

/** Conventional RRF damping constant: rank 1 scores 1/(60+1), rank 2 1/(60+2), … */
const RRF_K = 60

export const RERANK_STRATEGIES = ['none', 'heuristic', 'llm'] as const
export type RerankStrategy = (typeof RERANK_STRATEGIES)[number]

export interface RetrievedChunk {
  rank: number
  chunkId: string
  documentId: string
  title: string
  filename: string
  chunkIndex: number
  pageStart: number | null
  pageEnd: number | null
  content: string
  /** Provenance, always present so grounding can be attributed. */
  sourceType: string
  sourceLabel: string
  sourcePath: string
  urlPath: string | null
  /** Stage 2 output: fused rank score. */
  rrfScore: number
  rrfRank: number
  /** Stage 3 output: 0–1 relevance judgement, null when re-ranking is off. */
  rerankScore: number | null
  /** Blend of rrfScore and rerankScore that produced the final ordering. */
  finalScore: number
  /** Which legs found this chunk. */
  matchedBy: Array<'dense' | 'lexical'>
  denseRank: number | null
  lexicalRank: number | null
  similarity: number | null
  /** Feature breakdown behind rerankScore, for explainability. */
  rerankFeatures?: { coverage: number; phrase: number; similarity: number; llm?: number }
}

export interface HybridRetrievalResult {
  query: string
  topK: number
  sources: CorpusSourceType[]
  sourcesWithoutMatches: CorpusSourceType[]
  sourcesUnpopulated: CorpusSourceType[]
  /** Candidate counts at each stage of the pipeline. */
  stages: {
    denseCandidates: number
    lexicalCandidates: number
    fusedCandidates: number
    reranked: number
    returned: number
  }
  counts: { dense: number; lexical: number; fused: number; returned: number; bySource: Record<string, number> }
  weights: { dense: number; lexical: number }
  rerank: { strategy: RerankStrategy; weight: number; applied: boolean; note: string }
  perSourceQuota: number
  maxPerDocument: number
  results: RetrievedChunk[]
}

export interface HybridRetrievalOptions {
  workspaceId: string
  query: string
  topK?: number
  sourceType?: CorpusSourceType
  denseWeight?: number
  lexicalWeight?: number
  perSourceQuota?: number
  minSimilarity?: number
  rerankStrategy?: RerankStrategy
  rerankWeight?: number
  maxPerDocument?: number
}

interface Candidate {
  base: Omit<RetrievedChunk, 'rank' | 'rrfScore' | 'rrfRank' | 'rerankScore' | 'finalScore' | 'matchedBy' | 'denseRank' | 'lexicalRank' | 'similarity' | 'rerankFeatures'>
  denseRank: number | null
  lexicalRank: number | null
  similarity: number | null
  rrfScore: number
  rrfRank: number
  rerankScore: number | null
  rerankFeatures?: RetrievedChunk['rerankFeatures']
  finalScore: number
}

const baseOf = (c: SimilarChunk | LexicalChunk) => ({
  chunkId: c.chunkId,
  documentId: c.documentId,
  title: c.title,
  filename: c.filename,
  chunkIndex: c.chunkIndex,
  pageStart: c.pageStart,
  pageEnd: c.pageEnd,
  content: c.content,
  sourceType: c.sourceType,
  sourceLabel: c.sourceLabel,
  sourcePath: c.sourcePath,
  urlPath: c.urlPath,
})

const STOP = new Set('a an and are as at be but by for from has have how if in into is it its of on or that the their then there these this to was were what when which who why will with we our you your does do'.split(' '))

const termsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((t) => t.length > 2 && !STOP.has(t))

/**
 * Deterministic re-rank features. Cheap, explainable, and independent of the retrieval
 * legs, so a chunk that ranked well only because of vocabulary overlap can be demoted.
 */
function heuristicFeatures(query: string, content: string, similarity: number | null): { coverage: number; phrase: number; similarity: number } {
  const qTerms = Array.from(new Set(termsOf(query)))
  const haystack = content.toLowerCase()
  const hits = qTerms.filter((t) => haystack.includes(t)).length
  const coverage = qTerms.length ? hits / qTerms.length : 0
  // Reward an intact multi-word phrase from the query, which single-term coverage misses.
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  let phrase = 0
  for (let n = Math.min(4, words.length); n >= 2 && phrase === 0; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      if (haystack.includes(words.slice(i, i + n).join(' '))) {
        phrase = n / Math.min(4, Math.max(2, words.length))
        break
      }
    }
  }
  return { coverage, phrase, similarity: similarity ?? 0 }
}

/**
 * Asks Gemini to score each candidate's relevance, returning one score per candidate
 * with `undefined` where the model gave none.
 *
 * The output format is a bare positional array rather than objects: Gemini 2.5 counts
 * its thinking tokens against maxOutputTokens, and a verbose format gets truncated
 * mid-JSON. A partial response is still salvaged, and any candidate left unscored falls
 * back to its heuristic score rather than being zeroed.
 */
async function llmRerank(query: string, candidates: Candidate[]): Promise<Array<number | undefined> | null> {
  if (!gcpText.isConfigured()) return null
  const listing = candidates
    .map((c, i) => `[${i + 1}] ${c.base.title}\n${c.base.content.replace(/\s+/g, ' ').slice(0, 500)}`)
    .join('\n\n')
  const out = await gcpText
    .run({
      fast: true,
      temperature: 0,
      // Gemini 2.5 charges thinking tokens against this budget, so leave generous
      // headroom on top of the one small number needed per candidate.
      maxOutputTokens: Math.max(4096, candidates.length * 32),
      system: 'Score passage relevance. Output ONLY a JSON array of integers 0-100, one per passage, in order. Example: [90,10,55]. No keys, no prose, no code fence.',
      prompt: `Query: ${query}\n\nPassages:\n${listing}\n\nReturn exactly ${candidates.length} integers 0-100 in passage order.`,
    })
    .catch(() => null)
  if (!out) return null

  const text = out.text.replace(/```(?:json)?/g, '').trim()
  let numbers: number[] = []
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) numbers = parsed.map(Number)
  } catch {
    // Salvage a truncated array: take every integer we did receive, in order.
    numbers = Array.from(text.matchAll(/-?\d+(?:\.\d+)?/g)).map((m) => Number(m[0]))
  }
  const usable = numbers.filter((n) => Number.isFinite(n))
  if (!usable.length) return null
  return candidates.map((_, i) => (i < usable.length ? Math.min(100, Math.max(0, usable[i])) / 100 : undefined))
}

export async function hybridRetrieve(options: HybridRetrievalOptions): Promise<HybridRetrievalResult> {
  const cfg = await effectiveConfig(options.workspaceId, 'knowledge.hybrid.retrieve')
  const topK = Math.max(1, options.topK ?? Number(cfg.topK))
  const denseWeight = options.denseWeight ?? Number(cfg.denseWeight) / 100
  const lexicalWeight = options.lexicalWeight ?? Number(cfg.lexicalWeight) / 100
  const perSourceQuota = Math.max(0, options.perSourceQuota ?? Number(cfg.perSourceQuota))
  const maxPerDocument = Math.max(1, options.maxPerDocument ?? Number(cfg.maxPerDocument))
  const strategy = (options.rerankStrategy ?? String(cfg.rerankStrategy)) as RerankStrategy
  const rerankWeight = options.rerankWeight ?? Number(cfg.rerankWeight) / 100
  const rerankCandidates = Math.max(topK, Number(cfg.rerankCandidates))
  const configuredMin = Number(cfg.minSimilarity) / 100
  const minSimilarity = options.minSimilarity ?? (configuredMin > 0 ? configuredMin : undefined)
  const legLimit = Math.max(topK, perSourceQuota) * Math.max(1, Number(cfg.overFetch))

  const populated = await populatedSources(options.workspaceId)
  const sources = options.sourceType ? populated.filter((s) => s === options.sourceType) : populated
  const unpopulated = CORPUS_SOURCE_TYPES.filter((s) => !populated.includes(s))

  const emptyResult: HybridRetrievalResult = {
    query: options.query,
    topK,
    sources: [],
    sourcesWithoutMatches: [],
    sourcesUnpopulated: unpopulated,
    stages: { denseCandidates: 0, lexicalCandidates: 0, fusedCandidates: 0, reranked: 0, returned: 0 },
    counts: { dense: 0, lexical: 0, fused: 0, returned: 0, bySource: {} },
    weights: { dense: denseWeight, lexical: lexicalWeight },
    rerank: { strategy, weight: rerankWeight, applied: false, note: 'no populated source' },
    perSourceQuota,
    maxPerDocument,
    results: [],
  }
  if (!sources.length) return emptyResult

  // ── 1. RETRIEVE, per source so every source contributes candidates ────
  const embedding = denseWeight > 0 ? await embedQuery(options.query) : null
  const dense: SimilarChunk[] = []
  const lexical: LexicalChunk[] = []
  const bySourceCandidates = new Map<CorpusSourceType, number>()
  for (const source of sources) {
    const [d, l] = await Promise.all([
      embedding ? searchSimilarChunks({ workspaceId: options.workspaceId, embedding, limit: legLimit, sourceType: source, minSimilarity }) : Promise.resolve([]),
      lexicalWeight > 0 ? searchLexicalChunks({ workspaceId: options.workspaceId, query: options.query, limit: legLimit, sourceType: source }) : Promise.resolve([]),
    ])
    dense.push(...d)
    lexical.push(...l)
    bySourceCandidates.set(source, d.length + l.length)
  }

  // ── 2. FUSE with global RRF ───────────────────────────────────────────
  // Ranks are assigned over the union of all sources, so a rank-1 corpus hit and a
  // rank-1 web hit no longer receive the same reciprocal by construction.
  const globalDense = [...dense].sort((a, b) => b.similarity - a.similarity)
  const globalLexical = [...lexical].sort((a, b) => b.rank - a.rank)

  const fused = new Map<string, Candidate>()
  for (const [i, hit] of globalDense.entries()) {
    fused.set(hit.chunkId, {
      base: baseOf(hit),
      denseRank: i + 1,
      lexicalRank: null,
      similarity: hit.similarity,
      rrfScore: denseWeight / (RRF_K + i + 1),
      rrfRank: 0,
      rerankScore: null,
      finalScore: 0,
    })
  }
  for (const [i, hit] of globalLexical.entries()) {
    const existing = fused.get(hit.chunkId)
    if (existing) {
      existing.lexicalRank = i + 1
      existing.rrfScore += lexicalWeight / (RRF_K + i + 1)
    } else {
      fused.set(hit.chunkId, {
        base: baseOf(hit),
        denseRank: null,
        lexicalRank: i + 1,
        similarity: null,
        rrfScore: lexicalWeight / (RRF_K + i + 1),
        rrfRank: 0,
        rerankScore: null,
        finalScore: 0,
      })
    }
  }
  const fusedList = Array.from(fused.values()).sort((a, b) => b.rrfScore - a.rrfScore)
  fusedList.forEach((c, i) => {
    c.rrfRank = i + 1
    c.finalScore = c.rrfScore
  })

  // ── 3. RE-RANK the strongest fused candidates ─────────────────────────
  const pool = fusedList.slice(0, rerankCandidates)
  let applied = false
  let note = 'strategy none — ordering is pure RRF'
  if (strategy !== 'none' && pool.length) {
    const llmScores = strategy === 'llm' ? await llmRerank(options.query, pool) : null
    if (strategy === 'llm' && !llmScores) note = 'LLM re-rank unavailable — fell back to heuristic'
    const maxRrf = Math.max(...pool.map((c) => c.rrfScore)) || 1
    let llmScored = 0
    for (const [i, c] of pool.entries()) {
      const f = heuristicFeatures(options.query, c.base.content, c.similarity)
      // Coverage and phrase carry the signal; similarity keeps semantic matches in play.
      const heuristic = 0.45 * f.coverage + 0.25 * f.phrase + 0.3 * f.similarity
      const llm = llmScores?.[i]
      if (llm !== undefined) llmScored++
      const rerankScore = llm === undefined ? heuristic : 0.7 * llm + 0.3 * heuristic
      c.rerankScore = Math.round(rerankScore * 1e4) / 1e4
      c.rerankFeatures = { ...f, ...(llm === undefined ? {} : { llm }) }
      // Blend against RRF normalised to 0–1 so the two are on one scale.
      c.finalScore = (1 - rerankWeight) * (c.rrfScore / maxRrf) + rerankWeight * rerankScore
    }
    applied = true
    if (strategy === 'heuristic') note = 'heuristic re-rank: term coverage, exact phrase and dense similarity'
    else if (llmScores) note = `LLM re-rank via Gemini on ${llmScored}/${pool.length} candidates, blended with heuristic features`
  }
  pool.sort((a, b) => b.finalScore - a.finalScore)

  // ── 4. SELECT with diversity and per-source coverage ──────────────────
  const perDocument = new Map<string, number>()
  const chosen: Candidate[] = []
  const taken = new Set<string>()
  const admit = (c: Candidate): boolean => {
    if (taken.has(c.base.chunkId)) return false
    const used = perDocument.get(c.base.documentId) ?? 0
    if (used >= maxPerDocument) return false
    perDocument.set(c.base.documentId, used + 1)
    taken.add(c.base.chunkId)
    chosen.push(c)
    return true
  }

  // Reserve each source its quota from the re-ranked ordering.
  for (const source of sources) {
    let filled = 0
    for (const c of pool) {
      if (filled >= perSourceQuota) break
      if (c.base.sourceType !== source) continue
      if (admit(c)) filled++
    }
  }
  for (const c of pool) {
    if (chosen.length >= topK) break
    admit(c)
  }

  const results: RetrievedChunk[] = chosen
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, topK)
    .map((c, i) => ({
      rank: i + 1,
      ...c.base,
      rrfScore: Math.round(c.rrfScore * 1e6) / 1e6,
      rrfRank: c.rrfRank,
      rerankScore: c.rerankScore,
      finalScore: Math.round(c.finalScore * 1e6) / 1e6,
      matchedBy: [...(c.denseRank ? (['dense'] as const) : []), ...(c.lexicalRank ? (['lexical'] as const) : [])],
      denseRank: c.denseRank,
      lexicalRank: c.lexicalRank,
      similarity: c.similarity === null ? null : Math.round(c.similarity * 1e4) / 1e4,
      rerankFeatures: c.rerankFeatures,
    }))

  const bySource = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.sourceType]: (acc[r.sourceType] ?? 0) + 1 }), {})
  const withoutMatches = sources.filter((s) => !(bySourceCandidates.get(s) ?? 0))

  return {
    query: options.query,
    topK,
    sources,
    sourcesWithoutMatches: withoutMatches,
    sourcesUnpopulated: unpopulated,
    stages: { denseCandidates: dense.length, lexicalCandidates: lexical.length, fusedCandidates: fusedList.length, reranked: applied ? pool.length : 0, returned: results.length },
    counts: { dense: dense.length, lexical: lexical.length, fused: fusedList.length, returned: results.length, bySource },
    weights: { dense: denseWeight, lexical: lexicalWeight },
    rerank: { strategy, weight: rerankWeight, applied, note },
    perSourceQuota,
    maxPerDocument,
    results,
  }
}

/**
 * Formats retrieved chunks as attributed grounding text for a model prompt.
 * Every line names its source so the model cannot silently blend a local paper with a
 * web page, and a reader can trace any claim back.
 */
export function groundingFromRetrieval(result: HybridRetrievalResult, maxCharsPerChunk = 600): string {
  return result.results
    .map((r) => {
      const where = r.urlPath ? r.urlPath : `${r.filename}${r.pageStart ? ` p${r.pageStart}` : ''}`
      const label = SOURCE_LABELS[r.sourceType as CorpusSourceType] ?? r.sourceType
      return `[${r.rank}] (${label} · ${where}) ${r.content.replace(/\s+/g, ' ').slice(0, maxCharsPerChunk)}`
    })
    .join('\n\n')
}

/** Exposed for diagnostics: the env the retrieval legs are configured against. */
export const retrievalProvider = () => ({ provider: env().embeddings.provider, model: env().embeddings.model })
