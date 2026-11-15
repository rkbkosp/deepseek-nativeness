#!/usr/bin/env node
/**
 * Live write-path acceptance for the local carrier.
 *
 * Runs the real Host on a *copy* of the shared profile (so real provider
 * credentials and the real plugin composition are present) and drives the
 * native helper through the same stdio contract the Go client uses: create a
 * Workspace, create a Session, send a prompt, observe streaming updates,
 * cancel a turn, and answer an approval if the Host asks for one.
 *
 * The shared ~/.dsh is never written: `--home` must point at a copy. Evidence
 * records counts, timings and boolean outcomes only — never message text,
 * credentials or session content.
 *
 *   node scripts/probe-local-live.mjs --home /tmp/native-dsh-live-… \
 *     --evidence qa/runtime-results/local-live-write.json
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const READY_MS = 240_000
const CALL_MS = 120_000
const TURN_MS = 240_000

function parseArgs(argv) {
  const options = { runtime: 'build/runtime', helper: 'remote/local-bridge.mjs', home: undefined, evidence: undefined, prompt: '请只回复四个字符：OK。不要调用任何工具。' }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--runtime') options.runtime = argv[++index]
    else if (argv[index] === '--helper') options.helper = argv[++index]
    else if (argv[index] === '--home') options.home = argv[++index]
    else if (argv[index] === '--evidence') options.evidence = argv[++index]
    else throw new Error(`probe: unknown argument ${argv[index]}`)
  }
  if (options.home === undefined) throw new Error('probe: --home <copied DSH_HOME> is required')
  return options
}

function mutationId(kind) {
  return `live-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
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
  ], { env: { ...process.env, DSH_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] })
  const state = { ready: undefined, failed: undefined, stopped: false, exit: undefined }
  const stderrTail = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    for (const line of chunk.split('\n')) if (line.trim() !== '') stderrTail.push(line)
    while (stderrTail.length > 80) stderrTail.shift()
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
  const child = spawn(node, [resolve(helper), '--url', url, '--runtime', runtimeRoot], { stdio: ['pipe', 'pipe', 'pipe'] })
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
    while (stderrTail.length > 80) stderrTail.shift()
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
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        rejectCall(new Error(`${method}: no reply within ${CALL_MS}ms`))
      }, CALL_MS)
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
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }
  const waitFor = async (method, predicate = () => true, timeoutMs = TURN_MS) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = notifications.find((row) => row.method === method && predicate(row))
      if (found !== undefined) return found
      if (dead) throw new Error(`helper exited while waiting for ${method}`)
      if (Date.now() > deadline) return undefined
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  return { child, call, waitFor, notifications, closed, exitInfo: () => dead }
}

/** Count assistant text length without keeping the text itself. */
function assistantStats(snapshot) {
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : []
  let chars = 0
  let assistant = 0
  for (const message of messages) {
    if (message?.role !== 'assistant') continue
    assistant += 1
    if (typeof message.text === 'string') chars += message.text.length
  }
  return { messages: messages.length, assistant, chars }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const runtimeRoot = resolve(options.runtime)
  const node = join(runtimeRoot, 'primary-runtime', 'dependencies', 'node', 'bin', 'node')
  const home = resolve(options.home)
  const checks = []
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : `: ${detail}`}`)
  }
  const timings = {}
  console.log(`home     ${home}`)

  const host = startHost(node, runtimeRoot, home)
  const deadline = Date.now() + READY_MS
  while (host.state.ready === undefined && host.state.failed === undefined && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
  }
  let helper
  try {
    if (host.state.ready === undefined) {
      record('host reached ready', false, host.state.failed?.message ?? host.stderrTail.slice(-6).join(' | '))
      throw new Error('host never became ready')
    }
    record('host reached ready', true, new URL(host.state.ready.url).origin)
    helper = startHelper(node, runtimeRoot, host.state.ready.url, options.helper)

    const connected = await helper.call('connect', { hostId: 'local' })
    record('connected to the local Host', connected.connected === true, connected.detail)

    // A throwaway Workspace keeps the copied profile's own Workspaces untouched.
    const workspaceDir = join(home, 'live-workspace')
    mkdirSync(workspaceDir, { recursive: true })
    const workspace = await helper.call('createWorkspace', { path: workspaceDir, requestId: mutationId('workspace') })
    const workspaceId = workspace?.value?.workspace?.workspaceId ?? workspace?.workspaceId
    record('workspace/create accepted', typeof workspaceId === 'string', String(workspaceId).slice(0, 8))

    const session = await helper.call('createSession', { workspaceId, requestId: mutationId('session') })
    const sessionId = session?.value?.sessionId ?? session?.sessionId
    record('session/create accepted', typeof sessionId === 'string', String(sessionId).slice(0, 16))
    if (typeof sessionId !== 'string') throw new Error('no session id')

    // The adapter answers from its loaded catalog: read it after the write.
    const catalog = await helper.call('sessions', { all: true })
    record('the new session is in the loaded catalog', catalog.some((row) => row.id === sessionId),
      `sessions=${catalog.length}`)

    const opened = await helper.call('openSession', { sessionId })
    record('openSession returned a snapshot', Array.isArray(opened?.messages), `messages=${opened?.messages?.length ?? '?'}`)

    // ---- turn 1: a real model answer ----
    const sendStart = Date.now()
    const receipt = await helper.call('sendMessage', { sessionId, text: options.prompt, requestId: mutationId('prompt') })
    record('sendMessage was accepted', receipt?.status === 'accepted' || receipt?.value !== undefined,
      JSON.stringify({ status: receipt?.status, requestId: receipt?.requestId }))

    const running = await helper.waitFor('sessionState', (row) => row.params?.sessionId === sessionId && row.params?.running === true, 60_000)
    record('the turn reported running', running !== undefined)

    // The native contract is the presentation pipeline: typed patches plus a
    // full snapshot on demand. Assert those, not the legacy message frames.
    const patch = await helper.waitFor('chatPresentationPatch', (row) => row.params?.sessionId === sessionId && row.at > sendStart, TURN_MS)
    record('presentation patches arrived while the turn ran', patch !== undefined,
      patch === undefined ? 'no chatPresentationPatch' : `first patch ${Date.now() - sendStart}ms`)

    const settled = await helper.waitFor('sessionState', (row) => row.params?.sessionId === sessionId && row.params?.running === false && row.at > sendStart, TURN_MS)
    timings.turn1Ms = Date.now() - sendStart
    record('the turn settled to idle', settled !== undefined, `${timings.turn1Ms}ms`)

    const presentation = await helper.call('presentation')
    const stats = assistantStats(presentation)
    record('the assistant produced display text', stats.assistant > 0 && stats.chars > 0,
      `assistant=${stats.assistant} chars=${stats.chars}`)
    record('the presentation names the opened session', presentation?.sessionId === sessionId,
      String(presentation?.sessionId ?? '').slice(0, 16))

    // ---- turn 2: cancel an in-flight turn ----
    const cancelStart = Date.now()
    await helper.call('sendMessage', { sessionId, text: '请从 1 数到 60，每行一个数字，不要调用任何工具。', requestId: mutationId('prompt') })
    const cancelRunning = await helper.waitFor('sessionState', (row) => row.params?.sessionId === sessionId && row.params?.running === true && row.at > cancelStart, 60_000)
    record('the second turn started', cancelRunning !== undefined)
    const cancelReceipt = await helper.call('cancel', { sessionId, requestId: mutationId('cancel') })
    record('cancel was accepted', cancelReceipt !== undefined, JSON.stringify({ status: cancelReceipt?.status }))
    const cancelled = await helper.waitFor('sessionState', (row) => row.params?.sessionId === sessionId && row.params?.running === false && row.at > cancelStart, TURN_MS)
    timings.cancelMs = Date.now() - cancelStart
    record('the cancelled turn settled to idle', cancelled !== undefined, `${timings.cancelMs}ms`)
    const afterCancel = await helper.call('presentation')
    record('the session stayed readable after the cancel',
      afterCancel?.sessionId === sessionId && Array.isArray(afterCancel.messages),
      `messages=${afterCancel?.messages?.length ?? '?'}`)

    // ---- turn 3: a questions waterfall (a real interaction round-trip) ----
    const askStart = Date.now()
    await helper.call('sendMessage', {
      sessionId,
      text: '请调用提问工具（ask_user_question）问我一个问题：今天吃什么？选项：面 / 饭。只调用这一个工具，不要写别的。',
      requestId: mutationId('prompt'),
    })
    const question = await helper.waitFor('pending', (row) => row.params?.sessionId === sessionId && (row.params?.items ?? []).length > 0, 120_000)
    if (question === undefined) {
      record('questions round-trip', false, 'the Host never asked a question')
    } else {
      const item = question.params.items[0]
      const first = item.questions?.[0]
      record('a question reached the native client', item.kind === 'questions' && typeof first?.id === 'string',
        `kind=${item.kind} options=${first?.options?.length ?? 0}`)
      const answered = await helper.call('answerQuestions', {
        requestId: item.id,
        answers: [{ id: first.id, selected: [first.options[0].label] }],
      })
      record('the answer was accepted through the local carrier', answered?.answered === true, JSON.stringify(answered))
      const settledAfterAnswer = await helper.waitFor('sessionState', (row) => row.params?.sessionId === sessionId && row.params?.running === false && row.at > askStart, TURN_MS)
      timings.questionMs = Date.now() - askStart
      record('the answered turn settled to idle', settledAfterAnswer !== undefined, `${timings.questionMs}ms`)
    }

    // ---- turn 4: an approval, if this profile asks for one ----
    const approvalStart = Date.now()
    await helper.call('sendMessage', {
      sessionId,
      text: '请调用 bash 工具，并显式传入 sandbox_permissions: danger-full-access，执行 `echo native-local-approval`，然后把输出告诉我。',
      requestId: mutationId('prompt'),
    })
    const approval = await helper.waitFor('pending', (row) => row.params?.sessionId === sessionId
      && (row.params?.items ?? []).some((pendingItem) => pendingItem.kind === 'approval'), 120_000)
    if (approval === undefined) {
      const settledWithoutApproval = await helper.waitFor('sessionState', (row) => row.params?.sessionId === sessionId && row.params?.running === false && row.at > approvalStart, 60_000)
      record('approval round-trip', settledWithoutApproval !== undefined,
        settledWithoutApproval === undefined ? 'neither an approval nor an idle turn' : 'this profile did not ask for approval')
    } else {
      const item = approval.params.items.find((pendingItem) => pendingItem.kind === 'approval')
      const answered = await helper.call('answerApproval', { requestId: item.id, outcome: 'allowed-once' })
      record('approval answered through the local carrier', answered !== undefined,
        JSON.stringify({ kind: item.kind, status: answered?.status }))
      const afterApproval = await helper.waitFor('sessionState', (row) => row.params?.sessionId === sessionId && row.params?.running === false && row.at > approvalStart, TURN_MS)
      record('the approved turn settled to idle', afterApproval !== undefined, `${Date.now() - approvalStart}ms`)
    }

    await helper.call('close').catch(() => undefined)
    await helper.closed
    record('the helper exited cleanly', helper.exitInfo()?.code === 0, JSON.stringify(helper.exitInfo()))
  } catch (error) {
    record('probe completed without an unexpected failure', false, error.message)
  } finally {
    if (helper !== undefined && helper.exitInfo() === undefined) {
      try { helper.child.kill('SIGTERM') } catch { /* gone */ }
      await helper.closed
    }
    host.child.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`)
    host.child.stdin.end()
    const killTimer = setTimeout(() => { try { host.child.kill('SIGKILL') } catch {} }, 30_000)
    await host.closed
    clearTimeout(killTimer)
    record('host shutdown completed', host.state.stopped && host.state.exit?.code === 0, JSON.stringify(host.state.exit))
    if (options.evidence !== undefined) {
      writeFileSync(resolve(options.evidence), `${JSON.stringify({
        schemaVersion: 1,
        kind: 'local-live-write',
        recordedAt: new Date().toISOString(),
        scope: 'Real Host on a copy of the shared profile, driven by remote/local-bridge.mjs. Creates its own Workspace and Session; writes no shared state and records only counts and timings.',
        home,
        runtime: runtimeRoot,
        helper: options.helper,
        promptChars: options.prompt.length,
        timings,
        checks,
        passed: checks.every((check) => check.ok),
      }, undefined, 2)}\n`)
      console.log(`evidence ${resolve(options.evidence)}`)
    }
  }
  const failed = checks.filter((check) => !check.ok)
  console.log(failed.length === 0 ? 'LIVE WRITE PASS' : `LIVE WRITE FAIL (${failed.length})`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
