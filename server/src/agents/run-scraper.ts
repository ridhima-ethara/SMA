// Runs the Scraping Agent on its own and writes the result to a JSON file.
//
//   npm run agent:scrape                          → out/scraper-run.json
//   npm run agent:scrape -- --out foo.json        → custom path
//   npm run agent:scrape -- --max-keywords 2 --max-items 10   → small, cheap test run
//   npm run agent:scrape -- --top-per-keyword 5 --rank-by engagement
//   npm run agent:scrape -- --top-hashtags 5   → top 5 hashtags per keyword too
//   npm run agent:scrape -- --no-competitors --no-hashtag-feeds
//
// Only the `scraping` agent's skills execute. Validation, ideation and the rest of the
// pipeline are not invoked, and no scraped_items / hashtags rows are written — the JSON
// file is the sole output. Run bookkeeping (agent_runs, skill_runs, activity_events) is
// still recorded, which is how the agent reports itself.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillConfigValues } from '../../../shared/agent-registry'
import { closePool, one, query } from '../db/pool'
import { ensureWorkspace } from '../db/migrate'
import { apify } from '../integrations/apify'
import { runAgent } from './runtime'
import '../agents/skills'
import type { KeywordRow, ScrapePayload } from './skills/discover'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')

interface Flags {
  out: string
  maxKeywords?: number
  maxItems?: number
  competitors: boolean
  hashtagFeeds: boolean
  minWeight?: number
  datePosted?: string
  topPerKeyword?: number
  rankBy?: string
  topHashtags?: number
  topKeywords?: number
  minPostsToRank?: number
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { out: 'out/scraper-run.json', competitors: true, hashtagFeeds: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') flags.out = argv[++i] ?? flags.out
    else if (a === '--max-keywords') flags.maxKeywords = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--max-items') flags.maxItems = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--min-weight') flags.minWeight = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--date-posted') flags.datePosted = argv[++i]
    else if (a === '--top-keywords') flags.topKeywords = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--min-posts-to-rank') flags.minPostsToRank = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--top-per-keyword') flags.topPerKeyword = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--rank-by') flags.rankBy = argv[++i]
    else if (a === '--top-hashtags') flags.topHashtags = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--no-competitors') flags.competitors = false
    else if (a === '--no-hashtag-feeds') flags.hashtagFeeds = false
  }
  return flags
}

