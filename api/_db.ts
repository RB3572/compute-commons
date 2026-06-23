// Shared Neon Postgres access for the serverless API. Files prefixed with `_`
// are not exposed as routes by Vercel, so this is import-only helper code.
import { neon } from '@neondatabase/serverless'

const connectionString = process.env.DATABASE_URL

// `neon()` returns a tagged-template query function; interpolated values are sent
// as bound parameters, so these queries are not vulnerable to SQL injection.
export const sql = connectionString ? neon(connectionString) : null

let schemaReady: Promise<void> | null = null

// Lazily create the table on first use and memoize for the lifetime of the
// (warm) serverless instance. `CREATE TABLE IF NOT EXISTS` is idempotent.
export function ensureSchema(): Promise<void> {
  if (!sql) return Promise.reject(new Error('DATABASE_URL is not configured'))
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS proposals (
          id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          institution        text NOT NULL,
          research_question  text NOT NULL,
          repository         text NOT NULL,
          data_classification text NOT NULL,
          contact_email      text,
          status             text NOT NULL DEFAULT 'pending_review',
          created_at         timestamptz NOT NULL DEFAULT now()
        )
      `
    })().catch((error) => {
      schemaReady = null // allow a retry on the next request after a transient failure
      throw error
    })
  }
  return schemaReady
}

export function isAuthorizedAdmin(authHeader: string | undefined): boolean {
  const token = process.env.ADMIN_TOKEN
  if (!token) return false
  const expected = `Bearer ${token}`
  // Length-then-content check; fine for a shared deployment secret.
  return typeof authHeader === 'string' && authHeader.length === expected.length && authHeader === expected
}
