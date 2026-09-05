// Typed API client. Fails soft everywhere — the app must remain fully usable standalone.
import type { Draft, DraftResponse, HealthResponse, Idea, InstructResponse, KnowledgeBuild, KnowledgeEntry, MediaAsset, PipelineEvent, PipelineResult, Platform, RegistrySkill, ReviewQueueItem, StateSnapshot, Validation } from '../types'
import type { AgentSpec, StageSpec } from '../../shared/agent-registry'

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000/api'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function req<T>(method: string, path: string, body?: unknown, timeoutMs = 120000): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) })
  const text = await res.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  if (!res.ok) throw new ApiError((json as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`, res.status)
  return json as T
}

export async function detectApi(timeoutMs = 1500): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return (await res.json()) as HealthResponse
  } catch {
    return null
  }
}

export const api = {
  health: () => req<HealthResponse>('GET', '/health'),
  state: () => req<StateSnapshot>('GET', '/state'),
  registry: () => req<{ stages: StageSpec[]; agents: AgentSpec[]; summary: { agents: number; skills: number; stages: number; knobs: number }; skills: RegistrySkill[] }>('GET', '/registry'),
  patchSkill: (skillId: string, patch: { enabled?: boolean; config?: Record<string, string | number | boolean> }) => req<{ skillId: string; enabled: boolean; values: Record<string, string | number | boolean>; isOverridden: boolean }>('PATCH', `/skills/${skillId}`, patch),
  resetSkill: (skillId: string) => req<{ skillId: string; enabled: boolean; values: Record<string, string | number | boolean>; isOverridden: boolean }>('POST', `/skills/${skillId}/reset`),
  keywords: {
    create: (b: { term: string; category: string; weight: number }) => req<StateSnapshot['keywords'][number]>('POST', '/keywords', b),
    update: (id: string, b: { term?: string; category?: string; weight?: number; active?: boolean }) => req<StateSnapshot['keywords'][number]>('PATCH', `/keywords/${id}`, b),
    remove: (id: string) => req<{ ok: true }>('DELETE', `/keywords/${id}`),
  },
  setHashtagValidation: (id: string, validation: Validation, by: string) => req<StateSnapshot['hashtags'][number]>('PATCH', `/hashtags/${id}/validation`, { validation, by }),
  setItemValidation: (id: string, validation: Validation, by: string) => req<StateSnapshot['scraped'][number]>('PATCH', `/items/${id}/validation`, { validation, by }),
  runPipeline: (b: { paceMs?: number; keywordIds?: string[] } = {}) => req<PipelineResult>('POST', '/pipeline/run', b, 300000),
  runs: () => req<{ agentRuns: unknown[]; skillRuns: unknown[]; pipelineRuns: unknown[] }>('GET', '/runs'),
  knowledge: {
    build: (b: { hashtagCount?: number; forceRefresh?: boolean } = {}) => req<KnowledgeBuild>('POST', '/knowledge/build', b, 300000),
    add: (b: { title: string; category: string; content: string; source?: string; tags?: string[]; confidence?: 'High' | 'Medium' | 'Low' }) => req<KnowledgeEntry>('POST', '/knowledge', b),
    toggle: (id: string, active: boolean) => req<KnowledgeEntry>('PATCH', `/knowledge/${id}`, { active }),
  },
  ideas: {
    draft: (id: string, platform: Platform) => req<DraftResponse>('POST', `/ideas/${id}/draft`, { platform }, 180000),
    image: (id: string, b: { platform: Platform; model?: string; prompt?: string; instruction?: string }) => req<{ media: MediaAsset; skills: unknown[] }>('POST', `/ideas/${id}/image`, b, 180000),
    instruct: (id: string, platform: Platform, instruction: string) => req<InstructResponse>('POST', `/ideas/${id}/instruct`, { platform, instruction }, 180000),
    patch: (id: string, b: { date?: string; time?: string; platform?: Platform; status?: string; draft?: string; calendarSlot?: 'primary' | 'suggestion'; title?: string }) => req<{ ok: true; idea: Idea; demoted: { id: string; title: string } | null; promoted: { id: string; title: string } | null }>('PATCH', `/ideas/${id}`, b),
    remove: (id: string) => req<{ ok: true }>('DELETE', `/ideas/${id}`),
    approve: (id: string, by: string) => req<{ ok: true; status: string }>('POST', `/ideas/${id}/approve`, { by }),
    leadershipApprove: (id: string, by: string, publish: boolean) => req<{ ok: true; status: string; published: { post: Record<string, unknown>; analytics: { summary: string; recommendation: string } | null } | null }>('POST', `/ideas/${id}/leadership/approve`, { by, publish }, 180000),
    leadershipReject: (id: string, by: string, reason: string) => req<{ ok: true; status: string }>('POST', `/ideas/${id}/leadership/reject`, { by, reason }),
    publish: (id: string) => req<{ post: Record<string, unknown>; analytics: { summary: string; recommendation: string } | null }>('POST', `/ideas/${id}/publish`, undefined, 180000),
  },
  refreshAnalytics: () => req<{ pulls: number; analysed: number }>('POST', '/analytics/refresh', {}, 180000),
  imageModels: () => req<{ models: unknown[]; status: unknown[] }>('GET', '/image-models'),
  lineage: (type: string, id: string) => req<{ root: { type: string; id: string }; edges: unknown[] }>('GET', `/lineage/${type}/${id}`),
  reviewQueue: () => req<ReviewQueueItem[]>('GET', '/review-queue?resolved=false'),
  resolveReview: (id: string, outcome: string, by: string) => req<ReviewQueueItem>('POST', `/review-queue/${id}/resolve`, { outcome, by }),
}

export type { Draft }

/** Opens an EventSource on /events. Ignores malformed frames, reconnects silently, returns an unsubscribe. */
export function subscribeToEvents(onEvent: (e: PipelineEvent) => void, onOpen?: () => void): () => void {
  let source: EventSource | null = null
  let closed = false
  let retry: ReturnType<typeof setTimeout> | null = null
  const open = () => {
    if (closed) return
    try {
      source = new EventSource(`${API_BASE}/events`)
      source.onopen = () => onOpen?.()
      source.onmessage = (ev) => {
        try { onEvent(JSON.parse(ev.data) as PipelineEvent) } catch { /* malformed frame ignored */ }
      }
      source.onerror = () => {
        source?.close()
        source = null
        if (!closed) retry = setTimeout(open, 3000)
      }
    } catch {
      if (!closed) retry = setTimeout(open, 3000)
    }
  }
  open()
  return () => { closed = true; if (retry) clearTimeout(retry); source?.close() }
}
