// Generic skill runner. The only place that knows how a skill is invoked, timed, recorded and composed.
import { AGENT_BY_ID, SKILLS, SKILLS_BY_AGENT, SKILL_BY_ID, defaultSkillConfig, type AgentId, type SkillConfigValues } from '../../../shared/agent-registry'
import { bus, type PipelineEventType } from '../events'
import { one, query } from '../db/pool'

export type Payload = Record<string, unknown>

export interface SkillContext {
  workspaceId: string
  agentId: AgentId
  skillId: string
  agentRunId: string
  pipelineRunId?: string
  config: SkillConfigValues
  num(key: string): number
  bool(key: string): boolean
  str(key: string): string
  log(message: string): void
  emit(type: PipelineEventType, message: string, data?: Record<string, unknown>): void
  activity(message: string, status?: 'ok' | 'running' | 'warn' | 'error', entity?: { type: string; id: string }): Promise<void>
}

export type SkillHandler<P extends Payload = Payload> = (payload: P, ctx: SkillContext) => Promise<Partial<P> | void> | Partial<P> | void

const handlers = new Map<string, SkillHandler<Payload>>()

export function registerSkill<P extends Payload>(id: string, handler: SkillHandler<P>): void {
  if (!SKILL_BY_ID[id]) throw new Error(`registerSkill: '${id}' is not declared in the agent registry`)
  handlers.set(id, handler as unknown as SkillHandler<Payload>)
}

export function hasHandler(id: string): boolean {
  return handlers.has(id)
}

/** Boot-time audit: a critical skill with no handler is a fatal configuration error. */
export function auditSkillCoverage(): { missingCritical: string[]; missing: string[]; covered: number } {
  const missing = SKILLS.filter((s) => !handlers.has(s.id)).map((s) => s.id)
  const missingCritical = SKILLS.filter((s) => s.critical && !handlers.has(s.id)).map((s) => s.id)
  return { missingCritical, missing, covered: SKILLS.length - missing.length }
}

export interface SkillOverride {
  enabled: boolean
  config: SkillConfigValues
}

export async function loadOverrides(workspaceId: string): Promise<Record<string, SkillOverride>> {
  const rows = await query<{ skill_id: string; enabled: boolean; config: SkillConfigValues }>(
    'SELECT skill_id, enabled, config FROM agent_skills WHERE workspace_id = $1', [workspaceId],
  )
  return Object.fromEntries(rows.map((r) => [r.skill_id, { enabled: r.enabled, config: r.config ?? {} }]))
}

export function resolveConfig(skillId: string, overrides: Record<string, SkillOverride>, runOverride?: SkillConfigValues): SkillConfigValues {
  return { ...defaultSkillConfig(skillId), ...(overrides[skillId]?.config ?? {}), ...(runOverride ?? {}) }
}

/** Resolves a skill's effective config for callers outside a run (e.g. the caption agent reading retrieval knobs). */
export async function effectiveConfig(workspaceId: string, skillId: string): Promise<SkillConfigValues> {
  const overrides = await loadOverrides(workspaceId)
  return resolveConfig(skillId, overrides)
}

export type AgentStatus = 'idle' | 'running' | 'completed' | 'waiting' | 'needs_review' | 'failed'

export async function setAgentState(workspaceId: string, agentId: AgentId, patch: { status?: AgentStatus; currentTask?: string; processed?: number; successRate?: number; touchLastRun?: boolean }): Promise<void> {
  await query(
    `INSERT INTO agent_state (workspace_id, agent_id, status, current_task, last_run, processed, success_rate)
     VALUES ($1, $2, COALESCE($3, 'idle'), COALESCE($4, 'Idle'), CASE WHEN $7 THEN now() ELSE NULL END, COALESCE($5, 0), COALESCE($6, 100))
     ON CONFLICT (workspace_id, agent_id) DO UPDATE SET
       status = COALESCE($3, agent_state.status),
       current_task = COALESCE($4, agent_state.current_task),
       last_run = CASE WHEN $7 THEN now() ELSE agent_state.last_run END,
       processed = agent_state.processed + COALESCE($5, 0),
       success_rate = COALESCE($6, agent_state.success_rate)`,
    [workspaceId, agentId, patch.status ?? null, patch.currentTask ?? null, patch.processed ?? null, patch.successRate ?? null, patch.touchLastRun ?? false],
  )
}

export async function logActivity(workspaceId: string, agentId: AgentId | 'system', message: string, status: 'ok' | 'running' | 'warn' | 'error' = 'ok', entity?: { type: string; id: string }): Promise<void> {
  await query(
    'INSERT INTO activity_events (workspace_id, agent_id, message, status, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5, $6)',
    [workspaceId, agentId, message, status, entity?.type ?? null, entity?.id ?? null],
  )
  bus.publish({ type: 'activity', agentId: agentId === 'system' ? undefined : agentId, message, data: { status, entityType: entity?.type, entityId: entity?.id } })
}

export interface SkillRunRecord {
  skillId: string
  status: 'completed' | 'skipped' | 'failed'
  durationMs: number
  note?: string
  configUsed: SkillConfigValues
}

export interface AgentRunResult<P extends Payload = Payload> {
  agentId: AgentId
  agentRunId: string
  status: 'completed' | 'failed'
  payload: P
  skills: SkillRunRecord[]
  durationMs: number
  error?: string
}

