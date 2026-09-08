// Typed env accessor. Reads lazily at call time so adapters never bind to import-time state.
import 'dotenv/config'

const str = (k: string, d = ''): string => (process.env[k] ?? d).trim()
const int = (k: string, d: number): number => {
  const v = Number.parseInt(process.env[k] ?? '', 10)
  return Number.isFinite(v) ? v : d
}
const flt = (k: string, d: number): number => {
  const v = Number.parseFloat(process.env[k] ?? '')
  return Number.isFinite(v) ? v : d
}
/** Reads an env var constrained to a fixed set. Unknown values fall back to the default. */
const pick = <T extends string>(k: string, allowed: readonly T[], d: T): T => {
  const v = str(k).toLowerCase() as T
  return allowed.includes(v) ? v : d
}

export const EMBEDDING_PROVIDERS = ['gemini', 'openai', 'local'] as const
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number]
export const VECTOR_METRICS = ['cosine', 'l2', 'ip'] as const
export type VectorMetric = (typeof VECTOR_METRICS)[number]
export const VECTOR_INDEX_KINDS = ['hnsw', 'ivfflat', 'none'] as const
export type VectorIndexKind = (typeof VECTOR_INDEX_KINDS)[number]
export const DEDUPE_SCOPES = ['identity', 'content', 'cross-source'] as const
export type DedupeScope = (typeof DEDUPE_SCOPES)[number]

/** Default embedding model per provider, each capable of emitting 1536-d vectors. */
const DEFAULT_EMBEDDING_MODEL: Record<EmbeddingProvider, string> = {
  gemini: 'gemini-embedding-001',
  openai: 'text-embedding-3-small',
  local: 'local-hash-v1',
}

export function env() {
  return {
    databaseUrl: str('DATABASE_URL', 'postgresql://ethara:ethara@localhost:5432/ethara_sma'),
    port: int('PORT', 4000),
    workspaceSlug: str('WORKSPACE_SLUG', 'ethara'),
    corsOrigin: str('CORS_ORIGIN', '*'),
    publishMode: (str('PUBLISH_MODE', 'demo') === 'live' ? 'live' : 'demo') as 'demo' | 'live',
    tz: str('TZ', 'Asia/Kolkata'),
    apify: {
      token: str('APIFY_API_TOKEN'),
      baseUrl: str('APIFY_BASE_URL', 'https://api.apify.com/v2'),
      postsActor: str('APIFY_LINKEDIN_POSTS_ACTOR', 'apimaestro~linkedin-posts-search-scraper-no-cookies'),
      hashtagActor: str('APIFY_LINKEDIN_HASHTAG_ACTOR', 'apimaestro~linkedin-hashtag-posts-scraper'),
      profileActor: str('APIFY_LINKEDIN_PROFILE_ACTOR', 'apimaestro~linkedin-profile-posts-scraper'),
      timeoutMs: int('APIFY_RUN_TIMEOUT_MS', 180000),
      maxItemsPerKeyword: int('APIFY_MAX_ITEMS_PER_KEYWORD', 50),
      memoryMbytes: int('APIFY_MEMORY_MBYTES', 1024),
    },
    parallel: {
      apiKey: str('PARALLEL_API_KEY'),
      baseUrl: str('PARALLEL_BASE_URL', 'https://api.parallel.ai'),
      searchPath: str('PARALLEL_SEARCH_PATH', '/v1beta/search'),
      taskPath: str('PARALLEL_TASK_PATH', '/v1/tasks/runs'),
      processor: str('PARALLEL_PROCESSOR', 'base'),
      maxResults: int('PARALLEL_MAX_RESULTS', 10),
      maxCharsPerResult: int('PARALLEL_MAX_CHARS_PER_RESULT', 6000),
      timeoutMs: int('PARALLEL_TIMEOUT_MS', 120000),
    },
    knowledge: {
      cron: str('KNOWLEDGE_BUILD_CRON', '0 6 * * 0'),
      hashtagCount: int('KNOWLEDGE_HASHTAG_COUNT', 25),
    },
    gcp: {
      apiKey: str('GCP_API_KEY'),
      // GCP_PROJECT is accepted as an alias so the value can be shared with tooling
      // that uses the shorter name.
      projectId: str('GCP_PROJECT_ID') || str('GCP_PROJECT'),
      location: str('GCP_LOCATION', 'us-central1'),
      // GOOGLE_APPLICATION_CREDENTIALS is the standard GCP variable; honour it as a
      // fallback so a service account already on the machine works without extra config.
      serviceAccountJson: str('GCP_SERVICE_ACCOUNT_JSON') || str('GOOGLE_APPLICATION_CREDENTIALS'),
      textModel: str('GCP_TEXT_MODEL', 'gemini-2.5-pro'),
      fastTextModel: str('GCP_FAST_TEXT_MODEL', 'gemini-2.5-flash'),
      // The single image model. gcpImage routes by model family, so an Imagen id still works here
      // if the project has Imagen access, but gemini-2.5-flash-image is the supported default.
      imageModel: str('GCP_IMAGE_MODEL', 'gemini-2.5-flash-image'),
      timeoutMs: int('GCP_TIMEOUT_MS', 90000),
      maxOutputTokens: int('GCP_MAX_OUTPUT_TOKENS', 2048),
      temperature: flt('GCP_TEMPERATURE', 0.6),
    },
    zImage: {
      endpoint: str('Z_IMAGE_ENDPOINT'),
      apiKey: str('Z_IMAGE_API_KEY'),
      modelId: str('Z_IMAGE_MODEL_ID', 'Tongyi-MAI/Z-Image-Turbo'),
      timeoutMs: int('Z_IMAGE_TIMEOUT_MS', 60000),
    },
    embeddings: embeddingConfig(),
  }
}

