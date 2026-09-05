// Brand voice constants, the 20 numbered rules and the compliance engine.
// Read by the caption/image/review agents on the server and mirrored verbatim in the UI.

export type Platform = 'linkedin' | 'instagram' | 'x'
export type BrandVerdict = 'APPROVED' | 'REVISE' | 'NEEDS_INTERNAL_APPROVAL' | 'CANNOT_VERIFY'
export type RuleEnforcement = 'automatic' | 'assisted' | 'human'
export type RuleArea = 'Voice & Positioning' | 'Factual & Content' | 'Visual' | 'Candidate & Risk'
export type CheckDimension = 'grounding' | 'voice' | 'structure' | 'platform' | 'visual' | 'captionVisual'

export const BRAND = {
  name: 'Ethara.AI',
  wordmark: { base: 'Ethara', suffix: '.AI' },
  tagline: 'Reinforcement Learning as a Service',
  positioning: 'A frontier AI research lab, not a startup pitching a product.',
  domains: [
    'Reinforcement learning',
    'RLHF and reward modeling',
    'Agentic systems',
    'Post-training and evaluation',
    'AI environments and benchmarks',
    'Synthetic data',
  ],
  voice: ['research-credible', 'anti-hype', 'confident', 'declarative', 'plain natural English'],
  emojiBudget: 0,
  hashtags: { min: 3, max: 5 },
  captionStructure: [
    'Hook',
    'Context',
    'Problem',
    'Reframe',
    'Mechanism',
    'Evidence',
    'Implication',
    'Ethara connection',
    'Closing line/question',
  ],
  hookMaxWords: 18,
  visual: {
    accent: '#8B2CF5',
    family: ['#8B2CF5', '#A855F7', '#C084FC', '#5E1BC7'],
    displayFont: 'Roboto',
    bodyFont: 'DM Sans',
  },
  similarityCap: { caption: 0.7, image: 0.85 },
  handles: { linkedin: 'Ethara AI', instagram: 'ethara.ai', x: '@ethara_ai' },
  followers: 14807,
  platformLimits: { linkedin: 3000, instagram: 2200, x: 280 } as Record<Platform, number>,
} as const

export interface ForbiddenPhrase {
  pattern: RegExp
  replacement: string
  rule: number
}

