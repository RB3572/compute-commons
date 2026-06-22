import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { BatteryMedium, Check, Download, ExternalLink, FileCheck2, FlaskConical, Info, LockKeyhole, Pause, Play, ShieldCheck, Square, X } from 'lucide-react'
import { formatDuration, initialSession, manifest, sessionReducer, verifyManifest } from './core'

const TOTAL_UNITS = 24

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (next: boolean) => void; label: string; description: string }) {
  return <div className="setting-row">
    <div><strong>{label}</strong><span>{description}</span></div>
    <button className="toggle" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>
  </div>
}

function ProvenanceItem({ label, value, link }: { label: string; value: string; link: string }) {
  return <div className="provenance-item"><span>{label} <Info size={13} aria-hidden="true" /></span><strong title={value}>{value}</strong><a href={`#${link.toLowerCase().replaceAll(' ', '-')}`}>{link} <ExternalLink size={13} aria-hidden="true" /></a></div>
}

function ProposalDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => { dialogRef.current?.showModal() }, [])
  return <dialog ref={dialogRef} onClose={onClose} className="dialog">
    <button className="icon-button" aria-label="Close proposal form" onClick={onClose}><X size={19} /></button>
    {submitted ? <div className="success-state"><Check size={24} /><h2>Draft review request saved</h2><p>This demo keeps the request in memory only. No workload was uploaded or executed.</p><button className="button secondary" onClick={onClose}>Close</button></div> : <>
      <h2>Propose a research project</h2>
      <p>Submissions enter manual review. They can never start public execution automatically.</p>
      <form onSubmit={(event) => { event.preventDefault(); setSubmitted(true) }}>
        <label>Institution<input required name="institution" autoComplete="organization" /></label>
        <label>Research question<textarea required name="question" rows={3} /></label>
        <label>Public source repository<input required name="repository" type="url" placeholder="https://…" /></label>
        <label>Data classification<select required defaultValue=""><option value="" disabled>Select one</option><option>Public</option><option>Synthetic</option></select></label>
        <label className="check-row"><input required type="checkbox" /> I confirm this proposal excludes personal data and prohibited uses.</label>
        <button className="button primary" type="submit">Save review request</button>
      </form>
    </>}
  </dialog>
}

