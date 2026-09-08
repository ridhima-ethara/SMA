// pgvector store for the document corpus. All DDL is generated from env().embeddings,
// so dimensions / metric / index kind are configuration, not hardcoded schema.
import type pg from 'pg'
import { env, type EmbeddingConfig, type VectorMetric } from '../config'
import { getPool, one, query } from './pool'

/** pgvector operator class + operator for each supported distance metric. */
export const METRIC_SPEC: Record<VectorMetric, { opClass: string; operator: string; label: string; similarity: (distance: number) => number }> = {
  // <=> returns cosine distance in [0,2]; for normalized vectors similarity = 1 - distance.
  cosine: { opClass: 'vector_cosine_ops', operator: '<=>', label: 'cosine distance', similarity: (d) => 1 - d },
  // <-> returns euclidean distance in [0,inf); map to a bounded score.
  l2: { opClass: 'vector_l2_ops', operator: '<->', label: 'euclidean distance', similarity: (d) => 1 / (1 + d) },
  // <#> returns negative inner product.
  ip: { opClass: 'vector_ip_ops', operator: '<#>', label: 'negative inner product', similarity: (d) => -d },
}

export const DOCUMENTS_TABLE = 'corpus_documents'
export const CHUNKS_TABLE = 'corpus_chunks'
const EMBEDDING_INDEX = 'corpus_chunks_embedding_idx'

/**
 * Where an embedded document came from. Stored explicitly on both tables so a query
 * can tell local corpus material from web research without parsing paths.
 *   corpus — a file under CORPUS_DIR (PDF/markdown/text)
 *   web    — a page retrieved from a URL, currently via Parallel Web Systems. The
 *            specific retrieval provider is recorded in source_meta.provider so the
 *            source stays 'web' even if the provider is swapped.
 */
export const CORPUS_SOURCE_TYPES = ['corpus', 'web'] as const
export type CorpusSourceType = (typeof CORPUS_SOURCE_TYPES)[number]

/** Human-readable value stored in the generated corpus_documents.source column. */
export const SOURCE_LABELS: Record<CorpusSourceType, string> = {
  corpus: 'Corpus',
  web: 'web',
}

export function isCorpusSourceType(value: string): value is CorpusSourceType {
  return (CORPUS_SOURCE_TYPES as readonly string[]).includes(value)
}

/** SQL CHECK list, kept in sync with CORPUS_SOURCE_TYPES. */
const SOURCE_CHECK = CORPUS_SOURCE_TYPES.map((s) => `'${s}'`).join(', ')

/** pgvector refuses to build an hnsw/ivfflat index on columns wider than this. */
const MAX_INDEXABLE_DIMS = 2000
const MAX_VECTOR_DIMS = 16000

export interface VectorStoreShape {
  dimensions: number
  metric: VectorMetric
  indexKind: EmbeddingConfig['indexKind']
  opClass: string
  operator: string
  indexDefinition: string | null
}

/** Guards every number that gets interpolated into DDL. */
function positiveInt(value: number, name: string, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max} — got ${value}`)
  }
  return value
}

export function assertConfigSane(cfg: EmbeddingConfig = env().embeddings): void {
  positiveInt(cfg.dimensions, 'EMBEDDING_DIMENSIONS', MAX_VECTOR_DIMS)
  if (cfg.indexKind !== 'none' && cfg.dimensions > MAX_INDEXABLE_DIMS) {
    throw new Error(`EMBEDDING_DIMENSIONS=${cfg.dimensions} exceeds the ${MAX_INDEXABLE_DIMS}-dim limit for a pgvector ${cfg.indexKind} index — lower the dimensions or set EMBEDDING_INDEX_KIND=none`)
  }
  if (cfg.chunkOverlap >= cfg.chunkChars) {
    throw new Error(`EMBEDDING_CHUNK_OVERLAP (${cfg.chunkOverlap}) must be smaller than EMBEDDING_CHUNK_CHARS (${cfg.chunkChars})`)
  }
  positiveInt(cfg.batchSize, 'EMBEDDING_BATCH_SIZE', 2048)
  if (cfg.indexKind === 'hnsw') {
    positiveInt(cfg.hnsw.m, 'EMBEDDING_HNSW_M', 100)
    positiveInt(cfg.hnsw.efConstruction, 'EMBEDDING_HNSW_EF_CONSTRUCTION', 1000)
    positiveInt(cfg.hnsw.efSearch, 'EMBEDDING_HNSW_EF_SEARCH', 1000)
    if (cfg.hnsw.efConstruction < 2 * cfg.hnsw.m) {
      throw new Error(`EMBEDDING_HNSW_EF_CONSTRUCTION (${cfg.hnsw.efConstruction}) must be at least 2 × EMBEDDING_HNSW_M (${2 * cfg.hnsw.m}) — pgvector rejects the index otherwise`)
    }
  }
  if (cfg.indexKind === 'ivfflat') {
    positiveInt(cfg.ivfflat.lists, 'EMBEDDING_IVFFLAT_LISTS', 32768)
    positiveInt(cfg.ivfflat.probes, 'EMBEDDING_IVFFLAT_PROBES', 32768)
  }
}

export async function vectorExtensionVersion(): Promise<string | null> {
  const row = await one<{ extversion: string }>(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`)
  return row?.extversion ?? null
}

