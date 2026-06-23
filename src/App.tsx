import { type FormEvent, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { BatteryMedium, Check, CheckCircle, Download, ExternalLink, FileCheck2, FlaskConical, Info, LockKeyhole, Pause, Play, ShieldCheck, Square, X } from 'lucide-react'
import { estimateWattHours, formatCount, formatDuration, initialSession, manifest, sessionReducer, verifyManifest } from './core'
import type { WorkerMessage } from './compute.worker'

const TOTAL_UNITS = 24
const SAMPLES_PER_UNIT = 8_000_000
const CHUNK_SAMPLES = 250_000

type BatteryManager = {
  charging: boolean
  addEventListener: (event: string, handler: () => void) => void
  removeEventListener: (event: string, handler: () => void) => void
}

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (next: boolean) => void; label: string; description: string }) {
  return <div className="setting-row">
    <div><strong>{label}</strong><span>{description}</span></div>
    <button className="toggle" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>
  </div>
}

function ProvenanceItem({ label, value, link }: { label: string; value: string; link: string }) {
  return <div className="provenance-item"><span>{label} <Info size={13} aria-hidden="true" /></span><strong title={value}>{value}</strong><a href={`#${link.toLowerCase().replaceAll(' ', '-')}`}>{link} <ExternalLink size={13} aria-hidden="true" /></a></div>
}

type FieldErrors = Record<string, string>

function ProposalDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done'>('idle')
  const [formError, setFormError] = useState<string | null>(null)
  const [fields, setFields] = useState<FieldErrors>({})
  const [reference, setReference] = useState<string | null>(null)
  useEffect(() => { dialogRef.current?.showModal() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('submitting'); setFormError(null); setFields({})
    const data = new FormData(event.currentTarget)
    const payload = {
      institution: String(data.get('institution') ?? ''),
      researchQuestion: String(data.get('researchQuestion') ?? ''),
      repository: String(data.get('repository') ?? ''),
      dataClassification: String(data.get('dataClassification') ?? ''),
      contactEmail: String(data.get('contactEmail') ?? ''),
      confirmed: data.get('confirmed') === 'on',
    }
    try {
      const response = await fetch('/api/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        setFields(result.fields ?? {})
        setFormError(result.error ?? `Submission failed (HTTP ${response.status}).`)
        setStatus('idle')
        return
      }
      setReference(typeof result.id === 'string' ? result.id : null)
      setStatus('done')
    } catch {
      setFormError('Could not reach the review service. Check your connection and try again.')
      setStatus('idle')
    }
  }

  return <dialog ref={dialogRef} onClose={onClose} className="dialog">
    <button className="icon-button" aria-label="Close proposal form" onClick={onClose}><X size={19} /></button>
    {status === 'done' ? <div className="success-state"><Check size={24} /><h2>Proposal received for review</h2><p>Your proposal was recorded and queued for manual review. No workload was uploaded or executed — submitting a proposal never runs code on donors.</p>{reference && <p className="reference">Reference <code>{reference}</code></p>}<button className="button secondary" onClick={onClose}>Close</button></div> : <>
      <h2>Propose a research project</h2>
      <p>Submissions are stored for manual review. They can never start public execution automatically.</p>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <form onSubmit={submit}>
        <label>Institution<input required name="institution" autoComplete="organization" maxLength={200} aria-invalid={!!fields.institution} />{fields.institution && <small className="field-error">{fields.institution}</small>}</label>
        <label>Research question<textarea required name="researchQuestion" rows={3} maxLength={2000} aria-invalid={!!fields.researchQuestion} />{fields.researchQuestion && <small className="field-error">{fields.researchQuestion}</small>}</label>
        <label>Public source repository<input required name="repository" type="url" placeholder="https://…" maxLength={500} aria-invalid={!!fields.repository} />{fields.repository && <small className="field-error">{fields.repository}</small>}</label>
        <label>Contact email <span className="optional">(optional)</span><input name="contactEmail" type="email" autoComplete="email" maxLength={200} aria-invalid={!!fields.contactEmail} />{fields.contactEmail && <small className="field-error">{fields.contactEmail}</small>}</label>
        <label>Data classification<select required name="dataClassification" defaultValue="" aria-invalid={!!fields.dataClassification}><option value="" disabled>Select one</option><option>Public</option><option>Synthetic</option></select>{fields.dataClassification && <small className="field-error">{fields.dataClassification}</small>}</label>
        <label className="check-row"><input required type="checkbox" name="confirmed" /> I confirm this proposal excludes personal data and prohibited uses.</label>
        <button className="button primary" type="submit" disabled={status === 'submitting'}>{status === 'submitting' ? 'Submitting…' : 'Submit for review'}</button>
      </form>
    </>}
  </dialog>
}

