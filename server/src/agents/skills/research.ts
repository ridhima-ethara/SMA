// Knowledge Agent skills — stage `learn`. Owns the Knowledge Base; runs Sunday 06:00 and on demand.
import { similarity } from '../../../../shared/brand-voice'
import { normaliseTag } from '../../../../shared/keywords'
import { one, query } from '../../db/pool'
import { parallel } from '../../integrations/parallel'
import type { ParallelResult } from '../../integrations/parallel'
import { hybridRetrieve, type RetrievedChunk } from '../retrieval'
import { ingestWebPages } from '../web-ingest'
import { pagesFromResearch } from '../web-research'
import { effectiveConfig, registerSkill } from '../runtime'

export interface ResearchSource { title: string; url: string; publishedAt: string; domain?: string }

export interface KnowledgeRow {
  id: string
  title: string
  category: string
  content: string
  source: string
  sources: ResearchSource[]
  hashtagId: string | null
  hashtagTag: string | null
  tags: string[]
  confidence: 'High' | 'Medium' | 'Low'
  evidenceCount: number
  active: boolean
  origin: 'brand' | 'research' | 'learned' | 'manual'
  createdAt: string
  score?: number
}

export interface HashtagTarget {
  id: string
  tag: string
  displayTag: string
  keywordTerm: string
  rank: number
  researchedAt: string | null
}

export interface ResearchResultSet {
  hashtag: HashtagTarget
  source: 'live' | 'fixture'
  fallbackReason?: string
  results?: ParallelResult[]
}

export interface CandidateEntry {
  hashtag: HashtagTarget
  title: string
  content: string
  category: string
  sources: ResearchSource[]
  confidence: 'High' | 'Medium' | 'Low'
  source: 'live' | 'fixture'
  fallbackReason?: string
}

export interface KnowledgePayload extends Record<string, unknown> {
  trigger: 'cron' | 'manual'
  buildId: string
  hashtagCount?: number
  forceRefresh?: boolean
  researchSet: HashtagTarget[]
  researchResults: ResearchResultSet[]
  candidateEntries: CandidateEntry[]
  written: number
  merged: number
  sourcesCited: number
  researchSource: 'live' | 'fixture'
  fallbackReason?: string
  entries: KnowledgeRow[]
  /** Vector-store chunks from hybrid retrieval, spanning every populated source. */
  retrievedChunks: RetrievedChunk[]
  /** Web pages embedded into the vector store this build. */
  webPagesEmbedded: number
  resolutions: string[]
  outputCount?: number
  completionNote?: string
}

const CONF_RANK: Record<KnowledgeRow['confidence'], number> = { High: 3, Medium: 2, Low: 1 }
const confidenceFor = (n: number): KnowledgeRow['confidence'] => (n >= 3 ? 'High' : n === 2 ? 'Medium' : 'Low')

export function mapKnowledgeRow(r: Record<string, unknown>): KnowledgeRow {
  return {
    id: String(r.id), title: String(r.title), category: String(r.category), content: String(r.content), source: String(r.source ?? ''),
    sources: (r.sources as ResearchSource[]) ?? [], hashtagId: (r.hashtag_id as string) ?? null, hashtagTag: (r.hashtag_tag as string) ?? null,
    tags: (r.tags as string[]) ?? [], confidence: r.confidence as KnowledgeRow['confidence'], evidenceCount: Number(r.evidence_count ?? 1),
    active: Boolean(r.active), origin: r.origin as KnowledgeRow['origin'], createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }
}

