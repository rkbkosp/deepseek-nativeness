#!/usr/bin/env node
/**
 * Capture the *original* DSH web frontend for pixel parity review.
 *
 * The installed desktop application is a frozen reference: this script never
 * launches, restarts or reconfigures it. It talks to an already running
 * `dsh web` Host through a headless Chromium over CDP, so the pixels come from
 * the same React frontend the frozen app itself renders.
 *
 * No dependencies: Node 24 ships a global WebSocket, and `fetch` covers the
 * small HTTP surface of the DevTools protocol.
 *
 *   PARITY_CDP=http://127.0.0.1:<port> \
 *   PARITY_URL_FILE=/tmp/dsh-parity-url.txt \
 *   node scripts/capture-parity-original.mjs --probe
 *
 *   ... node scripts/capture-parity-original.mjs            # capture states
 *
 * The Host URL carries a one-time launch token. It is read from a file under
 * /tmp and never written to the repository, the report or capture.json; only
 * the origin is recorded.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { resolve as resolvePath } from 'node:path'

const CDP_HTTP = process.env.PARITY_CDP ?? 'http://127.0.0.1:9222'
const URL_FILE = process.env.PARITY_URL_FILE ?? '/tmp/dsh-parity-url.txt'
const OUT_DIR = resolvePath(process.env.PARITY_OUT ?? 'qa/parity-2026-11-23/original')
const VIEWPORT = { width: 1280, height: 820 }
const DPR = 2

const PROBE = process.argv.includes('--probe')
/** Sequential clicks for selector work: `--probe-click "Account menu"`. */
const PROBE_CLICKS = process.argv
  .filter((argument) => argument.startsWith('--probe-click='))
  .map((argument) => argument.slice('--probe-click='.length))
/** `--only=transcript,settings` captures a subset while the harness is settled. */
const ONLY = process.argv
  .filter((argument) => argument.startsWith('--only='))
  .flatMap((argument) => argument.slice('--only='.length).split(','))
  .map((name) => name.trim())
  .filter(Boolean)
const LOCALE = process.env.PARITY_LOCALE ?? 'zh-CN'
const HARD_TIMEOUT_MS = Number(process.env.PARITY_TIMEOUT_MS ?? 240_000)
const VERBOSE = process.env.PARITY_VERBOSE === '1'
const COLOR_SCHEME = process.env.PARITY_COLOR_SCHEME ?? 'dark'

/** The first real conversation in the session tree, not the "new session" row. */
const REAL_SESSION = `(() => {
  const rows = [...document.querySelectorAll('[aria-label="会话"] [role="treeitem"], [aria-label="Sessions"] [role="treeitem"]')]
  for (const row of rows) {
    if (row.getAttribute('aria-expanded') !== null) continue      // workspace group
    const text = (row.textContent || '').trim()
    if (text.startsWith('新会话') || text.startsWith('New session')) continue  // placeholder
    const box = row.getBoundingClientRect()
    if (box.width === 0 || box.height === 0 || text.length < 2) continue
    return { found: true, label: 'session-row', x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
  }
  return { found: false }
})()`

