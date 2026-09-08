// The only module that sequences agents.
import { env } from './config'
import { bus } from './events'
import { one, query } from './db/pool'
import { ensureWorkspace } from './db/migrate'
import { effectiveConfig, logActivity, runAgent, setAgentState, type SkillRunRecord } from './agents/runtime'
import { SEED_SOURCES } from './agents/corpus'
import type { ScrapePayload, KeywordRow } from './agents/skills/discover'
import type { AnalysisPayload, Candidate, ValidationPayload } from './agents/skills/assess'
import { rankIdeas, parseTimeLabel, type IdeaDraft, type PlanPayload, type Platform } from './agents/skills/plan'
import type { CaptionPayload, IdeaRecord, ReviewPayload } from './agents/skills/create'
import type { ImagePayload } from './agents/skills/create-image'
import type { KnowledgePayload } from './agents/skills/research'
import type { AnalyticsPayload, PublishPayload } from './agents/skills/ship'
import type { LearningPayload } from './agents/skills/learn'
import { BRAND, enforceBrandVoice } from '../../shared/brand-voice'
import { gcpText } from './integrations/gcp-llm'
import { groundingFromRetrieval, hybridRetrieve } from './agents/retrieval'

let cachedWs: string | null = null
export async function currentWorkspaceId(): Promise<string> {
  if (!cachedWs) cachedWs = await ensureWorkspace(env().workspaceSlug)
  return cachedWs
}

// ── Helpers ─────────────────────────────────────────────────────────────
export async function loadIdea(ideaId: string): Promise<(IdeaRecord & { status: string; scheduledDate: string; scheduledTime: string; hashtagId: string | null }) | null> {
  const r = await one('SELECT i.*, h.display_tag FROM content_ideas i LEFT JOIN hashtags h ON h.id = i.hashtag_id WHERE i.id = $1', [ideaId])
  if (!r) return null
  return { id: r.id, title: r.title, description: r.description ?? '', sourceTopic: r.source_topic ?? '', hashtagDisplay: r.display_tag ?? (r.analysis?.hashtag as string | undefined), platform: r.platform, analysis: r.analysis ?? {}, feedback: r.feedback ?? [], status: r.status, scheduledDate: typeof r.scheduled_date === 'string' ? r.scheduled_date : new Date(r.scheduled_date).toISOString().slice(0, 10), scheduledTime: r.scheduled_time, hashtagId: r.hashtag_id }
}

const slim = (skills: SkillRunRecord[]) => skills.map((s) => ({ skillId: s.skillId, status: s.status, durationMs: s.durationMs, note: s.note }))

/** Re-applies the top-N-per-platform rule across every live idea, using the calendar.rank.select knobs. */
export async function applyTopRule(workspaceId: string): Promise<Array<{ id: string; title: string; platform: Platform; before: string; after: string }>> {
  const cfg = await effectiveConfig(workspaceId, 'calendar.rank.select')
  const rows = await query<{ id: string; title: string; platform: Platform; confidence: number; analysis: { brandRelevance?: number; trendScore?: number }; priority_score: number; platform_rank: number | null; calendar_slot: 'primary' | 'suggestion' }>(
    "SELECT id, title, platform, confidence, analysis, priority_score, platform_rank, calendar_slot FROM content_ideas WHERE workspace_id = $1 AND status NOT IN ('published', 'rejected')", [workspaceId],
  )
  const pool = rows.map((r) => ({ id: r.id, title: r.title, platform: r.platform, confidence: r.confidence, analysis: { brandRelevance: r.analysis?.brandRelevance ?? 60, trendScore: r.analysis?.trendScore ?? 60 }, priorityScore: r.priority_score, platformRank: r.platform_rank ?? 99, calendarSlot: r.calendar_slot, pinned: r.priority_score, before: r.calendar_slot }))
  // Manual promotions/demotions live in priority_score; keep them by ranking on the stored score, not the recomputed one.
  rankIdeas(pool, { topPerPlatform: Number(cfg.topPerPlatform), confidenceWeight: Number(cfg.rankConfidenceWeight), relevanceWeight: Number(cfg.rankRelevanceWeight), trendWeight: Number(cfg.rankTrendWeight), balance: Boolean(cfg.balanceAcrossPlatforms) })
  for (const p of pool) p.priorityScore = p.pinned || p.priorityScore
  const groups = (['linkedin', 'instagram', 'x'] as Platform[]).map((pl) => pool.filter((p) => p.platform === pl))
  const changed: Array<{ id: string; title: string; platform: Platform; before: string; after: string }> = []
  for (const g of groups) {
    g.sort((a, b) => b.priorityScore - a.priorityScore)
    for (let i = 0; i < g.length; i++) {
      const p = g[i]
      const slot = i < Number(cfg.topPerPlatform) ? 'primary' : 'suggestion'
      await query('UPDATE content_ideas SET priority_score = $2, platform_rank = $3, calendar_slot = $4, updated_at = now() WHERE id = $1', [p.id, Math.min(100, Math.max(0, Math.round(p.priorityScore))), i + 1, slot])
      if (slot !== p.before) changed.push({ id: p.id, title: p.title, platform: p.platform, before: p.before, after: slot })
    }
  }
  return changed
}

export async function promoteIdea(workspaceId: string, ideaId: string): Promise<{ ok: true; demoted: { id: string; title: string } | null }> {
  const idea = await one<{ platform: Platform }>('SELECT platform FROM content_ideas WHERE id = $1', [ideaId])
  if (!idea) throw new Error('Idea not found')
  const cfg = await effectiveConfig(workspaceId, 'calendar.rank.select')
  const top = Number(cfg.topPerPlatform)
  const primaries = await query<{ id: string; priority_score: number }>("SELECT id, priority_score FROM content_ideas WHERE workspace_id = $1 AND platform = $2 AND calendar_slot = 'primary' AND status NOT IN ('published','rejected') AND id <> $3 ORDER BY priority_score ASC", [workspaceId, idea.platform, ideaId])
  // Take the last slot: just above the lowest-ranked primary so only that one is displaced.
  const floor = primaries.length >= top ? primaries[0].priority_score : primaries[0]?.priority_score ?? 50
  await query('UPDATE content_ideas SET priority_score = $2, updated_at = now() WHERE id = $1', [ideaId, Math.min(100, floor + 1)])
  const changed = await applyTopRule(workspaceId)
  const demoted = changed.find((c) => c.after === 'suggestion' && c.platform === idea.platform && c.id !== ideaId)
  await logActivity(workspaceId, 'calendar', `Promoted an idea to the calendar${demoted ? ` — "${demoted.title}" moved to More suggestions` : ''}`, 'ok', { type: 'content_idea', id: ideaId })
  return { ok: true, demoted: demoted ? { id: demoted.id, title: demoted.title } : null }
}

export async function demoteIdea(workspaceId: string, ideaId: string): Promise<{ ok: true; promoted: { id: string; title: string } | null }> {
  const idea = await one<{ platform: Platform }>('SELECT platform FROM content_ideas WHERE id = $1', [ideaId])
  if (!idea) throw new Error('Idea not found')
  const lowest = await one<{ priority_score: number }>("SELECT priority_score FROM content_ideas WHERE workspace_id = $1 AND platform = $2 AND status NOT IN ('published','rejected') ORDER BY priority_score ASC LIMIT 1", [workspaceId, idea.platform])
  await query('UPDATE content_ideas SET priority_score = $2, updated_at = now() WHERE id = $1', [ideaId, Math.max(0, (lowest?.priority_score ?? 1) - 1)])
  const changed = await applyTopRule(workspaceId)
  const promoted = changed.find((c) => c.after === 'primary' && c.platform === idea.platform)
  await logActivity(workspaceId, 'calendar', `Demoted an idea to More suggestions${promoted ? ` — "${promoted.title}" took the slot` : ''}`, 'ok', { type: 'content_idea', id: ideaId })
  return { ok: true, promoted: promoted ? { id: promoted.id, title: promoted.title } : null }
}

