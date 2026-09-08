// Turns the Analysis Agent's top hashtags into web knowledge:
//   hashtag → Parallel Web Systems search → pick N URLs → read page content → embed as 'web'
//
// Content comes from Parallel's excerpts, optionally enriched by fetching the page itself
// when that yields materially more text. Everything lands in the vector store through the
// same chunker, embedder and de-duplication check the corpus folder uses.
import { env } from '../config'
import { canonicalUrl } from '../db/vector-store'
import { parallel, type ParallelResult } from '../integrations/parallel'
import { ingestWebPages, type WebIngestReport, type WebPage } from './web-ingest'

export interface HashtagTargetLite {
  tag: string
  displayTag: string
  keywordTerm: string
  rank?: number
}

export interface WebResearchOptions {
  workspaceId: string
  targets: HashtagTargetLite[]
  /** URLs kept per hashtag. */
  urlsPerHashtag?: number
  /** Results requested from Parallel per hashtag, before the pick. */
  searchMaxResults?: number
  maxCharsPerResult?: number
  processor?: string
  retries?: number
  /** How many hashtags are searched concurrently. */
  concurrency?: number
  /** Fetch the page itself to get fuller text than the search excerpt. */
  fetchFullText?: boolean
  /** Pages with less text than this are not embedded. */
  minContentChars?: number
  /** Drop site roots (navigation pages) from the results. Default true. */
  skipBareDomains?: boolean
  /** Max URLs taken from one domain per hashtag, for source diversity. Default 1. */
  maxPerDomain?: number
  /** Re-embed even when the URL or its content is already stored. */
  force?: boolean
  /** Clear all previously stored web documents first. */
  reset?: boolean
  onProgress?: (line: string) => void
}

export interface WebResearchReport {
  hashtagsIn: number
  hashtagsSearched: number
  hashtagsFailed: number
  urlsPerHashtag: number
  urlsPicked: number
  uniqueUrls: number
  pagesFetched: number
  fetchFailures: number
  tooShort: number
  searchFailures: string[]
  perHashtag: Array<{ hashtag: string; keyword: string; resultsReturned: number; urlsPicked: string[]; error?: string }>
  ingest: WebIngestReport | null
  ms: number
}

/** Very small HTML→text reduction: enough to embed prose, no DOM dependency. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Block-level tags become paragraph breaks so the chunker sees structure.
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Fetches a URL and reduces it to text. Returns null on any failure — never throws. */
export async function fetchPageText(url: string, timeoutMs = 20000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        // Identify honestly; some sites reject unknown agents outright.
        'user-agent': 'EtharaKnowledgeBot/1.0 (+https://ethara.ai; research indexing)',
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) return null
    const body = await res.text()
    const text = /text\/plain/i.test(type) ? body : htmlToText(body)
    return text.length ? text : null
  } catch {
    return null
  }
}

const prettify = (tag: string) => tag.replace(/([a-z])([A-Z])/g, '$1 $2')

/** True when the URL points at a site root rather than a specific page. */
export function isBareDomain(url: string): boolean {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, '')
    return p === '' || p === '/'
  } catch {
    return false
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return url
  }
}

export interface PickOptions {
  urlsPerHashtag: number
  /** Drop site roots — they are navigation pages, not the relevant content. */
  skipBareDomains?: boolean
  /** Cap URLs taken from any one domain, so a single site cannot supply the whole set. */
  maxPerDomain?: number
}

/**
 * Chooses which of a hashtag's search results are worth reading, in rank order.
 * Filtering happens here rather than after fetching so we never spend a request or an
 * embedding call on a page we would discard.
 */
export function pickUrls(results: ParallelResult[], opts: PickOptions): { kept: ParallelResult[]; droppedBare: number; droppedDomain: number } {
  const skipBare = opts.skipBareDomains ?? true
  const maxPerDomain = Math.max(1, opts.maxPerDomain ?? 1)
  const perDomain = new Map<string, number>()
  const kept: ParallelResult[] = []
  let droppedBare = 0
  let droppedDomain = 0

  for (const r of results) {
    if (kept.length >= opts.urlsPerHashtag) break
    if (!r.url) continue
    if (skipBare && isBareDomain(r.url)) {
      droppedBare++
      continue
    }
    const host = hostOf(r.url)
    const used = perDomain.get(host) ?? 0
    if (used >= maxPerDomain) {
      droppedDomain++
      continue
    }
    perDomain.set(host, used + 1)
    kept.push(r)
  }
  return { kept, droppedBare, droppedDomain }
}

