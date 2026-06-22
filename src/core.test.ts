import { describe, expect, it } from 'vitest'
import { formatDuration, initialSession, sessionReducer, verifyManifest } from './core'

describe('session reducer', () => {
  it('requires an explicit start transition', () => {
    expect(initialSession.status).toBe('ready')
    expect(sessionReducer(initialSession, { type: 'START' }).status).toBe('running')
  })

  it('does not count time while paused', () => {
    const paused = { ...initialSession, status: 'paused' as const, elapsedSeconds: 4 }
    expect(sessionReducer(paused, { type: 'TICK' }).elapsedSeconds).toBe(4)
  })

  it('aggregates completed estimates', () => {
    const one = sessionReducer({ ...initialSession, status: 'running' }, { type: 'RESULT', estimate: 1 })
    const two = sessionReducer(one, { type: 'RESULT', estimate: 3 })
    expect(two.completed).toBe(2)
    expect(two.aggregate).toBe(2)
  })
})

it('formats elapsed time', () => expect(formatDuration(65)).toBe('01:05'))

it('verifies the signed workload manifest', async () => {
  const result = await verifyManifest()
  expect(result.signatureValid).toBe(true)
  expect(result.hash).toHaveLength(64)
})