/**
 * Vector store + embedding settings. Every value here is env-configurable; the
 * defaults are the requested 1536-d / cosine / HNSW setup.
 *
 * Changing `dimensions` or `metric` changes the physical column and index, so the
 * store has to be rebuilt afterwards (`npm run corpus:reset`). The ingester refuses
 * to write into a store whose shape no longer matches this config rather than
 * silently mixing incompatible vectors.
 */
export function embeddingConfig() {
  const provider = pick('EMBEDDING_PROVIDER', EMBEDDING_PROVIDERS, 'gemini')
  return {
    provider,
    /**
     * Model id sent to the provider. An empty EMBEDDING_MODEL falls back to the
     * provider default, so the var can be left blank in .env rather than deleted.
     */
    model: str('EMBEDDING_MODEL') || DEFAULT_EMBEDDING_MODEL[provider],
    /** Vector width. pgvector allows up to 2000 dims for an HNSW index. */
    dimensions: int('EMBEDDING_DIMENSIONS', 1536),
    /** Distance function: cosine -> vector_cosine_ops/<=>, l2 -> <->, ip -> <#>. */
    metric: pick('EMBEDDING_METRIC', VECTOR_METRICS, 'cosine'),
    /** ANN index built on the embedding column. */
    indexKind: pick('EMBEDDING_INDEX_KIND', VECTOR_INDEX_KINDS, 'hnsw'),
    hnsw: {
      /** Max edges per layer. Higher = better recall, larger index. */
      m: int('EMBEDDING_HNSW_M', 16),
      /** Candidate list size while building. Higher = better recall, slower build. */
      efConstruction: int('EMBEDDING_HNSW_EF_CONSTRUCTION', 64),
      /** Candidate list size while searching; applied per query via SET LOCAL. */
      efSearch: int('EMBEDDING_HNSW_EF_SEARCH', 100),
    },
    ivfflat: {
      lists: int('EMBEDDING_IVFFLAT_LISTS', 100),
      probes: int('EMBEDDING_IVFFLAT_PROBES', 10),
    },
    /** Chunking is character-based so it stays provider agnostic. */
    chunkChars: int('EMBEDDING_CHUNK_CHARS', 1800),
    chunkOverlap: int('EMBEDDING_CHUNK_OVERLAP', 200),
    /** Chunks shorter than this are dropped (page furniture, stray headers). */
    minChunkChars: int('EMBEDDING_MIN_CHUNK_CHARS', 120),
    /**
     * How hard to look for an existing copy before embedding a document.
     *   identity     — only the same source + path
     *   content      — also the same content hash elsewhere in the same source (renames)
     *   cross-source — also the same content hash in the other source (a corpus PDF
     *                  that is also published on the web)
     */
    dedupeScope: pick('EMBEDDING_DEDUPE_SCOPE', DEDUPE_SCOPES, 'cross-source'),
    /** Texts per provider request. */
    batchSize: int('EMBEDDING_BATCH_SIZE', 32),
    /**
     * Upper bound on estimated tokens in a single embedding request. Vertex AI rejects
     * gemini-embedding-001 requests above 20k tokens, so a batch is flushed early when
     * it would cross this budget. Kept below the hard limit as a safety margin.
     */
    maxTokensPerRequest: int('EMBEDDING_MAX_TOKENS_PER_REQUEST', 16000),
    timeoutMs: int('EMBEDDING_TIMEOUT_MS', 60000),
    maxRetries: int('EMBEDDING_MAX_RETRIES', 3),
    /** Folder scanned for documents, resolved relative to the server package. */
    corpusDir: str('CORPUS_DIR', '../corpus'),
    /** Default neighbour count for similarity search. */
    searchLimit: int('EMBEDDING_SEARCH_LIMIT', 8),
    openai: {
      apiKey: str('OPENAI_API_KEY'),
      baseUrl: str('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    },
  }
}

export type EmbeddingConfig = ReturnType<typeof embeddingConfig>

export type Env = ReturnType<typeof env>