/** The read path every other agent uses. Honours the `knowledge.entry.retrieve` and `.rank` knobs. */
export async function retrieveKnowledge(workspaceId: string, queryText: string, opts?: { maxResults?: number; includeInactive?: boolean }): Promise<KnowledgeRow[]> {
  const cfg = await effectiveConfig(workspaceId, 'knowledge.entry.retrieve')
  const rankCfg = await effectiveConfig(workspaceId, 'knowledge.entry.rank')
  const prioCfg = await effectiveConfig(workspaceId, 'knowledge.priority.tag')
  const includeInactive = opts?.includeInactive ?? Boolean(cfg.includeInactive)
  const max = opts?.maxResults ?? Number(cfg.maxResults)
  const rows = await query(`SELECT * FROM knowledge_entries WHERE workspace_id = $1 ${includeInactive ? '' : 'AND active = true'}`, [workspaceId])
  const entries = rows.map(mapKnowledgeRow)
  const w = Number(rankCfg.confidenceWeight) / 100
  const boost = 1 + Number(prioCfg.priorityBoost) / 100
  for (const e of entries) {
    const sim = Math.max(similarity(queryText, `${e.title} ${e.content}`), e.hashtagTag && queryText.toLowerCase().includes(e.hashtagTag.toLowerCase()) ? 0.6 : 0)
    let score = (CONF_RANK[e.confidence] / 3) * w + sim * (1 - w)
    if (e.tags.includes('priority')) score *= boost
    else if (prioCfg.demoteUntagged && e.origin !== 'brand') score *= 0.6
    if (e.origin === 'brand') score += 0.15 // brand entries are always read first
    e.score = Math.round(score * 1000) / 1000
  }
  // Brand entries are always read, but they never crowd out the research and learned entries that ground a claim.
  const sorted = entries.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const brand = sorted.filter((e) => e.origin === 'brand').slice(0, Math.min(3, Math.max(1, Math.floor(max / 3))))
  const rest = sorted.filter((e) => e.origin !== 'brand').slice(0, Math.max(0, max - brand.length))
  return [...brand, ...rest]
}

registerSkill<KnowledgePayload>('knowledge.hashtag.select', async (p, ctx) => {
  const count = p.hashtagCount ?? ctx.num('hashtagCount')
  const recency = ctx.num('recencyDays')
  const force = p.forceRefresh ?? ctx.bool('forceRefresh')
  const rows = await query<{ id: string; tag: string; display_tag: string; rank: number; researched_at: Date | null; term: string | null }>(
    `SELECT h.id, h.tag, h.display_tag, h.rank, h.researched_at, k.term FROM hashtags h LEFT JOIN keywords k ON k.id = h.keyword_id
     WHERE h.workspace_id = $1 AND h.in_top_set = true ORDER BY h.hashtag_score DESC, h.rank ASC NULLS LAST LIMIT $2`,
    [ctx.workspaceId, count],
  )
  const cutoff = Date.now() - recency * 86400000
  const set: HashtagTarget[] = rows
    .filter((r) => force || !r.researched_at || r.researched_at.getTime() < cutoff)
    .map((r) => ({ id: r.id, tag: r.tag, displayTag: r.display_tag, keywordTerm: r.term ?? '', rank: r.rank ?? 0, researchedAt: r.researched_at ? r.researched_at.toISOString() : null }))
  ctx.log(`${set.length} of ${rows.length} top hashtags selected (${force ? 'forced' : `skipping any researched within ${recency}d`})`)
  return { researchSet: set }
})