async function assertExtension(): Promise<void> {
  if (await vectorExtensionVersion()) return
  // CREATE EXTENSION IF NOT EXISTS is a no-op when present, but creating it fresh needs superuser.
  try {
    await getPool().query('CREATE EXTENSION IF NOT EXISTS vector')
  } catch {
    throw new Error(
      'The pgvector extension is not installed in this database and the app role cannot create it. ' +
        'Install the binary (macOS: `brew install pgvector`, Debian: `apt install postgresql-17-pgvector`), ' +
        'then run `CREATE EXTENSION vector;` in the app database as a Postgres superuser.',
    )
  }
}

/** Current dimension of the stored embedding column, or null when the table does not exist yet. */
export async function storedDimensions(): Promise<number | null> {
  const row = await one<{ formatted: string }>(
    `SELECT format_type(a.atttypid, a.atttypmod) AS formatted
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = $1 AND a.attname = 'embedding' AND a.attnum > 0 AND NOT a.attisdropped
        AND n.nspname = current_schema()`,
    [CHUNKS_TABLE],
  )
  if (!row) return null
  const match = /vector\((\d+)\)/.exec(row.formatted)
  return match ? Number.parseInt(match[1], 10) : null
}

export async function embeddingIndexDefinition(): Promise<string | null> {
  const row = await one<{ def: string }>(
    `SELECT pg_get_indexdef(i.indexrelid) AS def
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = $1`,
    [EMBEDDING_INDEX],
  )
  return row?.def ?? null
}

function indexStatement(cfg: EmbeddingConfig): string | null {
  const { opClass } = METRIC_SPEC[cfg.metric]
  if (cfg.indexKind === 'hnsw') {
    return `CREATE INDEX ${EMBEDDING_INDEX} ON ${CHUNKS_TABLE} USING hnsw (embedding ${opClass}) WITH (m = ${cfg.hnsw.m}, ef_construction = ${cfg.hnsw.efConstruction})`
  }
  if (cfg.indexKind === 'ivfflat') {
    return `CREATE INDEX ${EMBEDDING_INDEX} ON ${CHUNKS_TABLE} USING ivfflat (embedding ${opClass}) WITH (lists = ${cfg.ivfflat.lists})`
  }
  return null
}

/** True when the live index no longer matches the configured kind / metric / build params. */
function indexIsStale(existing: string, cfg: EmbeddingConfig): boolean {
  const { opClass } = METRIC_SPEC[cfg.metric]
  if (cfg.indexKind === 'hnsw') {
    return !(
      / USING hnsw /.test(existing) &&
      existing.includes(opClass) &&
      new RegExp(`m\\s*=\\s*'?${cfg.hnsw.m}'?\\b`).test(existing) &&
      new RegExp(`ef_construction\\s*=\\s*'?${cfg.hnsw.efConstruction}'?\\b`).test(existing)
    )
  }
  if (cfg.indexKind === 'ivfflat') {
    return !(/ USING ivfflat /.test(existing) && existing.includes(opClass) && new RegExp(`lists\\s*=\\s*'?${cfg.ivfflat.lists}'?\\b`).test(existing))
  }
  return true // indexKind 'none' — any existing index is stale
}

/**
 * Adds the provenance columns to stores created before source tracking existed and
 * backfills them as 'corpus', which is what those rows were. Idempotent: every
 * statement is a no-op once applied, so it is safe on every boot.
 */
async function columnExists(table: string, column: string): Promise<boolean> {
  const row = await one<{ n: number }>(
    `SELECT 1 AS n FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = $1 AND a.attname = $2 AND a.attnum > 0 AND NOT a.attisdropped AND n.nspname = current_schema()`,
    [table, column],
  )
  return Boolean(row)
}

