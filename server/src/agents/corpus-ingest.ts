// Corpus → chunks → embeddings → pgvector. Idempotent: a document whose bytes and
// embedding settings are unchanged is skipped rather than re-embedded.
import { env } from '../config'
import { getPool, one, query } from '../db/pool'
import { CHUNKS_TABLE, DOCUMENTS_TABLE, dropVectorStore, ensureVectorStore, findDuplicate, resetSource, searchSimilarChunks, toVectorLiteral, type CorpusSourceType, type SimilarChunk } from '../db/vector-store'
import { bus } from '../events'
import { embedAll, embedQuery, embeddings } from '../integrations/embeddings'
import { chunkDocument, corpusRoot, listCorpusFiles, loadDocument, type CorpusFile } from './corpus-loader'

export interface IngestOptions {
  workspaceId: string
  /** Re-embed documents even when their content hash is unchanged. */
  force?: boolean
  /** Delete this source's documents first, leaving other sources untouched. */
  reset?: boolean
  /** Drop and recreate the whole store, destroying every source. Needed after a shape change. */
  drop?: boolean
  /** Case-insensitive filename filter. */
  only?: string
  /** Extract and chunk, but do not call the embedder or write rows. */
  dryRun?: boolean
  onProgress?: (line: string) => void
}

export interface DocumentResult {
  filename: string
  title: string
  /** `duplicate` means identical content was already embedded under another identity. */
  status: 'embedded' | 'skipped' | 'duplicate' | 'failed' | 'empty'
  pages: number
  chars: number
  chunks: number
  ms: number
  reason?: string
  /** Present on `duplicate`: which existing document already holds this content. */
  duplicateOf?: { source: string; sourcePath: string; title: string }
}

export interface IngestReport {
  corpusDir: string
  provider: string
  model: string
  dimensions: number
  metric: string
  indexKind: string
  indexDefinition: string | null
  dedupeScope: string
  filesFound: number
  embedded: number
  skipped: number
  /** Skipped because identical content was already embedded under another identity. */
  duplicates: number
  failed: number
  chunksWritten: number
  totalChunks: number
  ms: number
  dryRun: boolean
  documents: DocumentResult[]
}

/** Rows per multi-row INSERT. 12 params each, well inside the 65535 bind limit. */
const INSERT_BATCH = 200

/** This ingester only reads the local corpus folder; web research writes 'parallel'. */
const SOURCE: CorpusSourceType = 'corpus'

