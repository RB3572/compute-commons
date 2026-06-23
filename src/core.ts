export type SessionStatus = 'ready' | 'verifying' | 'running' | 'paused' | 'complete' | 'stopped' | 'error'

export type SessionState = {
  status: SessionStatus
  completed: number
  elapsedSeconds: number
  aggregate: number
  totalSamples: number   // cumulative inner work items actually computed (cells / peptides / panels)
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

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const remainder = (seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainder}`
}

// --- Workload catalog ----------------------------------------------------------

export type KernelId = 'cardiacAP' | 'peptideMHCDock' | 'markerPanel'

export type Manifest = {
  id: string
  artifact: string
  input: string
  kernelId: KernelId
  allowedOrigins: string[]
  maxMemoryMb: number
  maxWorkUnitMs: number
  resultSchema: string[]
}

export type Project = {
  id: string
  name: string
  disease: string
  area: string
  institution: string
  tagline: string
  researchQuestion: string
  realWorldBasis: string
  whyBrowserCompute: string
  methodology: string
  whatRunsInBrowser: string[]
  worldImpact: string
  workUnitNoun: string
  estimateLabel: string
  kernelSummary: string
  kernelCode: string
  manifest: Manifest
}

export const projects: Project[] = [
  {
    id: 'cardiac-ead-arrhythmia-risk-v1',
    name: 'Beat the Block',
    disease: 'Drug-induced arrhythmia (acquired Long-QT / torsades de pointes)',
    area: 'Cardiovascular safety',
    institution: 'UC Davis Cardiac Systems Modeling Group (illustrative; aligned with the FDA-led CiPA initiative)',
    tagline: 'Crowd-simulate virtual heart cells to flag drugs that could trigger deadly arrhythmias.',
    researchQuestion: 'For a candidate drug at a given dose, what fraction of a stochastic ensemble of virtual heart cells develops an early afterdepolarization — the cellular trigger for torsades de pointes — and how does that risk scale with dose?',
    realWorldBasis: 'Modeled on the FDA-led Comprehensive in vitro Proarrhythmia Assay (CiPA) and the O’Hara–Rudy human ventricular cell model with a hERG/IKr drug-binding submodel. A detailed stochastic single-cell run can take hours on one PC, so ensemble sampling is the bottleneck. The browser kernel is an illustrative sample shaped like this science — a reduced surrogate action potential with injected gating noise — not publishable regulatory results.',
    whyBrowserCompute: 'Whether a cell tips into an afterdepolarization is a stochastic threshold event, so a single drug-dose needs hundreds-to-thousands of independent cell runs with different gating seeds. Every cell is fully independent and reduces to one 0/1 outcome plus a checksum — the canonical embarrassingly-parallel Monte Carlo shape.',
    methodology: 'Instead of one perfect heart cell, we simulate a crowd of slightly-random virtual heart cells reacting to a drug and count how many start to “stutter” (an early afterdepolarization, the spark behind a dangerous arrhythmia). Your browser runs a batch of these cells for one drug at one dose; many browsers together build a dose-vs-risk curve.',
    whatRunsInBrowser: [
      'A bounded ensemble of synthetic single-cell action-potential traces, each with its own seeded ion-channel gating noise, advanced with a simple explicit time-stepper.',
      'A per-cell detector that flags prolonged repolarization (the action potential spends too long depolarized — the substrate for early afterdepolarizations) and turns each trace into a 0/1 outcome.',
      'Aggregation into an early-afterdepolarization risk fraction for the assigned drug-block profile and dose, plus an integer checksum over final voltages.',
    ],
    worldImpact: 'Cardiotoxicity is a leading cause of late-stage drug failure and post-market withdrawals. Cheaper, mechanistic in-silico torsade-risk screening lets safe drugs advance and dangerous ones be caught before human trials — without animal or human testing.',
    workUnitNoun: 'drug-dose myocyte ensemble',
    estimateLabel: 'Mean EAD risk fraction across drug-doses',
    kernelSummary: 'Stochastic action-potential time-stepper: integrate many seeded virtual heart cells and count early afterdepolarizations.',
    kernelCode: `// Per work unit: one drug-block profile + dose, thousands of virtual cells.
const p0 = mulberry32(unitId)
const bKr = 0.2 + 0.6*p0(), bNa = 0.1 + 0.5*p0(), bCaL = 0.1 + 0.4*p0()
const dose  = [0.5, 1, 2, 4][unitId % 4]
const block = Math.min(0.985, dose * bKr * 0.6)      // IKr (hERG) block fraction
for (let c = 0; c < CELLS; c++) {
  const rng = mulberry32(unitId * 100003 + c)
  let V = 25, gKr = 0, plateau = 0
  for (let t = 0; t < STEPS; t++) {
    gKr += 0.02 * (1 - gKr)
    const iKr  = gKr * (1 - block) * 0.09 * (V + 85)  // repolarizing; block slows it
    const z = (V + 8) / 16
    const iCaL = 1.5 * (1 - 0.3*bCaL) * Math.exp(-z*z)// depolarizing L-type Ca window
    const iK1  = 0.025 * (V + 85)
    const iNaL = 0.1 * (1 - dose*bNa*0.3) * (V > -60 ? 1 : 0)
    V += -iKr - iK1 + iCaL + iNaL + 3.0 * (rng() - 0.5)  // gating noise
    if (V > 50) V = 50; else if (V < -90) V = -90
    if (V > -40) plateau++                            // time spent depolarized (APD proxy)
  }
  if (plateau > 38) eadCount++   // prolonged repolarization = EAD / torsade substrate
}
estimate = eadCount / CELLS                          // synthetic EAD risk fraction`,
    manifest: {
      id: 'cardiac-ead-arrhythmia-risk-v1',
      artifact: 'cardiac-ead-myocyte-worker@1.0.0',
      input: 'synthetic-drug-block-dose-grid-v1',
      kernelId: 'cardiacAP',
      allowedOrigins: ['self'],
      maxMemoryMb: 32,
      maxWorkUnitMs: 250,
      resultSchema: ['unitId', 'estimate', 'checksum'],
    },
  },
  {
    id: 'neoantigen-mhc-binding-screen-v1',
    name: 'Flag the Neoantigen',
    disease: 'Cancer immunotherapy (personalized therapeutic cancer vaccines)',
    area: 'Cancer immunotherapy',
    institution: 'Computational Immunotherapy Group, Institute for Protein Design style (illustrative)',
    tagline: 'Fold synthetic tumor peptides into the immune system’s display groove to flag vaccine targets.',
    researchQuestion: 'Among the hundreds of mutated peptides a tumor produces, which bind tightly enough to a patient’s MHC Class I molecules to be displayed and seen by killer T cells — i.e. which are true neoantigens worth putting in a personalized cancer vaccine?',
    realWorldBasis: 'Modeled on the Rosetta@home / Rosetta Commons FlexPepDock peptide-MHC pipeline run on the BOINC volunteer grid by the Baker lab and collaborators. FlexPepDock threads a peptide into the MHC-I groove with no prior backbone and scores binding, handling residues sequence-only predictors miss. The browser kernel is an illustrative sample on synthetic peptides, not clinically actionable binding calls.',
    whyBrowserCompute: 'Each (peptide, MHC allele) pair is scored completely independently, so a patient’s hundreds of candidates times many alleles across a cohort is a massive grid of identically-sized jobs. One pose search for a single 9-mer is a bounded few-million-op task — ideal for a short browser session — while the candidate space is essentially unbounded.',
    methodology: 'Cancer cells carry mutated proteins healthy cells don’t, but the immune system can attack only if fragments of those proteins clamp into a display molecule called MHC — and most fragments don’t fit. Your browser takes a batch of synthetic mutated peptides and runs a small folding search for each to see how well it settles into the groove, returning a binding score so the strong candidates can be flagged for a vaccine.',
    whatRunsInBrowser: [
      'For each synthetic 9-mer peptide, a numeric per-residue property profile (hydrophobicity, charge, size) seeded deterministically from the unit id.',
      'A bounded FlexPepDock-style Monte Carlo pose search scoring how the anchor residues seat into a fixed MHC-allele groove model.',
      'Conversion of the best pose to an IC50-like affinity, a binder/non-binder call, the batch binder rate, and an integer checksum.',
    ],
    worldImpact: 'Personalized cancer vaccines (the mRNA neoantigen vaccines now in late-stage melanoma and pancreatic trials) live or die on picking the few mutated peptides a patient’s immune system can actually see. Faster, structure-aware triage shrinks the validation list, lowers cost, and widens access across HLA-diverse populations.',
    workUnitNoun: 'peptide batch vs one MHC allele',
    estimateLabel: 'Mean neoantigen binder fraction',
    kernelSummary: 'Structure-based pose search: Monte-Carlo dock synthetic 9-mer peptides into a fixed MHC groove and score binding.',
    kernelCode: `// Per work unit: a batch of synthetic 9-mer peptides vs one MHC groove.
const ANCHOR2 = [0.6, -0.2, 0.1], ANCHOR9 = [0.7, 0.1, -0.3]   // groove preferences
for (let pep = 0; pep < PEPTIDES; pep++) {
  const rng = mulberry32(unitId * 100003 + pep)
  const a = [rng()*2-1, rng()*2-1, rng()*2-1]        // residue P2 (anchor)
  for (let i = 0; i < 18; i++) rng()                 // non-anchor residues P3..P8
  const b = [rng()*2-1, rng()*2-1, rng()*2-1]        // residue P9 (anchor)
  const j = (x, jit, anc, k) => { const e = x[k] + 0.22*(jit) - anc[k]; return e*e }
  let best = -Infinity
  for (let s = 0; s < STEPS; s++) {                  // Monte-Carlo pose sampling
    const d2 = j(a,rng()*2-1,ANCHOR2,0)+j(a,rng()*2-1,ANCHOR2,1)+j(a,rng()*2-1,ANCHOR2,2)
    const d9 = j(b,rng()*2-1,ANCHOR9,0)+j(b,rng()*2-1,ANCHOR9,1)+j(b,rng()*2-1,ANCHOR9,2)
    const score = -1.0*d2 - 1.2*d9
    if (score > best) best = score
  }
  // calibrated so ~15% of synthetic peptides land under the 500 nM binder cutoff
  const ic50 = Math.min(50000, Math.max(1, 500 * Math.exp(-2.2 * (best + 1.044))))  // nM
  if (ic50 < 500) binders++                          // displayed neoantigen
}
estimate = binders / PEPTIDES`,
    manifest: {
      id: 'neoantigen-mhc-binding-screen-v1',
      artifact: 'neoantigen-mhc-flexpepdock-worker@1.0.0',
      input: 'synthetic-9mer-peptide-library-v1',
      kernelId: 'peptideMHCDock',
      allowedOrigins: ['self'],
      maxMemoryMb: 32,
      maxWorkUnitMs: 250,
      resultSchema: ['unitId', 'estimate', 'checksum'],
    },
  },
  {
    id: 'cancer-marker-panel-search-v1',
    name: 'Marker Mosaic',
    disease: 'Solid tumors (combinatorial gene-expression biomarker discovery)',
    area: 'Cancer diagnostics',
    institution: 'Computational Oncology Group, Princess Margaret / Toronto style (illustrative)',
    tagline: 'Sweep a combinatorial sea of gene panels to find the few that cleanly separate tumor from healthy.',
    researchQuestion: 'Which small combinations (panels) of gene-expression markers most reliably separate tumor from healthy tissue, when no single gene tells the whole story and the space of candidate panels is astronomically large?',
    realWorldBasis: 'Modeled directly on the Mapping Cancer Markers project (Jurisica lab, Princess Margaret Cancer Centre) on IBM’s World Community Grid. The real project scored trillions of candidate signatures to narrow tens of thousands of probesets to a high-value subset. The browser kernel reproduces that shape on synthetic data — an illustrative sample, not validated markers.',
    whyBrowserCompute: 'The candidate-panel space is combinatorial and astronomically large, and every panel is scored completely independently with no shared state. A coordinator hands each browser a disjoint slice of the panel space; each worker scores its batch over a fixed synthetic cohort and returns only a best score plus a checksum.',
    methodology: 'We give each volunteer a fixed table of make-believe patients with gene-activity numbers and a known label (tumor or healthy). The browser tries many small combinations of genes and measures how cleanly each separates tumor from healthy, keeping the best it finds — so thousands of browsers together sweep a huge space no single machine could cover.',
    whatRunsInBrowser: [
      'A deterministic synthetic cohort, identical for every unit: a patient × gene expression matrix with a handful of genuinely informative genes planted among noise.',
      'A unit-specific, disjoint batch of candidate 3-gene panels seeded by the unit id.',
      'A fast rank-based AUC statistic scoring each panel’s tumor-vs-normal separation, tracking the best panel and an integer checksum.',
    ],
    worldImpact: 'A robust 3–5 gene panel that separates tumor from normal can become a low-cost assay for earlier detection or tumor subtyping. Narrowing thousands of candidate markers to a validated handful is computationally enormous but clinically high-leverage — earlier, more accurate diagnosis directly improves survival.',
    workUnitNoun: 'batch of candidate gene panels',
    estimateLabel: 'Best tumor/normal separation (AUC)',
    kernelSummary: 'Combinatorial search: score thousands of candidate gene panels by a rank-based AUC over a fixed synthetic cohort.',
    kernelCode: `// Fixed synthetic cohort, identical for every unit (seed 0x00C0FFEE):
//   120 patients (60 tumor / 60 normal) x 200 genes; genes 0..9 carry real signal.
// Per work unit: a disjoint batch of candidate 3-gene panels.
for (let i = 0; i < PANELS; i++) {
  const g0 = pick(), g1 = pick(), g2 = pick()         // 3 distinct gene indices
  let concordant = 0
  for (let a = 0; a < 60; a++) for (let b = 60; b < 120; b++) {
    const st = expr[a][g0]+expr[a][g1]+expr[a][g2]     // tumor patient panel score
    const sn = expr[b][g0]+expr[b][g1]+expr[b][g2]     // normal patient panel score
    concordant += st > sn ? 1 : st === sn ? 0.5 : 0
  }
  const auc = concordant / 3600                        // Mann-Whitney / AUC proxy
  if (auc > bestAUC) bestAUC = auc
}
estimate = bestAUC`,
    manifest: {
      id: 'cancer-marker-panel-search-v1',
      artifact: 'cancer-marker-panel-search-worker@1.0.0',
      input: 'synthetic-lung-expression-cohort-v1',
      kernelId: 'markerPanel',
      allowedOrigins: ['self'],
      maxMemoryMb: 32,
      maxWorkUnitMs: 250,
      resultSchema: ['unitId', 'estimate', 'checksum'],
    },
  },
]

