#!/usr/bin/env node
/**
 * Milestone 1 acceptance: one real Host accepts a local file through the native
 * helper's own upload path.
 *
 * Starts the vendored runtime through `runtime/launcher.mjs` in a throwaway
 * DSH_HOME, drives `remote/local-bridge.mjs` over its JSON-lines protocol, and
 * uploads two synthetic files (zero bytes and ~5 MiB) created inside that home.
 * The bytes never leave the machine and nothing is written outside the
 * temporary home. The evidence records statuses, counts, sizes and paths only —
 * no file content and no credential.
 *
 *   node scripts/probe-local-upload.mjs
 *   node scripts/probe-local-upload.mjs --keep --evidence qa/runtime-results/local-upload.json
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DEADLINE_MS = 240_000
const CALL_TIMEOUT_MS = 120_000
/** Large enough to exceed any single JSON framing budget, small enough to stay quick. */
const LARGE_BYTES = 5 * 1024 * 1024 + 4096

/** Explicit, stable-enough mutation id: the helper refuses anything under 16. */
function mutationId(kind) {
  return `probe-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function parseArgs(argv) {
  const options = { runtime: 'build/runtime', helper: 'remote/local-bridge.mjs', home: undefined, keep: false, evidence: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--runtime') options.runtime = argv[++index]
    else if (argv[index] === '--helper') options.helper = argv[++index]
    else if (argv[index] === '--home') options.home = argv[++index]
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

/** Deterministic bytes: same size, different content per seed, never logged. */
function syntheticBytes(size, seed) {
  const bytes = Buffer.allocUnsafe(size)
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 31 + seed * 17 + 7) & 0xff
  return bytes
}

/** The Host's own content-addressed object path for one staged file. */
function storedObjectPath(home, attachmentId) {
  const digest = String(attachmentId).replace(/^sha256:/u, '')
  return join(home, 'attachments', 'v1', 'file-objects', digest.slice(0, 2), digest)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const runtimeRoot = resolve(options.runtime)
  const node = join(runtimeRoot, 'primary-runtime', 'dependencies', 'node', 'bin', 'node')
  const home = options.home === undefined
    ? mkdtempSync(join(tmpdir(), 'dsh-local-upload-'))
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
  const uploads = []
  try {
    if (host.state.ready === undefined) {
      record('host reached ready', false, host.state.failed?.message ?? host.stderrTail.slice(-5).join(' | '))
      throw new Error('host never became ready')
    }
    const ready = host.state.ready
    record('host reached ready', true,
      `${new URL(ready.url).origin} injections=${Array.isArray(ready.injections) ? ready.injections.length : '?'}`)

    helper = startHelper(node, runtimeRoot, ready.url, options.helper)

    const status = await helper.call('status')
    record('the helper is an owner local connection, not a Remote account',
      status.authorized === true && status.backend === 'local-mux' && status.serverUrl === new URL(ready.url).origin,
      JSON.stringify({ authorized: status.authorized, backend: status.backend, protocol: status.protocol }))

    const connected = await helper.call('connect', { hostId: 'local' })
    record('connect reports a connected answering peer',
      connected.connected === true && connected.transportConnected === true && connected.hostId === 'local',
      JSON.stringify({ connected: connected.connected, interactionReady: connected.detail }))
    await helper.waitFor('status', (row) => row.params?.connected === true, 15_000)

    const capabilities = await helper.call('capabilities', {})
    record('the local Host advertises workspace file upload',
      capabilities?.operations?.uploadWorkspaceFile === true,
      JSON.stringify({
        uploadWorkspaceFile: capabilities?.operations?.uploadWorkspaceFile,
        detail: capabilities?.details?.uploadWorkspaceFile?.source,
      }))

    // Everything below stays inside the throwaway home.
    const workspaceDir = join(home, 'workspace')
    mkdirSync(workspaceDir, { recursive: true })
    const createdWorkspace = await helper.call('createWorkspace', {
      path: workspaceDir,
      requestId: mutationId('workspace'),
    })
    const workspaces = await helper.call('workspaces')
    const workspaceId = workspaces?.[0]?.id ?? createdWorkspace?.value?.workspaceId
    record('a workspace exists in the temporary home',
      Array.isArray(workspaces) && workspaces.length === 1 && workspaceId !== undefined,
      `workspaces=${workspaces?.length ?? '?'} workspaceId=${workspaceId ?? 'missing'}`)

    const createdSession = await helper.call('createSession', {
      workspaceId,
      requestId: mutationId('session'),
    })
    const sessionId = createdSession?.value?.sessionId
    record('a session exists in the temporary home',
      typeof sessionId === 'string' && sessionId !== '',
      `sessionId=${sessionId ?? 'missing'} status=${createdSession?.status}`)
    if (typeof sessionId !== 'string' || sessionId === '')
      throw new Error('no sessionId to upload into')

    // The upload path checks the catalog, so refresh it after the creation.
    const sessions = await helper.call('sessions', { all: true })
    record('the created session is in the helper catalog',
      Array.isArray(sessions) && sessions.some((row) => row.id === sessionId),
      `sessions=${sessions?.length ?? '?'}`)

    const uploadDir = join(home, 'upload')
    mkdirSync(uploadDir, { recursive: true })
    const cases = [
      { label: 'zero-byte', name: 'probe-empty.txt', bytes: Buffer.alloc(0) },
      { label: '5 MiB', name: 'probe-large.bin', bytes: syntheticBytes(LARGE_BYTES, 3) },
    ]
    for (const item of cases) {
      const localPath = join(uploadDir, item.name)
      writeFileSync(localPath, item.bytes)
      const digest = createHash('sha256').update(item.bytes).digest('hex')
      const requestId = mutationId(`upload-${item.label === 'zero-byte' ? 'empty' : 'large'}`)
      const startedAt = Date.now()
      let result
      try {
        result = await helper.call('uploadWorkspaceFile', {
          sessionId,
          localPath,
          name: item.name,
          requestId,
        })
      } catch (error) {
        record(`the ${item.label} file upload was accepted`, false,
          `${error.code ?? 'ERROR'}: ${error.message}`)
        uploads.push({ label: item.label, bytes: item.bytes.byteLength, accepted: false, code: error.code ?? 'ERROR' })
        continue
      }
      const elapsedMs = Date.now() - startedAt
      const attachmentId = result?.file?.attachmentId
      record(`the ${item.label} file upload was accepted`,
        result?.status === 'accepted' &&
          result?.bytes === item.bytes.byteLength &&
          result?.file?.bytes === item.bytes.byteLength &&
          typeof result?.receiptId === 'string' && result.receiptId !== '',
        JSON.stringify({
          status: result?.status,
          bytes: result?.bytes,
          receipt: typeof result?.receiptId === 'string' ? 'present' : 'missing',
          elapsedMs,
          semantics: result?.semantics,
          composerAttachment: result?.composerAttachment,
        }))
      record(`the ${item.label} file is stored verbatim (content-addressed id matches the local bytes)`,
        attachmentId === `sha256:${digest}` && result?.file?.bytes === item.bytes.byteLength,
        JSON.stringify({
          attachmentMatchesLocalDigest: attachmentId === `sha256:${digest}`,
          name: result?.file?.name,
        }))

      // The Host's own file surface must see the stored object at its size.
      const objectPath = storedObjectPath(home, attachmentId ?? '')
      try {
        const stat = await helper.call('statFile', { sessionId, path: objectPath })
        record(`the ${item.label} file is visible through the Host file API`,
          stat?.bytes === item.bytes.byteLength,
          JSON.stringify({ bytes: stat?.bytes, absolutePathInsideTempHome: true }))
      } catch (error) {
        record(`the ${item.label} file is visible through the Host file API`, false,
          `${error.code ?? 'ERROR'}: ${error.message}`)
      }

      const replay = await helper.call('uploadWorkspaceFile', {
        sessionId,
        localPath,
        name: item.name,
        requestId,
      })
      record(`the ${item.label} receipt is deduplicated by requestId`,
        replay?.receiptId === result?.receiptId,
        `receiptReplayed=${replay?.receiptId === result?.receiptId}`)

      uploads.push({
        label: item.label,
        name: item.name,
        bytes: item.bytes.byteLength,
        accepted: result?.status === 'accepted',
        receiptReplayed: replay?.receiptId === result?.receiptId,
        elapsedMs,
      })
    }

    await helper.call('clearSession').catch(() => undefined)
    await helper.call('disconnect')
    await helper.call('close')
    await helper.closed
    record('the helper exited cleanly', helper.exitInfo()?.code === 0, `${JSON.stringify(helper.exitInfo())}`)
  } catch (error) {
    record('probe completed without an unexpected failure', false, error.message)
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
        kind: 'local-upload-acceptance',
        recordedAt: new Date().toISOString(),
        scope: 'Native helper uploading two synthetic files to a real Host in a temporary DSH_HOME. No installed app, no ~/.dsh write, no model prompt, no approval answered. Only statuses, counts, sizes and paths are recorded.',
        runtime: runtimeRoot,
        temporaryHome: home,
        node: process.version,
        helper: options.helper,
        host: {
          // The launch token is a credential: only the origin is recorded.
          origin: host.state.ready === undefined ? null : new URL(host.state.ready.url).origin,
          injections: host.state.ready?.injections?.length ?? null,
          exit: host.state.exit ?? null,
        },
        helperExit: helper?.exitInfo() ?? null,
        uploads,
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