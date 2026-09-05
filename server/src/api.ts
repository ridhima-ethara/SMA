// Every REST route. Bodies validated with zod, handlers wrapped, workspace resolved per request.
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { AGENTS, REGISTRY_SUMMARY, SKILLS, STAGES, SKILL_BY_ID, defaultSkillConfig, type SkillConfigValues } from '../../shared/agent-registry'
import { IMAGE_MODELS } from '../../shared/image-models'
import { env } from './config'
import { assertConnection, one, query } from './db/pool'
import { bus } from './events'
import { apify } from './integrations/apify'
import { gcpText } from './integrations/gcp-llm'
import { parallel } from './integrations/parallel'
import { loadOverrides, logActivity, setAgentState } from './agents/runtime'
import { rendererStatus } from './agents/skills/image-models'
import { mapKnowledgeRow } from './agents/skills/research'
import { applyInstruction, applyTopRule, buildKnowledge, currentWorkspaceId, demoteIdea, generateDraft, learnFromDecision, mapDraft, mapMedia, promoteIdea, publishIdea, refreshAnalytics, regenerateImage, runDiscoveryPipeline } from './orchestrator'
import { nextKnowledgeBuild } from './scheduler'

export const api = Router()

type Handler = (req: Request, ws: string, res: Response) => Promise<unknown>
const h = (fn: Handler) => async (req: Request, res: Response) => {
  try {
    const ws = await currentWorkspaceId()
    const out = await fn(req, ws, res)
    if (!res.headersSent) res.json(out ?? { ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = err instanceof z.ZodError ? 400 : /not found/i.test(message) ? 404 : /needs a reason|not approved|refuse|cannot/i.test(message) ? 422 : 500
    if (!res.headersSent) res.status(status).json({ error: message, issues: err instanceof z.ZodError ? err.issues : undefined })
  }
}
const platformSchema = z.enum(['linkedin', 'instagram', 'x'])
const validationSchema = z.enum(['validated', 'needs_review', 'duplicate', 'rejected', 'pending'])
const dateOut = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const dayOut = (v: unknown) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v).slice(0, 10))

function integrations() {
  const tag = (a: { isConfigured(): boolean; unavailableReason(): string }) => ({ configured: a.isConfigured(), reason: a.isConfigured() ? 'Configured' : a.unavailableReason() })
  return { apify: tag(apify), parallel: tag(parallel), gcp: tag(gcpText), zImage: { configured: Boolean(env().zImage.endpoint && env().zImage.apiKey), reason: env().zImage.endpoint && env().zImage.apiKey ? 'Configured' : 'Z_IMAGE_ENDPOINT / Z_IMAGE_API_KEY are not set' } }
}

// ── Health & registry ───────────────────────────────────────────────────
api.get('/health', async (_req, res) => {
  try {
    await assertConnection()
    res.json({ ok: true, database: 'connected', publishMode: env().publishMode, registry: REGISTRY_SUMMARY, integrations: integrations(), knowledgeCron: env().knowledge.cron, tz: env().tz, nextKnowledgeBuild: nextKnowledgeBuild() })
  } catch (err) {
    res.status(503).json({ ok: false, database: 'unreachable', error: err instanceof Error ? err.message : String(err) })
  }
})

api.get('/registry', h(async (_req, ws) => {
  const overrides = await loadOverrides(ws)
  const stats = await query<{ skill_id: string; runs: number; failures: number; avg_ms: number }>("SELECT skill_id, count(*)::int AS runs, count(*) FILTER (WHERE status = 'failed')::int AS failures, avg(duration_ms)::int AS avg_ms FROM skill_runs WHERE workspace_id = $1 GROUP BY skill_id", [ws])
  const statMap = new Map(stats.map((s) => [s.skill_id, s]))
  return {
    stages: STAGES, agents: AGENTS, summary: REGISTRY_SUMMARY,
    skills: SKILLS.map((s) => {
      const o = overrides[s.id]
      const st = statMap.get(s.id)
      return { ...s, enabled: o?.enabled ?? s.enabledByDefault, values: { ...defaultSkillConfig(s.id), ...(o?.config ?? {}) }, isOverridden: Boolean(o && (Object.keys(o.config).length || o.enabled !== s.enabledByDefault)), stats: { runs: st?.runs ?? 0, failures: st?.failures ?? 0, avgMs: st?.avg_ms ?? 0 } }
    }),
  }
}))

