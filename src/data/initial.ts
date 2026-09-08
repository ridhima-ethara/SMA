// Initial client state: empty. Every collection the UI renders — keywords, hashtags, ideas, knowledge, agent status,
// analytics, review queue, image models — is owned by the agent runtime and arrives over /api/state. Nothing is
// seeded, cached or fabricated here, so an empty screen means the backend has nothing rather than the UI hiding it.
import type { Idea, Platform, Role, StateSnapshot, User } from '../types'

export const USERS: Record<Role, User> = {
  marketing: { name: 'Ridhima', role: 'marketing', title: 'Marketing Lead', email: 'ridhima@ethara.ai', initial: 'R' },
  leadership: { name: 'Arjun Mehta', role: 'leadership', title: 'CMO', email: 'arjun@ethara.ai', initial: 'A' },
}

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const timeLabel = (hour: number, half = false) => `${hour % 12 === 0 ? 12 : hour % 12}:${half ? '30' : '00'} ${hour < 12 ? 'AM' : 'PM'}`
export const nextSunday06 = () => { const d = new Date(); d.setHours(6, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); if (d.getTime() < Date.now()) d.setDate(d.getDate() + 7); return d.toISOString() }
const NOT_CONNECTED = (key: string, what: string) => `${key} is not set — ${what}. The agent runtime is not reachable, so nothing can be loaded.`

export function applyTopRuleLocal(ideas: Idea[], top: number): Idea[] {
  for (const pl of ['linkedin', 'instagram', 'x'] as Platform[]) {
    const g = ideas.filter((i) => i.platform === pl && i.status !== 'published' && i.status !== 'rejected').sort((a, b) => b.priorityScore - a.priorityScore)
    g.forEach((i, idx) => { i.platformRank = idx + 1; i.calendarSlot = idx < top ? 'primary' : 'suggestion' })
  }
  return ideas
}

/** The pre-fetch shell: correct shape, no rows. `refreshState()` replaces all of it with `/api/state`. */
export function buildInitialState(): StateSnapshot {
  return {
    keywords: [], keywordSignals: [], hashtags: [], topHashtags: [], scraped: [], ideas: [], published: [],
    knowledge: [], knowledgeBuild: null, agents: [], activity: [], analytics: [], reviewQueue: [],
    integrations: { apify: { configured: false, reason: NOT_CONNECTED('APIFY_API_TOKEN', 'scraping needs the Apify LinkedIn actors') }, parallel: { configured: false, reason: NOT_CONNECTED('PARALLEL_API_KEY', 'the Knowledge Base build needs Parallel Web Systems') }, gcp: { configured: false, reason: NOT_CONNECTED('GCP_API_KEY', 'captions use the built-in template writer') }, zImage: { configured: false, reason: NOT_CONNECTED('Z_IMAGE_API_KEY', 'the Z-Image renderer is unavailable') } },
    publishMode: 'demo', imageModels: [], nextKnowledgeBuild: nextSunday06(),
  }
}