registerSkill<KnowledgePayload>('knowledge.research.search', async (p, ctx) => {
  const maxParallel = Math.max(1, ctx.num('maxParallel'))
  const windowDays = ctx.num('windowDays')
  const processor = ctx.str('processor')
  const maxResults = ctx.num('maxResults')
  const retries = ctx.num('retries')
  if (!parallel.isConfigured()) {
    const reason = parallel.unavailableReason()
    await ctx.activity(reason, 'error')
    throw new Error(reason)
  }
  const results: ResearchResultSet[] = []
  const queue = [...p.researchSet]
  const failures: string[] = []
  const worker = async () => {
    while (queue.length) {
      const h = queue.shift() as HashtagTarget
      const pretty = h.displayTag.replace(/([a-z])([A-Z])/g, '$1 $2')
      try {
        const out = await parallel.run({
          objective: `What is materially new about #${h.displayTag} (${pretty}) in AI research and post-training in the last ${windowDays} days? Return concrete findings, named sources, dates and figures. Exclude vendor marketing.`,
          searchQueries: [pretty, `${pretty} ${h.keywordTerm}`, `${pretty} arxiv`],
          maxResults, maxCharsPerResult: 6000, processor, retries,
        })
        results.push({ hashtag: h, source: 'live', results: out.results })
      } catch (err) {
        const why = `Parallel failed for #${h.displayTag}: ${err instanceof Error ? err.message : String(err)}`
        failures.push(why)
        await ctx.activity(why, 'warn')
      }
    }
  }
  await Promise.all(Array.from({ length: maxParallel }, worker))
  if (results.length === 0 && p.researchSet.length) throw new Error(failures[0] ?? 'Parallel returned nothing for the selected hashtags')
  ctx.log(`${results.length} hashtags researched${failures.length ? ` · ${failures.length} failed` : ''}`)
  return { researchResults: results, researchSource: 'live', fallbackReason: failures.length ? failures[0] : undefined }
})

registerSkill<KnowledgePayload>('knowledge.research.extract', (p, ctx) => {
  const minSources = ctx.num('minSources')
  const maxChars = ctx.num('maxChars')
  const maxPer = ctx.num('maxEntriesPerHashtag')
  const out: CandidateEntry[] = []
  let discarded = 0
  for (const r of p.researchResults) {
    const cands: CandidateEntry[] = []
    // Group live results into entries of ~3 sources each.
    const results = (r.results ?? []).filter((x) => x.excerpt)
    for (let i = 0; i < results.length && cands.length < maxPer; i += 3) {
      const group = results.slice(i, i + 3)
      const pretty = r.hashtag.displayTag.replace(/([a-z])([A-Z])/g, '$1 $2')
      cands.push({ hashtag: r.hashtag, title: `${pretty}: ${group[0].title}`.slice(0, 140), content: group.map((g) => g.excerpt.replace(/\s+/g, ' ').trim()).join(' ').slice(0, maxChars), category: 'Research', sources: group.map((g) => ({ title: g.title, url: g.url, publishedAt: g.publishedAt ?? new Date().toISOString().slice(0, 10), domain: safeHost(g.url) })), confidence: confidenceFor(group.length), source: 'live' })
    }
    for (const c of cands.slice(0, maxPer)) {
      if (c.sources.length < minSources) { discarded++; continue }
      out.push(c)
    }
  }
  ctx.log(`${out.length} candidate entries (${discarded} discarded for fewer than ${minSources} cited sources)`)
  return { candidateEntries: out }
})

function safeHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

