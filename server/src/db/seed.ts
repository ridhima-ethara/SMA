// Seed — configuration only. No sample content: keywords, sources, competitors, the 20 brand rules and idle agent state.
import { fileURLToPath } from 'node:url'
import { AGENTS } from '../../../shared/agent-registry'
import { BRAND_RULES } from '../../../shared/brand-voice'
import { SEED_KEYWORDS } from '../../../shared/keywords'
import { COMPETITORS, SEED_SOURCES } from '../agents/corpus'
import { dropEverything, ensureWorkspace, migrate } from './migrate'
import { closePool, one, query } from './pool'

const CATEGORY_FOR_AREA: Record<string, string> = { 'Voice & Positioning': 'Brand Voice', 'Factual & Content': 'Brand Guideline', Visual: 'Visual Identity', 'Candidate & Risk': 'Compliance Rule' }

export async function seed(opts: { reset?: boolean; force?: boolean } = {}): Promise<void> {
  if (opts.reset) { await dropEverything(); await migrate() } else await migrate()
  const ws = await ensureWorkspace()
  const existing = await one<{ n: number }>('SELECT count(*)::int AS n FROM keywords WHERE workspace_id = $1', [ws])
  if ((existing?.n ?? 0) > 0 && !opts.force) { console.log('[seed] workspace already configured — skipping (use --reset to rebuild)'); return }

  for (const k of SEED_KEYWORDS) await query('INSERT INTO keywords (workspace_id, term, category, weight, active) VALUES ($1,$2,$3,$4,true) ON CONFLICT DO NOTHING', [ws, k.term, k.category, k.weight])
  for (const s of SEED_SOURCES) await query('INSERT INTO sources (workspace_id, name, kind, source_type, url, trusted, enabled) VALUES ($1,$2,$3,$4,$5,$6,true) ON CONFLICT (workspace_id, name) DO NOTHING', [ws, s.name, s.kind, s.sourceType, s.url, s.trusted])
  for (const c of COMPETITORS) await query('INSERT INTO sources (workspace_id, name, kind, source_type, url, trusted, enabled, tier) VALUES ($1,$2,$3,$4,$5,false,true,$6) ON CONFLICT (workspace_id, name) DO UPDATE SET tier = EXCLUDED.tier', [ws, c.name, 'linkedin', 'Competitor', c.url, c.tier])
  // The brand lives in the same table as every learned preference, so switching a rule off genuinely stops it influencing generation.
  for (const r of BRAND_RULES) await query('INSERT INTO knowledge_entries (workspace_id, title, category, content, source, sources, tags, confidence, evidence_count, active, origin, rule_n) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,true,$9,$10)', [ws, `Rule ${r.n} · ${r.title}`, CATEGORY_FOR_AREA[r.area], r.text, 'Brand definition', '[]', ['brand', r.enforcement, 'priority'], 'High', 'brand', r.n])
  for (const a of AGENTS) await query('INSERT INTO agent_state (workspace_id, agent_id, status, current_task) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [ws, a.id, 'idle', 'Idle'])
  await query('INSERT INTO activity_events (workspace_id, agent_id, message, status) VALUES ($1,$2,$3,$4)', [ws, 'system', 'Workspace configured: keyword set, sources and the 20 brand rules loaded. Run the Scraping Agent to start the pipeline.', 'ok'])
  console.log(`[seed] configured · ${SEED_KEYWORDS.length} keywords · ${SEED_SOURCES.length + COMPETITORS.length} sources · ${BRAND_RULES.length} brand rules`)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const reset = process.argv.includes('--reset')
  seed({ reset, force: reset })
    .then(() => closePool())
    .catch((err) => { console.error('[seed] failed', err); process.exit(1) })
}
