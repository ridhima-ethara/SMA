// Initial client state: configuration only (keyword set, brand rules). Every content collection starts empty and is
// filled by the agent runtime — nothing here fabricates posts, metrics or ideas.
import { AGENTS } from '../../shared/agent-registry'
import { BRAND_RULES } from '../../shared/brand-voice'
import { SEED_KEYWORDS } from '../../shared/keywords'
import type { Idea, KnowledgeEntry, Platform, Role, StateSnapshot, User } from '../types'

export const USERS: Record<Role, User> = {
  marketing: { name: 'Ridhima', role: 'marketing', title: 'Marketing Lead', email: 'ridhima@ethara.ai', initial: 'R' },
  leadership: { name: 'Arjun Mehta', role: 'leadership', title: 'CMO', email: 'arjun@ethara.ai', initial: 'A' },
}

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const timeLabel = (hour: number, half = false) => `${hour % 12 === 0 ? 12 : hour % 12}:${half ? '30' : '00'} ${hour < 12 ? 'AM' : 'PM'}`
export const nextSunday06 = () => { const d = new Date(); d.setHours(6, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); if (d.getTime() < Date.now()) d.setDate(d.getDate() + 7); return d.toISOString() }
const CATEGORY_FOR_AREA: Record<string, string> = { 'Voice & Positioning': 'Brand Voice', 'Factual & Content': 'Brand Guideline', Visual: 'Visual Identity', 'Candidate & Risk': 'Compliance Rule' }
const NOT_CONNECTED = (key: string, what: string) => `${key} is not set — ${what}. The agent runtime is not reachable, so this is the local configuration view.`

export function applyTopRuleLocal(ideas: Idea[], top: number): Idea[] {
  for (const pl of ['linkedin', 'instagram', 'x'] as Platform[]) {
    const g = ideas.filter((i) => i.platform === pl && i.status !== 'published' && i.status !== 'rejected').sort((a, b) => b.priorityScore - a.priorityScore)
    g.forEach((i, idx) => { i.platformRank = idx + 1; i.calendarSlot = idx < top ? 'primary' : 'suggestion' })
  }
  return ideas
}

export function buildInitialState(): StateSnapshot {
  const knowledge: KnowledgeEntry[] = BRAND_RULES.map((r) => ({ id: `rule-${r.n}`, title: `Rule ${r.n} · ${r.title}`, category: CATEGORY_FOR_AREA[r.area], content: r.text, source: 'Brand definition', sources: [], hashtagId: null, hashtagTag: null, tags: ['brand', r.enforcement, 'priority'], confidence: 'High', evidenceCount: 1, active: true, origin: 'brand', createdAt: new Date().toISOString(), ruleN: r.n }))
  return {
    keywords: SEED_KEYWORDS.map((k, i) => ({ id: `kw-${i}`, term: k.term, category: k.category, weight: k.weight, active: true })),
    keywordSignals: [], hashtags: [], topHashtags: [], scraped: [], ideas: [], published: [], knowledge, knowledgeBuild: null,
    agents: AGENTS.map((a) => ({ id: a.id, status: 'idle', currentTask: 'Idle', lastRun: null, processed: 0, successRate: 100 })),
    activity: [], analytics: [], reviewQueue: [],
    integrations: { apify: { configured: false, reason: NOT_CONNECTED('APIFY_API_TOKEN', 'scraping needs the Apify LinkedIn actors') }, parallel: { configured: false, reason: NOT_CONNECTED('PARALLEL_API_KEY', 'the Knowledge Base build needs Parallel Web Systems') }, gcp: { configured: false, reason: NOT_CONNECTED('GCP_API_KEY', 'captions use the built-in template writer') }, zImage: { configured: false, reason: NOT_CONNECTED('Z_IMAGE_API_KEY', 'the Z-Image renderer is unavailable') } },
    publishMode: 'demo', imageModels: [], nextKnowledgeBuild: nextSunday06(),
  }
}
