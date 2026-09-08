// Caption Creator Agent + Review Agent skills — stage `create`.
import { BRAND, BRAND_RULES, checkBrandCompliance, deriveHashtags, enforceBrandVoice, numericClaims, type BrandCheck, type Platform } from '../../../../shared/brand-voice'
import { gcpText } from '../../integrations/gcp-llm'
import { query } from '../../db/pool'
import { registerSkill } from '../runtime'
import { groundingFromRetrieval, hybridRetrieve, type RetrievedChunk } from '../retrieval'
import { retrieveKnowledge, type KnowledgeRow } from './research'

export interface IdeaRecord {
  id: string
  title: string
  description: string
  sourceTopic: string
  hashtagDisplay?: string
  platform: Platform
  analysis: { format?: string; angle?: string; audience?: string; brandRelevance?: number; trendScore?: number; keyword?: string }
  feedback: Array<{ instruction: string; at: string }>
}

export interface CaptionParts {
  hook: string
  problem: string
  explanation: string
  close: string
  hashtags: string[]
}

export interface CaptionPayload extends Record<string, unknown> {
  idea: IdeaRecord
  platform: Platform
  writer: 'gemini' | 'template'
  source: 'live' | 'fixture'
  model: string
  fallbackReason?: string
  knowledge: KnowledgeRow[]
  grounding: string
  knowledgeGrounded: boolean
  hook: string
  problem: string
  explanation: string
  close: string
  hashtags: string[]
  caption: string
  variants: string[]
  voiceChanges: string[]
  /** Hybrid-retrieval hits behind the grounding, kept so callers can report what grounded the caption. */
  retrievedChunks?: RetrievedChunk[]
  outputCount?: number
  completionNote?: string
}

const firstSentence = (s: string) => (s.split(/(?<=[.!?])\s+/)[0] ?? s).trim()
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)
const capWords = (s: string, n: number) => (words(s).length <= n ? s : words(s).slice(0, n).join(' ').replace(/[,;:]$/, '') + '.')

export function writeHook(idea: IdeaRecord, pattern: string, knowledge: KnowledgeRow[]): string {
  const topic = idea.sourceTopic
  const title = idea.title.replace(/[.]+$/, '')
  const claim = knowledge.map((k) => numericClaims(k.content)[0]).find(Boolean)
  switch (pattern) {
    case 'Contrast': return capWords(`Most teams treat ${topic} as a modelling problem. The evidence says it is a measurement problem.`, BRAND.hookMaxWords)
    case 'Question': return capWords(`What actually changes when ${title.charAt(0).toLowerCase() + title.slice(1)}?`, BRAND.hookMaxWords)
    case 'Number': return claim ? capWords(`${claim} is the number to know about ${topic} this week.`, BRAND.hookMaxWords) : capWords(`${title}.`, BRAND.hookMaxWords)
    default: return capWords(`${title}.`, BRAND.hookMaxWords)
  }
}

export function writeProblem(idea: IdeaRecord, maxSentences: number): string {
  const topic = idea.sourceTopic
  const format = idea.analysis.format ?? 'Thought Leadership'
  const s = [
    `Across the field, ${topic} is where post-training budgets and attention are moving this quarter.`,
    `The problem: results are shared without the mechanism that produced them, so teams copy the outcome and miss the cause.`,
    `That is a ${format.toLowerCase()} worth writing carefully.`,
  ]
  return s.slice(0, Math.max(1, maxSentences)).join(' ')
}

export function writeExplanation(idea: IdeaRecord, knowledge: KnowledgeRow[], cite: boolean): string {
  const topic = idea.sourceTopic
  const research = knowledge.filter((k) => k.origin === 'research' && k.sources.length)
  const lead = research[0] ?? knowledge.find((k) => k.origin !== 'brand')
  const reframe = `Reframe: treat ${topic} as a loop — environment, reward, evaluation — not a single training trick.`
  const mechanism = lead ? `Mechanism: ${firstSentence(lead.content)}` : `Mechanism: the signal that survives is the one that can be verified against a fixed suite before and after every change.`
  const evidence = lead && cite && lead.sources.length
    ? `Evidence: ${lead.sources.slice(0, 2).map((s) => `${s.title} (${s.domain ?? new URL(s.url).hostname})`).join('; ')} report the same direction independently.`
    : lead ? `Evidence: ${lead.title.toLowerCase()} — the cited work agrees on direction, if not on magnitude.` : `Evidence: measured on a fixed internal suite, not a public leaderboard.`
  const implication = `Implication: the teams that will get the most from ${topic} are the ones measuring it weekly, against their own baseline, before scaling anything.`
  return [reframe, mechanism, evidence, implication].join('\n\n')
}