export const FORBIDDEN_LANGUAGE: ForbiddenPhrase[] = [
  { pattern: /\b(we are |we're )?(so |really |incredibly )?excited to announce\b/gi, replacement: 'We are publishing', rule: 2 },
  { pattern: /\bthrilled to (share|announce)\b/gi, replacement: 'sharing', rule: 2 },
  { pattern: /\bgame[- ]chang(ing|er)\b/gi, replacement: 'significant', rule: 2 },
  { pattern: /\brevolutioni[sz]e(s|d)?\b/gi, replacement: 'change', rule: 2 },
  { pattern: /\brevolutionary\b/gi, replacement: 'new', rule: 2 },
  { pattern: /\bcutting[- ]edge\b/gi, replacement: 'current', rule: 2 },
  { pattern: /\bstate[- ]of[- ]the[- ]art\b/gi, replacement: 'current best', rule: 2 },
  { pattern: /\bunlock(s|ing|ed)? (the )?(full )?potential\b/gi, replacement: 'improve results', rule: 2 },
  { pattern: /\bsupercharge(s|d)?\b/gi, replacement: 'improve', rule: 2 },
  { pattern: /\bnext[- ]level\b/gi, replacement: 'stronger', rule: 2 },
  { pattern: /\bworld[- ]class\b/gi, replacement: 'strong', rule: 2 },
  { pattern: /\bdisrupt(ive|ion|s|ed)?\b/gi, replacement: 'change', rule: 2 },
  { pattern: /\bleverag(e|es|ing|ed)\b/gi, replacement: 'use', rule: 2 },
  { pattern: /\bseamless(ly)?\b/gi, replacement: 'direct', rule: 2 },
  { pattern: /\b10x\b/gi, replacement: 'materially', rule: 2 },
  { pattern: /\bmagic(al)?\b/gi, replacement: 'systematic', rule: 2 },
  { pattern: /\bmind[- ]blowing\b/gi, replacement: 'notable', rule: 2 },
  { pattern: /\bat scale\b/gi, replacement: 'across many runs', rule: 2 },
]

export interface FlaggedPhrase {
  pattern: RegExp
  label: string
  rule: number
}

export const PITCH_LANGUAGE: FlaggedPhrase[] = [
  { pattern: /\bbook a (demo|call)\b/i, label: 'sales call-to-action', rule: 11 },
  { pattern: /\bsign up (now|today)\b/i, label: 'sign-up push', rule: 11 },
  { pattern: /\blimited[- ]time\b/i, label: 'urgency framing', rule: 11 },
  { pattern: /\bour platform (is|delivers|offers)\b/i, label: 'product pitch', rule: 11 },
  { pattern: /\bbest[- ]in[- ]class\b/i, label: 'superlative claim', rule: 11 },
  { pattern: /\bcontact (us|sales)\b/i, label: 'sales call-to-action', rule: 11 },
  { pattern: /\bfree trial\b/i, label: 'trial offer', rule: 11 },
  { pattern: /\bpricing\b/i, label: 'pricing talk', rule: 11 },
  { pattern: /\bdm (me|us)\b/i, label: 'DM solicitation', rule: 11 },
]

export const GENERIC_HASHTAGS: string[] = [
  'ai', 'tech', 'technology', 'innovation', 'business', 'marketing', 'growth', 'startup',
  'startups', 'entrepreneur', 'motivation', 'success', 'leadership', 'digital', 'future', 'trending',
]

export const SENSITIVE_TOPICS: FlaggedPhrase[] = [
  { pattern: /\b(raised|closed|announcing) (a |our )?(seed|series [a-e]|funding|round)\b|\bvaluation\b/i, label: 'unannounced funding', rule: 7 },
  { pattern: /\b(partner(ed|ing|ship) with|in partnership with|teamed up with)\b/i, label: 'unannounced partnership', rule: 7 },
  { pattern: /\b(our (new )?customer|client win|signed (with|a deal)|now (uses|using) ethara)\b/i, label: 'unannounced customer', rule: 7 },
  { pattern: /\b(joined us|new hire|welcome .{0,40}to the team|we hired)\b/i, label: 'unannounced hire', rule: 7 },
  { pattern: /\b(revenue|arr|mrr|run[- ]rate|internal (numbers|results))\b/i, label: 'unpublished numbers', rule: 7 },
  { pattern: /\b(lawsuit|litigation|legal action|patent infringement|regulator(y|s) (fine|action))\b/i, label: 'legal position', rule: 7 },
  { pattern: /\b(better than|outperform(s|ed)?|beats?|ahead of) (openai|anthropic|google|deepmind|meta|mistral|xai|cohere)\b/i, label: 'competitor comparison', rule: 8 },
]

export const BRAND_TOPICS: string[] = [
  'reinforcement learning', 'rl', 'rlhf', 'reward model', 'reward modeling', 'reward hacking', 'policy',
  'post-training', 'fine-tuning', 'fine tuning', 'evaluation', 'eval', 'evals', 'benchmark', 'benchmarks',
  'agent', 'agents', 'agentic', 'multi-agent', 'environment', 'environments', 'simulation', 'synthetic data',
  'alignment', 'preference', 'preferences', 'dpo', 'ppo', 'grpo', 'llm', 'language model', 'frontier model',
  'inference', 'training', 'research', 'lab', 'paper', 'ablation', 'reproducib', 'scaling', 'tool use',
  'planning', 'reasoning', 'verifier', 'verifiable', 'harness', 'sandbox', 'safety', 'robustness',
]

export interface BrandRule {
  n: number
  area: RuleArea
  title: string
  text: string
  enforcement: RuleEnforcement
}

export const BRAND_RULES: BrandRule[] = [
  { n: 1, area: 'Voice & Positioning', title: 'A research lab, not a vendor', text: 'Every post reads as a lab sharing what it learned, never as a company pitching what it sells. Ethara is mentioned as the place the work happened.', enforcement: 'human' },
  { n: 2, area: 'Voice & Positioning', title: 'No hype vocabulary', text: '"Excited to announce", "game-changing", "revolutionary", "cutting-edge", "10x" and their relatives are replaced with plain declarative language.', enforcement: 'automatic' },
  { n: 3, area: 'Voice & Positioning', title: 'Zero emoji', text: 'The emoji budget is zero on every platform. Tone comes from sentences, not glyphs.', enforcement: 'automatic' },
  { n: 4, area: 'Voice & Positioning', title: 'Declarative, plain English', text: 'Short sentences. Active voice. The hook is at most 18 words and states a finding, not a promise.', enforcement: 'assisted' },
  { n: 5, area: 'Voice & Positioning', title: 'Three to five topic hashtags', text: 'Hashtags are derived from the topic, never from reach-bait lists. Minimum three, maximum five, identical on every platform.', enforcement: 'automatic' },
  { n: 6, area: 'Factual & Content', title: 'Every number cites a source', text: 'A figure, percentage or multiplier appears only with the paper, benchmark or dataset that produced it.', enforcement: 'assisted' },
  { n: 7, area: 'Factual & Content', title: 'No unannounced company news', text: 'Funding, partnerships, customers, hires, unpublished numbers and legal positions require internal approval before they are drafted.', enforcement: 'human' },
  { n: 8, area: 'Factual & Content', title: 'No competitor comparisons', text: 'Ethara does not rank itself against named labs. Results are stated against published baselines.', enforcement: 'assisted' },
  { n: 9, area: 'Factual & Content', title: 'Nine-stage caption structure', text: 'Hook, Context, Problem, Reframe, Mechanism, Evidence, Implication, Ethara connection, Closing line. Stages may be compressed, never reordered.', enforcement: 'assisted' },
  { n: 10, area: 'Factual & Content', title: 'Grounded in the Knowledge Base', text: 'Captions are written from retrieved Knowledge Base entries. A claim with no entry behind it is a claim to verify.', enforcement: 'assisted' },
  { n: 11, area: 'Factual & Content', title: 'No pitch language', text: 'No "book a demo", "sign up", "free trial" or pricing talk. The closing line is a question or an observation.', enforcement: 'automatic' },
  { n: 12, area: 'Visual', title: 'Brand accent family only', text: 'Creatives use #8B2CF5 and its family (#A855F7, #C084FC, #5E1BC7) on dark or neutral grounds.', enforcement: 'automatic' },
  { n: 13, area: 'Visual', title: 'Text is drawn locally', text: 'Headline, kicker, footer and logomark are always drawn by the brand layer. A diffusion model is never asked to render text.', enforcement: 'automatic' },
  { n: 14, area: 'Visual', title: 'Logomark on every creative', text: 'The traced Ethara logomark appears on every image, at the same corner and scale.', enforcement: 'automatic' },
  { n: 15, area: 'Visual', title: 'Caption and visual agree', text: 'The headline on the creative restates the caption hook. The two never say different things.', enforcement: 'assisted' },
  { n: 16, area: 'Visual', title: 'Alt text on every image', text: 'Every asset ships with descriptive alt text naming the concept and the headline.', enforcement: 'automatic' },
  { n: 17, area: 'Candidate & Risk', title: 'Sensitive topics escalate', text: 'Any sensitive-topic hit forces NEEDS_INTERNAL_APPROVAL, which outranks every other verdict.', enforcement: 'automatic' },
  { n: 18, area: 'Candidate & Risk', title: 'Similarity cap', text: 'A caption above 0.70 similarity or an image above 0.85 similarity to a recent post is revised, not shipped.', enforcement: 'assisted' },
  { n: 19, area: 'Candidate & Risk', title: 'Two human approvals', text: 'Marketing approves, then Leadership approves. Nothing publishes without both. This checkpoint cannot be removed.', enforcement: 'human' },
  { n: 20, area: 'Candidate & Risk', title: 'No silent correction', text: 'The checker validates and reports. It attaches a corrected version only when every violation is mechanical, and it never rewrites a draft on its own.', enforcement: 'automatic' },
]

export const RULE_BY_N: Record<number, BrandRule> = Object.fromEntries(BRAND_RULES.map((r) => [r.n, r]))

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F900}-\u{1F9FF}]/gu
const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'be', 'as', 'at', 'by', 'it', 'its', 'this', 'that', 'from', 'we', 'our', 'you', 'your', 'not', 'but', 'so', 'if', 'than', 'then', 'how', 'what', 'why', 'when', 'into', 'about', 'over', 'more', 'less', 'very', 'has', 'have', 'had', 'do', 'does', 'did', 'can', 'will', 'just'])

