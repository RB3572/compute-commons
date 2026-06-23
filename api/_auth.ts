// Reviewer-console authorization via Google Sign-In. The browser obtains a Google
// ID token (a signed JWT) and sends it as a bearer token; here we verify the
// signature/audience against Google and require the email to be on the allowlist.
import { OAuth2Client } from 'google-auth-library'

// Public OAuth Web client ID. Safe to ship in the client and to default here.
const CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  '804091048275-lng855r6ncg7i8is9d82evtq7rjv7m52.apps.googleusercontent.com'

// Comma-separated allowlist of reviewer emails. Defaults to the project owner.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'rishi.bhargav@gmail.com')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)

const client = new OAuth2Client(CLIENT_ID)

export type AuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403; error: string }

export async function authorizeAdmin(authHeader: string | undefined): Promise<AuthResult> {
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Sign in with Google to access the reviewer console.' }
  }
  const idToken = authHeader.slice('Bearer '.length).trim()
  if (!idToken) return { ok: false, status: 401, error: 'Missing Google credential.' }

  let email: string | undefined
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email || !payload.email_verified) {
      return { ok: false, status: 403, error: 'This Google account has no verified email.' }
    }
    email = payload.email.toLowerCase()
  } catch {
    return { ok: false, status: 401, error: 'Your Google session is invalid or expired. Sign in again.' }
  }

  if (!ADMIN_EMAILS.includes(email)) {
    return { ok: false, status: 403, error: `${email} is not authorized for the reviewer console.` }
  }
  return { ok: true, email }
}

export const adminClientId = CLIENT_ID
