// Learning Agent skills — stage `learn`. Turns outcomes and human edits into durable knowledge.
import { query, one } from '../../db/pool'
import { registerSkill } from '../runtime'
import type { AnalyticsPayload } from './ship'

export interface Pattern { key: string; label: string; count: number; content: string; category: string }
export interface Attribution { choice: string; lift: number; content: string }

export interface LearningPayload extends Record<string, unknown> {
  analysis?: AnalyticsPayload
  decision?: { kind: 'approved' | 'rejected'; title: string; reason?: string; by: string; sourceTopic: string; platform: string }
  patterns: Pattern[]
  attributions: Attribution[]
  written: number
  adjusted: string[]
  outputCount?: number
  completionNote?: string
}

const PATTERNS: Array<[RegExp, string, string, string]> = [
  [/\b(shorter|shorten|tighten|concise)\b/i, 'shorter', 'Marketing shortens drafts', 'Generated drafts are shortened by Marketing. Default to fewer paragraphs: hook, problem, one mechanism paragraph, close.'],
  [/\b(technical|deeper|rigorous)\b/i, 'technical', 'Marketing asks for more technical detail', 'Include the measurement condition and a named source in the mechanism stage by default.'],
  [/\b(simpler|plain|less jargon)\b/i, 'simpler', 'Marketing asks for plainer language', 'Avoid stage labels and expand acronyms on first use.'],
  [/\bquestion\b/i, 'question', 'Close on a question', 'Captions that end on a question are preferred.'],
  [/\b(formal|professional)\b/i, 'formal', 'Formal register on LinkedIn', 'Expand contractions; keep the register formal.'],
  [/\b(cta|call to action)\b/i, 'cta', 'Research-style call to action', 'Close with an invitation to compare notes, never a sales call to action.'],
]

registerSkill<LearningPayload>('learning.edit.pattern', async (_p, ctx) => {
  const min = ctx.num('minRepeats')
  const rows = await query<{ feedback: Array<{ instruction: string }> }>('SELECT feedback FROM content_ideas WHERE workspace_id = $1 AND jsonb_array_length(feedback) > 0', [ctx.workspaceId])
  const counts = new Map<string, number>()
  for (const r of rows) for (const f of r.feedback ?? []) for (const [re, key] of PATTERNS) if (re.test(f.instruction)) counts.set(key, (counts.get(key) ?? 0) + 1)
  const patterns: Pattern[] = PATTERNS.filter(([, key]) => (counts.get(key) ?? 0) >= min).map(([, key, label, content]) => ({ key, label, count: counts.get(key) ?? 0, content, category: 'User Feedback' }))
  ctx.log(`${patterns.length} edit pattern(s) at or above ${min} repeats`)
  return { patterns }
})

registerSkill<LearningPayload>('learning.outcome.attribute', (p, ctx) => {
  const minLift = ctx.num('minLift')
  const attributions: Attribution[] = []
  const a = p.analysis
  if (a?.comparison?.engagementRate) {
    const lift = a.comparison.engagementRate.deltaPct
    const post = a.post
    const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(post.publishedAt).getDay()]
    if (Math.abs(lift) >= minLift) {
      attributions.push({ choice: `format:${post.format ?? 'unknown'}`, lift, content: `${post.format ?? 'This format'} on ${post.platform} ran ${lift >= 0 ? '+' : ''}${lift}% against the account baseline ("${post.title}").` })
      attributions.push({ choice: `day:${day}`, lift, content: `Posting on ${day} on ${post.platform} ran ${lift >= 0 ? '+' : ''}${lift}% against baseline.` })
    }
  }
  ctx.log(`${attributions.length} attribution(s) at |lift| ≥ ${minLift}%`)
  return { attributions }
})

