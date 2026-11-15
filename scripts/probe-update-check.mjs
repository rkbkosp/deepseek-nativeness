#!/usr/bin/env node
/**
 * M7a acceptance: one real update check against a local, signed feed.
 *
 * The probe builds a throwaway test binary with the feed URL and the Ed25519
 * public key injected through `-ldflags -X` (the same linker path a release
 * build uses), lays it out as an .app bundle with an app-version.json, serves a
 * feed from a local static HTTP server, and runs the binary's headless
 * `--check-update-once <evidence.json>` entry point once per case.
 *
 * Covered outcomes:
 *   available  a signed feed newer than the bundle       → state "available"
 *   current    a signed feed with this exact build        → state "current"
 *   downgrade  a signed feed older than the bundle        → state "current"
 *   tampered   one changed byte in the signed feed        → state "failed"/signature
 *   network    no server listening                        → state "failed"/network
 *
 * Nothing is downloaded or installed: the checker has no such code path, and the
 * probe verifies the bundle's file list is identical before and after. No GUI is
 * started: the headless entry point exits before the window and the single
 * instance lock, so this can run while a real client is open.
 *
 *   node scripts/probe-update-check.mjs
 *   node scripts/probe-update-check.mjs --evidence qa/runtime-results/local-update-check.json
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateUpdateKeyPair, signFeedBytes } from './feed-sign.mjs'

const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUN_TIMEOUT_MS = 60_000
const BUILD_TIMEOUT_MS = 240_000
const FEED_PATH = '/feed.json'
const SIG_PATH = `${FEED_PATH}.sig`
/** The version the fake bundle reports: what scripts/build-app.sh writes. */
const CURRENT = { version: '0.2.2', buildNumber: '202611150900' }
const CURRENT_BUILD = Number(CURRENT.buildNumber)

function parseArgs(argv) {
  const options = { evidence: 'qa/runtime-results/local-update-check.json', keep: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--evidence') options.evidence = argv[++index]
    else if (argv[index] === '--keep') options.keep = true
    else throw new Error(`probe: unknown argument ${argv[index]}`)
  }
  return options
}

function log(message) {
  process.stdout.write(`probe-update-check: ${message}\n`)
}

/** One file entry per path under root, for "nothing was written" evidence. */
function snapshotTree(root) {
  const entries = []
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name)
      const stats = statSync(path)
      if (stats.isDirectory()) {
        entries.push(`${relative(root, path)}/`)
        walk(path)
      } else {
        entries.push(`${relative(root, path)}:${stats.size}:${createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)}`)
      }
    }
  }
  if (!statSafe(root)) return entries
  walk(root)
  return entries
}

function statSafe(path) {
  try {
    return statSync(path)
  } catch {
    return undefined
  }
}

/** A port that was free a moment ago; the server binds it immediately after. */
function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.on('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

const CONTENT_TYPES = { '.json': 'application/json', '.sig': 'text/plain', '.zip': 'application/octet-stream' }

/** A static file server over root, with no path traversal. */
function serveDirectory(root) {
  return createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    const file = resolve(root, `.${path}`)
    if (!file.startsWith(`${root}/`) || path.endsWith('/')) {
      response.writeHead(404).end()
      return
    }
    try {
      const body = readFileSync(file)
      response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': body.length })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
}

function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, '127.0.0.1', () => resolveListen())
  })
}

function closeServer(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()))
}

/** The environment a QA launch gets: nothing of the person's real profile. */
function isolatedEnvironment(home) {
  const environment = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, XDG_STATE_HOME: home, APPDATA: home, LOCALAPPDATA: home }
  // The headless entry point is a development-build flag.
  delete environment.MYGO_ENV
  delete environment.MYGO_DEV
  return environment
}