api.patch('/skills/:skillId', h(async (req, ws) => {
  const spec = SKILL_BY_ID[req.params.skillId as string]
  if (!spec) throw new Error('Skill not found')
  const body = z.object({ enabled: z.boolean().optional(), config: z.record(z.union([z.string(), z.number(), z.boolean()])).optional() }).parse(req.body)
  if (body.enabled === false && spec.critical) throw new Error(`Cannot disable "${spec.name}" — it is a critical skill. Critical skills always run.`)
  const overrides = await loadOverrides(ws)
  const merged: SkillConfigValues = { ...defaultSkillConfig(spec.id), ...(overrides[spec.id]?.config ?? {}), ...(body.config ?? {}) }
  for (const f of spec.config) {
    const v = merged[f.key]
    if ((f.type === 'number' || f.type === 'percent') && typeof v === 'number') { if (f.min !== undefined && v < f.min) merged[f.key] = f.min; if (f.max !== undefined && v > f.max) merged[f.key] = f.max }
    if (f.type === 'enum' && f.options && !f.options.includes(String(v))) merged[f.key] = f.default
  }
  const diff: SkillConfigValues = {}
  for (const f of spec.config) if (merged[f.key] !== f.default) diff[f.key] = merged[f.key]
  const enabled = body.enabled ?? overrides[spec.id]?.enabled ?? spec.enabledByDefault
  await query('INSERT INTO agent_skills (workspace_id, skill_id, agent_id, enabled, config) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id, skill_id) DO UPDATE SET enabled = $4, config = $5, updated_at = now()', [ws, spec.id, spec.agentId, enabled, JSON.stringify(diff)])
  await logActivity(ws, spec.agentId, `${spec.name}: ${body.enabled === undefined ? `settings updated (${Object.keys(body.config ?? {}).join(', ')})` : enabled ? 'switched on' : 'switched off'}`, 'ok')
  return { skillId: spec.id, enabled, values: merged, isOverridden: Object.keys(diff).length > 0 || enabled !== spec.enabledByDefault }
}))

api.post('/skills/:skillId/reset', h(async (req, ws) => {
  const spec = SKILL_BY_ID[req.params.skillId as string]
  if (!spec) throw new Error('Skill not found')
  await query('DELETE FROM agent_skills WHERE workspace_id = $1 AND skill_id = $2', [ws, spec.id])
  await logActivity(ws, spec.agentId, `${spec.name}: reset to defaults`, 'ok')
  return { skillId: spec.id, enabled: spec.enabledByDefault, values: defaultSkillConfig(spec.id), isOverridden: false }
}))

// ── State ───────────────────────────────────────────────────────────────
const mapKeyword = (r: Record<string, unknown>) => ({ id: r.id, term: r.term, category: r.category, weight: r.weight, active: r.active, createdAt: dateOut(r.created_at) })
const mapSignal = (r: Record<string, unknown>) => ({ id: r.id, keywordId: r.keyword_id, term: r.term, runId: r.run_id, postCount: r.post_count, totalEngagement: r.total_engagement, avgEngagement: r.avg_engagement, velocity: r.velocity, growthPct: r.growth_pct, trendScore: r.trend_score, rank: r.rank, isTrending: r.is_trending, trendReason: r.trend_reason, components: r.components ?? {}, capturedAt: dateOut(r.captured_at) })
const mapHashtag = (r: Record<string, unknown>) => ({ id: r.id, tag: r.tag, displayTag: r.display_tag, keywordId: r.keyword_id, keywordTerm: r.term, runId: r.run_id, postCount: r.post_count, totalEngagement: r.total_engagement, engagementPerPost: r.engagement_per_post, relevance: r.relevance, credibility: r.credibility, freshness: r.freshness, hashtagScore: r.hashtag_score, rank: r.rank, validation: r.validation, verdictReason: r.verdict_reason, duplicateOfId: r.duplicate_of_id, duplicateOfTag: r.duplicate_of_tag, inTopSet: r.in_top_set, researchedAt: dateOut(r.researched_at), firstSeenAt: dateOut(r.first_seen_at), lastSeenAt: dateOut(r.last_seen_at), validatedAt: dateOut(r.validated_at), createdAt: dateOut(r.created_at) })
const mapItem = (r: Record<string, unknown>) => ({ id: r.id, externalId: r.external_id, title: r.title, snippet: r.snippet, url: r.url, sourceName: r.source_name, sourceType: r.source_type, keyword: r.term, keywordId: r.keyword_id, authorName: r.author_name, authorHeadline: r.author_headline, authorFollowers: r.author_followers, hashtags: r.hashtags ?? [], engagement: r.engagement, reactions: r.reactions, comments: r.comments, reposts: r.reposts, relevance: r.relevance, credibility: r.credibility, freshness: r.freshness, isDuplicate: r.is_duplicate, duplicateOfId: r.duplicate_of_id, validation: r.validation, verdictReason: r.verdict_reason, captureSource: r.capture_source, fallbackReason: r.fallback_reason, postedAt: dateOut(r.posted_at), scrapedAt: dateOut(r.scraped_at), validatedAt: dateOut(r.validated_at) })
const mapIdea = (r: Record<string, unknown>) => ({ id: r.id, sourceItemId: r.source_item_id, hashtagId: r.hashtag_id, hashtag: r.display_tag ?? (r.analysis as { hashtag?: string } | null)?.hashtag ?? null, title: r.title, description: r.description, sourceTopic: r.source_topic, platform: r.platform, altPlatforms: r.alt_platforms ?? [], date: dayOut(r.scheduled_date), time: r.scheduled_time, confidence: r.confidence, priorityScore: r.priority_score, platformRank: r.platform_rank, calendarSlot: r.calendar_slot, status: r.status, analysis: r.analysis ?? {}, feedback: r.feedback ?? [], isNewTrend: r.is_new_trend, marketingApprovedBy: r.marketing_approved_by, marketingApprovedAt: dateOut(r.marketing_approved_at), leadershipDecision: r.leadership_decision, createdAt: dateOut(r.created_at), updatedAt: dateOut(r.updated_at), drafts: {} as Record<string, unknown>, media: {} as Record<string, unknown> })
const mapPost = (r: Record<string, unknown>) => ({ id: r.id, ideaId: r.idea_id, title: r.title, platform: r.platform, content: r.content, status: r.status, externalId: r.external_id, publishMode: r.publish_mode, publishedAt: dayOut(r.published_at), history: r.history ?? [], mediaAssetId: r.media_asset_id, mediaDataUri: r.media_data_uri ?? null, format: r.format, analysisSummary: r.analysis_summary, analysisRecommendation: r.analysis_recommendation, metrics: r.reach == null && r.likes == null ? null : { reach: r.reach, impressions: r.impressions, likes: r.likes, comments: r.comments, shares: r.shares, engagementRate: r.engagement_rate, capturedAt: dateOut(r.captured_at) }, createdAt: dateOut(r.created_at) })
const mapBuild = (r: Record<string, unknown> | null) => r ? ({ id: r.id, trigger: r.trigger, status: r.status, hashtagsResearched: r.hashtags_researched, entriesWritten: r.entries_written, entriesMerged: r.entries_merged, sourcesCited: r.sources_cited, researchSource: r.research_source, fallbackReason: r.fallback_reason, startedAt: dateOut(r.started_at), finishedAt: dateOut(r.finished_at), summary: r.summary ?? {}, error: r.error, nextBuildAt: nextKnowledgeBuild() }) : null
const mapReview = (r: Record<string, unknown>) => ({ id: r.id, kind: r.kind, entityId: r.entity_id, title: r.title, reason: r.reason, decisionRequested: r.decision_requested, options: r.options ?? [], resolved: r.resolved, resolvedBy: r.resolved_by, resolvedAt: dateOut(r.resolved_at), outcome: r.outcome, createdAt: dateOut(r.created_at) })

