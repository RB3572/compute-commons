// Compute Commons worker — runs one of three genuinely CPU-bound, deterministic
// medical-research demo kernels with cooperative duty-cycle throttling. The host
// sends one `start` message naming a kernel; the worker drives itself, pegging a
// single core during each busy slice and sleeping between slices so average
// utilization tracks the requested CPU percentage.
//
// Every kernel is an ILLUSTRATIVE SAMPLE over SYNTHETIC inputs, shaped like the real
// science it is modeled on — not publishable results. Each is seeded by mulberry32
// per unit so results are reproducible (same unitId → identical estimate + checksum).

type KernelId = 'cardiacAP' | 'peptideMHCDock' | 'markerPanel'

type StartRequest = {
  type: 'start'
  cpuPercent: number
  kernelId: KernelId
  startUnit: number
  totalUnits: number
}
type ControlRequest = { type: 'stop' } | { type: 'setCpu'; cpuPercent: number }
type WorkRequest = StartRequest | ControlRequest

type ProgressMessage = {
  type: 'progress'
  unitId: number
  cumulativeSamples: number   // inner work items processed (cells / peptides / panels)
  busyMs: number
  samplesPerSec: number
}
type UnitMessage = { type: 'unit'; unitId: number; estimate: number; checksum: number }
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

type Unit = { process(start: number, end: number): void; result(): { estimate: number; checksum: number } }
type Kernel = { unitWork: number; chunkWork: number; prepare?(): void; makeUnit(unitId: number): Unit }

// ── Kernel 1: cardiacAP — stochastic ventricular action-potential ensemble ───────
// One drug block-profile + dose per unit; many seeded virtual cells. A cell is flagged
// for early-afterdepolarization (EAD) risk when IKr block prolongs its plateau past a
// safe window — the cellular substrate for torsades de pointes. Estimate = EAD fraction.
const CARDIAC = { CELLS: 5000, STEPS: 300, chunkWork: 128, caScale: 1.5, kr: 0.09, noise: 3.0, apdThreshold: 38 }

function cardiacUnit(unitId: number): Unit {
  const p0 = mulberry32(unitId)
  const bKr = 0.2 + 0.6 * p0(), bNa = 0.1 + 0.5 * p0(), bCaL = 0.1 + 0.4 * p0()
  const dose = [0.5, 1, 2, 4][unitId % 4]
  const block = Math.min(0.985, dose * bKr * 0.6)
  let eadCount = 0
  let checksum = 0
  return {
    process(start, end) {
      for (let c = start; c < end; c += 1) {
        const rng = mulberry32(unitId * 100003 + c)
        let V = 25, gKr = 0, plateau = 0
        for (let t = 0; t < CARDIAC.STEPS; t += 1) {
          gKr += 0.02 * (1 - gKr)
          const iKr = gKr * (1 - block) * CARDIAC.kr * (V + 85)
          const z = (V + 8) / 16
          const iCaL = CARDIAC.caScale * (1 - 0.3 * bCaL) * Math.exp(-z * z)
          const iK1 = 0.025 * (V + 85)
          const iNaL = 0.1 * (1 - dose * bNa * 0.3) * (V > -60 ? 1 : 0)
          V += -iKr - iK1 + iCaL + iNaL + CARDIAC.noise * (rng() - 0.5)
          if (V > 50) V = 50; else if (V < -90) V = -90
          if (V > -40) plateau += 1
        }
        if (plateau > CARDIAC.apdThreshold) eadCount += 1
        checksum = (checksum + (Math.floor(1e6 * Math.abs(V)) >>> 0)) >>> 0
      }
    },
    result() { return { estimate: eadCount / CARDIAC.CELLS, checksum } },
  }
}

// ── Kernel 2: peptideMHCDock — structure-based peptide-MHC pose search ────────────
// Per unit, a batch of synthetic 9-mer peptides Monte-Carlo docked into a fixed MHC
// groove; the best pose maps to an IC50-like affinity. Estimate = binder fraction.
const PEPTIDE = { PEPTIDES: 8000, STEPS: 80, chunkWork: 256, tau: -1.044, k: 2.2 }
const ANCHOR2 = [0.6, -0.2, 0.1], ANCHOR9 = [0.7, 0.1, -0.3]

function peptideUnit(unitId: number): Unit {
  let binders = 0
  let checksum = 0
  return {
    process(start, end) {
      for (let pep = start; pep < end; pep += 1) {
        const rng = mulberry32(unitId * 100003 + pep)
        // residue 2 (index 1) and residue 9 (index 8) are the MHC anchor positions
        const a0 = rng() * 2 - 1, a1 = rng() * 2 - 1, a2 = rng() * 2 - 1
        for (let i = 0; i < 18; i += 1) rng() // advance past non-anchor residues 3..8 (deterministic)
        const b0 = rng() * 2 - 1, b1 = rng() * 2 - 1, b2 = rng() * 2 - 1
        let best = -Infinity
        for (let s = 0; s < PEPTIDE.STEPS; s += 1) {
          const d20 = a0 + 0.22 * (rng() * 2 - 1) - ANCHOR2[0]
          const d21 = a1 + 0.22 * (rng() * 2 - 1) - ANCHOR2[1]
          const d22 = a2 + 0.22 * (rng() * 2 - 1) - ANCHOR2[2]
          const d90 = b0 + 0.22 * (rng() * 2 - 1) - ANCHOR9[0]
          const d91 = b1 + 0.22 * (rng() * 2 - 1) - ANCHOR9[1]
          const d92 = b2 + 0.22 * (rng() * 2 - 1) - ANCHOR9[2]
          const score = -1.0 * (d20 * d20 + d21 * d21 + d22 * d22) - 1.2 * (d90 * d90 + d91 * d91 + d92 * d92)
          if (score > best) best = score
        }
        const ic50 = Math.min(50000, Math.max(1, 500 * Math.exp(-PEPTIDE.k * (best - PEPTIDE.tau))))
        if (ic50 < 500) binders += 1
        checksum = (checksum + (Math.round(Math.log(ic50) * 1000) >>> 0)) >>> 0
      }
    },
    result() { return { estimate: binders / PEPTIDE.PEPTIDES, checksum } },
  }
}

