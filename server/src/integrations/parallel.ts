// Parallel Web Systems adapter — deep web research for the Knowledge Agent. Requires PARALLEL_API_KEY.
import { env } from '../config'
import type { ServiceAdapter } from './apify'

export interface ParallelSearchInput {
  objective: string
  searchQueries: string[]
  maxResults: number
  maxCharsPerResult: number
  processor: string
  retries: number
}

export interface ParallelResult {
  title: string
  url: string
  excerpt: string
  publishedAt?: string
}

export interface ParallelSearchOutput {
  results: ParallelResult[]
  source: 'live' | 'fixture'
  fallbackReason?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const NOT_CONFIGURED = 'PARALLEL_API_KEY is not set — add it to server/.env so the Knowledge Agent can research the top hashtags'

export const parallel: ServiceAdapter<ParallelSearchInput, ParallelSearchOutput> = {
  id: 'parallel',
  label: 'Parallel Web Systems',
  isConfigured: () => env().parallel.apiKey.length > 0,
  unavailableReason: () => (env().parallel.apiKey ? '' : NOT_CONFIGURED),
  async run(input) {
    if (!this.isConfigured()) throw new Error(NOT_CONFIGURED)
    const cfg = env().parallel
    let lastErr: unknown
    for (let attempt = 0; attempt <= input.retries; attempt++) {
      try {
        const res = await fetch(`${cfg.baseUrl}${cfg.searchPath}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey },
          body: JSON.stringify({ objective: input.objective, search_queries: input.searchQueries, processor: input.processor, max_results: input.maxResults, max_chars_per_result: input.maxCharsPerResult }),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        })
        if (!res.ok) throw new Error(`Parallel responded ${res.status}${res.status === 401 ? ' (check PARALLEL_API_KEY)' : ''}`)
        const json = (await res.json()) as { results?: Array<Record<string, unknown>> }
        if (!Array.isArray(json.results)) throw new Error('Parallel returned no results array')
        const results: ParallelResult[] = json.results.map((r) => ({
          title: String(r.title ?? r.url ?? 'Untitled'),
          url: String(r.url ?? ''),
          excerpt: Array.isArray(r.excerpts) ? (r.excerpts as string[]).join('\n') : String(r.excerpt ?? r.content ?? ''),
          publishedAt: r.published_at ? String(r.published_at) : undefined,
        })).filter((r) => r.url)
        return { results, source: 'live' }
      } catch (err) {
        lastErr = err
        if (attempt < input.retries) await sleep(500 * 2 ** attempt)
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  },
}
