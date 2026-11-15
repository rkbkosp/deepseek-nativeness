#!/usr/bin/env node
/**
 * Batch 1 acceptance: every endpoint the client wired in this round, driven
 * against a real local Host.
 *
 * Starts the vendored runtime through `runtime/launcher.mjs` in a throwaway
 * DSH_HOME, then drives `remote/local-bridge.mjs` with the same JSON-lines
 * protocol the Go client speaks. Nothing outside that temporary home is read or
 * written, no installed app is started, and no model prompt is sent.
 *
 * The rule this probe follows for a write endpoint is deliberately narrow: it
 * proves the call reaches the Host's own handler and is answered as a business
 * outcome or a business refusal — never as "unsupported endpoint". So it never
 * installs a plugin, never removes or deletes a schedule, and never runs an
 * Office conversion: each write is submitted in a shape the Host refuses before
 * mutating anything (`invalid-spec`, `schedule/input-invalid`, a non-mutating
 * miss on a task id that does not exist).
 *
 *   node scripts/probe-local-endpoints.mjs
 *   node scripts/probe-local-endpoints.mjs --keep --evidence qa/runtime-results/local-endpoints.json
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DEADLINE_MS = 240_000
const CALL_TIMEOUT_MS = 60_000
const STREAM_TIMEOUT_MS = 8_000

/** Codes that mean "this carrier/endpoint does not exist", not a business answer. */
const UNSUPPORTED_CODES = /(?:UNSUPPORTED|METHOD_NOT_FOUND|NOT_IMPLEMENTED|unknown-endpoint|endpoint-unknown|gateway\/unknown)/u

function parseArgs(argv) {
  const options = { runtime: 'build/runtime', helper: 'remote/local-bridge.mjs', keep: false, evidence: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--runtime') options.runtime = argv[++index]
    else if (argv[index] === '--helper') options.helper = argv[++index]
    else if (argv[index] === '--keep') options.keep = true
    else if (argv[index] === '--evidence') options.evidence = argv[++index]
    else throw new Error(`probe: unknown argument ${argv[index]}`)
  }
  return options
}

