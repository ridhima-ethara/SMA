// Boot: assertConnection → migrate/seed → auditSkillCoverage → schedulers → listen.
import cors from 'cors'
import express from 'express'
import { env } from './config'
import { api } from './api'
import { assertConnection } from './db/pool'
import { migrate } from './db/migrate'
import { seed } from './db/seed'
import { auditSkillCoverage } from './agents/skills'
import { REGISTRY_SUMMARY, validateRegistry } from '../../shared/agent-registry'
import { startSchedulers } from './scheduler'
import { currentWorkspaceId } from './orchestrator'

async function main() {
  const cfg = env()
  await assertConnection()
  await migrate()
  await seed() // no-op when the workspace is already seeded
  await currentWorkspaceId()

  const registryProblems = validateRegistry()
  if (registryProblems.length) throw new Error(`Agent registry is invalid:\n${registryProblems.join('\n')}`)
  const coverage = auditSkillCoverage()
  if (coverage.missingCritical.length) throw new Error(`Critical skills have no handler: ${coverage.missingCritical.join(', ')}`)
  console.log(`[boot] registry: ${REGISTRY_SUMMARY.agents} agents · ${REGISTRY_SUMMARY.skills} skills · ${REGISTRY_SUMMARY.knobs} knobs · handlers for ${coverage.covered}/${REGISTRY_SUMMARY.skills}${coverage.missing.length ? ` (missing non-critical: ${coverage.missing.join(', ')})` : ''}`)

  startSchedulers()

  const app = express()
  app.use(cors({ origin: cfg.corsOrigin === '*' ? true : cfg.corsOrigin.split(',').map((s) => s.trim()) }))
  app.use(express.json({ limit: '12mb' }))
  app.use('/api', api)
  app.get('/', (_req, res) => res.json({ name: 'Ethara.AI Social Media Agent API', health: '/api/health', events: '/api/events' }))
  app.listen(cfg.port, () => console.log(`[boot] API listening on http://localhost:${cfg.port}/api · publish mode ${cfg.publishMode}`))
}

main().catch((err) => {
  console.error('[boot] failed', err)
  process.exit(1)
})
