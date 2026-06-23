import { type FormEvent, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ArrowRight, BatteryMedium, Check, CheckCircle, Download, ExternalLink, FileCheck2, FlaskConical, HeartPulse, Info, LockKeyhole, Microscope, Pause, Play, ShieldCheck, Square, Dna, X } from 'lucide-react'
import { estimateWattHours, formatCount, formatDuration, getProject, initialSession, projects, sessionReducer, verifyManifest } from './core'
import type { WorkerMessage } from './compute.worker'

const TOTAL_UNITS = 24

const PROJECT_ICON: Record<string, typeof HeartPulse> = {
  'cardiac-ead-arrhythmia-risk-v1': HeartPulse,
  'neoantigen-mhc-binding-screen-v1': Dna,
  'cancer-marker-panel-search-v1': Microscope,
}

// Module-level so the timestamping (Date.now / new Date) stays out of component render scope.
function downloadReceipt(receipt: Record<string, unknown>) {
  const full = { ...receipt, generatedAt: new Date().toISOString() }
  const url = URL.createObjectURL(new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `compute-commons-receipt-${Date.now()}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

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

// Public OAuth Web client ID (kept in sync with the api/_auth.ts default).
const GOOGLE_CLIENT_ID = '804091048275-lng855r6ncg7i8is9d82evtq7rjv7m52.apps.googleusercontent.com'

type GoogleIdApi = {
  accounts: { id: {
    initialize: (config: { client_id: string; callback: (response: { credential: string }) => void; auto_select?: boolean }) => void
    renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
    disableAutoSelect: () => void
  } }
}
declare global { interface Window { google?: GoogleIdApi } }

// Load Google Identity Services lazily, and only on the reviewer route — donor
// visitors never fetch any third-party script.
let gisPromise: Promise<void> | null = null
// initialize() must run once per page load; the live credential handler is swapped here.
let gisInitialized = false
let gisCredentialHandler: ((response: { credential: string }) => void) | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => { gisPromise = null; reject(new Error('Failed to load Google sign-in')) }
      document.head.appendChild(script)
    })
  }
  return gisPromise
}

// Decode the email from a Google ID token for display only — never for trust;
// the server independently verifies the token's signature and the allowlist.
function decodeEmail(idToken: string): string | null {
  try {
    const part = idToken.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
    if (!part) return null
    const payload = JSON.parse(decodeURIComponent(escape(atob(part)))) as { email?: string }
    return typeof payload.email === 'string' ? payload.email : null
  } catch { return null }
}

type AdminPhase = 'signin' | 'checking' | 'authed' | 'denied'

function AdminView() {
  const [idToken, setIdToken] = useState<string | null>(() => sessionStorage.getItem('cc-admin-idtoken'))
  const [phase, setPhase] = useState<AdminPhase>(() => (sessionStorage.getItem('cc-admin-idtoken') ? 'checking' : 'signin'))
  const [email, setEmail] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const buttonRef = useRef<HTMLDivElement>(null)

  async function load(token: string) {
    setLoading(true); setError(null)
    try {
      const response = await fetch('/api/proposals', { headers: { Authorization: `Bearer ${token}` } })
      if (response.status === 401) {
        sessionStorage.removeItem('cc-admin-idtoken'); setIdToken(null); setPhase('signin')
        setError('Your Google session expired. Please sign in again.'); setLoading(false); return
      }
      if (response.status === 403) {
        const body = await response.json().catch(() => ({}))
        setEmail(decodeEmail(token)); setPhase('denied'); setError(body.error ?? 'This Google account is not authorized.')
        setLoading(false); return
      }
      if (!response.ok) { setError(`Could not load proposals (HTTP ${response.status}).`); setLoading(false); return }
      const result = await response.json()
      setProposals(result.proposals ?? []); setEmail(decodeEmail(token)); setPhase('authed')
      sessionStorage.setItem('cc-admin-idtoken', token)
    } catch { setError('Could not reach the review service.') }
    setLoading(false)
  }

  async function setStatus(id: string, status: string) {
    if (!idToken) return
    const response = await fetch(`/api/proposals?id=${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ status }) })
    if (response.ok) setProposals((current) => current.map((p) => (p.id === id ? { ...p, status } : p)))
    else if (response.status === 401) { sessionStorage.removeItem('cc-admin-idtoken'); setIdToken(null); setPhase('signin'); setError('Your Google session expired. Please sign in again.') }
    else setError(`Could not update proposal (HTTP ${response.status}).`)
  }

  function signOut() {
    window.google?.accounts.id.disableAutoSelect()
    sessionStorage.removeItem('cc-admin-idtoken')
    setIdToken(null); setEmail(null); setProposals([]); setError(null); setPhase('signin')
  }

  // Verify a cached token on mount (deferred a tick to avoid synchronous setState).
  useEffect(() => {
    if (!idToken) return
    const t = setTimeout(() => void load(idToken), 0)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Render the Google button whenever we are asking the reviewer to sign in.
  // initialize() is called once per page load (GIS requirement); the latest credential
  // handler is kept in a module ref so a stable callback always reaches live state.
  useEffect(() => {
    if (phase !== 'signin' && phase !== 'denied') return
    let cancelled = false
    loadGis().then(() => {
      if (cancelled || !window.google || !buttonRef.current) return
      gisCredentialHandler = (response) => { setIdToken(response.credential); setPhase('checking'); void load(response.credential) }
      if (!gisInitialized) {
        window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r) => gisCredentialHandler?.(r), auto_select: false })
        gisInitialized = true
      }
      buttonRef.current.innerHTML = ''
      window.google.accounts.id.renderButton(buttonRef.current, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular' })
    }).catch(() => setError('Could not load Google sign-in. Check your connection and try again.'))
    return () => { cancelled = true }
  }, [phase])

  return <div className="admin-shell">
    <header><a className="brand" href="#top" aria-label="Compute Commons home"><span className="brand-mark" aria-hidden="true" />Compute Commons</a><nav><span className="meta">Reviewer console</span>{phase === 'authed' && email && <span className="signed-in">{email}</span>}{phase === 'authed' ? <button onClick={signOut}>Sign out</button> : <a href="#top">Exit</a>}</nav></header>
    <main className="admin-main">
      <h1>Proposal review queue</h1>
      <p className="byline">Approved proposals are not auto-executed. Approval records a reviewer decision only; distribution still requires independent security review.</p>
      {phase === 'checking' ? <p className="empty-state">Verifying your Google account…</p>
      : phase === 'authed' ? <>
        <div className="admin-toolbar"><span className="meta">{proposals.length} proposal{proposals.length === 1 ? '' : 's'}</span><button className="button secondary small" onClick={() => idToken && void load(idToken)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {proposals.length === 0 ? <p className="empty-state">No proposals yet.</p> : <div className="proposal-list">{proposals.map((p) => <article key={p.id} className="proposal-card">
          <div className="proposal-head"><strong>{p.institution}</strong><span className={`pill status-${p.status}`}>{p.status.replace('_', ' ')}</span></div>
          <p className="proposal-q">{p.research_question}</p>
          <div className="proposal-meta"><a href={p.repository} target="_blank" rel="noopener noreferrer">{p.repository} <ExternalLink size={12} /></a><span>{p.data_classification}</span>{p.contact_email && <span>{p.contact_email}</span>}<span>{new Date(p.created_at).toLocaleString()}</span></div>
          <div className="proposal-actions"><button className="button secondary small" disabled={p.status === 'approved'} onClick={() => void setStatus(p.id, 'approved')}>Approve</button><button className="button danger small" disabled={p.status === 'rejected'} onClick={() => void setStatus(p.id, 'rejected')}>Reject</button>{p.status !== 'pending_review' && <button className="button secondary small" onClick={() => void setStatus(p.id, 'pending_review')}>Reset</button>}</div>
        </article>)}</div>}
      </>
      : <div className="admin-auth">
        <p className="signin-copy">{phase === 'denied' ? 'That account is not authorized. Sign in with the reviewer Google account.' : 'Sign in with the authorized Google account to review proposals.'}</p>
        <div ref={buttonRef} className="gis-button" />
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>}
    </main>
  </div>
}