// ── Kernel 3: markerPanel — combinatorial gene-panel search over a fixed cohort ───
// A synthetic patient × gene cohort (identical for every unit) with a few informative
// genes planted in noise. Each unit scores a disjoint batch of candidate 3-gene panels
// by a rank-based AUC. Estimate = best tumor-vs-normal separation found.
const MARKER = { PANELS: 15000, chunkWork: 256, PATIENTS: 120, GENES: 200, TUMOR: 60 }
let cohort: { expr: Float64Array; genes: number } | null = null

function buildCohort() {
  const pc = mulberry32(0x00c0ffee)
  const { PATIENTS, GENES, TUMOR } = MARKER
  const expr = new Float64Array(PATIENTS * GENES)
  for (let p = 0; p < PATIENTS; p += 1) {
    const tumor = p < TUMOR
    for (let g = 0; g < GENES; g += 1) {
      // Box–Muller standard normal
      const u = Math.max(1e-9, pc()), v = pc()
      let e = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
      if (tumor && g < 10) e += 0.4 + 0.05 * g // planted informative genes 0..9
      expr[p * GENES + g] = e
    }
  }
  cohort = { expr, genes: GENES }
}

function markerUnit(unitId: number): Unit {
  const rng = mulberry32(unitId)
  let bestAUC = 0
  let checksum = 0
  return {
    process(start, end) {
      const c = cohort!
      const G = c.genes, expr = c.expr
      const { TUMOR, PATIENTS } = MARKER
      for (let i = start; i < end; i += 1) {
        let g0 = Math.floor(rng() * G), g1 = Math.floor(rng() * G), g2 = Math.floor(rng() * G)
        if (g1 === g0) g1 = (g1 + 1) % G
        if (g2 === g0 || g2 === g1) g2 = (g2 + 2) % G
        let concordant = 0
        for (let a = 0; a < TUMOR; a += 1) {
          const st = expr[a * G + g0] + expr[a * G + g1] + expr[a * G + g2]
          for (let b = TUMOR; b < PATIENTS; b += 1) {
            const sn = expr[b * G + g0] + expr[b * G + g1] + expr[b * G + g2]
            concordant += st > sn ? 1 : st === sn ? 0.5 : 0
          }
        }
        const auc = concordant / (TUMOR * (PATIENTS - TUMOR))
        if (auc > bestAUC) bestAUC = auc
        checksum = (Math.imul(checksum, 31) + Math.floor(auc * 1e6)) >>> 0
      }
    },
    result() { return { estimate: bestAUC, checksum } },
  }
}

const KERNELS: Record<KernelId, Kernel> = {
  cardiacAP: { unitWork: CARDIAC.CELLS, chunkWork: CARDIAC.chunkWork, makeUnit: cardiacUnit },
  peptideMHCDock: { unitWork: PEPTIDE.PEPTIDES, chunkWork: PEPTIDE.chunkWork, makeUnit: peptideUnit },
  markerPanel: { unitWork: MARKER.PANELS, chunkWork: MARKER.chunkWork, prepare: buildCohort, makeUnit: markerUnit },
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
let running = false
let cpuPercent = 25

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

async function run(req: StartRequest) {
  running = true
  cpuPercent = clampCpu(req.cpuPercent)
  const kernel = KERNELS[req.kernelId]
  if (!kernel) { running = false; return }
  kernel.prepare?.()

  let cumulativeSamples = 0
  let cumulativeBusyMs = 0
  let lastProgress = now()

  for (let unitId = req.startUnit; unitId < req.totalUnits; unitId += 1) {
    const unit = kernel.makeUnit(unitId)
    let done = 0
    while (done < kernel.unitWork) {
      if (!running) return
      const end = Math.min(done + kernel.chunkWork, kernel.unitWork)
      const items = end - done

      const startedAt = now()
      unit.process(done, end)
      const busyMs = now() - startedAt

      done = end
      cumulativeSamples += items
      cumulativeBusyMs += busyMs

      // Cooperative duty-cycle throttle: idle busyMs*(100-p)/p after each busy slice.
      if (cpuPercent < 100) {
        const idleMs = busyMs * (100 - cpuPercent) / cpuPercent
        if (idleMs > 0.5) await sleep(idleMs)
      } else {
        await sleep(0) // yield so stop/setCpu messages are processed
      }
      if (!running) return

      if (now() - lastProgress > 100) {
        const samplesPerSec = busyMs > 0 ? Math.round(items / (busyMs / 1000)) : 0
        post({ type: 'progress', unitId, cumulativeSamples, busyMs: cumulativeBusyMs, samplesPerSec })
        lastProgress = now()
      }
    }

    const { estimate, checksum } = unit.result()
    post({ type: 'unit', unitId, estimate, checksum })
  }

  running = false
  post({ type: 'done', cumulativeSamples, busyMs: cumulativeBusyMs })
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
