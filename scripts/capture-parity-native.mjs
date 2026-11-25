#!/usr/bin/env node
/**
 * Bounded parity capture of the current native client.
 *
 * Each QA UI state runs as its own process: the single-instance lock, the local
 * Host and the restored Session all start clean, so a state that needs a
 * Session-scoped surface (`trajectory`, `plugins`, `settings-models`,
 * `agent-presets`) never inherits another state's surface. Nothing is
 * synthesised: the client opens the state itself through `--ui-state`.
 *
 * The capture is the window's own snapshot (`--capture`), so it needs no
 * Screen Recording grant and no Accessibility approval. The companion
 * `--window-diagnostics` file records the window's real bounds, which the
 * caller needs to compare against the reference client's window.
 *
 *   node scripts/capture-parity-native.mjs \
 *     --binary build/_tmp/native-dsh-parity \
 *     --home /tmp/dsh-parity-native.XXXXXX \
 *     --out qa/parity-2026-11-23/native
 *
 * macOS-only, no network prompts, no approval clicks, no session messages.
 */

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DEFAULT_STATES = [
  'none',
  'transcript',
  'settings',
  'search',
  'right-pane',
  'trajectory',
  'plugins',
  'workspace-create',
  'settings-models',
  'agent-presets',
]

const LOG_TAIL_LINES = 30
const LOG_BUFFER_LIMIT = 512 * 1024

/**
 * `--states plugins,transcript` numbers the files in the order given; a state
 * may carry its own number as `07:plugins`, so a follow-up run keeps the file a
 * reviewer already has (`07-plugins-window.png`) instead of renumbering it.
 */
function parseStates(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => {
      const match = item.match(/^(\d{1,2}):(.+)$/)
      if (match !== null) return { prefix: match[1].padStart(2, '0'), state: match[2] }
      return { prefix: String(index + 1).padStart(2, '0'), state: item }
    })
}

function parseArgs(argv) {
  const options = {
    binary: 'build/_tmp/native-dsh-parity',
    home: undefined,
    out: 'qa/parity-2026-11-23/native',
    states: DEFAULT_STATES.map((state, index) => ({ state, prefix: String(index + 1).padStart(2, '0') })),
    binaryNote: undefined,
    compatCapture: false,
    merge: undefined,
    headBinarySha: undefined,
    theme: 'dark',
    captureAfter: '8s',
    exitAfter: '35s',
    graceMs: 45_000,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    // Boolean switches take no value, so they must not consume the next flag.
    if (key === '--compat-capture') {
      options.compatCapture = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`parity: ${key} needs a value`)
    if (key === '--binary') options.binary = value
    else if (key === '--home') options.home = value
    else if (key === '--out') options.out = value
    else if (key === '--states') options.states = parseStates(value)
    else if (key === '--merge') options.merge = value
    else if (key === '--theme') options.theme = value
    else if (key === '--capture-after') options.captureAfter = value
    else if (key === '--exit-after') options.exitAfter = value
    else if (key === '--grace-ms') options.graceMs = Number(value)
    else if (key === '--binary-note') options.binaryNote = value
    else if (key === '--head-binary-sha') options.headBinarySha = value
    else throw new Error(`parity: unknown argument ${key}`)
    index += 1
  }
  if (options.home === undefined) throw new Error('parity: --home is required (isolated copy, never ~/.dsh)')
  if (resolve(options.home) === resolve(process.env.HOME ?? '', '.dsh')) {
    throw new Error('parity: refusing to run against the shared ~/.dsh home')
  }
  return options
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Reads the PNG IHDR, so a capture that is not really a PNG fails loudly. */
function pngSize(path) {
  const data = readFileSync(path)
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (data.length < 24 || !data.subarray(0, 8).equals(signature)) {
    throw new Error('not a PNG (no PNG signature)')
  }
  if (data.subarray(12, 16).toString('latin1') !== 'IHDR') {
    throw new Error('not a PNG (first chunk is not IHDR)')
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

/**
 * A log line can carry a Host URL with a token or an API key. Keep the last
 * lines only, and mask anything that looks like a secret before it is written.
 */
function redact(line) {
  return line
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})/g, '<redacted>')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/g, '$1<redacted>')
    .replace(/([?&](?:token|code|key|secret|password)=)[^&\s"']+/gi, '$1<redacted>')
    .replace(/((?:api[_-]?key|token|secret|password|cookie)["']?\s*[:=]\s*)["']?[^\s"',]{8,}/gi, '$1<redacted>')
}

function tailLog(text) {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  return lines.slice(-LOG_TAIL_LINES).map(redact)
}

function appendLog(state, chunk, buffer) {
  buffer.text += chunk
  if (buffer.text.length > LOG_BUFFER_LIMIT * 2) buffer.text = buffer.text.slice(-LOG_BUFFER_LIMIT)
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

/**
 * Processes that survived their parent are reparented to launchd, but they keep
 * the process group this run created. Only that group is inspected and only
 * those PIDs may be signalled: no name-based matching, nothing wider.
 *
 * Returns null when `ps` cannot run at all (a sandboxed caller), so an empty
 * list is never mistaken for "nothing survived".
 */
function groupMembers(pgid) {
  const output = spawnSyncSafe('ps', ['-ax', '-o', 'pid=,pgid=,command='])
  if (output === undefined) return null
  const members = []
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
    if (match === null) continue
    const pid = Number(match[1])
    const group = Number(match[2])
    if (group !== pgid || pid === pgid) continue
    if (pid === process.pid) continue
    members.push({ pid, command: match[3].slice(0, 160) })
  }
  return members
}

function spawnSyncSafe(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return undefined
  }
}

function signal(pids, sig) {
  for (const pid of pids) {
    try {
      process.kill(pid, sig)
    } catch {
      /* already gone */
    }
  }
}

function terminateGroup(child) {
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch { /* gone */ }
  }
}

