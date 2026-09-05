// Publishing Agent + Analytics Agent skills — stage `ship` and `learn`.
import { BRAND, type Platform } from '../../../../shared/brand-voice'
import { env } from '../../config'
import { one, query } from '../../db/pool'
import { registerSkill } from '../runtime'
import type { IdeaRecord } from './create'

export interface PlatformAdapter {
  mode: 'demo' | 'live'
  upload(platform: Platform, dataUri: string): Promise<string>
  dispatch(platform: Platform, content: string, mediaId: string | null): Promise<string>
}

const rnd = (seed: string) => { let h = 2166136261; for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) } return (h >>> 0) }

export const demoAdapter: PlatformAdapter = {
  mode: 'demo',
  async upload(platform, dataUri) { return `${platform}-media-${(rnd(dataUri.slice(0, 200)) % 1_000_000).toString(36)}` },
  async dispatch(platform, content) { return `${platform}:demo:${(rnd(content) % 100_000_000).toString(36)}` },
}

export const liveAdapter: PlatformAdapter = {
  mode: 'live',
  async upload() { throw new Error('Live publishing requires platform credentials — not configured in this deployment') },
  async dispatch() { throw new Error('Live publishing requires platform credentials — not configured in this deployment') },
}

export function platformAdapter(): PlatformAdapter {
  return env().publishMode === 'live' ? liveAdapter : demoAdapter
}

export interface PublishPayload extends Record<string, unknown> {
  idea: IdeaRecord
  platform: Platform
  content: string
  mediaDataUri?: string
  mediaAssetId?: string
  mode: 'demo' | 'live'
  formatCheck: { ok: boolean; notes: string[] }
  mediaId: string | null
  externalId: string
  postId: string
  history: string[]
  outputCount?: number
  completionNote?: string
}