const HOW_IT_WORKS = {
  heroTitle: 'How Compute Commons works',
  heroSubtitle: 'You lend a few minutes of your browser’s spare compute to a reviewed scientific workload, then keep a private, verifiable receipt of exactly what ran. No account, no uploads, and you can stop at any moment.',
  sections: [
    {
      heading: 'Why donating browser compute helps',
      body: 'Some of the most important questions in medicine are not blocked by a lack of ideas, but by a lack of computing. A single scientific question can fan out into millions of small, independent calculations: simulating how a heart cell responds to a drug, scoring how a mutated peptide fits an immune receptor, or testing which combinations of genes best separate tumor from healthy tissue. Each calculation is tiny, but there are so many that no single lab computer can finish in a reasonable time. The clean way to solve this is to split the work into small pieces and hand each piece to a different volunteer machine — the model volunteer computing has used for two decades, with a real track record in medicine.',
      bullets: [
        'Folding@home harnessed donated computers worldwide to simulate how proteins fold and misfold — work tied to diseases like Alzheimer’s and cancer — and during the COVID-19 pandemic briefly became one of the most powerful distributed computing efforts ever assembled.',
        'World Community Grid and the BOINC platform have run reviewed academic projects on hundreds of thousands of volunteer machines, including cancer-marker discovery and tuberculosis and childhood-cancer drug searches.',
        'Rosetta@home distributed protein-folding and peptide-docking jobs across volunteers — the same family of structure-based methods used to study how the immune system recognizes targets.',
        'Compute Commons is a demonstration built in that tradition: it shows how the donor side of such a system can be made transparent, bounded, and private by design.',
      ],
    },
    {
      heading: 'What actually runs on your machine',
      body: 'When you start a session, your browser runs a small, fixed program called a kernel inside a Web Worker — a sandboxed background thread that cannot touch the page, your files, or the network. The kernel is deterministic and bounded: it uses a seeded pseudo-random number generator (mulberry32, seeded per work unit) so the same input always produces the same output, and each work unit is capped in time and memory. A unit performs a few million floating-point operations, then returns just two numbers: a scientific estimate and an integer checksum. The checksum lets the result be re-run elsewhere and confirmed bit-for-bit. Nothing about you is part of the input, and nothing is sent back out from the worker.',
      bullets: [
        'Sandboxed: the worker has no network capability, and a strict Content Security Policy limits what the page can load or connect to.',
        'Bounded: each work unit is capped (in this build, roughly 250 ms and 32 MB), so a runaway calculation cannot monopolize your device.',
        'Reproducible: the seeded PRNG and integer checksum make every result independently verifiable, not a black box.',
      ],
    },
    {
      heading: 'Signed manifests and a verifiable receipt',
      body: 'Trust here does not rest on a promise; it rests on cryptography you can check. Every workload ships with a manifest that names the exact code artifact, the synthetic input, the resource limits, and the result schema. That manifest is hashed with SHA-256 and signed with an ECDSA P-256 key, and your browser verifies the signature locally with the Web Crypto API before any compute begins. If the manifest were altered, verification would fail and the work would not run. When a session ends you can export a contribution receipt — a local record of what ran, how many units completed, how much CPU time was spent, and the content-addressed identifiers for the workload. The receipt is generated and stored on your device only, never uploaded.',
      bullets: [
        'The workload is content-addressed: its identity is a hash, so the code you ran is the code that was reviewed.',
        'Signature verification happens in your browser, so you are not trusting the server’s word for it.',
        'The receipt is yours alone, written to your device only when you ask for it.',
      ],
    },
    {
      heading: 'You stay in control, and so does your privacy',
      body: 'Compute never starts on its own. Every session needs a fresh, deliberate click, and you can pause or stop instantly; stopping terminates the worker entirely so no further work can happen. A CPU slider sets how hard the session is allowed to push: the kernel enforces it with cooperative duty-cycle throttling, following each short burst of work with a proportional idle pause so average single-core use tracks your setting. The app asks for no account and requests no access to your identity, files, clipboard, camera, microphone, location, or notifications. The only data that ever leaves your device is if you, separately and intentionally, submit a researcher proposal; donating compute sends nothing.',
      bullets: [
        'Start, pause, and stop are explicit and immediate.',
        'The CPU budget is yours to set, and throttling is enforced inside the worker.',
        'No personal data is collected, processed, or transmitted during a donation session.',
      ],
    },
  ],
  steps: [
    { title: 'Read the study and its manifest', detail: 'Open a study and review what it investigates, what synthetic input it uses, and the signed manifest describing the exact code and resource limits. Your browser verifies the manifest signature locally before anything runs.' },
    { title: 'Set your CPU budget and session cap', detail: 'Use the slider to choose how much of one core the session may use, and pick how long it runs. Lower settings keep your device cool and responsive; you can change your mind at any time.' },
    { title: 'Press start', detail: 'Compute only begins on a deliberate click. A Web Worker spins up and starts completing bounded work units, and you watch real progress, throughput, and an estimated energy figure update live.' },
    { title: 'Pause or stop whenever you want', detail: 'Pause halts scheduling immediately and resumes where you left off. Stop terminates the worker entirely so no further work can run. Neither requires a reason or a confirmation step.' },
    { title: 'Export your receipt', detail: 'When the session ends, export a local contribution receipt recording what ran, how many units completed, the CPU time used, and the content-addressed workload identifiers. It is saved to your device only.' },
  ],
  faq: [
    { q: 'Is this demo producing real medical results?', a: 'No, and we want to be explicit about that. The shipped demo runs illustrative sample workloads over synthetic, computer-generated inputs. Each kernel is shaped like the real science it is modeled on — cardiac drug-safety ensembles, peptide-MHC binding, gene-panel scoring — but the outputs are not publishable findings and must not be used to make any clinical or scientific decision. The purpose of this build is to demonstrate a trustworthy, bounded, private donor experience, not to generate validated results.' },
    { q: 'Is any of my personal data ever used?', a: 'No. The kernels run only on synthetic inputs that contain no patient data and no information about you. The app requests no account and no access to your identity, files, clipboard, sensors, location, or notifications. Your session progress stays in your browser’s memory and is never transmitted. The single exception is the researcher proposal form, which you would have to fill out and submit on purpose.' },
    { q: 'Will this drain my battery or heat up my device?', a: 'Running any real computation uses energy and produces some heat, which is why you control the CPU budget and can stop instantly. The session shows an estimated energy figure derived from measured busy time, assuming roughly one active core at an indicative wattage; because browser scheduling and device power vary, treat it as an estimate. If your device becomes warm, lower the CPU slider or stop. On a laptop, consider running while plugged in.' },
    { q: 'Could this run hidden code, mine cryptocurrency, or do something malicious?', a: 'No. The worker can only run the bundled, reviewed kernel whose signed manifest your browser verifies before it starts, and it has no network capability, enforced by a strict Content Security Policy. Researcher submissions are review requests only and can never reach the worker. Cryptocurrency mining, credential attacks, surveillance, and personal-data processing are outside acceptable use, and a real campaign would require independent security review and institutional verification before any workload was distributed.' },
    { q: 'Do I need an account or to install anything?', a: 'No. Everything runs in a standard web browser with no account, no extension, and no install. Nothing starts until you click start, and you can leave or close the tab at any time to end the session.' },
    { q: 'How do I know the result I computed is honest?', a: 'Each work unit is deterministic: it uses a per-unit seeded random number generator and returns a numeric estimate plus an integer checksum, so anyone can re-run the same unit and confirm the same output bit-for-bit. The workload itself is content-addressed and signed, so the code you ran is provably the code that was published for review, and your exported receipt records those identifiers.' },
  ],
  closingCta: 'When you have a few idle minutes, lend them to a reviewed workload, watch the work complete, and keep the receipt. Start whenever you are ready, and stop the moment you want to.',
}

