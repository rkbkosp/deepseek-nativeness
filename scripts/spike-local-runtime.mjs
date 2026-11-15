#!/usr/bin/env node
/**
 * S2 spike: boot the vendored dsh runtime with a plain Node executable through
 * `runtime/launcher.mjs`, in a throwaway DSH_HOME, and prove the Host serves the
 * real web client.
 *
 * It never touches the real ~/.dsh, never starts the installed application and
 * sends no model prompt. The only writes are under a temporary DSH_HOME.
 *
 * Checks, in order:
 *   1. the launcher reaches the Host's `ready` event with a loopback URL;
 *   2. the published launch token exchanges for an authority-bound cookie;
 *   3. `GET /` returns the packaged web client document;
 *   4. a script asset referenced by that document is served;
 *   5. `/api/remote.mux` accepts the same cookie as a WebSocket upgrade;
 *   6. shutdown completes with `shutdown-complete` and exit code 0.
 *
 *   node scripts/spike-local-runtime.mjs
 *   node scripts/spike-local-runtime.mjs --keep --evidence qa/runtime-results/local-runtime-spike.json
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DEADLINE_MS = 180_000

function parseArgs(argv) {
  const options = { runtime: 'build/runtime', keep: false, evidence: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--runtime') options.runtime = argv[++index]
    else if (argv[index] === '--keep') options.keep = true
    else if (argv[index] === '--evidence') options.evidence = argv[++index]
    else throw new Error(`spike: unknown argument ${argv[index]}`)
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

function call(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolvePromise, reject) => {
    const target = new URL(url)
    const req = request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers,
      timeout: 20_000,
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => resolvePromise({ status: res.statusCode, headers: res.headers, body: text }))
    })
    req.on('timeout', () => req.destroy(new Error('request timeout')))
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/** Report only the HTTP status of a WebSocket upgrade attempt. */
function upgrade(url, headers) {
  return new Promise((resolvePromise) => {
    const target = new URL(url)
    const req = request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'GET',
      headers: { ...headers, connection: 'Upgrade', upgrade: 'websocket',
        'sec-websocket-version': '13', 'sec-websocket-key': 'AAAAAAAAAAAAAAAAAAAAAA==' },
      timeout: 10_000,
    })
    req.on('upgrade', (res, socket) => { socket.destroy(); resolvePromise({ status: res.statusCode, upgraded: true }) })
    req.on('response', (res) => { res.resume(); resolvePromise({ status: res.statusCode, upgraded: false }) })
    req.on('timeout', () => req.destroy())
    req.on('error', (error) => resolvePromise({ error: error.message }))
    req.end()
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const runtimeRoot = resolve(options.runtime)
  const runtime = join(runtimeRoot, 'dsh')
  const primaryRuntime = join(runtimeRoot, 'primary-runtime')
  const node = join(primaryRuntime, 'dependencies', 'node', 'bin', 'node')
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-spike-'))
  const launcher = resolve('runtime/launcher.mjs')
  const checks = []
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : `: ${detail}`}`)
  }

  console.log(`runtime  ${runtime}`)
  console.log(`node     ${node}`)
  console.log(`spike    node ${process.version}`)
  console.log(`home     ${home}`)

  const child = spawn(node, [
    launcher,
    '--home', home, '--runtime', runtime, '--node', node,
    '--primary-runtime', primaryRuntime,
    '--pnpm', join(primaryRuntime, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'),
    '--bin', join(primaryRuntime, 'bin'),
  ], { env: isolatedEnvironment(home), stdio: ['pipe', 'pipe', 'pipe'] })

  const stderrTail = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[host] ${chunk}`)
    for (const line of chunk.split('\n')) if (line.trim() !== '') stderrTail.push(line)
    while (stderrTail.length > 40) stderrTail.shift()
  })

  let buffered = ''
  const state = { ready: undefined, failed: undefined, stopped: false, exit: undefined }
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
    child.once('close', (code, signal) => { state.exit = { code, signal }; resolveClose() })
  })

  const deadline = Date.now() + DEADLINE_MS
  while (state.ready === undefined && state.failed === undefined && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
  }

  if (state.ready === undefined) {
    record('host reached ready', false, state.failed?.message ?? 'no ready event before the deadline')
    child.kill('SIGKILL')
    await closed
    if (options.evidence !== undefined) report(options.evidence, checks, state, runtimeRoot, home)
    process.exit(1)
  }
  if (state.failed !== undefined) record('host reported no failure', false, state.failed.message)

  const url = new URL(state.ready.url)
  record('host reached ready on loopback', url.hostname === '127.0.0.1' && url.port !== '',
    `${url.origin} injections=${Array.isArray(state.ready.injections) ? state.ready.injections.length : '?'}`)

  const origin = url.origin
  let browserCookie
  let index = { status: 0, body: '' }
  if (url.searchParams.has('token')) {
    const exchange = await call(state.ready.url, {})
    const setCookie = exchange.headers['set-cookie']
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie
    browserCookie = typeof first === 'string' ? first.split(';')[0] : undefined
    record('launch token exchanges for a cookie', exchange.status !== 200 && browserCookie !== undefined,
      `status=${exchange.status} cookie=${browserCookie === undefined ? 'none' : browserCookie.split('=')[0]}`)
  } else {
    const seed = state.ready.seed
    browserCookie = `${seed.name}=${seed.value}`
    record('launcher supplied a desktop cookie', true, browserCookie.split('=')[0])
  }

  if (browserCookie !== undefined) {
    const headers = { cookie: browserCookie, referer: `${origin}/` }
    index = await call(`${origin}/`, { headers })
    const looksLikeClient = /<title>[^<]*<\/title>/u.test(index.body) && /<script[^>]+src=/u.test(index.body)
    record('index document served', index.status === 200 && looksLikeClient,
      `status=${index.status} bytes=${index.body.length} title=${(index.body.match(/<title>([^<]*)<\/title>/u) ?? [])[1] ?? '-'}`)

    const rawAsset = (index.body.match(/<script[^>]+src="([^"]+)"/u) ?? [])[1]
    const assetPath = rawAsset === undefined ? undefined : rawAsset.replaceAll('&amp;', '&')
    if (assetPath !== undefined) {
      const asset = await call(new URL(assetPath, origin).href, { headers })
      record('script asset served', asset.status === 200 && asset.body.length > 0,
        `${assetPath} status=${asset.status} bytes=${asset.body.length}`)
    } else {
      record('script asset served', false, 'no script src in the index document')
    }

    const ws = await upgrade(`${origin}/api/remote.mux`, headers)
    record('remote multiplex WebSocket accepts the cookie', ws.status === 101, JSON.stringify(ws))
  }

  child.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`)
  child.stdin.end()
  const killTimer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 30_000)
  await closed
  clearTimeout(killTimer)
  record('shutdown completed', state.stopped && state.exit?.code === 0,
    `stopped=${String(state.stopped)} exit=${JSON.stringify(state.exit)}`)

  if (options.evidence !== undefined) report(options.evidence, checks, state, runtimeRoot, home)
  if (!options.keep) rmSync(home, { recursive: true, force: true })
  else console.log(`kept ${home}`)

  const failed = checks.filter((check) => !check.ok)
  console.log(failed.length === 0 ? 'SPIKE PASS' : `SPIKE FAIL (${failed.length})`)
  process.exit(failed.length === 0 ? 0 : 1)
}

function report(path, checks, state, runtimeRoot, home) {
  const evidence = {
    schemaVersion: 1,
    kind: 'local-runtime-spike',
    recordedAt: new Date().toISOString(),
    scope: 'Synthetic local boot of the vendored runtime with plain Node. No installed app launch, no ~/.dsh write, no model prompt.',
    runtime: runtimeRoot,
    temporaryHome: home,
    node: process.version,
    launcher: 'runtime/launcher.mjs',
    ready: state.ready === undefined ? null : {
      url: state.ready.url,
      injections: Array.isArray(state.ready.injections) ? state.ready.injections.length : null,
      pid: state.ready.pid,
    },
    exit: state.exit ?? null,
    checks,
    passed: checks.every((check) => check.ok),
  }
  writeFileSync(resolve(path), `${JSON.stringify(evidence, undefined, 2)}\n`)
  console.log(`evidence ${resolve(path)}`)
}

main().catch((error) => { console.error(error); process.exit(1) })
