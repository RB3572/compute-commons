# Compute Commons

Compute Commons is a privacy-first browser compute donor console. It lets a visitor intentionally contribute a short, resource-limited browser session to a reviewed demonstration workload and receive a locally generated, verifiable receipt.

## Product brief

The first release demonstrates the donor-side trust model using a deterministic climate-ensemble sample over synthetic inputs. A visitor can inspect the study and manifest, choose a CPU budget and session cap, start explicitly, pause or stop immediately, and export a contribution receipt. No account or backend is required. A separate researcher proposal form records a review request locally; it never executes submitted code.

The primary audience is privacy-conscious people who want to help public-interest research without surrendering control of their device. Success means a visitor understands the workload, starts deliberately, sees real work complete, can stop instantly, and can inspect the resulting receipt.

## Threat and privacy assessment

- Compute never starts automatically. Every session requires a fresh click.
- The shipped worker runs only a bundled deterministic workload over synthetic inputs. Researcher submissions cannot reach the worker.
- The app requests no identity, sensor, filesystem, clipboard, location, or notification permission.
- Session progress and proposal drafts stay in memory. Exporting a receipt creates a local download only when requested.
- The worker has no application-defined network capability. A strict Content Security Policy limits scripts, connections, frames, and objects.
- CPU percentage is implemented as cooperative duty-cycle throttling; browser scheduling and device power vary, so the energy figure is explicitly an estimate.
- Pause and stop terminate scheduling promptly. Stopping terminates the worker, preventing continued application work.
- Remaining risks include browser/runtime defects, inaccurate device energy estimates, and thermal behavior outside the app's control. The product advises stopping if the device becomes warm.
- No claim is made that this demo produces publishable science. The sample demonstrates bounded execution and provenance.

## Visual specification

The accepted concept is stored at `docs/visual-concept.png`. The interface uses an off-white `#F7F7F6` base, white surfaces, near-black text, fine gray borders, and restrained teal `#087F73`. It uses an open two-column console, a thin work-unit lane, 8–10 px radii, and borders rather than shadows. The mobile layout becomes a single column.

## Architecture

- React 19, TypeScript, and Vite
- Dedicated Web Worker for deterministic Monte Carlo work units
- Web Crypto SHA-256 verification of the bundled workload manifest
- Vitest for deterministic core and reducer tests
- Client-only deployment; no database, OAuth, analytics, or cookies

## Operations

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

The production output is `dist/`. No environment variables are required.

## Acceptable use

Compute Commons does not permit cryptocurrency mining, credential attacks, surveillance, weapons optimization, personal-data processing, or proprietary payloads. Research proposals are review requests only. A real campaign would require independent security review and institutional verification before distribution.

