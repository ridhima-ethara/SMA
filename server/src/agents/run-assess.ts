// Replays a captured Scraping Agent output through the Validation Agent and then the
// Analysis Agent, without touching Apify.
//
//   npm run agent:assess
//   npm run agent:assess -- --from out/scraper-run.json --out out/assess-run.json
//   npm run agent:assess -- --top-keywords 5 --top-hashtags-per-keyword 5 --top-hashtags 25
//   npm run agent:assess -- --dump-agents      one JSON per agent, full payloads
//
// Validation scores the keyword trend, ranks each trending keyword's hashtags and issues
// a verdict for every candidate. Analysis then clusters the validated items and emits the
// consolidated global hashtag set. Neither agent writes scraped data; the JSON file is the
// output. Run bookkeeping (agent_runs, skill_runs, activity_events) is still recorded.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillConfigValues } from '../../../shared/agent-registry'
import { closePool, query } from '../db/pool'
import { ensureWorkspace } from '../db/migrate'
import { SEED_SOURCES } from './corpus'
import { runAgent } from './runtime'
import './skills'
import type { AnalysisPayload, Candidate, ValidationPayload } from './skills/assess'
import type { HashtagCandidate, KeywordRow, ScrapedPost } from './skills/discover'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')

interface Flags {
  from: string
  out: string
  topKeywords?: number
  topHashtagsPerKeyword?: number
  topHashtags?: number
  minPostsToRank?: number
  dumpAgents: boolean
  persistTopSet: boolean
  outValidation: string
  outAnalysis: string
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { from: 'out/scraper-run.json', out: 'out/assess-run.json', dumpAgents: false, persistTopSet: false, outValidation: 'out/validation-agent-output.json', outAnalysis: 'out/analysis-agent-output.json' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--from') f.from = argv[++i] ?? f.from
    else if (a === '--out') f.out = argv[++i] ?? f.out
    else if (a === '--dump-agents') f.dumpAgents = true
    else if (a === '--persist-top-set') f.persistTopSet = true
    else if (a === '--out-validation') { f.outValidation = argv[++i] ?? f.outValidation; f.dumpAgents = true }
    else if (a === '--out-analysis') { f.outAnalysis = argv[++i] ?? f.outAnalysis; f.dumpAgents = true }
    else if (a === '--top-keywords') f.topKeywords = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--top-hashtags-per-keyword') f.topHashtagsPerKeyword = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--top-hashtags') f.topHashtags = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--min-posts-to-rank') f.minPostsToRank = Number.parseInt(argv[++i] ?? '', 10)
  }
  return f
}

interface ScrapeFile {
  meta?: Record<string, unknown>
  resolvedKeywords?: Array<{ id: string; term: string; weight?: number }>
  posts?: ScrapedPost[]
  hashtagCandidates?: HashtagCandidate[]
  competitorPosts?: AnalysisPayload['competitorPosts']
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const fromPath = isAbsolute(flags.from) ? flags.from : resolve(repoRoot, flags.from)
  const outPath = isAbsolute(flags.out) ? flags.out : resolve(repoRoot, flags.out)

  const scrape = JSON.parse(await readFile(fromPath, 'utf8')) as ScrapeFile
  const posts = scrape.posts ?? []
  const hashtagCandidates = scrape.hashtagCandidates ?? []
  if (!posts.length) throw new Error(`${fromPath} contains no posts — nothing to validate`)

  const workspaceId = await ensureWorkspace()
  // Trend scoring needs the full keyword rows; take them from the DB and restrict to
  // the keywords this scrape actually covered.
  const scrapedIds = new Set([...(scrape.resolvedKeywords ?? []).map((k) => k.id), ...posts.map((p) => p.keywordId)])
  const allKeywords = await query<KeywordRow>('SELECT id, term, category, weight, active FROM keywords WHERE workspace_id = $1 ORDER BY weight DESC', [workspaceId])
  const keywords = allKeywords.filter((k) => scrapedIds.has(k.id))
  if (!keywords.length) throw new Error('none of the scraped keyword ids exist in this workspace — re-seed or re-scrape')

