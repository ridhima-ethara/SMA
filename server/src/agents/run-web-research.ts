// Knowledge Agent web research: the Analysis Agent's top hashtags → Parallel Web Systems
// search → N URLs per hashtag → read page content → embed under source 'web'.
//
//   npm run kb:web-research                                  reads out/assess-run.json
//   npm run kb:web-research -- --from out/assess-run.json --urls 4
//   npm run kb:web-research -- --source-db                   reads hashtags.in_top_set
//   npm run kb:web-research -- --limit 3 --dry-run           cheap check before spending
//   npm run kb:web-research -- --reset                       drop stored web docs first
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closePool, query } from '../db/pool'
import { ensureWorkspace } from '../db/migrate'
import { vectorStoreStats } from '../db/vector-store'
import { parallel } from '../integrations/parallel'
import { researchHashtagsFromWeb, type HashtagTargetLite } from './web-research'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')

interface Flags {
  from: string
  out: string
  urls: number
  limit?: number
  sourceDb: boolean
  dryRun: boolean
  reset: boolean
  force: boolean
  noFetch: boolean
  concurrency?: number
  allowBareDomains: boolean
  maxPerDomain?: number
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { from: 'out/assess-run.json', out: 'out/web-research.json', urls: 4, sourceDb: false, dryRun: false, reset: false, force: false, noFetch: false, allowBareDomains: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--from') f.from = argv[++i] ?? f.from
    else if (a === '--out') f.out = argv[++i] ?? f.out
    else if (a === '--urls') f.urls = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--limit') f.limit = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--source-db') f.sourceDb = true
    else if (a === '--dry-run') f.dryRun = true
    else if (a === '--reset') f.reset = true
    else if (a === '--force') f.force = true
    else if (a === '--no-fetch') f.noFetch = true
    else if (a === '--allow-bare-domains') f.allowBareDomains = true
    else if (a === '--max-per-domain') f.maxPerDomain = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--concurrency') f.concurrency = Number.parseInt(argv[++i] ?? '', 10)
  }
  return f
}

/** The Analysis Agent's consolidated hashtag set, from its output file. */
async function targetsFromFile(path: string): Promise<HashtagTargetLite[]> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as {
    topHashtagsAcrossKeywords?: Array<{ tag: string; canonical?: string; keyword?: string; globalRank?: number }>
    produces?: { topHashtags?: Array<{ displayTag: string; tag: string; keywordTerm: string; globalRank: number }> }
  }
  // Accept either the assess-run shape or the analysis-agent dump shape.
  if (raw.topHashtagsAcrossKeywords?.length) {
    return raw.topHashtagsAcrossKeywords.map((h) => ({ tag: h.canonical ?? h.tag, displayTag: h.tag, keywordTerm: h.keyword ?? '', rank: h.globalRank }))
  }
  if (raw.produces?.topHashtags?.length) {
    return raw.produces.topHashtags.map((h) => ({ tag: h.tag, displayTag: h.displayTag, keywordTerm: h.keywordTerm, rank: h.globalRank }))
  }
  throw new Error(`${path} has no topHashtagsAcrossKeywords or produces.topHashtags — is it an Analysis Agent output?`)
}

