// Embedding adapter. One interface, three interchangeable providers, selected by
// EMBEDDING_PROVIDER. Every provider returns L2-normalized vectors of exactly
// env().embeddings.dimensions so the pgvector column and cosine distances stay valid.
import { createHash } from 'node:crypto'
import { env, type EmbeddingConfig, type EmbeddingProvider } from '../config'
import type { ServiceAdapter } from './apify'
import { isVertexConfigured, serviceAccountProblem, vertexAuth } from './gcp-llm'

export type EmbeddingPurpose = 'document' | 'query'

export interface EmbedInput {
  texts: string[]
  purpose?: EmbeddingPurpose
}

export interface EmbedOutput {
  vectors: number[][]
  provider: EmbeddingProvider
  model: string
  dimensions: number
}

/**
 * Scales a vector to unit length. Cosine distance only equals `1 - dot` for
 * normalized vectors, and Gemini truncates reduced-dimension output which breaks
 * the model's own normalization, so this is applied to every provider's output.
 */
export function normalize(vector: number[]): number[] {
  let sumSquares = 0
  for (const v of vector) sumSquares += v * v
  const norm = Math.sqrt(sumSquares)
  if (!Number.isFinite(norm) || norm === 0) return vector.slice()
  return vector.map((v) => v / norm)
}

function assertShape(vectors: number[][], expected: number, provider: string, model: string): void {
  for (const [i, v] of vectors.entries()) {
    if (v.length !== expected) {
      throw new Error(`${provider}/${model} returned a ${v.length}-dim vector for text ${i} but EMBEDDING_DIMENSIONS is ${expected}. Set EMBEDDING_DIMENSIONS to a width this model supports, or pick a model that supports output truncation.`)
    }
    if (v.some((n) => !Number.isFinite(n))) throw new Error(`${provider}/${model} returned a non-finite value in vector ${i}`)
  }
}

