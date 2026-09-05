// node-cron jobs. Every scheduled job is also manually triggerable through the API.
import cron from 'node-cron'
import { env } from './config'
import { buildKnowledge, currentWorkspaceId } from './orchestrator'

let task: cron.ScheduledTask | null = null

export function startSchedulers(): { cron: string; tz: string; valid: boolean } {
  const { knowledge, tz } = env()
  const valid = cron.validate(knowledge.cron)
  if (!valid) {
    console.warn(`[scheduler] KNOWLEDGE_BUILD_CRON "${knowledge.cron}" is invalid — the Sunday build will not run automatically`)
    return { cron: knowledge.cron, tz, valid }
  }
  task?.stop()
  task = cron.schedule(knowledge.cron, async () => {
    try {
      const workspaceId = await currentWorkspaceId()
      console.log('[scheduler] Sunday knowledge build starting')
      await buildKnowledge({ workspaceId, trigger: 'cron', hashtagCount: knowledge.hashtagCount })
    } catch (err) {
      console.error('[scheduler] knowledge build failed', err)
    }
  }, { timezone: tz })
  console.log(`[scheduler] knowledge build registered · "${knowledge.cron}" (${tz})`)
  return { cron: knowledge.cron, tz, valid }
}

/** Next Sunday 06:00 in the configured zone, described for the UI. */
export function nextKnowledgeBuild(): string {
  const now = new Date()
  const next = new Date(now)
  next.setHours(6, 0, 0, 0)
  const daysUntilSunday = (7 - now.getDay()) % 7
  next.setDate(now.getDate() + (daysUntilSunday === 0 && now.getHours() >= 6 ? 7 : daysUntilSunday))
  return next.toISOString()
}