registerSkill<LearningPayload>('learning.knowledge.write', async (p, ctx) => {
  const conf = ctx.str('defaultConfidence')
  let written = 0
  const upsert = async (title: string, category: string, content: string, tags: string[], positive: boolean) => {
    const existing = await one<{ id: string }>('SELECT id FROM knowledge_entries WHERE workspace_id = $1 AND title = $2', [ctx.workspaceId, title])
    if (existing) {
      await query(`UPDATE knowledge_entries SET evidence_count = evidence_count + 1, ${positive ? 'confirmations = confirmations + 1' : 'contradictions = contradictions + 1'} WHERE id = $1`, [existing.id])
      return
    }
    await query('INSERT INTO knowledge_entries (workspace_id, title, category, content, source, tags, confidence, origin) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [ctx.workspaceId, title, category, content, 'Learning Agent', tags, conf, 'learned'])
    ctx.emit('knowledge.written', title, { category })
    written++
  }
  for (const pat of p.patterns) await upsert(pat.label, pat.category, `${pat.content} (seen ${pat.count}×)`, ['preference', pat.key], true)
  for (const at of p.attributions) {
    const [kind, value] = at.choice.split(':')
    await upsert(`${kind === 'format' ? value : `${value} posts`} ${at.lift >= 0 ? 'outperform' : 'underperform'} on ${p.analysis?.post.platform}`, 'High Performer', at.content, [kind, value.toLowerCase(), p.analysis?.post.platform ?? ''], at.lift >= 0)
  }
  if (p.decision) {
    const d = p.decision
    await upsert(`${d.kind === 'approved' ? 'Approved' : 'Rejected'}: ${d.title}`, d.kind === 'approved' ? 'Approved Post' : 'Rejected Post', d.kind === 'approved' ? `Leadership (${d.by}) approved "${d.title}" on ${d.platform} for ${d.sourceTopic}. Angle and evidence pattern are safe to repeat.` : `Leadership (${d.by}) rejected "${d.title}" on ${d.platform} for ${d.sourceTopic}. Reason: ${d.reason}. Avoid repeating this pattern for ${d.sourceTopic}.`, [d.kind, d.sourceTopic], d.kind === 'approved')
  }
  ctx.log(`${written} knowledge entries written`)
  return { written, outputCount: written }
})

registerSkill<LearningPayload>('learning.confidence.adjust', async (p, ctx) => {
  const promoteAfter = ctx.num('promoteAfter')
  const demoteAfter = ctx.num('demoteAfter')
  const adjusted: string[] = []
  // Contradictions: a learned claim about this format/day that the outcome went against.
  if (p.analysis?.comparison?.engagementRate) {
    const lift = p.analysis.comparison.engagementRate.deltaPct
    const post = p.analysis.post
    const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(post.publishedAt).getDay()]
    const related = await query<{ id: string; title: string; tags: string[] }>('SELECT id, title, tags FROM knowledge_entries WHERE workspace_id = $1 AND origin = \'learned\' AND category = \'High Performer\' AND tags && $2::text[]', [ctx.workspaceId, [(post.format ?? '').toLowerCase(), day].filter(Boolean)])
    for (const r of related) {
      const claimsOutperform = /outperform/i.test(r.title)
      const agrees = (claimsOutperform && lift >= 0) || (!claimsOutperform && lift < 0)
      await query(`UPDATE knowledge_entries SET ${agrees ? 'confirmations = confirmations + 1' : 'contradictions = contradictions + 1'} WHERE id = $1`, [r.id])
    }
  }
  const rows = await query<{ id: string; title: string; confidence: string; confirmations: number; contradictions: number }>('SELECT id, title, confidence, confirmations, contradictions FROM knowledge_entries WHERE workspace_id = $1 AND origin = \'learned\'', [ctx.workspaceId])
  const ladder = ['Low', 'Medium', 'High']
  for (const r of rows) {
    const idx = ladder.indexOf(r.confidence)
    if (r.confirmations >= promoteAfter && idx < 2) {
      await query('UPDATE knowledge_entries SET confidence = $2, confirmations = 0 WHERE id = $1', [r.id, ladder[idx + 1]])
      adjusted.push(`↑ ${r.title} → ${ladder[idx + 1]}`)
    } else if (r.contradictions >= demoteAfter && idx > 0) {
      await query('UPDATE knowledge_entries SET confidence = $2, contradictions = 0 WHERE id = $1', [r.id, ladder[idx - 1]])
      adjusted.push(`↓ ${r.title} → ${ladder[idx - 1]}`)
    }
  }
  ctx.log(adjusted.length ? adjusted.join('; ') : 'No confidence changes')
  return { adjusted, completionNote: `${p.written} learned · ${adjusted.length} confidence change(s)` }
})