registerSkill<PublishPayload>('publishing.format.validate', (p, ctx) => {
  const notes: string[] = []
  const limit = BRAND.platformLimits[p.platform]
  if (p.content.length > limit) notes.push(`${p.content.length} chars exceeds the ${p.platform} limit of ${limit}`)
  const tags = (p.content.match(/#[\p{L}\p{N}_]+/gu) ?? []).length
  if (tags < BRAND.hashtags.min || tags > BRAND.hashtags.max) notes.push(`${tags} hashtags outside ${BRAND.hashtags.min}–${BRAND.hashtags.max}`)
  if (ctx.bool('requireMedia') && !p.mediaDataUri) notes.push('No creative attached')
  if (notes.length) throw new Error(`Format check failed: ${notes.join('; ')}`)
  ctx.log(`Format OK · ${p.content.length}/${limit} chars · ${tags} hashtags`)
  return { formatCheck: { ok: true, notes }, mode: platformAdapter().mode, history: [`Format validated for ${p.platform} (${p.content.length} chars, ${tags} hashtags)`] }
})

registerSkill<PublishPayload>('publishing.media.upload', async (p, ctx) => {
  if (!p.mediaDataUri) return { mediaId: null }
  const id = await platformAdapter().upload(p.platform, p.mediaDataUri)
  ctx.log(`Media uploaded (${p.mode}) · ${id}`)
  return { mediaId: id, history: [...p.history, `Media uploaded · ${id}`] }
})

registerSkill<PublishPayload>('publishing.post.dispatch', async (p, ctx) => {
  const retries = ctx.num('retries')
  let lastErr: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      const id = await platformAdapter().dispatch(p.platform, p.content, p.mediaId)
      ctx.log(`Dispatched (${p.mode}) · ${id}`)
      return { externalId: id, history: [...p.history, `Dispatched to ${p.platform} in ${p.mode} mode · ${id}`] }
    } catch (err) { lastErr = err }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
})

registerSkill<PublishPayload>('publishing.receipt.record', async (p, ctx) => {
  const row = await one<{ id: string }>(
    `INSERT INTO posts (workspace_id, idea_id, title, platform, content, status, external_id, publish_mode, published_at, history, media_asset_id, format)
     VALUES ($1, $2, $3, $4, $5, 'published', $6, $7, CURRENT_DATE, $8, $9, $10) RETURNING id`,
    [ctx.workspaceId, p.idea.id, p.idea.title, p.platform, p.content, p.externalId, p.mode, JSON.stringify([...p.history, `Receipt recorded · ${new Date().toISOString()}`]), p.mediaAssetId ?? null, p.idea.analysis.format ?? null],
  )
  const postId = row?.id ?? ''
  if (ctx.bool('seedFirstHour') && p.mode === 'demo') {
    const base = 400 + (rnd(postId) % 900)
    await query('INSERT INTO post_metrics (post_id, reach, impressions, likes, comments, shares, engagement_rate) VALUES ($1, $2, $3, $4, $5, $6, $7)', [postId, base, Math.round(base * 1.6), Math.round(base * 0.06), Math.round(base * 0.012), Math.round(base * 0.008), Math.round(((base * 0.08) / (base * 1.6)) * 10000) / 100])
  }
  await query('INSERT INTO lineage_edges (workspace_id, from_type, from_id, to_type, to_id, agent_id) VALUES ($1, $2, $3, $4, $5, $6)', [ctx.workspaceId, 'content_idea', p.idea.id, 'post', postId, 'publishing'])
  ctx.emit('post.published', `${p.idea.title} → ${p.platform} (${p.mode})`, { postId, ideaId: p.idea.id, platform: p.platform, externalId: p.externalId, mode: p.mode })
  ctx.log(`Receipt ${postId} recorded in ${p.mode} mode`)
  return { postId, outputCount: 1, completionNote: `Published to ${p.platform} (${p.mode})` }
})

// ── ANALYTICS AGENT ───────────────────────────────────────────────────────
export interface Metrics { reach: number | null; impressions: number | null; likes: number | null; comments: number | null; shares: number | null; engagementRate: number | null; capturedAt?: string }
export type MetricKey = 'reach' | 'impressions' | 'likes' | 'comments' | 'shares' | 'engagementRate'
const METRIC_KEYS: MetricKey[] = ['reach', 'impressions', 'likes', 'comments', 'shares', 'engagementRate']

export interface PostRecord { id: string; title: string; platform: Platform; publishedAt: string; format: string | null; time?: string; metrics: Metrics | null }

export interface AnalyticsPayload extends Record<string, unknown> {
  postId: string
  post: PostRecord
  posts: PostRecord[]
  metrics: Metrics | null
  baseline: Partial<Record<MetricKey, { mean: number; sd: number; n: number }>>
  comparison: Partial<Record<MetricKey, { value: number; baseline: number; deltaPct: number; strong: boolean }>>
  anomalies: string[]
  timingInsight: string
  formatInsight: string
  summary: string
  recommendation: string
  outputCount?: number
  completionNote?: string
}

const mapMetrics = (r: Record<string, unknown> | null): Metrics | null => r ? { reach: r.reach as number, impressions: r.impressions as number, likes: r.likes as number, comments: r.comments as number, shares: r.shares as number, engagementRate: r.engagement_rate as number, capturedAt: r.captured_at instanceof Date ? r.captured_at.toISOString() : undefined } : null

registerSkill<AnalyticsPayload>('analytics.metrics.ingest', async (p, ctx) => {
  const row = await one('SELECT * FROM post_metrics WHERE post_id = $1 ORDER BY captured_at DESC LIMIT 1', [p.postId])
  const metrics = mapMetrics(row)
  ctx.log(metrics ? `Latest pull at ${metrics.capturedAt}` : 'No metrics reported yet')
  return { metrics }
})

registerSkill<AnalyticsPayload>('analytics.baseline.compute', async (p, ctx) => {
  const n = ctx.num('trailingPosts')
  const rows = await query(
    `SELECT p.id, p.title, p.platform, p.published_at, p.format, m.* FROM posts p
     LEFT JOIN LATERAL (SELECT * FROM post_metrics WHERE post_id = p.id ORDER BY captured_at DESC LIMIT 1) m ON true
     WHERE p.workspace_id = $1 AND p.platform = $2 AND p.id <> $3 AND p.status = 'published' ORDER BY p.published_at DESC, p.created_at DESC LIMIT $4`,
    [ctx.workspaceId, p.post.platform, p.postId, n],
  )
  const posts: PostRecord[] = rows.map((r) => ({ id: String(r.id), title: String(r.title), platform: r.platform as Platform, publishedAt: String(r.published_at), format: (r.format as string) ?? null, metrics: mapMetrics(r.reach === undefined ? null : r) }))
  const baseline: AnalyticsPayload['baseline'] = {}
  for (const k of METRIC_KEYS) {
    const vals = posts.map((x) => x.metrics?.[k]).filter((v): v is number => typeof v === 'number') // unreported → excluded, never zero
    if (!vals.length) continue
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length)
    baseline[k] = { mean, sd, n: vals.length }
  }
  ctx.log(`Baseline from ${posts.length} trailing ${p.post.platform} posts`)
  return { posts, baseline }
})

registerSkill<AnalyticsPayload>('analytics.performance.compare', (p, ctx) => {
  const strong = ctx.num('strongThreshold')
  const comparison: AnalyticsPayload['comparison'] = {}
  for (const k of METRIC_KEYS) {
    const v = p.metrics?.[k]
    const b = p.baseline[k]
    if (typeof v !== 'number' || !b || b.mean === 0) continue
    const deltaPct = Math.round(((v - b.mean) / b.mean) * 100)
    comparison[k] = { value: v, baseline: Math.round(b.mean * 100) / 100, deltaPct, strong: deltaPct >= strong }
  }
  ctx.log(`${Object.keys(comparison).length} metrics compared to this account's baseline`)
  return { comparison }
})