async function readState(ws: string) {
  const [keywords, signals, hashtags, top, scraped, ideas, drafts, media, posts, knowledge, build, agents, activity, analytics, review] = await Promise.all([
    query('SELECT * FROM keywords WHERE workspace_id = $1 ORDER BY weight DESC, term', [ws]),
    query('SELECT s.*, k.term FROM keyword_signals s JOIN keywords k ON k.id = s.keyword_id WHERE s.workspace_id = $1 AND s.run_id = (SELECT run_id FROM keyword_signals WHERE workspace_id = $1 ORDER BY captured_at DESC LIMIT 1) ORDER BY s.rank', [ws]),
    query('SELECT h.*, k.term, d.display_tag AS duplicate_of_tag FROM hashtags h LEFT JOIN keywords k ON k.id = h.keyword_id LEFT JOIN hashtags d ON d.id = h.duplicate_of_id WHERE h.workspace_id = $1 AND h.run_id = (SELECT run_id FROM hashtags WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1) ORDER BY h.rank NULLS LAST, h.hashtag_score DESC', [ws]),
    query('SELECT h.*, k.term, NULL AS duplicate_of_tag FROM hashtags h LEFT JOIN keywords k ON k.id = h.keyword_id WHERE h.workspace_id = $1 AND h.in_top_set = true ORDER BY h.hashtag_score DESC LIMIT 25', [ws]),
    query('SELECT s.*, k.term FROM scraped_items s LEFT JOIN keywords k ON k.id = s.keyword_id WHERE s.workspace_id = $1 ORDER BY s.scraped_at DESC LIMIT 240', [ws]),
    query('SELECT i.*, h.display_tag FROM content_ideas i LEFT JOIN hashtags h ON h.id = i.hashtag_id WHERE i.workspace_id = $1 ORDER BY i.scheduled_date, i.scheduled_time', [ws]),
    query('SELECT d.* FROM drafts d JOIN content_ideas i ON i.id = d.idea_id WHERE i.workspace_id = $1', [ws]),
    query('SELECT * FROM media_assets WHERE workspace_id = $1', [ws]),
    query('SELECT p.*, m.reach, m.impressions, m.likes, m.comments, m.shares, m.engagement_rate, m.captured_at, ma.data_uri AS media_data_uri FROM posts p LEFT JOIN LATERAL (SELECT * FROM post_metrics WHERE post_id = p.id ORDER BY captured_at DESC LIMIT 1) m ON true LEFT JOIN media_assets ma ON ma.id = p.media_asset_id WHERE p.workspace_id = $1 ORDER BY p.published_at DESC, p.created_at DESC', [ws]),
    query('SELECT * FROM knowledge_entries WHERE workspace_id = $1 ORDER BY created_at DESC', [ws]),
    one('SELECT * FROM knowledge_builds WHERE workspace_id = $1 ORDER BY started_at DESC LIMIT 1', [ws]),
    query('SELECT * FROM agent_state WHERE workspace_id = $1', [ws]),
    query('SELECT * FROM activity_events WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 60', [ws]),
    query('SELECT * FROM platform_analytics WHERE workspace_id = $1 ORDER BY month', [ws]),
    query('SELECT * FROM review_queue WHERE workspace_id = $1 AND resolved = false ORDER BY created_at DESC', [ws]),
  ])
  const ideaList = ideas.map(mapIdea)
  const byIdea = new Map(ideaList.map((i) => [i.id, i]))
  for (const d of drafts) { const i = byIdea.get(String(d.idea_id)); if (i) i.drafts[String(d.platform)] = mapDraft(d) }
  for (const m of media) { const i = byIdea.get(String(m.idea_id)); if (i) i.media[String(m.platform)] = mapMedia(m) }
  return {
    keywords: keywords.map(mapKeyword), keywordSignals: signals.map(mapSignal), hashtags: hashtags.map(mapHashtag), topHashtags: top.map(mapHashtag), scraped: scraped.map(mapItem), ideas: ideaList, published: posts.map(mapPost),
    knowledge: knowledge.map(mapKnowledgeRow).map((k, i) => ({ ...k, ruleN: knowledge[i].rule_n ?? null, buildId: knowledge[i].build_id ?? null })), knowledgeBuild: mapBuild(build),
    agents: agents.map((a) => ({ id: a.agent_id, status: a.status, currentTask: a.current_task, lastRun: dateOut(a.last_run), processed: a.processed, successRate: a.success_rate })),
    activity: activity.map((a) => ({ id: a.id, agentId: a.agent_id, message: a.message, status: a.status, entityType: a.entity_type, entityId: a.entity_id, at: dateOut(a.created_at) })),
    analytics: analytics.map((a) => ({ platform: a.platform, month: a.month, label: a.label, isReported: a.is_reported, metrics: a.metrics, daily: a.daily })),
    reviewQueue: review.map(mapReview), integrations: integrations(), publishMode: env().publishMode, imageModels: rendererStatus(), nextKnowledgeBuild: nextKnowledgeBuild(),
  }
}
api.get('/state', h(async (_req, ws) => readState(ws)))