function buildTestBinary(bundleRoot, feedURL, publicKey) {
  const executable = join(bundleRoot, 'Contents', 'MacOS', 'native-dsh')
  mkdirSync(dirname(executable), { recursive: true })
  const ldflags = `-X main.updateFeedURL=${feedURL} -X main.updateFeedPublicKey=${publicKey}`
  const result = spawnSync('go', ['build', '-buildvcs=false', '-o', executable, '-ldflags', ldflags, '.'], {
    cwd: DESKTOP,
    env: { ...process.env, GOCACHE: process.env.GOCACHE ?? '/tmp/dsh-go-cache', CGO_ENABLED: '0' },
    encoding: 'utf8',
    timeout: BUILD_TIMEOUT_MS,
  })
  if (result.status !== 0) {
    throw new Error(`go build failed (${result.status}):\n${result.stderr || result.stdout}`)
  }
  mkdirSync(join(bundleRoot, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(
    join(bundleRoot, 'Contents', 'Resources', 'app-version.json'),
    `${JSON.stringify({ appVersion: CURRENT.version, buildNumber: CURRENT.buildNumber, runtimeVersion: '0.2.2-rc.3', builtAt: '2026-11-15T00:00:00Z' })}\n`,
  )
  return executable
}

/** The feed document a release publishes, as the exact bytes that get signed. */
function feedDocument(releases) {
  return `${JSON.stringify({ schemaVersion: 1, channel: 'nightly', releases })}\n`
}

function releaseDocument(overrides = {}) {
  return {
    version: '0.2.3',
    buildNumber: CURRENT_BUILD + 1,
    minimumRuntimeHostProtocol: 1,
    notes: '修复本地工作区恢复时的崩溃。\n\n- 恢复失败后不再清空会话列表。',
    downloadURL: 'https://updates.example.com/native-dsh/DeepSeek-Nativeness-0.2.3.zip',
    publishedAt: '2026-11-15T09:00:00Z',
    ...overrides,
  }
}

/** Write the served feed and its signature; tamperByte flips one signed byte. */
function writeScenario(served, releases, tamperByte, keyRecord) {
  const feedBytes = Buffer.from(feedDocument(releases))
  const signature = signFeedBytes(keyRecord, feedBytes)
  if (tamperByte !== undefined) feedBytes[tamperByte] ^= 0x01
  writeFileSync(join(served, 'feed.json'), feedBytes)
  writeFileSync(join(served, 'feed.json.sig'), signature)
}

function runHeadlessCheck(executable, evidencePath, home) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, ['--check-update-once', evidencePath], {
      env: isolatedEnvironment(home),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), RUN_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      rejectRun(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      let evidence
      let readError
      try {
        evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
      } catch (error) {
        readError = String(error)
      }
      resolveRun({ code, signal, stdout, stderr, evidence, readError })
    })
  })
}

function check(name, passed, detail) {
  return { name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) }
}

/** Compare one observed evidence document with what the case promises. */
function pushCheck(checks, name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) })
}