async function migrateSourceColumns(): Promise<void> {
  const pool = getPool()

  // `filename` predates the two-source design; align it with the documented name.
  // RENAME COLUMN has no IF EXISTS, so check the catalog first.
  if ((await columnExists(DOCUMENTS_TABLE, 'filename')) && !(await columnExists(DOCUMENTS_TABLE, 'file_name'))) {
    await pool.query(`ALTER TABLE ${DOCUMENTS_TABLE} RENAME COLUMN filename TO file_name`)
  }

  // `source_url` was the earlier name for the web document's address.
  if ((await columnExists(DOCUMENTS_TABLE, 'source_url')) && !(await columnExists(DOCUMENTS_TABLE, 'url_path'))) {
    await pool.query(`ALTER TABLE ${DOCUMENTS_TABLE} RENAME COLUMN source_url TO url_path`)
  }

  await pool.query(`
    ALTER TABLE ${DOCUMENTS_TABLE} ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'corpus';
    ALTER TABLE ${DOCUMENTS_TABLE} ADD COLUMN IF NOT EXISTS url_path TEXT;
    ALTER TABLE ${DOCUMENTS_TABLE} ADD COLUMN IF NOT EXISTS domain TEXT;
    ALTER TABLE ${DOCUMENTS_TABLE} ADD COLUMN IF NOT EXISTS retrieved_at TIMESTAMPTZ;
    ALTER TABLE ${DOCUMENTS_TABLE} ADD COLUMN IF NOT EXISTS source_meta JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE ${CHUNKS_TABLE} ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'corpus';
  `)

  // The web source was previously identified by the provider name. Remap before the
  // CHECK constraint is rebuilt, or the new constraint would reject those rows.
  await pool.query(`UPDATE ${DOCUMENTS_TABLE} SET source_type = 'web' WHERE source_type = 'parallel'`)
  await pool.query(`UPDATE ${CHUNKS_TABLE} SET source_type = 'web' WHERE source_type = 'parallel'`)

  // CHECK constraints have no IF NOT EXISTS, and the allowed set changes over time,
  // so rebuild whenever the live definition no longer lists every current source.
  for (const table of [DOCUMENTS_TABLE, CHUNKS_TABLE]) {
    const name = `${table}_source_type_check`
    const existing = await one<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = $1 AND c.conname = $2`,
      [table, name],
    )
    const stale = existing ? !CORPUS_SOURCE_TYPES.every((s) => existing.def.includes(`'${s}'`)) : false
    if (existing && stale) await pool.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`)
    if (!existing || stale) {
      await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (source_type IN (${SOURCE_CHECK}))`).catch(() => undefined)
    }
  }
  // Human-readable source label. A STORED generated column rather than an app-written
  // one so it can never drift from source_type. A generated expression cannot be
  // altered in place, so when the labels change the column is rebuilt.
  const cases = CORPUS_SOURCE_TYPES.map((s) => `WHEN '${s}' THEN '${SOURCE_LABELS[s]}'`).join(' ')
  const generated = `CASE source_type ${cases} ELSE source_type END`
  const current = await one<{ expr: string }>(
    `SELECT pg_get_expr(d.adbin, d.adrelid) AS expr
       FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.adnum
      WHERE c.relname = $1 AND a.attname = 'source' AND a.attgenerated = 's'`,
    [DOCUMENTS_TABLE],
  )
  // Compare on the label values, which is what actually changes.
  const stale = current ? CORPUS_SOURCE_TYPES.some((s) => !current.expr.includes(`'${SOURCE_LABELS[s]}'`)) : false
  if (current && stale) await pool.query(`ALTER TABLE ${DOCUMENTS_TABLE} DROP COLUMN source`)
  if (!current || stale) {
    await pool.query(`ALTER TABLE ${DOCUMENTS_TABLE} ADD COLUMN source TEXT GENERATED ALWAYS AS (${generated}) STORED`)
  }

  // Identity is unique per source, so a file path and a URL can never collide.
  await pool.query(`DROP INDEX IF EXISTS ${DOCUMENTS_TABLE}_ws_path_idx`)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${DOCUMENTS_TABLE}_ws_source_path_idx ON ${DOCUMENTS_TABLE} (workspace_id, source_type, source_path)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS ${DOCUMENTS_TABLE}_ws_source_idx ON ${DOCUMENTS_TABLE} (workspace_id, source_type)`)
  // Backs the content-hash de-duplication lookup across both sources.
  await pool.query(`CREATE INDEX IF NOT EXISTS ${DOCUMENTS_TABLE}_ws_sha_idx ON ${DOCUMENTS_TABLE} (workspace_id, content_sha256)`)
  // Repair any chunk whose source drifted from its parent document.
  await pool.query(`
    UPDATE ${CHUNKS_TABLE} c SET source_type = d.source_type
      FROM ${DOCUMENTS_TABLE} d
     WHERE c.document_id = d.id AND c.source_type <> d.source_type
  `)
}

export interface EnsureResult extends VectorStoreShape {
  extension: string
  created: boolean
  indexRebuilt: boolean
}

/**
 * Idempotently creates the corpus tables and the ANN index at the configured shape.
 * Refuses to touch a store whose vector width differs from the config instead of
 * mixing incompatible embeddings.
 */