/** The states this capture understands, mirroring qa_ui_state.go names. */
const STATES = [
  { state: 'transcript', file: '01-transcript.png', scroll: process.env.PARITY_SCROLL === 'end' ? 'end' : 'start' },
  { state: 'hero', file: '02-hero.png', steps: [{ labels: ['新建会话', 'New session'] }] },
  { state: 'search', file: '03-search.png', steps: [{ labels: ['搜索会话', 'Search sessions'] }] },
  {
    state: 'settings',
    file: '04-settings.png',
    steps: [
      { labels: ['账号菜单', 'Account menu'] },
      { labels: ['设置', 'Settings'] },
      // Match the client's explicit dark appearance, not "follow system".
      { labels: ['深色', 'Dark'], optional: true },
    ],
  },
  {
    state: 'right-pane',
    file: '05-right-pane.png',
    steps: [{ labels: ['打开右侧边栏', 'Open right sidebar'], optional: true }],
    expectExpr: `(() => {
      const button = [...document.querySelectorAll('button')].find((node) =>
        (node.getAttribute('aria-label') || '').includes('收起右侧边栏') || (node.getAttribute('aria-label') || '').includes('Collapse right sidebar'))
      if (!button) return false
      const box = button.getBoundingClientRect()
      return box.width > 0 && box.x >= 0 && box.x < innerWidth
    })()`,
    settle: {
      present: '[data-sidebar-right-guide]',
      spinner: '[aria-busy="true"], [class*="spinner" i], [class*="Spinner"], [class*="loading" i]',
      timeoutMs: 12_000,
      settleMs: 1_200,
    },
    blockedReason: 'the right sidebar never became visible',
    cleanup: [{ labels: ['收起右侧边栏', 'Collapse right sidebar'] }],
  },
  { state: 'plugins', file: '06-plugins.png', steps: [{ labels: ['插件', 'Plugins'] }] },
  {
    state: 'workspace-create',
    file: '07-workspace-create.png',
    steps: [{ labels: ['添加工作区', 'Add workspace'] }],
    // The web build delegates to an OS directory chooser, which headless
    // Chromium cannot present; the page itself never changes.
    expect: '[role="dialog"], dialog',
    blockedReason:
      'the Add workspace button opens a hidden <input type=file webkitdirectory>; headless Chromium cannot render the OS folder picker, so no in-page sheet appears',
  },
]

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** A minimal CDP client over one page target. */
class Page {
  #ws
  #nextId = 0
  #pending = new Map()
  #listeners = new Map()

  static async open(webSocketDebuggerUrl) {
    const page = new Page()
    await page.#connect(webSocketDebuggerUrl)
    return page
  }

  #connect(url) {
    return new Promise((ready, failed) => {
      const timer = setTimeout(() => failed(new Error('cdp socket open timeout')), 15_000)
      this.#ws = new WebSocket(url)
      this.#ws.addEventListener('open', () => {
        clearTimeout(timer)
        ready()
      })
      this.#ws.addEventListener('error', () => {
        clearTimeout(timer)
        failed(new Error('cdp socket error'))
      })
      this.#ws.addEventListener('message', (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.id !== undefined) {
          const waiting = this.#pending.get(message.id)
          if (!waiting) return
          this.#pending.delete(message.id)
          if (message.error) waiting.fail(new Error(`${waiting.method}: ${message.error.message}`))
          else waiting.done(message.result)
          return
        }
        const handlers = this.#listeners.get(message.method)
        if (handlers) for (const handler of handlers) handler(message.params)
      })
    })
  }

  send(method, params = {}, timeoutMs = 20_000) {
    const id = ++this.#nextId
    return new Promise((done, fail) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        fail(new Error(`${method}: cdp timeout`))
      }, timeoutMs)
      this.#pending.set(id, {
        method,
        done: (value) => {
          clearTimeout(timer)
          done(value)
        },
        fail: (error) => {
          clearTimeout(timer)
          fail(error)
        },
      })
      this.#ws.send(JSON.stringify({ id, method, params }))
    })
  }

  once(method, timeoutMs = 30_000) {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => {
        this.#listeners.set(method, (this.#listeners.get(method) ?? []).filter((h) => h !== handler))
        fail(new Error(`${method}: timeout`))
      }, timeoutMs)
      const handler = (params) => {
        clearTimeout(timer)
        this.#listeners.set(method, (this.#listeners.get(method) ?? []).filter((h) => h !== handler))
        done(params)
      }
      this.#listeners.set(method, [...(this.#listeners.get(method) ?? []), handler])
    })
  }

  /** Evaluate an expression in the page and return its JSON value. */
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    })
    if (result.exceptionDetails) {
      throw new Error(`evaluate: ${result.exceptionDetails.text ?? 'exception'}`)
    }
    return result.result?.value
  }

  close() {
    try {
      this.#ws.close()
    } catch {
      // Already closed.
    }
  }
}

async function json(path) {
  const response = await fetch(`${CDP_HTTP}${path}`, { method: path.startsWith('/json/new') ? 'PUT' : 'GET' })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.json()
}

function readLaunchUrl() {
  const raw = readFileSync(URL_FILE, 'utf8').trim()
  const parsed = new URL(raw)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('launch URL is not http(s)')
  }
  return parsed
}

