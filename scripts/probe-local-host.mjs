#!/usr/bin/env node
/**
 * Probe the local Host's authentication surface with the credential the
 * launcher received, without any model call.
 *
 * Answers one question the shell must know: which requests does the vendored
 * Host accept from a non-Electron client, and with which credential
 * (desktop cookie vs. the `dsh web` launch token).
 *
 *   node scripts/probe-local-host.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function isolatedEnvironment(home) {
  const kept = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(?:npm|pnpm|corepack|DSH)_/u.test(name)),
  )
  return { ...kept, DSH_HOME: home, HOME: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, XDG_STATE_HOME: home,
    npm_config_userconfig: join(home, 'npmrc'), npm_config_globalconfig: join(home, 'npmrc'),
    npm_config_store_dir: join(home, 'store'), npm_config_enable_global_virtual_store: 'false' }
}

function call(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolvePromise, reject) => {
    const target = new URL(url)
    const req = request({
      hostname: target.hostname, port: target.port,
      path: `${target.pathname}${target.search}`,
      method, headers, timeout: 15_000,
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => resolvePromise({ status: res.statusCode, headers: res.headers, body: text }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/** Manual WebSocket upgrade probe: we only need the HTTP response status. */
function upgrade(url, headers) {
  return new Promise((resolvePromise) => {
    const target = new URL(url)
    const req = request({
      hostname: target.hostname, port: target.port, path: target.pathname, method: 'GET',
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

function startLauncher(runtimeRoot) {
  const runtime = join(runtimeRoot, 'dsh')
  const primaryRuntime = join(runtimeRoot, 'primary-runtime')
  const node = join(primaryRuntime, 'dependencies', 'node', 'bin', 'node')
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-probe-'))
  const child = spawn(node, [
    resolve('runtime/launcher.mjs'),
    '--home', home, '--runtime', runtime, '--node', node,
    '--primary-runtime', primaryRuntime,
    '--pnpm', join(primaryRuntime, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'),
    '--bin', join(primaryRuntime, 'bin'),
  ], { env: isolatedEnvironment(home), stdio: ['pipe', 'pipe', 'pipe'] })
  child.stderr.resume()
  const ready = new Promise((resolveReady, reject) => {
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
        if (message.type === 'ready') resolveReady({ child, home, ready: message })
        if (message.type === 'status' && message.phase === 'failed') reject(new Error(message.message))
      }
    })
  })
  return ready
}

async function main() {
  const runtimeRoot = resolve('build/runtime')
  const { child, home, ready } = await startLauncher(runtimeRoot)
  console.log(`ready ${ready.url}`)
  const cookie = `${ready.seed.name}=${ready.seed.value}`
  const origin = new URL(ready.url).origin
  const desktopCookie = { cookie }
  const asBrowser = { cookie, origin, referer: `${origin}/` }

  const cases = [
    ['GET /', `${origin}/`, { headers: desktopCookie }],
    ['GET /?token (launch token)', ready.url, {}],
    ['GET /assets (anonymous?)', `${origin}/assets/`, { headers: {} }],
    ['POST /api (desktop cookie)', `${origin}/api`, { method: 'POST', headers: { ...desktopCookie, 'content-type': 'application/json' }, body: '{}' }],
    ['POST /api (no cookie)', `${origin}/api`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }],
    ['GET /api (desktop cookie)', `${origin}/api`, { headers: desktopCookie }],
    ['GET /plugins/none (desktop cookie)', `${origin}/plugins/none.js`, { headers: desktopCookie }],
  ]
  for (const [label, url, options] of cases) {
    try {
      const result = await call(url, options)
      console.log(`${label} -> ${result.status} ct=${result.headers['content-type'] ?? '-'} ` +
        `loc=${result.headers.location ?? '-'} body=${JSON.stringify(result.body.slice(0, 90))}`)
    } catch (error) {
      console.log(`${label} -> error ${error.message}`)
    }
  }

  // Browser flow: the launch token is exchanged for an authority-bound cookie.
  const connect = await call(ready.url, {})
  const setCookie = connect.headers['set-cookie']
  console.log(`token exchange -> ${connect.status} set-cookie=${Array.isArray(setCookie) ? setCookie.map((v) => v.split(';')[0]).join(' | ') : String(setCookie).slice(0, 120)}`)
  const browserCookie = Array.isArray(setCookie) && setCookie.length > 0 ? setCookie[0].split(';')[0] : undefined
  if (browserCookie !== undefined) {
    const browserHeaders = { cookie: browserCookie, origin, referer: `${origin}/` }
    const index = await call(`${origin}/`, { headers: browserHeaders })
    console.log(`GET / (browser cookie) -> ${index.status} bytes=${index.body.length}`)
    const api = await call(`${origin}/api`, { method: 'POST', headers: { ...browserHeaders, 'content-type': 'application/json' }, body: '{}' })
    console.log(`POST /api (browser cookie) -> ${api.status} ${JSON.stringify(api.body.slice(0, 120))}`)
    const apiGet = await call(`${origin}/api`, { headers: browserHeaders })
    console.log(`GET /api (browser cookie) -> ${apiGet.status} ${JSON.stringify(apiGet.body.slice(0, 120))}`)
    const ws = await upgrade(`${origin}/api/remote.mux`, browserHeaders)
    console.log(`WS /api/remote.mux (browser cookie) -> ${JSON.stringify(ws)}`)
  }

  const wsCases = [
    ['WS /api/remote.mux (desktop cookie)', `${origin}/api/remote.mux`, desktopCookie],
    ['WS /api/remote.mux (browser-ish)', `${origin}/api/remote.mux`, asBrowser],
  ]
  for (const [label, url, headers] of wsCases) {
    const result = await upgrade(url, headers)
    console.log(`${label} -> ${JSON.stringify(result)}`)
  }

  child.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`)
  child.stdin.end()
  await new Promise((resolveClose) => child.once('close', resolveClose))
  rmSync(home, { recursive: true, force: true })
}

main().catch((error) => { console.error(error); process.exit(1) })