/** Turns CLI flags into per-skill config overrides for this run only. */
function overridesFrom(flags: Flags): Record<string, SkillConfigValues> {
  const o: Record<string, SkillConfigValues> = {}
  if (flags.maxKeywords !== undefined || flags.minWeight !== undefined) {
    o['scraping.keyword.resolve'] = {
      ...(flags.maxKeywords !== undefined ? { maxKeywordsPerRun: flags.maxKeywords } : {}),
      ...(flags.minWeight !== undefined ? { minWeight: flags.minWeight } : {}),
    }
  }
  if (flags.maxItems !== undefined || flags.datePosted) {
    o['scraping.linkedin.fetch'] = {
      ...(flags.maxItems !== undefined ? { maxItemsPerKeyword: flags.maxItems } : {}),
      ...(flags.datePosted ? { datePosted: flags.datePosted } : {}),
    }
  }
  if (flags.topPerKeyword !== undefined || flags.rankBy) {
    o['scraping.post.rank'] = {
      ...(flags.topPerKeyword !== undefined ? { topPerKeyword: flags.topPerKeyword } : {}),
      ...(flags.rankBy ? { rankBy: flags.rankBy } : {}),
    }
  }
  if (flags.topKeywords !== undefined || flags.minPostsToRank !== undefined) {
    o['scraping.keyword.trend'] = {
      ...(flags.topKeywords !== undefined ? { topKeywords: flags.topKeywords } : {}),
      ...(flags.minPostsToRank !== undefined ? { minPostsToRank: flags.minPostsToRank } : {}),
    }
  }
  if (flags.topHashtags !== undefined) o['scraping.hashtag.harvest'] = { maxPerKeyword: flags.topHashtags }
  if (!flags.hashtagFeeds) o['scraping.hashtag.expand'] = { enabled: false }
  // limit has a minimum of 1 in the actor schema, so skip the skill rather than send 0.
  if (!flags.competitors) o['scraping.competitor.track'] = { tier: 'P0 only', postsPerCompetitor: 1 }
  return o
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const outPath = isAbsolute(flags.out) ? flags.out : resolve(repoRoot, flags.out)

  if (!apify.isConfigured()) throw new Error(apify.unavailableReason())

  const workspaceId = await ensureWorkspace()
  const keywords = await query<KeywordRow>(
    'SELECT id, term, category, weight, active FROM keywords WHERE workspace_id = $1 ORDER BY weight DESC',
    [workspaceId],
  )
  const prior = await one<{ n: number }>('SELECT count(*)::int AS n FROM pipeline_runs WHERE workspace_id = $1', [workspaceId])

  const configOverrides = overridesFrom(flags)
  console.log(`[scraper] ${keywords.length} keywords in the workspace · ${keywords.filter((k) => k.active).length} active`)
  if (Object.keys(configOverrides).length) console.log(`[scraper] run overrides · ${JSON.stringify(configOverrides)}`)

  const started = new Date()
  const result = await runAgent<ScrapePayload>(
    'scraping',
    { runOffset: prior?.n ?? 0, keywords, resolvedKeywords: [], keywordSignals: [], trendingKeywords: [], rankedHashtags: [], mode: 'fixture', sources: [], unreachable: [], rawPosts: [], hashtagCandidates: [], competitorPosts: [], droppedAsSeen: 0 },
    { workspaceId, inputCount: keywords.length, task: 'Standalone scrape', configOverrides },
  )
  const p = result.payload

  for (const s of result.skills) {
    console.log(`  ${s.status.padEnd(9)} ${s.skillId} · ${s.durationMs}ms${s.note ? ` · ${s.note}` : ''}`)
  }

  const trending = p.trendingKeywords.map((t) => ({
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
    // Properly scored by scraping.hashtag.rank, not merely engagement-sorted.
    topHashtags: p.rankedHashtags
      .filter((h) => h.keywordId === t.keywordId)
      .sort((a, b) => a.rank - b.rank)
      .map((h) => ({
        rank: h.rank,
        tag: h.displayTag,
        hashtagScore: h.hashtagScore,
        relevance: h.relevance,
        recency: h.recency,
        postCount: h.postCount,
        totalEngagement: h.totalEngagement,
        engagementPerPost: h.engagementPerPost,
        feedPostCount: h.feedPostCount,
        feedEngagement: h.feedEngagement,
        inVocabulary: h.inVocabulary,
        lastSeenAt: h.lastSeenAt,
      })),
    topPosts: p.rawPosts
      .filter((r) => r.keywordId === t.keywordId)
      .sort((a, b) => (a.keywordRank ?? 0) - (b.keywordRank ?? 0))
      .map((r) => ({ rank: r.keywordRank, engagement: r.engagement, author: r.authorName, postedAt: r.postedAt, url: r.url, text: r.text })),
  }))

  const output = {
    /** The headline answer: the top trending keywords from this scrape. */
    topTrendingKeywords: trending,
    meta: {
      agent: 'scraping',
      agentRunId: result.agentRunId,
      status: result.status,
      error: result.error ?? null,
      startedAt: started.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: result.durationMs,
      mode: p.mode,
      apifyActors: { reachable: p.sources, unreachable: p.unreachable },
      note: 'Scraping agent only. No validation/ideation ran and no scraped_items or hashtags rows were written.',
    },
    counts: {
      keywordsInWorkspace: keywords.length,
      keywordsResolved: p.resolvedKeywords.length,
      keywordsScored: p.keywordSignals.length,
      keywordsTrending: p.trendingKeywords.length,
      posts: p.rawPosts.length,
      hashtagCandidates: p.hashtagCandidates.length,
      competitorPosts: p.competitorPosts.length,
      droppedAsAlreadySeen: p.droppedAsSeen,
    },
    skills: result.skills,
    resolvedKeywords: p.resolvedKeywords,
    /** Every keyword's score, including those below the ranking minimum. */
    keywordSignals: p.keywordSignals,
    rankedHashtags: p.rankedHashtags,
    /** The primary view: each keyword with its ranked posts and ranked hashtags. */
    byKeyword: p.resolvedKeywords.map((k) => ({
      keyword: k.term,
      keywordId: k.id,
      weight: k.weight,
      queries: k.queries,
      posts: p.rawPosts
        .filter((r) => r.keywordId === k.id)
        .sort((a, b) => (a.keywordRank ?? 0) - (b.keywordRank ?? 0)),
      hashtags: p.hashtagCandidates
        .filter((h) => h.keywordId === k.id)
        .sort((a, b) => b.totalEngagement - a.totalEngagement),
    })),
    posts: p.rawPosts,
    hashtagCandidates: p.hashtagCandidates,
    competitorPosts: p.competitorPosts,
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')

  if (trending.length) {
    console.log(`\n[scraper] TOP ${trending.length} TRENDING KEYWORDS`)
    for (const t of trending) {
      console.log(`  #${t.rank}  ${t.keyword.padEnd(24)} trend ${String(t.trendScore).padStart(3)} · ${t.postCount} posts · ${t.totalEngagement} engagement · ${t.velocity}/h`)
      console.log(`      volume ${t.components.volume} · engagement ${t.components.engagement} · velocity ${t.components.velocity} · growth ${t.components.growth}`)
      if (t.topHashtags.length) console.log(`      hashtags: ${t.topHashtags.map((h) => `${h.rank}.#${h.tag}(${h.hashtagScore})`).join('  ')}`)
    }
    console.log('')
  }
  console.log(
    `[scraper] ${result.status} in ${(result.durationMs / 1000).toFixed(1)}s · ` +
      `${p.rawPosts.length} posts · ${p.hashtagCandidates.length} hashtags · ${p.competitorPosts.length} competitor posts` +
      `${p.droppedAsSeen ? ` · ${p.droppedAsSeen} dropped as already seen` : ''}`,
  )
  if (result.error) console.log(`[scraper] error · ${result.error}`)
  console.log(`[scraper] wrote ${outPath}`)
}

main()
  .then(() => closePool())
  .catch(async (err) => {
    console.error(`[scraper] failed · ${err instanceof Error ? err.message : String(err)}`)
    await closePool().catch(() => undefined)
    process.exit(1)
  })