// ── Keywords & hashtags ─────────────────────────────────────────────────
api.get('/keywords', h(async (_req, ws) => (await query('SELECT * FROM keywords WHERE workspace_id = $1 ORDER BY weight DESC', [ws])).map(mapKeyword)))
api.post('/keywords', h(async (req, ws) => {
  const b = z.object({ term: z.string().min(2).max(80), category: z.enum(['Core', 'Adjacent', 'Positioning']).default('Core'), weight: z.number().int().min(0).max(100).default(50) }).parse(req.body)
  const r = await one('INSERT INTO keywords (workspace_id, term, category, weight) VALUES ($1,$2,$3,$4) RETURNING *', [ws, b.term.trim(), b.category, b.weight])
  await logActivity(ws, 'scraping', `Keyword added: "${b.term}" (${b.category}, weight ${b.weight})`)
  return mapKeyword(r as Record<string, unknown>)
}))
api.patch('/keywords/:id', h(async (req, ws) => {
  const b = z.object({ term: z.string().min(2).max(80).optional(), category: z.enum(['Core', 'Adjacent', 'Positioning']).optional(), weight: z.number().int().min(0).max(100).optional(), active: z.boolean().optional() }).parse(req.body)
  const r = await one('UPDATE keywords SET term = COALESCE($3, term), category = COALESCE($4, category), weight = COALESCE($5, weight), active = COALESCE($6, active) WHERE id = $1 AND workspace_id = $2 RETURNING *', [req.params.id, ws, b.term ?? null, b.category ?? null, b.weight ?? null, b.active ?? null])
  if (!r) throw new Error('Keyword not found')
  return mapKeyword(r)
}))
api.delete('/keywords/:id', h(async (req, ws) => {
  // Nothing is ever deleted: a keyword is deactivated so its signal history survives.
  const r = await one('UPDATE keywords SET active = false WHERE id = $1 AND workspace_id = $2 RETURNING *', [req.params.id, ws])
  if (!r) throw new Error('Keyword not found')
  await logActivity(ws, 'scraping', `Keyword deactivated: "${r.term}" (history retained)`)
  return { ok: true, deactivated: mapKeyword(r) }
}))
api.get('/keywords/trending', h(async (_req, ws) => (await query('SELECT s.*, k.term FROM keyword_signals s JOIN keywords k ON k.id = s.keyword_id WHERE s.workspace_id = $1 AND s.is_trending = true AND s.run_id = (SELECT run_id FROM keyword_signals WHERE workspace_id = $1 ORDER BY captured_at DESC LIMIT 1) ORDER BY s.rank', [ws])).map(mapSignal)))
api.get('/hashtags', h(async (req, ws) => {
  const q = z.object({ status: validationSchema.optional(), keywordId: z.string().uuid().optional(), top: z.coerce.number().int().min(1).max(200).optional() }).parse(req.query)
  const rows = await query('SELECT h.*, k.term, d.display_tag AS duplicate_of_tag FROM hashtags h LEFT JOIN keywords k ON k.id = h.keyword_id LEFT JOIN hashtags d ON d.id = h.duplicate_of_id WHERE h.workspace_id = $1 AND ($2::text IS NULL OR h.validation = $2) AND ($3::uuid IS NULL OR h.keyword_id = $3) ORDER BY h.hashtag_score DESC LIMIT $4', [ws, q.status ?? null, q.keywordId ?? null, q.top ?? 100])
  return rows.map(mapHashtag)
}))
api.get('/hashtags/top', h(async (_req, ws) => (await query('SELECT h.*, k.term, NULL AS duplicate_of_tag FROM hashtags h LEFT JOIN keywords k ON k.id = h.keyword_id WHERE h.workspace_id = $1 AND h.in_top_set = true ORDER BY h.hashtag_score DESC LIMIT 25', [ws])).map(mapHashtag)))
api.patch('/hashtags/:id/validation', h(async (req, ws) => {
  const b = z.object({ validation: validationSchema, by: z.string().optional() }).parse(req.body)
  const r = await one('UPDATE hashtags SET validation = $3, validated_at = now(), verdict_reason = CASE WHEN $3 IN (\'validated\',\'rejected\') THEN $4 || \' — \' || COALESCE(verdict_reason, \'\') ELSE verdict_reason END WHERE id = $1 AND workspace_id = $2 RETURNING *', [req.params.id, ws, b.validation, `${b.validation === 'validated' ? 'Approved' : 'Rejected'} by ${b.by ?? 'Marketing'}`])
  if (!r) throw new Error('Hashtag not found')
  await query('UPDATE review_queue SET resolved = true, resolved_by = $3, resolved_at = now(), outcome = $4 WHERE workspace_id = $1 AND entity_id = $2 AND resolved = false', [ws, req.params.id, b.by ?? 'Marketing', b.validation])
  await logActivity(ws, 'validation', `#${r.display_tag} marked ${b.validation} by ${b.by ?? 'Marketing'}`, 'ok', { type: 'hashtag', id: String(r.id) })
  bus.publish({ type: 'hashtag.validated', agentId: 'validation', message: `${b.validation}: #${r.display_tag}`, data: { id: r.id, verdict: b.validation, human: true } })
  return mapHashtag({ ...r, term: null, duplicate_of_tag: null })
}))

