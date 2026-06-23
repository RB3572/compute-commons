// Build-time manifest signer for Compute Commons.
//
// Generates one ephemeral ECDSA P-256 keypair (the "platform signing key"), signs
// each project manifest, and prints the public JWK + per-manifest signatures to embed
// in src/core.ts. Signatures are raw IEEE-P1363 (r||s), which the browser's Web Crypto
// `ECDSA verify` expects. The private key is discarded — re-running re-signs with a new
// key, so run once and paste the output.
//
// Usage: node scripts/sign-manifests.mjs path/to/manifests.json
//   manifests.json = array of manifest objects (each serialized exactly as the app will
//   JSON.stringify it before hashing/verifying).
import { generateKeyPairSync, sign, webcrypto } from 'crypto'
import { readFileSync } from 'fs'

const path = process.argv[2]
if (!path) { console.error('usage: node scripts/sign-manifests.mjs <manifests.json>'); process.exit(1) }
const manifests = JSON.parse(readFileSync(path, 'utf8'))
if (!Array.isArray(manifests)) { console.error('manifests.json must be an array'); process.exit(1) }

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pubJwk = publicKey.export({ format: 'jwk' })
const signingPublicKey = { key_ops: ['verify'], ext: true, kty: pubJwk.kty, crv: pubJwk.crv, x: pubJwk.x, y: pubJwk.y }

const importedKey = await webcrypto.subtle.importKey('jwk', pubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])

const signatures = {}
for (const manifest of manifests) {
  const bytes = Buffer.from(JSON.stringify(manifest), 'utf8')
  const sig = sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' })
  const b64 = sig.toString('base64')
  // self-check: verify the freshly-minted signature the same way the browser will
  const ok = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, importedKey, Uint8Array.from(Buffer.from(b64, 'base64')), bytes)
  if (!ok) { console.error(`FAILED self-verify for manifest ${manifest.id}`); process.exit(1) }
  signatures[manifest.id] = b64
}

console.log('// --- paste into src/core.ts ---')
console.log('export const signingPublicKey: JsonWebKey = ' + JSON.stringify(signingPublicKey) + '\n')
console.log('export const manifestSignatures: Record<string, string> = ' + JSON.stringify(signatures, null, 2))
console.log('\n// all signatures self-verified against Web Crypto ✓')
