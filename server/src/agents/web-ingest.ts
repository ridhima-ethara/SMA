// Writes web pages into the knowledge-base vector store as source_type 'web'.
// The counterpart to corpus-ingest: same chunker, same embedder, same de-duplication
// check, so both sources land in one comparable vector space.
import { createHash } from 'node:crypto'
import { env } from '../config'
import { getPool, one } from '../db/pool'
import { CHUNKS_TABLE, DOCUMENTS_TABLE, canonicalUrl, ensureVectorStore, findDuplicate, resetSource, toVectorLiteral, type CorpusSourceType } from '../db/vector-store'
import { bus } from '../events'
import { embedAll } from '../integrations/embeddings'
import { chunkDocument, estimateTokens, normalizeText, type LoadedDocument } from './corpus-loader'

const SOURCE: CorpusSourceType = 'web'
const INSERT_BATCH = 200

export interface WebPage {
  /** The URL the content came from. Canonicalised before storage. */
  url: string
  title: string
  /** Extracted page text. HTML should already be stripped by the caller. */
  text: string
  /** When the page was fetched. Defaults to now. */
  retrievedAt?: string
  /** Provider detail: search query, provider name, result rank, excerpt. */
  meta?: Record<string, unknown>
}

export interface WebDocumentResult {
  url: string
  title: string
  status: 'embedded' | 'skipped' | 'duplicate' | 'empty' | 'failed'
  chunks: number
  chars: number
  ms: number
  reason?: string
}

