#!/usr/bin/env node
/**
 * Drive the native window for GUI acceptance and capture each state.
 *
 * macOS-only. It launches the client itself (bounded), sends keystrokes through
 * System Events, and captures the window region reported by
 * `--window-diagnostics`, so every step leaves a reviewable image plus the
 * keystrokes that produced it. It asserts nothing about pixels: the reviewer
 * reads the captures and records verdicts in the evidence file.
 *
 *   node scripts/accept-local-gui.mjs --binary build/_tmp/native-dsh \
 *     --home /tmp/native-dsh-live-… --out build/_tmp/gui-accept \
 *     --evidence qa/runtime-results/local-gui-accept.json
 */

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

function parseArgs(argv) {
  const options = {
    binary: 'build/_tmp/native-dsh',
    home: undefined,
    out: 'build/_tmp/gui-accept',
    evidence: undefined,
    processName: 'native-dsh',
    steps: 'basic',
    timeoutMs: 60_000,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === '--binary') options.binary = value
    else if (key === '--home') options.home = value
    else if (key === '--out') options.out = value
    else if (key === '--evidence') options.evidence = value
    else if (key === '--process') options.processName = value
    else if (key === '--steps') options.steps = value
    else throw new Error(`accept: unknown argument ${key}`)
    index += 1
  }
  if (options.home === undefined) throw new Error('accept: --home is required')
  return options
}

/**
 * Each step is one reviewer-visible state: a label, an optional keystroke, and
 * how long to settle before the capture. Keep steps cheap and reversible.
 */
const STEP_SETS = {
  basic: [
    { name: 'connected', keys: [], settleMs: 1500 },

  ],
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function osa(script) {
  return run('osascript', ['-e', script])
}

const NAMED_KEYS = { escape: 'escape', return: 'return', comma: ',', period: '.', slash: '/' }

function keyStroke(spec) {
  const parts = spec.split('+')
  const raw = parts.pop()
  const key = NAMED_KEYS[raw] ?? raw
  const modifiers = parts.map((part) => ({ cmd: 'command down', shift: 'shift down', alt: 'option down', ctrl: 'control down' })[part])
  const using = modifiers.length > 0 ? ` using {${modifiers.join(', ')}}` : ''
  if (key === 'escape') return 'key code 53'
  if (key === 'return') return 'key code 36'
  return `keystroke "${key}"${using}`
}

function capture(region, path) {
  run('screencapture', ['-x', '-o', '-R', `${region.X},${region.Y},${region.Width},${region.Height}`, path])
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const out = resolve(options.out)
  mkdirSync(out, { recursive: true })
  const diagnostics = join(out, 'window.json')
  rmSync(diagnostics, { force: true })

  const steps = STEP_SETS[options.steps]
  const child = spawn(resolve(options.binary), [
    '--local-native',
    '--window-diagnostics', diagnostics,
    '--exit-after', '180s',
  ], {
    env: { ...process.env, DSH_HOME: resolve(options.home) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { log += chunk })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { log += chunk })

  const deadline = Date.now() + options.timeoutMs
  let bounds
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(readFileSync(diagnostics, 'utf8'))
      if (parsed.bounds?.Width > 0) { bounds = parsed.bounds; break }
    } catch { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  if (bounds === undefined) {
    child.kill('SIGTERM')
    throw new Error('accept: the window never published its bounds')
  }

  // Give the Host + helper time to connect before the first capture.
  await new Promise((r) => setTimeout(r, 2200))
  osa(`tell application "System Events" to tell process "${options.processName}" to set frontmost to true`)

  const results = []
  for (const step of steps) {
    let blocked
    try {
      if (step.keys !== undefined) {
        for (const key of step.keys) osa(`tell application "System Events" to ${keyStroke(key)}`)
      }
      if (step.click !== undefined) {
        osa(`tell application "System Events" to click at {${Math.round(bounds.X + step.click.x)}, ${Math.round(bounds.Y + step.click.y)}}`)
      }
    } catch (error) {
      // macOS refuses to synthesize input without an Accessibility grant for
      // this process; record the wall instead of failing the whole run.
      blocked = String(error.message).split('\n').pop()
    }
    await new Promise((r) => setTimeout(r, step.settleMs))
    const file = join(out, `${String(results.length + 1).padStart(2, '0')}-${step.name}.png`)
    capture(bounds, file)
    results.push({ name: step.name, keys: step.keys ?? [], click: step.click, capture: file, ...(blocked === undefined ? {} : { blocked }) })
    console.log(`captured ${step.name} -> ${file}${blocked === undefined ? '' : ` (input blocked: ${blocked})`}`)
  }

  child.kill('SIGTERM')
  await new Promise((r) => child.once('close', r))
  const evidence = {
    schemaVersion: 1,
    kind: 'local-gui-acceptance',
    recordedAt: new Date().toISOString(),
    binary: resolve(options.binary),
    home: resolve(options.home),
    window: bounds,
    steps: results,
    note: 'Captures only. Verdicts are recorded by the reviewer, not inferred from pixels.',
    logTail: log.split('\n').filter((line) => line.trim() !== '').slice(-10),
  }
  if (options.evidence !== undefined) {
    writeFileSync(resolve(options.evidence), `${JSON.stringify(evidence, undefined, 2)}\n`)
    console.log(`evidence ${resolve(options.evidence)}`)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})