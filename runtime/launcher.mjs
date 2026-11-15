#!/usr/bin/env node
/**
 * Local dsh runtime launcher.
 *
 * Mirrors what `apps/desktop/src/host-process.ts` and
 * `apps/desktop/src/project-manager.ts` do in the Electron shell, without
 * Electron and without touching the backend:
 *
 *   1. prepare `~/.dsh/profiles/desktop` the way `applyRelease()` does, by
 *      calling the runtime's own `@deepseek-ai/dsh-app-boot` exports;
 *   2. fork `@deepseek-ai/dsh-desktop-host` exactly as the official shell does,
 *      over a Node IPC channel, with the same argv/env;
 *   3. forward the private credential handshake and the shutdown handshake;
 *   4. speak a JSON-lines protocol with the native parent on stdout/stdin.
 *
 * The Host's own stdout/stderr are redirected to stderr so they cannot corrupt
 * the protocol channel.
 *
 * Parent protocol (our side is stdout):
 *   {"type":"status","phase":"preparing"|"starting"|"ready"|"stopping"|"stopped"|"failed", ...}
 *   {"type":"ready","url":"http://127.0.0.1:PORT/","injections":[...],"pid":N,"seed":{...}}
 *   {"type":"host-event","event":{...}}   // plugin-operation, platform-session, control replies
 *   {"type":"exit","code":N}
 * Parent protocol (our stdin): {"type":"shutdown"}
 */

import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const HOST_ENTRY = ['node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js']
const SHUTDOWN_GRACE_MS = 10_000

function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function log(level, message) {
  process.stderr.write(`launcher: ${level}: ${message}\n`)
}

function parseArgs(argv) {
  const options = { home: process.env.DSH_HOME, runtime: undefined, node: process.execPath, primaryRuntime: undefined, pnpm: undefined, nodeBin: undefined, clientVersion: undefined }
  const mapping = {
    '--home': 'home', '--runtime': 'runtime', '--node': 'node',
    '--primary-runtime': 'primaryRuntime', '--pnpm': 'pnpm', '--bin': 'nodeBin',
    '--client-version': 'clientVersion',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const key = mapping[argv[index]]
    if (key === undefined) throw new Error(`launcher: unknown argument ${argv[index]}`)
    const value = argv[++index]
    if (value === undefined || value === '') throw new Error(`launcher: ${argv[index - 1]} needs a value`)
    options[key] = value
  }
  if (options.runtime === undefined) throw new Error('launcher: --runtime is required')
  return options
}

/** Resolve a runtime package entry point from the vendored tree. */
function runtimeRequire(runtime, packageName) {
  const requireFromRuntime = createRequire(join(runtime, 'package.json'))
  return pathToFileURL(requireFromRuntime.resolve(packageName)).href
}

/** Same lock the Electron shell takes around profile preparation. */
function withProfileLock(profile, operation) {
  mkdirSync(profile, { recursive: true, mode: 0o700 })
  const lockPath = join(profile, 'lock')
  const open = () => openSync(lockPath, 'wx', 0o600)
  let descriptor
  try {
    descriptor = open()
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const owner = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
    let active = !Number.isSafeInteger(owner) || owner <= 0
    if (!active) {
      try {
        process.kill(owner, 0)
        active = true
      } catch (signalError) {
        active = signalError.code !== 'ESRCH'
      }
    }
    if (active) throw new Error('launcher: another profile operation is active')
    unlinkSync(lockPath)
    descriptor = open()
  }
  try {
    writeSync(descriptor, `${String(process.pid)}\n`)
    fsyncSync(descriptor)
    return operation()
  } finally {
    closeSync(descriptor)
    unlinkSync(lockPath)
  }
}