export interface WebIngestReport {
  provider: string
  model: string
  dimensions: number
  pagesIn: number
  embedded: number
  skipped: number
  duplicates: number
  empty: number
  failed: number
  chunksWritten: number
  ms: number
  documents: WebDocumentResult[]
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/**
 * Embeds a batch of web pages. Each page is de-duplicated against the whole store
 * first, so a page already embedded — or whose text matches a corpus document — costs
 * no embedding call.
 */
export async function ingestWebPages(options: {
  workspaceId: string
  pages: WebPage[]
  force?: boolean
  reset?: boolean
  onProgress?: (line: string) => void
}): Promise<WebIngestReport> {
  const cfg = env().embeddings
  const started = Date.now()
  const log = (line: string) => options.onProgress?.(line)

  await ensureVectorStore(cfg)
  if (options.reset) {
    const cleared = await resetSource(options.workspaceId, SOURCE)
    log(`cleared source 'web': ${cleared.documents} documents · ${cleared.chunks} chunks`)
  }

  const results: WebDocumentResult[] = []
  let chunksWritten = 0

  for (const page of options.pages) {
    const pageStarted = Date.now()
    const url = canonicalUrl(page.url)
    try {
      const text = normalizeText(page.text)
      // Hash the normalised text: the same article served twice should match even if
      // the raw markup differs.
      const sha256 = createHash('sha256').update(text).digest('hex')

      const decision = await findDuplicate({ workspaceId: options.workspaceId, sourceType: SOURCE, sourcePath: url, contentSha256: sha256, force: options.force, cfg })
      if (decision.action === 'skip') {
        results.push({
          url,
          title: page.title,
          status: decision.matchKind === 'content' ? 'duplicate' : 'skipped',
          chunks: decision.match?.chunkCount ?? 0,
          chars: text.length,
          ms: Date.now() - pageStarted,
          reason: decision.reason,
        })
        log(`${(decision.matchKind === 'content' ? 'duplicate' : 'skipped').padEnd(9)} ${url} · ${decision.reason}`)
        continue
      }

      const doc: LoadedDocument = {
        file: { absolutePath: url, sourcePath: url, filename: page.title, title: page.title, mediaType: 'text/html', bytes: Buffer.byteLength(page.text) },
        pages: [{ page: 1, text }],
        text,
        charCount: text.length,
        sha256,
      }
      const chunks = chunkDocument(doc, cfg)
      if (!chunks.length) {
        const reason = text.length === 0 ? 'no extractable text on the page' : `page text below EMBEDDING_MIN_CHUNK_CHARS (${cfg.minChunkChars})`
        await upsertDocument({ workspaceId: options.workspaceId, url, page, sha256, text, chunkCount: 0, status: 'empty', error: reason, embedMs: 0 })
        results.push({ url, title: page.title, status: 'empty', chunks: 0, chars: text.length, ms: Date.now() - pageStarted, reason })
        log(`empty     ${url} · ${reason}`)
        continue
      }

      const embedStarted = Date.now()
      const { vectors } = await embedAll(chunks.map((c) => c.content), 'document')
      if (vectors.length !== chunks.length) throw new Error(`embedder returned ${vectors.length} vectors for ${chunks.length} chunks`)

      const id = await upsertDocument({
        workspaceId: options.workspaceId,
        url,
        page,
        sha256,
        text,
        chunkCount: chunks.length,
        status: 'embedded',
        error: null,
        embedMs: Date.now() - embedStarted,
      })
      await getPool().query(`DELETE FROM ${CHUNKS_TABLE} WHERE document_id = $1`, [id])
      for (let start = 0; start < chunks.length; start += INSERT_BATCH) {
        const slice = chunks.slice(start, start + INSERT_BATCH)
        const values: unknown[] = []
        const tuples = slice.map((c, i) => {
          const base = i * 12
          values.push(options.workspaceId, id, c.index, c.content, c.charCount, estimateTokens(c.content), null, null, SOURCE, cfg.provider, cfg.model, toVectorLiteral(vectors[start + i]))
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12}::vector)`
        })
        await getPool().query(
          `INSERT INTO ${CHUNKS_TABLE} (workspace_id, document_id, chunk_index, content, char_count, token_estimate, page_start, page_end, source_type, provider, model, embedding)
           VALUES ${tuples.join(',')}`,
          values,
        )
      }

      chunksWritten += chunks.length
      results.push({ url, title: page.title, status: 'embedded', chunks: chunks.length, chars: text.length, ms: Date.now() - pageStarted })
      log(`embedded  ${url} · ${chunks.length} chunks · ${Date.now() - pageStarted}ms`)
      bus.publish({ type: 'corpus.document.embedded', message: page.title, data: { source: 'web', url, chunks: chunks.length, provider: cfg.provider, model: cfg.model } })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      results.push({ url, title: page.title, status: 'failed', chunks: 0, chars: 0, ms: Date.now() - pageStarted, reason })
      log(`failed    ${url} · ${reason}`)
    }
  }

  return {
    provider: cfg.provider,
    model: cfg.model,
    dimensions: cfg.dimensions,
    pagesIn: options.pages.length,
    embedded: results.filter((r) => r.status === 'embedded').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    duplicates: results.filter((r) => r.status === 'duplicate').length,
    empty: results.filter((r) => r.status === 'empty').length,
    failed: results.filter((r) => r.status === 'failed').length,
    chunksWritten,
    ms: Date.now() - started,
    documents: results,
  }
}

async function upsertDocument(input: {
  workspaceId: string
  url: string
  page: WebPage
  sha256: string
  text: string
  chunkCount: number
  status: string
  error: string | null
  embedMs: number
}): Promise<string> {
  const cfg = env().embeddings
  const row = await one<{ id: string }>(
    `INSERT INTO ${DOCUMENTS_TABLE}
       (workspace_id, source_type, source_path, url_path, domain, retrieved_at, source_meta,
        file_name, title, media_type, content_sha256, bytes, pages, char_count, chunk_count,
        status, error, provider, model, dimensions, metric, embed_ms)
     VALUES ($1,'web',$2,$2,$3,$4,$5,$6,$7,'text/html',$8,$9,1,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (workspace_id, source_type, source_path)
     DO UPDATE SET url_path = EXCLUDED.url_path, domain = EXCLUDED.domain, retrieved_at = EXCLUDED.retrieved_at,
                   source_meta = EXCLUDED.source_meta, file_name = EXCLUDED.file_name, title = EXCLUDED.title,
                   content_sha256 = EXCLUDED.content_sha256, bytes = EXCLUDED.bytes, char_count = EXCLUDED.char_count,
                   chunk_count = EXCLUDED.chunk_count, status = EXCLUDED.status, error = EXCLUDED.error,
                   provider = EXCLUDED.provider, model = EXCLUDED.model, dimensions = EXCLUDED.dimensions,
                   metric = EXCLUDED.metric, embed_ms = EXCLUDED.embed_ms, updated_at = now()
     RETURNING id`,
    [
      input.workspaceId,
      input.url,
      domainOf(input.url),
      input.page.retrievedAt ?? new Date().toISOString(),
      JSON.stringify(input.page.meta ?? {}),
      input.page.title,
      input.page.title,
      input.sha256,
      Buffer.byteLength(input.page.text),
      input.text.length,
      input.chunkCount,
      input.status,
      input.error,
      cfg.provider,
      cfg.model,
      cfg.dimensions,
      cfg.metric,
      input.embedMs,
    ],
  )
  if (!row) throw new Error('failed to upsert the web document row')
  return row.id
}