/** Fallback: whatever the last pipeline run marked as the top set. */
async function targetsFromDb(workspaceId: string): Promise<HashtagTargetLite[]> {
  const rows = await query<{ tag: string; display_tag: string; term: string | null; rank: number | null }>(
    `SELECT h.tag, h.display_tag, k.term, h.rank FROM hashtags h LEFT JOIN keywords k ON k.id = h.keyword_id
      WHERE h.workspace_id = $1 AND h.in_top_set = true ORDER BY h.hashtag_score DESC, h.rank NULLS LAST`,
    [workspaceId],
  )
  return rows.map((r) => ({ tag: r.tag, displayTag: r.display_tag, keywordTerm: r.term ?? '', rank: r.rank ?? undefined }))
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const fromPath = isAbsolute(flags.from) ? flags.from : resolve(repoRoot, flags.from)
  const outPath = isAbsolute(flags.out) ? flags.out : resolve(repoRoot, flags.out)

  if (!parallel.isConfigured()) throw new Error(parallel.unavailableReason())
  const workspaceId = await ensureWorkspace()

  let targets = flags.sourceDb ? await targetsFromDb(workspaceId) : await targetsFromFile(fromPath)
  if (!targets.length) throw new Error('no hashtags to research')
  if (flags.limit !== undefined && Number.isFinite(flags.limit)) targets = targets.slice(0, flags.limit)

  console.log(`[kb-web] ${targets.length} hashtags from ${flags.sourceDb ? 'hashtags.in_top_set' : flags.from}`)
  console.log(`[kb-web] ${flags.urls} URLs per hashtag → up to ${targets.length * flags.urls} pages · full-text fetch ${flags.noFetch ? 'off' : 'on'}`)
  console.log(`[kb-web] hashtags: ${targets.map((t) => `#${t.displayTag}`).join(' ')}`)

  if (flags.dryRun) {
    console.log('[kb-web] dry run — no Parallel calls, no embeddings')
    await writeFile(outPath, `${JSON.stringify({ dryRun: true, targets, urlsPerHashtag: flags.urls }, null, 2)}\n`, 'utf8')
    console.log(`[kb-web] wrote ${outPath}`)
    return
  }

  const before = await vectorStoreStats(workspaceId)
  const report = await researchHashtagsFromWeb({
    workspaceId,
    targets,
    urlsPerHashtag: flags.urls,
    fetchFullText: !flags.noFetch,
    force: flags.force,
    reset: flags.reset,
    concurrency: flags.concurrency,
    skipBareDomains: !flags.allowBareDomains,
    maxPerDomain: flags.maxPerDomain,
    onProgress: (line) => console.log(`  ${line}`),
  })
  const after = await vectorStoreStats(workspaceId)

  console.log(`\n[kb-web] hashtags searched ${report.hashtagsSearched}/${report.hashtagsIn}${report.hashtagsFailed ? ` · ${report.hashtagsFailed} failed` : ''}`)
  console.log(`[kb-web] URLs picked ${report.urlsPicked} · unique ${report.uniqueUrls} · fetched ${report.pagesFetched} · fetch failures ${report.fetchFailures} · too short ${report.tooShort}`)
  if (report.ingest) {
    const i = report.ingest
    console.log(`[kb-web] embedded ${i.embedded} · duplicate ${i.duplicates} · unchanged ${i.skipped} · empty ${i.empty} · failed ${i.failed} · ${i.chunksWritten} chunks written`)
  }
  console.log('[kb-web] vector store by source:')
  for (const s of after.bySource) {
    const prior = before.bySource.find((b) => b.sourceType === s.sourceType)
    console.log(`  ${String(s.sourceType).padEnd(7)} ${String(s.documents).padStart(4)} docs (${s.documents - (prior?.documents ?? 0) >= 0 ? '+' : ''}${s.documents - (prior?.documents ?? 0)}) · ${String(s.chunks).padStart(5)} chunks (+${s.chunks - (prior?.chunks ?? 0)})`)
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(
    outPath,
    `${JSON.stringify(
      {
        meta: {
          generatedAt: new Date().toISOString(),
          hashtagSource: flags.sourceDb ? 'hashtags.in_top_set' : flags.from,
          urlsPerHashtag: report.urlsPerHashtag,
          fetchFullText: !flags.noFetch,
          provider: 'parallel-web-systems',
          ms: report.ms,
        },
        summary: {
          hashtagsIn: report.hashtagsIn,
          hashtagsSearched: report.hashtagsSearched,
          hashtagsFailed: report.hashtagsFailed,
          urlsPicked: report.urlsPicked,
          uniqueUrls: report.uniqueUrls,
          pagesFetched: report.pagesFetched,
          fetchFailures: report.fetchFailures,
          tooShort: report.tooShort,
          embedded: report.ingest?.embedded ?? 0,
          duplicates: report.ingest?.duplicates ?? 0,
          chunksWritten: report.ingest?.chunksWritten ?? 0,
        },
        vectorStoreBySource: after.bySource,
        perHashtag: report.perHashtag,
        documents: report.ingest?.documents ?? [],
        searchFailures: report.searchFailures,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  console.log(`[kb-web] wrote ${outPath}`)
}

main()
  .then(() => closePool())
  .catch(async (err) => {
    console.error(`[kb-web] failed · ${err instanceof Error ? err.message : String(err)}`)
    await closePool().catch(() => undefined)
    process.exit(1)
  })