/** Installed application version, used only as metadata. */
function dshVersion() {
  try {
    const output = execFileSync('/Users/rkbkosp/.local/bin/dsh', ['--version'], {
      encoding: 'utf8',
      timeout: 20_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const found = output.match(/\d+\.\d+\.\d+(?:[-+][\w.]+)?/u)
    if (found) return found[0]
  } catch {
    // Fall through to the bundle version.
  }
  try {
    return readFileSync('/Applications/DeepSeek Harness.app/Contents/Info.plist', 'utf8').match(
      /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/u,
    )?.[1] ?? null
  } catch {
    return null
  }
}

/** Clickable inventory: labels only, never message text. */
const INVENTORY = `(() => {
  const seen = new Set()
  const rows = []
  const nodes = document.querySelectorAll('button, [role="button"], a, [role="tab"], [role="menuitem"], input, [aria-label], [title]')
  for (const node of nodes) {
    const label = (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').trim().replace(/\\s+/g, ' ')
    const placeholder = node.getAttribute('placeholder') || ''
    const key = [node.tagName, label, placeholder].join('|')
    if (!label && !placeholder) continue
    if (seen.has(key)) continue
    seen.add(key)
    const box = node.getBoundingClientRect()
    rows.push({
      tag: node.tagName.toLowerCase(),
      role: node.getAttribute('role') || '',
      label: label.slice(0, 60),
      placeholder: placeholder.slice(0, 40),
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
      w: Math.round(box.width),
      h: Math.round(box.height),
      visible: box.width > 0 && box.height > 0,
    })
  }
  return rows
})()`

/** Click one clickable whose aria-label/title/text matches one of the labels. */
function clickByLabels(labels) {
  return `(() => {
    const labels = ${JSON.stringify(labels)}.map((l) => l.toLowerCase())
    const nodes = [...document.querySelectorAll('button, [role="button"], a, [role="tab"], [role="menuitem"], [aria-label]')]
    for (const wanted of labels) {
      for (const node of nodes) {
        const text = (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').trim().replace(/\\s+/g, ' ')
        const box = node.getBoundingClientRect()
        if (!text || box.width === 0 || box.height === 0) continue
        if (box.x < 0 || box.y < 0 || box.x >= innerWidth || box.y >= innerHeight) continue
        if (text.toLowerCase() !== wanted && !text.toLowerCase().includes(wanted)) continue
        return { found: true, label: text.slice(0, 40), x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
      }
    }
    return { found: false }
  })()`
}

/** Press one clickable by centre coordinates, so React sees a real click. */
async function press(page, point) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', {
      type,
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    })
  }
}

/** The preview build shows a one-time notice over the workspace. */
async function dismissNotice(page) {
  const hit = await page.eval(clickByLabels(['继续', 'Continue']))
  if (!hit?.found) return false
  await press(page, hit)
  await sleep(700)
  return true
}

/** Centre point of the first visible element matching a CSS selector. */
function selectorPoint(selector) {
  return `(() => {
    const node = document.querySelector(${JSON.stringify(selector)})
    if (!node) return { found: false }
    const box = node.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return { found: false }
    return { found: true, label: 'selector', x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
  })()`
}

/** Re-run a picker until the surface it looks for has rendered. */
async function pickWithRetry(page, step, budgetMs = 10_000) {
  const deadline = Date.now() + budgetMs
  for (;;) {
    const hit = step.selector
      ? await page.eval(selectorPoint(step.selector))
      : step.pick
        ? await page.eval(step.pick)
        : await page.eval(clickByLabels(step.labels))
    if (hit?.found || Date.now() > deadline) return hit
    await sleep(300)
  }
}

/** One step: a CSS selector, an inline picker, or a list of accessible labels. */
async function clickStep(page, step) {
  const hit = await pickWithRetry(page, step)
  if (!hit?.found && step.optional) return 'already-open'
  if (!hit?.found) {
    throw new Error(
      step.selector ?? step.pick
        ? 'no element matched the selector'
        : `no clickable matched ${JSON.stringify(step.labels)}`,
    )
  }
  await press(page, hit)
  // Park the pointer off every target: a resting cursor paints a hover card.
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: VIEWPORT.width - 6, y: VIEWPORT.height - 6, buttons: 0 })
  await sleep(900)
  return step.selector ?? step.pick ? 'session-row' : hit.label
}