// ── Pipeline ────────────────────────────────────────────────────────────
api.post('/pipeline/run', h(async (req, ws) => {
  const b = z.object({ paceMs: z.number().int().min(0).max(5000).optional(), keywordIds: z.array(z.string().uuid()).optional() }).parse(req.body ?? {})
  return runDiscoveryPipeline({ workspaceId: ws, paceMs: b.paceMs, keywordIds: b.keywordIds, trigger: 'manual' })
}))
api.get('/runs', h(async (_req, ws) => ({
  agentRuns: (await query('SELECT * FROM agent_runs WHERE workspace_id = $1 ORDER BY started_at DESC LIMIT 40', [ws])).map((r) => ({ id: r.id, pipelineRunId: r.pipeline_run_id, agentId: r.agent_id, status: r.status, startedAt: dateOut(r.started_at), finishedAt: dateOut(r.finished_at), durationMs: r.duration_ms, inputCount: r.input_count, outputCount: r.output_count, error: r.error })),
  skillRuns: (await query('SELECT * FROM skill_runs WHERE workspace_id = $1 ORDER BY started_at DESC LIMIT 300', [ws])).map((r) => ({ id: r.id, agentRunId: r.agent_run_id, skillId: r.skill_id, agentId: r.agent_id, status: r.status, durationMs: r.duration_ms, configUsed: r.config_used, note: r.note, startedAt: dateOut(r.started_at) })),
  pipelineRuns: (await query('SELECT * FROM pipeline_runs WHERE workspace_id = $1 ORDER BY started_at DESC LIMIT 20', [ws])).map((r) => ({ id: r.id, trigger: r.trigger, status: r.status, startedAt: dateOut(r.started_at), finishedAt: dateOut(r.finished_at), summary: r.summary })),
})))
api.patch('/items/:id/validation', h(async (req, ws) => {
  const b = z.object({ validation: validationSchema, by: z.string().optional() }).parse(req.body)
  const r = await one('UPDATE scraped_items SET validation = $3, validated_at = now(), verdict_reason = $4 || \' — \' || COALESCE(verdict_reason, \'\') WHERE id = $1 AND workspace_id = $2 RETURNING *', [req.params.id, ws, b.validation, `${b.validation === 'validated' ? 'Approved' : b.validation === 'rejected' ? 'Rejected' : 'Set to ' + b.validation} by ${b.by ?? 'Marketing'}`])
  if (!r) throw new Error('Item not found')
  await query('UPDATE review_queue SET resolved = true, resolved_by = $3, resolved_at = now(), outcome = $4 WHERE workspace_id = $1 AND entity_id = $2 AND resolved = false', [ws, req.params.id, b.by ?? 'Marketing', b.validation])
  const open = await one<{ n: number }>('SELECT count(*)::int AS n FROM review_queue WHERE workspace_id = $1 AND resolved = false', [ws])
  if ((open?.n ?? 0) === 0) await setAgentState(ws, 'validation', { status: 'completed', currentTask: 'Review queue clear' })
  await logActivity(ws, 'validation', `"${String(r.title).slice(0, 50)}" marked ${b.validation} by ${b.by ?? 'Marketing'}`, 'ok', { type: 'scraped_item', id: String(r.id) })
  bus.publish({ type: 'item.validated', agentId: 'validation', message: `${b.validation}: ${r.title}`, data: { id: r.id, verdict: b.validation, human: true } })
  return mapItem({ ...r, term: null })
}))

