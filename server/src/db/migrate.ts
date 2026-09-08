import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closePool, getPool, one, query } from './pool'
import { env } from '../config'
import { ensureVectorStore } from './vector-store'

const here = dirname(fileURLToPath(import.meta.url))

export async function migrate(): Promise<void> {
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8')
  await getPool().query(sql)
  // The corpus vector store is generated from env().embeddings rather than schema.sql
  // because its column width and index depend on configuration. It is additive, so a
  // missing pgvector extension degrades the corpus feature instead of blocking boot.
  try {
    const store = await ensureVectorStore()
    console.log(`[migrate] vector store ready · pgvector ${store.extension} · vector(${store.dimensions}) · ${store.metric} · ${store.indexKind}${store.indexRebuilt ? ' (index rebuilt)' : ''}`)
  } catch (err) {
    console.warn(`[migrate] vector store unavailable — corpus embeddings are disabled: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function dropEverything(): Promise<void> {
  await getPool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
}

export async function ensureWorkspace(slug = env().workspaceSlug): Promise<string> {
  const existing = await one<{ id: string }>('SELECT id FROM workspaces WHERE slug = $1', [slug])
  if (existing) return existing.id
  const rows = await query<{ id: string }>(
    `INSERT INTO workspaces (name, slug, brand_voice, audience)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    ['Ethara.AI · Main', slug, 'Research-credible, anti-hype, confident, declarative, plain natural English.', 'AI researchers, ML engineers and engineering leaders evaluating post-training and agentic systems.'],
  )
  return rows[0].id
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  migrate()
    .then(() => ensureWorkspace())
    .then((id) => { console.log(`[migrate] schema applied · workspace ${id}`); return closePool() })
    .catch((err) => { console.error('[migrate] failed', err); process.exit(1) })
}