function HowItWorks() {
  useEffect(() => { window.scrollTo(0, 0) }, [])
  return <div className="app-shell howto-shell">
    <header><a className="brand" href="#top" aria-label="Compute Commons home"><span className="brand-mark" aria-hidden="true" />Compute Commons</a><nav aria-label="Main navigation"><a href="#top">Studies</a><a href="#privacy">Privacy</a><a className="button primary small" href="#top"><Play size={15} fill="currentColor" />Start donating</a></nav></header>
    <main className="howto-page">
      <section className="howto-hero">
        <p className="meta">How it works</p>
        <h1>{HOW_IT_WORKS.heroTitle}</h1>
        <p className="howto-sub">{HOW_IT_WORKS.heroSubtitle}</p>
        <a className="button primary" href="#top"><Play size={18} fill="currentColor" />Choose a study</a>
      </section>

      {HOW_IT_WORKS.sections.map((section, index) => <section className="howto-section" key={index}>
        <div className="howto-section-label"><span className="doc-num">{String(index + 1).padStart(2, '0')}</span></div>
        <div className="howto-section-body">
          <h2>{section.heading}</h2>
          <p>{section.body}</p>
          {section.bullets && <ul>{section.bullets.map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}</ul>}
        </div>
      </section>)}

      <section className="howto-steps">
        <h2>How to use it</h2>
        <ol>{HOW_IT_WORKS.steps.map((step, index) => <li key={index}><strong>{step.title}</strong><span>{step.detail}</span></li>)}</ol>
      </section>

      <section className="howto-faq">
        <h2>Frequently asked questions</h2>
        <div className="faq-list">{HOW_IT_WORKS.faq.map((item, index) => <details key={index} className="faq-item">
          <summary>{item.q}</summary>
          <p>{item.a}</p>
        </details>)}</div>
      </section>

      <section className="howto-cta">
        <ShieldCheck size={22} aria-hidden="true" />
        <p>{HOW_IT_WORKS.closingCta}</p>
        <a className="button primary" href="#top"><Play size={18} fill="currentColor" />Start donating</a>
      </section>
    </main>
    <footer><span>Compute Commons demonstration</span><a href="#top">Studies</a><a href="#privacy">Privacy</a></footer>
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
  if (hash === '#how-it-works') return <HowItWorks />
  return <DonorConsole />
}