export async function ensureVectorStore(cfg: EmbeddingConfig = env().embeddings): Promise<EnsureResult> {
  assertConfigSane(cfg)
  await assertExtension()
  const extension = (await vectorExtensionVersion()) as string

  const existingDims = await storedDimensions()
  if (existingDims !== null && existingDims !== cfg.dimensions) {
    throw new Error(
      `${CHUNKS_TABLE}.embedding is vector(${existingDims}) but EMBEDDING_DIMENSIONS is ${cfg.dimensions}. ` +
        'Vectors of different widths cannot share a column — run `npm run corpus:reset` to rebuild the store at the new size.',
    )
  }

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ${DOCUMENTS_TABLE} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      -- Provenance: which of the two ingestion sources produced this document.
      source_type TEXT NOT NULL DEFAULT 'corpus' CHECK (source_type IN (${SOURCE_CHECK})),
      -- Stable identity within its source: a path under CORPUS_DIR, or the URL for web research.
      source_path TEXT NOT NULL,
      -- Web-only provenance, NULL for corpus files.
      url_path TEXT,
      domain TEXT,
      retrieved_at TIMESTAMPTZ,
      -- Provider-specific detail: search query, Parallel run id, result rank, excerpt.
      source_meta JSONB NOT NULL DEFAULT '{}',
      file_name TEXT NOT NULL,
      title TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'application/pdf',
      content_sha256 TEXT NOT NULL,
      bytes BIGINT NOT NULL DEFAULT 0,
      pages INT NOT NULL DEFAULT 0,
      char_count INT NOT NULL DEFAULT 0,
      chunk_count INT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      provider TEXT,
      model TEXT,
      dimensions INT,
      metric TEXT,
      embed_ms INT,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ${DOCUMENTS_TABLE}_ws_status_idx ON ${DOCUMENTS_TABLE} (workspace_id, status);
  `)

  await migrateSourceColumns()

  const created = existingDims === null
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ${CHUNKS_TABLE} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      document_id UUID NOT NULL REFERENCES ${DOCUMENTS_TABLE}(id) ON DELETE CASCADE,
      chunk_index INT NOT NULL,
      content TEXT NOT NULL,
      char_count INT NOT NULL DEFAULT 0,
      token_estimate INT NOT NULL DEFAULT 0,
      page_start INT,
      page_end INT,
      section TEXT,
      -- Denormalised from the parent document so retrieval can filter by source
      -- without joining, and so a mixed-source search stays cheap.
      source_type TEXT NOT NULL DEFAULT 'corpus' CHECK (source_type IN (${SOURCE_CHECK})),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      embedding vector(${cfg.dimensions}) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ${CHUNKS_TABLE}_doc_chunk_idx ON ${CHUNKS_TABLE} (document_id, chunk_index);
    CREATE INDEX IF NOT EXISTS ${CHUNKS_TABLE}_ws_idx ON ${CHUNKS_TABLE} (workspace_id);
    CREATE INDEX IF NOT EXISTS ${CHUNKS_TABLE}_ws_source_idx ON ${CHUNKS_TABLE} (workspace_id, source_type);
    -- Sparse half of hybrid retrieval: full-text ranking over the chunk text.
    CREATE INDEX IF NOT EXISTS ${CHUNKS_TABLE}_content_fts_idx ON ${CHUNKS_TABLE} USING gin (to_tsvector('english', content));
  `)

  // Long chunk text would otherwise be TOAST-compressed alongside the vector.
  await getPool().query(`ALTER TABLE ${CHUNKS_TABLE} ALTER COLUMN embedding SET STORAGE PLAIN`).catch(() => undefined)

  const wanted = indexStatement(cfg)
  const existingIndex = await embeddingIndexDefinition()
  let indexRebuilt = false
  if (existingIndex && indexIsStale(existingIndex, cfg)) {
    await getPool().query(`DROP INDEX IF EXISTS ${EMBEDDING_INDEX}`)
    indexRebuilt = true
  }
  if (wanted && (!existingIndex || indexRebuilt)) {
    await getPool().query(wanted)
  }

  const { opClass, operator } = METRIC_SPEC[cfg.metric]
  return {
    extension,
    created,
    indexRebuilt,
    dimensions: cfg.dimensions,
    metric: cfg.metric,
    indexKind: cfg.indexKind,
    opClass,
    operator,
    indexDefinition: await embeddingIndexDefinition(),
  }
}

/**
 * Drops the corpus tables entirely. Only needed when the vector shape changes, since
 * it destroys BOTH sources. Prefer resetSource() for a per-source rebuild.
 */
export async function dropVectorStore(): Promise<void> {
  await getPool().query(`DROP TABLE IF EXISTS ${CHUNKS_TABLE} CASCADE; DROP TABLE IF EXISTS ${DOCUMENTS_TABLE} CASCADE;`)
}

/**
 * Deletes one source's documents (chunks cascade), leaving the other source intact.
 * This is what a per-source re-ingest should use now that both share the tables.
 */
export async function resetSource(workspaceId: string, sourceType: CorpusSourceType): Promise<{ documents: number; chunks: number }> {
  const before = await one<{ documents: number; chunks: number }>(
    `SELECT (SELECT COUNT(*)::int FROM ${DOCUMENTS_TABLE} WHERE workspace_id = $1 AND source_type = $2) AS documents,
            (SELECT COUNT(*)::int FROM ${CHUNKS_TABLE} WHERE workspace_id = $1 AND source_type = $2) AS chunks`,
    [workspaceId, sourceType],
  )
  await getPool().query(`DELETE FROM ${DOCUMENTS_TABLE} WHERE workspace_id = $1 AND source_type = $2`, [workspaceId, sourceType])
  return before ?? { documents: 0, chunks: 0 }
}

/** pgvector text input format: '[0.1,0.2,...]'. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`
}

// ── De-duplication ──────────────────────────────────────────────────────

/**
 * Normalises a URL so the same page under different spellings resolves to one identity:
 * lower-cased host, no default port, no fragment, no tracking parameters, no trailing
 * slash. Returns the input unchanged when it cannot be parsed.
 */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim())
    u.hash = ''
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
    u.protocol = u.protocol === 'http:' ? 'https:' : u.protocol
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = ''
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|referrer$|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$|source$)/i.test(key)) u.searchParams.delete(key)
    }
    u.searchParams.sort()
    let out = u.toString()
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1)
    return out.replace(/\/$/, (m) => (u.pathname === '/' && !u.search ? '' : m))
  } catch {
    return raw.trim()
  }
}