registerSkill<KnowledgePayload>('knowledge.entry.upsert', async (p, ctx) => {
  const threshold = ctx.num('dedupeThreshold') / 100
  const active = (await query('SELECT * FROM knowledge_entries WHERE workspace_id = $1 AND active = true AND origin IN (\'research\', \'learned\', \'manual\')', [ctx.workspaceId])).map(mapKnowledgeRow)
  let written = 0
  let merged = 0
  let cited = 0
  const touched = new Set<string>()
  for (const c of p.candidateEntries) {
    const match = active.find((e) => similarity(`${e.title} ${e.content}`, `${c.title} ${c.content}`) >= threshold)
    if (match) {
      const union = [...match.sources]
      for (const s of c.sources) if (!union.some((u) => u.url === s.url)) union.push(s)
      const confidence = confidenceFor(Math.max(CONF_RANK[match.confidence], CONF_RANK[c.confidence], union.length >= 3 ? 3 : union.length))
      await query('UPDATE knowledge_entries SET evidence_count = evidence_count + 1, confirmations = confirmations + 1, sources = $2, confidence = $3, build_id = $4 WHERE id = $1', [match.id, JSON.stringify(union), confidence, p.buildId])
      match.sources = union
      match.confidence = confidence
      merged++
      cited += c.sources.length
      ctx.emit('knowledge.written', `Merged into "${match.title}" (evidence ${match.evidenceCount + 1})`, { id: match.id, merged: true, hashtag: c.hashtag.displayTag })
    } else {
      const row = await one<{ id: string }>(
        `INSERT INTO knowledge_entries (workspace_id, title, category, content, source, sources, hashtag_id, hashtag_tag, tags, confidence, evidence_count, origin, build_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'research', $12) RETURNING id`,
        [ctx.workspaceId, c.title, c.category, c.content, 'Parallel Web Systems', JSON.stringify(c.sources), c.hashtag.id, c.hashtag.displayTag, [c.hashtag.tag, c.hashtag.keywordTerm].filter(Boolean), c.confidence, c.sources.length, p.buildId],
      )
      if (row) {
        active.push({ id: row.id, title: c.title, category: c.category, content: c.content, source: '', sources: c.sources, hashtagId: c.hashtag.id, hashtagTag: c.hashtag.displayTag, tags: [], confidence: c.confidence, evidenceCount: 1, active: true, origin: 'research', createdAt: new Date().toISOString() })
        await query('INSERT INTO lineage_edges (workspace_id, from_type, from_id, to_type, to_id, agent_id) VALUES ($1, $2, $3, $4, $5, $6)', [ctx.workspaceId, 'hashtag', c.hashtag.id, 'knowledge_entry', row.id, 'knowledge'])
        ctx.emit('knowledge.written', c.title, { id: row.id, category: c.category, hashtag: c.hashtag.displayTag, confidence: c.confidence, source: c.source })
      }
      written++
      cited += c.sources.length
    }
    touched.add(c.hashtag.id)
  }
  if (touched.size) await query('UPDATE hashtags SET researched_at = now() WHERE id = ANY($1::uuid[])', [Array.from(touched)])
  ctx.log(`${written} written, ${merged} merged, ${cited} sources cited`)
  return { written, merged, sourcesCited: cited, outputCount: written + merged }
})

registerSkill<KnowledgePayload>('knowledge.entry.retrieve', async (_p, ctx) => {
  const includeInactive = ctx.bool('includeInactive')
  const max = ctx.num('maxResults')
  const rows = await query(`SELECT * FROM knowledge_entries WHERE workspace_id = $1 ${includeInactive ? '' : 'AND active = true'} ORDER BY created_at DESC LIMIT $2`, [ctx.workspaceId, max])
  ctx.log(`${rows.length} entries readable by other agents`)
  return { entries: rows.map(mapKnowledgeRow) }
})

registerSkill<KnowledgePayload>('knowledge.web.ingest', async (p, ctx) => {
  const urlsPerHashtag = ctx.num('urlsPerHashtag')
  const minContentChars = ctx.num('minContentChars')
  const fetchFullText = ctx.bool('fetchFullText')
  if (!p.researchResults.length) {
    ctx.log('no Parallel results to embed')
    return { webPagesEmbedded: 0 }
  }
  // Reuse the URLs knowledge.research.search already retrieved rather than searching again.
  const pages = await pagesFromResearch(p.researchResults, { urlsPerHashtag, fetchFullText, minContentChars })
  if (!pages.length) {
    ctx.log(`no page met the ${minContentChars}-character minimum`)
    return { webPagesEmbedded: 0 }
  }
  const report = await ingestWebPages({ workspaceId: ctx.workspaceId, pages })
  ctx.log(
    `${report.embedded} pages embedded · ${report.duplicates} duplicate · ${report.skipped} unchanged · ${report.empty} empty · ${report.failed} failed · ${report.chunksWritten} chunks`,
  )
  return { webPagesEmbedded: report.embedded }
})