export interface RunAgentOptions {
  workspaceId: string
  pipelineRunId?: string
  paceMs?: number
  sections?: string[]
  configOverrides?: Record<string, SkillConfigValues>
  inputCount?: number
  task?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runAgent<P extends Payload>(agentId: AgentId, input: P, opts: RunAgentOptions): Promise<AgentRunResult<P>> {
  const agent = AGENT_BY_ID[agentId]
  const started = Date.now()
  const run = await one<{ id: string }>(
    'INSERT INTO agent_runs (pipeline_run_id, workspace_id, agent_id, status, input_count) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [opts.pipelineRunId ?? null, opts.workspaceId, agentId, 'running', opts.inputCount ?? 0],
  )
  const agentRunId = run?.id ?? ''
  await setAgentState(opts.workspaceId, agentId, { status: 'running', currentTask: opts.task ?? `${agent.role}…`, touchLastRun: true })
  bus.publish({ type: 'agent.started', agentId, runId: opts.pipelineRunId, message: `${agent.name} started`, data: { agentRunId } })

  const payload: P = { ...input }
  const overrides = await loadOverrides(opts.workspaceId)
  const records: SkillRunRecord[] = []
  let attempted = 0
  let succeeded = 0
  let error: string | undefined

  const specs = SKILLS_BY_AGENT[agentId].filter((s) => !opts.sections || !s.section || opts.sections.includes(s.section))
  for (const spec of specs) {
    const cfg = resolveConfig(spec.id, overrides, opts.configOverrides?.[spec.id])
    const enabled = overrides[spec.id]?.enabled ?? spec.enabledByDefault
    const skillStarted = Date.now()
    const record = async (status: SkillRunRecord['status'], note?: string) => {
      const durationMs = Date.now() - skillStarted
      records.push({ skillId: spec.id, status, durationMs, note, configUsed: cfg })
      await query(
        'INSERT INTO skill_runs (agent_run_id, workspace_id, skill_id, agent_id, status, duration_ms, config_used, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [agentRunId, opts.workspaceId, spec.id, agentId, status, durationMs, JSON.stringify(cfg), note ?? null],
      )
    }

    if (!enabled && !spec.critical) {
      await record('skipped', 'Disabled in Agent Studio')
      bus.publish({ type: 'skill.skipped', agentId, skillId: spec.id, runId: opts.pipelineRunId, message: `${spec.name} skipped (disabled)` })
      continue
    }
    const handler = handlers.get(spec.id)
    if (!handler) {
      await record('skipped', 'No handler registered')
      bus.publish({ type: 'skill.skipped', agentId, skillId: spec.id, runId: opts.pipelineRunId, message: `${spec.name} skipped (no handler registered)` })
      continue
    }

    const notes: string[] = []
    const ctx: SkillContext = {
      workspaceId: opts.workspaceId,
      agentId,
      skillId: spec.id,
      agentRunId,
      pipelineRunId: opts.pipelineRunId,
      config: cfg,
      num: (k) => Number(cfg[k] ?? 0),
      bool: (k) => Boolean(cfg[k]),
      str: (k) => String(cfg[k] ?? ''),
      log: (m) => notes.push(m),
      emit: (type, message, data) => bus.publish({ type, agentId, skillId: spec.id, runId: opts.pipelineRunId, message, data }),
      activity: (message, status = 'ok', entity) => logActivity(opts.workspaceId, agentId, message, status, entity),
    }

    attempted++
    bus.publish({ type: 'skill.started', agentId, skillId: spec.id, runId: opts.pipelineRunId, message: spec.name })
    if (opts.paceMs && opts.paceMs > 0) await sleep(opts.paceMs)
    try {
      const patch = await handler(payload, ctx)
      if (patch) Object.assign(payload, patch)
      succeeded++
      await record('completed', notes.join(' · ') || undefined)
      bus.publish({ type: 'skill.finished', agentId, skillId: spec.id, runId: opts.pipelineRunId, message: notes[notes.length - 1] ?? `${spec.name} done`, data: { durationMs: Date.now() - skillStarted, note: notes.join(' · ') } })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await record('failed', msg)
      bus.publish({ type: 'skill.failed', agentId, skillId: spec.id, runId: opts.pipelineRunId, message: `${spec.name} failed: ${msg}`, data: { critical: Boolean(spec.critical) } })
      if (spec.critical) {
        error = `${spec.name}: ${msg}`
        break
      }
      await logActivity(opts.workspaceId, agentId, `${spec.name} failed (non-critical): ${msg}`, 'warn')
    }
  }

  const durationMs = Date.now() - started
  const status: 'completed' | 'failed' = error ? 'failed' : 'completed'
  const outputCount = typeof payload.outputCount === 'number' ? payload.outputCount : succeeded
  await query(
    'UPDATE agent_runs SET status = $2, finished_at = now(), duration_ms = $3, output_count = $4, error = $5 WHERE id = $1',
    [agentRunId, status, durationMs, outputCount, error ?? null],
  )
  await setAgentState(opts.workspaceId, agentId, {
    status: error ? 'failed' : 'completed',
    currentTask: error ? `Failed: ${error}` : (typeof payload.completionNote === 'string' ? payload.completionNote : `${agent.role} — done`),
    processed: outputCount,
    successRate: attempted ? Math.round((succeeded / attempted) * 100) : 100,
  })
  bus.publish({ type: error ? 'agent.failed' : 'agent.finished', agentId, runId: opts.pipelineRunId, message: error ? `${agent.name} failed: ${error}` : `${agent.name} finished in ${durationMs}ms`, data: { agentRunId, durationMs, skills: records.length } })
  return { agentId, agentRunId, status, payload, skills: records, durationMs, error }
}