async function pageReady(page) {
  return page.eval(`(() => {
    const root = document.getElementById('root') || document.body
    const text = (document.body.innerText || '').trim()
    return {
      readyState: document.readyState,
      title: document.title,
      hasRoot: Boolean(document.getElementById('root')),
      rootChildren: root ? root.children.length : 0,
      textLength: text.length,
      heading: document.querySelector('h1, [role="heading"]')?.textContent?.trim().slice(0, 60) || '',
    }
  })()`)
}

async function waitForPage(page, budgetMs = 25_000) {
  const deadline = Date.now() + budgetMs
  let last = null
  let stable = 0
  while (Date.now() < deadline) {
    try {
      const state = await pageReady(page)
      if (state.readyState === 'complete' && (state.rootChildren > 0 || !state.hasRoot) && state.textLength > 0) {
        if (last && state.textLength === last.textLength) stable += 1
        else stable = 0
        last = state
        if (stable >= 3) return state
      }
    } catch {
      // The execution context is replaced while the document loads.
    }
    await sleep(300)
  }
  return last
}

async function navigate(page, url) {
  const loaded = page.once('Page.loadEventFired', 30_000).catch(() => null)
  await page.send('Page.navigate', { url })
  await loaded
  return waitForPage(page)
}

/** Scroll the tallest scrollable region (the transcript) to its end. */
/** Scroll the tallest scrollable region (the transcript) to its top. */
const SCROLL_TO_START = `(() => {
  const scrollable = [...document.querySelectorAll('*')].filter((node) => {
    const style = getComputedStyle(node)
    return /(auto|scroll)/u.test(style.overflowY) && node.scrollHeight - node.clientHeight > 40
  })
  scrollable.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
  const target = scrollable[0]
  if (!target) return { found: false }
  target.scrollTop = 0
  return {
    found: true,
    scrollTop: Math.round(target.scrollTop),
    scrollHeight: target.scrollHeight,
    clientHeight: target.clientHeight,
    atEnd: target.scrollTop + target.clientHeight >= target.scrollHeight - 2,
  }
})()`
const SCROLL_TO_END = `(() => {
  const scrollable = [...document.querySelectorAll('*')].filter((node) => {
    const style = getComputedStyle(node)
    return /(auto|scroll)/u.test(style.overflowY) && node.scrollHeight - node.clientHeight > 40
  })
  scrollable.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
  const target = scrollable[0]
  if (!target) return { found: false }
  target.scrollTop = target.scrollHeight
  return {
    found: true,
    scrollTop: Math.round(target.scrollTop),
    scrollHeight: target.scrollHeight,
    clientHeight: target.clientHeight,
    atEnd: target.scrollTop + target.clientHeight >= target.scrollHeight - 2,
  }
})()`

async function scrollTo(page, where) {
  const expression = where === 'start' ? SCROLL_TO_START : SCROLL_TO_END
  let last = null
  for (let pass = 0; pass < 3; pass += 1) {
    last = await page.eval(expression)
    await sleep(350)
  }
  return last
}

async function screenshot(page, path) {
  const shot = await page.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  writeFileSync(path, Buffer.from(shot.data, 'base64'))
  const bytes = readFileSync(path)
  // Parse the PNG IHDR for the real pixel size instead of trusting the request.
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  return { width, height, bytes: bytes.length }
}

/** Geometry of the surfaces a pixel comparison depends on. */
const METRICS_EXPR = `(() => {
  const rect = (node) => {
    if (!node) return null
    const box = node.getBoundingClientRect()
    return { x: Math.round(box.x * 100) / 100, y: Math.round(box.y * 100) / 100, width: Math.round(box.width * 100) / 100, height: Math.round(box.height * 100) / 100 }
  }
  const pick = (...selectors) => {
    for (const selector of selectors) {
      const node = document.querySelector(selector)
      if (node) return node
    }
    return null
  }
  return {
    innerWidth, innerHeight, devicePixelRatio,
    screenWidth: screen.width,
    body: rect(document.body),
    sidebar: rect(document.querySelector('[aria-label="会话"]')?.closest('aside, div') ?? document.querySelector('[aria-label="Sessions"]')?.closest('aside, div')),
    chat: rect(pick('[class*="messageColumn"]', '[class*="chatContent"]', '[class*="ChatView"]')),
    settings: rect(document.querySelector('[role="dialog"], dialog')),
    header: rect(document.querySelector('header')),
    composer: rect(pick('[class*="composer"]', '[class*="Composer"]')),
    bodyFont: getComputedStyle(document.body).fontSize,
    bodyZoom: getComputedStyle(document.body).zoom,
    visualViewport: visualViewport ? { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale } : null,
  }
})()`