/** Explicit, stable-enough mutation id: the helper refuses anything under 16. */
function requestId(kind) {
  return `probe-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
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
  const child = spawn(node, [resolve(helper), '--url', url, '--runtime', runtimeRoot], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
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

/** An answer that is a business outcome/refusal, not a missing endpoint. */
function isBusinessAnswer(error) {
  const code = String(error?.code ?? '')
  if (UNSUPPORTED_CODES.test(code)) return false
  const message = String(error?.message ?? '')
  if (/UNSUPPORTED|未知客户端方法|unsupported endpoint|unknown endpoint/iu.test(message)) return false
  return code !== ''
}

/** The Host answered, but this profile does not mount the service. */
function isUnmounted(error) {
  return /HTTP 404/u.test(String(error?.message ?? ''))
}

function summarize(error) {
  const details = error?.details === undefined ? '' : ` ${JSON.stringify(error.details).slice(0, 160)}`
  return `${error?.code ?? 'ERROR'}: ${String(error?.message ?? error).slice(0, 180)}${details}`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const runtimeRoot = resolve(options.runtime)
  const node = join(runtimeRoot, 'primary-runtime', 'dependencies', 'node', 'bin', 'node')
  const home = mkdtempSync(join(tmpdir(), 'dsh-local-endpoints-'))
  const checks = []
  const record = (check) => {
    checks.push(check)
    console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.id}${check.detail === undefined ? '' : `: ${check.detail}`}`)
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
  const downloads = []
  try {
    if (host.state.ready === undefined) {
      record({
        id: 'host-ready',
        kind: 'setup',
        ok: false,
        detail: host.state.failed?.message ?? host.stderrTail.slice(-5).join(' | '),
      })
      throw new Error('host never became ready')
    }
    const ready = host.state.ready
    record({
      id: 'host-ready',
      kind: 'setup',
      ok: true,
      detail: `origin=${new URL(ready.url).origin} injections=${ready.injections?.length ?? '?'}`,
    })

    let routeCookie
    helper = startHelper(node, runtimeRoot, ready.url, options.helper)
    await helper.call('status')
    const connected = await helper.call('connect', { hostId: 'local' })
    await helper.waitFor('status', (row) => row.params?.connected === true, 15_000)
    // The helper may recover its carrier after `connect`, so the scope is always
    // sampled fresh (see `stream`); only the connected host id is kept here.
    const hostId = connected.hostId

    // A real workspace and session give the session-scoped reads something to
    // resolve; both live inside the throwaway home only.
    const workspaceDir = join(home, 'workspace')
    mkdirSync(workspaceDir, { recursive: true })
    writeFileSync(join(workspaceDir, 'probe-note.md'), '# probe\n\nsearchable needle\n')
    await helper.call('createWorkspace', {
      path: workspaceDir,
      requestId: requestId('workspace'),
    })
    // The registry read is what the client itself uses; the write receipt does
    // not carry the workspace id.
    const createdWorkspaces = await helper.call('workspaces')
    const workspaceRow = Array.isArray(createdWorkspaces)
      ? createdWorkspaces.find((row) => row.path === workspaceDir)
      : undefined
    const workspaceId = workspaceRow?.id
    const session = await helper.call('createSession', {
      workspaceId,
      requestId: requestId('session'),
    })
    const sessionId = session?.value?.sessionId ?? session?.sessionId ?? session?.id
    record({
      id: 'fixture-session',
      kind: 'setup',
      ok: workspaceId !== undefined && sessionId !== undefined,
      detail: `workspaceId=${workspaceId ?? 'missing'} sessionId=${sessionId ?? 'missing'}`,
    })

    /** One read endpoint: it must succeed and return a value. */
    const read = async (id, endpoint, method, params, accept = () => true) => {
      try {
        const value = await helper.call(method, params)
        const ok = accept(value)
        record({
          id,
          kind: 'read',
          endpoint,
          method,
          ok,
          detail: `OK ${JSON.stringify(value)?.slice(0, 160)}`,
        })
        return { value, ok }
      } catch (error) {
        record({ id, kind: 'read', endpoint, method, ok: false, detail: summarize(error) })
        return { value: undefined, ok: false }
      }
    }

    /**
     * One write endpoint: the Host must answer with its own business outcome or
     * refusal. Nothing is mutated by the shapes used here.
     */
    const write = async (id, endpoint, method, params) => {
      try {
        const value = await helper.call(method, params)
        record({
          id,
          kind: 'write',
          endpoint,
          method,
          ok: true,
          detail: `ACCEPTED ${JSON.stringify(value)?.slice(0, 180)}`,
        })
        return { value, ok: true }
      } catch (error) {
        const ok = isBusinessAnswer(error)
        record({
          id,
          kind: 'write',
          endpoint,
          method,
          ok,
          detail: ok ? `BUSINESS REFUSAL ${summarize(error)}` : `UNSUPPORTED ${summarize(error)}`,
        })
        return { error, ok }
      }
    }

    /** One stream endpoint: the host must open it and send at least one frame. */
    const stream = async (id, endpoint, method, extra = {}) => {
      let step = 'status'
      try {
        // The scope proves the window's host/generation, sampled now: the
        // helper may have recovered its carrier since `connect` returned. A
        // session is left out because these streams are not projection-bound.
        const current = await helper.call('status')
        // Registration carries the window identity only; every later call adds
        // the `ownerId` that this registration bound.
        const window = {
          hostId: current.hostId,
          generation: current.connectionGeneration,
        }
        step = 'registerOwner'
        await helper.call('registerOwner', { ownerId: id, clientScope: window })
        step = method
        const clientScope = { ...window, ownerId: id }
        const opened = await helper.call(method, { ...extra, clientScope })
        step = 'frame'
        const frame = await helper
          .waitFor('remoteStream', (row) => row.params?.method === method, STREAM_TIMEOUT_MS)
          .catch(() => undefined)
        const ended = helper.notifications.find(
          (row) => row.method === 'remoteStreamEnd' && row.params?.method === method,
        )
        const failure = ended?.params?.error?.code
        // A served stream is one the Host opened: a frame, a business error that
        // ends it, or — for a wait with nothing to report — an open stream with
        // no frame and no failure.
        const ok =
          frame !== undefined ||
          opened?.subscriptionId !== undefined ||
          (typeof failure === 'string' && !UNSUPPORTED_CODES.test(failure))
        record({
          id,
          kind: 'stream',
          endpoint,
          method,
          ok,
          detail:
            frame !== undefined
              ? `FRAME ${JSON.stringify(frame.params?.frame)?.slice(0, 160)}`
              : failure !== undefined
                ? `STREAM ENDED ${failure}`
                : `OPENED ${String(opened?.subscriptionId)} without a frame in ${STREAM_TIMEOUT_MS}ms`,
        })
        await helper.call('closeStream', { subscriptionId: opened?.subscriptionId }).catch(() => undefined)
        await helper.call('closeOwnerStreams', { ownerId: id }).catch(() => undefined)
      } catch (error) {
        const ok = isBusinessAnswer(error)
        record({
          id,
          kind: 'stream',
          endpoint,
          method,
          ok,
          detail: ok
            ? `BUSINESS REFUSAL at ${step}: ${summarize(error)}`
            : `UNSUPPORTED at ${step}: ${summarize(error)}`,
        })
      }
    }

    // --- A. endpoints the frozen allowlist already allowed -----------------
    await stream('follow-remote-access', 'remoteAccess/follow', 'followRemoteAccess')
    // Idempotent by construction: the Host fixes the default directory name.
    await write('workspace-initialize-default', 'workspace/initializeDefault', 'initializeDefaultWorkspace', {
      requestId: requestId('default-workspace'),
    })
    await read('office-generation', 'officeKit/generation', 'officePdfGeneration', {}, (value) => value !== undefined)
    await write('office-render-missing-file', 'officeKit/render', 'renderOfficeToPdf', {
      sessionId,
      path: 'no-such-document.docx',
    })
    await stream('question-wait-unknown-call', 'userQuestions/attachWait', 'followQuestionWait', {
      sessionId,
      callId: 'probe-missing-call',
    })
    await write('interrupt-subagent-unknown-child', 'subagents/interruptByUser', 'interruptSubagent', {
      childSessionId: 'probe-missing-child',
      requestId: requestId('subagent'),
    })

    // --- B. gaps the local carrier unlocks --------------------------------
    await read(
      'web-providers',
      'web/listProviders',
      'listWebProviders',
      {},
      (value) => value !== undefined,
    )
    await read(
      'workspace-file-search',
      'workspaceFiles/search',
      'searchWorkspaceFiles',
      { sessionId, query: 'needle' },
      (value) => value !== undefined,
    )
    /** One raw Host route with the API cookie this Host's launch token buys. */
    const rawGet = async (pathname, params = {}) => {
      if (routeCookie === undefined) {
        const launch = new URL(ready.url)
        const connect = new URL('/connect', launch.origin)
        connect.searchParams.set('token', launch.searchParams.get('token') ?? '')
        connect.searchParams.set('interactions', 'answer')
        const exchanged = await fetch(connect, { redirect: 'manual' })
        const stored = exchanged.headers.getSetCookie?.()[0] ?? exchanged.headers.get('set-cookie') ?? ''
        routeCookie = stored.split(';', 1)[0]
      }
      const target = new URL(pathname, new URL(ready.url).origin)
      for (const [name, value] of Object.entries(params)) target.searchParams.set(name, String(value))
      const response = await fetch(target, { headers: { cookie: routeCookie } })
      const body = await response.text().catch(() => '')
      return {
        status: response.status,
        mediaType: response.headers.get('content-type'),
        body: body.slice(0, 60),
      }
    }
    // Controls: both plugin services are what the market and the detail-image
    // route belong to, so a refusal below can be attributed to this profile.
    await read('control-list-bundles', 'pluginManager/listBundles', 'listBundles', {}, (value) => value !== undefined)
    await read('control-plugin-inventory', 'pluginInventory/list', 'pluginInventory', {}, (value) => value !== undefined)
    const inventory = await helper.call('pluginInventory').catch(() => undefined)
    const modules = Array.isArray(inventory?.entries)
      ? inventory.entries.map((entry) => String(entry.moduleName ?? '')).filter((name) => /plugin/iu.test(name))
      : []
    const marketMounted = modules.some((name) => /plugin-market/iu.test(name))
    record({
      id: 'plugin-services-mounted',
      kind: 'setup',
      endpoint: 'pluginInventory/list',
      ok: true,
      detail: `marketMounted=${marketMounted} modules=${modules.join(',') || '(none)'}`,
    })
    // `dsh-plugin-market` is optional: a fresh profile may not mount it, in
    // which case every market endpoint answers 404. The wiring is proven
    // either way; the difference is recorded explicitly.
    const market = async (id, endpoint, method, params) => {
      try {
        const value = await helper.call(method, params)
        record({ id, kind: 'read', endpoint, method, ok: true, detail: `OK ${JSON.stringify(value)?.slice(0, 160)}` })
      } catch (error) {
        const unmounted = !marketMounted && isUnmounted(error)
        record({
          id,
          kind: 'read',
          endpoint,
          method,
          ok: unmounted === true || isBusinessAnswer(error),
          detail: unmounted
            ? `NOT MOUNTED (profile lacks dsh-plugin-market) ${summarize(error)}`
            : summarize(error),
        })
      }
    }
    await market('market-indexes', 'pluginMarket/listIndexes', 'pluginMarketIndexes', {})
    await market('market-search-unknown-index', 'pluginMarket/search', 'searchPluginMarket', {
      url: 'https://probe.invalid/index.json',
      query: { text: 'pdf' },
    })
    await market('market-entry-unknown-index', 'pluginMarket/readEntryDetail', 'readPluginMarketEntry', {
      url: 'https://probe.invalid/index.json',
      name: 'probe-plugin',
      version: '0.0.1',
    })
    await write('schedule-create-invalid-timing', 'schedule/create', 'createSchedule', {
      title: 'probe task',
      prompt: 'probe',
      timing: { kind: 'every', every_seconds: -5 },
      requestId: requestId('schedule-create'),
    })
    await write('schedule-update-missing-task', 'schedule/edit', 'updateSchedule', {
      id: 'probe-missing-task',
      patch: { title: 'probe renamed' },
      expectedUpdatedAt: null,
      requestId: requestId('schedule-update'),
    })
    await write('schedule-delete-missing-task', 'schedule/edit', 'deleteSchedule', {
      id: 'probe-missing-task',
      expectedUpdatedAt: null,
      requestId: requestId('schedule-delete'),
    })
    await write('install-bundle-invalid-spec', 'pluginManager/installBundle', 'installBundle', {
      spec: '-not-a-spec',
      requestId: requestId('install'),
    })
    await write('update-bundle-unknown-name', 'pluginManager/updateBundle', 'updateBundle', {
      name: 'probe-nonexistent-bundle',
      version: '9.9.9',
      requestId: requestId('update'),
    })
    await write('remove-bundle-unknown-name', 'pluginManager/removeBundle', 'removeBundle', {
      name: 'probe-nonexistent-bundle',
      requestId: requestId('remove'),
    })
    await write('team-enable-off', 'agentTeams/setEnabled', 'setTeamEnabled', {
      sessionId,
      enabled: false,
      requestId: requestId('team'),
    })

    // --- B/C. raw Host resources the local carrier downloads -------------
    try {
      const zip = await helper.call('exportSessionZip', { sessionId, requestId: requestId('export') })
      const exists = typeof zip?.path === 'string' && existsSync(zip.path)
      const bytes = exists ? statSync(zip.path).size : 0
      const head = exists ? readFileSync(zip.path).subarray(0, 2).toString('latin1') : ''
      downloads.push(zip?.path)
      record({
        id: 'export-session-zip',
        kind: 'resource',
        endpoint: 'GET /api/session.export',
        method: 'exportSessionZip',
        ok: zip?.status === 'completed' && exists && bytes > 0 && head === 'PK',
        detail: `status=${zip?.status} name=${zip?.name} bytes=${bytes} zipMagic=${head === 'PK'}`,
      })
    } catch (error) {
      record({
        id: 'export-session-zip',
        kind: 'resource',
        endpoint: 'GET /api/session.export',
        method: 'exportSessionZip',
        ok: false,
        detail: summarize(error),
      })
    }
    try {
      const image = await helper.call('readDetailImage', {
        bundle: 'probe-nonexistent-bundle',
        document: 'README.md',
        path: 'logo.png',
      })
      downloads.push(image?.path)
      record({
        id: 'detail-image-unknown-bundle',
        kind: 'resource',
        endpoint: 'GET /api/plugin-manager/detail-file',
        method: 'readDetailImage',
        ok: image?.status === 'completed' && (image.bytes ?? 0) > 0,
        detail: `status=${image?.status} mediaType=${image?.mediaType} bytes=${image?.bytes}`,
      })
    } catch (error) {
      // 404 is the Host's own answer for a bundle it does not hold — the same
      // "not found" body an unregistered route would send, which is why the raw
      // control below submits a malformed query: only a registered handler
      // answers 400 `invalid`.
      record({
        id: 'detail-image-unknown-bundle',
        kind: 'resource',
        endpoint: 'GET /api/plugin-manager/detail-file',
        method: 'readDetailImage',
        ok: error?.code === 'NOT_FOUND' || isBusinessAnswer(error),
        detail: `BUSINESS REFUSAL ${summarize(error)}`,
      })
    }

    // Raw route evidence for the two GET resources: the client path above shows
    // what a caller sees, these show what the Host actually registers. An
    // unknown route is included as the control shape.
    try {
      const control = await rawGet('/api/definitely-not-a-route')
      const managerRoute = await rawGet('/api/plugin-manager/detail-file', {
        bundle: 'probe-nonexistent-bundle',
        document: 'README.md',
        path: 'logo.png',
      })
      const marketRoute = await rawGet('/api/plugin-market/detail-file', {
        document: 'probe-document',
        path: 'logo.png',
      })
      const exportRoute = await rawGet('/api/session.export', { sessionId: 'probe-missing-session' })
      // A registered detail-file handler answers 400 `invalid` when a query
      // member is missing; an unregistered route can only answer 404.
      const managerInvalid = await rawGet('/api/plugin-manager/detail-file', { bundle: 'x' })
      const marketInvalid = await rawGet('/api/plugin-market/detail-file', {})
      record({
        id: 'raw-resource-routes',
        kind: 'resource',
        endpoint: 'GET /api/{session.export,plugin-manager/detail-file,plugin-market/detail-file}',
        ok: exportRoute.status === 404 && exportRoute.body.length > 0,
        detail: `unknown=${control.status}/${JSON.stringify(control.body)} manager=${managerRoute.status}/${JSON.stringify(managerRoute.body)} managerInvalid=${managerInvalid.status}/${JSON.stringify(managerInvalid.body)} market=${marketRoute.status}/${JSON.stringify(marketRoute.body)} marketInvalid=${marketInvalid.status}/${JSON.stringify(marketInvalid.body)} export=${exportRoute.status}/${JSON.stringify(exportRoute.body)}`,
      })
    } catch (error) {
      record({
        id: 'raw-resource-routes',
        kind: 'resource',
        endpoint: 'GET /api',
        ok: false,
        detail: summarize(error),
      })
    }

    // --- carrier capability table: local vs the frozen Remote list -------
    const capabilities = await helper.call('capabilities', {})
    const expectedAvailable = [
      'createSchedule',
      'updateSchedule',
      'deleteSchedule',
      'installBundle',
      'removeBundle',
      'updateBundle',
      'pluginMarketIndexes',
      'searchPluginMarket',
      'readPluginMarketEntry',
      'setTeamEnabled',
      'listWebProviders',
      'searchWorkspaceFiles',
      'initializeDefaultWorkspace',
      'renderOfficeToPdf',
      'officePdfGeneration',
      'interruptSubagent',
      'followQuestionWait',
      'followRemoteAccess',
      'exportSessionZip',
      'readDetailImage',
    ]
    const missing = expectedAvailable.filter((name) => capabilities?.operations?.[name] !== true)
    record({
      id: 'local-capabilities',
      kind: 'capability',
      endpoint: 'capabilities',
      ok: missing.length === 0,
      detail: `available=${expectedAvailable.length - missing.length}/${expectedAvailable.length}${missing.length === 0 ? '' : ` missing=${missing.join(',')}`}`,
    })
    record({
      id: 'local-unsupported-list',
      kind: 'capability',
      endpoint: 'capabilities',
      ok:
        !(capabilities?.unsupported ?? []).includes('rawSessionLogDownload') &&
        !(capabilities?.unsupported ?? []).includes('workspaceFileSearch') &&
        (capabilities?.unsupported ?? []).includes('arbitraryPluginPage'),
      detail: `unsupported=${(capabilities?.unsupported ?? []).join(',')}`,
    })
    const commands = await helper.call('listCommands', { sessionId })
    const exportRow = Array.isArray(commands) ? commands.find((row) => row.name === 'export') : undefined
    record({
      id: 'list-commands-export',
      kind: 'capability',
      endpoint: 'commands/list',
      ok: exportRow !== undefined && exportRow.clientUnavailableReason === undefined,
      detail: `export=${JSON.stringify(exportRow)}`,
    })

    await helper.call('clearSession').catch(() => undefined)
    await helper.call('disconnect')
    await helper.call('close')
    await helper.closed
    record({
      id: 'helper-exit',
      kind: 'teardown',
      ok: helper.exitInfo()?.code === 0,
      detail: JSON.stringify(helper.exitInfo()),
    })
  } catch (error) {
    record({ id: 'probe-completed', kind: 'setup', ok: false, detail: error.message })
  } finally {
    if (helper !== undefined && helper.exitInfo() === undefined) {
      try { helper.child.kill('SIGTERM') } catch { /* already gone */ }
      await helper.closed
    }
    host.child.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`)
    host.child.stdin.end()
    const killTimer = setTimeout(() => { try { host.child.kill('SIGKILL') } catch { /* gone */ } }, 30_000)
    await host.closed
    clearTimeout(killTimer)
    record({
      id: 'host-shutdown',
      kind: 'teardown',
      ok: host.state.stopped === true && host.state.exit?.code === 0,
      detail: JSON.stringify(host.state.exit),
    })
    for (const path of downloads) {
      if (typeof path !== 'string' || path === '') continue
      const directory = resolve(path, '..')
      // Only the private download directories this probe created are removed.
      if (!/native-dsh-download-/u.test(directory)) continue
      rmSync(directory, { recursive: true, force: true })
    }

    if (options.evidence !== undefined) {
      const failed = checks.filter((check) => !check.ok)
      const evidence = {
        schemaVersion: 1,
        kind: 'local-endpoints-acceptance',
        recordedAt: new Date().toISOString(),
        scope:
          'Native helper driving a synthetic local Host in a temporary DSH_HOME. Read endpoints are called for real; write endpoints are submitted in shapes the Host refuses before mutating, so nothing is installed, deleted or converted. No installed app, no ~/.dsh write, no model prompt.',
        runtime: runtimeRoot,
        temporaryHome: home,
        node: process.version,
        helper: options.helper,
        host: {
          ready: host.state.ready === undefined ? null : {
            origin: new URL(host.state.ready.url).origin,
            injections: host.state.ready.injections?.length ?? null,
          },
          exit: host.state.exit ?? null,
        },
        helperExit: helper?.exitInfo() ?? null,
        skipped: [
          {
            endpoint: 'subagents/list',
            reason: 'No descriptor in the shipped Host; child Sessions come from the existing Session projection.',
          },
          {
            endpoint: 'workspaceFiles/readAll, workspaceFiles/readRelated',
            reason: 'No descriptor in the shipped Host; readFile with an empty range already reads a whole file.',
          },
          {
            endpoint: 'claudeCodeMods/watchBand, claudeCodeMods/pressBand',
            reason: 'The mods service is not part of the runtime tree (only the frozen endpoint allowlist names it).',
          },
          {
            endpoint: 'userQuestions/answer',
            reason: 'Duplicate of the wired $events/result path (answerQuestions).',
          },
          {
            endpoint: 'pluginMarket/setIndexes',
            reason: 'Index-source writing has no native UI in this batch; discovery reads are wired only.',
          },
        ],
        checks,
        counts: {
          total: checks.length,
          passed: checks.length - failed.length,
          failed: failed.length,
        },
        passed: failed.length === 0,
      }
      mkdirSync(resolve(options.evidence, '..'), { recursive: true })
      writeFileSync(resolve(options.evidence), `${JSON.stringify(evidence, undefined, 2)}\n`)
      console.log(`evidence ${resolve(options.evidence)}`)
    }
    if (options.keep) console.log(`kept ${home}`)
    else rmSync(home, { recursive: true, force: true })
  }

  const failed = checks.filter((check) => !check.ok)
  console.log(failed.length === 0 ? 'PROBE PASS' : `PROBE FAIL (${failed.length})`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})