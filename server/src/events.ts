// One global EventBus with a ring buffer. Events are notifications, not the source of truth.
import type { AgentId } from '../../shared/agent-registry'

export type PipelineEventType =
  | 'pipeline.started' | 'pipeline.finished'
  | 'agent.started' | 'agent.finished' | 'agent.failed'
  | 'skill.started' | 'skill.finished' | 'skill.skipped' | 'skill.failed'
  | 'item.scraped' | 'item.validated' | 'hashtag.captured' | 'hashtag.validated' | 'keyword.ranked'
  | 'idea.created' | 'idea.ranked' | 'draft.generated' | 'post.published'
  | 'knowledge.written' | 'knowledge.build.started' | 'knowledge.build.finished'
  | 'corpus.embed.started' | 'corpus.embed.finished' | 'corpus.document.embedded'
  | 'activity'

export interface PipelineEvent {
  id: number
  type: PipelineEventType
  at: string
  agentId?: AgentId
  skillId?: string
  runId?: string
  message?: string
  data?: Record<string, unknown>
}

export type EventListener = (event: PipelineEvent) => void

const RING_SIZE = 400

class EventBus {
  private listeners = new Set<EventListener>()
  private buffer: PipelineEvent[] = []
  private seq = 0

  publish(event: Omit<PipelineEvent, 'id' | 'at'> & { at?: string }): PipelineEvent {
    const full: PipelineEvent = { ...event, id: ++this.seq, at: event.at ?? new Date().toISOString() }
    this.buffer.push(full)
    if (this.buffer.length > RING_SIZE) this.buffer.splice(0, this.buffer.length - RING_SIZE)
    for (const l of this.listeners) {
      try { l(full) } catch (err) { console.error('[events] listener failed', err) }
    }
    return full
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  recent(n = 40): PipelineEvent[] {
    return this.buffer.slice(-n)
  }

  get size(): number {
    return this.buffer.length
  }
}

export const bus = new EventBus()