/** Equivalent of DesktopProjectManager.applyRelease() without Electron. */
async function prepareProfile(options) {
  const runtime = options.runtime
  const descriptorPath = join(runtime, 'desktop-runtime.json')
  if (!existsSync(descriptorPath)) throw new Error(`launcher: no runtime descriptor at ${descriptorPath}`)
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'))
  if (descriptor.schemaVersion !== 1) throw new Error(`launcher: unsupported descriptor ${descriptor.schemaVersion}`)

  const { initProfile, removeLinkProjections } = await import(runtimeRequire(runtime, '@deepseek-ai/dsh-app-boot'))
  const { PROFILE_TEMPLATES } = await import(runtimeRequire(runtime, '@deepseek-ai/dsh-official-bundles'))
  const profile = join(options.home, 'profiles', 'desktop')
  const bundles = PROFILE_TEMPLATES.web.bundles

  withProfileLock(profile, () => {
    // Upstream also rewrites one legacy pnpm-workspace shape here. It only
    // affects profiles written by much older releases; surface it instead of
    // duplicating a volatile literal from apps/desktop/src/project-manager.ts.
    const workspace = join(profile, 'pnpm-workspace.yaml')
    if (existsSync(workspace) && readFileSync(workspace, 'utf8').includes('strictDepBuilds: true')) {
      log('warn', 'profile pnpm-workspace.yaml uses the legacy strictDepBuilds shape; upstream would migrate it')
    }
    initProfile(profile, bundles)
    removeLinkProjections(profile)
  })
  return { profile, descriptor }
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    log('error', error.message)
    process.exit(64)
  }
  const runtime = options.runtime
  const primaryRuntime = options.primaryRuntime ?? join(runtime, '..', 'primary-runtime')
  const pnpm = options.pnpm ?? join(primaryRuntime, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')
  const nodeBin = options.nodeBin ?? join(primaryRuntime, 'bin')

  emit({ type: 'status', phase: 'preparing' })
  let prepared
  try {
    prepared = await prepareProfile(options)
  } catch (error) {
    log('error', String(error?.message ?? error))
    emit({ type: 'status', phase: 'failed', stage: 'preparing', message: String(error?.message ?? error) })
    process.exit(1)
  }

  const entry = join(runtime, ...HOST_ENTRY)
  if (!existsSync(entry)) {
    emit({ type: 'status', phase: 'failed', stage: 'preparing', message: `missing host entry ${entry}` })
    process.exit(1)
  }

  const secret = randomBytes(32).toString('base64url')
  const environment = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_DESKTOP_NODE_EXECUTABLE: options.node,
    // The Electron shell defines this at build time and passes it to the Host;
    // the web-app bundle uses it as the telemetry `serviceVersion`.
    DSH_CLIENT_VERSION: options.clientVersion ?? prepared.descriptor.release.version,
    PATH: `${nodeBin}${delimiter}${process.env.PATH ?? ''}`,
  }

  emit({ type: 'status', phase: 'starting', pid: process.pid, runtime, profile: prepared.profile })
  const child = fork(entry, [
    runtime,
    prepared.profile,
    primaryRuntime,
    pnpm,
    nodeBin,
  ], {
    cwd: prepared.profile,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    execPath: options.node,
  })

  child.stdout?.on('data', (chunk) => process.stderr.write(chunk))
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk))

  let authDelivered = false
  let ready = false
  let stopping = false

  child.on('message', (message) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) {
      emit({ type: 'host-event', event: message })
      return
    }
    if (message.type === 'starting') {
      if (authDelivered) return
      child.send({ type: 'desktop-auth', secret }, (error) => {
        if (error !== null) {
          log('error', 'credential handoff failed')
          emit({ type: 'status', phase: 'failed', stage: 'authentication', message: 'credential handoff failed' })
          child.kill('SIGTERM')
          return
        }
        authDelivered = true
      })
      return
    }
    if (message.type === 'ready') {
      if (!authDelivered) {
        emit({ type: 'status', phase: 'failed', stage: 'authentication', message: 'ready before authentication' })
        child.kill('SIGTERM')
        return
      }
      ready = true
      emit({
        type: 'ready',
        url: message.url,
        injections: message.injections,
        pid: child.pid,
        seed: { name: 'dsh-desktop-session', value: secret, domain: new URL(message.url).hostname, path: '/' },
      })
      return
    }
    if (message.type === 'shutdown-complete') {
      emit({ type: 'status', phase: 'stopped', reason: 'shutdown-complete' })
      return
    }
    if (message.type === 'fatal') {
      emit({ type: 'status', phase: 'failed', stage: 'host', message: message.message, diagnostic: message.diagnostic })
      return
    }
    emit({ type: 'host-event', event: message })
  })

  child.once('error', (error) => {
    log('error', `host process error: ${error.message}`)
    emit({ type: 'status', phase: 'failed', stage: 'spawn', message: error.message })
  })

  child.once('close', (code, signal) => {
    emit({ type: 'exit', code: code ?? -1, signal: signal ?? null, ready })
    process.exit(code === null ? 1 : code)
  })

  const stop = () => {
    if (stopping) return
    stopping = true
    emit({ type: 'status', phase: 'stopping' })
    try { child.send({ type: 'shutdown' }) } catch { /* channel already gone */ }
    const term = setTimeout(() => { try { child.kill('SIGTERM') } catch {} }, SHUTDOWN_GRACE_MS)
    const kill = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, SHUTDOWN_GRACE_MS + 5_000)
    child.once('close', () => { clearTimeout(term); clearTimeout(kill) })
  }

  let buffered = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffered += chunk
    for (;;) {
      const newline = buffered.indexOf('\n')
      if (newline < 0) break
      const line = buffered.slice(0, newline).trim()
      buffered = buffered.slice(newline + 1)
      if (line === '') continue
      let request
      try { request = JSON.parse(line) } catch { log('warn', 'ignoring malformed parent message'); continue }
      if (request.type === 'shutdown') stop()
    }
  })
  process.stdin.on('end', stop)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => { stop() })
  }
}

await main()