// ── Discovery pipeline: scrape → validate → analyse → plan ──────────────
export interface PipelineResult {
  pipelineRunId: string
  status: 'completed' | 'failed'
  summary: Record<string, unknown>
  trendingKeywords: ValidationPayload['trendingKeywords']
  topHashtags: AnalysisPayload['topHashtags']
  ideas: Array<{ id: string; title: string; platform: Platform; calendarSlot: string; platformRank: number; date: string; time: string; confidence: number }>
  theater: {
    keywords: Array<{ id: string; term: string; items: Array<{ id: string; title: string; engagement: number; sourceName: string; sourceType: string; hashtags: string[]; relevance: number }> }>
    verdicts: Array<{ id: string; kind: 'item' | 'hashtag'; title: string; verdict: string; reason: string; credibility: string; relevance: number; freshness: number; isDuplicate: boolean; keyword: string }>
    hashtagsByKeyword: Array<{ keyword: string; tags: Array<{ id: string; tag: string; rank: number; verdict: string; score: number }> }>
    reviewQueue: Array<{ id: string; kind: string; entityId: string; title: string; reason: string; decisionRequested: string }>
  }
  error?: string
}

export async function runDiscoveryPipeline(opts: { workspaceId: string; paceMs?: number; keywordIds?: string[]; trigger?: string }): Promise<PipelineResult> {
  const { workspaceId, paceMs = 0 } = opts
  const run = await one<{ id: string }>('INSERT INTO pipeline_runs (workspace_id, trigger, status) VALUES ($1, $2, $3) RETURNING id', [workspaceId, opts.trigger ?? 'manual', 'running'])
  const runId = run?.id ?? ''
  bus.publish({ type: 'pipeline.started', runId, message: 'Pipeline started' })
  await logActivity(workspaceId, 'scraping', 'Pipeline run started', 'running')
  const prior = await one<{ n: number }>('SELECT count(*)::int AS n FROM pipeline_runs WHERE workspace_id = $1 AND id <> $2', [workspaceId, runId])
  const runOffset = prior?.n ?? 0
  const keywords = (await query<KeywordRow>('SELECT id, term, category, weight, active FROM keywords WHERE workspace_id = $1 ORDER BY weight DESC', [workspaceId])).filter((k) => !opts.keywordIds?.length || opts.keywordIds.includes(k.id))
  const fail = async (error: string): Promise<PipelineResult> => {
    await query('UPDATE pipeline_runs SET status = $2, finished_at = now(), summary = $3 WHERE id = $1', [runId, 'failed', JSON.stringify({ error })])
    bus.publish({ type: 'pipeline.finished', runId, message: `Pipeline failed: ${error}`, data: { status: 'failed', error } })
    await logActivity(workspaceId, 'scraping', `Pipeline failed: ${error}`, 'error')
    return { pipelineRunId: runId, status: 'failed', summary: { error }, trendingKeywords: [], topHashtags: [], ideas: [], theater: { keywords: [], verdicts: [], hashtagsByKeyword: [], reviewQueue: [] }, error }
  }

  // 3. Scraping — a critical failure ends the run with no partial hand-off.
  const scrape = await runAgent<ScrapePayload>('scraping', { runOffset, keywords, resolvedKeywords: [], keywordSignals: [], trendingKeywords: [], rankedHashtags: [], mode: 'fixture', sources: [], unreachable: [], rawPosts: [], hashtagCandidates: [], competitorPosts: [], droppedAsSeen: 0 }, { workspaceId, pipelineRunId: runId, paceMs, inputCount: keywords.length, task: 'Scanning LinkedIn for the keyword set' })
  if (scrape.status === 'failed') return fail(scrape.error ?? 'Scraping failed')
  const sp = scrape.payload

  // 4. Persist scraped items + hashtag candidates.
  const sourceIds = new Map<string, string>()
  for (const s of await query<{ id: string; name: string }>('SELECT id, name FROM sources WHERE workspace_id = $1', [workspaceId])) sourceIds.set(s.name, s.id)
  const itemIdByExternal = new Map<string, string>()
  for (const r of sp.rawPosts) {
    const row = await one<{ id: string }>(
      `INSERT INTO scraped_items (workspace_id, source_id, keyword_id, run_id, external_id, title, snippet, url, source_name, source_type, author_name, author_headline, author_followers, hashtags, engagement, reactions, comments, reposts, capture_source, fallback_reason, posted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
      [workspaceId, sourceIds.get(r.sourceName) ?? sourceIds.get('LinkedIn') ?? null, r.keywordId, runId, r.externalId, r.text.split(/[.!?\n]/)[0].slice(0, 110).trim(), r.text, r.url, r.sourceName, r.sourceType, r.authorName, r.authorHeadline, r.authorFollowers, r.hashtags, r.engagement, r.reactions, r.comments, r.reposts, r.source, r.fallbackReason ?? null, r.postedAt],
    )
    if (row) { itemIdByExternal.set(r.externalId, row.id); bus.publish({ type: 'item.scraped', agentId: 'scraping', runId, message: r.text.slice(0, 80), data: { id: row.id, keyword: r.keyword, keywordId: r.keywordId, sourceName: r.sourceName, engagement: r.engagement, source: r.source } }) }
  }
  const hashtagIdByKey = new Map<string, string>()
  for (const h of sp.hashtagCandidates) {
    const row = await one<{ id: string }>(
      `INSERT INTO hashtags (workspace_id, tag, display_tag, keyword_id, run_id, post_count, total_engagement, engagement_per_post, first_seen_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (workspace_id, tag, run_id) DO UPDATE SET post_count = hashtags.post_count + EXCLUDED.post_count RETURNING id`,
      [workspaceId, h.tag, h.displayTag, h.keywordId, runId, h.feedPostCount ?? h.postCount, h.feedEngagement ?? h.totalEngagement, Math.round(((h.feedEngagement ?? h.totalEngagement) / Math.max(1, h.feedPostCount ?? h.postCount)) * 100) / 100, h.firstSeenAt, h.lastSeenAt],
    )
    if (row) { hashtagIdByKey.set(`${h.keywordId}|${h.tag}`, row.id); bus.publish({ type: 'hashtag.captured', agentId: 'scraping', runId, message: `#${h.displayTag}`, data: { id: row.id, tag: h.tag, keyword: h.keywordTerm, keywordId: h.keywordId, postCount: h.postCount } }) }
  }

  // 5. Validation.
  const validation = await runAgent<ValidationPayload>('validation', { rawPosts: sp.rawPosts, hashtagCandidates: sp.hashtagCandidates, keywords, trustedSources: SEED_SOURCES.filter((s) => s.trusted).map((s) => s.name), keywordSignals: [], trendingKeywords: [], candidates: [], acceptThreshold: 70, rejectThreshold: 40, bucketCounts: { validated: 0, needs_review: 0, duplicate: 0, rejected: 0 }, reviewQueue: [] }, { workspaceId, pipelineRunId: runId, paceMs, inputCount: sp.rawPosts.length, task: 'Ranking keywords and issuing verdicts' })
  if (validation.status === 'failed') return fail(validation.error ?? 'Validation failed')
  const vp = validation.payload
  for (const s of vp.keywordSignals) await query('INSERT INTO keyword_signals (workspace_id, keyword_id, run_id, post_count, total_engagement, avg_engagement, velocity, growth_pct, trend_score, rank, is_trending, trend_reason, components) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [workspaceId, s.keywordId, runId, s.postCount, s.totalEngagement, s.avgEngagement, s.velocity, s.growthPct, s.trendScore, s.rank, s.isTrending, s.trendReason, JSON.stringify(s.components)])
  const idOf = (c: Candidate): string | undefined => c.kind === 'item' ? itemIdByExternal.get(c.externalId ?? '') : hashtagIdByKey.get(`${c.keywordId}|${c.hashtags[0]}`)
  const keyToId = new Map<string, string>()
  for (const c of vp.candidates) { const id = idOf(c); if (id) keyToId.set(c.key, id) }
  const verdicts: PipelineResult['theater']['verdicts'] = []
  for (const c of vp.candidates) {
    const id = keyToId.get(c.key)
    if (!id) continue
    const dupId = c.duplicateOfId ?? (c.duplicateOfKey ? keyToId.get(c.duplicateOfKey) : null) ?? null
    if (c.kind === 'item') {
      await query('UPDATE scraped_items SET relevance = $2, credibility = $3, freshness = $4, is_duplicate = $5, duplicate_of_id = $6, validation = $7, verdict_reason = $8, validated_at = now() WHERE id = $1', [id, c.relevance, c.credibility, c.freshness, c.isDuplicate, dupId, c.verdict, c.verdictReason])
      bus.publish({ type: 'item.validated', agentId: 'validation', runId, message: `${c.verdict}: ${c.title}`, data: { id, verdict: c.verdict, reason: c.verdictReason, relevance: c.relevance, credibility: c.credibility } })
    } else {
      await query('UPDATE hashtags SET rank = $2, relevance = $3, credibility = $4, freshness = $5, hashtag_score = $6, engagement_per_post = $7, validation = $8, verdict_reason = $9, duplicate_of_id = $10, validated_at = now() WHERE id = $1', [id, c.rank, c.relevance, c.credibility, c.freshness, c.hashtagScore ?? 0, c.engagementPerPost ?? 0, c.verdict, c.verdictReason, dupId])
      await query('INSERT INTO lineage_edges (workspace_id, from_type, from_id, to_type, to_id, agent_id) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, 'keyword', c.keywordId, 'hashtag', id, 'validation'])
      bus.publish({ type: 'hashtag.validated', agentId: 'validation', runId, message: `${c.verdict}: ${c.title}`, data: { id, verdict: c.verdict, rank: c.rank, keyword: c.keywordTerm } })
    }
    verdicts.push({ id, kind: c.kind, title: c.title, verdict: c.verdict ?? 'pending', reason: c.verdictReason ?? '', credibility: c.credibility, relevance: c.relevance, freshness: c.freshness, isDuplicate: c.isDuplicate, keyword: c.keywordTerm })
  }
  // Hashtag candidates that never reached the ranked set still get exactly one verdict.
  const trendingIds = new Set(vp.trendingKeywords.map((t) => t.keywordId))
  for (const h of sp.hashtagCandidates) {
    const id = hashtagIdByKey.get(`${h.keywordId}|${h.tag}`)
    if (!id || vp.candidates.some((c) => keyToId.get(c.key) === id)) continue
    const reason = trendingIds.has(h.keywordId) ? `Outside the top set for "${h.keywordTerm}" this run — not carried forward.` : `"${h.keywordTerm}" is not among the trending keywords this run.`
    await query("UPDATE hashtags SET validation = 'rejected', verdict_reason = $2, validated_at = now() WHERE id = $1", [id, reason])
  }
  const reviewQueue: PipelineResult['theater']['reviewQueue'] = []
  for (const r of vp.reviewQueue) {
    const entityId = keyToId.get(r.key)
    if (!entityId) continue
    const row = await one<{ id: string }>('INSERT INTO review_queue (workspace_id, kind, entity_id, title, reason, decision_requested, options) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [workspaceId, r.kind, entityId, r.title, r.reason, r.decisionRequested, r.options])
    if (row) reviewQueue.push({ id: row.id, kind: r.kind, entityId, title: r.title, reason: r.reason, decisionRequested: r.decisionRequested })
  }
  if (reviewQueue.length) await setAgentState(workspaceId, 'validation', { status: 'needs_review', currentTask: `${reviewQueue.length} decision(s) waiting for a human` })

  // 6. Analysis.
  const analysis = await runAgent<AnalysisPayload>('analysis', { validatedItems: vp.candidates.filter((c) => c.kind === 'item' && c.verdict === 'validated'), rankedHashtags: vp.candidates.filter((c) => c.kind === 'hashtag'), trendingKeywords: vp.trendingKeywords, competitorPosts: sp.competitorPosts, clusters: [], topHashtags: [], opportunities: [] }, { workspaceId, pipelineRunId: runId, paceMs, inputCount: vp.candidates.length, task: 'Clustering signal into opportunities' })
  if (analysis.status === 'failed') return fail(analysis.error ?? 'Analysis failed')
  const ap = analysis.payload
  await query('UPDATE hashtags SET in_top_set = false WHERE workspace_id = $1', [workspaceId])
  for (const t of ap.topHashtags) { const id = keyToId.get(t.key); if (id) await query('UPDATE hashtags SET in_top_set = true WHERE id = $1', [id]) }

  // 7. Calendar.
  const existing = await query<{ id: string; title: string; scheduled_date: Date | string; platform: Platform; scheduled_time: string; confidence: number; priority_score: number; calendar_slot: 'primary' | 'suggestion'; status: string }>("SELECT id, title, scheduled_date, platform, scheduled_time, confidence, priority_score, calendar_slot, status FROM content_ideas WHERE workspace_id = $1 AND status NOT IN ('published','rejected')", [workspaceId])
  const existingIdeas: PlanPayload['existingIdeas'] = existing.map((e) => ({ id: e.id, title: e.title, date: typeof e.scheduled_date === 'string' ? e.scheduled_date : new Date(e.scheduled_date).toISOString().slice(0, 10), platform: e.platform, hour: parseTimeLabel(e.scheduled_time), confidence: e.confidence, priorityScore: e.priority_score, calendarSlot: e.calendar_slot, status: e.status }))
  const plan = await runAgent<PlanPayload>('calendar', { opportunities: ap.opportunities, existingIdeas, ideas: [] }, { workspaceId, pipelineRunId: runId, paceMs, inputCount: ap.opportunities.length, task: 'Placing opportunities on the calendar' })
  if (plan.status === 'failed') return fail(plan.error ?? 'Calendar failed')
  const ideasOut: PipelineResult['ideas'] = []
  for (const idea of plan.payload.ideas as IdeaDraft[]) {
    const sourceItemId = keyToId.get(idea.sourceKey) ?? null
    if (sourceItemId) {
      const dup = await one('SELECT id FROM content_ideas WHERE workspace_id = $1 AND source_item_id = $2', [workspaceId, sourceItemId])
      if (dup) continue
    }
    const hashtagId = idea.hashtagTag ? (Array.from(hashtagIdByKey.entries()).find(([k]) => k.endsWith(`|${idea.hashtagTag}`))?.[1] ?? null) : null
    const row = await one<{ id: string }>(
      `INSERT INTO content_ideas (workspace_id, source_item_id, hashtag_id, title, description, source_topic, platform, alt_platforms, scheduled_date, scheduled_time, confidence, priority_score, platform_rank, calendar_slot, status, analysis, is_new_trend)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'suggested',$15,true) RETURNING id`,
      [workspaceId, sourceItemId, hashtagId, idea.title, idea.description, idea.sourceTopic, idea.platform, JSON.stringify(idea.altPlatforms), idea.date, idea.time, idea.confidence, idea.priorityScore, idea.platformRank, idea.calendarSlot, JSON.stringify(idea.analysis)],
    )
    if (!row) continue
    if (sourceItemId) await query('INSERT INTO lineage_edges (workspace_id, from_type, from_id, to_type, to_id, agent_id) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, 'scraped_item', sourceItemId, 'content_idea', row.id, 'calendar'])
    ideasOut.push({ id: row.id, title: idea.title, platform: idea.platform, calendarSlot: idea.calendarSlot, platformRank: idea.platformRank, date: idea.date, time: idea.time, confidence: idea.confidence })
    bus.publish({ type: 'idea.created', agentId: 'calendar', runId, message: idea.title, data: { id: row.id, platform: idea.platform, date: idea.date, slot: idea.calendarSlot, rank: idea.platformRank } })
  }
  const changed = await applyTopRule(workspaceId)
  for (const c of changed) { const i = ideasOut.find((x) => x.id === c.id); if (i) i.calendarSlot = c.after }
  const finalSlots = await query<{ id: string; calendar_slot: string; platform_rank: number }>('SELECT id, calendar_slot, platform_rank FROM content_ideas WHERE id = ANY($1::uuid[])', [ideasOut.map((i) => i.id)])
  for (const f of finalSlots) { const i = ideasOut.find((x) => x.id === f.id); if (i) { i.calendarSlot = f.calendar_slot; i.platformRank = f.platform_rank } }

  // 8. Finish.
  const summary = {
    keywordsScanned: sp.resolvedKeywords.length, postsScraped: sp.rawPosts.length, hashtagsFound: sp.hashtagCandidates.length,
    trending: vp.trendingKeywords.length, validated: vp.bucketCounts.validated, needsReview: vp.bucketCounts.needs_review, duplicate: vp.bucketCounts.duplicate, rejected: vp.bucketCounts.rejected,
    topHashtags: ap.topHashtags.length, opportunities: ap.opportunities.length, ideas: ideasOut.length, primaryIdeas: ideasOut.filter((i) => i.calendarSlot === 'primary').length, suggestionIdeas: ideasOut.filter((i) => i.calendarSlot === 'suggestion').length,
    source: sp.mode, fallbackReason: sp.fallbackReason ?? null, droppedAsSeen: sp.droppedAsSeen,
  }
  await query('UPDATE pipeline_runs SET status = $2, finished_at = now(), summary = $3 WHERE id = $1', [runId, 'completed', JSON.stringify(summary)])
  bus.publish({ type: 'pipeline.finished', runId, message: `Pipeline complete · ${summary.postsScraped} posts · ${summary.trending} trending keywords · ${summary.ideas} ideas`, data: { status: 'completed', summary } })
  await logActivity(workspaceId, 'calendar', `Pipeline complete: ${summary.validated} validated, ${summary.needsReview} for review, ${summary.primaryIdeas} ideas on the calendar, ${summary.suggestionIdeas} in suggestions`, 'ok')

  const keywordsTheater = sp.resolvedKeywords.map((k) => ({ id: k.id, term: k.term, items: sp.rawPosts.filter((r) => r.keywordId === k.id).map((r) => { const v = verdicts.find((x) => x.id === itemIdByExternal.get(r.externalId)); return { id: itemIdByExternal.get(r.externalId) ?? '', title: r.text.split(/[.!?\n]/)[0].slice(0, 110).trim(), engagement: r.engagement, sourceName: r.sourceName, sourceType: r.sourceType, hashtags: r.hashtags, relevance: v?.relevance ?? 0 } }) }))
  const hashtagsByKeyword = vp.trendingKeywords.map((t) => ({ keyword: t.term, tags: vp.candidates.filter((c) => c.kind === 'hashtag' && c.keywordId === t.keywordId).map((c) => ({ id: keyToId.get(c.key) ?? '', tag: c.title, rank: c.rank ?? 0, verdict: c.verdict ?? 'pending', score: c.hashtagScore ?? 0 })) }))
  return { pipelineRunId: runId, status: 'completed', summary, trendingKeywords: vp.trendingKeywords, topHashtags: ap.topHashtags, ideas: ideasOut, theater: { keywords: keywordsTheater, verdicts, hashtagsByKeyword, reviewQueue } }
}

// ── Knowledge build (cron + manual) ─────────────────────────────────────
export async function buildKnowledge(opts: { workspaceId: string; trigger: 'cron' | 'manual'; hashtagCount?: number; forceRefresh?: boolean }) {
  const { workspaceId } = opts
  const build = await one<{ id: string }>('INSERT INTO knowledge_builds (workspace_id, trigger, status) VALUES ($1, $2, $3) RETURNING id', [workspaceId, opts.trigger, 'running'])
  const buildId = build?.id ?? ''
  bus.publish({ type: 'knowledge.build.started', agentId: 'knowledge', message: `Knowledge build started (${opts.trigger})`, data: { buildId } })
  const result = await runAgent<KnowledgePayload>('knowledge', { trigger: opts.trigger, buildId, hashtagCount: opts.hashtagCount, forceRefresh: opts.forceRefresh, researchSet: [], researchResults: [], candidateEntries: [], written: 0, merged: 0, sourcesCited: 0, researchSource: 'fixture', entries: [], retrievedChunks: [], webPagesEmbedded: 0, resolutions: [] }, { workspaceId, task: 'Researching the top hashtags' })
  const p = result.payload
  const summary = { hashtags: p.researchSet.length, written: p.written, merged: p.merged, sources: p.sourcesCited, source: p.researchSource, resolutions: p.resolutions, trigger: opts.trigger }
  await query('UPDATE knowledge_builds SET status = $2, hashtags_researched = $3, entries_written = $4, entries_merged = $5, sources_cited = $6, research_source = $7, fallback_reason = $8, finished_at = now(), summary = $9, error = $10 WHERE id = $1', [buildId, result.status, p.researchSet.length, p.written, p.merged, p.sourcesCited, p.researchSource, p.fallbackReason ?? null, JSON.stringify(summary), result.error ?? null])
  bus.publish({ type: 'knowledge.build.finished', agentId: 'knowledge', message: `Knowledge build ${result.status}: ${p.written} written, ${p.merged} merged from ${p.researchSet.length} hashtags`, data: { buildId, ...summary, status: result.status } })
  await logActivity(workspaceId, 'knowledge', result.status === 'failed' ? `Knowledge build (${opts.trigger}) failed: ${result.error}` : `Knowledge build (${opts.trigger}) completed: ${p.written} entries written, ${p.merged} merged, ${p.sourcesCited} sources cited`, result.status === 'failed' ? 'error' : 'ok')
  return one('SELECT * FROM knowledge_builds WHERE id = $1', [buildId])
}

// ── Scheduled captions: Caption Agent over a planned week ───────────────
// The Calendar Agent plans a hashtag per day; this walks those slots and runs the Caption
// Agent against each one. Every slot gets a real content_ideas row so the generated caption
// carries the same draft, review and lineage records as any other idea — which is what lets
// the calendar open a scheduled day in the normal review drawer.

interface SlotRow {
  id: string; slot_date: string | Date; day_name: string; position: number
  hashtag_id: string | null; hashtag: string; display_hashtag: string; keyword_term: string | null
  hashtag_rank: number | null; hashtag_score: number | null
  platform: Platform; scheduled_time: string
  captions_planned: number; images_planned: number
  captions_generated: number; images_generated: number
  idea_id: string | null; status: string
}

export interface ScheduleSlotOutcome {
  slotDate: string; dayName: string; displayHashtag: string
  ideaId: string | null; status: string
  captionsGenerated: number; captionsPlanned: number
  imagesGenerated: number; imagesPlanned: number
  /** Caption detail, present when the Caption Agent ran for this slot. */
  title?: string; writer?: string; model?: string; grounded?: boolean
  knowledgeEntries?: number; retrievedChunks?: number; chars?: number
  /** Image detail, present when the Image Agent ran for this slot. */
  imageModel?: string; renderMode?: string; canvas?: string; imageFallbackReason?: string | null
  captionReused?: boolean; imageReused?: boolean; error?: string
}

export interface ScheduleContentResult {
  scheduleId: string; weekStart: string; weekEnd: string
  captionsWritten: number; imagesRendered: number
  skipped: number; failed: number
  slots: ScheduleSlotOutcome[]
}

const dayIso = (v: string | Date): string => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v).slice(0, 10))

/**
 * Gives the slot's idea a real angle before the Caption Agent sees it.
 *
 * This matters more than it looks: the default hook pattern is `${idea.title}.`, so the idea
 * title becomes the caption's opening line. On the scraped path the Analysis Agent supplies a
 * cluster title; a scheduled day has no cluster, so the angle is taken from the vector store
 * instead — hybrid retrieval over the corpus and web sources, then one short model call to turn
 * that material into a declarative finding. Falls back to a plain topic statement when the
 * vector store or the model is unavailable, and never invents a figure.
 */
async function seedIdeaAngle(workspaceId: string, displayHashtag: string, topic: string): Promise<{ title: string; description: string; grounded: boolean }> {
  const plain = {
    title: `What the evidence says about ${topic}`.slice(0, 96),
    description: `Angle seeded without retrieval — the caption is grounded by the Caption Agent's own Knowledge Base pass.`,
    grounded: false,
  }
  try {
    const hits = await hybridRetrieve({ workspaceId, query: `${displayHashtag} ${topic}`, topK: 5 })
    if (!hits.results.length) return plain
    const grounding = groundingFromRetrieval(hits, 700)
    if (!gcpText.isConfigured()) {
      // No model: take the strongest chunk's opening sentence rather than inventing a claim.
      const lead = hits.results[0].content.replace(/\s+/g, ' ').trim()
      const sentence = (lead.split(/(?<=[.!?])\s+/)[0] ?? lead).trim()
      return sentence.length > 24 ? { title: sentence.slice(0, 96), description: lead.slice(0, 280), grounded: true } : plain
    }
    // Two plain lines rather than JSON: Gemini 2.5's thinking tokens truncate structured output.
    const out = await gcpText.run({
      system: `You write for ${BRAND.name}, ${BRAND.positioning} Voice: ${BRAND.voice.join(', ')}. Never use hype vocabulary. Never pitch. Never state a number that is not in the source material.`,
      prompt: `Source material about ${topic} (hashtag #${displayHashtag}):\n\n${grounding}\n\nReply with exactly two lines and nothing else.\nLine 1: a specific declarative finding about ${topic}, at most 16 words, plain English, no hashtags, no quotation marks, no leading label, no trailing period.\nLine 2: one sentence of context for that finding, at most 200 characters.`,
      temperature: 0.4,
      maxOutputTokens: 4096,
    })
    const lines = out.text.split('\n').map((l) => l.replace(/^\s*(line\s*\d\s*[:.)-]\s*)?/i, '').replace(/^["'#*\s-]+|["'*\s]+$/g, '').trim()).filter(Boolean)
    const title = (lines[0] ?? '').replace(/[.]+$/, '')
    if (title.length < 12) return plain
    return { title: title.slice(0, 96), description: (lines[1] ?? plain.description).slice(0, 280), grounded: true }
  } catch {
    // Seeding is best-effort; a caption is still worth writing without it.
    return plain
  }
}

/** The idea a slot's generated content hangs off, created on first use with a grounded angle. */
async function ensureSlotIdea(workspaceId: string, slot: SlotRow, weekStart: string): Promise<string> {
  if (slot.idea_id) {
    const alive = await one<{ id: string }>('SELECT id FROM content_ideas WHERE id = $1', [slot.idea_id])
    if (alive) return alive.id
  }
  const topic = (slot.keyword_term ?? '').trim() || slot.display_hashtag
  const angle = await seedIdeaAngle(workspaceId, slot.display_hashtag, topic)
  const score = Math.max(0, Math.min(100, Number(slot.hashtag_score ?? 0)))
  const rank = Number(slot.hashtag_rank ?? 99)
  const analysis = {
    keyword: topic,
    hashtag: slot.display_hashtag,
    hashtagRank: rank,
    format: 'Text',
    angle: `Practitioner reading of ${topic}, written from the Knowledge Base rather than from opinion.`,
    audience: 'ML and platform leads evaluating reinforcement learning in production',
    brandRelevance: Math.max(50, score),
    trendScore: Math.max(50, score),
    source: 'calendar.week.plan',
    angleGrounded: angle.grounded,
    scheduleWeekStart: weekStart,
    slotDate: dayIso(slot.slot_date),
  }
  const row = await one<{ id: string }>(
    `INSERT INTO content_ideas
       (workspace_id, hashtag_id, title, description, source_topic, platform, alt_platforms, scheduled_date, scheduled_time,
        confidence, priority_score, calendar_slot, status, analysis, is_new_trend)
     VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,$9,$10,'primary','suggested',$11,false) RETURNING id`,
    [
      workspaceId, slot.hashtag_id,
      angle.title,
      angle.description,
      topic, slot.platform, dayIso(slot.slot_date), slot.scheduled_time,
      Math.max(50, Math.min(95, score || 70)),
      Math.max(60, Math.min(100, 100 - rank * 4)),
      JSON.stringify(analysis),
    ],
  )
  if (!row) throw new Error('could not create the idea for this slot')
  await query('UPDATE content_schedule_slots SET idea_id = $2, updated_at = now() WHERE id = $1', [slot.id, row.id])
  if (slot.hashtag_id) {
    await query('INSERT INTO lineage_edges (workspace_id, from_type, from_id, to_type, to_id, agent_id) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, 'hashtag', slot.hashtag_id, 'content_idea', row.id, 'calendar'])
  }
  return row.id
}

/**
 * Runs the Caption Agent and then the Image Agent for each day of a planned week, filling the
 * slot's `captions_planned` and `images_planned` counters. Both stages are opt-out, so a week can
 * be captioned without creatives or have creatives added to captions written earlier. The image is
 * rendered from the caption that was just written, so Rule 15 (caption and visual agree) holds.
 */
export async function generateScheduleContent(
  workspaceId: string,
  opts: { weekStart?: string; slotDates?: string[]; captions?: boolean; images?: boolean; regenerate?: boolean; imageModel?: string } = {},
): Promise<ScheduleContentResult> {
  const wantCaptions = opts.captions ?? true
  const wantImages = opts.images ?? true
  const head = opts.weekStart
    ? await one<{ id: string; week_start: string | Date; week_end: string | Date }>('SELECT id, week_start, week_end FROM content_schedules WHERE workspace_id = $1 AND week_start = $2', [workspaceId, opts.weekStart])
    : await one<{ id: string; week_start: string | Date; week_end: string | Date }>('SELECT id, week_start, week_end FROM content_schedules WHERE workspace_id = $1 ORDER BY week_start DESC LIMIT 1', [workspaceId])
  if (!head) throw new Error(opts.weekStart ? `no schedule for the week of ${opts.weekStart} — plan it first` : 'no schedule has been planned yet')

  const all = await query<SlotRow>('SELECT * FROM content_schedule_slots WHERE schedule_id = $1 ORDER BY position', [head.id])
  const wanted = opts.slotDates?.length ? all.filter((s) => opts.slotDates?.includes(dayIso(s.slot_date))) : all
  const weekStart = dayIso(head.week_start)
  const weekEnd = dayIso(head.week_end)

  const stages = [wantCaptions && 'captions', wantImages && 'images'].filter(Boolean).join(' + ') || 'nothing'
  if (wantCaptions) await setAgentState(workspaceId, 'caption', { status: 'running', currentTask: `Writing captions for the week of ${weekStart}` })
  if (wantImages) await setAgentState(workspaceId, 'image', { status: 'running', currentTask: `Rendering creatives for the week of ${weekStart}` })
  bus.publish({ type: 'agent.started', agentId: 'caption', message: `Scheduled ${stages} over ${wanted.length} day(s)`, data: { scheduleId: head.id, weekStart } })

  const outcomes: ScheduleSlotOutcome[] = []
  let captionsWritten = 0, imagesRendered = 0, skipped = 0, failed = 0

  for (const slot of wanted) {
    const base = {
      slotDate: dayIso(slot.slot_date), dayName: slot.day_name, displayHashtag: slot.display_hashtag,
      captionsPlanned: slot.captions_planned, imagesPlanned: slot.images_planned,
    }
    // What is still outstanding for this day, before anything runs.
    const captionDue = wantCaptions && slot.captions_planned > 0 && (opts.regenerate || slot.captions_generated < slot.captions_planned)
    const imageDue = wantImages && slot.images_planned > 0 && (opts.regenerate || slot.images_generated < slot.images_planned)
    if (!captionDue && !imageDue) {
      skipped++
      outcomes.push({
        ...base, ideaId: slot.idea_id, status: slot.status,
        captionsGenerated: slot.captions_generated, imagesGenerated: slot.images_generated,
        captionReused: slot.captions_generated > 0, imageReused: slot.images_generated > 0,
      })
      continue
    }
    try {
      const ideaId = await ensureSlotIdea(workspaceId, slot, weekStart)
      await query("UPDATE content_schedule_slots SET status = 'generating', updated_at = now() WHERE id = $1", [slot.id])

      const idea = await loadIdea(ideaId)
      if (!idea) throw new Error('idea vanished before generation ran')
      const platform = slot.platform
      const out: ScheduleSlotOutcome = {
        ...base, ideaId, status: slot.status, title: idea.title,
        captionsGenerated: slot.captions_generated, imagesGenerated: slot.images_generated,
      }
      let captionsGenerated = slot.captions_generated
      let imagesGenerated = slot.images_generated
      let body = ''

      // ── Caption Agent ────────────────────────────────────────────────
      if (captionDue) {
        const run = await runAgent<CaptionPayload>(
          'caption',
          { idea, platform, writer: 'template', source: 'fixture', model: 'ethara-writer', knowledge: [], grounding: '', knowledgeGrounded: false, hook: '', problem: '', explanation: '', close: '', hashtags: [], caption: '', variants: [], voiceChanges: [] },
          { workspaceId, inputCount: 1, task: `Writing ${slot.day_name}'s #${slot.display_hashtag} caption` },
        )
        if (run.status === 'failed') throw new Error(run.error ?? 'Caption Agent failed')
        const cp = run.payload
        body = enforceBrandVoice(cp.caption, `${idea.sourceTopic} ${slot.display_hashtag}`).text
        if (!body.trim()) throw new Error('the Caption Agent returned an empty caption')

        const draft = await one<{ id: string }>(
          `INSERT INTO drafts (idea_id, platform, body, generated_by, model, source) VALUES ($1,$2,$3,'caption',$4,$5)
           ON CONFLICT (idea_id, platform) DO UPDATE SET body = EXCLUDED.body, revision = drafts.revision + 1, model = EXCLUDED.model, source = EXCLUDED.source, updated_at = now() RETURNING id`,
          [ideaId, platform, body, cp.model, cp.source],
        )
        await query('INSERT INTO lineage_edges (workspace_id, from_type, from_id, to_type, to_id, agent_id) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, 'content_idea', ideaId, 'draft', draft?.id, 'caption'])
        // The title is the angle the idea was seeded with, which is also what the hook was written
        // from — leave it alone and only move the idea out of 'suggested'.
        await query("UPDATE content_ideas SET status = CASE WHEN status IN ('suggested','drafted') THEN 'drafted' ELSE status END, updated_at = now() WHERE id = $1", [ideaId])

        captionsGenerated = Math.min(slot.captions_planned, (opts.regenerate ? 0 : slot.captions_generated) + 1)
        captionsWritten++
        Object.assign(out, {
          writer: cp.writer, model: cp.model, grounded: cp.knowledgeGrounded,
          knowledgeEntries: cp.knowledge.length,
          retrievedChunks: Array.isArray(cp.retrievedChunks) ? cp.retrievedChunks.length : 0,
          chars: body.length,
        })
        bus.publish({ type: 'draft.generated', agentId: 'caption', message: `${slot.day_name}: ${idea.title}`, data: { ideaId, platform, slotDate: base.slotDate, hashtag: slot.display_hashtag, source: cp.source, model: cp.model } })
      } else if (slot.captions_generated > 0) {
        out.captionReused = true
      }

      // ── Image Agent ──────────────────────────────────────────────────
      if (imageDue) {
        // The creative is built from the caption, so read back whatever the draft holds when the
        // caption stage was skipped. Falling back to the title keeps the headline on-topic.
        if (!body) {
          const existing = await one<{ body: string }>('SELECT body FROM drafts WHERE idea_id = $1 AND platform = $2', [ideaId, platform])
          body = existing?.body ?? idea.title
        }
        const rendered = await renderImage(workspaceId, idea, platform, body, opts.imageModel ? { model: opts.imageModel } : {})
        imagesGenerated = Math.min(slot.images_planned, (opts.regenerate ? 0 : slot.images_generated) + 1)
        imagesRendered++
        Object.assign(out, {
          imageModel: rendered.media?.model, renderMode: rendered.media?.renderMode,
          canvas: rendered.media?.canvas, imageFallbackReason: rendered.media?.fallbackReason ?? null,
        })
        if (rendered.media?.fallbackReason) await logActivity(workspaceId, 'image', `${slot.day_name} #${slot.display_hashtag}: ${rendered.media.fallbackReason}`, 'warn')
      } else if (slot.images_generated > 0) {
        out.imageReused = true
      }

      const slotStatus = captionsGenerated >= slot.captions_planned
        ? (imagesGenerated >= slot.images_planned ? 'ready' : 'captioned')
        : 'generating'
      await query('UPDATE content_schedule_slots SET captions_generated = $2, images_generated = $3, status = $4, updated_at = now() WHERE id = $1', [slot.id, captionsGenerated, imagesGenerated, slotStatus])
      outcomes.push({ ...out, captionsGenerated, imagesGenerated, status: slotStatus })
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      await query("UPDATE content_schedule_slots SET status = 'failed', updated_at = now() WHERE id = $1", [slot.id])
      await logActivity(workspaceId, 'caption', `Scheduled content for ${base.dayName} #${base.displayHashtag} failed: ${message}`, 'error')
      outcomes.push({ ...base, ideaId: slot.idea_id, status: 'failed', captionsGenerated: slot.captions_generated, imagesGenerated: slot.images_generated, error: message })
    }
  }

  // 'ready' means both counters met the plan on every day of the week.
  const outstanding = await one<{ n: string }>("SELECT count(*) AS n FROM content_schedule_slots WHERE schedule_id = $1 AND status NOT IN ('ready','skipped')", [head.id])
  await query('UPDATE content_schedules SET status = $2, updated_at = now() WHERE id = $1', [head.id, Number(outstanding?.n ?? 0) === 0 ? 'ready' : 'generating'])

  if (wantCaptions) await setAgentState(workspaceId, 'caption', { status: failed && !captionsWritten ? 'failed' : 'completed', currentTask: `${captionsWritten} caption(s) written for the week of ${weekStart}`, touchLastRun: true, processed: captionsWritten })
  if (wantImages) await setAgentState(workspaceId, 'image', { status: failed && !imagesRendered ? 'failed' : 'completed', currentTask: `${imagesRendered} creative(s) rendered for the week of ${weekStart}`, touchLastRun: true, processed: imagesRendered })
  await logActivity(workspaceId, 'caption', `Week of ${weekStart}: ${captionsWritten} caption(s) written, ${imagesRendered} creative(s) rendered, ${skipped} skipped, ${failed} failed`, failed ? 'warn' : 'ok')
  bus.publish({ type: 'agent.finished', agentId: 'caption', message: `Week of ${weekStart}: ${captionsWritten} caption(s), ${imagesRendered} creative(s)`, data: { scheduleId: head.id, weekStart, captionsWritten, imagesRendered, skipped, failed } })

  return { scheduleId: head.id, weekStart, weekEnd, captionsWritten, imagesRendered, skipped, failed, slots: outcomes }
}

// ── Drafting: caption → image ───────────────────────────────────────────
export async function generateDraft(workspaceId: string, ideaId: string, platform: Platform) {
  const idea = await loadIdea(ideaId)
  if (!idea) throw new Error('Idea not found')
  const caption = await runAgent<CaptionPayload>('caption', { idea, platform, writer: 'template', source: 'fixture', model: 'ethara-writer', knowledge: [], grounding: '', knowledgeGrounded: false, hook: '', problem: '', explanation: '', close: '', hashtags: [], caption: '', variants: [], voiceChanges: [] }, { workspaceId, inputCount: 1, task: `Writing "${idea.title.slice(0, 40)}" for ${platform}` })
  if (caption.status === 'failed') throw new Error(caption.error ?? 'Caption agent failed')
  const cp = caption.payload
  const body = enforceBrandVoice(cp.caption, `${idea.sourceTopic} ${idea.title}`).text
  const draft = await one('INSERT INTO drafts (idea_id, platform, body, generated_by, model, source) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idea_id, platform) DO UPDATE SET body = EXCLUDED.body, revision = drafts.revision + 1, model = EXCLUDED.model, source = EXCLUDED.source, updated_at = now() RETURNING *', [ideaId, platform, body, 'caption', cp.model, cp.source])
  await query('INSERT INTO lineage_edges (workspace_id, from_type, from_id, to_type, to_id, agent_id) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, 'content_idea', ideaId, 'draft', draft?.id, 'caption'])
  bus.publish({ type: 'draft.generated', agentId: 'caption', message: `Draft for "${idea.title}" (${platform})`, data: { ideaId, platform, source: cp.source, model: cp.model } })
  const image = await renderImage(workspaceId, idea, platform, body, {})
  await query("UPDATE content_ideas SET status = CASE WHEN status = 'suggested' THEN 'drafted' ELSE status END, updated_at = now() WHERE id = $1", [ideaId])
  return { draft: mapDraft(draft), media: image.media, voice: { writer: cp.writer, source: cp.source, model: cp.model, fallbackReason: cp.fallbackReason ?? null, knowledgeEntries: cp.knowledge.length, grounded: cp.knowledgeGrounded, changes: cp.voiceChanges, variants: cp.variants }, skills: [...slim(caption.skills), ...image.skills] }
}

async function renderImage(workspaceId: string, idea: IdeaRecord, platform: Platform, caption: string, opts: { model?: string; prompt?: string; instruction?: string }) {
  const image = await runAgent<ImagePayload>('image', { idea, platform, caption, requestedModel: opts.model, prompt: opts.prompt, instruction: opts.instruction, model: 'brand-svg', concept: '', approach: 'brand-only', canvas: '', width: 0, height: 0, layout: '', headline: '', kicker: '', footer: '', references: [], dataUri: '', renderMode: 'demo', variants: [], altText: '', visualCheck: { ok: true, notes: [] }, seed: 0 }, { workspaceId, inputCount: 1, task: `Rendering the ${platform} creative` })
  if (image.status === 'failed') throw new Error(image.error ?? 'Image agent failed')
  const ip = image.payload
  const media = await one(
    `INSERT INTO media_assets (workspace_id, idea_id, platform, kind, concept, canvas, width, height, alt_text, render_mode, model, prompt, fallback_reason, data_uri, variants)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (idea_id, platform) DO UPDATE SET concept = EXCLUDED.concept, canvas = EXCLUDED.canvas, width = EXCLUDED.width, height = EXCLUDED.height, alt_text = EXCLUDED.alt_text, render_mode = EXCLUDED.render_mode, model = EXCLUDED.model, prompt = EXCLUDED.prompt, fallback_reason = EXCLUDED.fallback_reason, data_uri = EXCLUDED.data_uri, variants = EXCLUDED.variants, created_at = now() RETURNING *`,
    [workspaceId, idea.id, platform, (idea.analysis.format === 'Carousel') ? 'carousel' : 'single', ip.concept, ip.canvas, ip.width, ip.height, ip.altText, ip.renderMode, ip.model, ip.prompt ?? null, ip.fallbackReason ?? null, ip.dataUri, JSON.stringify(ip.variants)],
  )
  await query('INSERT INTO lineage_edges (workspace_id, from_type, from_id, to_type, to_id, agent_id) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, 'content_idea', idea.id, 'media_asset', media?.id, 'image'])
  return { media: mapMedia(media), skills: slim(image.skills) }
}

export async function regenerateImage(workspaceId: string, ideaId: string, platform: Platform, opts: { model?: string; prompt?: string; instruction?: string }) {
  const idea = await loadIdea(ideaId)
  if (!idea) throw new Error('Idea not found')
  const draft = await one<{ body: string }>('SELECT body FROM drafts WHERE idea_id = $1 AND platform = $2', [ideaId, platform])
  return renderImage(workspaceId, idea, platform, draft?.body ?? idea.title, opts)
}

export async function applyInstruction(workspaceId: string, ideaId: string, platform: Platform, instruction: string) {
  const idea = await loadIdea(ideaId)
  if (!idea) throw new Error('Idea not found')
  let draft = await one<{ body: string }>('SELECT body FROM drafts WHERE idea_id = $1 AND platform = $2', [ideaId, platform])
  if (!draft) { await generateDraft(workspaceId, ideaId, platform); draft = await one<{ body: string }>('SELECT body FROM drafts WHERE idea_id = $1 AND platform = $2', [ideaId, platform]) }
  const media = await one<{ alt_text: string | null; data_uri: string }>('SELECT alt_text, data_uri FROM media_assets WHERE idea_id = $1 AND platform = $2', [ideaId, platform])
  const recent = (await query<{ content: string }>('SELECT content FROM posts WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 12', [workspaceId])).map((r) => r.content)
  const headline = (draft?.body ?? '').split('\n')[0]
  const review = await runAgent<ReviewPayload>('review', { idea, platform, draft: draft?.body ?? '', instruction, hasMedia: Boolean(media), mediaHeadline: media ? headline : undefined, altText: media?.alt_text ?? undefined, recentCaptions: recent, before: '', after: '', note: '', conflicts: [], compliance: { verdict: 'APPROVED', dimensions: { grounding: { ok: true, note: '' }, voice: { ok: true, note: '' }, structure: { ok: true, note: '' }, platform: { ok: true, note: '' }, visual: { ok: true, note: '' }, captionVisual: { ok: true, note: '' } }, violations: [], sensitiveHits: [], summary: '' }, preferenceSaved: false, diffSummary: '', writer: 'rules', model: 'ethara-rules' }, { workspaceId, inputCount: 1, task: 'Applying an edit instruction' })
  if (review.status === 'failed') throw new Error(review.error ?? 'Review agent failed')
  const rp = review.payload
  // model and source now record who actually made the edit, so a review-authored revision no
  // longer carries the Caption Agent's model forward and misreport how it was produced.
  const updated = await one(
    'UPDATE drafts SET body = $3, revision = revision + 1, generated_by = $4, model = $5, source = $6, updated_at = now() WHERE idea_id = $1 AND platform = $2 RETURNING *',
    [ideaId, platform, rp.after, 'review', rp.model, rp.writer === 'gemini' ? 'live' : 'fixture'],
  )
  await query("UPDATE content_ideas SET feedback = feedback || $2::jsonb, status = CASE WHEN status IN ('suggested','drafted') THEN 'in_review' ELSE status END, updated_at = now() WHERE id = $1", [ideaId, JSON.stringify([{ instruction, at: new Date().toISOString(), note: rp.note }])])
  await logActivity(workspaceId, 'review', `Applied "${instruction.slice(0, 60)}" to "${idea.title.slice(0, 40)}" via ${rp.model} — ${rp.compliance.verdict}`, rp.conflicts.length ? 'warn' : 'ok', { type: 'content_idea', id: ideaId })
  return { draft: mapDraft(updated), note: rp.note, compliance: rp.compliance, preference: rp.preference ?? null, preferenceSaved: rp.preferenceSaved, diffSummary: rp.diffSummary, writer: rp.writer, model: rp.model, fallbackReason: rp.fallbackReason ?? null, skills: slim(review.skills) }
}

// ── Publishing → analytics → learning, synchronously ────────────────────
export async function publishIdea(workspaceId: string, ideaId: string) {
  const idea = await loadIdea(ideaId)
  if (!idea) throw new Error('Idea not found')
  if (idea.status !== 'approved') throw new Error('Nothing publishes without Marketing approval and then Leadership approval — this idea is not approved.')
  const platform = idea.platform
  let draft = await one<{ body: string }>('SELECT body FROM drafts WHERE idea_id = $1 AND platform = $2', [ideaId, platform])
  if (!draft) { await generateDraft(workspaceId, ideaId, platform); draft = await one<{ body: string }>('SELECT body FROM drafts WHERE idea_id = $1 AND platform = $2', [ideaId, platform]) }
  const media = await one<{ id: string; data_uri: string }>('SELECT id, data_uri FROM media_assets WHERE idea_id = $1 AND platform = $2', [ideaId, platform])
  const pub = await runAgent<PublishPayload>('publishing', { idea, platform, content: draft?.body ?? '', mediaDataUri: media?.data_uri, mediaAssetId: media?.id, mode: env().publishMode, formatCheck: { ok: false, notes: [] }, mediaId: null, externalId: '', postId: '', history: [`Approved by ${idea.feedback.length ? 'Marketing' : 'Marketing'} · Leadership approval recorded`] }, { workspaceId, inputCount: 1, task: `Publishing "${idea.title.slice(0, 40)}"` })
  if (pub.status === 'failed') throw new Error(pub.error ?? 'Publishing failed')
  const postId = pub.payload.postId
  await query("UPDATE content_ideas SET status = 'published', updated_at = now() WHERE id = $1", [ideaId])
  await logActivity(workspaceId, 'publishing', `Published "${idea.title.slice(0, 50)}" to ${platform} (${env().publishMode})`, 'ok', { type: 'post', id: postId })
  const analytics = await analysePost(workspaceId, postId)
  const learning = await runAgent<LearningPayload>('learning', { analysis: analytics ?? undefined, patterns: [], attributions: [], written: 0, adjusted: [] }, { workspaceId, inputCount: 1, task: 'Learning from the outcome' })
  const post = await one('SELECT * FROM posts WHERE id = $1', [postId])
  return { post, analytics: analytics ? { summary: analytics.summary, recommendation: analytics.recommendation } : null, learning: { written: learning.payload.written, adjusted: learning.payload.adjusted } }
}

export async function analysePost(workspaceId: string, postId: string): Promise<AnalyticsPayload | null> {
  const p = await one('SELECT * FROM posts WHERE id = $1', [postId])
  if (!p) return null
  const result = await runAgent<AnalyticsPayload>('analytics', { postId, post: { id: p.id, title: p.title, platform: p.platform, publishedAt: String(p.published_at), format: p.format ?? null, metrics: null }, posts: [], metrics: null, baseline: {}, comparison: {}, anomalies: [], timingInsight: '', formatInsight: '', summary: '', recommendation: '' }, { workspaceId, inputCount: 1, task: `Analysing "${p.title.slice(0, 40)}"` })
  if (result.status === 'failed') return null
  await query('UPDATE posts SET analysis_summary = $2, analysis_recommendation = $3 WHERE id = $1', [postId, result.payload.summary, result.payload.recommendation])
  return result.payload
}

export async function learnFromDecision(workspaceId: string, decision: NonNullable<LearningPayload['decision']>) {
  const result = await runAgent<LearningPayload>('learning', { decision, patterns: [], attributions: [], written: 0, adjusted: [] }, { workspaceId, inputCount: 1, task: `Recording a Leadership ${decision.kind === 'approved' ? 'approval' : 'rejection'}` })
  return { written: result.payload.written, adjusted: result.payload.adjusted }
}

export async function refreshAnalytics(workspaceId: string) {
  const posts = await query<{ id: string }>("SELECT id FROM posts WHERE workspace_id = $1 AND status = 'published' ORDER BY published_at DESC LIMIT 40", [workspaceId])
  let pulls = 0
  for (const p of posts) {
    const last = await one<{ reach: number; impressions: number; likes: number; comments: number; shares: number; engagement_rate: number }>('SELECT * FROM post_metrics WHERE post_id = $1 ORDER BY captured_at DESC LIMIT 1', [p.id])
    if (!last) continue
    const g = 1 + ((p.id.charCodeAt(0) % 7) + 1) / 100
    await query('INSERT INTO post_metrics (post_id, reach, impressions, likes, comments, shares, engagement_rate) VALUES ($1,$2,$3,$4,$5,$6,$7)', [p.id, Math.round(last.reach * g), Math.round(last.impressions * g), Math.round(last.likes * g), Math.round(last.comments * (g + 0.01)), Math.round(last.shares * g), last.engagement_rate])
    pulls++
  }
  let analysed = 0
  for (const p of posts.slice(0, 5)) if (await analysePost(workspaceId, p.id)) analysed++
  await logActivity(workspaceId, 'analytics', `Refreshed metrics for ${pulls} posts and re-analysed ${analysed}`, 'ok')
  return { pulls, analysed }
}

// ── Mappers shared with the API ─────────────────────────────────────────
export function mapDraft(r: Record<string, unknown> | null) {
  if (!r) return null
  return { id: r.id, platform: r.platform, body: r.body, revision: r.revision, generatedBy: r.generated_by, model: r.model, source: r.source, updatedAt: r.updated_at }
}
export function mapMedia(r: Record<string, unknown> | null) {
  if (!r) return null
  return { id: r.id, platform: r.platform, kind: r.kind, concept: r.concept, canvas: r.canvas, width: r.width, height: r.height, altText: r.alt_text, renderMode: r.render_mode, model: r.model, prompt: r.prompt, fallbackReason: r.fallback_reason, dataUri: r.data_uri, variants: r.variants ?? [], createdAt: r.created_at }
}
