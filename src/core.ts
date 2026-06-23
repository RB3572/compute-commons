export type SessionStatus = 'ready' | 'verifying' | 'running' | 'paused' | 'complete' | 'stopped' | 'error'

export type SessionState = {
  status: SessionStatus
  completed: number
  elapsedSeconds: number
  aggregate: number
  totalSamples: number   // cumulative Monte Carlo samples actually computed
  busyMs: number         // cumulative CPU-busy time (excludes throttle idle)
  samplesPerSec: number  // last measured single-core throughput during busy slices
  error?: string
}

export type SessionAction =
  | { type: 'RESET' }
  | { type: 'VERIFY' }
  | { type: 'START' }
  | { type: 'RESULT'; estimate: number }
  | { type: 'PROGRESS'; totalSamples: number; busyMs: number; samplesPerSec: number }
  | { type: 'TICK' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'COMPLETE' }
  | { type: 'ERROR'; message: string }

export const initialSession: SessionState = { status: 'ready', completed: 0, elapsedSeconds: 0, aggregate: 0, totalSamples: 0, busyMs: 0, samplesPerSec: 0 }

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'RESET': return { ...initialSession }
    case 'VERIFY': return { ...state, status: 'verifying', error: undefined }
    case 'START': return { ...state, status: 'running', error: undefined }
    case 'RESULT': {
      const completed = state.completed + 1
      return { ...state, completed, aggregate: state.aggregate + (action.estimate - state.aggregate) / completed }
    }
    case 'PROGRESS': return { ...state, totalSamples: action.totalSamples, busyMs: action.busyMs, samplesPerSec: action.samplesPerSec }
    case 'TICK': return state.status === 'running' ? { ...state, elapsedSeconds: state.elapsedSeconds + 1 } : state
    case 'PAUSE': return state.status === 'running' ? { ...state, status: 'paused' } : state
    case 'RESUME': return state.status === 'paused' ? { ...state, status: 'running' } : state
    case 'STOP': return { ...state, status: 'stopped' }
    case 'COMPLETE': return { ...state, status: 'complete' }
    case 'ERROR': return { ...state, status: 'error', error: action.message }
  }
}

// Energy estimate from measured CPU-busy time. Assumes a single active core at an
// indicative ~12 W; explicitly an estimate, not a device-level measurement.
const ASSUMED_CORE_WATTS = 12
export function estimateWattHours(busyMs: number): number {
  return (busyMs / 1000) * ASSUMED_CORE_WATTS / 3600
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return `${value}`
}

export const manifest = {
  id: 'open-climate-ensemble-v1',
  artifact: 'climate-monte-carlo-worker@1.0.0',
  input: 'synthetic-cloud-feedback-v1',
  allowedOrigins: ['self'],
  maxMemoryMb: 32,
  maxWorkUnitMs: 250,
  resultSchema: ['unitId', 'estimate', 'checksum'],
} as const

export async function manifestHash(): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const signingPublicKey: JsonWebKey = {
  key_ops: ['verify'], ext: true, kty: 'EC', crv: 'P-256',
  x: 'j13hI6E1VU3wynD25hu_uUHmgAsgEVgNLTG0JCdDGbE',
  y: 'ow_cRhnVtQH-KuDZDfcxZXg40pvBs354UUuHun0V5UM',
}
const manifestSignature = 'vNWTtW4G2BRSC5UMAyw2Trdm6kfAwY8cyWP1DjDt3kw+FQsO7yfy/8m1ia0VfvRtuiH0SmnRavpXxMI7HA45JA=='

export async function verifyManifest(): Promise<{ hash: string; signatureValid: boolean }> {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest))
  const publicKey = await crypto.subtle.importKey('jwk', signingPublicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const signature = Uint8Array.from(atob(manifestSignature), (character) => character.charCodeAt(0))
  const signatureValid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, bytes)
  return { hash: await manifestHash(), signatureValid }
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const remainder = (seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainder}`
}