async function insertChunks(
  workspaceId: string,
  documentId: string,
  rows: Array<{ index: number; content: string; charCount: number; tokenEstimate: number; pageStart: number; pageEnd: number }>,
  vectors: number[][],
  provider: string,
  model: string,
  sourceType: CorpusSourceType,
): Promise<void> {
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    const slice = rows.slice(start, start + INSERT_BATCH)
    const values: unknown[] = []
    const tuples = slice.map((row, i) => {
      const base = i * 12
      values.push(workspaceId, documentId, row.index, row.content, row.charCount, row.tokenEstimate, row.pageStart, row.pageEnd, sourceType, provider, model, toVectorLiteral(vectors[start + i]))
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12}::vector)`
    })
    await getPool().query(
      `INSERT INTO ${CHUNKS_TABLE}
         (workspace_id, document_id, chunk_index, content, char_count, token_estimate, page_start, page_end, source_type, provider, model, embedding)
       VALUES ${tuples.join(',')}`,
      values,
    )
  }
}


/**
 * Walks the corpus folder, embeds every document and stores the vectors.
 * Per-document failures are recorded and the run continues.
 */
export async function ingestCorpus(options: IngestOptions): Promise<IngestReport> {
  const cfg = env().embeddings
  const started = Date.now()
  const log = (line: string) => options.onProgress?.(line)

  if (!options.dryRun && !embeddings.isConfigured()) throw new Error(embeddings.unavailableReason())

  if (options.drop && !options.dryRun) {
    await dropVectorStore()
    log('store dropped (all sources)')
  }
  const store = await ensureVectorStore(cfg)
  if (store.created) log('store created')
  if (options.reset && !options.drop && !options.dryRun) {
    const cleared = await resetSource(options.workspaceId, SOURCE)
    log(`cleared source '${SOURCE}': ${cleared.documents} documents · ${cleared.chunks} chunks (other sources untouched)`)
  }
  if (store.indexRebuilt) log(`${cfg.indexKind} index rebuilt for ${cfg.metric}`)

  const root = corpusRoot(cfg)
  let files = await listCorpusFiles(root)
  if (options.only) {
    const needle = options.only.toLowerCase()
    files = files.filter((f) => f.sourcePath.toLowerCase().includes(needle))
  }

  bus.publish({ type: 'corpus.embed.started', message: `Embedding ${files.length} documents from ${cfg.corpusDir}`, data: { provider: cfg.provider, model: cfg.model, dimensions: cfg.dimensions, metric: cfg.metric, indexKind: cfg.indexKind } })

  const results: DocumentResult[] = []
  let chunksWritten = 0

  for (const file of files) {
    const fileStarted = Date.now()
    try {
      const result = await ingestOne(file, options, cfg)
      results.push(result)
      chunksWritten += result.status === 'embedded' ? result.chunks : 0
      log(`${result.status.padEnd(9)} ${file.filename} · ${result.pages}p · ${result.chunks} chunks · ${result.ms}ms${result.reason ? ` · ${result.reason}` : ''}`)
      if (result.status === 'embedded') {
        bus.publish({ type: 'corpus.document.embedded', message: result.title, data: { chunks: result.chunks, pages: result.pages, provider: cfg.provider, model: cfg.model } })
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      results.push({ filename: file.filename, title: file.title, status: 'failed', pages: 0, chars: 0, chunks: 0, ms: Date.now() - fileStarted, reason })
      log(`failed   ${file.filename} · ${reason}`)
      if (!options.dryRun) {
        await query(
          `INSERT INTO ${DOCUMENTS_TABLE} (workspace_id, source_type, source_path, file_name, title, media_type, content_sha256, bytes, status, error)
           VALUES ($1,$2,$3,$4,$5,$6,'',$7,'failed',$8)
           ON CONFLICT (workspace_id, source_type, source_path)
           DO UPDATE SET status = 'failed', error = EXCLUDED.error, updated_at = now()`,
          [options.workspaceId, SOURCE, file.sourcePath, file.filename, file.title, file.mediaType, file.bytes, reason],
        ).catch(() => undefined)
      }
    }
  }

  const totals = options.dryRun
    ? { total: results.reduce((n, r) => n + r.chunks, 0) }
    : ((await one<{ total: number }>(`SELECT COUNT(*)::int AS total FROM ${CHUNKS_TABLE} WHERE workspace_id = $1`, [options.workspaceId])) ?? { total: 0 })

  const report: IngestReport = {
    corpusDir: root,
    provider: cfg.provider,
    model: cfg.model,
    dimensions: cfg.dimensions,
    metric: cfg.metric,
    indexKind: cfg.indexKind,
    indexDefinition: store.indexDefinition,
    dedupeScope: cfg.dedupeScope,
    filesFound: files.length,
    embedded: results.filter((r) => r.status === 'embedded').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    duplicates: results.filter((r) => r.status === 'duplicate').length,
    failed: results.filter((r) => r.status === 'failed').length,
    chunksWritten,
    totalChunks: totals.total,
    ms: Date.now() - started,
    dryRun: Boolean(options.dryRun),
    documents: results,
  }
  bus.publish({ type: 'corpus.embed.finished', message: `${report.embedded} embedded · ${report.skipped} skipped · ${report.failed} failed · ${report.totalChunks} chunks`, data: { ...report, documents: undefined } })
  return report
}

async function ingestOne(file: CorpusFile, options: IngestOptions, cfg = env().embeddings): Promise<DocumentResult> {
  const started = Date.now()
  const doc = await loadDocument(file)

  // One shared check for both sources: identity, then content hash, then cross-source.
  const decision = options.dryRun
    ? { action: 'embed' as const, reason: 'dry run' }
    : await findDuplicate({ workspaceId: options.workspaceId, sourceType: SOURCE, sourcePath: file.sourcePath, contentSha256: doc.sha256, force: options.force, cfg })

  if (decision.action === 'skip') {
    const isContentMatch = decision.matchKind === 'content'
    return {
      filename: file.filename,
      title: file.title,
      status: isContentMatch ? 'duplicate' : 'skipped',
      pages: doc.pages.length,
      chars: doc.charCount,
      chunks: decision.match?.chunkCount ?? 0,
      ms: Date.now() - started,
      reason: decision.reason,
      duplicateOf: isContentMatch ? { source: decision.match?.source ?? '', sourcePath: decision.match?.sourcePath ?? '', title: decision.match?.title ?? '' } : undefined,
    }
  }

  const chunks = chunkDocument(doc, cfg)
  if (!chunks.length) {
    const reason = doc.charCount === 0 ? 'no extractable text (likely a scanned PDF — needs OCR)' : `all text below EMBEDDING_MIN_CHUNK_CHARS (${cfg.minChunkChars})`
    if (!options.dryRun) {
      await query(
        `INSERT INTO ${DOCUMENTS_TABLE} (workspace_id, source_type, source_path, file_name, title, media_type, content_sha256, bytes, pages, char_count, chunk_count, status, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,'empty',$11)
         ON CONFLICT (workspace_id, source_type, source_path)
         DO UPDATE SET content_sha256 = EXCLUDED.content_sha256, pages = EXCLUDED.pages, char_count = EXCLUDED.char_count,
                       chunk_count = 0, status = 'empty', error = EXCLUDED.error, updated_at = now()`,
        [options.workspaceId, SOURCE, file.sourcePath, file.filename, file.title, file.mediaType, doc.sha256, file.bytes, doc.pages.length, doc.charCount, reason],
      )
    }
    return { filename: file.filename, title: file.title, status: 'empty', pages: doc.pages.length, chars: doc.charCount, chunks: 0, ms: Date.now() - started, reason }
  }

  if (options.dryRun) {
    return { filename: file.filename, title: file.title, status: 'embedded', pages: doc.pages.length, chars: doc.charCount, chunks: chunks.length, ms: Date.now() - started, reason: 'dry run — not embedded' }
  }

  const embedStarted = Date.now()
  const { vectors } = await embedAll(
    chunks.map((c) => c.content),
    'document',
  )
  if (vectors.length !== chunks.length) throw new Error(`embedder returned ${vectors.length} vectors for ${chunks.length} chunks`)
  const embedMs = Date.now() - embedStarted

  const row = await one<{ id: string }>(
    `INSERT INTO ${DOCUMENTS_TABLE}
       (workspace_id, source_type, source_path, file_name, title, media_type, content_sha256, bytes, pages, char_count, chunk_count, status, error, provider, model, dimensions, metric, embed_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'embedded',NULL,$12,$13,$14,$15,$16)
     ON CONFLICT (workspace_id, source_type, source_path)
     DO UPDATE SET file_name = EXCLUDED.file_name, title = EXCLUDED.title, media_type = EXCLUDED.media_type,
                   content_sha256 = EXCLUDED.content_sha256, bytes = EXCLUDED.bytes, pages = EXCLUDED.pages,
                   char_count = EXCLUDED.char_count, chunk_count = EXCLUDED.chunk_count, status = 'embedded', error = NULL,
                   provider = EXCLUDED.provider, model = EXCLUDED.model, dimensions = EXCLUDED.dimensions,
                   metric = EXCLUDED.metric, embed_ms = EXCLUDED.embed_ms, updated_at = now()
     RETURNING id`,
    [options.workspaceId, SOURCE, file.sourcePath, file.filename, file.title, file.mediaType, doc.sha256, file.bytes, doc.pages.length, doc.charCount, chunks.length, cfg.provider, cfg.model, cfg.dimensions, cfg.metric, embedMs],
  )
  if (!row) throw new Error('failed to upsert the document row')

  // Replace the previous vectors for this document rather than appending to them.
  await getPool().query(`DELETE FROM ${CHUNKS_TABLE} WHERE document_id = $1`, [row.id])
  await insertChunks(options.workspaceId, row.id, chunks, vectors, cfg.provider, cfg.model, SOURCE)

  return { filename: file.filename, title: file.title, status: 'embedded', pages: doc.pages.length, chars: doc.charCount, chunks: chunks.length, ms: Date.now() - started }
}

export interface CorpusSearchResult {
  query: string
  provider: string
  model: string
  metric: string
  dimensions: number
  /** null means both sources were searched. */
  sourceType: CorpusSourceType | null
  matchesBySource: Record<string, number>
  matches: SimilarChunk[]
}

/** Embeds the query with the query-side task type, then runs k-NN over the store. */
export async function searchCorpus(input: { workspaceId: string; query: string; limit?: number; documentId?: string; minSimilarity?: number; sourceType?: CorpusSourceType }): Promise<CorpusSearchResult> {
  const cfg = env().embeddings
  if (!input.query.trim()) throw new Error('Search query cannot be empty')
  const embedding = await embedQuery(input.query)
  const matches = await searchSimilarChunks({ workspaceId: input.workspaceId, embedding, limit: input.limit, documentId: input.documentId, minSimilarity: input.minSimilarity, sourceType: input.sourceType })
  const matchesBySource = matches.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.sourceType]: (acc[m.sourceType] ?? 0) + 1 }), {})
  return { query: input.query, provider: cfg.provider, model: cfg.model, metric: cfg.metric, dimensions: cfg.dimensions, sourceType: input.sourceType ?? null, matchesBySource, matches }
}
