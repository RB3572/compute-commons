# Compute Commons

Compute Commons is a privacy-first browser compute donor console. It lets a visitor intentionally contribute a short, resource-limited browser session to a reviewed demonstration workload and receive a locally generated, verifiable receipt.

Production: [compute-commons.rishib.com](https://compute-commons.rishib.com)

Repository: [RB3572/compute-commons](https://github.com/RB3572/compute-commons)

## Product brief

The first release demonstrates the donor-side trust model with a catalog of three medical-research studies, each a deterministic kernel over synthetic inputs and modeled on a real volunteer-computing project:

- **Beat the Block** — drug-induced arrhythmia (Long-QT / torsades) risk via a stochastic virtual-heart-cell ensemble. Modeled on the FDA-led CiPA initiative and the O'Hara–Rudy ventricular model.
- **Flag the Neoantigen** — cancer-immunotherapy peptide–MHC binding via a structure-based pose search. Modeled on the Rosetta@home FlexPepDock pipeline.
- **Marker Mosaic** — combinatorial gene-panel discovery via a rank-based AUC search over a synthetic cohort. Modeled on World Community Grid's Mapping Cancer Markers.

A visitor picks a study, inspects its signed manifest, chooses a CPU budget and session cap, starts explicitly, pauses or stops immediately, and exports a contribution receipt. Donating requires no account and runs entirely in the browser. A dedicated **How it works** page (`#how-it-works`) explains the purpose, the trust model, and how to use it. A separate researcher proposal form submits a review request to a backend (a Vercel serverless function backed by Neon Postgres); submissions are stored for manual review in a reviewer console at `#admin` (Google sign-in, email-allowlisted) and never execute submitted code.

The primary audience is privacy-conscious people who want to help public-interest research without surrendering control of their device. Success means a visitor understands the workload, starts deliberately, sees real work complete, can stop instantly, and can inspect the resulting receipt. **Every shipped kernel is an illustrative sample over synthetic inputs — not publishable science, and no output should inform any clinical or scientific decision.**

## Threat and privacy assessment

- Compute never starts automatically. Every session requires a fresh click.
- The shipped worker runs only the bundled deterministic kernel for the selected study, over synthetic inputs. No patient data is used. Researcher submissions cannot reach the worker.
- The app requests no identity, sensor, filesystem, clipboard, location, or notification permission.
- Donor session progress stays in browser memory and is never transmitted. Exporting a receipt creates a local download only when requested. Researcher proposals are the one deliberate exception: the fields you submit are sent to the backend and stored in Postgres for review.
- The worker has no application-defined network capability. A strict Content Security Policy limits scripts, connections, frames, and objects; the only same-origin endpoint is `/api/proposals`, used by the proposal form, never by the worker.
- CPU percentage is enforced as cooperative duty-cycle throttling **inside the worker**: each busy compute slice is followed by a proportional idle slice, so average single-core utilization tracks the slider. Browser scheduling and device power vary, so the energy figure (derived from measured busy time) is explicitly an estimate.
- Pause and stop terminate scheduling promptly. Stopping terminates the worker, preventing continued application work.
- Remaining risks include browser/runtime defects, inaccurate device energy estimates, and thermal behavior outside the app's control. The product advises stopping if the device becomes warm.
- No claim is made that this demo produces publishable science. The sample demonstrates bounded execution and provenance.

## Visual specification

The accepted concept is stored at `docs/visual-concept.png`; a later control-panel exploration is stored at `docs/visual-concept-v2.png`. The implementation follows the accepted teal concept: an off-white `#F7F7F6` base, white surfaces, near-black text, fine gray borders, and restrained teal `#087F73`. It uses an open two-column console, a thin work-unit lane, 8–10 px radii, and borders rather than shadows. The mobile layout becomes a single column.

## Architecture

- React 19, TypeScript, and Vite
- Dedicated Web Worker hosting three genuinely CPU-bound, deterministic kernels (a stochastic action-potential time-stepper, a structure-based pose search, and a combinatorial rank-AUC search), each seeded by mulberry32, with cooperative duty-cycle throttling and live measured throughput
- Per-study ECDSA P-256 signed manifests, verified locally with Web Crypto before any compute begins; the public key and signatures are embedded in `src/core.ts` and a test fails the build if any manifest no longer verifies
- Hash routing between the donor console, the dedicated How-it-works page, and the reviewer console
- Vitest for deterministic core, reducer, and manifest-verification tests
- Vercel serverless functions (`/api/proposals`) backed by Neon Postgres for researcher proposal intake and the reviewer console; donor compute remains fully client-side with no analytics or cookies

## Operations

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

The production output is `dist/`; Vercel also builds the `api/` directory as Node serverless functions. Donor compute needs no environment variables. The proposal backend needs `DATABASE_URL` (provisioned by Vercel's native Neon integration). The reviewer console at `#admin` authenticates with Google Sign-In: the API verifies the Google ID token and checks the email against an allowlist (`ADMIN_EMAILS`, default the project owner) for the configured `GOOGLE_CLIENT_ID` (a "Web application" OAuth client whose authorized JavaScript origin must include the production domain). The `proposals` table is created automatically on first request. Type-check the functions with `npm run typecheck:api`.

Production is deployed from GitHub to Vercel. The custom hostname is registered with the Vercel project and resolves through a DNS-only Cloudflare record to Vercel's requested target, allowing Vercel to terminate TLS directly.

### Re-signing manifests

Manifest signing is a one-time manual step, not part of `npm run build`. If you change any study's `manifest` object in `src/core.ts`, regenerate the signatures:

1. Write the manifest objects (in the same key order as `src/core.ts`) to a JSON array file, e.g. `manifests.json`.
2. Run `node scripts/sign-manifests.mjs manifests.json`. It mints a fresh ECDSA P-256 key, signs each manifest, self-verifies against Web Crypto, and prints `signingPublicKey` + `manifestSignatures`.
3. Paste both into `src/core.ts` and commit. `npm test` verifies every manifest signature, so a mismatch fails CI before deploy.

## Acceptable use

Compute Commons does not permit cryptocurrency mining, credential attacks, surveillance, weapons optimization, personal-data processing, or proprietary payloads. Research proposals are review requests only. A real campaign would require independent security review and institutional verification before distribution.