export function writeClose(idea: IdeaRecord, style: string): string {
  const topic = idea.sourceTopic
  const ethara = `At ${BRAND.name} this is the loop we run as a service: environments, reward models and evaluations built to be reproduced, with the numbers attached.`
  const closing = style === 'Observation' ? `The interesting work in ${topic} is now in the measurement, not the announcement.` : `How are you measuring ${topic} against your own baseline?`
  return `${ethara}\n\n${closing}`
}

export function assembleCaption(parts: CaptionParts, platform: Platform, limits: { xMaxChars: number; instagramMaxChars: number }): string {
  const tags = parts.hashtags.map((t) => `#${t}`).join(' ')
  if (platform === 'x') {
    const evidence = parts.explanation.split('\n\n').find((s) => s.startsWith('Evidence')) ?? ''
    let body = `${parts.hook}\n\n${firstSentence(evidence.replace(/^Evidence:\s*/, ''))}`
    const xTags = parts.hashtags.slice(0, 3).map((t) => `#${t}`).join(' ')
    while ((body + '\n\n' + xTags).length > limits.xMaxChars && body.includes('\n\n')) body = body.split('\n\n')[0]
    if ((body + '\n\n' + xTags).length > limits.xMaxChars) body = body.slice(0, limits.xMaxChars - xTags.length - 4).replace(/\s\S*$/, '') + '…'
    return `${body}\n\n${xTags}`
  }
  if (platform === 'instagram') {
    const stages = parts.explanation.split('\n\n').map((s) => { const t = s.replace(/^[A-Z][a-z]+:\s*/, ''); return t.charAt(0).toUpperCase() + t.slice(1) })
    let body = [parts.hook, parts.problem, ...stages, parts.close].join('\n\n')
    while (body.length > limits.instagramMaxChars && stages.length > 1) { stages.pop(); body = [parts.hook, parts.problem, ...stages, parts.close].join('\n\n') }
    return `${body}\n\n${tags}`
  }
  return `${parts.hook}\n\n${parts.problem}\n\n${parts.explanation}\n\n${parts.close}\n\n${tags}`
}

/** The deterministic template writer, shared with the seed so seeded drafts look like agent output. */
export function writeTemplateCaption(idea: IdeaRecord, platform: Platform, knowledge: KnowledgeRow[], opts?: { hookPattern?: string; closeStyle?: string; hashtagCount?: number }): { parts: CaptionParts; caption: string } {
  const parts: CaptionParts = {
    hook: writeHook(idea, opts?.hookPattern ?? 'Finding', knowledge),
    problem: writeProblem(idea, 2),
    explanation: writeExplanation(idea, knowledge, true),
    close: writeClose(idea, opts?.closeStyle ?? 'Question'),
    hashtags: deriveTags(idea, opts?.hashtagCount ?? 4),
  }
  const raw = assembleCaption(parts, platform, { xMaxChars: 280, instagramMaxChars: 1200 })
  return { parts, caption: enforceBrandVoice(raw, `${idea.sourceTopic} ${idea.title}`).text }
}

function deriveTags(idea: IdeaRecord, count: number): string[] {
  const tags = deriveHashtags(`${idea.sourceTopic} ${idea.title}`, count)
  if (idea.hashtagDisplay && !tags.some((t) => t.toLowerCase() === idea.hashtagDisplay?.toLowerCase())) tags.unshift(idea.hashtagDisplay)
  return tags.slice(0, Math.min(BRAND.hashtags.max, Math.max(BRAND.hashtags.min, count)))
}

function systemInstruction(grounding: string, hashtag?: string): string {
  return [
    `You write social posts for ${BRAND.name}, ${BRAND.positioning}`,
    `Voice: ${BRAND.voice.join(', ')}. Emoji budget: ${BRAND.emojiBudget}. Never use hype vocabulary. Never pitch. Every figure must name its source.`,
    `Structure: ${BRAND.captionStructure.join(' → ')}. Hook at most ${BRAND.hookMaxWords} words.`,
    `Rules:\n${BRAND_RULES.filter((r) => r.enforcement !== 'human').map((r) => `${r.n}. ${r.title}: ${r.text}`).join('\n')}`,
    hashtag ? `The post originates from the hashtag #${hashtag}.` : '',
    `Knowledge Base grounding (write only from this):\n${grounding || '(no entries retrieved — make no factual claims with numbers)'}`,
  ].filter(Boolean).join('\n\n')
}