export default function App() {
  const [state, dispatch] = useReducer(sessionReducer, initialSession)
  const [cpu, setCpu] = useState(25)
  const [minutes, setMinutes] = useState(15)
  const [pauseBattery, setPauseBattery] = useState(true)
  const [pauseHidden, setPauseHidden] = useState(true)
  const [verifiedHash, setVerifiedHash] = useState('Not checked')
  const [proposalOpen, setProposalOpen] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const timerRef = useRef<number | null>(null)
  const nextUnitRef = useRef(0)

  const isActive = ['running', 'paused'].includes(state.status)
  const statusLabel = useMemo(() => ({ ready: 'Ready', verifying: 'Verifying manifest', running: 'Donating', paused: 'Paused', complete: 'Session complete', stopped: 'Stopped', error: 'Could not start' }[state.status]), [state.status])

  function cleanUpWorker() {
    workerRef.current?.terminate()
    workerRef.current = null
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  function queueWork(worker: Worker) {
    if (nextUnitRef.current >= TOTAL_UNITS) { cleanUpWorker(); dispatch({ type: 'COMPLETE' }); return }
    const delay = Math.max(80, 640 - cpu * 5)
    timerRef.current = window.setTimeout(() => {
      worker.postMessage({ type: 'run', unitId: nextUnitRef.current, samples: 120_000 })
    }, delay)
  }

  async function start() {
    dispatch({ type: 'VERIFY' })
    try {
      const { hash, signatureValid } = await verifyManifest()
      if (!signatureValid) throw new Error('Invalid manifest signature')
      setVerifiedHash(hash)
      const worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      nextUnitRef.current = state.completed
      worker.onmessage = ({ data }: MessageEvent<{ estimate: number }>) => {
        nextUnitRef.current += 1
        dispatch({ type: 'RESULT', estimate: data.estimate })
        queueWork(worker)
      }
      worker.onerror = () => { cleanUpWorker(); dispatch({ type: 'ERROR', message: 'The isolated worker could not complete this work unit.' }) }
      dispatch({ type: 'START' })
      queueWork(worker)
    } catch { dispatch({ type: 'ERROR', message: 'This browser could not verify the workload manifest.' }) }
  }

  function pause() { if (workerRef.current) workerRef.current.terminate(); workerRef.current = null; if (timerRef.current) clearTimeout(timerRef.current); dispatch({ type: 'PAUSE' }) }
  function resume() { dispatch({ type: 'START' }); void start() }
  function stop() { cleanUpWorker(); dispatch({ type: 'STOP' }) }

  useEffect(() => {
    const id = window.setInterval(() => dispatch({ type: 'TICK' }), 1000)
    return () => { window.clearInterval(id); cleanUpWorker() }
  }, [])

  useEffect(() => {
    if (state.elapsedSeconds >= minutes * 60 && state.status === 'running') { cleanUpWorker(); dispatch({ type: 'COMPLETE' }) }
  }, [state.elapsedSeconds, state.status, minutes])

  useEffect(() => {
    const onVisibility = () => { if (pauseHidden && document.hidden && state.status === 'running') pause() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [pauseHidden, state.status])

  function exportReceipt() {
    const receipt = { project: manifest.id, manifestSha256: verifiedHash, completedUnits: state.completed, aggregateEstimate: Number(state.aggregate.toFixed(6)), elapsedSeconds: state.elapsedSeconds, stoppedBy: state.status, generatedAt: new Date().toISOString(), privacy: 'Generated locally; no identity attached.' }
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `compute-commons-receipt-${Date.now()}.json`; anchor.click(); URL.revokeObjectURL(url)
  }

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
          <Toggle checked={pauseBattery} onChange={setPauseBattery} label="Pause when on battery" description="Preference recorded; support varies by browser" />
          <Toggle checked={pauseHidden} onChange={setPauseHidden} label="Pause when tab is hidden" description="Automatically pause when this tab is not visible" />
        </div>
        <div className="session-actions"><p className="meta">Session control</p><div><button className="button secondary" disabled={!isActive} onClick={state.status === 'paused' ? resume : pause}>{state.status === 'paused' ? <Play size={17} /> : <Pause size={17} />}{state.status === 'paused' ? 'Resume' : 'Pause'}</button><button className="button danger" disabled={!isActive} onClick={stop}><Square size={15} fill="currentColor" />Stop</button><span>You can pause or stop at any time.</span></div></div>
      </section>
      <section className="provenance" aria-labelledby="provenance-title"><h2 id="provenance-title">Work &amp; provenance <span>open and verifiable</span></h2><div className="provenance-grid"><ProvenanceItem label="Manifest SHA-256" value={verifiedHash === 'Not checked' ? 'Verified before start' : verifiedHash} link="Verify manifest" /><ProvenanceItem label="Worker artifact" value="climate-monte-carlo-worker@1.0.0" link="Artifact details" /><ProvenanceItem label="Network scope" value="Application origin only" link="Endpoint policy" /><ProvenanceItem label="Input data" value="Synthetic, non-identifying" link="About inputs" /><ProvenanceItem label="Local storage" value="None" link="Privacy details" /></div>
        <div className="work-strip"><div className="lane-copy"><strong>Work units</strong><span><i className="key active" /> Completed <i className="key" /> Pending</span></div><div className="unit-lane" aria-label={`${state.completed} of ${TOTAL_UNITS} work units complete`}>{Array.from({ length: TOTAL_UNITS }, (_, index) => <i key={index} className={index < state.completed ? 'active' : index === state.completed && state.status === 'running' ? 'working' : ''} />)}</div><div className="session-metrics"><span><strong>{formatDuration(state.elapsedSeconds)}</strong> elapsed</span><span><strong>{state.completed}</strong> completed</span><span><strong>~{(state.elapsedSeconds * cpu * 0.000011).toFixed(2)} Wh</strong> estimated</span></div></div>
        {state.completed > 0 && <div className="receipt"><FileCheck2 /><div><strong>Contribution receipt ready</strong><span>Aggregate sample estimate: {state.aggregate.toFixed(4)}. Generated locally with no identity attached.</span></div><button className="button secondary small" onClick={exportReceipt}><Download size={15} />Export JSON</button></div>}
      </section>
      <section className="safety" id="safety"><div><LockKeyhole /><h2>Privacy by design</h2></div><p>No personal data is collected or used. Compute runs locally in your browser. Stop if your device becomes warm. Energy values are estimates, not measurements.</p><div><BatteryMedium /><span>Pause-on-battery support varies by browser; the session never starts without your click.</span></div></section>
    </main>
    <footer><span>Compute Commons demonstration</span><a href="#acceptable-use">Acceptable use</a><a href="#privacy">Privacy</a><button onClick={() => setProposalOpen(true)}><FlaskConical size={15} />Propose research</button></footer>
    {proposalOpen && <ProposalDialog onClose={() => setProposalOpen(false)} />}
  </div>
}