function DonorConsole() {
  const [state, dispatch] = useReducer(sessionReducer, initialSession)
  const [projectId, setProjectId] = useState(projects[0].id)
  const project = getProject(projectId)
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
    worker.postMessage({ type: 'start', cpuPercent: cpu, kernelId: project.manifest.kernelId, startUnit, totalUnits: TOTAL_UNITS })
  }

  async function verifyAndStart(startUnit: number) {
    dispatch({ type: 'VERIFY' })
    try {
      const { hash, signatureValid } = await verifyManifest(projectId)
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

  // Commit the in-flight run's totals into the committed base so no computed work
  // is lost when the worker is torn down (pause, stop, or time-cap completion).
  function commitInflight() {
    baseSamplesRef.current += lastRunSamplesRef.current
    baseBusyRef.current += lastRunBusyRef.current
    lastRunSamplesRef.current = 0
    lastRunBusyRef.current = 0
  }

  function pause() {
    commitInflight()
    cleanUpWorker()
    dispatch({ type: 'PAUSE' })
  }
  function stop() {
    commitInflight()
    cleanUpWorker()
    dispatch({ type: 'STOP' })
  }

  function selectProject(id: string) {
    if (id === projectId || isActive) return
    cleanUpWorker()
    baseSamplesRef.current = 0; baseBusyRef.current = 0; lastRunSamplesRef.current = 0; lastRunBusyRef.current = 0
    setProjectId(id)
    setVerifiedHash('Not checked')
    dispatch({ type: 'RESET' })
  }

  // Keep refs in sync so listeners always call the latest closures.
  useEffect(() => { pauseFnRef.current = pause })
  useEffect(() => { pauseBatteryRef.current = pauseBattery }, [pauseBattery])

  // Verify the selected project's manifest so its provenance hash is visible before
  // pressing Start, and re-verify whenever the chosen project changes.
  useEffect(() => {
    let cancelled = false
    verifyManifest(projectId).then(({ hash, signatureValid }) => {
      if (!cancelled) setManifestInfo({ hash, valid: signatureValid })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [projectId])

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
    if (state.elapsedSeconds >= minutes * 60 && state.status === 'running') { commitInflight(); cleanUpWorker(); dispatch({ type: 'COMPLETE' }) }
  }, [state.elapsedSeconds, state.status, minutes])

  useEffect(() => {
    const onVisibility = () => { if (pauseHidden && document.hidden && state.status === 'running') pauseFnRef.current() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [pauseHidden, state.status])

  function exportReceipt() {
    downloadReceipt({ project: project.manifest.id, projectName: project.name, workloadArtifact: project.manifest.artifact, manifestSha256: verifiedHash, completedUnits: state.completed, totalUnits: TOTAL_UNITS, workItemsComputed: state.totalSamples, cpuBusySeconds: Number((state.busyMs / 1000).toFixed(2)), estimatedWattHours: Number(estimateWattHours(state.busyMs).toFixed(4)), aggregateEstimate: Number(state.aggregate.toFixed(6)), aggregateMeaning: project.estimateLabel, elapsedSeconds: state.elapsedSeconds, stoppedBy: state.status, privacy: 'Generated locally; synthetic inputs only; no identity or patient data attached.' })
  }

  const batteryDescription = batterySupported === null
    ? 'Checking battery API support…'
    : batterySupported
      ? 'Session pauses automatically when your device is unplugged'
      : 'Battery API not available in this browser'

  const displayHash = verifiedHash !== 'Not checked' ? verifiedHash : (manifestInfo?.hash ?? 'Computing…')
  const manifestJson = JSON.stringify(project.manifest, null, 2)

  return <div className="app-shell">
    <header><a className="brand" href="#top" aria-label="Compute Commons home"><span className="brand-mark" aria-hidden="true" />Compute Commons</a><nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#safety">Safety</a><button onClick={() => setProposalOpen(true)}>For researchers</button></nav></header>
    <main id="top">
      <section className="catalog-panel" aria-labelledby="catalog-title">
        <div className="catalog-head">
          <p className="meta">Active studies</p>
          <h1 id="catalog-title">Donate browser compute to medical research</h1>
          <p>Three reviewed, bounded workloads, each modeled on a real volunteer-computing project. Pick a study, set your limits, and start — your browser verifies a signed manifest and runs deterministic science over synthetic inputs only. <a href="#how-it-works">How it works <ArrowRight size={13} /></a></p>
        </div>
        <div className="project-catalog" role="radiogroup" aria-label="Choose a study">
          {projects.map((candidate) => {
            const Icon = PROJECT_ICON[candidate.id] ?? FlaskConical
            const selected = candidate.id === projectId
            return <button key={candidate.id} type="button" role="radio" aria-checked={selected} className={`project-card ${selected ? 'selected' : ''}`} onClick={() => selectProject(candidate.id)} disabled={isActive && !selected}>
              <span className="project-card-head"><span className="project-icon"><Icon size={19} aria-hidden="true" /></span><span className="project-area">{candidate.area}</span>{selected && <span className="project-check"><Check size={15} /></span>}</span>
              <strong>{candidate.name}</strong>
              <span className="project-disease">{candidate.disease}</span>
              <span className="project-tagline">{candidate.tagline}</span>
            </button>
          })}
        </div>
      </section>

      <section className="study-panel" aria-labelledby="study-title">
        <p className="meta">Selected study</p><h2 className="study-name" id="study-title">{project.name}</h2><p className="byline">{project.area} · {project.institution}</p>
        <div className="study-block"><h2>Research question</h2><p>{project.researchQuestion}</p></div>
        <div className="study-block" id="methodology"><h2>Methodology</h2><p>{project.methodology}</p><div className="inline-links"><a href="#study-methodology">Study methodology <ExternalLink size={13} /></a><a href="#model-code">Model code <ExternalLink size={13} /></a><a href="#data-sources">Data sources <ExternalLink size={13} /></a></div></div>
        <div className="study-block"><h2>Why your compute helps</h2><p>{project.whyBrowserCompute}</p></div>
        <div className="study-block" id="how"><h2>What runs in your browser</h2><ul>{project.whatRunsInBrowser.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
        <div className="modeled-note"><Info size={16} aria-hidden="true" /><div><strong>Modeled on real volunteer-computing research</strong><span>{project.realWorldBasis}</span></div></div>
        <div className="choice-note"><ShieldCheck aria-hidden="true" /><div><strong>Your choice and control</strong><span>You decide when to start, how much to use, and can pause or stop immediately.</span></div></div>
      </section>

      <section className="control-panel" aria-labelledby="status-heading">
        <div className="status-row"><div><p className="meta" id="status-heading">Status</p><h2><span className={`status-dot ${state.status}`} />{statusLabel}</h2><p>{state.status === 'ready' ? `Your browser is ready to contribute to ${project.name}.` : state.status === 'running' ? `Processing work unit ${Math.min(state.completed + 1, TOTAL_UNITS)} of ${TOTAL_UNITS} · ${project.workUnitNoun}.` : state.status === 'paused' ? 'No work is running. Resume when you are ready.' : state.status === 'error' ? state.error : 'Your local session record is available below.'}</p></div><a className="button secondary small" href="#how-it-works">Learn more <ExternalLink size={14} /></a></div>
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

      <section className="provenance" aria-labelledby="provenance-title"><h2 id="provenance-title">Work &amp; provenance <span>open and verifiable</span></h2><div className="provenance-grid"><ProvenanceItem label="Manifest SHA-256" value={displayHash} link="Verify manifest" /><ProvenanceItem label="Worker artifact" value={project.manifest.artifact} link="Artifact details" /><ProvenanceItem label="Network scope" value="Application origin only" link="Endpoint policy" /><ProvenanceItem label="Input data" value={`${project.manifest.input} (synthetic)`} link="About inputs" /><ProvenanceItem label="Local storage" value="None" link="Privacy details" /></div>
        <div className="work-strip"><div className="lane-copy"><strong>Work units</strong><span><i className="key active" /> Completed <i className="key" /> Pending</span></div><div className="unit-lane" aria-label={`${state.completed} of ${TOTAL_UNITS} work units complete`}>{Array.from({ length: TOTAL_UNITS }, (_, index) => <i key={index} className={index < state.completed ? 'active' : index === state.completed && state.status === 'running' ? 'working' : ''} />)}</div><div className="session-metrics"><span><strong>{formatDuration(state.elapsedSeconds)}</strong> elapsed</span><span><strong>{formatCount(state.totalSamples)}</strong> work items</span><span><strong>{state.samplesPerSec ? `${formatCount(state.samplesPerSec)}/s` : '—'}</strong> throughput</span><span><strong>~{estimateWattHours(state.busyMs).toFixed(3)} Wh</strong> estimated</span></div></div>
        {state.completed > 0 && <div className="receipt"><FileCheck2 /><div><strong>Contribution receipt ready</strong><span>{project.estimateLabel}: {state.aggregate.toFixed(4)}. Generated locally over synthetic inputs, with no identity or patient data attached.</span></div><button className="button secondary small" onClick={exportReceipt}><Download size={15} />Export JSON</button></div>}
      </section>

      <section className="safety" id="safety"><div><LockKeyhole /><h2>Privacy &amp; safety by design</h2></div><p>No personal or patient data is collected or used — every workload runs on synthetic inputs only. Compute runs locally in your browser. Stop if your device becomes warm. Energy values are estimates, not measurements.</p><div><BatteryMedium /><span>{batterySupported ? 'Session pauses automatically when unplugged.' : 'Pause-on-battery support varies by browser.'} The session never starts without your click.</span></div></section>
    </main>

    <div className="docs-wrapper" aria-label="Reference documentation">
      <section className="doc-section" id="study-methodology">
        <div className="doc-label"><span className="doc-num">01</span><h2>Methodology</h2></div>
        <div className="doc-body">
          <h3>{project.name} — study methodology</h3>
          <p>{project.kernelSummary} Each of the {TOTAL_UNITS} work units is seeded deterministically from its unit id, so every result is independently reproducible without storing any data, and aggregating across units recovers the quantity of interest ({project.estimateLabel.toLowerCase()}).</p>
          <p>{project.realWorldBasis}</p>
          <p>This is <strong>not publishable science</strong>. It demonstrates bounded, reproducible browser execution with a scientifically-shaped synthetic workload and a complete donor-side trust model. No result here should inform any clinical or scientific decision.</p>
        </div>
      </section>

      <section className="doc-section" id="model-code">
        <div className="doc-label"><span className="doc-num">02</span><h2>Model code</h2></div>
        <div className="doc-body">
          <h3>Worker kernel — {project.manifest.kernelId}</h3>
          <p>The compute worker is a TypeScript module bundled at build time and served only from the application origin; nothing is fetched at runtime. The core of the <strong>{project.name}</strong> kernel:</p>
          <pre className="doc-code">{project.kernelCode}</pre>
          <p>The kernel is seeded by a Mulberry32 PRNG per unit and returns a numeric estimate plus an integer checksum, so any unit can be re-run elsewhere and confirmed bit-for-bit. Switching studies above loads that study&rsquo;s kernel.</p>
        </div>
      </section>

      <section className="doc-section" id="data-sources">
        <div className="doc-label"><span className="doc-num">03</span><h2>Data sources</h2></div>
        <div className="doc-body">
          <h3>Synthetic inputs — {project.manifest.input}</h3>
          <p>All inputs are generated inside the worker at runtime from synthetic distributions seeded by the unit id. No file, network resource, real-world measurement, or patient dataset is referenced or transmitted. For this study, that means:</p>
          <ul>{project.whatRunsInBrowser.map((item, index) => <li key={index}>{item}</li>)}</ul>
          <p>The values are chosen to produce a plausible, scientifically-shaped distribution while keeping the computation clearly synthetic and non-attributable to any real patient, dataset, or institution.</p>
        </div>
      </section>

      <section className="doc-section" id="verify-manifest">
        <div className="doc-label"><span className="doc-num">04</span><h2>Verify manifest</h2></div>
        <div className="doc-body">
          <h3>Workload manifest</h3>
          <p>Before any compute starts, the browser verifies an ECDSA P-256 signature over the selected study&rsquo;s manifest JSON. This ensures the bundled workload matches the reviewed artifact — no runtime substitution is possible. Each study ships its own signed manifest:</p>
          <pre className="doc-code">{manifestJson}</pre>
          {manifestInfo
            ? <div className={`manifest-verified ${manifestInfo.valid ? 'valid' : 'invalid'}`}>
                {manifestInfo.valid ? <CheckCircle size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
                <span>{manifestInfo.valid ? 'Signature valid' : 'Signature invalid'}</span>
                <code title="SHA-256 of manifest JSON">{manifestInfo.hash}</code>
              </div>
            : <div className="manifest-verified loading"><span>Verifying…</span></div>
          }
          <p>To independently verify: serialize the manifest above with <code>JSON.stringify</code> (no extra whitespace), SHA-256 the UTF-8 bytes, and compare against the hash shown. The signing key is an ECDSA P-256 public key embedded in <code>src/core.ts</code>; manifests are signed at build time by <code>scripts/sign-manifests.mjs</code>.</p>
        </div>
      </section>

      <section className="doc-section" id="artifact-details">
        <div className="doc-label"><span className="doc-num">05</span><h2>Artifact details</h2></div>
        <div className="doc-body">
          <h3>Worker artifact</h3>
          <p><strong>{project.manifest.artifact}</strong> is a TypeScript module compiled and bundled by Vite at build time. It is served exclusively from the application origin and receives no code updates at runtime.</p>
          <ul>
            <li>Imports no external modules or libraries</li>
            <li>Makes no network requests — CSP <code>connect-src 'self'</code> applies to workers</li>
            <li>Has no access to the DOM, localStorage, cookies, IndexedDB, or any device API</li>
            <li>Communicates only through the structured Worker message channel</li>
            <li>Inbound: <code>{'{ type: "start", kernelId, startUnit, totalUnits, cpuPercent }'}</code></li>
            <li>Outbound: <code>{'{ type: "unit", unitId, estimate, checksum }'}</code></li>
          </ul>
          <p>Stopping the session terminates the Worker process immediately via <code>worker.terminate()</code>, preventing any further application work.</p>
        </div>
      </section>

      <section className="doc-section" id="endpoint-policy">
        <div className="doc-label"><span className="doc-num">06</span><h2>Endpoint policy</h2></div>
        <div className="doc-body">
          <h3>Content Security Policy</h3>
          <p>A strict CSP is delivered via <code>{'<meta http-equiv="Content-Security-Policy">'}</code>. The donor console loads only from the application origin; the only third-party allowance is Google Identity Services, used solely on the reviewer console (<code>#admin</code>) for sign-in.</p>
          <table className="csp-table">
            <thead><tr><th>Directive</th><th>Value</th><th>Effect</th></tr></thead>
            <tbody>
              <tr><td>default-src</td><td>'self'</td><td>All unlisted resources from origin only</td></tr>
              <tr><td>script-src</td><td>'self' https://accounts.google.com/gsi/client</td><td>Origin scripts; Google sign-in script for the reviewer console</td></tr>
              <tr><td>style-src</td><td>'self' 'unsafe-inline' https://accounts.google.com/gsi/style</td><td>Origin styles, inline styles, and the Google sign-in button style</td></tr>
              <tr><td>img-src</td><td>'self' data: https://*.googleusercontent.com</td><td>Origin and data-URI images; Google account avatar on sign-in</td></tr>
              <tr><td>connect-src</td><td>'self' https://accounts.google.com/gsi/</td><td>Same-origin API plus Google sign-in; no other external connections</td></tr>
              <tr><td>worker-src</td><td>'self' blob:</td><td>Workers from origin or blob (Vite worker bundling)</td></tr>
              <tr><td>frame-src</td><td>https://accounts.google.com/gsi/</td><td>Only the Google sign-in frame; no other iframes</td></tr>
              <tr><td>object-src</td><td>'none'</td><td>No plugins, Flash, or embedded objects</td></tr>
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
          <p>The host passes the worker only a kernel id and integer unit indices (0–{TOTAL_UNITS - 1}). No other data crosses the message boundary — no user information, no device state, no real-world or patient data.</p>
          <p>The worker derives every simulation input from the unit id via a deterministic PRNG. This means:</p>
          <ul>
            <li>Any work unit can be reproduced independently given only its id</li>
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
          <p>Compute Commons collects no personal or patient data — kernels run on synthetic inputs only. The full data inventory for a donation session:</p>
          <ul>
            <li><strong>Donor sessions stay on-device</strong> — compute progress, settings, and metrics live in browser memory only and are discarded when you close or navigate away. No donor data is transmitted.</li>
            <li><strong>No donor storage</strong> — donating writes no cookies, localStorage, or IndexedDB. (The reviewer console at <code>#admin</code> caches your Google sign-in token in sessionStorage for that tab only.)</li>
            <li><strong>No analytics or tracking</strong> — the donor console loads no third-party scripts, pixels, fingerprinting, or telemetry. Google Identity Services loads only on the reviewer console (<code>#admin</code>) for sign-in, never on the donor page.</li>
            <li><strong>Receipt is local</strong> — generated on demand and downloaded directly to your device. Nothing about your compute session is sent to any server.</li>
            <li><strong>Researcher proposals are the one exception</strong> — when you submit the proposal form, those fields (institution, research question, repository, classification, and optional email) are sent to the Compute Commons backend and stored in a Postgres database for manual review. This is a deliberate submission you initiate; donating compute never sends anything.</li>
          </ul>
          <p>No account is required to donate. The optional reviewer sign-in uses minimal Google OpenID scopes and is required only to access the proposal-review console, never to donate compute.</p>
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
          <p>This demonstration produces no validated scientific output and makes no such claim. The workloads are illustrative samples only.</p>
        </div>
      </section>
    </div>

    <footer><span>Compute Commons demonstration</span><a href="#how-it-works">How it works</a><a href="#acceptable-use">Acceptable use</a><a href="#privacy">Privacy</a><button onClick={() => setProposalOpen(true)}><FlaskConical size={15} />Propose research</button></footer>
    {proposalOpen && <ProposalDialog onClose={() => setProposalOpen(false)} />}
  </div>
}
