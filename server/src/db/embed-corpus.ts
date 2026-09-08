// CLI for the corpus vector store.
//
//   npm run corpus:embed                    embed new/changed documents
//   npm run corpus:embed -- --force         re-embed everything
//   npm run corpus:embed -- --reindex       rebuild the ANN index only
//   npm run corpus:embed -- --dry-run       extract + chunk, no embedding calls
//   npm run corpus:embed -- --only rubric   filter by filename
//   npm run corpus:reset                    drop the store, then re-embed
//   npm run corpus:stats                    configured vs. live store shape
//   npm run corpus:search -- "query"        cosine k-NN over the stored vectors
import { fileURLToPath } from 'node:url'
import { env } from '../config'
import { closePool } from './pool'
import { CORPUS_SOURCE_TYPES, ensureVectorStore, explainSearch, isCorpusSourceType, vectorStoreStats } from './vector-store'
import { ingestCorpus, searchCorpus } from '../agents/corpus-ingest'
import { hybridRetrieve } from '../agents/retrieval'
import { embedQuery } from '../integrations/embeddings'
import { ensureWorkspace } from './migrate'

interface Flags {
  force: boolean
  reset: boolean
  drop: boolean
  reindex: boolean
  dryRun: boolean
  explain: boolean
  only?: string
  limit?: number
  source?: string
  positional: string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { force: false, reset: false, drop: false, reindex: false, dryRun: false, explain: false, positional: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--force' || arg === '-f') flags.force = true
    else if (arg === '--reset') flags.reset = true
    else if (arg === '--drop') flags.drop = true
    else if (arg === '--source') flags.source = argv[++i]
    else if (arg === '--reindex') flags.reindex = true
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--explain') flags.explain = true
    else if (arg === '--only') flags.only = argv[++i]
    else if (arg === '--limit') flags.limit = Number.parseInt(argv[++i] ?? '', 10)
    else if (!arg.startsWith('-')) flags.positional.push(arg)
  }
  return flags
}

function printConfig(): void {
  const cfg = env().embeddings
  console.log(
    `[corpus] ${cfg.provider}/${cfg.model} · ${cfg.dimensions}d · ${cfg.metric} · index ${cfg.indexKind}` +
      (cfg.indexKind === 'hnsw' ? ` (m=${cfg.hnsw.m}, ef_construction=${cfg.hnsw.efConstruction}, ef_search=${cfg.hnsw.efSearch})` : '') +
      (cfg.indexKind === 'ivfflat' ? ` (lists=${cfg.ivfflat.lists}, probes=${cfg.ivfflat.probes})` : '') +
      ` · chunks ${cfg.chunkChars}/${cfg.chunkOverlap} · dir ${cfg.corpusDir}`,
  )
}

async function cmdEmbed(flags: Flags): Promise<void> {
  printConfig()
  const workspaceId = await ensureWorkspace()
  if (flags.reindex && !flags.reset) {
    // Force a rebuild by dropping the index, then letting ensureVectorStore recreate it.
    const { getPool } = await import('./pool')
    await getPool().query('DROP INDEX IF EXISTS corpus_chunks_embedding_idx')
    const store = await ensureVectorStore()
    console.log(`[corpus] index rebuilt · ${store.indexDefinition ?? 'none'}`)
    if (!flags.force) return
  }
  const report = await ingestCorpus({
    workspaceId,
    force: flags.force,
    reset: flags.reset,
    drop: flags.drop,
    only: flags.only,
    dryRun: flags.dryRun,
    onProgress: (line) => console.log(`  ${line}`),
  })
  console.log(
    `[corpus] ${report.dryRun ? 'DRY RUN · ' : ''}${report.embedded} embedded · ${report.skipped} skipped · ${report.duplicates} duplicate · ${report.failed} failed · ` +
      `${report.chunksWritten} chunks written · ${report.totalChunks} chunks in store · dedupe ${report.dedupeScope} · ${(report.ms / 1000).toFixed(1)}s`,
  )
  const dupes = report.documents.filter((d) => d.status === 'duplicate')
  if (dupes.length) {
    console.log(`[corpus] ${dupes.length} document(s) already embedded elsewhere:`)
    for (const d of dupes) console.log(`  ${d.filename}\n    → ${d.reason}`)
  }
  if (report.indexDefinition) console.log(`[corpus] index · ${report.indexDefinition}`)
  const failures = report.documents.filter((d) => d.status === 'failed' || d.status === 'empty')
  if (failures.length) {
    console.log(`[corpus] ${failures.length} document(s) produced no vectors:`)
    for (const f of failures) console.log(`  ${f.status} · ${f.filename} · ${f.reason}`)
  }
}

async function cmdStats(): Promise<void> {
  printConfig()
  const workspaceId = await ensureWorkspace()
  const stats = await vectorStoreStats(workspaceId)
  console.log(JSON.stringify(stats, null, 2))
  console.log('\n[corpus] vector store by source:')
  if (!stats.bySource.length) console.log('  (empty)')
  for (const s of stats.bySource) {
    console.log(
      `  ${String(s.sourceType).padEnd(9)} ${s.label.padEnd(22)} ${String(s.documents).padStart(4)} docs · ${String(s.embedded).padStart(4)} embedded · ` +
        `${String(s.empty).padStart(3)} empty · ${String(s.failed).padStart(3)} failed · ${String(s.chunks).padStart(5)} chunks · last ${s.lastIngestedAt ?? 'never'}`,
    )
  }
  if (stats.drift.length) {
    console.log('[corpus] drift detected:')
    for (const d of stats.drift) console.log(`  · ${d}`)
  }
}