registerSkill<AnalyticsPayload>('analytics.anomaly.detect', (p, ctx) => {
  const sigma = ctx.num('sigma')
  const anomalies: string[] = []
  for (const k of METRIC_KEYS) {
    const v = p.metrics?.[k]; const b = p.baseline[k]
    if (typeof v !== 'number' || !b || b.sd === 0) continue
    const z = (v - b.mean) / b.sd
    if (Math.abs(z) >= sigma) anomalies.push(`${k} is ${z > 0 ? 'above' : 'below'} the baseline by ${Math.abs(z).toFixed(1)}σ`)
  }
  ctx.log(anomalies.length ? anomalies.join('; ') : 'No anomalies')
  return { anomalies }
})

registerSkill<AnalyticsPayload>('analytics.timing.analyze', (p, ctx) => {
  const min = ctx.num('minSamples')
  const byDay = new Map<number, number[]>()
  for (const x of p.posts) { const d = new Date(x.publishedAt).getDay(); if (typeof x.metrics?.engagementRate === 'number') byDay.set(d, [...(byDay.get(d) ?? []), x.metrics.engagementRate]) }
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const ranked = Array.from(byDay.entries()).filter(([, v]) => v.length >= min).map(([d, v]) => ({ d, avg: v.reduce((a, b) => a + b, 0) / v.length, n: v.length })).sort((a, b) => b.avg - a.avg)
  const insight = ranked.length ? `${days[ranked[0].d]} posts average ${ranked[0].avg.toFixed(1)}% engagement across ${ranked[0].n} posts — the strongest day in the trailing window.` : `Not enough posts per weekday (min ${min}) to state a timing insight.`
  return { timingInsight: insight }
})

registerSkill<AnalyticsPayload>('analytics.format.analyze', (p, ctx) => {
  const min = ctx.num('minSamples')
  const byFmt = new Map<string, number[]>()
  for (const x of p.posts) if (x.format && typeof x.metrics?.engagementRate === 'number') byFmt.set(x.format, [...(byFmt.get(x.format) ?? []), x.metrics.engagementRate])
  const ranked = Array.from(byFmt.entries()).filter(([, v]) => v.length >= min).map(([f, v]) => ({ f, avg: v.reduce((a, b) => a + b, 0) / v.length, n: v.length })).sort((a, b) => b.avg - a.avg)
  const insight = ranked.length ? `${ranked[0].f} averages ${ranked[0].avg.toFixed(1)}% engagement over ${ranked[0].n} posts, the best-performing format on ${p.post.platform}.` : `Not enough posts per format (min ${min}) to state a format insight.`
  return { formatInsight: insight }
})

registerSkill<AnalyticsPayload>('analytics.insight.explain', (p, ctx) => {
  const max = ctx.num('maxSentences')
  const c = p.comparison
  const s: string[] = []
  if (!p.metrics) s.push('No metrics have been reported for this post yet, so nothing is compared — unreported is not zero.')
  else if (c.engagementRate) s.push(`Engagement rate ${c.engagementRate.value}% is ${c.engagementRate.deltaPct >= 0 ? 'up' : 'down'} ${Math.abs(c.engagementRate.deltaPct)}% against this account's trailing ${p.baseline.engagementRate?.n}-post baseline of ${c.engagementRate.baseline}%.`)
  else s.push(`First reported pull: reach ${p.metrics.reach ?? '—'}, ${p.metrics.likes ?? '—'} likes, ${p.metrics.comments ?? '—'} comments; no baseline yet on ${p.post.platform}.`)
  if (c.reach) s.push(`Reach ${c.reach.value.toLocaleString()} sits ${Math.abs(c.reach.deltaPct)}% ${c.reach.deltaPct >= 0 ? 'above' : 'below'} baseline${c.reach.strong ? ' — a strong result' : ''}.`)
  if (p.anomalies.length) s.push(`Anomaly: ${p.anomalies[0]}.`)
  else s.push(p.timingInsight)
  const summary = s.slice(0, max).join(' ')
  ctx.log('Summary written')
  return { summary }
})

registerSkill<AnalyticsPayload>('analytics.recommendation.write', (p, ctx) => {
  const focus = ctx.str('focus')
  const c = p.comparison
  let rec: string
  if (focus === 'Timing' || (focus === 'Auto' && !c.engagementRate)) rec = `Next post: ${p.timingInsight.replace(/\.$/, '')}; schedule the next ${p.post.platform} post there.`
  else if (focus === 'Format' || (focus === 'Auto' && c.engagementRate && c.engagementRate.deltaPct < 0)) rec = `${p.formatInsight.replace(/\.$/, '')}; try that format for the next post on this topic.`
  else rec = c.engagementRate && c.engagementRate.deltaPct >= 0 ? `Repeat the angle: this topic outperformed the baseline — write the follow-up while the thread is warm, same format (${p.post.format ?? 'Thought Leadership'}).` : `Change the hook before the topic: the evidence held but the opening did not earn the click — try the Contrast hook pattern.`
  return { recommendation: rec, outputCount: 1, completionNote: `Analysed "${p.post.title.slice(0, 40)}"` }
})
