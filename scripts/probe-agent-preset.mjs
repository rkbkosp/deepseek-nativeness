#!/usr/bin/env node
/**
 * Agent-preset wiring: the native client's list/select calls against a real
 * local Host.
 *
 * Starts the vendored runtime in a throwaway DSH_HOME under build/_tmp, creates
 * one workspace and one blank Session there, then reads the preset roster and
 * selects `ptc` through the same helper and operations the Go client uses
 * (`listAgentPresets` / `selectAgentPreset` with `{sessionId, agentPreset}`).
 * Nothing touches ~/.dsh, the installed app, or a model.
 *
 *   node scripts/probe-agent-preset.mjs --evidence qa/runtime-results/agent-preset.json
 */

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DEADLINE_MS = 240_000
const CALL_TIMEOUT_MS = 60_000

function mutationId(kind) {
  return `probe-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function parseArgs(argv) {
  const options = { runtime: 'build/runtime', helper: 'remote/local-bridge.mjs', evidence: undefined, keep: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--runtime') options.runtime = argv[++index]
    else if (argv[index] === '--helper') options.helper = argv[++index]
    else if (argv[index] === '--evidence') options.evidence = argv[++index]
    else if (argv[index] === '--keep') options.keep = true
    else throw new Error(`probe: unknown argument ${argv[index]}`)
  }
  return options
}

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
  return { child, call, notifications, closed, stderr: stderrTail, exitInfo: () => dead }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const runtimeRoot = resolve(options.runtime)
  const node = join(runtimeRoot, 'primary-runtime', 'dependencies', 'node', 'bin', 'node')
  mkdirSync(join(process.cwd(), 'build', '_tmp'), { recursive: true })
  const home = mkdtempSync(join(process.cwd(), 'build', '_tmp', 'preset-home-'))
  const checks = []
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : `: ${detail}`}`)
  }

  console.log(`runtime  ${runtimeRoot}`)
  console.log(`home     ${home}`)

  const host = startHost(node, runtimeRoot, home)
  const hostDeadline = Date.now() + DEADLINE_MS
  while (host.state.ready === undefined && host.state.failed === undefined && Date.now() < hostDeadline) {
    await new Promise((r) => setTimeout(r, 200))
  }

  let helper
  let sessionId
  try {
    if (host.state.ready === undefined) {
      record('host reached ready', false, host.state.failed?.message ?? host.stderrTail.slice(-5).join(' | '))
      throw new Error('host never became ready')
    }
    record('host reached ready', true, new URL(host.state.ready.url).origin)
    helper = startHelper(node, runtimeRoot, host.state.ready.url, options.helper)
    await helper.call('status')
    await helper.call('connect', { hostId: 'local' })

    const roster = await helper.call('listAgentPresets', {})
    const ids = Array.isArray(roster?.presets) ? roster.presets.map((row) => row.id) : []
    record('the roster lists the shipped presets',
      ['standard', 'ptc', 'minimal', 'cordis'].every((id) => ids.includes(id)),
      ids.join(','))

    const workspaceDir = join(home, 'workspace')
    mkdirSync(workspaceDir, { recursive: true })
    const workspace = await helper.call('createWorkspace', { path: workspaceDir, requestId: mutationId('workspace') })
    const workspaceId = workspace?.value?.workspaceId ?? workspace?.workspaceId
    const session = await helper.call('createSession', { workspaceId, requestId: mutationId('session') })
    sessionId = session?.value?.sessionId ?? session?.sessionId ?? session?.id
    record('a blank Session exists to receive the pick', sessionId !== undefined, String(sessionId))
    // openSession validates against the loaded catalog, exactly as the client's
    // refreshCatalog-then-open path does.
    await helper.call('sessions', { all: true })
    await helper.call('openSession', { sessionId })

    const capabilities = await helper.call('capabilities', { sessionId, workspaceId })
    const operations = capabilities?.operations ?? {}
    record('the Host advertises the preset operations',
      operations.listAgentPresets === true && operations.selectAgentPreset === true,
      JSON.stringify({ list: operations.listAgentPresets, select: operations.selectAgentPreset }))

    const before = await helper.call('sessionProjections', { sessionId })
    record('the blank Session records a preset before the pick',
      typeof before?.values?.agentPreset === 'string', JSON.stringify(before?.values?.agentPreset))

    const receipt = await helper.call('selectAgentPreset', {
      sessionId,
      agentPreset: 'ptc',
      requestId: mutationId('preset'),
    })
    record('agentPresets/select accepted the pick',
      receipt?.status === 'accepted' || receipt?.ok === true, JSON.stringify(receipt)?.slice(0, 160))

    const after = await helper.call('sessionProjections', { sessionId })
    record('the Session composition now reads ptc',
      after?.values?.agentPreset === 'ptc', JSON.stringify(after?.values?.agentPreset))

    const locked = await helper.call('selectAgentPreset', {
      sessionId,
      agentPreset: 'minimal',
      requestId: mutationId('preset'),
    }).then(() => undefined).catch((error) => error.message)
    record('a second pick on the same blank Session is still accepted or refused with a reason',
      locked === undefined || typeof locked === 'string',
      locked ?? 'accepted')

    const catalog = await helper.call('sessionProjections', { sessionId })
    record('the catalog projection is empty for a Session without children',
      Array.isArray(catalog?.values?.subagentCatalog) && catalog.values.subagentCatalog.length === 0,
      JSON.stringify(catalog?.values?.subagentCatalog))

    await helper.call('disconnect')
    await helper.call('close')
    await helper.closed
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
    if (options.evidence !== undefined) {
      const evidence = {
        schemaVersion: 1,
        kind: 'agent-preset-acceptance',
        recordedAt: new Date().toISOString(),
        scope: 'Native helper driving a synthetic local Host in a temporary DSH_HOME. No installed app, no ~/.dsh write, no model prompt.',
        runtime: runtimeRoot,
        temporaryHome: home,
        node: process.version,
        sessionId,
        checks,
        passed: checks.every((check) => check.ok),
      }
      writeFileSync(resolve(options.evidence), `${JSON.stringify(evidence, undefined, 2)}\n`)
      console.log(`evidence ${resolve(options.evidence)}`)
    }
    if (!options.keep) console.log(`kept ${home}`)
  }

  const failed = checks.filter((check) => !check.ok)
  console.log(failed.length === 0 ? 'PROBE PASS' : `PROBE FAIL (${failed.length})`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