export interface ExistingDocument {
  id: string
  source: string
  sourceType: string
  sourcePath: string
  urlPath: string | null
  fileName: string
  title: string
  contentSha256: string
  chunkCount: number
  status: string
  provider: string | null
  model: string | null
  dimensions: number | null
  metric: string | null
  ingestedAt: string
}

export type DedupeAction = 'embed' | 'skip' | 're-embed'

export interface DedupeDecision {
  action: DedupeAction
  /** Why the decision was reached, suitable for logging or an API response. */
  reason: string
  /** How the match was found: same identity, or same content under a different identity. */
  matchKind?: 'identity' | 'content'
  match?: ExistingDocument
}

const EXISTING_COLUMNS = `id, source, source_type, source_path, url_path, file_name, title, content_sha256, chunk_count, status, provider, model, dimensions, metric, ingested_at`

interface ExistingRow {
  id: string
  source: string
  source_type: string
  source_path: string
  url_path: string | null
  file_name: string
  title: string
  content_sha256: string
  chunk_count: number
  status: string
  provider: string | null
  model: string | null
  dimensions: number | null
  metric: string | null
  ingested_at: Date
}

const toExisting = (r: ExistingRow): ExistingDocument => ({
  id: r.id,
  source: r.source,
  sourceType: r.source_type,
  sourcePath: r.source_path,
  urlPath: r.url_path,
  fileName: r.file_name,
  title: r.title,
  contentSha256: r.content_sha256,
  chunkCount: r.chunk_count,
  status: r.status,
  provider: r.provider,
  model: r.model,
  dimensions: r.dimensions,
  metric: r.metric,
  ingestedAt: new Date(r.ingested_at).toISOString(),
})

/**
 * Decides whether a document needs embedding, using three escalating checks:
 *
 *  1. identity — same source_type + source_path. Unchanged bytes and unchanged
 *     embedding settings mean skip; either changing means re-embed.
 *  2. content  — same content hash under a different path in the SAME source, which
 *     catches a renamed file or the same page reached by two URL spellings.
 *  3. cross-source — same content hash under the OTHER source, which catches a corpus
 *     PDF that is also published on the web.
 *
 * Scope is controlled by EMBEDDING_DEDUPE_SCOPE. `force` bypasses every skip.
 */
export async function findDuplicate(input: {
  workspaceId: string
  sourceType: CorpusSourceType
  sourcePath: string
  contentSha256: string
  force?: boolean
  cfg?: EmbeddingConfig
}): Promise<DedupeDecision> {
  const cfg = input.cfg ?? env().embeddings
  const scope = cfg.dedupeScope
  const identityPath = input.sourceType === 'web' ? canonicalUrl(input.sourcePath) : input.sourcePath

  const identity = await one<ExistingRow>(
    `SELECT ${EXISTING_COLUMNS} FROM ${DOCUMENTS_TABLE} WHERE workspace_id = $1 AND source_type = $2 AND source_path = $3`,
    [input.workspaceId, input.sourceType, identityPath],
  )

  if (identity) {
    const match = toExisting(identity)
    if (input.force) return { action: 're-embed', reason: 'force requested', matchKind: 'identity', match }
    const settingsMatch =
      identity.provider === cfg.provider && identity.model === cfg.model && identity.dimensions === cfg.dimensions && identity.metric === cfg.metric
    if (identity.content_sha256 !== input.contentSha256) {
      return { action: 're-embed', reason: 'content changed since the last ingest', matchKind: 'identity', match }
    }
    if (!settingsMatch) {
      return {
        action: 're-embed',
        reason: `embedding settings changed (stored ${identity.provider}/${identity.model} ${identity.dimensions}d ${identity.metric}, configured ${cfg.provider}/${cfg.model} ${cfg.dimensions}d ${cfg.metric})`,
        matchKind: 'identity',
        match,
      }
    }
    if (identity.status === 'embedded' && identity.chunk_count > 0) {
      return { action: 'skip', reason: 'already embedded and unchanged', matchKind: 'identity', match }
    }
    return { action: 're-embed', reason: `previous attempt left status '${identity.status}'`, matchKind: 'identity', match }
  }

  if (input.force || scope === 'identity') return { action: 'embed', reason: 'not present in the vector store' }

  // Same bytes already embedded under a different identity.
  const crossSource = scope === 'cross-source'
  const content = await one<ExistingRow>(
    `SELECT ${EXISTING_COLUMNS} FROM ${DOCUMENTS_TABLE}
      WHERE workspace_id = $1 AND content_sha256 = $2 AND status = 'embedded' AND chunk_count > 0
        AND ($3::boolean OR source_type = $4)
      ORDER BY ingested_at LIMIT 1`,
    [input.workspaceId, input.contentSha256, crossSource, input.sourceType],
  )
  if (content) {
    const match = toExisting(content)
    const where = match.sourceType === input.sourceType ? `the same source as "${match.sourcePath}"` : `source '${match.source}' as "${match.urlPath ?? match.sourcePath}"`
    return { action: 'skip', reason: `identical content is already embedded under ${where}`, matchKind: 'content', match }
  }

  return { action: 'embed', reason: 'not present in the vector store' }
}