  console.log(`[assess] replaying ${fromPath}`)
  console.log(`[assess] ${posts.length} posts · ${hashtagCandidates.length} hashtag candidates · ${keywords.length} keywords`)

  const validationOverrides: Record<string, SkillConfigValues> = {}
  if (flags.topKeywords !== undefined || flags.minPostsToRank !== undefined) {
    validationOverrides['validation.keyword.trend'] = {
      ...(flags.topKeywords !== undefined ? { topKeywords: flags.topKeywords } : {}),
      ...(flags.minPostsToRank !== undefined ? { minPostsToRank: flags.minPostsToRank } : {}),
    }
  }
  if (flags.topHashtagsPerKeyword !== undefined) validationOverrides['validation.hashtag.rank'] = { topHashtagsPerKeyword: flags.topHashtagsPerKeyword }

  // ── Validation ────────────────────────────────────────────────────────
  const validation = await runAgent<ValidationPayload>(
    'validation',
    {
      rawPosts: posts,
      hashtagCandidates,
      keywords,
      trustedSources: SEED_SOURCES.filter((s) => s.trusted).map((s) => s.name),
      keywordSignals: [],
      trendingKeywords: [],
      candidates: [],
      acceptThreshold: 70,
      rejectThreshold: 40,
      bucketCounts: { validated: 0, needs_review: 0, duplicate: 0, rejected: 0 },
      reviewQueue: [],
    },
    { workspaceId, inputCount: posts.length, task: 'Replay: ranking keywords and issuing verdicts', configOverrides: validationOverrides },
  )
  console.log('\n[assess] VALIDATION')
  for (const s of validation.skills) console.log(`  ${s.status.padEnd(9)} ${s.skillId} · ${s.durationMs}ms${s.note ? ` · ${s.note}` : ''}`)
  if (validation.status === 'failed') throw new Error(`Validation failed: ${validation.error}`)
  const vp = validation.payload

  const hashtagCands = vp.candidates.filter((c) => c.kind === 'hashtag')
  console.log(`\n[assess] TOP ${vp.trendingKeywords.length} KEYWORDS`)
  for (const t of vp.trendingKeywords) {
    const tags = hashtagCands.filter((h) => h.keywordId === t.keywordId).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    console.log(`  #${t.rank} ${t.term.padEnd(24)} trend=${String(t.trendScore).padStart(3)} posts=${String(t.postCount).padStart(3)} eng=${String(t.totalEngagement).padStart(4)}`)
    console.log(`      hashtags: ${tags.map((h) => `${h.rank}.${h.title}(${h.hashtagScore})`).join('  ') || 'none'}`)
  }

  // ── Analysis ──────────────────────────────────────────────────────────
  const analysisOverrides: Record<string, SkillConfigValues> = {}
  if (flags.topHashtags !== undefined) analysisOverrides['analysis.hashtag.consolidate'] = { topHashtags: flags.topHashtags }
  // `in_top_set` is the Analysis Agent's published top set — what the API and UI read.
  // A replay does not write scraped data, but leaving this stale makes the UI disagree
  // with the analysis output, so it is synced on request.

  const analysis = await runAgent<AnalysisPayload>(
    'analysis',
    {
      validatedItems: vp.candidates.filter((c) => c.kind === 'item' && c.verdict === 'validated'),
      rankedHashtags: hashtagCands,
      trendingKeywords: vp.trendingKeywords,
      competitorPosts: scrape.competitorPosts ?? [],
      clusters: [],
      topHashtags: [],
      opportunities: [],
    },
    { workspaceId, inputCount: vp.candidates.length, task: 'Replay: clustering signal into opportunities', configOverrides: analysisOverrides },
  )
  console.log('\n[assess] ANALYSIS')
  for (const s of analysis.skills) console.log(`  ${s.status.padEnd(9)} ${s.skillId} · ${s.durationMs}ms${s.note ? ` · ${s.note}` : ''}`)
  if (analysis.status === 'failed') throw new Error(`Analysis failed: ${analysis.error}`)
  const ap = analysis.payload