// ── Knowledge ───────────────────────────────────────────────────────────
api.post('/knowledge/build', h(async (req, ws) => {
  const b = z.object({ hashtagCount: z.number().int().min(1).max(100).optional(), forceRefresh: z.boolean().optional() }).parse(req.body ?? {})
  return mapBuild(await buildKnowledge({ workspaceId: ws, trigger: 'manual', hashtagCount: b.hashtagCount, forceRefresh: b.forceRefresh }))
}))
api.get('/knowledge/builds', h(async (_req, ws) => (await query('SELECT * FROM knowledge_builds WHERE workspace_id = $1 ORDER BY started_at DESC LIMIT 20', [ws])).map((r) => mapBuild(r))))
api.get('/knowledge', h(async (_req, ws) => (await query('SELECT * FROM knowledge_entries WHERE workspace_id = $1 ORDER BY created_at DESC', [ws])).map(mapKnowledgeRow)))
api.post('/knowledge', h(async (req, ws) => {
  const b = z.object({ title: z.string().min(3).max(200), category: z.string().min(2).max(60), content: z.string().min(3).max(4000), source: z.string().max(120).optional(), tags: z.array(z.string()).optional(), confidence: z.enum(['High', 'Medium', 'Low']).optional(), hashtagId: z.string().uuid().optional() }).parse(req.body)
  const r = await one('INSERT INTO knowledge_entries (workspace_id, title, category, content, source, tags, confidence, origin, hashtag_id) VALUES ($1,$2,$3,$4,$5,$6,$7,\'manual\',$8) RETURNING *', [ws, b.title, b.category, b.content, b.source ?? 'Manual entry', b.tags ?? [], b.confidence ?? 'Medium', b.hashtagId ?? null])
  bus.publish({ type: 'knowledge.written', message: b.title, data: { id: r?.id, category: b.category, origin: 'manual' } })
  await logActivity(ws, 'knowledge', `Manual entry added: "${b.title}"`)
  return mapKnowledgeRow(r as Record<string, unknown>)
}))
api.patch('/knowledge/:id', h(async (req, ws) => {
  // Soft toggle only — there is no delete route.
  const b = z.object({ active: z.boolean() }).parse(req.body)
  const r = await one('UPDATE knowledge_entries SET active = $3 WHERE id = $1 AND workspace_id = $2 RETURNING *', [req.params.id, ws, b.active])
  if (!r) throw new Error('Entry not found')
  await logActivity(ws, 'knowledge', `"${String(r.title).slice(0, 50)}" switched ${b.active ? 'on' : 'off'}`)
  return mapKnowledgeRow(r)
}))

