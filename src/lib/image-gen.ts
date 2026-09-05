// Local brand-svg rendering. Renders immediately; the store swaps in model artwork when a runtime is reachable.
import { CANVASES, IMAGE_CONCEPTS, buildAltText, composeBrandSvg, svgToDataUri } from '../../shared/image-models'
import type { Idea, MediaAsset, Platform } from '../types'

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function conceptFor(idea: Pick<Idea, 'title' | 'sourceTopic'>): string {
  const t = `${idea.title} ${idea.sourceTopic ?? ''}`.toLowerCase()
  if (/agent|multi-agent|orchestrat|mcp|tool/.test(t)) return 'Agent graph'
  if (/reward|rlhf|preference/.test(t)) return 'Reward landscape'
  if (/eval|benchmark|judge|test/.test(t)) return 'Evaluation grid'
  if (/policy|grpo|ppo|reinforcement|post-training/.test(t)) return 'Policy gradient'
  if (/environment|sandbox|simulation/.test(t)) return 'Environment lattice'
  return IMAGE_CONCEPTS[hashSeed(t) % IMAGE_CONCEPTS.length]
}

export function headlineFor(caption: string, title: string, maxWords = 10): string {
  const hook = (caption.split('\n').find((l) => l.trim()) ?? title).replace(/#/g, '').trim()
  const w = hook.split(/\s+/)
  return (w.length > maxWords ? w.slice(0, maxWords).join(' ').replace(/[,;:.]$/, '') + '…' : hook).replace(/\.$/, '')
}

export function buildPrompt(idea: Pick<Idea, 'sourceTopic'>, concept: string, instruction?: string): string {
  return `Abstract ${concept.toLowerCase()} for a research-lab social creative about ${idea.sourceTopic ?? 'AI research'}: deep navy ground, violet (#8B2CF5) and lavender accents, soft light, no text, no letters, no logos, no people.${instruction ? ` Direction: ${instruction}.` : ''}`
}

export function renderBrandLocal(idea: Pick<Idea, 'id' | 'title' | 'sourceTopic' | 'analysis'>, platform: Platform, caption: string, opts: { variant?: number; concept?: string; instruction?: string; fallbackReason?: string | null; model?: string } = {}): MediaAsset {
  const concept = opts.concept ?? conceptFor(idea)
  const headline = headlineFor(caption, idea.title)
  const c = CANVASES[platform]
  const seed = hashSeed(`${idea.id}:${platform}`) + (opts.instruction ? hashSeed(opts.instruction) % 97 : 0)
  const svg = composeBrandSvg({ platform, headline, kicker: `${idea.analysis.format ?? 'Research note'} · ${idea.sourceTopic ?? ''}`, concept, seed, variant: opts.variant ?? 0 })
  return {
    platform, kind: idea.analysis.format === 'Carousel' ? 'carousel' : 'single', concept, canvas: c.label, width: c.width, height: c.height,
    altText: buildAltText(headline, concept, platform), renderMode: 'demo', model: opts.model ?? 'brand-svg', prompt: buildPrompt(idea, concept, opts.instruction),
    fallbackReason: opts.fallbackReason ?? null, dataUri: svgToDataUri(svg), variants: [], createdAt: new Date().toISOString(),
  }
}