export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
}

/** Dice coefficient over content-word bigrams. 0 = nothing shared, 1 = identical. */
export function similarity(a: string, b: string): number {
  const bigrams = (t: string) => {
    const w = contentWords(t)
    const set = new Set<string>()
    if (w.length === 1) set.add(w[0])
    for (let i = 0; i < w.length - 1; i++) set.add(`${w[i]} ${w[i + 1]}`)
    return set
  }
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const g of A) if (B.has(g)) shared++
  return (2 * shared) / (A.size + B.size)
}

export function numericClaims(text: string): string[] {
  const re = /(?:\$|€|£)?\d[\d,]*(?:\.\d+)?\s?(?:%|x|×|percent|pp|ms|k|m|b|bn|million|billion|points?)?/gi
  const found: string[] = []
  for (const m of text.matchAll(re)) {
    const raw = m[0].trim()
    // Skip bare small integers that are almost certainly list numbers or years.
    if (/^\d{1,2}$/.test(raw)) continue
    if (/^(19|20)\d{2}$/.test(raw)) continue
    found.push(raw)
  }
  return found
}

function camel(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

const TOPIC_TAG_HINTS: Array<[RegExp, string]> = [
  [/reinforcement|\brl\b/i, 'ReinforcementLearning'],
  [/rlhf|human feedback/i, 'RLHF'],
  [/reward/i, 'RewardModeling'],
  [/agent/i, 'AIAgents'],
  [/agentic/i, 'AgenticAI'],
  [/post[- ]?training/i, 'PostTraining'],
  [/eval|benchmark/i, 'ModelEvaluation'],
  [/environment|sandbox|simulation/i, 'AIEnvironments'],
  [/synthetic/i, 'SyntheticData'],
  [/fine[- ]?tun/i, 'FineTuning'],
  [/multi[- ]?agent/i, 'MultiAgentSystems'],
  [/infra/i, 'AIInfrastructure'],
  [/inference/i, 'InferenceOptimization'],
  [/safety/i, 'AISafety'],
  [/frontier/i, 'FrontierModels'],
  [/enterprise/i, 'EnterpriseAI'],
  [/research/i, 'AIResearch'],
  [/reason/i, 'LLMReasoning'],
  [/tool use|tool[- ]calling/i, 'ToolUse'],
  [/verif/i, 'VerifiableRewards'],
]

/** Derives 3–5 CamelCase hashtags from a topic string. Deterministic and never reach-bait. */
export function deriveHashtags(topic: string, count = 4): string[] {
  const n = Math.max(BRAND.hashtags.min, Math.min(BRAND.hashtags.max, count))
  const out: string[] = []
  const push = (t: string) => {
    if (!t) return
    if (GENERIC_HASHTAGS.includes(t.toLowerCase())) return
    if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  for (const [re, tag] of TOPIC_TAG_HINTS) if (re.test(topic)) push(tag)
  const words = contentWords(topic).filter((w) => !/^\d+$/.test(w))
  for (let i = 0; i < words.length - 1 && out.length < n; i++) push(camel(words[i]) + camel(words[i + 1]))
  for (const w of words) if (out.length < n) push(camel(w))
  for (const fallback of ['AIResearch', 'ReinforcementLearning', 'PostTraining', 'ModelEvaluation', 'AgenticAI']) if (out.length < n) push(fallback)
  return out.slice(0, n)
}

export interface VoiceEnforcement {
  text: string
  changes: string[]
}

/** Applies the mechanical rules (2, 3, 5) unconditionally. Always the final step of caption generation. */
export function enforceBrandVoice(caption: string, topic: string): VoiceEnforcement {
  const changes: string[] = []
  let text = caption
  for (const f of FORBIDDEN_LANGUAGE) {
    const before = text
    text = text.replace(f.pattern, (m) => {
      const r = f.replacement
      return m[0] === m[0].toUpperCase() ? r.charAt(0).toUpperCase() + r.slice(1) : r
    })
    if (before !== text) changes.push(`Rule 2 · replaced "${before.match(f.pattern)?.[0] ?? '…'}" with "${f.replacement}"`)
  }
  const emojiCount = (text.match(EMOJI_RE) ?? []).length
  if (emojiCount > BRAND.emojiBudget) {
    text = text.replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ')
    changes.push(`Rule 3 · removed ${emojiCount} emoji (budget is ${BRAND.emojiBudget})`)
  }
  // Hashtag block: strip every inline tag and rebuild a clamped, topic-derived block.
  const existing = Array.from(text.matchAll(/#[\p{L}\p{N}_]+/gu)).map((m) => m[0].slice(1))
  const body = text.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\n{3,}/g, '\n\n').trimEnd()
  const kept = existing.filter((t) => !GENERIC_HASHTAGS.includes(t.toLowerCase()))
  const uniq: string[] = []
  for (const t of kept) if (!uniq.some((u) => u.toLowerCase() === t.toLowerCase())) uniq.push(t)
  let tags = uniq.slice(0, BRAND.hashtags.max)
  if (tags.length < BRAND.hashtags.min) {
    for (const t of deriveHashtags(topic, BRAND.hashtags.max)) {
      if (tags.length >= BRAND.hashtags.max) break
      if (!tags.some((u) => u.toLowerCase() === t.toLowerCase())) tags.push(t)
    }
    tags = tags.slice(0, Math.max(BRAND.hashtags.min, Math.min(BRAND.hashtags.max, tags.length)))
  }
  if (existing.length !== tags.length || existing.some((e, i) => e !== tags[i])) {
    changes.push(`Rule 5 · hashtag block set to ${tags.length} topic-derived tags`)
  }
  text = `${body}\n\n${tags.map((t) => `#${t}`).join(' ')}`
  return { text: text.trim(), changes }
}

export interface BrandViolation {
  rule: number
  title: string
  detail: string
  required_action: string
  mechanical: boolean
}

export interface DimensionResult {
  ok: boolean
  note: string
}

export interface BrandCheck {
  verdict: BrandVerdict
  dimensions: Record<CheckDimension, DimensionResult>
  violations: BrandViolation[]
  sensitiveHits: string[]
  corrected_version?: string
  summary: string
}

export interface BrandCandidate {
  caption: string
  platform: Platform
  topic: string
  citations?: string[]
  knowledgeGrounded?: boolean
  recentCaptions?: string[]
  visual?: {
    headline?: string
    hasLogo: boolean
    hasAltText: boolean
    textDrawnLocally: boolean
    accentUsed: boolean
  }
}

export function checkBrandCompliance(c: BrandCandidate): BrandCheck {
  const violations: BrandViolation[] = []
  const sensitiveHits: string[] = []
  const text = c.caption ?? ''
  const push = (rule: number, detail: string, action: string, mechanical = false) => {
    violations.push({ rule, title: RULE_BY_N[rule].title, detail, required_action: action, mechanical })
  }

  // Candidate & Risk (17) — sensitive topics
  for (const s of SENSITIVE_TOPICS) {
    if (s.pattern.test(text)) {
      sensitiveHits.push(s.label)
      push(s.rule, `Mentions a ${s.label}: "${text.match(s.pattern)?.[0]}"`, s.rule === 8 ? 'Restate against a published baseline instead of a named lab.' : 'Route to internal approval before this can be drafted further.')
    }
  }

  // Voice (2, 3, 4, 5, 11)
  for (const f of FORBIDDEN_LANGUAGE) {
    const m = text.match(f.pattern)
    if (m) push(2, `Hype phrase "${m[0]}"`, `Replace with "${f.replacement}".`, true)
  }
  const emojiCount = (text.match(EMOJI_RE) ?? []).length
  if (emojiCount > BRAND.emojiBudget) push(3, `${emojiCount} emoji found; budget is ${BRAND.emojiBudget}`, 'Remove every emoji.', true)
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? ''
  const hookWords = firstLine.trim().split(/\s+/).filter(Boolean).length
  if (hookWords > BRAND.hookMaxWords) push(4, `Hook is ${hookWords} words; limit is ${BRAND.hookMaxWords}`, 'Cut the hook to one declarative sentence.')
  const tags = Array.from(text.matchAll(/#[\p{L}\p{N}_]+/gu)).map((m) => m[0].slice(1))
  const generic = tags.filter((t) => GENERIC_HASHTAGS.includes(t.toLowerCase()))
  if (tags.length < BRAND.hashtags.min || tags.length > BRAND.hashtags.max) push(5, `${tags.length} hashtags; required ${BRAND.hashtags.min}–${BRAND.hashtags.max}`, 'Rebuild the hashtag block from the topic.', true)
  if (generic.length) push(5, `Generic tags: ${generic.map((g) => `#${g}`).join(', ')}`, 'Replace with topic-derived tags.', true)
  for (const p of PITCH_LANGUAGE) if (p.pattern.test(text)) push(11, `Pitch language (${p.label}): "${text.match(p.pattern)?.[0]}"`, 'Remove the sales framing; close with an observation or a question.', true)

  // Factual (6, 10)
  const claims = numericClaims(text)
  const cited = (c.citations?.length ?? 0) > 0 || /\b(arxiv|paper|benchmark|dataset|source:|according to|reported by|https?:\/\/)/i.test(text)
  let cannotVerify = false
  if (claims.length && !cited) {
    cannotVerify = true
    push(6, `Numeric claims without a named source: ${claims.slice(0, 4).join(', ')}`, 'Name the paper, benchmark or dataset behind each figure, or remove the figure.')
  }
  if (c.knowledgeGrounded === false) push(10, 'No Knowledge Base entry was retrieved for this topic', 'Run the Knowledge Agent on this hashtag or write the grounding entry manually.')

  // Structure (9)
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim() && !p.trim().startsWith('#'))
  if (paragraphs.length < 3) push(9, `Only ${paragraphs.length} paragraph(s); the structure compresses to at least hook, body and close`, 'Add the missing stages (context/problem/mechanism/close).')
  const closing = paragraphs[paragraphs.length - 1] ?? ''
  const closes = /[?.]\s*$/.test(closing.trim())
  if (paragraphs.length >= 3 && !closes) push(9, 'Closing line does not end as a statement or question', 'End on a question or a single declarative sentence.')

  // Platform (limits)
  const limit = BRAND.platformLimits[c.platform]
  if (text.length > limit) push(4, `${text.length} characters exceeds the ${c.platform} limit of ${limit}`, 'Shorten the caption for this platform.')

  // Similarity (18)
  for (const prev of c.recentCaptions ?? []) {
    const s = similarity(text, prev)
    if (s >= BRAND.similarityCap.caption) {
      push(18, `Caption similarity ${s.toFixed(2)} to a recent post (cap ${BRAND.similarityCap.caption})`, 'Change the angle or the evidence so the post says something new.')
      break
    }
  }

  // Visual (12–16)
  let visualOk = true
  let captionVisualOk = true
  let visualNote = 'No creative attached yet'
  let cvNote = 'No creative to compare'
  if (c.visual) {
    if (!c.visual.hasLogo) { visualOk = false; push(14, 'Creative has no logomark', 'Re-render with the brand layer.') }
    if (!c.visual.hasAltText) { visualOk = false; push(16, 'Creative has no alt text', 'Generate alt text naming the concept and headline.') }
    if (!c.visual.textDrawnLocally) { visualOk = false; push(13, 'Text on the creative was drawn by a model', 'Re-render with the local brand layer on top.') }
    if (!c.visual.accentUsed) { visualOk = false; push(12, 'Creative does not use the brand accent family', 'Re-render with #8B2CF5 accents.') }
    visualNote = visualOk ? 'Logomark, alt text, local text layer and accent present' : 'Creative breaks a visual rule'
    if (c.visual.headline) {
      const s = similarity(c.visual.headline, firstLine)
      const shares = s > 0.15 || contentWords(c.visual.headline).some((w) => firstLine.toLowerCase().includes(w))
      captionVisualOk = shares
      cvNote = shares ? 'Headline restates the caption hook' : 'Headline and hook say different things'
      if (!shares) push(15, `Creative headline "${c.visual.headline}" does not restate the hook`, 'Align the headline with the hook, or the hook with the headline.')
    } else {
      cvNote = 'Headline present on the creative'
    }
  }

  const voiceRules = new Set([2, 3, 4, 5, 11])
  const voiceOk = !violations.some((v) => voiceRules.has(v.rule))
  const groundingOk = !violations.some((v) => v.rule === 6 || v.rule === 10)
  const structureOk = !violations.some((v) => v.rule === 9)
  const platformOk = text.length <= limit

  const dimensions: Record<CheckDimension, DimensionResult> = {
    grounding: { ok: groundingOk, note: groundingOk ? (claims.length ? `${claims.length} figure(s), all cited` : 'No numeric claims to verify') : 'Uncited figures or missing knowledge grounding' },
    voice: { ok: voiceOk, note: voiceOk ? 'No hype, no emoji, hashtags in range' : 'Voice rules violated' },
    structure: { ok: structureOk, note: structureOk ? `${paragraphs.length} stages, closes cleanly` : 'Structure incomplete' },
    platform: { ok: platformOk, note: `${text.length}/${limit} characters for ${c.platform}` },
    visual: { ok: visualOk, note: visualNote },
    captionVisual: { ok: captionVisualOk, note: cvNote },
  }

  let verdict: BrandVerdict = 'APPROVED'
  if (sensitiveHits.length) verdict = 'NEEDS_INTERNAL_APPROVAL'
  else if (cannotVerify) verdict = 'CANNOT_VERIFY'
  else if (violations.length) verdict = 'REVISE'

  let corrected_version: string | undefined
  if (verdict === 'REVISE' && violations.every((v) => v.mechanical)) {
    corrected_version = enforceBrandVoice(text, c.topic).text
  }

  const summary = verdict === 'APPROVED'
    ? 'Passes every automatic and assisted check.'
    : verdict === 'NEEDS_INTERNAL_APPROVAL'
      ? `Sensitive topic: ${sensitiveHits.join(', ')}. Needs internal approval before anything else.`
      : verdict === 'CANNOT_VERIFY'
        ? 'Contains figures the checker cannot trace to a source.'
        : `${violations.length} rule(s) to revise${corrected_version ? ' — all mechanical, corrected version attached' : ''}.`

  return { verdict, dimensions, violations, sensitiveHits, corrected_version, summary }
}