// ── Ideas / content ─────────────────────────────────────────────────────
api.post('/ideas/:id/draft', h(async (req, ws) => generateDraft(ws, req.params.id as string, z.object({ platform: platformSchema }).parse(req.body).platform)))
api.post('/ideas/:id/image', h(async (req, ws) => {
  const b = z.object({ platform: platformSchema, model: z.string().optional(), prompt: z.string().max(2000).optional(), instruction: z.string().max(500).optional() }).parse(req.body)
  return regenerateImage(ws, req.params.id as string, b.platform, { model: b.model, prompt: b.prompt, instruction: b.instruction })
}))
api.post('/ideas/:id/instruct', h(async (req, ws) => {
  const b = z.object({ platform: platformSchema, instruction: z.string().min(1).max(1000) }).parse(req.body)
  return applyInstruction(ws, req.params.id as string, b.platform, b.instruction)
}))
api.patch('/ideas/:id', h(async (req, ws) => {
  const b = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), time: z.string().max(12).optional(), platform: platformSchema.optional(), status: z.enum(['suggested', 'drafted', 'in_review', 'pending_leadership', 'approved', 'scheduled', 'published', 'rejected']).optional(), draft: z.string().max(6000).optional(), calendarSlot: z.enum(['primary', 'suggestion']).optional(), title: z.string().max(200).optional() }).parse(req.body)
  const id = req.params.id as string
  const before = await one('SELECT * FROM content_ideas WHERE id = $1 AND workspace_id = $2', [id, ws])
  if (!before) throw new Error('Idea not found')
  if (b.status === 'published') throw new Error('Publishing goes through the approval routes — an idea cannot be set to published directly.')
  await query('UPDATE content_ideas SET scheduled_date = COALESCE($3, scheduled_date), scheduled_time = COALESCE($4, scheduled_time), platform = COALESCE($5, platform), status = COALESCE($6, status), title = COALESCE($7, title), updated_at = now() WHERE id = $1 AND workspace_id = $2', [id, ws, b.date ?? null, b.time ?? null, b.platform ?? null, b.status ?? null, b.title ?? null])
  if (b.draft !== undefined) {
    const platform = b.platform ?? String(before.platform)
    await query('INSERT INTO drafts (idea_id, platform, body, generated_by, model, source) VALUES ($1,$2,$3,\'human\',\'manual\',\'fixture\') ON CONFLICT (idea_id, platform) DO UPDATE SET body = EXCLUDED.body, revision = drafts.revision + 1, generated_by = \'human\', updated_at = now()', [id, platform, b.draft])
  }
  let demoted: { id: string; title: string } | null = null
  let promoted: { id: string; title: string } | null = null
  if (b.calendarSlot === 'primary' && before.calendar_slot !== 'primary') demoted = (await promoteIdea(ws, id)).demoted
  else if (b.calendarSlot === 'suggestion' && before.calendar_slot !== 'suggestion') promoted = (await demoteIdea(ws, id)).promoted
  else if (b.platform && b.platform !== before.platform) await applyTopRule(ws)
  if (b.date && b.date !== dayOut(before.scheduled_date)) await logActivity(ws, 'calendar', `"${String(before.title).slice(0, 40)}" moved to ${b.date}`, 'ok', { type: 'content_idea', id })
  const r = await one('SELECT i.*, h.display_tag FROM content_ideas i LEFT JOIN hashtags h ON h.id = i.hashtag_id WHERE i.id = $1', [id])
  return { ok: true, idea: mapIdea(r as Record<string, unknown>), demoted, promoted }
}))
api.delete('/ideas/:id', h(async (req, ws) => {
  // Nothing is ever deleted: the idea is marked rejected with a recorded reason.
  const r = await one("UPDATE content_ideas SET status = 'rejected', leadership_decision = COALESCE(leadership_decision, $3::jsonb), updated_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING *", [req.params.id, ws, JSON.stringify({ by: 'Marketing', decision: 'rejected', reason: 'Removed from the calendar by Marketing', at: new Date().toISOString() })])
  if (!r) throw new Error('Idea not found')
  await applyTopRule(ws)
  await logActivity(ws, 'calendar', `"${String(r.title).slice(0, 40)}" removed from the calendar (kept as rejected)`)
  return { ok: true }
}))
api.post('/ideas/:id/approve', h(async (req, ws) => {
  const b = z.object({ by: z.string().min(1).max(80) }).parse(req.body)
  const r = await one("UPDATE content_ideas SET status = 'pending_leadership', marketing_approved_by = $3, marketing_approved_at = now(), updated_at = now() WHERE id = $1 AND workspace_id = $2 AND status <> 'published' RETURNING *", [req.params.id, ws, b.by])
  if (!r) throw new Error('Idea not found')
  await setAgentState(ws, 'review', { status: 'waiting', currentTask: `Waiting on Leadership for "${String(r.title).slice(0, 40)}"` })
  await logActivity(ws, 'review', `${b.by} approved "${String(r.title).slice(0, 50)}" — sent to Leadership`, 'ok', { type: 'content_idea', id: String(r.id) })
  return { ok: true, status: 'pending_leadership' }
}))
api.post('/ideas/:id/leadership/approve', h(async (req, ws) => {
  const b = z.object({ by: z.string().min(1).max(80), publish: z.boolean().default(true) }).parse(req.body)
  const idea = await one('SELECT * FROM content_ideas WHERE id = $1 AND workspace_id = $2', [req.params.id, ws])
  if (!idea) throw new Error('Idea not found')
  if (idea.status !== 'pending_leadership') throw new Error(`Leadership can only approve ideas Marketing has already approved (status is "${idea.status}").`)
  await query("UPDATE content_ideas SET status = 'approved', leadership_decision = $3, updated_at = now() WHERE id = $1 AND workspace_id = $2", [idea.id, ws, JSON.stringify({ by: b.by, decision: 'approved', at: new Date().toISOString() })])
  await learnFromDecision(ws, { kind: 'approved', title: String(idea.title), by: b.by, sourceTopic: String(idea.source_topic ?? ''), platform: String(idea.platform) })
  await logActivity(ws, 'review', `${b.by} gave final approval to "${String(idea.title).slice(0, 50)}"`, 'ok', { type: 'content_idea', id: String(idea.id) })
  await setAgentState(ws, 'review', { status: 'completed', currentTask: 'Final approval recorded' })
  const published = b.publish ? await publishIdea(ws, String(idea.id)) : null
  return { ok: true, status: b.publish ? 'published' : 'approved', published }
}))
api.post('/ideas/:id/leadership/reject', h(async (req, ws) => {
  const b = z.object({ by: z.string().min(1).max(80), reason: z.string().optional() }).parse(req.body)
  if (!b.reason || !b.reason.trim()) throw new Error('A rejection needs a reason — it is what the agents learn from.')
  const idea = await one('SELECT * FROM content_ideas WHERE id = $1 AND workspace_id = $2', [req.params.id, ws])
  if (!idea) throw new Error('Idea not found')
  await query("UPDATE content_ideas SET status = 'rejected', leadership_decision = $3, updated_at = now() WHERE id = $1 AND workspace_id = $2", [idea.id, ws, JSON.stringify({ by: b.by, decision: 'rejected', reason: b.reason.trim(), at: new Date().toISOString() })])
  await learnFromDecision(ws, { kind: 'rejected', title: String(idea.title), reason: b.reason.trim(), by: b.by, sourceTopic: String(idea.source_topic ?? ''), platform: String(idea.platform) })
  await applyTopRule(ws)
  await logActivity(ws, 'review', `${b.by} rejected "${String(idea.title).slice(0, 50)}": ${b.reason.trim().slice(0, 80)}`, 'warn', { type: 'content_idea', id: String(idea.id) })
  return { ok: true, status: 'rejected' }
}))
api.post('/ideas/:id/publish', h(async (req, ws) => publishIdea(ws, req.params.id as string)))