function evaluate(run, expected) {
  const evidence = run.evidence ?? {}
  const release = evidence.release ?? null
  const checks = []
  pushCheck(checks, 'exit code is 0', run.code === 0, run.code)
  pushCheck(checks, 'evidence was written', run.evidence !== undefined, run.readError)
  pushCheck(checks, 'phase is check-only', evidence.phase === 'check-only', evidence.phase)
  pushCheck(checks, 'devBuild is true', evidence.devBuild === true, evidence.devBuild)
  pushCheck(checks, 'feed URL came from the build', evidence.feed?.url === expected.feedURL, evidence.feed?.url)
  pushCheck(checks, 'public key came from the build', evidence.feed?.publicKey === expected.publicKey, evidence.feed?.publicKey)
  pushCheck(checks, `state is ${expected.state}`, evidence.state === expected.state, evidence.state)
  pushCheck(checks, `failure is ${expected.failure ?? 'none'}`, (evidence.failure ?? '') === (expected.failure ?? ''), evidence.failure ?? '')
  if (expected.reason !== undefined) {
    pushCheck(checks, `reason is ${expected.reason}`, evidence.reason === expected.reason, evidence.reason)
  }
  if (expected.message === 'calm and non-empty') {
    pushCheck(checks, 'a person-readable message', typeof evidence.message === 'string' && evidence.message.length > 0 && !/panic|traceback|exception/iu.test(evidence.message), evidence.message)
  }
  if (expected.state === 'available') {
    pushCheck(checks, 'a release is offered', release !== null, release)
    pushCheck(checks, `release version is ${expected.version}`, release?.version === expected.version, release?.version)
    pushCheck(checks, `release build number is ${expected.buildNumber}`, release?.buildNumber === expected.buildNumber, release?.buildNumber)
    pushCheck(checks, 'download page is the signed feed URL', release?.downloadURL === expected.downloadURL, release?.downloadURL)
    pushCheck(checks, 'notes travelled with the offer', typeof release?.notes === 'string' && release.notes.length > 0, release?.notes?.length)
  } else {
    pushCheck(checks, 'no release is offered', release === null, release)
  }
  return checks
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const evidencePath = resolve(DESKTOP, options.evidence)
  const root = mkdtempSync(join(tmpdir(), 'native-dsh-update-probe-'))
  const served = join(root, 'served')
  const bundle = join(root, 'DeepSeek Nativeness.app')
  const home = join(root, 'home')
  const results = join(root, 'results')
  for (const directory of [served, home, results]) mkdirSync(directory, { recursive: true })

  const publicKeyRecord = generateUpdateKeyPair()
  const port = await freePort()
  const feedURL = `http://127.0.0.1:${port}${FEED_PATH}`
  const downloadURL = `http://127.0.0.1:${port}/download/DeepSeek-Nativeness-0.2.3.zip`
  log(`building a test binary with the feed injected (-X main.updateFeedURL, -X main.updateFeedPublicKey)`)
  const executable = buildTestBinary(bundle, feedURL, publicKeyRecord.publicKey)
  const bundleBefore = snapshotTree(bundle)

  // The server serves these files; each scenario rewrites them.
  mkdirSync(join(served, 'download'), { recursive: true })
  writeFileSync(join(served, 'download', 'DeepSeek-Nativeness-0.2.3.zip'), 'placeholder download page\n')

  const server = serveDirectory(served)
  await listen(server, port)

  // Each scenario rewrites what the static server holds: a signed feed, or the
  // same feed with one changed byte.
  const scenarios = [
    {
      name: 'available',
      description: 'a signed feed newer than the bundle offers its release',
      releases: [releaseDocument({ downloadURL })],
      expected: { state: 'available', version: '0.2.3', buildNumber: CURRENT_BUILD + 1, downloadURL },
    },
    {
      name: 'current',
      description: 'a signed feed with this exact build reports no update',
      releases: [releaseDocument({ version: CURRENT.version, buildNumber: CURRENT_BUILD, downloadURL })],
      expected: { state: 'current' },
    },
    {
      name: 'downgrade',
      description: 'a signed feed older than the bundle is refused, not offered',
      releases: [releaseDocument({ version: '0.2.1', buildNumber: CURRENT_BUILD - 1, downloadURL })],
      expected: { state: 'current' },
    },
    {
      name: 'tampered',
      description: 'one changed byte invalidates the signature and is treated as a failed check',
      releases: [releaseDocument({ downloadURL })],
      tamperByte: 12,
      expected: { state: 'failed', failure: 'signature', reason: 'signature-mismatch', message: 'calm and non-empty' },
    },
    {
      name: 'network',
      description: 'no server listening classifies as a quiet failure',
      offline: true,
      expected: { state: 'failed', failure: 'network', reason: 'unreachable', message: 'calm and non-empty' },
    },
  ]

  const cases = []
  let ok = true
  for (const scenario of scenarios) {
    if (scenario.offline) await closeServer(server)
    else writeScenario(served, scenario.releases, scenario.tamperByte, publicKeyRecord)
    const caseEvidence = join(results, `${scenario.name}.json`)
    const run = await runHeadlessCheck(executable, caseEvidence, home)
    const checks = evaluate(run, { ...scenario.expected, feedURL, publicKey: publicKeyRecord.publicKey })
    const passed = checks.every((entry) => entry.passed)
    const evidence = run.evidence ?? {}
    cases.push({
      name: scenario.name,
      description: scenario.description,
      expected: {
        state: scenario.expected.state,
        failure: scenario.expected.failure ?? '',
        ...(scenario.expected.reason === undefined ? {} : { reason: scenario.expected.reason }),
        ...(scenario.expected.state === 'available' ? { version: scenario.expected.version, buildNumber: scenario.expected.buildNumber } : {}),
      },
      observed: {
        state: evidence.state,
        failure: evidence.failure ?? '',
        reason: evidence.reason ?? '',
        message: evidence.message ?? '',
        channel: evidence.channel ?? '',
        releasesOffered: evidence.releasesOffered,
        feedBytes: evidence.feedBytes,
        durationMs: evidence.durationMs,
        release: evidence.release ?? null,
      },
      checks,
      exitCode: run.code,
      signal: run.signal,
      stderrTail: (run.stderr ?? '').split('\n').filter(Boolean).slice(-2).join('\n'),
      passed,
    })
    ok = passed && ok
    log(`${passed ? 'PASS' : 'FAIL'} ${scenario.name} (${evidence.state ?? 'no evidence'}${evidence.reason ? `/${evidence.reason}` : ''})`)
  }

  const bundleAfter = snapshotTree(bundle)
  const unchanged = JSON.stringify(bundleBefore) === JSON.stringify(bundleAfter)
  if (!unchanged) {
    ok = false
    log('FAIL the check wrote inside the bundle')
  }

  const report = {
    generatedAt: new Date().toISOString(),
    probe: 'probe-update-check',
    milestone: 'M7a: update check and offer only — no download, no automatic install',
    baseRevision: '13b5943',
    binary: {
      builtFrom: 'desktop (go build, -ldflags -X)',
      feedURLInjected: feedURL,
      publicKeyInjected: publicKeyRecord.publicKey,
      keySource: 'scripts/feed-sign.mjs generateUpdateKeyPair()',
      appVersion: CURRENT,
    },
    bundle: {
      layout: '<tmp>/DeepSeek Nativeness.app/Contents/{MacOS/native-dsh,Resources/app-version.json}',
      filesBefore: bundleBefore,
      filesAfter: bundleAfter,
      unchanged,
      note: 'M7a has no download or install code path; the file list is evidence, not a promise',
    },
    feed: {
      format: 'application/json, schemaVersion 1',
      signature: 'Ed25519 over the exact feed bytes, base64 in feed.json.sig',
      verification: 'crypto/ed25519, public key injected at build time',
      current: CURRENT,
    },
    cases,
    allPassed: ok && cases.length === 5,
    tempRoot: options.keep ? root : undefined,
  }
  mkdirSync(dirname(evidencePath), { recursive: true })
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`)
  log(`evidence: ${relative(process.cwd(), evidencePath) || evidencePath}`)
  if (!options.keep) rmSync(root, { recursive: true, force: true })
  else log(`kept ${root}`)
  if (!report.allPassed) {
    for (const entry of cases.filter((item) => !item.passed)) {
      for (const failed of entry.checks.filter((item) => !item.passed)) {
        log(`  ${entry.name}: ${failed.name} (observed ${JSON.stringify(failed.detail)})`)
      }
    }
    process.exitCode = 1
    return
  }
  log(`all ${cases.length} cases passed`)
}

main().catch((error) => {
  process.stderr.write(`probe-update-check: ${error?.stack ?? error}\n`)
  process.exitCode = 1
})