async function runState(options, state, prefix, index, outDir, binarySha) {
  // `none` is the state this client opens on, which under an isolated local
  // launch is the hero rather than a restored conversation; the capture is named
  // for what it shows so a reviewer is never told it is a transcript.
  const label = state === 'none' ? 'hero' : state
  // A compatibility page lives in its own web view, so the window capture shows
  // its frame and not its pixels; the page's own snapshot is the comparable
  // image. Both are written, under names that say which is which.
  const suffix = options.compatCapture ? '-window' : ''
  const file = join(outDir, `${prefix}-${label}${suffix}.png`)
  const pageFile = join(outDir, `${prefix}-${label}-page.png`)
  const diagnostics = join(outDir, 'logs', `${prefix}-${label}${suffix}.window.json`)
  const logPath = join(outDir, 'logs', `${prefix}-${label}${suffix}.log`)
  const args = [
    '--local-native',
    '--theme', options.theme,
    '--ui-state', state,
    '--capture', file,
    ...(options.compatCapture ? ['--capture-compat', pageFile] : []),
    '--capture-after', options.captureAfter,
    '--exit-after', options.exitAfter,
    '--window-diagnostics', diagnostics,
  ]
  const record = {
    state: label,
    uiState: state,
    file: `${prefix}-${label}${suffix}.png`,
    width: null,
    height: null,
    windowBounds: null,
    sha256: null,
    binarySha,
    theme: options.theme,
    // The file number is the record's position, so a merge keeps the reviewer's
    // numbering instead of re-sequencing whatever this run captured.
    index: Number(prefix),
  }
  const buffer = { text: '' }
  const child = spawn(resolve(options.binary), args, {
    env: { ...process.env, DSH_HOME: resolve(options.home) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => appendLog(state, chunk, buffer))
  child.stderr.on('data', (chunk) => appendLog(state, chunk, buffer))

  const startedAt = Date.now()
  const closed = new Promise((done) => child.on('close', (code, sig) => done({ code, sig })))
  let timedOut = false
  const deadline = new Promise((done) => setTimeout(() => done('timeout'), options.graceMs))
  let exit = await Promise.race([closed, deadline])
  if (exit === 'timeout') {
    timedOut = true
    terminateGroup(child)
    exit = await Promise.race([closed, sleep(8_000).then(() => 'still-running')])
    if (exit === 'still-running') {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch { /* gone */ }
      exit = await Promise.race([closed, sleep(5_000).then(() => ({ code: null, sig: 'SIGKILL' }))])
    }
    if (exit === 'still-running') exit = { code: null, sig: 'SIGKILL' }
  }
  record.exited = exit !== 'still-running'
  record.exitCode = typeof exit === 'object' ? exit.code : null
  record.signal = typeof exit === 'object' ? exit.sig : null
  record.durationMs = Date.now() - startedAt
  if (timedOut) record.timedOut = true

  // No Host child may outlive its client. Sweep our own process group only.
  let leftovers = groupMembers(child.pid)
  if (leftovers === null) {
    record.processSweep = 'unavailable: ps could not run here, so the process group was not inspected'
    leftovers = []
  } else if (leftovers.length > 0) {
    signal(leftovers.map((member) => member.pid), 'SIGTERM')
    await sleep(2_000)
    const remaining = groupMembers(child.pid) ?? leftovers
    if (remaining.length > 0) {
      signal(remaining.map((member) => member.pid), 'SIGKILL')
      await sleep(500)
    }
    record.reaped = (remaining.length > 0 ? remaining : leftovers).map((member) => member.pid)
    leftovers = groupMembers(child.pid) ?? []
  }
  record.residualHostPids = leftovers.map((member) => member.pid)
  if (leftovers.length > 0) {
    record.blocked = `Host child processes survived the run: ${leftovers.map((member) => member.pid).join(',')}`
  }

  if (existsSync(file) && statSync(file).size > 0) {
    try {
      const size = pngSize(file)
      record.width = size.width
      record.height = size.height
      record.sha256 = sha256(file)
      record.bytes = statSync(file).size
    } catch (error) {
      record.blocked = `${record.blocked ?? ''} capture is not a readable PNG: ${error.message}`.trim()
    }
  } else {
    record.blocked = `${record.blocked ?? ''} no capture file was written`.trim()
  }

  if (options.compatCapture) {
    if (existsSync(pageFile) && statSync(pageFile).size > 0) {
      try {
        const size = pngSize(pageFile)
        record.pageCapture = `${prefix}-${label}-page.png`
        record.pageWidth = size.width
        record.pageHeight = size.height
        record.pageSha256 = sha256(pageFile)
        record.pageBytes = statSync(pageFile).size
      } catch (error) {
        record.blocked = `${record.blocked ?? ''} page capture is not a readable PNG: ${error.message}`.trim()
      }
    } else {
      record.blocked = `${record.blocked ?? ''} no compatibility page capture was written (page view did not open)`.trim()
    }
  }

  if (existsSync(diagnostics)) {
    try {
      const parsed = JSON.parse(readFileSync(diagnostics, 'utf8'))
      record.windowBounds = parsed.bounds ?? null
      record.window = {
        visible: parsed.visible,
        focused: parsed.focused,
        minimized: parsed.minimized,
        contentBounds: parsed.contentBounds ?? null,
      }
    } catch (error) {
      record.blocked = `${record.blocked ?? ''} window diagnostics unreadable: ${error.message}`.trim()
    }
  } else {
    record.blocked = `${record.blocked ?? ''} window diagnostics missing`.trim()
  }

  const tail = tailLog(buffer.text)
  mkdirSync(join(outDir, 'logs'), { recursive: true })
  writeFileSync(logPath, `${tail.join('\n')}\n`, { mode: 0o600 })
  record.log = `logs/${prefix}-${label}${suffix}.log`
  record.logTail = tail
  if (record.blocked === '') delete record.blocked
  return record
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const outDir = resolve(options.out)
  mkdirSync(join(outDir, 'logs'), { recursive: true })
  const binarySha = sha256(resolve(options.binary))
  const records = []
  for (const [index, entry] of options.states.entries()) {
    const { prefix, state } = entry
    process.stdout.write(`parity: [${index + 1}/${options.states.length}] ${state} … `)
    const record = await runState(options, state, prefix, index, outDir, binarySha)
    records.push(record)
    const verdict = record.blocked === undefined ? 'ok' : 'blocked'
    process.stdout.write(`${verdict} ${record.width ?? '?'}x${record.height ?? '?'}${record.pageCapture === undefined ? '' : ` page ${record.pageWidth}x${record.pageHeight}`}${record.blocked === undefined ? '' : ` (${record.blocked})`}\n`)
  }
  const evidence = {
    capturedAt: new Date().toISOString(),
    client: 'native',
    binary: resolve(options.binary),
    binarySha,
    ...(options.headBinarySha === undefined ? {} : { headBinarySha: options.headBinarySha }),
    ...(options.binaryNote === undefined ? {} : { binaryNote: options.binaryNote }),
    theme: options.theme,
    home: resolve(options.home),
    capture: { after: options.captureAfter, exitAfter: options.exitAfter, transport: 'window.CapturePage' },
    privacy:
      'Captures contain private session content from the copied home. Kept local; only the last 30 log lines per state are retained, with secrets masked.',
    states: records,
  }
  // A follow-up run replaces the records it re-captured and keeps the rest, so
  // one state can be redone after a dependency is built without renumbering or
  // dropping the states that already passed.
  if (options.merge !== undefined) {
    const target = resolve(options.merge)
    const existing = JSON.parse(readFileSync(target, 'utf8'))
    const replaced = new Map(records.map((record) => [record.state, record]))
    const kept = (existing.states ?? []).map((record) => ({ ...record, ...(replaced.get(record.state) ?? {}) }))
    const added = records.filter((record) => !(existing.states ?? []).some((old) => old.state === record.state))
    evidence.states = [...kept, ...added].sort((left, right) => left.index - right.index)
    evidence.updatedAt = new Date().toISOString()
    if (existing.capturedAt !== undefined) evidence.capturedAt = existing.capturedAt
    for (const key of ['capturedAt', 'headBinarySha', 'binaryNote', 'annotated', 'verification']) {
      if (existing[key] !== undefined && evidence[key] === undefined) evidence[key] = existing[key]
    }
    evidence.mergedInto = target
    writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`)
    process.stdout.write(`parity: merged ${records.length} state(s) into ${target}\n`)
  } else {
    writeFileSync(join(outDir, 'capture.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  }
  const ok = records.filter((record) => record.blocked === undefined).length
  process.stdout.write(`parity: ${ok}/${records.length} states captured → ${join(outDir, 'capture.json')}\n`)
  if (ok !== records.length) process.exitCode = 1
}

await main()