registerSkill<KnowledgePayload>('knowledge.hybrid.retrieve', async (p, ctx) => {
  // Verifies the read path across every populated source during a build, using the
  // hashtags being researched as the probe query.
  const probe = p.researchSet.map((h) => h.displayTag).join(' ').trim()
  if (!probe) {
    ctx.log('no research set to probe with — skipped')
    return
  }
  const result = await hybridRetrieve({ workspaceId: ctx.workspaceId, query: probe })
  const spread = Object.entries(result.counts.bySource).map(([s, n]) => `${s}=${n}`).join(', ') || 'none'
  ctx.log(
    `${result.counts.returned} chunks from ${result.sources.length} source(s) [${spread}] · dense ${result.counts.dense} · lexical ${result.counts.lexical}` +
      `${result.sourcesUnpopulated.length ? ` · no embeddings yet for ${result.sourcesUnpopulated.join(', ')}` : ''}`,
  )
  if (result.sourcesUnpopulated.length) {
    await ctx.activity(`Hybrid retrieval found no embeddings for source(s): ${result.sourcesUnpopulated.join(', ')}`, 'warn')
  }
  return { retrievedChunks: result.results }
})

registerSkill<KnowledgePayload>('knowledge.entry.rank', (p, ctx) => {
  const w = ctx.num('confidenceWeight') / 100
  const topic = p.researchSet.map((h) => h.displayTag).join(' ')
  for (const e of p.entries) e.score = Math.round(((CONF_RANK[e.confidence] / 3) * w + similarity(topic, `${e.title} ${e.content}`) * (1 - w)) * 1000) / 1000
  p.entries.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  return { entries: p.entries }
})

registerSkill<KnowledgePayload>('knowledge.conflict.resolve', async (_p, ctx) => {
  const strategy = ctx.str('strategy')
  const rows = (await query('SELECT * FROM knowledge_entries WHERE workspace_id = $1 AND active = true AND origin <> \'brand\'', [ctx.workspaceId])).map(mapKnowledgeRow)
  const resolutions: string[] = []
  const handled = new Set<string>()
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j]
      if (a.category !== b.category || handled.has(a.id) || handled.has(b.id)) continue
      const s = similarity(`${a.title} ${a.content}`, `${b.title} ${b.content}`)
      if (s < 0.55) continue
      if (strategy === 'Escalate to human') {
        const existing = await one('SELECT id FROM review_queue WHERE workspace_id = $1 AND kind = $2 AND entity_id = $3 AND resolved = false', [ctx.workspaceId, 'knowledge_conflict', a.id])
        if (!existing) await query('INSERT INTO review_queue (workspace_id, kind, entity_id, title, reason, decision_requested, options) VALUES ($1, $2, $3, $4, $5, $6, $7)', [ctx.workspaceId, 'knowledge_conflict', a.id, a.title, `"${a.title}" and "${b.title}" overlap at ${Math.round(s * 100)}% in ${a.category}.`, `Which entry should stay active?`, [`Keep "${a.title.slice(0, 40)}"`, `Keep "${b.title.slice(0, 40)}"`]])
        resolutions.push(`Escalated: ${a.title} vs ${b.title}`)
      } else {
        const loser = strategy === 'Highest confidence wins' ? (CONF_RANK[a.confidence] >= CONF_RANK[b.confidence] ? b : a) : (a.createdAt >= b.createdAt ? b : a)
        await query('UPDATE knowledge_entries SET active = false WHERE id = $1', [loser.id])
        resolutions.push(`${strategy}: deactivated "${loser.title}"`)
      }
      handled.add(a.id); handled.add(b.id)
    }
  }
  ctx.log(`${resolutions.length} conflict(s) handled (${strategy})`)
  return { resolutions }
})

registerSkill<KnowledgePayload>('knowledge.priority.tag', (p, ctx) => {
  const boost = 1 + ctx.num('priorityBoost') / 100
  const demote = ctx.bool('demoteUntagged')
  for (const e of p.entries) {
    if (e.tags.includes('priority')) e.score = (e.score ?? 0) * boost
    else if (demote) e.score = (e.score ?? 0) * 0.6
  }
  return { entries: p.entries, completionNote: `Knowledge Base built · ${p.written} new · ${p.merged} merged` }
})

export const normalise = normaliseTag
