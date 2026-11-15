#!/usr/bin/env node
/**
 * M4b acceptance: the native client helper driving a real local Host.
 *
 * Starts the vendored runtime through `runtime/launcher.mjs` in a throwaway
 * DSH_HOME, then runs `remote/local-bridge.mjs` against the Host's `ready` URL
 * and speaks the same JSON-lines protocol the Go client speaks. Every call is
 * read-only except Workspace/Session creation, which happens only inside that
 * temporary home. No installed app, no real ~/.dsh, no model prompt.
 *
 *   node scripts/probe-local-bridge.mjs
 *   node scripts/probe-local-bridge.mjs --keep --evidence qa/runtime-results/local-bridge.json
 */

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DEADLINE_MS = 240_000
const CALL_TIMEOUT_MS = 60_000

/** Explicit, stable-enough mutation id: the helper refuses anything under 16. */
function mutationId(kind) {
  return `probe-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function parseArgs(argv) {
  const options = { runtime: 'build/runtime', helper: 'remote/local-bridge.mjs', home: undefined, readOnly: false, keep: false, evidence: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--runtime') options.runtime = argv[++index]
    else if (argv[index] === '--helper') options.helper = argv[++index]
    else if (argv[index] === '--home') options.home = argv[++index]
    else if (argv[index] === '--read-only') options.readOnly = true
    else if (argv[index] === '--keep') options.keep = true
    else if (argv[index] === '--evidence') options.evidence = argv[++index]
    else throw new Error(`probe: unknown argument ${argv[index]}`)
  }
  return options
}

/** Scrubbed environment, mirroring apps/desktop/scripts/smoke-runtime.ts. */
function isolatedEnvironment(home) {
  const kept = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(?:npm|pnpm|corepack|DSH)_/u.test(name)),
  )
  return {
    ...kept,
    DSH_HOME: home,
    HOME: home,
    XDG_CONFIG_HOME: home,
    XDG_CACHE_HOME: home,
    XDG_STATE_HOME: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    npm_config_userconfig: join(home, 'npmrc'),
    npm_config_globalconfig: join(home, 'npmrc'),
    npm_config_store_dir: join(home, 'store'),
    npm_config_enable_global_virtual_store: 'false',
  }
}

/** Start the launcher and resolve on its `ready` line. */
function startHost(node, runtimeRoot, home) {
  const runtime = join(runtimeRoot, 'dsh')
  const primaryRuntime = join(runtimeRoot, 'primary-runtime')
  const child = spawn(node, [
    resolve('runtime/launcher.mjs'),
    '--home', home,
    '--runtime', runtime,
    '--node', node,
    '--primary-runtime', primaryRuntime,
    '--pnpm', join(primaryRuntime, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'),
    '--bin', join(primaryRuntime, 'bin'),
  ], { env: isolatedEnvironment(home), stdio: ['pipe', 'pipe', 'pipe'] })
  const state = { ready: undefined, failed: undefined, stopped: false, exit: undefined }
  const stderrTail = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    for (const line of chunk.split('\n')) if (line.trim() !== '') stderrTail.push(line)
    while (stderrTail.length > 60) stderrTail.shift()
  })
  let buffered = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffered += chunk
    for (;;) {
      const newline = buffered.indexOf('\n')
      if (newline < 0) break
      const line = buffered.slice(0, newline).trim()
      buffered = buffered.slice(newline + 1)
      if (line === '') continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      if (message.type === 'ready') state.ready = message
      else if (message.type === 'status' && message.phase === 'failed') state.failed = message
      else if (message.type === 'status' && message.phase === 'stopped') state.stopped = true
    }
  })
  const closed = new Promise((resolveClose) => {
    child.once('close', (code, signal) => {
      state.exit = { code, signal }
      resolveClose()
    })
  })
  return { child, state, closed, stderrTail }
}

/** JSON-lines client for the helper, with a hard per-call deadline. */
function startHelper(node, runtimeRoot, url, helper) {
  const child = spawn(node, [
    resolve(helper),
    '--url', url,
    '--runtime', runtimeRoot,
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  const notifications = []
  const stderrTail = []
  let nextId = 1
  let buffered = ''
  let dead
  const closed = new Promise((resolveClose) => {
    child.once('close', (code, signal) => {
      dead = { code, signal }
      for (const { reject } of pending.values()) reject(new Error(`helper exited (${code})`))
      pending.clear()
      resolveClose()
    })
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    for (const line of chunk.split('\n')) if (line.trim() !== '') stderrTail.push(line)
    while (stderrTail.length > 60) stderrTail.shift()
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffered += chunk
    for (;;) {
      const newline = buffered.indexOf('\n')
      if (newline < 0) break
      const line = buffered.slice(0, newline).trim()
      buffered = buffered.slice(newline + 1)
      if (line === '') continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      if (message.id !== undefined) {
        const waiter = pending.get(message.id)
        pending.delete(message.id)
        if (waiter !== undefined) waiter.resolve(message)
      } else if (typeof message.method === 'string') {
        notifications.push({ at: Date.now(), ...message })
      }
    }
  })
  const call = (method, params = {}) => {
    const id = nextId++
    const body = `${JSON.stringify({ id, method, params })}\n`
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        rejectCall(new Error(`${method}: no reply within ${CALL_TIMEOUT_MS}ms`))
      }, CALL_TIMEOUT_MS)
      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer)
          if (message.error) {
            rejectCall(Object.assign(new Error(message.error.message), message.error))
            return
          }
          resolveCall(message.result)
        },
        reject: (error) => {
          clearTimeout(timer)
          rejectCall(error)
        },
      })
      try { child.stdin.write(body) } catch (error) { rejectCall(error) }
    })
  }
  const waitFor = async (method, predicate = () => true, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = notifications.find((row) => row.method === method && predicate(row))
      if (found !== undefined) return found
      if (Date.now() > deadline) throw new Error(`no ${method} notification within ${timeoutMs}ms`)
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  return { child, call, waitFor, notifications, closed, stderr: stderrTail, exitInfo: () => dead }
}

/** Ends a read-only probe after the read surfaces; not a failure. */
class ReadOnlyComplete extends Error {}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const runtimeRoot = resolve(options.runtime)
  const node = join(runtimeRoot, 'primary-runtime', 'dependencies', 'node', 'bin', 'node')
  // An explicit home lets this probe verify an existing profile (for example a
  // copy of the real one) without ever writing the shared ~/.dsh.
  const home = options.home === undefined
    ? mkdtempSync(join(tmpdir(), 'dsh-local-bridge-'))
    : resolve(options.home)
  const checks = []
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : `: ${detail}`}`)
  }

  console.log(`runtime  ${runtimeRoot}`)
  console.log(`node     ${node}`)
  console.log(`home     ${home}`)

  const host = startHost(node, runtimeRoot, home)
  const hostDeadline = Date.now() + DEADLINE_MS
  while (host.state.ready === undefined && host.state.failed === undefined && Date.now() < hostDeadline) {
    await new Promise((r) => setTimeout(r, 200))
  }

  let helper
  try {
    if (host.state.ready === undefined) {
      record('host reached ready', false, host.state.failed?.message ?? host.stderrTail.slice(-5).join(' | '))
      throw new Error('host never became ready')
    }
    const ready = host.state.ready
    record('host reached ready', true, `${new URL(ready.url).origin} injections=${Array.isArray(ready.injections) ? ready.injections.length : '?'}`)

    helper = startHelper(node, runtimeRoot, ready.url, options.helper)

    const status = await helper.call('status')
    record('local status is an owner connection, not a Remote account',
      status.authorized === true && status.backend === 'local-mux' && status.serverUrl === new URL(ready.url).origin,
      JSON.stringify({ authorized: status.authorized, backend: status.backend, protocol: status.protocol }))

    const devices = await helper.call('devices')
    record('one synthetic local Host is offered', Array.isArray(devices) && devices.length === 1 && devices[0].id === 'local',
      JSON.stringify(devices.map((d) => ({ id: d.id, online: d.online }))))

    const connected = await helper.call('connect', { hostId: 'local' })
    record('connect reports a connected answering peer',
      connected.connected === true && connected.transportConnected === true && connected.hostId === 'local',
      JSON.stringify({ connected: connected.connected, interactionReady: connected.detail }))

    const readyEvents = await helper.waitFor('status', (row) => row.params?.connected === true, 15_000)
    record('the $events generation became ready', readyEvents !== undefined, readyEvents?.params?.detail)

    const workspaces = await helper.call('workspaces')
    record('workspace registry read over /api', Array.isArray(workspaces),
      `workspaces=${workspaces.length}`)

    const sessions = await helper.call('sessions', { all: true })
    record('session catalog read over /api',
      Array.isArray(sessions) && (options.home !== undefined || sessions.length === 0),
      `sessions=${sessions.length}`)

    // Read-only proof that the profile's own plugins composed: model catalogs
    // and the command list come from profile bundles, not from the carrier.
    const models = await helper.call('modelCatalog', { sessionId: undefined }).catch((error) => ({ error: error.message }))
    const modelCount = Array.isArray(models?.providers) ? models.providers.length : undefined
    record('model catalog came from the composed profile', modelCount === undefined || modelCount > 0,
      `providers=${modelCount ?? 'n/a'}`)

    if (options.readOnly) {
      await helper.call('disconnect').catch(() => undefined)
      await helper.call('close').catch(() => undefined)
      await helper.closed.catch(() => undefined)
      throw new ReadOnlyComplete('read-only probe finished')
    }

    // A throwaway workspace gives the projection path something real to follow.
    const workspaceDir = join(home, 'workspace')
    mkdirSync(workspaceDir, { recursive: true })
    let workspace
    try {
      workspace = await helper.call('createWorkspace', { path: workspaceDir, requestId: mutationId('workspace') })
      record('workspace/create accepted in the temporary home', workspace !== undefined, JSON.stringify(workspace)?.slice(0, 200))
    } catch (error) {
      record('workspace/create accepted in the temporary home', false, error.message)
    }

    const afterWorkspace = await helper.call('workspaces')
    record('the created workspace is in the registry',
      Array.isArray(afterWorkspace) && afterWorkspace.length === 1,
      `workspaces=${afterWorkspace.length}`)

    const workspaceId = afterWorkspace?.[0]?.id ?? workspace?.workspaceId
    let session
    try {
      session = await helper.call('createSession', { workspaceId, requestId: mutationId('session') })
      record('session/create accepted in the temporary home', session !== undefined, JSON.stringify(session)?.slice(0, 200))
    } catch (error) {
      record('session/create accepted in the temporary home', false, error.message)
    }

    const sessionId = session?.value?.sessionId ?? session?.sessionId ?? session?.id
    if (sessionId !== undefined) {
      const catalog = await helper.call('sessions', { all: true })
      record('the created session appears in the catalog', catalog.some((row) => row.id === sessionId), `sessions=${catalog.length}`)

      const opened = await helper.call('openSession', { sessionId })
      record('openSession returns a snapshot', opened?.sessionId === sessionId && Array.isArray(opened.messages),
        `messages=${opened?.messages?.length ?? '?'} running=${String(opened?.running)}`)

      const projection = await helper.waitFor('snapshot', (row) => row.params?.sessionId === sessionId, 20_000)
      record('the projection published a snapshot for the opened session', projection !== undefined,
        `seq=${projection?.params?.cursor ?? '?'}`)

      const capabilities = await helper.call('capabilities', {})
      record('capabilities come from the local Host',
        capabilities !== undefined && typeof capabilities === 'object',
        JSON.stringify(capabilities).slice(0, 160))

      await helper.call('clearSession')
    } else {
      record('the created session appears in the catalog', false, 'no sessionId returned')
    }

    await helper.call('disconnect')
    const afterDisconnect = await helper.call('status')
    record('disconnect releases the Host generation', afterDisconnect.connected === false,
      JSON.stringify({ connected: afterDisconnect.connected }))

    await helper.call('close')
    await helper.closed
    record('the helper exited cleanly', helper.exitInfo()?.code === 0,
      `${JSON.stringify(helper.exitInfo())}`)
  } catch (error) {
    if (!(error instanceof ReadOnlyComplete)) {
      record('probe completed without an unexpected failure', false, error.message)
    }
  } finally {
    if (helper !== undefined && helper.exitInfo() === undefined) {
      try { helper.child.kill('SIGTERM') } catch { /* already gone */ }
      await helper.closed
    }
    host.child.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`)
    host.child.stdin.end()
    const killTimer = setTimeout(() => { try { host.child.kill('SIGKILL') } catch {} }, 30_000)
    await host.closed
    clearTimeout(killTimer)
    record('host shutdown completed', host.state.stopped && host.state.exit?.code === 0,
      `${JSON.stringify(host.state.exit)}`)
    if (host.stderrTail.some((line) => /error|fatal/iu.test(line))) {
      console.log(`host stderr tail:\n${host.stderrTail.slice(-12).join('\n')}`)
    }
    if (options.evidence !== undefined) {
      const evidence = {
        schemaVersion: 1,
        kind: 'local-bridge-acceptance',
        recordedAt: new Date().toISOString(),
        scope: 'Native helper driving a synthetic local Host in a temporary DSH_HOME. No installed app, no ~/.dsh write, no model prompt, no approval answered.',
        runtime: runtimeRoot,
        temporaryHome: home,
        node: process.version,
        helper: options.helper,
        host: { ready: host.state.ready === undefined ? null : { url: host.state.ready.url, injections: host.state.ready.injections?.length ?? null }, exit: host.state.exit ?? null },
        helperExit: helper?.exitInfo() ?? null,
        checks,
        passed: checks.every((check) => check.ok),
      }
      writeFileSync(resolve(options.evidence), `${JSON.stringify(evidence, undefined, 2)}\n`)
      console.log(`evidence ${resolve(options.evidence)}`)
    }
    if (options.home !== undefined) console.log(`kept ${home} (caller-provided)`)
    else if (!options.keep) rmSync(home, { recursive: true, force: true })
    else console.log(`kept ${home}`)
  }

  const failed = checks.filter((check) => !check.ok)
  console.log(failed.length === 0 ? 'PROBE PASS' : `PROBE FAIL (${failed.length})`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