type Proposal = { id: string; institution: string; research_question: string; repository: string; data_classification: string; contact_email: string | null; status: string; created_at: string }

function AdminView() {
  const [token, setToken] = useState(() => sessionStorage.getItem('cc-admin-token') ?? '')
  const [authed, setAuthed] = useState(false)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load(withToken: string) {
    setLoading(true); setError(null)
    try {
      const response = await fetch('/api/proposals', { headers: { Authorization: `Bearer ${withToken}` } })
      if (response.status === 401) { setError('Invalid admin token.'); setAuthed(false); setLoading(false); return }
      if (response.status === 503) { setError('Admin review is not configured on the server (ADMIN_TOKEN missing).'); setLoading(false); return }
      if (!response.ok) { setError(`Could not load proposals (HTTP ${response.status}).`); setLoading(false); return }
      const result = await response.json()
      setProposals(result.proposals ?? [])
      setAuthed(true)
      sessionStorage.setItem('cc-admin-token', withToken)
    } catch { setError('Could not reach the review service.') }
    setLoading(false)
  }

  async function setStatus(id: string, status: string) {
    const response = await fetch(`/api/proposals?id=${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ status }) })
    if (response.ok) setProposals((current) => current.map((p) => (p.id === id ? { ...p, status } : p)))
    else setError(`Could not update proposal (HTTP ${response.status}).`)
  }

  // Auto-load once on mount if a token is already cached for this tab. Deferred a
  // tick so the initial loading state isn't set synchronously inside the effect.
  useEffect(() => {
    if (!token) return
    const id = setTimeout(() => void load(token), 0)
    return () => clearTimeout(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="admin-shell">
    <header><a className="brand" href="#top" aria-label="Compute Commons home"><span className="brand-mark" aria-hidden="true" />Compute Commons</a><nav><span className="meta">Reviewer console</span><a href="#top">Exit</a></nav></header>
    <main className="admin-main">
      <h1>Proposal review queue</h1>
      <p className="byline">Approved proposals are not auto-executed. Approval records a reviewer decision only; distribution still requires independent security review.</p>
      {!authed ? <form className="admin-auth" onSubmit={(e) => { e.preventDefault(); void load(token) }}>
        <label>Admin token<input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus placeholder="ADMIN_TOKEN" /></label>
        <button className="button primary" type="submit" disabled={loading || !token}>{loading ? 'Checking…' : 'View queue'}</button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form> : <>
        <div className="admin-toolbar"><span className="meta">{proposals.length} proposal{proposals.length === 1 ? '' : 's'}</span><button className="button secondary small" onClick={() => void load(token)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {proposals.length === 0 ? <p className="empty-state">No proposals yet.</p> : <div className="proposal-list">{proposals.map((p) => <article key={p.id} className="proposal-card">
          <div className="proposal-head"><strong>{p.institution}</strong><span className={`pill status-${p.status}`}>{p.status.replace('_', ' ')}</span></div>
          <p className="proposal-q">{p.research_question}</p>
          <div className="proposal-meta"><a href={p.repository} target="_blank" rel="noopener noreferrer">{p.repository} <ExternalLink size={12} /></a><span>{p.data_classification}</span>{p.contact_email && <span>{p.contact_email}</span>}<span>{new Date(p.created_at).toLocaleString()}</span></div>
          <div className="proposal-actions"><button className="button secondary small" disabled={p.status === 'approved'} onClick={() => void setStatus(p.id, 'approved')}>Approve</button><button className="button danger small" disabled={p.status === 'rejected'} onClick={() => void setStatus(p.id, 'rejected')}>Reject</button>{p.status !== 'pending_review' && <button className="button secondary small" onClick={() => void setStatus(p.id, 'pending_review')}>Reset</button>}</div>
        </article>)}</div>}
      </>}
    </main>
  </div>
}

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return hash
}

export default function App() {
  const hash = useHashRoute()
  if (hash === '#admin') return <AdminView />
  return <DonorConsole />
}

function DonorConsole() {
  const [state, dispatch] = useReducer(sessionReducer, initialSession)
  const [cpu, setCpu] = useState(25)
  const [minutes, setMinutes] = useState(15)
  const [pauseBattery, setPauseBattery] = useState(true)
  const [pauseHidden, setPauseHidden] = useState(true)
  const [verifiedHash, setVerifiedHash] = useState('Not checked')
  const [proposalOpen, setProposalOpen] = useState(false)
  // null = capability present but charge state not yet read; false = unsupported.
  const [batterySupported, setBatterySupported] = useState<boolean | null>(() => (typeof navigator !== 'undefined' && 'getBattery' in navigator ? null : false))
  const [manifestInfo, setManifestInfo] = useState<{ hash: string; valid: boolean } | null>(null)

  const workerRef = useRef<Worker | null>(null)
  const pauseBatteryRef = useRef(pauseBattery)
  const pauseFnRef = useRef<() => void>(() => {})
  // Sample/energy totals are kept monotonic across pause→resume cycles. Each new
  // worker counts from zero, so committed prior-run totals live in the *base* refs
  // and the latest in-flight run's totals live in the *lastRun* refs.
  const baseSamplesRef = useRef(0)
  const baseBusyRef = useRef(0)
  const lastRunSamplesRef = useRef(0)
  const lastRunBusyRef = useRef(0)

  const isActive = ['running', 'paused'].includes(state.status)
  const statusLabel = useMemo(() => ({ ready: 'Ready', verifying: 'Verifying manifest', running: 'Donating', paused: 'Paused', complete: 'Session complete', stopped: 'Stopped', error: 'Could not start' }[state.status]), [state.status])

  function cleanUpWorker() {
    workerRef.current?.terminate()
    workerRef.current = null
  }

  function launchWorker(startUnit: number) {
    const worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === 'unit') {
        dispatch({ type: 'RESULT', estimate: data.estimate })
      } else if (data.type === 'progress') {
        lastRunSamplesRef.current = data.cumulativeSamples
        lastRunBusyRef.current = data.busyMs
        dispatch({ type: 'PROGRESS', totalSamples: baseSamplesRef.current + data.cumulativeSamples, busyMs: baseBusyRef.current + data.busyMs, samplesPerSec: data.samplesPerSec })
      } else if (data.type === 'done') {
        dispatch({ type: 'PROGRESS', totalSamples: baseSamplesRef.current + data.cumulativeSamples, busyMs: baseBusyRef.current + data.busyMs, samplesPerSec: 0 })
        cleanUpWorker()
        dispatch({ type: 'COMPLETE' })
      }
    }
    worker.onerror = () => { cleanUpWorker(); dispatch({ type: 'ERROR', message: 'The isolated worker could not complete this work unit.' }) }
    worker.postMessage({ type: 'start', cpuPercent: cpu, startUnit, totalUnits: TOTAL_UNITS, samplesPerUnit: SAMPLES_PER_UNIT, chunkSamples: CHUNK_SAMPLES })
  }

  async function verifyAndStart(startUnit: number) {
    dispatch({ type: 'VERIFY' })
    try {
      const { hash, signatureValid } = await verifyManifest()
      if (!signatureValid) throw new Error('Invalid manifest signature')
      setVerifiedHash(hash)
      lastRunSamplesRef.current = 0
      lastRunBusyRef.current = 0
      dispatch({ type: 'START' })
      launchWorker(startUnit)
    } catch { dispatch({ type: 'ERROR', message: 'This browser could not verify the workload manifest.' }) }
  }

  function start() {
    baseSamplesRef.current = 0
    baseBusyRef.current = 0
    dispatch({ type: 'RESET' })
    void verifyAndStart(0)
  }

  function resume() { void verifyAndStart(state.completed) }

  function pause() {
    // Commit the in-flight run's totals before tearing down the worker.
    baseSamplesRef.current += lastRunSamplesRef.current
    baseBusyRef.current += lastRunBusyRef.current
    lastRunSamplesRef.current = 0
    lastRunBusyRef.current = 0
    cleanUpWorker()
    dispatch({ type: 'PAUSE' })
  }
  function stop() { cleanUpWorker(); dispatch({ type: 'STOP' }) }

  // Keep refs in sync so listeners always call the latest closures.
  useEffect(() => { pauseFnRef.current = pause })
  useEffect(() => { pauseBatteryRef.current = pauseBattery }, [pauseBattery])

  // Verify manifest on mount so provenance hash is visible before pressing Start
  useEffect(() => {
    verifyManifest().then(({ hash, signatureValid }) => {
      setManifestInfo({ hash, valid: signatureValid })
    }).catch(() => {})
  }, [])

  // Battery Status API — actually pause when device is unplugged
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }
    if (!nav.getBattery) return
    let bm: BatteryManager | null = null
    let cancelled = false
    const onCharge = () => { if (bm && !bm.charging && pauseBatteryRef.current) pauseFnRef.current() }
    nav.getBattery().then((b) => {
      if (cancelled) return
      bm = b
      setBatterySupported(true)
      bm.addEventListener('chargingchange', onCharge)
      if (!b.charging && pauseBatteryRef.current) pauseFnRef.current()
    }).catch(() => setBatterySupported(false))
    return () => { cancelled = true; bm?.removeEventListener('chargingchange', onCharge) }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => dispatch({ type: 'TICK' }), 1000)
    return () => { window.clearInterval(id); cleanUpWorker() }
  }, [])

  useEffect(() => {
    if (state.elapsedSeconds >= minutes * 60 && state.status === 'running') { cleanUpWorker(); dispatch({ type: 'COMPLETE' }) }
  }, [state.elapsedSeconds, state.status, minutes])

  useEffect(() => {
    const onVisibility = () => { if (pauseHidden && document.hidden && state.status === 'running') pauseFnRef.current() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [pauseHidden, state.status])

  function exportReceipt() {
    const receipt = { project: manifest.id, manifestSha256: verifiedHash, completedUnits: state.completed, totalUnits: TOTAL_UNITS, samplesComputed: state.totalSamples, cpuBusySeconds: Number((state.busyMs / 1000).toFixed(2)), estimatedWattHours: Number(estimateWattHours(state.busyMs).toFixed(4)), aggregateEstimate: Number(state.aggregate.toFixed(6)), elapsedSeconds: state.elapsedSeconds, stoppedBy: state.status, generatedAt: new Date().toISOString(), privacy: 'Generated locally; no identity attached.' }
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `compute-commons-receipt-${Date.now()}.json`; anchor.click(); URL.revokeObjectURL(url)
  }

  const batteryDescription = batterySupported === null
    ? 'Checking battery API support…'
    : batterySupported
      ? 'Session pauses automatically when your device is unplugged'
      : 'Battery API not available in this browser'

  const displayHash = verifiedHash !== 'Not checked' ? verifiedHash : (manifestInfo?.hash ?? 'Computing…')
  const manifestJson = JSON.stringify(manifest, null, 2)

  return <div className="app-shell">
    <header><a className="brand" href="#top" aria-label="Compute Commons home"><span className="brand-mark" aria-hidden="true" />Compute Commons</a><nav aria-label="Main navigation"><a href="#how">How it works</a><a href="#safety">Safety</a><button onClick={() => setProposalOpen(true)}>For researchers</button></nav></header>
    <main id="top">
      <section className="study-panel" aria-labelledby="study-title">
        <p className="meta">Active study</p><h1 id="study-title">Open Climate Ensemble</h1><p className="byline">by <a href="#methodology">Civic Climate Lab <ExternalLink size={14} /></a></p>
        <div className="study-block"><h2>Research question</h2><p>How do low-cloud feedbacks respond to warming across a range of plausible climate model configurations?</p></div>
        <div className="study-block" id="methodology"><h2>Methodology &amp; sources</h2><p>We run a public ensemble of short, deterministic simulations over synthetic inputs and analyze only aggregated outputs.</p><div className="inline-links"><a href="#study-methodology">Study methodology <ExternalLink size={13} /></a><a href="#model-code">Model code <ExternalLink size={13} /></a><a href="#data-sources">Data sources <ExternalLink size={13} /></a></div></div>
        <div className="study-block" id="how"><h2>What runs in your browser</h2><ul><li>One isolated worker with a bundled deterministic kernel</li><li>Synthetic simulation steps only</li><li>No personal data, files, cookies, or device identifiers</li><li>No application-defined network requests from the worker</li></ul></div>
        <div className="choice-note"><ShieldCheck aria-hidden="true" /><div><strong>Your choice and control</strong><span>You decide when to start, how much to use, and can pause or stop immediately.</span></div></div>
      </section>
      <section className="control-panel" aria-labelledby="status-heading">
        <div className="status-row"><div><p className="meta" id="status-heading">Status</p><h2><span className={`status-dot ${state.status}`} />{statusLabel}</h2><p>{state.status === 'ready' ? 'Your browser is ready to contribute compute when you are.' : state.status === 'running' ? `Processing work unit ${Math.min(state.completed + 1, TOTAL_UNITS)} of ${TOTAL_UNITS}.` : state.status === 'paused' ? 'No work is running. Resume when you are ready.' : state.status === 'error' ? state.error : 'Your local session record is available below.'}</p></div><a className="button secondary small" href="#safety">Learn more <ExternalLink size={14} /></a></div>
        {!isActive && state.status !== 'verifying' && state.status !== 'complete' ? <button className="button primary start-button" onClick={start}><Play size={19} fill="currentColor" />{state.completed ? 'Start a new session' : 'Start donating'}</button> : state.status === 'verifying' ? <button className="button primary start-button" disabled>Verifying signed manifest…</button> : null}
        <div className="limits">
          <label className="range-setting"><span><strong>CPU usage limit</strong><output>{cpu}%</output></span><input type="range" min="10" max="50" step="5" value={cpu} disabled={isActive} onChange={(e) => setCpu(Number(e.target.value))} /><small>Conservative browser duty cycle · default 25%</small></label>
          <label className="range-setting"><span><strong>Session time cap</strong><output>{minutes} min</output></span><input type="range" min="5" max="30" step="5" value={minutes} disabled={isActive} onChange={(e) => setMinutes(Number(e.target.value))} /><small>Automatic stop · default 15 minutes</small></label>
          <div className="setting-row static"><div><strong>Run one worker</strong><span>Fixed in this demonstration</span></div><span>1 (default)</span></div>
          <Toggle checked={pauseBattery} onChange={setPauseBattery} label="Pause when on battery" description={batteryDescription} />
          <Toggle checked={pauseHidden} onChange={setPauseHidden} label="Pause when tab is hidden" description="Automatically pause when this tab is not visible" />
        </div>
        <div className="session-actions"><p className="meta">Session control</p><div><button className="button secondary" disabled={!isActive} onClick={state.status === 'paused' ? resume : pause}>{state.status === 'paused' ? <Play size={17} /> : <Pause size={17} />}{state.status === 'paused' ? 'Resume' : 'Pause'}</button><button className="button danger" disabled={!isActive} onClick={stop}><Square size={15} fill="currentColor" />Stop</button><span>You can pause or stop at any time.</span></div></div>
      </section>
      <section className="provenance" aria-labelledby="provenance-title"><h2 id="provenance-title">Work &amp; provenance <span>open and verifiable</span></h2><div className="provenance-grid"><ProvenanceItem label="Manifest SHA-256" value={displayHash} link="Verify manifest" /><ProvenanceItem label="Worker artifact" value="climate-monte-carlo-worker@1.0.0" link="Artifact details" /><ProvenanceItem label="Network scope" value="Application origin only" link="Endpoint policy" /><ProvenanceItem label="Input data" value="Synthetic, non-identifying" link="About inputs" /><ProvenanceItem label="Local storage" value="None" link="Privacy details" /></div>
        <div className="work-strip"><div className="lane-copy"><strong>Work units</strong><span><i className="key active" /> Completed <i className="key" /> Pending</span></div><div className="unit-lane" aria-label={`${state.completed} of ${TOTAL_UNITS} work units complete`}>{Array.from({ length: TOTAL_UNITS }, (_, index) => <i key={index} className={index < state.completed ? 'active' : index === state.completed && state.status === 'running' ? 'working' : ''} />)}</div><div className="session-metrics"><span><strong>{formatDuration(state.elapsedSeconds)}</strong> elapsed</span><span><strong>{formatCount(state.totalSamples)}</strong> samples</span><span><strong>{state.samplesPerSec ? `${formatCount(state.samplesPerSec)}/s` : '—'}</strong> throughput</span><span><strong>~{estimateWattHours(state.busyMs).toFixed(3)} Wh</strong> estimated</span></div></div>
        {state.completed > 0 && <div className="receipt"><FileCheck2 /><div><strong>Contribution receipt ready</strong><span>Aggregate sample estimate: {state.aggregate.toFixed(4)}. Generated locally with no identity attached.</span></div><button className="button secondary small" onClick={exportReceipt}><Download size={15} />Export JSON</button></div>}
      </section>
      <section className="safety" id="safety"><div><LockKeyhole /><h2>Privacy by design</h2></div><p>No personal data is collected or used. Compute runs locally in your browser. Stop if your device becomes warm. Energy values are estimates, not measurements.</p><div><BatteryMedium /><span>{batterySupported ? 'Session pauses automatically when unplugged.' : 'Pause-on-battery support varies by browser.'} The session never starts without your click.</span></div></section>
    </main>

    <div className="docs-wrapper" aria-label="Reference documentation">
      <section className="doc-section" id="study-methodology">
        <div className="doc-label"><span className="doc-num">01</span><h2>Methodology</h2></div>
        <div className="doc-body">
          <h3>Study methodology</h3>
          <p>This demonstration runs a bounded ensemble over synthetic low-cloud feedback inputs — a small-scale analogue of the parameter sweeps used in climate model intercomparison projects. Each of the 24 work units draws 120,000 paired samples from two synthetic distributions and returns their product average.</p>
          <p>Across all units the ensemble mean approximates the expected value of the joint distribution. The pseudo-random generator is seeded deterministically from the unit ID, so every result is independently reproducible without storing any data.</p>
          <p>This is not publishable science. It demonstrates bounded, reproducible browser execution with a plausible scientific workload shape and a complete donor-side trust model.</p>
        </div>
      </section>

      <section className="doc-section" id="model-code">
        <div className="doc-label"><span className="doc-num">02</span><h2>Model code</h2></div>
        <div className="doc-body">
          <h3>Worker kernel</h3>
          <p>The full compute worker is a TypeScript module bundled at build time and served only from the application origin. Nothing is fetched at runtime. The estimation loop per work unit:</p>
          <pre className="doc-code">{`// Mulberry32 — deterministic PRNG seeded per work unit
function mulberry32(seed) {
  return function random() {
    let v = (seed += 0x6D2B79F5)
    v = Math.imul(v ^ (v >>> 15), v | 1)
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61)
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296
  }
}

// Per work unit  (seed = unitId + 104729, samples = 120,000)
const random = mulberry32(unitId + 104729)
let sum = 0
for (let i = 0; i < samples; i++) {
  const lowCloudResponse = 0.74 + random() * 0.52  // uniform [0.74, 1.26]
  const forcing         = 0.80 + random() * 0.40  // uniform [0.80, 1.20]
  sum += lowCloudResponse * forcing
}
const estimate = sum / samples
const checksum = Math.round(estimate * 1_000_000) ^ unitId
postMessage({ unitId, estimate, checksum })`}</pre>
          <p>The checksum is a lightweight XOR of the rounded estimate and the unit ID. It allows the host to detect a corrupt or misrouted result without trusting the worker's own <code>unitId</code> field.</p>
        </div>
      </section>

      <section className="doc-section" id="data-sources">
        <div className="doc-label"><span className="doc-num">03</span><h2>Data sources</h2></div>
        <div className="doc-body">
          <h3>Synthetic inputs</h3>
          <p>All inputs are generated inside the worker at runtime. No file, network resource, real-world measurement, or personal dataset is referenced or transmitted.</p>
          <ul>
            <li><strong>Low-cloud radiative response</strong> — uniform [0.74, 1.26] W m⁻² K⁻¹. A plausible range motivated by published literature on low-cloud feedbacks, used here for shape only.</li>
            <li><strong>Shortwave forcing</strong> — uniform [0.80, 1.20] W m⁻². A synthetic perturbation range, not a measurement.</li>
            <li><strong>PRNG seed</strong> — <code>unitId + 104729</code>. The prime offset reduces inter-unit correlation while keeping seeds simple and reproducible.</li>
          </ul>
          <p>The ranges are calibrated to produce a physically plausible mean (~1.0 W m⁻² product) while keeping the computation clearly synthetic and non-attributable to any specific dataset or institution.</p>
        </div>
      </section>

      <section className="doc-section" id="verify-manifest">
        <div className="doc-label"><span className="doc-num">04</span><h2>Verify manifest</h2></div>
        <div className="doc-body">
          <h3>Workload manifest</h3>
          <p>Before any compute starts, the browser verifies an ECDSA P-256 signature over the manifest JSON. This ensures the bundled workload matches the reviewed artifact — no runtime substitution is possible.</p>
          <pre className="doc-code">{manifestJson}</pre>
          {manifestInfo
            ? <div className={`manifest-verified ${manifestInfo.valid ? 'valid' : 'invalid'}`}>
                {manifestInfo.valid ? <CheckCircle size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
                <span>{manifestInfo.valid ? 'Signature valid' : 'Signature invalid'}</span>
                <code title="SHA-256 of manifest JSON">{manifestInfo.hash}</code>
              </div>
            : <div className="manifest-verified loading"><span>Verifying…</span></div>
          }
          <p>To independently verify: serialize the manifest above with <code>JSON.stringify</code> (no extra whitespace), SHA-256 the UTF-8 bytes, and compare against the hash shown. The signing key is an ECDSA P-256 public key embedded in <code>src/core.ts</code>.</p>
        </div>
      </section>

      <section className="doc-section" id="artifact-details">
        <div className="doc-label"><span className="doc-num">05</span><h2>Artifact details</h2></div>
        <div className="doc-body">
          <h3>Worker artifact</h3>
          <p><strong>climate-monte-carlo-worker@1.0.0</strong> is a TypeScript module compiled and bundled by Vite at build time. It is served exclusively from the application origin and receives no code updates at runtime.</p>
          <ul>
            <li>Imports no external modules or libraries</li>
            <li>Makes no network requests — CSP <code>connect-src 'self'</code> applies to workers</li>
            <li>Has no access to the DOM, localStorage, cookies, IndexedDB, or any device API</li>
            <li>Communicates only through the structured Worker message channel</li>
            <li>Inbound: <code>{'{ type: "run", unitId: number, samples: number }'}</code></li>
            <li>Outbound: <code>{'{ unitId: number, estimate: number, checksum: number }'}</code></li>
          </ul>
          <p>Stopping the session terminates the Worker process immediately via <code>worker.terminate()</code>, preventing any further application work.</p>
        </div>
      </section>

      <section className="doc-section" id="endpoint-policy">
        <div className="doc-label"><span className="doc-num">06</span><h2>Endpoint policy</h2></div>
        <div className="doc-body">
          <h3>Content Security Policy</h3>
          <p>A strict CSP is delivered via <code>{'<meta http-equiv="Content-Security-Policy">'}</code>. All resource loads are limited to the application origin.</p>
          <table className="csp-table">
            <thead><tr><th>Directive</th><th>Value</th><th>Effect</th></tr></thead>
            <tbody>
              <tr><td>default-src</td><td>'self'</td><td>All unlisted resources from origin only</td></tr>
              <tr><td>script-src</td><td>'self'</td><td>No inline scripts, no external scripts</td></tr>
              <tr><td>style-src</td><td>'self' 'unsafe-inline'</td><td>Origin styles + Vite HMR inline styles in dev</td></tr>
              <tr><td>connect-src</td><td>'self'</td><td>No external fetch, XHR, or WebSocket</td></tr>
              <tr><td>worker-src</td><td>'self' blob:</td><td>Workers from origin or blob (Vite worker bundling)</td></tr>
              <tr><td>object-src</td><td>'none'</td><td>No plugins, Flash, or embedded objects</td></tr>
              <tr><td>frame-src</td><td>'none'</td><td>No iframes</td></tr>
              <tr><td>base-uri</td><td>'self'</td><td>Prevents base-tag hijacking</td></tr>
              <tr><td>form-action</td><td>'self'</td><td>Form submissions to origin only</td></tr>
            </tbody>
          </table>
          <p>Server-level headers set via <code>vercel.json</code>: <code>X-Frame-Options: DENY</code>, <code>X-Content-Type-Options: nosniff</code>, <code>Referrer-Policy: strict-origin-when-cross-origin</code>, and <code>Permissions-Policy</code> denying camera, microphone, geolocation, payment, and USB.</p>
        </div>
      </section>

      <section className="doc-section" id="about-inputs">
        <div className="doc-label"><span className="doc-num">07</span><h2>About inputs</h2></div>
        <div className="doc-body">
          <h3>Work unit inputs</h3>
          <p>The host passes exactly two values to the worker per unit: a numeric <code>unitId</code> (0–23) and a fixed <code>samples</code> count (120,000). No other data crosses the message boundary — no user information, no device state, no real-world data.</p>
          <p>The worker derives all simulation inputs from <code>unitId</code> via a deterministic PRNG. This means:</p>
          <ul>
            <li>Any work unit can be reproduced independently given only its ID</li>
            <li>The host cannot influence the simulation beyond choosing which unit to run</li>
            <li>Results can be cross-checked by re-running the same unit and comparing checksums</li>
            <li>No real-world data, file content, or personal information can reach the worker</li>
          </ul>
        </div>
      </section>

      <section className="doc-section" id="privacy">
        <div className="doc-label"><span className="doc-num">08</span><h2>Privacy</h2></div>
        <div className="doc-body">
          <h3 id="privacy-details">Privacy details</h3>
          <p>Compute Commons collects no personal data. The full data inventory for this session:</p>
          <ul>
            <li><strong>Donor sessions stay on-device</strong> — compute progress, settings, and metrics live in browser memory only and are discarded when you close or navigate away. No donor data is transmitted.</li>
            <li><strong>No donor storage</strong> — donating writes no cookies, localStorage, or IndexedDB. (The reviewer console at <code>#admin</code> keeps a typed admin token in sessionStorage for that tab only.)</li>
            <li><strong>No analytics or tracking</strong> — no third-party scripts, pixels, fingerprinting, or telemetry. The CSP blocks external script sources at the browser level.</li>
            <li><strong>Receipt is local</strong> — generated on demand and downloaded directly to your device. Nothing about your compute session is sent to any server.</li>
            <li><strong>Researcher proposals are the one exception</strong> — when you submit the proposal form, those fields (institution, research question, repository, classification, and optional email) are sent to the Compute Commons backend and stored in a Postgres database for manual review. This is a deliberate submission you initiate; donating compute never sends anything.</li>
          </ul>
          <p>No account is required to donate. An optional sign-in feature (not present in this demo) would use minimal OpenID scopes for cross-device history only and would never be required for compute access.</p>
        </div>
      </section>

      <section className="doc-section" id="acceptable-use">
        <div className="doc-label"><span className="doc-num">09</span><h2>Acceptable use</h2></div>
        <div className="doc-body">
          <h3>Permitted and prohibited uses</h3>
          <p>Compute Commons is intended for transparent, privacy-respecting public-interest research. The following are not permitted on this network:</p>
          <ul>
            <li>Cryptocurrency mining, token generation, or proof-of-work of any kind</li>
            <li>Credential attacks — brute force, dictionary, or password-cracking workloads</li>
            <li>Surveillance, tracking, profiling, or personal-data processing</li>
            <li>Weapons design, ballistics, or any military or harm-enabling application</li>
            <li>Proprietary or undisclosed payloads — all workloads must be open-source and publicly auditable</li>
            <li>Any use that violates applicable law or the rights of individuals</li>
          </ul>
          <p>Research proposals submitted through this site are review requests only. No submitted code is executed automatically or reaches donors without administrator approval, independent security review, verified institutional identity, and documented ethics and data-rights clearance.</p>
          <p>This demonstration produces no scientific output and makes no such claim. The workload is illustrative only.</p>
        </div>
      </section>
    </div>

    <footer><span>Compute Commons demonstration</span><a href="#acceptable-use">Acceptable use</a><a href="#privacy">Privacy</a><button onClick={() => setProposalOpen(true)}><FlaskConical size={15} />Propose research</button></footer>
    {proposalOpen && <ProposalDialog onClose={() => setProposalOpen(false)} />}
  </div>
}