async function cmdSearch(flags: Flags): Promise<void> {
  const q = flags.positional.slice(1).join(' ').trim()
  if (!q) throw new Error('Usage: npm run corpus:search -- "your question"')
  printConfig()
  const workspaceId = await ensureWorkspace()
  const sourceType = flags.source && isCorpusSourceType(flags.source) ? flags.source : undefined
  if (flags.source && !sourceType) throw new Error(`--source must be one of ${CORPUS_SOURCE_TYPES.join(', ')}`)
  const result = await searchCorpus({ workspaceId, query: q, limit: flags.limit, sourceType })
  console.log(`\n[corpus] "${result.query}" · ${result.matches.length} matches · ${result.metric} · source ${sourceType ?? 'all'} · by source ${JSON.stringify(result.matchesBySource)}\n`)
  for (const [i, m] of result.matches.entries()) {
    const pages = m.pageStart === m.pageEnd ? `p${m.pageStart}` : `p${m.pageStart}-${m.pageEnd}`
    console.log(`${String(i + 1).padStart(2)}. ${m.similarity.toFixed(4)}  [${m.sourceType}]  ${m.title}  [${pages} · chunk ${m.chunkIndex}]`)
    if (m.urlPath) console.log(`    ${m.urlPath}`)
    console.log(`    ${m.content.replace(/\s+/g, ' ').slice(0, 200)}…\n`)
  }
  if (flags.explain) {
    const explained = await explainSearch(workspaceId, await embedQuery(q))
    console.log(`[corpus] ann index · used=${explained.usesAnnIndex} · usable=${explained.annIndexUsable} · ${explained.note}`)
    console.log('[corpus] query plan:')
    for (const line of explained.plan) console.log(`  ${line}`)
  }
}

async function cmdRetrieve(flags: Flags): Promise<void> {
  const q = flags.positional.slice(1).join(' ').trim()
  if (!q) throw new Error('Usage: npm run corpus:retrieve -- "your question"')
  printConfig()
  const workspaceId = await ensureWorkspace()
  const sourceType = flags.source && isCorpusSourceType(flags.source) ? flags.source : undefined
  if (flags.source && !sourceType) throw new Error(`--source must be one of ${CORPUS_SOURCE_TYPES.join(', ')}`)
  const r = await hybridRetrieve({ workspaceId, query: q, topK: flags.limit, sourceType })
  console.log(
    `\n[retrieve] "${r.query}" · dense ${r.weights.dense}/lexical ${r.weights.lexical} · quota ${r.perSourceQuota}/source · maxPerDoc ${r.maxPerDocument}` +
      `\n[retrieve] sources searched: ${r.sources.join(', ') || 'none'}` +
      `${r.sourcesUnpopulated.length ? ` · no embeddings yet: ${r.sourcesUnpopulated.join(', ')}` : ''}` +
      `${r.sourcesWithoutMatches.length ? ` · no matches: ${r.sourcesWithoutMatches.join(', ')}` : ''}` +
      `\n[retrieve] stages: dense ${r.stages.denseCandidates} + lexical ${r.stages.lexicalCandidates} → RRF ${r.stages.fusedCandidates} → re-rank ${r.stages.reranked} → returned ${r.stages.returned} ${JSON.stringify(r.counts.bySource)}` +
      `\n[retrieve] re-rank: ${r.rerank.strategy} (weight ${r.rerank.weight}) · ${r.rerank.note}\n`,
  )
  for (const hit of r.results) {
    const where = hit.urlPath ?? `${hit.filename}${hit.pageStart ? ` p${hit.pageStart}` : ''}`
    const moved = hit.rrfRank - hit.rank
    console.log(
      `${String(hit.rank).padStart(2)}. [${hit.sourceType}] final=${hit.finalScore.toFixed(5)} rrf=${hit.rrfScore.toFixed(5)}(#${hit.rrfRank}${moved === 0 ? '' : moved > 0 ? ` ↑${moved}` : ` ↓${-moved}`}) ` +
        `rerank=${hit.rerankScore === null ? '-' : hit.rerankScore.toFixed(4)} ${hit.matchedBy.join('+').padEnd(13)} dense=${hit.denseRank ?? '-'} lex=${hit.lexicalRank ?? '-'} sim=${hit.similarity ?? '-'}`,
    )
    if (hit.rerankFeatures) {
      const f = hit.rerankFeatures
      console.log(`    features: coverage=${f.coverage.toFixed(2)} phrase=${f.phrase.toFixed(2)} sim=${f.similarity.toFixed(2)}${f.llm === undefined ? '' : ` llm=${f.llm.toFixed(2)}`}`)
    }
    console.log(`    ${hit.title}  ·  ${where}`)
    console.log(`    ${hit.content.replace(/\s+/g, ' ').slice(0, 150)}…\n`)
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const flags = parseFlags(process.argv.slice(2))
  const command = flags.positional[0] ?? 'embed'
  const run =
    command === 'stats' ? cmdStats() : command === 'search' ? cmdSearch(flags) : command === 'retrieve' ? cmdRetrieve(flags) : cmdEmbed(flags)
  run
    .then(() => closePool())
    .catch(async (err) => {
      console.error(`[corpus] failed · ${err instanceof Error ? err.message : String(err)}`)
      await closePool().catch(() => undefined)
      process.exit(1)
    })
}