// ── Analytics / images / lineage / review ───────────────────────────────
api.post('/analytics/refresh', h(async (_req, ws) => refreshAnalytics(ws)))
api.get('/image-models', h(async () => ({ models: IMAGE_MODELS, status: rendererStatus() })))
api.get('/lineage/:type/:id', h(async (req, ws) => {
  const { type, id } = z.object({ type: z.string(), id: z.string().uuid() }).parse(req.params)
  const rows = await query(
    `WITH RECURSIVE down AS (
       SELECT from_type, from_id, to_type, to_id, agent_id, 1 AS depth FROM lineage_edges WHERE workspace_id = $1 AND from_type = $2 AND from_id = $3
       UNION ALL SELECT e.from_type, e.from_id, e.to_type, e.to_id, e.agent_id, d.depth + 1 FROM lineage_edges e JOIN down d ON e.from_type = d.to_type AND e.from_id = d.to_id WHERE d.depth < 8
     ), up AS (
       SELECT from_type, from_id, to_type, to_id, agent_id, 1 AS depth FROM lineage_edges WHERE workspace_id = $1 AND to_type = $2 AND to_id = $3
       UNION ALL SELECT e.from_type, e.from_id, e.to_type, e.to_id, e.agent_id, u.depth + 1 FROM lineage_edges e JOIN up u ON e.to_type = u.from_type AND e.to_id = u.from_id WHERE u.depth < 8
     ) SELECT 'downstream' AS direction, * FROM down UNION ALL SELECT 'upstream', * FROM up`,
    [ws, type, id],
  )
  return { root: { type, id }, edges: rows.map((r) => ({ direction: r.direction, fromType: r.from_type, fromId: r.from_id, toType: r.to_type, toId: r.to_id, agentId: r.agent_id, depth: r.depth })) }
}))
api.get('/review-queue', h(async (req, ws) => {
  const q = z.object({ resolved: z.enum(['true', 'false']).optional() }).parse(req.query)
  return (await query('SELECT * FROM review_queue WHERE workspace_id = $1 AND ($2::boolean IS NULL OR resolved = $2) ORDER BY created_at DESC LIMIT 100', [ws, q.resolved === undefined ? null : q.resolved === 'true'])).map(mapReview)
}))
api.post('/review-queue/:id/resolve', h(async (req, ws) => {
  const b = z.object({ outcome: z.string().min(1).max(120), by: z.string().min(1).max(80) }).parse(req.body)
  const r = await one('UPDATE review_queue SET resolved = true, resolved_by = $3, resolved_at = now(), outcome = $4 WHERE id = $1 AND workspace_id = $2 RETURNING *', [req.params.id, ws, b.by, b.outcome])
  if (!r) throw new Error('Review item not found')
  const verdict = /approve|keep/i.test(b.outcome) ? 'validated' : /reject/i.test(b.outcome) ? 'rejected' : null
  if (verdict && r.kind === 'scraped_item') await query('UPDATE scraped_items SET validation = $2, validated_at = now() WHERE id = $1', [r.entity_id, verdict])
  if (verdict && r.kind === 'hashtag') await query('UPDATE hashtags SET validation = $2, validated_at = now() WHERE id = $1', [r.entity_id, verdict])
  if (r.kind === 'knowledge_conflict' && /keep/i.test(b.outcome)) { /* keep = leave both active; the human chose */ }
  await logActivity(ws, r.kind === 'knowledge_conflict' ? 'knowledge' : 'validation', `${b.by} resolved "${String(r.title ?? r.reason).slice(0, 50)}": ${b.outcome}`, 'ok')
  return mapReview(r)
}))

// ── SSE ─────────────────────────────────────────────────────────────────
api.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString(), buffered: bus.size })}\n\n`)
  for (const e of bus.recent(40)) res.write(`data: ${JSON.stringify(e)}\n\n`)
  const unsubscribe = bus.subscribe((e) => res.write(`data: ${JSON.stringify(e)}\n\n`))
  const ping = setInterval(() => res.write(': ping\n\n'), 25000)
  req.on('close', () => { clearInterval(ping); unsubscribe(); res.end() })
})
