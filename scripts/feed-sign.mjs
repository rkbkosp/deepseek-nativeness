#!/usr/bin/env node
/**
 * Update-feed signing for this client's checker (M7a / M7b release tooling).
 *
 * The client trusts one Ed25519 public key compiled into its binary
 * (`-ldflags -X main.updateFeedPublicKey=…`) and refuses any feed whose detached
 * signature does not verify over the exact bytes it fetched. This script
 * produces that key pair and that signature, so a local QA feed and a real
 * release feed are signed the same way the client verifies them:
 *
 *   node scripts/feed-sign.mjs keygen --out /secure/update-feed-key.json
 *   node scripts/feed-sign.mjs sign --key /secure/update-feed-key.json --feed feed.json
 *   node scripts/feed-sign.mjs verify --key /secure/update-feed-key.json --feed feed.json
 *
 * `keygen` prints the public key and the exact linker flags to build with. The
 * private key is written only where `--out` says (mode 0600): keep it out of the
 * repository and out of build products — the app embeds the public key only.
 *
 * Signature format: ed25519 over the raw feed bytes, base64 (standard alphabet)
 * in `feed.json.sig`. Nothing is normalized: the file is signed as stored, so
 * reformatting feed.json invalidates its signature.
 *
 * The signing and verification functions are exported, so
 * scripts/probe-update-check.mjs signs its QA feeds with this same code instead
 * of a second copy of the format.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as signBytes, verify as verifyBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The checkout this script lives in, so a key can be kept out of it. */
const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const ALGORITHM = 'ed25519'
export const PUBLIC_KEY_BYTES = 32
/** SPKI DER header of an Ed25519 public key; the raw key follows it. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/** A fresh signing key pair, in the shape the key file stores. */
export function generateUpdateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync(ALGORITHM)
  return {
    algorithm: ALGORITHM,
    comment: 'update feed signing key; the app embeds publicKey only',
    publicKey: rawPublicKeyB64(publicKey),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  }
}

/** Raw 32-byte public key from an SPKI DER export: the last 32 bytes are the key. */
function rawPublicKeyB64(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return Buffer.from(der.subarray(der.length - PUBLIC_KEY_BYTES)).toString('base64')
}

/** The public key object of a key record, for verification. */
export function publicKeyObject(record) {
  if (record.publicKey) {
    const raw = Buffer.from(record.publicKey, 'base64')
    if (raw.length !== PUBLIC_KEY_BYTES) throw new Error(`public key is ${raw.length} bytes, want ${PUBLIC_KEY_BYTES}`)
    return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' })
  }
  return createPublicKey(privateKeyObject(record))
}

function privateKeyObject(record) {
  return createPrivateKey({ key: Buffer.from(record.privateKey, 'base64'), format: 'der', type: 'pkcs8' })
}

/**
 * The detached signature file's content for these exact bytes: base64 and one
 * trailing newline, which the client trims.
 */
export function signFeedBytes(record, feedBytes) {
  return `${signBytes(null, feedBytes, privateKeyObject(record)).toString('base64')}\n`
}

/** Whether the signature file's content signs these exact bytes. */
export function verifyFeedBytes(record, feedBytes, signatureText) {
  const signature = Buffer.from(String(signatureText).trim(), 'base64')
  return verifyBytes(null, feedBytes, publicKeyObject(record), signature)
}

const USAGE = [
  'usage:',
  '  node scripts/feed-sign.mjs keygen [--out key.json]',
  '  node scripts/feed-sign.mjs sign --key key.json --feed feed.json [--out feed.json.sig]',
  '  node scripts/feed-sign.mjs verify --key key.json --feed feed.json [--sig feed.json.sig]',
  '  node scripts/feed-sign.mjs public-key --key key.json',
  '',
].join('\n')

function usage(message) {
  if (message) process.stderr.write(`feed-sign: ${message}\n`)
  process.stderr.write(USAGE)
  process.exit(2)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (!argument.startsWith('--')) usage(`unexpected argument ${argument}`)
    const name = argument.slice(2)
    const value = rest[index + 1]
    if (!value || value.startsWith('--')) usage(`--${name} needs a value`)
    options[name] = value
    index += 1
  }
  return { command, options }
}

function readKeyPair(path) {
  const file = resolve(path)
  if (!existsSync(file)) usage(`no key file at ${file}`)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    usage(`key file is not JSON: ${error.message}`)
  }
  if (parsed.algorithm !== ALGORITHM) usage(`key file is ${parsed.algorithm}, want ${ALGORITHM}`)
  if (typeof parsed.publicKey !== 'string' || typeof parsed.privateKey !== 'string') {
    usage('key file needs publicKey and privateKey (base64)')
  }
  return parsed
}

function keygen(options) {
  const record = generateUpdateKeyPair()
  if (options.out) {
    const target = resolve(options.out)
    writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    chmodSync(target, 0o600)
    if (target.startsWith(`${REPOSITORY}/`)) {
      process.stderr.write('feed-sign: warning: the private key is inside the repository; keep it on the release machine instead\n')
    }
    process.stdout.write(`feed-sign: wrote ${target} (mode 0600)\n`)
  }
  process.stdout.write(`public key: ${record.publicKey}\n`)
  process.stdout.write(`build with: -X main.updateFeedPublicKey=${record.publicKey}\n`)
  if (!options.out) {
    process.stdout.write('private key (store outside the repository):\n')
    process.stdout.write(`${record.privateKey}\n`)
  }
  return 0
}

function signFeed(options) {
  if (!options.key) usage('sign needs --key')
  if (!options.feed) usage('sign needs --feed')
  const record = readKeyPair(options.key)
  const feedPath = resolve(options.feed)
  // Read the bytes exactly as stored: the client verifies what it fetched.
  const feed = readFileSync(feedPath)
  const target = resolve(options.out ?? `${feedPath}.sig`)
  writeFileSync(target, signFeedBytes(record, feed))
  process.stdout.write(`feed-sign: ${target} signs ${feedPath} (${feed.length} bytes)\n`)
  return 0
}

function verifyFeed(options) {
  if (!options.key) usage('verify needs --key')
  if (!options.feed) usage('verify needs --feed')
  const record = readKeyPair(options.key)
  const feedPath = resolve(options.feed)
  const signaturePath = resolve(options.sig ?? `${feedPath}.sig`)
  const ok = verifyFeedBytes(record, readFileSync(feedPath), readFileSync(signaturePath, 'utf8'))
  process.stdout.write(ok ? `feed-sign: signature verifies (${signaturePath})\n` : `feed-sign: signature does NOT verify (${signaturePath})\n`)
  return ok ? 0 : 1
}

function printPublicKey(options) {
  if (!options.key) usage('public-key needs --key')
  const record = readKeyPair(options.key)
  process.stdout.write(`${record.publicKey}\n`)
  process.stdout.write(`build with: -X main.updateFeedPublicKey=${record.publicKey}\n`)
  return 0
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  const { command, options } = parseArgs(process.argv.slice(2))
  switch (command) {
    case 'keygen':
      process.exit(keygen(options))
    case 'sign':
      process.exit(signFeed(options))
    case 'verify':
      process.exit(verifyFeed(options))
    case 'public-key':
      process.exit(printPublicKey(options))
    default:
      usage(command ? `unknown command ${command}` : 'no command')
  }
}
