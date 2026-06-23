import { describe, expect, it } from 'vitest'
import { formatCount, formatDuration, getProject, initialSession, projects, sessionReducer, verifyManifest } from './core'

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

  it('resets to the initial session', () => {
    const dirty = { ...initialSession, status: 'complete' as const, completed: 24, totalSamples: 99 }
    expect(sessionReducer(dirty, { type: 'RESET' })).toEqual(initialSession)
  })
})

it('formats elapsed time', () => expect(formatDuration(65)).toBe('01:05'))
it('formats large counts', () => { expect(formatCount(2_400_000)).toBe('2.4M'); expect(formatCount(12_000)).toBe('12k') })

describe('workload catalog', () => {
  it('ships three distinct medical projects with distinct kernels', () => {
    expect(projects).toHaveLength(3)
    expect(new Set(projects.map((p) => p.id)).size).toBe(3)
    expect(new Set(projects.map((p) => p.manifest.kernelId)).size).toBe(3)
  })

  it('resolves projects by id and falls back safely', () => {
    expect(getProject(projects[1].id).id).toBe(projects[1].id)
    expect(getProject('nope').id).toBe(projects[0].id)
  })

  it('verifies the signed manifest of every project', async () => {
    for (const project of projects) {
      const result = await verifyManifest(project.id)
      expect(result.signatureValid).toBe(true)
      expect(result.hash).toHaveLength(64)
    }
  })
})
