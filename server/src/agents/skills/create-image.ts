// Image Creator Agent skills — stage `create`. Two-layer render: optional painted field under a local brand layer.
import { checkBrandCompliance, type Platform } from '../../../../shared/brand-voice'
import { CANVASES, IMAGE_CONCEPTS, buildAltText, composeBrandSvg, svgToDataUri } from '../../../../shared/image-models'
import { query } from '../../db/pool'
import { registerSkill } from '../runtime'
import { RENDERERS } from './image-models'
import type { IdeaRecord } from './create'

export interface ImagePayload extends Record<string, unknown> {
  idea: IdeaRecord
  platform: Platform
  caption: string
  requestedModel?: string
  prompt?: string
  instruction?: string
  model: string
  concept: string
  approach: 'brand-only' | 'painted-field'
  canvas: string
  width: number
  height: number
  layout: string
  headline: string
  kicker: string
  footer: string
  references: string[]
  backgroundDataUri?: string
  dataUri: string
  fallbackReason?: string
  renderMode: 'demo' | 'live'
  variants: string[]
  altText: string
  visualCheck: { ok: boolean; notes: string[] }
  videoBrief?: string
  seed: number
  outputCount?: number
  completionNote?: string
}

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

function conceptFor(idea: IdeaRecord): string {
  const t = `${idea.title} ${idea.sourceTopic}`.toLowerCase()
  if (/agent|multi-agent|orchestrat|mcp|tool/.test(t)) return 'Agent graph'
  if (/reward|rlhf|preference/.test(t)) return 'Reward landscape'
  if (/eval|benchmark|judge|test/.test(t)) return 'Evaluation grid'
  if (/policy|grpo|ppo|reinforcement|post-training/.test(t)) return 'Policy gradient'
  if (/environment|sandbox|simulation/.test(t)) return 'Environment lattice'
  return IMAGE_CONCEPTS[hashSeed(t) % IMAGE_CONCEPTS.length]
}

export function buildImagePrompt(idea: IdeaRecord, concept: string, instruction?: string): string {
  return `Abstract ${concept.toLowerCase()} for a research-lab social creative about ${idea.sourceTopic}: deep navy ground, violet (#8B2CF5) and lavender accents, soft light, no text, no letters, no logos, no people. ${instruction ? `Direction: ${instruction}.` : ''}`.trim()
}

registerSkill<ImagePayload>('generation.image.approach', (p, ctx) => {
  const pref = ctx.str('preferredModel')
  const requested = p.requestedModel && RENDERERS[p.requestedModel] ? p.requestedModel : pref !== 'Auto' && RENDERERS[pref] ? pref : undefined
  const painted = Object.values(RENDERERS).find((r) => r.id !== 'brand-svg' && r.isConfigured())
  const model = requested ?? painted?.id ?? 'brand-svg'
  const concept = conceptFor(p.idea)
  ctx.log(`Concept "${concept}" · model ${model}`)
  return { model, concept, approach: model === 'brand-svg' ? 'brand-only' : 'painted-field', seed: hashSeed(`${p.idea.id}:${p.platform}`), prompt: p.prompt ?? buildImagePrompt(p.idea, concept, p.instruction) }
})

registerSkill<ImagePayload>('generation.image.reference', async (p, ctx) => {
  const n = ctx.num('lookback')
  const rows = await query<{ concept: string | null }>('SELECT concept FROM media_assets WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2', [ctx.workspaceId, n])
  const recent = rows.map((r) => r.concept ?? '').filter(Boolean)
  let concept = p.concept
  const same = recent.filter((c) => c === concept).length
  if (same >= 3) {
    concept = IMAGE_CONCEPTS.find((c) => !recent.includes(c)) ?? concept
    ctx.log(`Concept "${p.concept}" used ${same}× recently — switched to "${concept}"`)
  }
  return { references: recent, concept }
})

registerSkill<ImagePayload>('generation.image.template', (p, ctx) => {
  const c = CANVASES[p.platform]
  const layout = ctx.str('layout') === 'Auto' ? (p.platform === 'instagram' ? 'Headline centre' : 'Headline left') : ctx.str('layout')
  return { canvas: c.label, width: c.width, height: c.height, layout }
})