/** Pick the first conversation of one workspace, expanding it when collapsed.
 *  The tree is a flat list: a workspace row is followed by its session rows. */
function sessionPicker(workspace) {
  return `(() => {
    const items = [...document.querySelectorAll('[role="treeitem"]')]
    const isGroup = (node) => node.getAttribute('aria-expanded') !== null
    const text = (node) => (node.textContent || '').trim()
    const centre = (node) => {
      const box = node.getBoundingClientRect()
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
    }
    const placeholder = (node) => text(node).startsWith('新会话') || text(node).startsWith('New session')
    const wanted = ${JSON.stringify(workspace)}
    let group = items.find((node) => isGroup(node) && text(node).startsWith(wanted))
    if (!group) group = items.find((node) => isGroup(node) && node.getAttribute('aria-expanded') === 'true')
    if (!group) group = items.find(isGroup)
    if (!group) return { found: false, reason: 'no-workspace' }
    if (group.getAttribute('aria-expanded') === 'false') return { found: false, expand: centre(group), reason: 'collapsed' }
    const start = items.indexOf(group)
    for (let index = start + 1; index < items.length; index += 1) {
      const node = items[index]
      if (isGroup(node)) break
      if (placeholder(node) || text(node).length < 2) continue
      const box = node.getBoundingClientRect()
      if (box.width === 0) continue
      return { found: true, ...centre(node), label: 'session-row', workspace: text(group).slice(0, 20) }
    }
    return { found: false, reason: 'no-session-in-workspace' }
  })()`
}

/** Open the first real conversation, expanding workspace groups if needed. */
async function openFirstConversation(page, workspace = process.env.PARITY_WORKSPACE ?? 'native-dsh') {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const picked = await pickWithRetry(page, { pick: sessionPicker(workspace) }, 4_000)
    if (!picked) break
    if (picked.found) {
      await press(page, picked)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1, buttons: 0 })
      await sleep(1_200)
      return picked.label ?? 'session-row'
    }
    if (picked.expand) {
      await press(page, picked.expand)
      await sleep(700)
    }
  }
  return null
}

async function openFirstConversationLegacy(page) {
  let hit = await pickWithRetry(page, { pick: REAL_SESSION }, 2_500)
  if (hit?.found) {
    await press(page, hit)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1, buttons: 0 })
    await sleep(1_200)
    return 'session-row'
  }
  const groups = await page.eval(`[...document.querySelectorAll('[role="treeitem"][aria-expanded="false"]')]
    .map((node, index) => {
      const box = node.getBoundingClientRect()
      return { index, x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
    })`)
  for (const group of groups) {
    await press(page, group)
    await sleep(700)
    hit = await pickWithRetry(page, { pick: REAL_SESSION }, 1_500)
    if (hit?.found) {
      await press(page, hit)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1, buttons: 0 })
      await sleep(1_200)
      return `workspace-${group.index} → session-row`
    }
  }
  return null
}

async function collectMetrics(page, origin, chromeVersion) {
  const launch = readLaunchUrl()
  await navigate(page, launch.href)
  await dismissNotice(page)
  const transcript = await page.eval(METRICS_EXPR)
  const transcriptLayout = await page.send('Page.getLayoutMetrics')
  const opened = await openFirstConversation(page)
  if (!opened) throw new Error('no session row to open')
  const transcriptOpen = await page.eval(METRICS_EXPR)

  await navigate(page, `${origin}/`)
  await dismissNotice(page)
  await clickStep(page, { labels: ['账号菜单', 'Account menu'] })
  await clickStep(page, { labels: ['设置', 'Settings'] })
  const settings = await page.eval(METRICS_EXPR)
  const settingsLayout = await page.send('Page.getLayoutMetrics')

  return {
    capturedAt: new Date().toISOString(),
    origin,
    chromeVersion,
    requested: { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: DPR, mobile: false },
    transcript: { geometry: transcript, geometryWithConversation: transcriptOpen, layout: transcriptLayout },
    settings: { geometry: settings, layout: settingsLayout },
  }
}