registerSkill<CaptionPayload>('generation.caption.mode', (_p, ctx) => {
  const pref = ctx.str('preferredWriter')
  const live = gcpText.isConfigured()
  const writer = pref === 'Template' ? 'template' : pref === 'Gemini' ? (live ? 'gemini' : 'template') : live ? 'gemini' : 'template'
  const fallbackReason = writer === 'template' && pref !== 'Template' ? gcpText.unavailableReason() : undefined
  ctx.log(writer === 'gemini' ? 'Writer: Gemini' : `Writer: template (${fallbackReason ?? 'by preference'})`)
  return { writer, source: writer === 'gemini' ? 'live' : 'fixture', model: writer === 'gemini' ? 'gemini' : 'ethara-writer', fallbackReason }
})

registerSkill<CaptionPayload>('generation.caption.voice', async (p, ctx) => {
  const max = ctx.num('maxEntries')
  const queryText = `${p.idea.title} ${p.idea.sourceTopic} ${p.idea.hashtagDisplay ?? ''} ${p.idea.description}`
  const entries = await retrieveKnowledge(ctx.workspaceId, queryText, { maxResults: max })
  const entryGrounding = entries.map((e) => `- [${e.category} · ${e.confidence}] ${e.title}: ${e.content}${e.sources.length ? ` (sources: ${e.sources.map((s) => s.url).join(', ')})` : ''}`).join('\n')

  // Second grounding leg: hybrid retrieval over the vector store, spanning the corpus
  // folder and web research. Attributed so a claim can be traced to its source.
  let chunkGrounding = ''
  let retrieved: RetrievedChunk[] = []
  let retrievalNote = 'vector retrieval off'
  if (ctx.bool('useVectorStore')) {
    try {
      const hits = await hybridRetrieve({ workspaceId: ctx.workspaceId, query: queryText, topK: ctx.num('vectorTopK') })
      retrieved = hits.results
      chunkGrounding = groundingFromRetrieval(hits)
      const spread = Object.entries(hits.counts.bySource).map(([s, n]) => `${s}=${n}`).join(', ') || 'none'
      retrievalNote = `${hits.counts.returned} chunks [${spread}]`
      if (hits.sourcesUnpopulated.length) retrievalNote += ` · no embeddings for ${hits.sourcesUnpopulated.join(', ')}`
    } catch (err) {
      // Grounding must degrade, never break caption generation.
      retrievalNote = `vector retrieval unavailable: ${err instanceof Error ? err.message : String(err)}`
      await ctx.activity(retrievalNote, 'warn')
    }
  }

  const grounded = entries.some((e) => e.origin !== 'brand') || retrieved.length > 0
  if (!grounded && ctx.bool('requireGrounding')) await ctx.activity(`No Knowledge Base entry or vector match found for "${p.idea.sourceTopic}" — caption is ungrounded`, 'warn')
  const grounding = [entryGrounding, chunkGrounding && `Retrieved source material:\n${chunkGrounding}`].filter(Boolean).join('\n\n')
  ctx.log(
    `${entries.length} Knowledge Base entries (${entries.filter((e) => e.origin === 'brand').length} brand, ${entries.filter((e) => e.origin === 'research').length} research) · ${retrievalNote}`,
  )
  return { knowledge: entries, grounding, knowledgeGrounded: grounded, retrievedChunks: retrieved }
})

registerSkill<CaptionPayload>('generation.caption.hook', (p, ctx) => {
  const hook = writeHook(p.idea, ctx.str('hookPattern'), p.knowledge)
  ctx.log(`Hook: ${words(hook).length} words`)
  return { hook }
})

registerSkill<CaptionPayload>('generation.caption.problem', (p, ctx) => ({ problem: writeProblem(p.idea, ctx.num('maxSentences')) }))