/**
 * Applies the configured ANN search knob for the duration of one transaction.
 * hnsw.ef_search / ivfflat.probes are session GUCs, so they must be set per query.
 */
export async function withSearchParams<T>(fn: (client: pg.PoolClient) => Promise<T>, cfg: EmbeddingConfig = env().embeddings): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    if (cfg.indexKind === 'hnsw') await client.query(`SET LOCAL hnsw.ef_search = ${positiveInt(cfg.hnsw.efSearch, 'EMBEDDING_HNSW_EF_SEARCH', 1000)}`)
    if (cfg.indexKind === 'ivfflat') await client.query(`SET LOCAL ivfflat.probes = ${positiveInt(cfg.ivfflat.probes, 'EMBEDDING_IVFFLAT_PROBES', 32768)}`)
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

export interface VectorStoreStats {
  extension: string | null
  configured: VectorStoreShape & { provider: string; model: string }
  live: { dimensions: number | null; indexDefinition: string | null; indexSize: string | null; tableSize: string | null }
  documents: { total: number; embedded: number; failed: number; pages: number; chars: number }
  chunks: { total: number; providers: string[]; models: string[] }
  /** Per-source breakdown, so it is obvious which source built the store. */
  bySource: Array<{
    sourceType: CorpusSourceType | string
    label: string
    documents: number
    embedded: number
    failed: number
    empty: number
    chunks: number
    pages: number
    chars: number
    lastIngestedAt: string | null
  }>
  drift: string[]
}