async function withRetries<T>(label: string, attempts: number, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < Math.max(attempts, 1); attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message : String(err)
      // Client errors other than rate limits will not resolve by retrying.
      if (/ responded 4(0[0-9]|1[0-8])\b/.test(message)) break
      if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
  throw new Error(`${label} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

// ── Gemini ──────────────────────────────────────────────────────────────
// Uses the same credentials as the text adapter. `outputDimensionality` asks the
// model for a reduced Matryoshka vector (3072 / 1536 / 768 are the quality picks).
const GEMINI_TASK: Record<EmbeddingPurpose, string> = { document: 'RETRIEVAL_DOCUMENT', query: 'RETRIEVAL_QUERY' }

/**
 * Vertex AI path, used when a service account + project are configured. Vertex exposes
 * embeddings through `:predict` with a different body than the API-key endpoint:
 * instances carry the text and task_type, and outputDimensionality is a parameter.
 */
async function vertexEmbed(cfg: EmbeddingConfig, input: EmbedInput): Promise<number[][]> {
  const auth = await vertexAuth()
  if (!auth) throw new Error('Vertex AI is not configured')
  const taskType = GEMINI_TASK[input.purpose ?? 'document']
  const url = `https://${auth.location}-aiplatform.googleapis.com/v1/projects/${auth.projectId}/locations/${auth.location}/publishers/google/models/${cfg.model}:predict`
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      instances: input.texts.map((content) => ({ content, task_type: taskType })),
      parameters: { outputDimensionality: cfg.dimensions, autoTruncate: true },
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Vertex ${cfg.model} responded ${res.status}${detail ? ` · ${detail.slice(0, 400)}` : ''}`)
  }
  const json = (await res.json()) as { predictions?: Array<{ embeddings?: { values?: number[] } }> }
  const vectors = json.predictions?.map((p) => p.embeddings?.values ?? [])
  if (!vectors || vectors.length !== input.texts.length) {
    throw new Error(`Vertex returned ${vectors?.length ?? 0} embeddings for ${input.texts.length} inputs`)
  }
  return vectors
}

async function geminiEmbed(cfg: EmbeddingConfig, input: EmbedInput): Promise<number[][]> {
  const gcp = env().gcp
  if (isVertexConfigured()) return vertexEmbed(cfg, input)
  const taskType = GEMINI_TASK[input.purpose ?? 'document']
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:batchEmbedContents?key=${encodeURIComponent(gcp.apiKey)}`
  const requests = input.texts.map((text) => ({
    model: `models/${cfg.model}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: cfg.dimensions,
  }))
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gemini ${cfg.model} responded ${res.status}${detail ? ` · ${detail.slice(0, 300)}` : ''}`)
  }
  const json = (await res.json()) as { embeddings?: Array<{ values?: number[] }> }
  const vectors = json.embeddings?.map((e) => e.values ?? [])
  if (!vectors || vectors.length !== input.texts.length) {
    throw new Error(`Gemini returned ${vectors?.length ?? 0} embeddings for ${input.texts.length} inputs`)
  }
  return vectors
}

// ── OpenAI ──────────────────────────────────────────────────────────────
// text-embedding-3-* accept a `dimensions` parameter; 1536 is native for -3-small.
async function openaiEmbed(cfg: EmbeddingConfig, input: EmbedInput): Promise<number[][]> {
  const res = await fetch(`${cfg.openai.baseUrl.replace(/\/+$/, '')}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.openai.apiKey}` },
    body: JSON.stringify({ model: cfg.model, input: input.texts, dimensions: cfg.dimensions, encoding_format: 'float' }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenAI ${cfg.model} responded ${res.status}${detail ? ` · ${detail.slice(0, 300)}` : ''}`)
  }
  const json = (await res.json()) as { data?: Array<{ index: number; embedding: number[] }> }
  if (!json.data || json.data.length !== input.texts.length) {
    throw new Error(`OpenAI returned ${json.data?.length ?? 0} embeddings for ${input.texts.length} inputs`)
  }
  return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

// ── Local ───────────────────────────────────────────────────────────────
/**
 * Deterministic, dependency-free embedder: hashed n-gram features (the "hashing
 * trick") with signed buckets and sublinear term weighting, projected straight into
 * `dimensions` and L2-normalized.
 *
 * These are real, stable, comparable vectors and cosine similarity over them works,
 * but the similarity is LEXICAL, not semantic — it matches shared wording, not shared
 * meaning. It exists so the pipeline and index are exercisable without an API key.
 * Configure a real provider for retrieval quality.
 */
const STOP_WORDS = new Set('a an and are as at be but by for from has have if in into is it its of on or that the their then there these this to was were which will with we our you your'.split(' '))

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && t.length < 40 && !STOP_WORDS.has(t))
}

function bucket(term: string, dimensions: number): { index: number; sign: number } {
  const digest = createHash('sha1').update(term).digest()
  const raw = digest.readUInt32BE(0)
  return { index: raw % dimensions, sign: digest[4] & 1 ? 1 : -1 }
}

export function localEmbed(text: string, dimensions: number): number[] {
  const tokens = tokenize(text)
  const counts = new Map<string, number>()
  const bump = (term: string) => counts.set(term, (counts.get(term) ?? 0) + 1)
  for (const [i, token] of tokens.entries()) {
    bump(token)
    // Bigrams give the vector a little word-order sensitivity.
    if (i + 1 < tokens.length) bump(`${token}_${tokens[i + 1]}`)
  }
  const vector = new Array<number>(dimensions).fill(0)
  for (const [term, count] of counts) {
    const { index, sign } = bucket(term, dimensions)
    vector[index] += sign * (1 + Math.log(count))
  }
  return normalize(vector)
}

// ── Adapter ─────────────────────────────────────────────────────────────
function readiness(cfg: EmbeddingConfig): { ok: boolean; reason: string } {
  if (cfg.provider === 'gemini') {
    // Either auth mode works: Vertex (service account + project) or an API key.
    if (isVertexConfigured() || env().gcp.apiKey.length > 0) return { ok: true, reason: '' }
    const saProblem = serviceAccountProblem()
    const detail = env().gcp.projectId
      ? `GCP_PROJECT_ID is set but the service account is unusable — ${saProblem}`
      : saProblem
        ? `neither GCP_API_KEY nor a Vertex service account is usable — ${saProblem}, and GCP_PROJECT_ID is empty`
        : 'a service account loaded but GCP_PROJECT_ID is empty, which Vertex requires'
    return { ok: false, reason: `EMBEDDING_PROVIDER=gemini needs credentials in server/.env: ${detail}` }
  }
  if (cfg.provider === 'openai') {
    return cfg.openai.apiKey.length > 0
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'EMBEDDING_PROVIDER=openai needs OPENAI_API_KEY in server/.env — set it, or switch to EMBEDDING_PROVIDER=local for keyless lexical vectors' }
  }
  return { ok: true, reason: '' }
}

export const embeddings: ServiceAdapter<EmbedInput, EmbedOutput> = {
  id: 'embeddings',
  get label() {
    const cfg = env().embeddings
    return `Embeddings · ${cfg.provider}/${cfg.model} · ${cfg.dimensions}d ${cfg.metric}`
  },
  isConfigured: () => readiness(env().embeddings).ok,
  unavailableReason: () => readiness(env().embeddings).reason,
  async run(input) {
    const cfg = env().embeddings
    const ready = readiness(cfg)
    if (!ready.ok) throw new Error(ready.reason)
    if (!input.texts.length) return { vectors: [], provider: cfg.provider, model: cfg.model, dimensions: cfg.dimensions }

    let raw: number[][]
    if (cfg.provider === 'local') {
      raw = input.texts.map((t) => localEmbed(t, cfg.dimensions))
    } else if (cfg.provider === 'gemini') {
      raw = await withRetries(`Gemini ${cfg.model} embedding`, cfg.maxRetries, () => geminiEmbed(cfg, input))
    } else {
      raw = await withRetries(`OpenAI ${cfg.model} embedding`, cfg.maxRetries, () => openaiEmbed(cfg, input))
    }

    assertShape(raw, cfg.dimensions, cfg.provider, cfg.model)
    return { vectors: raw.map(normalize), provider: cfg.provider, model: cfg.model, dimensions: cfg.dimensions }
  },
}

/** Rough token estimate, matching the corpus loader's 4-chars-per-token heuristic. */
const roughTokens = (text: string): number => Math.ceil(text.length / 4)

/**
 * Splits texts into requests bounded by BOTH the batch size and the per-request token
 * budget. A single text that already exceeds the budget still goes out alone and is
 * truncated by the provider rather than being dropped.
 */
export function planBatches(texts: string[], cfg: EmbeddingConfig = env().embeddings): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let tokens = 0
  for (const text of texts) {
    const cost = roughTokens(text)
    const full = current.length >= cfg.batchSize
    const overBudget = current.length > 0 && tokens + cost > cfg.maxTokensPerRequest
    if (full || overBudget) {
      batches.push(current)
      current = []
      tokens = 0
    }
    current.push(text)
    tokens += cost
  }
  if (current.length) batches.push(current)
  return batches
}

/** Embeds many texts, batching by EMBEDDING_BATCH_SIZE and the token budget. */
export async function embedAll(texts: string[], purpose: EmbeddingPurpose = 'document', onBatch?: (done: number, total: number) => void): Promise<EmbedOutput> {
  const cfg = env().embeddings
  const vectors: number[][] = []
  for (const batch of planBatches(texts, cfg)) {
    const out = await embeddings.run({ texts: batch, purpose })
    vectors.push(...out.vectors)
    onBatch?.(vectors.length, texts.length)
  }
  return { vectors, provider: cfg.provider, model: cfg.model, dimensions: cfg.dimensions }
}

/** Convenience for search: one query vector with the query-side task type. */
export async function embedQuery(text: string): Promise<number[]> {
  const out = await embeddings.run({ texts: [text], purpose: 'query' })
  return out.vectors[0]
}