registerSkill<CaptionPayload>('generation.caption.explanation', async (p, ctx) => {
  const cite = ctx.bool('citeEvidence')
  const fallback = writeExplanation(p.idea, p.knowledge, cite)
  if (p.writer !== 'gemini') { ctx.log('Explanation from the template writer'); return { explanation: fallback } }
  try {
    const out = await gcpText.run({
      system: systemInstruction(p.grounding, p.idea.hashtagDisplay),
      prompt: `Write the Reframe, Mechanism, Evidence and Implication stages (four short paragraphs, plain text, no headings, no hashtags, no emoji) for a ${p.platform} post.\nHook: ${p.hook}\nContext/Problem: ${p.problem}\nAngle: ${p.idea.analysis.angle ?? ''}\nAudience: ${p.idea.analysis.audience ?? ''}`,
      temperature: ctx.num('temperature') / 100,
      maxOutputTokens: ctx.num('maxOutputTokens'),
    })
    ctx.log(`Explanation from ${out.model}`)
    return { explanation: out.text, model: out.model }
  } catch (err) {
    const reason = `Gemini failed: ${err instanceof Error ? err.message : String(err)}`
    await ctx.activity(`${reason} — using the template writer`, 'warn')
    return { explanation: fallback, writer: 'template', source: 'fixture', model: 'ethara-writer', fallbackReason: reason }
  }
})

registerSkill<CaptionPayload>('generation.caption.close', (p, ctx) => ({ close: writeClose(p.idea, ctx.str('closeStyle')) }))

registerSkill<CaptionPayload>('generation.caption.hashtags', (p, ctx) => {
  const tags = deriveTags(p.idea, ctx.num('count'))
  ctx.log(`${tags.length} topic-derived hashtags`)
  return { hashtags: tags }
})

registerSkill<CaptionPayload>('generation.caption.adapt', async (p, ctx) => {
  const limits = { xMaxChars: ctx.num('xMaxChars'), instagramMaxChars: ctx.num('instagramMaxChars') }
  const parts: CaptionParts = { hook: p.hook, problem: p.problem, explanation: p.explanation, close: p.close, hashtags: p.hashtags.length ? p.hashtags : deriveTags(p.idea, 4) }
  let raw = assembleCaption(parts, p.platform, limits)
  if (p.writer === 'gemini' && p.platform !== 'linkedin') {
    try {
      const out = await gcpText.run({ system: systemInstruction(p.grounding, p.idea.hashtagDisplay), prompt: `Adapt this post for ${p.platform} (${p.platform === 'x' ? `max ${limits.xMaxChars} characters` : `max ${limits.instagramMaxChars} characters, short lines`}). Keep the hashtags exactly. Plain text only.\n\n${raw}`, fast: true, temperature: 0.3 })
      raw = out.text
    } catch (err) {
      await ctx.activity(`Gemini adapt failed (${err instanceof Error ? err.message : String(err)}) — template adaptation kept`, 'warn')
    }
  }
  // Brand voice enforcement is unconditional and final.
  const enforced = enforceBrandVoice(raw, `${p.idea.sourceTopic} ${p.idea.title}`)
  ctx.log(`${enforced.text.length} chars for ${p.platform}${enforced.changes.length ? ` · ${enforced.changes.length} voice fix(es)` : ''}`)
  return { caption: enforced.text, voiceChanges: enforced.changes, outputCount: 1, completionNote: `Draft written for ${p.platform}` }
})

registerSkill<CaptionPayload>('generation.caption.variants', (p, ctx) => {
  const n = ctx.num('variantCount')
  const patterns = ['Contrast', 'Question', 'Number', 'Finding'].filter((x) => x !== ctx.str('hookPattern'))
  return { variants: patterns.slice(0, n).map((pat) => writeHook(p.idea, pat, p.knowledge)) }
})