async function main() {
  const launch = readLaunchUrl()
  const origin = launch.origin
  mkdirSync(OUT_DIR, { recursive: true })

  const version = await json('/json/version')
  const chromeVersion = version.Browser ?? 'unknown'
  const target = await json(`/json/new?${encodeURIComponent('about:blank')}`)
  const page = await Page.open(target.webSocketDebuggerUrl)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: DPR,
    mobile: false,
    screenWidth: VIEWPORT.width,
    screenHeight: VIEWPORT.height,
  })
  // The reference run must be compared in the same language as the client, so
  // the locale is pinned before the first document exists.
  await page.send('Emulation.setLocaleOverride', { locale: LOCALE }).catch(() => null)
  // The review run compares against the client's dark appearance.
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: COLOR_SCHEME }],
  })
  await page.send('Network.enable').catch(() => null)
  await page.send('Network.setUserAgentOverride', {
    userAgent: (await page.send('Browser.getVersion')).product,
    acceptLanguage: `${LOCALE},zh;q=0.9,en;q=0.4`,
  }).catch(() => null)
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(LOCALE)} });
             Object.defineProperty(navigator, 'languages', { get: () => [${JSON.stringify(LOCALE)}, 'zh'] });`,
  }).catch(() => null)

  // The tokenized launch URL establishes the session cookie and redirects.
  let first = await navigate(page, launch.href)
  if (!first) throw new Error('the Host never rendered a document')
  await dismissNotice(page)
  const locale = await page.eval(`({ language: navigator.language, languages: navigator.languages })`)

  if (process.argv.includes('--metrics')) {
    const collected = await collectMetrics(page, origin, chromeVersion)
    writeFileSync(join(OUT_DIR, 'metrics.json'), `${JSON.stringify(collected, null, 2)}\n`)
    console.log(JSON.stringify({ transcript: collected.transcript.geometry, cssLayoutViewport: collected.transcript.layout.cssLayoutViewport, contentSize: collected.transcript.layout.contentSize }, null, 1))
    page.close()
    return
  }

  if (PROBE) {
    for (const label of PROBE_CLICKS) {
      const hit = await page.eval(clickByLabels([label]))
      if (!hit?.found) {
        console.error(`probe click missed: ${label}`)
        continue
      }
      await press(page, hit)
      await sleep(900)
    }
    const inventory = await page.eval(INVENTORY)
    const text = await page.eval(`(document.body.innerText || '').slice(0, 1200)`)
    const metrics = await page.eval(`({ innerWidth, innerHeight, dpr: devicePixelRatio, scrollH: document.documentElement.scrollHeight })`)
    const extra = process.argv
      .filter((argument) => argument.startsWith('--probe-expr='))
      .map((argument) => page.eval(argument.slice('--probe-expr='.length)))
    const extras = await Promise.all(extra)
    console.log(JSON.stringify({ page: first, metrics, origin, inventory: inventory.filter((row) => row.visible), extras }, null, 1))
    console.error('--- visible text (first 1200 chars, for selector work only) ---')
    console.error(text)
    page.close()
    return
  }

  const originRoot = `${origin}/`
  const records = []
  const selected = ONLY.length ? STATES.filter((spec) => ONLY.includes(spec.state)) : STATES
  for (const spec of selected) {
    const record = {
      state: spec.state,
      file: spec.file,
      width: VIEWPORT.width * DPR,
      height: VIEWPORT.height * DPR,
      dpr: DPR,
      urlOrigin: origin,
      locale: locale.language,
      dshVersion: dshVersion(),
      chromeVersion,
    }
    const startedAt = Date.now()
    try {
      // Every state starts from a fresh document so a toggle cannot leak.
      const ready = await navigate(page, originRoot)
      if (!ready) throw new Error('document never became ready')
      if (VERBOSE) console.error(`${spec.state}: loaded in ${Date.now() - startedAt}ms`)
      await dismissNotice(page)

      const path = []
      if (spec.state === 'transcript') {
        const opened = await openFirstConversation(page)
        if (!opened) throw new Error('no conversation to open')
        path.push(opened)
      }
      for (const step of spec.steps ?? []) path.push(await clickStep(page, step))
      if (path.length) record.clicked = path.join(' → ')
      if (spec.settle) {
        const deadline = Date.now() + (spec.settle.timeoutMs ?? 10_000)
        while (Date.now() < deadline) {
          const state = await page.eval(`(() => ({
            present: ${spec.settle.present ? `Boolean(document.querySelector(${JSON.stringify(spec.settle.present)}))` : 'true'},
            spinner: ${spec.settle.spinner ? `Boolean(document.querySelector(${JSON.stringify(spec.settle.spinner)}))` : 'false'},
          }))()`)
          if (state.present && !state.spinner) break
          await sleep(250)
        }
        await sleep(spec.settle.settleMs ?? 1_200)
        record.settled = true
      }
      if (spec.expect) {
        const present = await page.eval(`Boolean(document.querySelector(${JSON.stringify(spec.expect)}))`)
        if (!present) throw new Error(spec.blockedReason ?? `expected ${spec.expect}`)
      }
      if (spec.expectExpr) {
        const present = await page.eval(spec.expectExpr)
        if (!present) throw new Error(spec.blockedReason ?? 'expected surface missing')
      }
      if (spec.scroll) {
        const scroll = await scrollTo(page, spec.scroll)
        if (scroll?.found) {
          record.scrollTop = scroll.scrollTop
          record.scrollHeight = scroll.scrollHeight
          record.clientHeight = scroll.clientHeight
          record.atEnd = scroll.atEnd
        }
      }
      // Nothing may hover the page while the frame is captured.
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1, buttons: 0 })
      await sleep(900)

      if (VERBOSE) console.error(`${spec.state}: actions settled in ${Date.now() - startedAt}ms`)
      const shot = await screenshot(page, join(OUT_DIR, spec.file))
      record.width = shot.width
      record.height = shot.height
      record.bytes = shot.bytes
      console.log(`captured ${spec.state} ${shot.width}x${shot.height}${record.clicked ? ` via ${record.clicked}` : ''}`)
      for (const step of spec.cleanup ?? []) await clickStep(page, step)
    } catch (error) {
      record.blocked = String(error.message ?? error)
      record.file = null
      // Only a known-unreachable surface may drop its picture; an unexpected
      // failure must not destroy a good capture from an earlier run.
      if (spec.blockedReason) rmSync(join(OUT_DIR, spec.file), { force: true })
      console.error(`blocked ${spec.state}: ${record.blocked}`)
    }
    records.push(record)
  }

  page.close()
  const manifestPath = join(OUT_DIR, 'capture.json')
  let previous = []
  try {
    previous = JSON.parse(readFileSync(manifestPath, 'utf8')).states ?? []
  } catch {
    previous = []
  }
  const merged = new Map(previous.map((row) => [row.state, row]))
  for (const row of records) merged.set(row.state, row)
  const order = STATES.map((spec) => spec.state)
  const ordered = [...merged.values()].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state))
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        viewport: VIEWPORT,
        dpr: DPR,
        urlOrigin: origin,
        chromeVersion,
        locale,
        theme: COLOR_SCHEME,
        screenshotFormat: 'png',
        states: ordered,
      },
      null,
      2,
    )}\n`,
  )
  const blocked = records.filter((row) => row.blocked).length
  console.log(`${records.length - blocked}/${records.length} states captured into ${OUT_DIR}`)
}

const watchdog = setTimeout(() => {
  console.error(`capture exceeded ${HARD_TIMEOUT_MS}ms; giving up so the run cannot hang`)
  process.exit(2)
}, HARD_TIMEOUT_MS)
watchdog.unref()

main().catch((error) => {
  console.error(`capture failed: ${error.message}`)
  process.exit(1)
})
