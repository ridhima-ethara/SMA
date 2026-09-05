import pg from 'pg'
import { env } from '../config'

const { Pool } = pg

// NUMERIC and BIGINT come back as JS numbers — the app never needs arbitrary precision.
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v))
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10))

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env().databaseUrl, max: 12 })
    pool.on('error', (err) => console.error('[db] idle client error', err.message))
  }
  return pool
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query<T>(text, params)
  return res.rows
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function assertConnection(): Promise<void> {
  await getPool().query('SELECT 1')
}

export async function closePool(): Promise<void> {
  if (pool) await pool.end()
  pool = null
}
