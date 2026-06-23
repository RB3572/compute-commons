// Compute Commons worker — continuous, genuinely CPU-bound Monte Carlo work with
// cooperative duty-cycle throttling. The host sends one `start` message; the worker
// drives itself, pegging a single core during each busy slice and sleeping between
// slices so that average utilization tracks the requested CPU percentage.

type StartRequest = {
  type: 'start'
  cpuPercent: number
  startUnit: number
  totalUnits: number
  samplesPerUnit: number
  chunkSamples: number
}
type ControlRequest = { type: 'stop' } | { type: 'setCpu'; cpuPercent: number }
type WorkRequest = StartRequest | ControlRequest

type ProgressMessage = {
  type: 'progress'
  unitId: number
  unitSamples: number
  cumulativeSamples: number
  busyMs: number
  samplesPerSec: number // measured throughput during busy slices (true core speed)
}
type UnitMessage = { type: 'unit'; unitId: number; estimate: number; checksum: number; samples: number }
type DoneMessage = { type: 'done'; cumulativeSamples: number; busyMs: number }
export type WorkerMessage = ProgressMessage | UnitMessage | DoneMessage

function mulberry32(seed: number) {
  return function random() {
    let value = (seed += 0x6d2b79f5)
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

// One chunk of real floating-point work. Returns the partial sum so the optimizer
// cannot eliminate the loop, and so results stay deterministic per seed.
function computeChunk(random: () => number, samples: number): number {
  let sum = 0
  for (let index = 0; index < samples; index += 1) {
    const lowCloudResponse = 0.74 + random() * 0.52
    const forcing = 0.8 + random() * 0.4
    sum += lowCloudResponse * forcing
  }
  return sum
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let running = false
let cpuPercent = 25

async function run(req: StartRequest) {
  running = true
  cpuPercent = clampCpu(req.cpuPercent)
  const { totalUnits, samplesPerUnit, chunkSamples } = req

  let cumulativeSamples = 0
  let cumulativeBusyMs = 0
  let lastProgress = now()

  for (let unitId = req.startUnit; unitId < totalUnits; unitId += 1) {
    const random = mulberry32(unitId + 104729)
    let unitSum = 0
    let unitSamples = 0

    while (unitSamples < samplesPerUnit) {
      if (!running) return
      const samples = Math.min(chunkSamples, samplesPerUnit - unitSamples)

      const startedAt = now()
      unitSum += computeChunk(random, samples)
      const busyMs = now() - startedAt

      unitSamples += samples
      cumulativeSamples += samples
      cumulativeBusyMs += busyMs

      // Cooperative duty-cycle throttle: to hold an average load of `cpuPercent`,
      // for every `busyMs` of computation we idle `busyMs * (100 - p) / p`.
      if (cpuPercent < 100) {
        const idleMs = busyMs * (100 - cpuPercent) / cpuPercent
        if (idleMs > 0.5) await sleep(idleMs)
      } else {
        await sleep(0) // yield so `stop`/`setCpu` messages are processed
      }
      if (!running) return

      // Throttle progress posts to ~10/sec to avoid flooding the main thread.
      if (now() - lastProgress > 100) {
        const samplesPerSec = busyMs > 0 ? Math.round(samples / (busyMs / 1000)) : 0
        post({ type: 'progress', unitId, unitSamples, cumulativeSamples, busyMs: cumulativeBusyMs, samplesPerSec })
        lastProgress = now()
      }
    }

    const estimate = unitSum / samplesPerUnit
    const checksum = (Math.round(estimate * 1_000_000) ^ unitId) >>> 0
    post({ type: 'unit', unitId, estimate, checksum, samples: samplesPerUnit })
  }

  running = false
  post({ type: 'done', cumulativeSamples, busyMs: cumulativeBusyMs })
}

function clampCpu(value: number): number {
  if (!Number.isFinite(value)) return 25
  return Math.min(100, Math.max(1, Math.round(value)))
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0
}

function post(message: WorkerMessage) {
  ;(self as unknown as Worker).postMessage(message)
}

self.onmessage = ({ data }: MessageEvent<WorkRequest>) => {
  if (data.type === 'start') {
    if (!running) void run(data)
  } else if (data.type === 'stop') {
    running = false
  } else if (data.type === 'setCpu') {
    cpuPercent = clampCpu(data.cpuPercent)
  }
}