  const byKeyword = vp.trendingKeywords.map((t) => {
    const tags = hashtagCands.filter((h) => h.keywordId === t.keywordId).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    return {
      rank: t.rank,
      keyword: t.term,
      keywordId: t.keywordId,
      trendScore: t.trendScore,
      postCount: t.postCount,
      totalEngagement: t.totalEngagement,
      avgEngagement: t.avgEngagement,
      velocity: t.velocity,
      growthPct: t.growthPct,
      components: t.components,
      reason: t.trendReason,
      hashtags: tags.map((h) => hashtagOut(h)),
    }
  })

  const uniqueTags = new Set(ap.topHashtags.map((h) => h.tag))
  const perKeywordTotal = byKeyword.reduce((n, k) => n + k.hashtags.length, 0)

  console.log(`\n[assess] TOP ${ap.topHashtags.length} CONSOLIDATED HASHTAGS`)
  for (const h of ap.topHashtags) {
    console.log(`  ${String(h.globalRank).padStart(2)}. #${h.displayTag.padEnd(28)} score=${String(h.hashtagScore).padStart(3)} ${h.verdict.padEnd(13)} kw#${h.keywordRank} "${h.keywordTerm}"`)
  }

  const output = {
    topKeywords: byKeyword,
    /**
     * Flat view of every ranked hashtag across the trending keywords:
     * topKeywords x hashtagsPerKeyword rows, before the verdict gate and
     * cross-keyword de-duplication are applied.
     */
    hashtagsPerKeyword: byKeyword.flatMap((k) =>
      k.hashtags.map((h) => ({ keywordRank: k.rank, keyword: k.keyword, hashtagRank: h.rank, tag: h.tag, hashtagScore: h.hashtagScore, relevance: h.relevance, verdict: h.verdict, postCount: h.postCount, engagement: h.engagement })),
    ),
    topHashtagsAcrossKeywords: ap.topHashtags.map((h) => ({
      globalRank: h.globalRank,
      tag: h.displayTag,
      canonical: h.tag,
      hashtagScore: h.hashtagScore,
      keyword: h.keywordTerm,
      keywordId: h.keywordId,
      keywordRank: h.keywordRank,
      verdict: h.verdict,
      verdictReason: h.verdictReason,
      relevance: h.relevance,
      postCount: h.postCount,
      engagementPerPost: h.engagementPerPost,
      duplicateOf: h.duplicateOf,
    })),
    meta: {
      generatedAt: new Date().toISOString(),
      replayedFrom: flags.from,
      agentsRun: ['validation', 'analysis'],
      note: 'Validation and Analysis replayed over a captured Scraping Agent output. Apify was not called and no scraped_items/hashtags rows were written.',
      validation: { agentRunId: validation.agentRunId, status: validation.status, durationMs: validation.durationMs },
      analysis: { agentRunId: analysis.agentRunId, status: analysis.status, durationMs: analysis.durationMs },
      consolidation: {
        perKeywordHashtagsFromValidation: perKeywordTotal,
        consolidatedCount: ap.topHashtags.length,
        uniqueCanonicalTags: uniqueTags.size,
        keywordsCovered: new Set(ap.topHashtags.map((h) => h.keywordId)).size,
        verdictBreakdown: ap.topHashtags.reduce<Record<string, number>>((acc, h) => ({ ...acc, [h.verdict]: (acc[h.verdict] ?? 0) + 1 }), {}),
        explanation:
          'analysis.hashtag.consolidate applies a per-keyword quota (perKeywordQuota) to Validation\'s ranked hashtags, then caps the set at topHashtags. includeVerdicts controls which verdicts qualify and deduplicateAcrossKeywords controls whether canonical repeats collapse. Each row carries its own verdict, so tags still awaiting human validation are included but identifiable.',
      },
    },
    counts: {
      postsIn: posts.length,
      hashtagCandidatesIn: hashtagCandidates.length,
      keywordsScored: vp.keywordSignals.length,
      keywordsTrending: vp.trendingKeywords.length,
      candidates: vp.candidates.length,
      verdicts: vp.bucketCounts,
      reviewQueue: vp.reviewQueue.length,
      validatedItems: vp.candidates.filter((c) => c.kind === 'item' && c.verdict === 'validated').length,
      clusters: ap.clusters.length,
      opportunities: ap.opportunities.length,
    },
    skills: { validation: validation.skills, analysis: analysis.skills },
    allKeywordSignals: [...vp.keywordSignals].sort((a, b) => a.rank - b.rank),
    reviewQueue: vp.reviewQueue,
    opportunities: ap.opportunities.map((c) => ({
      title: c.title,
      keywordTerm: c.keywordTerm,
      itemCount: c.items.length,
      brandRelevance: c.brandRelevance,
      engagementScore: c.engagementScore,
      trendScore: c.trendScore,
      engagementLevel: c.engagementLevel,
      format: c.format,
      angle: c.angle,
      audience: c.audience,
      hashtags: c.hashtags,
      competitorNote: c.competitorNote,
      explanation: c.explanation,
    })),
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  if (flags.persistTopSet) {
    const synced = await persistTopSet(workspaceId, ap.topHashtags)
    console.log(`[assess] in_top_set synced · ${synced.marked} hashtag row(s) marked, ${synced.cleared} cleared${synced.missing.length ? ` · no row yet for ${synced.missing.join(', ')}` : ''}`)
  }

  console.log(`\n[assess] validation ${validation.status} · analysis ${analysis.status}`)
  console.log(`[assess] wrote ${outPath}`)

  if (flags.dumpAgents) {
    // One file per agent, each holding that agent's complete produced payload.
    const validationDump = {
      agent: 'validation',
      agentRunId: validation.agentRunId,
      status: validation.status,
      error: validation.error ?? null,
      durationMs: validation.durationMs,
      startedAt: new Date(Date.now() - validation.durationMs).toISOString(),
      inputs: { posts: posts.length, hashtagCandidates: hashtagCandidates.length, keywords: keywords.length, trustedSources: vp.trustedSources },
      thresholds: { accept: vp.acceptThreshold, reject: vp.rejectThreshold },
      skills: validation.skills,
      produces: {
        keywordSignals: [...vp.keywordSignals].sort((a, b) => a.rank - b.rank),
        trendingKeywords: vp.trendingKeywords,
        bucketCounts: vp.bucketCounts,
        candidateCount: vp.candidates.length,
        candidates: vp.candidates,
        reviewQueue: vp.reviewQueue,
      },
      note: 'Complete Validation Agent payload. `candidates` holds every scraped item and ranked hashtag with its verdict, relevance, credibility, freshness and duplicate linkage.',
    }
    const analysisDump = {
      agent: 'analysis',
      agentRunId: analysis.agentRunId,
      status: analysis.status,
      error: analysis.error ?? null,
      durationMs: analysis.durationMs,
      startedAt: new Date(Date.now() - analysis.durationMs).toISOString(),
      inputs: {
        validatedItems: vp.candidates.filter((c) => c.kind === 'item' && c.verdict === 'validated').length,
        rankedHashtags: hashtagCands.length,
        trendingKeywords: vp.trendingKeywords.length,
        competitorPosts: (scrape.competitorPosts ?? []).length,
      },
      skills: analysis.skills,
      produces: {
        topHashtags: ap.topHashtags,
        clusterCount: ap.clusters.length,
        clusters: ap.clusters.map((c) => ({
          id: c.id,
          title: c.title,
          keywordTerm: c.keywordTerm,
          keywordId: c.keywordId,
          itemCount: c.items.length,
          hashtags: c.hashtags,
          brandRelevance: c.brandRelevance,
          trendScore: c.trendScore,
          engagementLevel: c.engagementLevel,
          engagementScore: c.engagementScore,
          format: c.format,
          angle: c.angle,
          audience: c.audience,
          competitorNote: c.competitorNote,
          explanation: c.explanation,
          bestDay: c.bestDay,
        })),
        opportunities: ap.opportunities.map((c, i) => ({ priority: i + 1, id: c.id, title: c.title, keywordTerm: c.keywordTerm, brandRelevance: c.brandRelevance, engagementScore: c.engagementScore, trendScore: c.trendScore, format: c.format, angle: c.angle, explanation: c.explanation })),
      },
      note: 'Complete Analysis Agent payload. `topHashtags` is the consolidated global set — validated hashtags only, de-duplicated across keywords by canonical alias.',
    }

    const vPath = isAbsolute(flags.outValidation) ? flags.outValidation : resolve(repoRoot, flags.outValidation)
    const aPath = isAbsolute(flags.outAnalysis) ? flags.outAnalysis : resolve(repoRoot, flags.outAnalysis)
    await mkdir(dirname(vPath), { recursive: true })
    await mkdir(dirname(aPath), { recursive: true })
    await writeFile(vPath, `${JSON.stringify(validationDump, null, 2)}\n`, 'utf8')
    await writeFile(aPath, `${JSON.stringify(analysisDump, null, 2)}\n`, 'utf8')
    console.log(`[assess] wrote ${vPath}`)
    console.log(`[assess] wrote ${aPath}`)
  }
}

function hashtagOut(h: Candidate) {
  return {
    rank: h.rank,
    tag: h.title.replace(/^#/, ''),
    canonical: h.hashtags[0],
    hashtagScore: h.hashtagScore ?? 0,
    relevance: h.relevance,
    credibility: h.credibility,
    credibilityScore: h.credibilityScore,
    freshness: h.freshness,
    postCount: h.postCount ?? 0,
    engagement: h.engagement,
    engagementPerPost: h.engagementPerPost ?? 0,
    verdict: h.verdict ?? 'pending',
    verdictReason: h.verdictReason ?? '',
    isDuplicate: h.isDuplicate,
    duplicateOf: h.duplicateOfLabel ?? null,
  }
}

main()
  .then(() => closePool())
  .catch(async (err) => {
    console.error(`[assess] failed · ${err instanceof Error ? err.message : String(err)}`)
    await closePool().catch(() => undefined)
    process.exit(1)
  })

/**
 * Publishes the Analysis Agent's consolidated set to `hashtags.in_top_set`, which is what
 * the API, the Calendar Agent and the Knowledge Agent read. Only existing hashtag rows are
 * updated — a replay never invents scraped data, so a tag with no row is reported instead.
 */
async function persistTopSet(
  workspaceId: string,
  top: Array<{ tag: string; displayTag: string; hashtagScore: number; globalRank: number }>,
): Promise<{ marked: number; cleared: number; missing: string[] }> {
  const cleared = (await query<{ id: string }>('UPDATE hashtags SET in_top_set = false WHERE workspace_id = $1 AND in_top_set = true RETURNING id', [workspaceId])).length
  let marked = 0
  const missing: string[] = []
  for (const h of top) {
    const rows = await query<{ id: string }>(
      `UPDATE hashtags SET in_top_set = true, rank = $3, hashtag_score = GREATEST(hashtag_score, $4)
        WHERE id = (SELECT id FROM hashtags WHERE workspace_id = $1 AND lower(tag) = lower($2) ORDER BY hashtag_score DESC LIMIT 1)
        RETURNING id`,
      [workspaceId, h.tag, h.globalRank, h.hashtagScore],
    )
    if (rows.length) marked += rows.length
    else missing.push(`#${h.displayTag}`)
  }
  return { marked, cleared, missing }
}