registerSkill<CaptionPayload>('generation.caption.sourceLink', (p, ctx) => {
  if (ctx.bool('linkedinOnly') && p.platform !== 'linkedin') return
  const src = p.knowledge.flatMap((k) => k.sources)[0]
  if (!src) return
  const body = p.caption.replace(/\n\n(#[^\n]+)$/, `\n\nSource: ${src.url}\n\n$1`)
  return { caption: enforceBrandVoice(body, p.idea.sourceTopic).text }
})

// ── REVIEW AGENT ──────────────────────────────────────────────────────────
export interface Preference {
  title: string
  content: string
  category: string
  tags: string[]
}

export interface ReviewPayload extends Record<string, unknown> {
  idea: IdeaRecord
  platform: Platform
  draft: string
  instruction: string
  hasMedia: boolean
  mediaHeadline?: string
  altText?: string
  recentCaptions: string[]
  before: string
  after: string
  note: string
  conflicts: number[]
  compliance: BrandCheck
  preference?: Preference
  preferenceSaved: boolean
  diffSummary: string
  /** Which editor applied the instruction, and the model behind it. */
  writer: 'gemini' | 'rules'
  model: string
  /** Why the rules engine was used when Gemini was asked for. */
  fallbackReason?: string
  outputCount?: number
  completionNote?: string
}

const CONFLICT_PATTERNS: Array<[RegExp, number]> = [
  [/emoji|🚀|✨/i, 3],
  [/more (exciting|hype|buzz|punchy|salesy)|excited to announce|game[- ]chang/i, 2],
  [/book a demo|sign ?up|free trial|pricing|contact sales|buy/i, 11],
  [/more hashtags|add (six|6|seven|7|8|eight|ten|10) hashtags/i, 5],
  [/compare (us|ethara) (to|with|against)|better than (openai|anthropic|google)/i, 8],
]

export function applyInstruction(draft: string, instruction: string, idea: IdeaRecord): { text: string; note: string } {
  const ins = instruction.trim()
  const lower = ins.toLowerCase()
  const tagMatch = draft.match(/\n\n(#[^\n]+)$/)
  const tags = tagMatch ? tagMatch[1] : ''
  const body = tagMatch ? draft.slice(0, tagMatch.index) : draft
  const paras = body.split(/\n\s*\n/).filter((s) => s.trim())
  const rebuild = (ps: string[]) => `${ps.join('\n\n')}${tags ? `\n\n${tags}` : ''}`
  let m: RegExpMatchArray | null

  // Matched against `ins`, not `lower`, so the replacement keeps the casing the human typed.
  if ((m = ins.match(/replace\s+"([^"]+)"\s+with\s+"([^"]+)"/i))) {
    const re = new RegExp(m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const out = draft.replace(re, m[2])
    // Report a miss instead of claiming a replacement that never happened.
    if (out === draft) return { text: draft, note: `Could not find "${m[1]}" to replace — draft unchanged.` }
    return { text: out, note: `Replaced "${m[1]}" with "${m[2]}".` }
  }
  if ((m = ins.match(/remove\s+(?:the\s+)?(?:word|phrase|sentence|line)?\s*"?([^"]+?)"?\s*$/i))) {
    const needle = m[1].trim()
    const re = new RegExp(`[^.\\n]*${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.\\n]*[.?!]?\\s*`, 'i')
    const out = draft.replace(re, '')
    return { text: out === draft ? draft : out.replace(/\n{3,}/g, '\n\n'), note: out === draft ? `Could not find "${needle}" to remove — draft unchanged.` : `Removed the sentence containing "${needle}".` }
  }
  // Also case-preserving: #PostTraining must not land as #posttraining next to #RLHF.
  if ((m = ins.match(/add (?:the )?hashtag #?(\w+)/i))) {
    const t = `#${m[1]}`
    if (new RegExp(`${t}\\b`, 'i').test(tags)) return { text: draft, note: `${t} is already in the hashtag block — draft unchanged.` }
    return { text: `${body.trimEnd()}\n\n${tags ? `${tags} ${t}` : t}`, note: `Added ${t} to the hashtag block as instructed.` }
  }
  if (/\b(shorter|shorten|tighten|concise|cut it down|trim)\b/.test(lower)) {
    const kept = paras.length > 3 ? [paras[0], paras[1], paras[paras.length - 1]] : paras
    return { text: rebuild(kept), note: `Shortened from ${paras.length} to ${kept.length} paragraphs, keeping the hook, the problem and the close.` }
  }
  if (/\b(longer|expand|elaborate|more detail|flesh out)\b/.test(lower)) {
    const extra = `In more detail: ${idea.description.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ')}`
    return { text: rebuild([...paras.slice(0, -1), extra, paras[paras.length - 1]]), note: 'Expanded the mechanism with a paragraph drawn from the idea analysis.' }
  }
  if (/\b(technical|deeper|rigorous)\b/.test(lower)) {
    const extra = `Concretely: the comparison holds only against a fixed evaluation suite with the same seeds before and after the change; without that, the delta is noise.`
    return { text: rebuild([...paras.slice(0, -1), extra, paras[paras.length - 1]]), note: 'Made the argument more technical with a concrete measurement condition.' }
  }
  if (/\b(simpler|plain|less jargon|accessible|casual)\b/.test(lower)) {
    const simplified = paras.map((p) => p.replace(/^(Reframe|Mechanism|Evidence|Implication):\s*/i, '').replace(/\bpolicy optimisation\b/gi, 'training').replace(/\bpost-training\b/gi, 'the training that happens after pretraining'))
    return { text: rebuild(simplified), note: 'Simplified the language and removed the stage labels.' }
  }
  if (/\b(formal|professional)\b/.test(lower)) {
    return { text: draft.replace(/\bdon't\b/g, 'do not').replace(/\bit's\b/g, 'it is').replace(/\bwe're\b/g, 'we are').replace(/\bcan't\b/g, 'cannot'), note: 'Expanded contractions for a more formal register.' }
  }
  if (/\b(question)\b/.test(lower)) {
    return { text: rebuild([...paras, `What would change in your pipeline if this held for ${idea.sourceTopic}?`]), note: 'Closed on a question.' }
  }
  if (/\b(cta|call to action|invite|ask (them|readers))\b/.test(lower)) {
    return { text: rebuild([...paras, `If you are measuring ${idea.sourceTopic} against your own baseline, we would like to compare notes.`]), note: 'Added a research-style call to action (an invitation to compare notes, not a pitch).' }
  }
  if (/emoji/.test(lower)) {
    return { text: `🚀 ${draft}`, note: 'Added an emoji as instructed. This conflicts with Rule 3 (zero emoji) — the finding is raised alongside, not resolved.' }
  }
  if (/\b(improve|better|polish|stronger)\b/.test(lower)) {
    const polished = paras.map((p) => p.replace(/\b(very|really|just|quite|actually)\s+/gi, '')).map((p, i) => (i === 0 ? capWords(p, BRAND.hookMaxWords) : p))
    return { text: rebuild(polished), note: 'Removed filler words and kept the hook inside the 18-word limit.' }
  }
  if ((m = ins.match(/(?:start|open|lead) with\s+"?([^"]+)"?$/i)) || (m = ins.match(/(?:change|rewrite|new) (?:the )?hook(?: to)?:?\s+"?([^"]+)"?$/i))) {
    return { text: rebuild([capWords(m[1].trim().replace(/[.]?$/, '.'), BRAND.hookMaxWords), ...paras.slice(1)]), note: 'Rewrote the hook as instructed.' }
  }
  if ((m = ins.match(/(?:mention|include|add|reference)\s+(?:a\s+)?(?:line|sentence|note|point)?\s*(?:about|on|that)?\s+(.+)$/i))) {
    return { text: rebuild([...paras.slice(0, -1), `On ${m[1].trim().replace(/[.]$/, '')}: this is part of the same loop — measured the same way, against the same baseline.`, paras[paras.length - 1]]), note: `Added a sentence on ${m[1].trim()}.` }
  }
  // Default: weave the instruction into the implication as an editorial line.
  return { text: rebuild([...paras.slice(0, -1), ins.replace(/[.]?$/, '.'), paras[paras.length - 1]]), note: 'Applied the instruction as an added line before the close.' }
}

/**
 * System instruction for the editing model. It carries the same brand rules the Caption Agent
 * writes under, plus the one rule specific to editing: change what was asked and nothing else.
 * Conflicting instructions are still obeyed — `humanWins` decides that upstream, and the
 * compliance check raises the finding afterwards, so the model must not quietly refuse.
 */
function reviewSystemInstruction(idea: IdeaRecord, platform: Platform): string {
  return [
    `You edit published-quality social posts for ${BRAND.name}, ${BRAND.positioning}`,
    `Voice: ${BRAND.voice.join(', ')}. Emoji budget: ${BRAND.emojiBudget}. Never use hype vocabulary. Never pitch. Every figure must name its source.`,
    `Structure: ${BRAND.captionStructure.join(' → ')}. Hook at most ${BRAND.hookMaxWords} words.`,
    `Rules:\n${BRAND_RULES.filter((r) => r.enforcement !== 'human').map((r) => `${r.n}. ${r.title}: ${r.text}`).join('\n')}`,
    `The post is about ${idea.sourceTopic || idea.title}${idea.hashtagDisplay ? ` and originates from the hashtag #${idea.hashtagDisplay}` : ''}. Platform: ${platform} (at most ${BRAND.platformLimits[platform]} characters).`,
    'You are given an existing post and one editing instruction from a human reviewer.',
    'Apply exactly that instruction and change nothing else. Do not restate the brief, do not add commentary, do not use markdown.',
    'Invent no new figures, names or claims — you may only keep, cut or rephrase what the post already says.',
    'The instruction always wins, even where it conflicts with a rule above: apply it rather than refusing or softening it.',
    'Reply with the complete revised post as plain text, keeping the trailing hashtag line unless the instruction is about hashtags.',
  ].join('\n\n')
}

/** Strips fences and chat scaffolding a model sometimes wraps around the caption. */
function cleanModelCaption(raw: string): string {
  return raw
    .replace(/^\s*```[a-z]*\s*/i, '')
    .replace(/```\s*$/, '')
    .replace(/^\s*(here(?:'s| is) (?:the )?(?:revised|updated|edited)[^\n:]*:?)\s*/i, '')
    .trim()
}

registerSkill<ReviewPayload>('review.instruction.apply', async (p, ctx) => {
  const humanWins = ctx.bool('humanWins')
  const conflicts = CONFLICT_PATTERNS.filter(([re]) => re.test(p.instruction)).map(([, rule]) => rule)
  const rules = () => applyInstruction(p.draft, p.instruction, p.idea)

  if (!p.instruction.trim()) return { before: p.draft, after: p.draft, note: 'No instruction given.', conflicts, writer: 'rules' as const, model: 'ethara-rules' }
  if (conflicts.length && !humanWins) {
    return { before: p.draft, after: p.draft, note: `Not applied: conflicts with rule ${conflicts.join(', ')} and humanWins is off.`, conflicts, writer: 'rules' as const, model: 'ethara-rules' }
  }

  const pref = ctx.str('editor')
  const useModel = pref === 'Gemini' || (pref === 'Auto' && gcpText.isConfigured())
  let after = ''
  let note = ''
  let writer: 'gemini' | 'rules' = 'rules'
  let model = 'ethara-rules'
  let fallbackReason: string | undefined

  if (useModel) {
    try {
      const out = await gcpText.run({
        system: reviewSystemInstruction(p.idea, p.platform),
        prompt: `Editing instruction: ${p.instruction.trim()}\n\nCurrent post:\n${p.draft}`,
        temperature: ctx.num('temperature') / 100,
        // Generous, because 2.5 Pro spends thinking tokens before the first output token and a
        // truncated candidate would silently return half a caption.
        maxOutputTokens: ctx.num('maxOutputTokens'),
      })
      const text = cleanModelCaption(out.text)
      if (text.length < 40) throw new Error(`the model returned ${text.length} characters`)
      // Guard the hashtag block: the model occasionally drops it when the edit is about prose.
      const tagBlock = p.draft.match(/\n\n(#[^\n]+)$/)?.[1]
      after = tagBlock && !text.includes('#') ? `${text.trimEnd()}\n\n${tagBlock}` : text
      const delta = after.length - p.draft.length
      note = `Applied by ${out.model}: ${delta === 0 ? 'length unchanged' : `${delta > 0 ? '+' : ''}${delta} characters`}.`
      writer = 'gemini'
      model = out.model
    } catch (err) {
      // An edit is still worth applying without the model — the rules engine is the floor.
      fallbackReason = `Gemini failed: ${err instanceof Error ? err.message : String(err)}`
      await ctx.activity(`${fallbackReason} — the rules editor applied the instruction instead`, 'warn')
      const r = rules()
      after = r.text
      note = r.note
    }
  } else {
    if (pref === 'Auto') fallbackReason = gcpText.unavailableReason()
    const r = rules()
    after = r.text
    note = r.note
  }

  if (conflicts.length) await ctx.activity(`Instruction applied despite conflicting with rule ${conflicts.join(', ')} — finding raised for review`, 'warn')
  ctx.log(`${writer === 'gemini' ? model : 'rules editor'} · ${note}`)
  return { before: p.draft, after, note, conflicts, writer, model, fallbackReason }
})

registerSkill<ReviewPayload>('review.compliance.check', (p, ctx) => {
  const attach = ctx.bool('attachCorrectedVersion')
  const text = p.after || p.draft
  const check = checkBrandCompliance({
    caption: text,
    platform: p.platform,
    topic: `${p.idea.sourceTopic} ${p.idea.title}`,
    knowledgeGrounded: true,
    recentCaptions: p.recentCaptions,
    visual: p.hasMedia ? { headline: p.mediaHeadline, hasLogo: true, hasAltText: Boolean(p.altText), textDrawnLocally: true, accentUsed: true } : undefined,
  })
  if (!attach) delete check.corrected_version
  ctx.log(`Brand check: ${check.verdict}${check.violations.length ? ` (${check.violations.length} finding(s))` : ''}`)
  return { compliance: check }
})

const PREFERENCE_PATTERNS: Array<[RegExp, (topic: string) => Preference]> = [
  [/\b(shorter|shorten|tighten|concise)\b/i, () => ({ title: 'Prefers shorter captions', content: 'Marketing repeatedly shortens generated drafts. Default to the hook, the problem and the close, with a single mechanism paragraph.', category: 'User Feedback', tags: ['length', 'preference'] })],
  [/\b(technical|deeper|rigorous)\b/i, () => ({ title: 'Prefers a more technical register', content: 'Marketing asks for more technical detail. Include the measurement condition (fixed suite, same seeds) in the mechanism stage.', category: 'User Feedback', tags: ['tone', 'preference'] })],
  [/\b(simpler|plain|less jargon|accessible)\b/i, () => ({ title: 'Prefers plainer language', content: 'Marketing asks for plainer language. Drop stage labels and expand acronyms on first use.', category: 'User Feedback', tags: ['tone', 'preference'] })],
  [/\bquestion\b/i, () => ({ title: 'Close on a question', content: 'Marketing prefers captions that close on a question to the reader.', category: 'CTA', tags: ['close', 'preference'] })],
  [/\b(cta|call to action)\b/i, () => ({ title: 'Include a research-style call to action', content: 'Add an invitation to compare notes at the close. Never a sales call to action.', category: 'CTA', tags: ['close', 'preference'] })],
  [/\b(formal|professional)\b/i, () => ({ title: 'Formal register', content: 'Marketing prefers expanded contractions and a formal register on LinkedIn.', category: 'Platform Preference', tags: ['tone', 'linkedin'] })],
  [/add (?:the )?hashtag #?(\w+)/i, (t) => ({ title: `Always include a topic hashtag for ${t}`, content: `Marketing adds a specific hashtag for ${t} content. Include it in the derived block when relevant.`, category: 'Hashtags', tags: ['hashtags'] })],
]

registerSkill<ReviewPayload>('review.preference.extract', async (p, ctx) => {
  const ask = ctx.bool('askBeforeSaving')
  const hit = PREFERENCE_PATTERNS.find(([re]) => re.test(p.instruction))
  if (!hit) return { preference: undefined, preferenceSaved: false }
  const pref = hit[1](p.idea.sourceTopic)
  if (ask) { ctx.log(`Candidate preference: ${pref.title}`); return { preference: pref, preferenceSaved: false } }
  const existing = await query<{ id: string }>('SELECT id FROM knowledge_entries WHERE workspace_id = $1 AND title = $2', [ctx.workspaceId, pref.title])
  if (existing.length) await query('UPDATE knowledge_entries SET evidence_count = evidence_count + 1, confirmations = confirmations + 1 WHERE id = $1', [existing[0].id])
  else await query('INSERT INTO knowledge_entries (workspace_id, title, category, content, source, tags, confidence, origin) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [ctx.workspaceId, pref.title, pref.category, pref.content, 'Review Agent', pref.tags, 'Medium', 'learned'])
  ctx.emit('knowledge.written', pref.title, { category: pref.category })
  return { preference: pref, preferenceSaved: true }
})

registerSkill<ReviewPayload>('review.diff.summarize', (p, ctx) => {
  const max = ctx.num('maxChars')
  const before = p.before || p.draft
  const after = p.after || p.draft
  const delta = after.length - before.length
  const firstChanged = before.split('\n')[0] !== after.split('\n')[0]
  const summary = `${delta === 0 ? 'Length unchanged' : `${delta > 0 ? '+' : ''}${delta} characters`}${firstChanged ? ', hook rewritten' : ''}. ${p.note}`.slice(0, max)
  ctx.log(summary)
  return { diffSummary: summary, outputCount: 1, completionNote: `Instruction applied · ${p.compliance?.verdict ?? 'checked'}` }
})