/** Reports configured vs. actual store shape — used by /api/corpus/stats and the CLI. */
export async function vectorStoreStats(workspaceId?: string): Promise<VectorStoreStats> {
  const cfg = env().embeddings
  const { opClass, operator } = METRIC_SPEC[cfg.metric]
  const extension = await vectorExtensionVersion()
  const live = await storedDimensions()
  const indexDefinition = await embeddingIndexDefinition()

  const empty: VectorStoreStats = {
    extension,
    configured: { dimensions: cfg.dimensions, metric: cfg.metric, indexKind: cfg.indexKind, opClass, operator, indexDefinition: indexStatement(cfg), provider: cfg.provider, model: cfg.model },
    live: { dimensions: live, indexDefinition, indexSize: null, tableSize: null },
    documents: { total: 0, embedded: 0, failed: 0, pages: 0, chars: 0 },
    chunks: { total: 0, providers: [], models: [] },
    bySource: [],
    drift: [],
  }
  if (live === null) {
    empty.drift.push('Vector store has not been created yet — run `npm run corpus:embed`')
    return empty
  }

  const where = workspaceId ? 'WHERE workspace_id = $1' : ''
  const args = workspaceId ? [workspaceId] : []
  const docs = await one<{ total: number; embedded: number; failed: number; pages: number; chars: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'embedded')::int AS embedded,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            COALESCE(SUM(pages), 0)::int AS pages,
            COALESCE(SUM(char_count), 0)::int AS chars
       FROM ${DOCUMENTS_TABLE} ${where}`,
    args,
  )
  const chunks = await one<{ total: number; providers: string[]; models: string[] }>(
    `SELECT COUNT(*)::int AS total,
            COALESCE(ARRAY_AGG(DISTINCT provider), '{}') AS providers,
            COALESCE(ARRAY_AGG(DISTINCT model), '{}') AS models
       FROM ${CHUNKS_TABLE} ${where}`,
    args,
  )
  const sourceRows = await query<{ source_type: string; documents: number; embedded: number; failed: number; empty: number; chunks: number; pages: number; chars: number; last_ingested_at: Date | null }>(
    `SELECT d.source_type,
            COUNT(*)::int AS documents,
            COUNT(*) FILTER (WHERE d.status = 'embedded')::int AS embedded,
            COUNT(*) FILTER (WHERE d.status = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE d.status = 'empty')::int AS empty,
            COALESCE(SUM(d.chunk_count), 0)::int AS chunks,
            COALESCE(SUM(d.pages), 0)::int AS pages,
            COALESCE(SUM(d.char_count), 0)::int AS chars,
            MAX(d.updated_at) AS last_ingested_at
       FROM ${DOCUMENTS_TABLE} d ${where ? where.replace('workspace_id', 'd.workspace_id') : ''}
      GROUP BY d.source_type ORDER BY d.source_type`,
    args,
  )
  const sizes = await one<{ index_size: string | null; table_size: string }>(
    `SELECT pg_size_pretty(pg_relation_size($1::regclass)) AS table_size,
            CASE WHEN to_regclass($2) IS NULL THEN NULL ELSE pg_size_pretty(pg_relation_size($2::regclass)) END AS index_size`,
    [CHUNKS_TABLE, EMBEDDING_INDEX],
  )

  const drift: string[] = []
  if (live !== cfg.dimensions) drift.push(`stored vector(${live}) != EMBEDDING_DIMENSIONS ${cfg.dimensions} — run \`npm run corpus:reset\``)
  if (cfg.indexKind === 'none' && indexDefinition) drift.push('EMBEDDING_INDEX_KIND=none but an ANN index still exists')
  if (cfg.indexKind !== 'none' && !indexDefinition) drift.push(`no ${cfg.indexKind} index on ${CHUNKS_TABLE}.embedding — run \`npm run corpus:embed --reindex\``)
  if (indexDefinition && indexIsStale(indexDefinition, cfg)) drift.push('live index does not match the configured metric/build params — run `npm run corpus:embed -- --reindex`')
  const otherProviders = (chunks?.providers ?? []).filter((p) => p && p !== cfg.provider)
  if (otherProviders.length) drift.push(`store holds vectors from ${otherProviders.join(', ')} but EMBEDDING_PROVIDER is ${cfg.provider} — mixed providers are not comparable, run \`npm run corpus:reset\``)

  // Flag chunks whose source drifted from their parent document.
  const mismatched = await one<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ${CHUNKS_TABLE} c JOIN ${DOCUMENTS_TABLE} d ON d.id = c.document_id WHERE c.source_type <> d.source_type`,
  )
  if ((mismatched?.n ?? 0) > 0) drift.push(`${mismatched?.n} chunk(s) have a source_type that disagrees with their document`)

  return {
    ...empty,
    live: { dimensions: live, indexDefinition, indexSize: sizes?.index_size ?? null, tableSize: sizes?.table_size ?? null },
    documents: docs ?? empty.documents,
    chunks: chunks ?? empty.chunks,
    bySource: sourceRows.map((r) => ({
      sourceType: r.source_type,
      label: SOURCE_LABELS[r.source_type as CorpusSourceType] ?? r.source_type,
      documents: r.documents,
      embedded: r.embedded,
      failed: r.failed,
      empty: r.empty,
      chunks: r.chunks,
      pages: r.pages,
      chars: r.chars,
      lastIngestedAt: r.last_ingested_at ? new Date(r.last_ingested_at).toISOString() : null,
    })),
    drift,
  }
}

export interface SimilarChunk {
  chunkId: string
  documentId: string
  title: string
  filename: string
  chunkIndex: number
  pageStart: number | null
  pageEnd: number | null
  content: string
  distance: number
  similarity: number
  /** Which ingestion source this chunk came from. */
  sourceType: string
  sourceLabel: string
  sourcePath: string
  urlPath: string | null
}

/** k-NN lookup over the corpus using the configured metric operator. */
export async function searchSimilarChunks(input: { workspaceId: string; embedding: number[]; limit?: number; documentId?: string; minSimilarity?: number; sourceType?: CorpusSourceType }): Promise<SimilarChunk[]> {
  const cfg = env().embeddings
  const spec = METRIC_SPEC[cfg.metric]
  if (input.embedding.length !== cfg.dimensions) {
    throw new Error(`Query vector has ${input.embedding.length} dimensions, store expects ${cfg.dimensions}`)
  }
  const limit = Math.min(Math.max(input.limit ?? cfg.searchLimit, 1), 100)
  const rows = await withSearchParams(async (client) => {
    const res = await client.query<{ chunk_id: string; document_id: string; title: string; file_name: string; chunk_index: number; page_start: number | null; page_end: number | null; content: string; distance: number; source_type: string; source_path: string; url_path: string | null }>(
      `SELECT c.id AS chunk_id, c.document_id, d.title, d.file_name, c.chunk_index, c.page_start, c.page_end, c.content,
              c.source_type, d.source_path, d.url_path,
              (c.embedding ${spec.operator} $2::vector) AS distance
         FROM ${CHUNKS_TABLE} c
         JOIN ${DOCUMENTS_TABLE} d ON d.id = c.document_id
        WHERE c.workspace_id = $1
          AND ($4::uuid IS NULL OR c.document_id = $4)
          AND ($5::text IS NULL OR c.source_type = $5)
        ORDER BY c.embedding ${spec.operator} $2::vector
        LIMIT $3`,
      [input.workspaceId, toVectorLiteral(input.embedding), limit, input.documentId ?? null, input.sourceType ?? null],
    )
    return res.rows
  }, cfg)

  return rows
    .map((r) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      title: r.title,
      filename: r.file_name,
      chunkIndex: r.chunk_index,
      pageStart: r.page_start,
      pageEnd: r.page_end,
      content: r.content,
      distance: Number(r.distance),
      similarity: spec.similarity(Number(r.distance)),
      sourceType: r.source_type,
      sourceLabel: SOURCE_LABELS[r.source_type as CorpusSourceType] ?? r.source_type,
      sourcePath: r.source_path,
      urlPath: r.url_path,
    }))
    .filter((r) => input.minSimilarity === undefined || r.similarity >= input.minSimilarity)
}

export interface SearchPlan {
  /** Plan the planner actually chose for the real search query. */
  plan: string[]
  /** True when that plan scans the ANN index. */
  usesAnnIndex: boolean
  /**
   * True when the ANN index *can* serve the query, verified by re-planning with
   * sequential scans disabled. On a small table the planner legitimately prefers a
   * full scan, so `usesAnnIndex: false` here does not mean the index is broken.
   */
  annIndexUsable: boolean
  note: string
}

export interface LexicalChunk extends Omit<SimilarChunk, 'distance' | 'similarity'> {
  /** Postgres ts_rank score. Only comparable within one result set. */
  rank: number
}

/**
 * Sparse half of hybrid retrieval: Postgres full-text ranking over chunk text.
 * Complements the dense leg by catching exact terms, acronyms and rare proper nouns
 * that embeddings tend to smooth over.
 */
export async function searchLexicalChunks(input: { workspaceId: string; query: string; limit?: number; sourceType?: CorpusSourceType }): Promise<LexicalChunk[]> {
  const cfg = env().embeddings
  const limit = Math.min(Math.max(input.limit ?? cfg.searchLimit, 1), 200)
  const rows = await query<{ chunk_id: string; document_id: string; title: string; file_name: string; chunk_index: number; page_start: number | null; page_end: number | null; content: string; rank: number; source_type: string; source_path: string; url_path: string | null }>(
    `SELECT c.id AS chunk_id, c.document_id, d.title, d.file_name, c.chunk_index, c.page_start, c.page_end, c.content,
            c.source_type, d.source_path, d.url_path,
            ts_rank(to_tsvector('english', c.content), websearch_to_tsquery('english', $2)) AS rank
       FROM ${CHUNKS_TABLE} c
       JOIN ${DOCUMENTS_TABLE} d ON d.id = c.document_id
      WHERE c.workspace_id = $1
        AND ($4::text IS NULL OR c.source_type = $4)
        AND to_tsvector('english', c.content) @@ websearch_to_tsquery('english', $2)
      ORDER BY rank DESC
      LIMIT $3`,
    [input.workspaceId, input.query, limit, input.sourceType ?? null],
  )
  return rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    title: r.title,
    filename: r.file_name,
    chunkIndex: r.chunk_index,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    content: r.content,
    sourceType: r.source_type,
    sourceLabel: SOURCE_LABELS[r.source_type as CorpusSourceType] ?? r.source_type,
    sourcePath: r.source_path,
    urlPath: r.url_path,
    rank: Number(r.rank),
  }))
}

/** Source types that currently hold at least one embedded chunk. */
export async function populatedSources(workspaceId: string): Promise<CorpusSourceType[]> {
  const rows = await query<{ source_type: string }>(
    `SELECT DISTINCT source_type FROM ${CHUNKS_TABLE} WHERE workspace_id = $1 ORDER BY source_type`,
    [workspaceId],
  )
  return rows.map((r) => r.source_type).filter(isCorpusSourceType)
}

/** EXPLAIN for a k-NN query, distinguishing "index unused" from "index unusable". */
export async function explainSearch(workspaceId: string, embedding: number[]): Promise<SearchPlan> {
  const cfg = env().embeddings
  const spec = METRIC_SPEC[cfg.metric]
  const literal = toVectorLiteral(embedding)
  // The sort key echoes the whole query vector; strip it so plans stay readable.
  const tidy = (rows: Array<{ 'QUERY PLAN': string }>) => rows.map((r) => r['QUERY PLAN']).filter((line) => !/Sort Key:/.test(line))
  const scansIndex = (lines: string[]) => lines.some((l) => l.includes(EMBEDDING_INDEX))

  return withSearchParams(async (client) => {
    const sql = `SELECT c.id FROM ${CHUNKS_TABLE} c WHERE c.workspace_id = $1 ORDER BY c.embedding ${spec.operator} $2::vector LIMIT $3`
    const actual = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, TIMING OFF, SUMMARY OFF) ${sql}`, [workspaceId, literal, cfg.searchLimit])
    const plan = tidy(actual.rows)
    const usesAnnIndex = scansIndex(plan)

    let annIndexUsable = usesAnnIndex
    if (!usesAnnIndex && cfg.indexKind !== 'none') {
      await client.query('SET LOCAL enable_seqscan = off')
      const forced = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN (COSTS OFF) SELECT c.id FROM ${CHUNKS_TABLE} c ORDER BY c.embedding ${spec.operator} $1::vector LIMIT $2`, [literal, cfg.searchLimit])
      annIndexUsable = scansIndex(tidy(forced.rows))
    }

    const note = usesAnnIndex
      ? `${cfg.indexKind} index scan chosen`
      : cfg.indexKind === 'none'
        ? 'EMBEDDING_INDEX_KIND=none — exact search by design'
        : annIndexUsable
          ? `${cfg.indexKind} index is valid and usable, but the planner chose an exact scan because the table is small; it switches to the index as the table grows`
          : `${cfg.indexKind} index cannot serve this query — check that EMBEDDING_METRIC matches the index operator class`
    return { plan, usesAnnIndex, annIndexUsable, note }
  }, cfg)
}

export async function listDocuments(workspaceId: string, sourceType?: CorpusSourceType) {
  return query(
    `SELECT id, source, source_type, file_name, title, source_path, url_path, domain, retrieved_at, source_meta,
            status, error, pages, char_count, chunk_count, bytes,
            provider, model, dimensions, metric, embed_ms, content_sha256, ingested_at, updated_at
       FROM ${DOCUMENTS_TABLE}
      WHERE workspace_id = $1 AND ($2::text IS NULL OR source_type = $2)
      ORDER BY source_type, title`,
    [workspaceId, sourceType ?? null],
  )
}