/**
 * Searches Parallel for each hashtag, keeps the top `urlsPerHashtag` URLs, reads their
 * content and embeds it under source 'web'.
 */
export async function researchHashtagsFromWeb(options: WebResearchOptions): Promise<WebResearchReport> {
  const started = Date.now()
  const cfg = env().parallel
  const log = (line: string) => options.onProgress?.(line)

  const urlsPerHashtag = Math.max(1, options.urlsPerHashtag ?? 4)
  const searchMaxResults = Math.max(urlsPerHashtag, options.searchMaxResults ?? cfg.maxResults)
  const maxCharsPerResult = options.maxCharsPerResult ?? cfg.maxCharsPerResult
  const processor = options.processor ?? cfg.processor
  const retries = options.retries ?? 2
  const concurrency = Math.max(1, options.concurrency ?? 3)
  const fetchFullText = options.fetchFullText ?? true
  const minContentChars = options.minContentChars ?? 400

  if (!parallel.isConfigured()) throw new Error(parallel.unavailableReason())

  const perHashtag: WebResearchReport['perHashtag'] = []
  const searchFailures: string[] = []
  // URL → the page plus every hashtag that surfaced it, so one page is embedded once.
  const picked = new Map<string, { result: ParallelResult; hashtags: string[]; keywords: string[]; rank: number }>()
  let urlsPicked = 0

  const queue = [...options.targets]
  const worker = async (): Promise<void> => {
    while (queue.length) {
      const target = queue.shift()
      if (!target) break
      const pretty = prettify(target.displayTag)
      try {
        const out = await parallel.run({
          objective: `Find the most substantive, current pages about #${target.displayTag} (${pretty})${target.keywordTerm ? ` in the context of ${target.keywordTerm}` : ''} in AI research and post-training. Prefer primary sources, papers and technical write-ups. Exclude vendor marketing and job postings.`,
          searchQueries: [pretty, `${pretty} ${target.keywordTerm}`.trim(), `${pretty} research paper`],
          maxResults: searchMaxResults,
          maxCharsPerResult,
          processor,
          retries,
        })
        const { kept: top, droppedBare, droppedDomain } = pickUrls(out.results, { urlsPerHashtag, skipBareDomains: options.skipBareDomains, maxPerDomain: options.maxPerDomain })
        urlsPicked += top.length
        if (droppedBare || droppedDomain) {
          log(`  #${target.displayTag} filtered ${droppedBare} site root(s), ${droppedDomain} same-domain result(s)`)
        }
        for (const [i, r] of top.entries()) {
          const url = canonicalUrl(r.url)
          const existing = picked.get(url)
          if (existing) {
            if (!existing.hashtags.includes(target.displayTag)) existing.hashtags.push(target.displayTag)
            if (target.keywordTerm && !existing.keywords.includes(target.keywordTerm)) existing.keywords.push(target.keywordTerm)
            // Keep the best rank any hashtag gave it.
            existing.rank = Math.min(existing.rank, i + 1)
          } else {
            picked.set(url, { result: { ...r, url }, hashtags: [target.displayTag], keywords: target.keywordTerm ? [target.keywordTerm] : [], rank: i + 1 })
          }
        }
        perHashtag.push({ hashtag: target.displayTag, keyword: target.keywordTerm, resultsReturned: out.results.length, urlsPicked: top.map((r) => canonicalUrl(r.url)) })
        log(`searched #${target.displayTag} · ${out.results.length} results · kept ${top.length}`)
      } catch (err) {
        const why = `Parallel failed for #${target.displayTag}: ${err instanceof Error ? err.message : String(err)}`
        searchFailures.push(why)
        perHashtag.push({ hashtag: target.displayTag, keyword: target.keywordTerm, resultsReturned: 0, urlsPicked: [], error: why })
        log(why)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))

  log(`${picked.size} unique URLs from ${urlsPicked} picks across ${perHashtag.filter((h) => !h.error).length} hashtags`)

  const read = await readPickedPages(picked, { fetchFullText, minContentChars, processor, onProgress: log })
  const { pages, pagesFetched, fetchFailures, tooShort } = read

  log(`reading complete · ${pages.length} pages to embed · ${pagesFetched} enriched by fetch · ${fetchFailures} fetch failures · ${tooShort} too short`)

  const ingest = pages.length
    ? await ingestWebPages({ workspaceId: options.workspaceId, pages, force: options.force, reset: options.reset, onProgress: log })
    : null

  return {
    hashtagsIn: options.targets.length,
    hashtagsSearched: perHashtag.filter((h) => !h.error).length,
    hashtagsFailed: perHashtag.filter((h) => h.error).length,
    urlsPerHashtag,
    urlsPicked,
    uniqueUrls: picked.size,
    pagesFetched,
    fetchFailures,
    tooShort,
    searchFailures,
    perHashtag,
    ingest,
    ms: Date.now() - started,
  }
}

interface PickedEntry {
  result: ParallelResult
  hashtags: string[]
  keywords: string[]
  rank: number
}

/**
 * Reads each picked URL. Parallel's excerpt is the floor; a direct page fetch replaces
 * it only when it yields more text. Pages below the minimum are dropped, not embedded.
 */
async function readPickedPages(
  picked: Map<string, PickedEntry>,
  opts: { fetchFullText: boolean; minContentChars: number; processor: string; onProgress?: (line: string) => void },
): Promise<{ pages: WebPage[]; pagesFetched: number; fetchFailures: number; tooShort: number }> {
  const pages: WebPage[] = []
  let pagesFetched = 0
  let fetchFailures = 0
  let tooShort = 0

  for (const [url, entry] of picked) {
    const excerpt = entry.result.excerpt ?? ''
    let text = excerpt
    let readVia: 'parallel-excerpt' | 'page-fetch' = 'parallel-excerpt'
    if (opts.fetchFullText) {
      const fetched = await fetchPageText(url)
      if (fetched && fetched.length > excerpt.length) {
        text = fetched
        readVia = 'page-fetch'
        pagesFetched++
      } else if (!fetched) {
        fetchFailures++
      }
    }
    if (text.trim().length < opts.minContentChars) {
      tooShort++
      opts.onProgress?.(`too short ${url} · ${text.trim().length} chars`)
      continue
    }
    pages.push({
      url,
      title: entry.result.title || url,
      text,
      retrievedAt: new Date().toISOString(),
      meta: {
        provider: 'parallel-web-systems',
        processor: opts.processor,
        readVia,
        hashtags: entry.hashtags,
        keywords: entry.keywords,
        resultRank: entry.rank,
        publishedAt: entry.result.publishedAt ?? null,
        excerptChars: excerpt.length,
        contentChars: text.length,
      },
    })
  }
  return { pages, pagesFetched, fetchFailures, tooShort }
}

/** Structural shape of `knowledge.research.search` output, to avoid a circular import. */
export interface ResearchGroup {
  hashtag: { displayTag: string; keywordTerm: string }
  results?: ParallelResult[]
}

/**
 * Converts already-retrieved Parallel results into readable pages: keeps the top
 * `urlsPerHashtag` per hashtag, de-duplicates URLs across hashtags, then reads them.
 * Used by the `knowledge.web.ingest` skill so a build does not search twice.
 */
export async function pagesFromResearch(
  groups: ResearchGroup[],
  opts: { urlsPerHashtag: number; fetchFullText: boolean; minContentChars: number; onProgress?: (line: string) => void },
): Promise<WebPage[]> {
  const picked = new Map<string, PickedEntry>()
  for (const group of groups) {
    const { kept: top } = pickUrls(group.results ?? [], { urlsPerHashtag: opts.urlsPerHashtag })
    for (const [i, r] of top.entries()) {
      const url = canonicalUrl(r.url)
      const existing = picked.get(url)
      if (existing) {
        if (!existing.hashtags.includes(group.hashtag.displayTag)) existing.hashtags.push(group.hashtag.displayTag)
        if (group.hashtag.keywordTerm && !existing.keywords.includes(group.hashtag.keywordTerm)) existing.keywords.push(group.hashtag.keywordTerm)
        existing.rank = Math.min(existing.rank, i + 1)
      } else {
        picked.set(url, { result: { ...r, url }, hashtags: [group.hashtag.displayTag], keywords: group.hashtag.keywordTerm ? [group.hashtag.keywordTerm] : [], rank: i + 1 })
      }
    }
  }
  const { pages } = await readPickedPages(picked, { ...opts, processor: env().parallel.processor })
  return pages
}
