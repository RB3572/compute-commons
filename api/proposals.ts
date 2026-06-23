import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ensureSchema, isAuthorizedAdmin, sql } from './_db.js'

const DATA_CLASSES = ['Public', 'Synthetic'] as const
const REVIEW_STATES = ['pending_review', 'approved', 'rejected'] as const

type Validated = {
  institution: string
  researchQuestion: string
  repository: string
  dataClassification: string
  contactEmail: string | null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// Returns a field-keyed error map, or the cleaned payload when valid.
function validate(body: unknown): { errors: Record<string, string> } | { value: Validated } {
  const b = (body ?? {}) as Record<string, unknown>
  const errors: Record<string, string> = {}

  const institution = str(b.institution)
  if (!institution) errors.institution = 'Institution is required.'
  else if (institution.length > 200) errors.institution = 'Institution is too long.'

  const researchQuestion = str(b.researchQuestion)
  if (!researchQuestion) errors.researchQuestion = 'Research question is required.'
  else if (researchQuestion.length > 2000) errors.researchQuestion = 'Research question is too long.'

  const repository = str(b.repository)
  if (!repository) errors.repository = 'Repository URL is required.'
  else if (repository.length > 500 || !/^https?:\/\/.+\..+/.test(repository)) errors.repository = 'Enter a valid public http(s) URL.'

  const dataClassification = str(b.dataClassification)
  if (!DATA_CLASSES.includes(dataClassification as (typeof DATA_CLASSES)[number])) errors.dataClassification = 'Select a data classification.'

  const contactEmailRaw = str(b.contactEmail)
  let contactEmail: string | null = null
  if (contactEmailRaw) {
    if (contactEmailRaw.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmailRaw)) errors.contactEmail = 'Enter a valid email or leave blank.'
    else contactEmail = contactEmailRaw
  }

  if (b.confirmed !== true) errors.confirmed = 'You must confirm the proposal excludes personal data and prohibited uses.'

  if (Object.keys(errors).length) return { errors }
  return { value: { institution, researchQuestion, repository, dataClassification, contactEmail } }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!sql) {
    res.status(503).json({ error: 'The proposal service is not configured. DATABASE_URL is missing.' })
    return
  }

  try {
    await ensureSchema()

    if (req.method === 'POST') {
      const result = validate(req.body)
      if ('errors' in result) {
        res.status(400).json({ error: 'Please correct the highlighted fields.', fields: result.errors })
        return
      }
      const { institution, researchQuestion, repository, dataClassification, contactEmail } = result.value
      const rows = await sql`
        INSERT INTO proposals (institution, research_question, repository, data_classification, contact_email)
        VALUES (${institution}, ${researchQuestion}, ${repository}, ${dataClassification}, ${contactEmail})
        RETURNING id, status, created_at
      `
      const row = rows[0]
      res.status(201).json({ id: row.id, status: row.status, createdAt: row.created_at })
      return
    }

    if (req.method === 'GET') {
      if (!isAuthorizedAdmin(req.headers.authorization)) {
        res.status(process.env.ADMIN_TOKEN ? 401 : 503).json({ error: process.env.ADMIN_TOKEN ? 'Unauthorized.' : 'Admin review is not configured (ADMIN_TOKEN missing).' })
        return
      }
      const rows = await sql`
        SELECT id, institution, research_question, repository, data_classification, contact_email, status, created_at
        FROM proposals ORDER BY created_at DESC LIMIT 500
      `
      res.status(200).json({ proposals: rows })
      return
    }

    if (req.method === 'PATCH') {
      if (!isAuthorizedAdmin(req.headers.authorization)) {
        res.status(401).json({ error: 'Unauthorized.' })
        return
      }
      const id = str(req.query.id)
      const status = str((req.body as Record<string, unknown>)?.status)
      if (!id) { res.status(400).json({ error: 'Missing proposal id.' }); return }
      if (!REVIEW_STATES.includes(status as (typeof REVIEW_STATES)[number])) { res.status(400).json({ error: 'Invalid status.' }); return }
      const rows = await sql`UPDATE proposals SET status = ${status} WHERE id = ${id} RETURNING id, status`
      if (!rows.length) { res.status(404).json({ error: 'Proposal not found.' }); return }
      res.status(200).json({ id: rows[0].id, status: rows[0].status })
      return
    }

    res.setHeader('Allow', 'GET, POST, PATCH')
    res.status(405).json({ error: 'Method not allowed.' })
  } catch (error) {
    console.error('proposals handler error', error)
    res.status(500).json({ error: 'An unexpected error occurred handling the proposal.' })
  }
}