export function getProject(id: string): Project {
  return projects.find((project) => project.id === id) ?? projects[0]
}

// --- Manifest verification -----------------------------------------------------

// Platform signing public key (ECDSA P-256). Manifests are signed at build time with
// scripts/sign-manifests.mjs; the private key is ephemeral and never shipped.
const signingPublicKey: JsonWebKey = { key_ops: ['verify'], ext: true, kty: 'EC', crv: 'P-256', x: 'vAt8aWrK6xORQCGPzh2_YCebo3FIjUuashCbrYLqgro', y: 'N5zcJNX4qAc5yike73sbhVHmnHMKYLkjVlW2s9-_WhM' }

const manifestSignatures: Record<string, string> = {
  'cardiac-ead-arrhythmia-risk-v1': 'v/hDt1q4TfTMh1zRZCZfRJPnZMfOPyqZ5hSHegrUvfNq8pHs7S49miVvxVkDEgFTmVWhut+B1aHIYNelKBzDeQ==',
  'neoantigen-mhc-binding-screen-v1': 'zJyndjhJZy2Uhdbhi6S66X81Q2JQiJ1P5z+Tn1x8VftxMzYvkih7Amp/9S6KYzX6boyQz7uu2ioz5JGSDFybrA==',
  'cancer-marker-panel-search-v1': '4ZOkICi7zFL+thBU/hav/SVxAa7MX/JowcrjBYXuY/Ym+hmmN0CqCCKY93sPn1rD8Fp/1Z/scEYN2rb+xiBqvw==',
}

export async function manifestHash(manifest: Manifest): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyManifest(projectId: string): Promise<{ hash: string; signatureValid: boolean }> {
  const project = getProject(projectId)
  const bytes = new TextEncoder().encode(JSON.stringify(project.manifest))
  const signatureB64 = manifestSignatures[project.id]
  const publicKey = await crypto.subtle.importKey('jwk', signingPublicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const signature = Uint8Array.from(atob(signatureB64), (character) => character.charCodeAt(0))
  const signatureValid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, bytes)
  return { hash: await manifestHash(project.manifest), signatureValid }
}