registerSkill<ImagePayload>('generation.image.tokens', (p, ctx) => {
  const maxW = ctx.num('headlineMaxWords')
  const hook = (p.caption.split('\n').find((l) => l.trim()) ?? p.idea.title).replace(/[#]/g, '').trim()
  const wordsArr = hook.split(/\s+/)
  const headline = (wordsArr.length > maxW ? wordsArr.slice(0, maxW).join(' ').replace(/[,;:.]$/, '') + '…' : hook).replace(/\.$/, '')
  const kicker = `${p.idea.analysis.format ?? 'Research note'} · ${p.idea.sourceTopic}`
  ctx.log(`Headline: "${headline}"`)
  return { headline, kicker, footer: 'Ethara.AI · Reinforcement Learning as a Service' }
})

registerSkill<ImagePayload>('generation.image.render', async (p, ctx) => {
  const variantsN = ctx.num('variants')
  let background: string | undefined
  let fallbackReason: string | undefined
  let model = p.model
  let renderMode: 'demo' | 'live' = 'demo'
  if (p.approach === 'painted-field') {
    const renderer = RENDERERS[p.model]
    if (!renderer || !renderer.isConfigured()) {
      fallbackReason = renderer ? renderer.unavailableReason() : `Unknown renderer ${p.model}`
      model = 'brand-svg'
      await ctx.activity(`${p.model} unavailable — ${fallbackReason}. Rendering with the brand layer only.`, 'warn')
    } else {
      try {
        background = await renderer.paintBackground(p.prompt ?? '', p.platform)
        renderMode = 'live'
      } catch (err) {
        fallbackReason = `${p.model} failed: ${err instanceof Error ? err.message : String(err)}`
        model = 'brand-svg'
        await ctx.activity(`${fallbackReason}. Rendering with the brand layer only.`, 'warn')
      }
    }
  }
  const compose = (variant: number) => svgToDataUri(composeBrandSvg({ platform: p.platform, headline: p.headline, kicker: p.kicker, footer: p.footer, concept: p.concept, seed: p.seed, backgroundDataUri: background || undefined, variant }))
  const dataUri = compose(0)
  const variants = Array.from({ length: Math.max(0, variantsN - 1) }, (_, i) => compose(i + 1))
  ctx.log(`Rendered ${p.canvas} with ${model}${fallbackReason ? ' (fallback)' : ''}`)
  return { dataUri, variants, model, fallbackReason, renderMode, backgroundDataUri: background }
})

registerSkill<ImagePayload>('generation.image.export', (p, ctx) => {
  ctx.log(`Exported as ${ctx.str('format')} · ${p.width}×${p.height}`)
  return { outputCount: 1 }
})

registerSkill<ImagePayload>('generation.image.altText', (p, ctx) => {
  const max = ctx.num('maxChars')
  return { altText: buildAltText(p.headline, p.concept, p.platform).slice(0, max) }
})

registerSkill<ImagePayload>('generation.image.reviewGate', (p, ctx) => {
  const check = checkBrandCompliance({ caption: p.caption, platform: p.platform, topic: p.idea.sourceTopic, knowledgeGrounded: true, visual: { headline: p.headline, hasLogo: true, hasAltText: Boolean(p.altText), textDrawnLocally: true, accentUsed: true } })
  const visualViolations = check.violations.filter((v) => v.rule >= 12 && v.rule <= 16)
  const ok = visualViolations.length === 0
  if (!ok && ctx.bool('blockOnFailure')) throw new Error(`Visual rules violated: ${visualViolations.map((v) => `Rule ${v.rule}`).join(', ')}`)
  ctx.log(ok ? 'Visual rules 12–16 pass' : `${visualViolations.length} visual finding(s)`)
  return { visualCheck: { ok, notes: visualViolations.map((v) => v.detail) }, completionNote: `Creative rendered (${p.model})` }
})

registerSkill<ImagePayload>('generation.image.video.compose', (p, ctx) => ({
  videoBrief: `${ctx.num('durationSeconds')}s cut: open on the headline "${p.headline}", animate the ${p.concept.toLowerCase()} field, close on the logomark. No voice-over; captions from the hook.`,
}))
