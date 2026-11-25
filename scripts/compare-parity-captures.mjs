#!/usr/bin/env node
/**
 * compare-parity-captures.mjs
 *
 * Compare the original Remote GUI captures against the native client captures,
 * state by state, and produce the three artefacts a human needs to judge visual
 * parity: a side-by-side pair, a 50/50 overlay, and an amplified difference.
 *
 * It is deliberately conservative. Every capture is probed before it is used,
 * a state that cannot be compared is reported as an error with no score, and a
 * blank or fully transparent capture is refused rather than scored. Nothing in
 * this file guesses a number that the pixels did not produce.
 *
 * Usage (see qa/parity-2026-11-23/README.md for the full guide):
 *
 *   node scripts/compare-parity-captures.mjs
 *   node scripts/compare-parity-captures.mjs --native-crop-top 28
 *   node scripts/compare-parity-captures.mjs --root qa/parity-2026-12-01
 *
 * Exit codes:
 *   0  every state in both manifests was compared
 *   1  the comparison ran, but at least one state failed (see report errors)
 *   2  fatal setup problem: bad options, missing manifest, no ImageMagick
 *
 * No third-party dependencies. ImageMagick 7 (`magick`) must be on PATH, or
 * passed explicitly with --magick.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseArgs } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const execFileAsync = promisify(execFile)

const SCHEMA = 'dsh.parity.compare/1'
const DEFAULT_ROOT = path.join('qa', 'parity-2026-11-23')
const SIDES = ['original', 'native']
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp']

// A uniform capture is a broken capture: a real window always contains text or
// anti-aliasing somewhere. This threshold is intentionally tiny; anything that
// survives it is content, not a rounding artefact.
const BLANK_MEAN_EPSILON = 1e-6

// Surface the tolerant figure so anti-aliasing noise can be separated from a
// genuine layout shift without hiding either.
const TOLERANT_THRESHOLD_PERCENT = 2

const LABEL_BAR_HEIGHT = 26
const LABEL_BACKGROUND = '#0b0f14'
const LABEL_INK = '#c7d2dd'

const HELP = `compare-parity-captures.mjs — pair original/native captures and diff them.

Options:
  --root <dir>              Parity run directory (default: ${DEFAULT_ROOT})
  --original <dir>          Original captures (default: <root>/original)
  --native <dir>            Native captures (default: <root>/native)
  --out <dir>               Artefact directory (default: <root>/diff)
  --report <file>           Markdown report (default: <root>/report.md)
  --json <file>             JSON report (default: <root>/report.json)

  --crop <side:t,r,b,l>     Crop insets in physical pixels; repeatable.
                            side is "original" or "native". Omitted values are 0.
                            Example: --crop native:28,0,0,0
                            An explicit --crop / --*-crop-top wins over the
                            per-state "crop" field in capture.json.
  --native-crop-top <px>    Shorthand for native top inset (default: 0)
  --original-crop-top <px>  Shorthand for original top inset (default: 0)

  --resize-mode <mode>      How to reconcile unequal sizes: min | none |
                            original | native (default: min)
  --max-aspect-drift <r>    Allowed relative aspect difference (default: 0.15)
  --aspect-policy <p>       error | resize | warn (default: error)
  --fuzz <percent>          Difference threshold for the reported diff percent
                            (default: 0, exact)
  --allow-blank             Downgrade blank/all-transparent captures to notes
  --allow-dir-scan          Fall back to reading image filenames when a
                            capture.json is absent
  --state <name[,name]>     Only compare these states; repeatable
  --no-labels               Do not draw captions on the side-by-side image
  --no-diff-auto-level      Do not stretch the difference image
  --keep-work               Keep the normalised intermediates in the temp dir
  --magick <path>           ImageMagick binary (default: magick)
  --quiet                   Only print the final summary line
  --help                    Show this text
`

class FatalError extends Error {
  constructor(message, hint) {
    super(message)
    this.name = 'FatalError'
    this.hint = hint
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const round = (value, digits = 6) => (isFiniteNumber(value) ? Number(value.toFixed(digits)) : value)

const trimError = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, 400)

/**
 * Case- and separator-insensitive view of a manifest record, so a producer can
 * write windowBounds/Width the way the native capture step does without the
 * harness silently ignoring it.
 */
function normaliseKeys(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  const out = Object.create(null)
  for (const [key, value] of Object.entries(record)) {
    out[String(key).toLowerCase().replace(/[\s_-]/g, '')] = value
  }
  return out
}

function numberFromMap(map, keys) {
  for (const key of keys) {
    const raw = map[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (typeof raw === 'string' && raw.trim() !== '') {
      const value = Number(raw)
      if (Number.isFinite(value)) return value
    }
  }
  return null
}

/** First present, non-empty string among the candidate keys. */
function pickString(record, keys) {
  const map = normaliseKeys(record)
  if (!map) return null
  for (const key of keys) {
    const value = map[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}

/** First present finite number among the candidate keys (numbers or numeric strings). */
function pickNumber(record, keys) {
  const map = normaliseKeys(record)
  if (!map) return null
  return numberFromMap(map, keys)
}

/** First present plain object among the candidate keys. */
function pickObject(record, keys) {
  const map = normaliseKeys(record)
  if (!map) return null
  for (const key of keys) {
    const value = map[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  }
  return null
}

const SIZE_CONTAINERS = ['contentbounds', 'contentrect', 'bounds', 'rect', 'size', 'content', 'windowbounds', 'inner']

/**
 * Rectangle-ish metadata. Producers nest the same numbers differently (a flat
 * windowBounds, or window.contentBounds), so descend one or two levels instead
 * of dropping the metadata on the floor.
 */
function readSize(record, depth = 0) {
  const map = normaliseKeys(record)
  if (!map) return null
  const width = numberFromMap(map, ['width', 'w', 'innerwidth'])
  const height = numberFromMap(map, ['height', 'h', 'innerheight'])
  if ((width === null || height === null) && depth < 2) {
    for (const key of SIZE_CONTAINERS) {
      const nested = map[key]
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const size = readSize(nested, depth + 1)
        if (size) return size
      }
    }
  }
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) return null
  return {
    width,
    height,
    x: numberFromMap(map, ['x', 'left', 'originx']),
    y: numberFromMap(map, ['y', 'top', 'originy']),
  }
}

const relativePath = (target) => {
  const absolute = path.resolve(target)
  const rel = path.relative(process.cwd(), absolute)
  // Keep repo-relative paths readable, but never print ../../.. chains.
  if (rel === '') return '.'
  if (rel.startsWith('..')) return absolute.split(path.sep).join('/')
  return rel.split(path.sep).join('/')
}

/** Filename-safe rendering of a state name; the report keeps the original. */
function sanitizeState(state) {
  const cleaned = String(state).trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned === '' ? 'state' : cleaned.slice(0, 120)
}

const escapeTable = (value) => String(value).replace(/\|/g, '\\|')

function formatPercent(value, digits = 3) {
  if (!isFiniteNumber(value)) return '—'
  if (value === 0) return '0'
  if (value < 0.001) return value.toExponential(2)
  return `${value.toFixed(digits)}`
}

function formatRatio(value) {
  return isFiniteNumber(value) ? value.toFixed(6) : '—'
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

function numberOption(values, key, fallback, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const raw = values[key]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new FatalError(`--${key} expects a number, got "${raw}"`)
  if (integer && !Number.isInteger(value)) throw new FatalError(`--${key} expects an integer, got "${raw}"`)
  if (value < min || value > max) {
    throw new FatalError(`--${key} expects a value in [${min}, ${max}], got "${raw}"`)
  }
  return value
}

function emptyInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 }
}

/**
 * Parse one --crop value. Accepted forms:
 *   native:28            top only
 *   native:28,4          top,right
 *   native:28,4,8        top,right,bottom
 *   native:28,4,8,12     top,right,bottom,left
 *   native=28,4,8,12     same, with "="
 */
function parseCropSpec(spec, crops) {
  const text = String(spec).trim()
  const match = text.match(/^(original|native)\s*[:=]\s*(.*)$/i)
  if (!match) {
    throw new FatalError(
      `--crop "${spec}" is not understood; expected <side:top[,right[,bottom[,left]]]> with side original|native`,
    )
  }
  const side = match[1].toLowerCase()
  const parts = match[2].split(',').map((part) => part.trim())
  if (parts.length === 0 || parts.length > 4 || parts.some((part) => part === '')) {
    throw new FatalError(`--crop "${spec}" needs 1 to 4 comma separated pixel values`)
  }
  const numbers = parts.map((part) => {
    const value = Number(part)
    if (!Number.isInteger(value) || value < 0) {
      throw new FatalError(`--crop "${spec}" contains "${part}", which is not a non-negative integer`)
    }
    return value
  })
  const [top = 0, right = 0, bottom = 0, left = 0] = numbers
  crops[side] = { top, right, bottom, left }
}

function parseOptions(argv) {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        root: { type: 'string' },
        original: { type: 'string' },
        native: { type: 'string' },
        out: { type: 'string' },
        report: { type: 'string' },
        json: { type: 'string' },
        crop: { type: 'string', multiple: true, default: [] },
        'native-crop-top': { type: 'string' },
        'original-crop-top': { type: 'string' },
        'resize-mode': { type: 'string' },
        'max-aspect-drift': { type: 'string' },
        'aspect-policy': { type: 'string' },
        fuzz: { type: 'string' },
        'allow-blank': { type: 'boolean', default: false },
        'allow-dir-scan': { type: 'boolean', default: false },
        state: { type: 'string', multiple: true, default: [] },
        'no-labels': { type: 'boolean', default: false },
        'no-diff-auto-level': { type: 'boolean', default: false },
        'keep-work': { type: 'boolean', default: false },
        magick: { type: 'string' },
        quiet: { type: 'boolean', short: 'q', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }))
  } catch (error) {
    throw new FatalError(`invalid arguments: ${error.message}`, 'Run with --help for the accepted options.')
  }

  if (values.help) return { help: true }

  const resizeMode = (values['resize-mode'] ?? 'min').toLowerCase()
  if (!['min', 'none', 'original', 'native'].includes(resizeMode)) {
    throw new FatalError(`--resize-mode must be min, none, original or native, got "${values['resize-mode']}"`)
  }
  const aspectPolicy = (values['aspect-policy'] ?? 'error').toLowerCase()
  if (!['error', 'resize', 'warn'].includes(aspectPolicy)) {
    throw new FatalError(`--aspect-policy must be error, resize or warn, got "${values['aspect-policy']}"`)
  }

  const rootDir = path.resolve(values.root ?? DEFAULT_ROOT)
  const crops = { original: emptyInsets(), native: emptyInsets() }
  const cropsExplicit = { original: false, native: false }
  for (const spec of values.crop) {
    parseCropSpec(spec, crops)
    cropsExplicit[spec.trim().split(/[:=]/)[0].trim().toLowerCase()] = true
  }

  // The explicit insets win over --crop so the common case stays a single flag.
  const nativeTop = numberOption(values, 'native-crop-top', null, { min: 0, integer: true })
  if (nativeTop !== null) {
    crops.native.top = nativeTop
    cropsExplicit.native = true
  }
  const originalTop = numberOption(values, 'original-crop-top', null, { min: 0, integer: true })
  if (originalTop !== null) {
    crops.original.top = originalTop
    cropsExplicit.original = true
  }

  const requestedStates = values.state
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')

  return {
    help: false,
    cwd: process.cwd(),
    rootDir,
    originalDir: path.resolve(values.original ?? path.join(rootDir, 'original')),
    nativeDir: path.resolve(values.native ?? path.join(rootDir, 'native')),
    outDir: path.resolve(values.out ?? path.join(rootDir, 'diff')),
    reportPath: path.resolve(values.report ?? path.join(rootDir, 'report.md')),
    jsonPath: path.resolve(values.json ?? path.join(rootDir, 'report.json')),
    crops,
    cropsExplicit,
    resizeMode,
    maxAspectDrift: numberOption(values, 'max-aspect-drift', 0.15, { min: 0, max: 1 }),
    aspectPolicy,
    fuzz: numberOption(values, 'fuzz', 0, { min: 0, max: 100 }),
    allowBlank: values['allow-blank'],
    allowDirScan: values['allow-dir-scan'],
    requestedStates,
    labels: !values['no-labels'],
    diffAutoLevel: !values['no-diff-auto-level'],
    keepWork: values['keep-work'],
    magickBin: values.magick ?? 'magick',
    quiet: values.quiet,
  }
}

// ---------------------------------------------------------------------------
// ImageMagick
// ---------------------------------------------------------------------------

function createMagick(bin) {
  /**
   * Run magick without throwing on ordinary non-zero exits; compare exits 1
   * when the images differ, which is a normal result, not a failure.
   */
  async function run(args) {
    try {
      const { stdout, stderr } = await execFileAsync(bin, args, { maxBuffer: 16 * 1024 * 1024 })
      return { code: 0, stdout, stderr }
    } catch (error) {
      const code = typeof error.code === 'number' ? error.code : -1
      return { code, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error.message ?? error) }
    }
  }

  async function must(args, { allowExit = [0], label = 'magick' } = {}) {
    const result = await run(args)
    if (!allowExit.includes(result.code)) {
      throw new Error(`${label} failed (exit ${result.code}): ${trimError(result.stderr) || 'no stderr'}`)
    }
    return result
  }

  async function version() {
    const result = await run(['-version'])
    if (result.code !== 0) {
      throw new FatalError(
        `ImageMagick could not be executed as "${bin}"`,
        'Install ImageMagick 7 (brew install imagemagick) or pass --magick <path>.',
      )
    }
    const firstLine = String(result.stdout).split('\n')[0].trim()
    return firstLine || 'ImageMagick (version unknown)'
  }

  return { run, must, version }
}

/**
 * Read the properties the comparison depends on. Anything unexpected is an
 * error: a capture that cannot be probed must not silently enter a score.
 */
async function probeImage(magick, file) {
  const info = await magick.run(['identify', '-format', '%w\t%h\t%[channels]\t%[opaque]', file])
  if (info.code !== 0) {
    throw Object.assign(new Error(`unreadable image (${trimError(info.stderr)})`), { code: 'image-unreadable' })
  }
  const [widthRaw, heightRaw, channelsRaw, opaqueRaw] = String(info.stdout).trim().split('\t')
  const width = Number(widthRaw)
  const height = Number(heightRaw)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw Object.assign(new Error(`identify returned an invalid size "${widthRaw}x${heightRaw}"`), {
      code: 'image-unreadable',
    })
  }

  // The mean must exclude alpha: a fully black but opaque RGBA capture would
  // otherwise average to 0.25 and slip past the blank check.
  const meanRun = await magick.run([file, '-alpha', 'off', '-format', '%[fx:mean]', 'info:'])
  if (meanRun.code !== 0) {
    throw Object.assign(new Error(`cannot read pixel mean (${trimError(meanRun.stderr)})`), { code: 'image-unreadable' })
  }
  const mean = Number(String(meanRun.stdout).trim())

  let alphaMean = null
  if (String(opaqueRaw).trim().toLowerCase() === 'false') {
    const alpha = await magick.run(['identify', '-alpha', 'extract', '-format', '%[fx:mean]', file])
    if (alpha.code === 0) alphaMean = Number(String(alpha.stdout).trim())
  }

  return {
    width,
    height,
    channels: String(channelsRaw ?? '').trim(),
    opaque: String(opaqueRaw).trim().toLowerCase() !== 'false',
    mean: Number.isFinite(mean) ? mean : null,
    alphaMean: Number.isFinite(alphaMean) ? alphaMean : null,
  }
}

/** Parse "1234.5 (0.0188412)" from compare's stderr. */
function parseCompareMetric(stderr) {
  const text = String(stderr ?? '')
  const match = text.match(/(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\(\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\)/)
  if (!match) return null
  const absolute = Number(match[1])
  const normalized = Number(match[2])
  if (!Number.isFinite(absolute) || !Number.isFinite(normalized)) return null
  return { absolute, normalized }
}

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------

// Key lists are matched against the normalised (lowercase, separator-free)
// record, so 'windowBounds', 'window_bounds' and 'windowbounds' are one key.
const STATE_KEYS = ['state', 'name', 'id', 'key', 'slug', 'label', 'screen']
const FILE_KEYS = ['file', 'path', 'image', 'png', 'screenshot', 'capture', 'filename', 'src']
const DPR_KEYS = ['dpr', 'scale', 'scalefactor', 'devicepixelratio', 'pixelratio', 'backingscalefactor']
const WINDOW_KEYS = ['window', 'windowrect', 'windowframe', 'windowbounds', 'frame', 'bounds', 'screenframe']
const CONTENT_KEYS = ['content', 'contentrect', 'contentsize', 'contentarea', 'contentbounds', 'viewport', 'inner']
const CHROME_KEYS = ['chrometop', 'topchrome', 'chrome', 'titlebarheight']
const CROP_KEYS = ['crop', 'insets', 'cropinsets']
const PIXEL_SIZE_KEYS = ['width', 'pixelwidth', 'physicalwidth']
const PROVENANCE_KEYS = ['capturedat', 'client', 'binary', 'binarysha', 'theme', 'mode', 'home', 'capture', 'privacy']

/**
 * When a producer records the physical pixel size and the logical window frame
 * but no DPR, derive it rather than guessing: only accept a ratio that matches a
 * common backing scale on both axes.
 */
function inferDpr(rawEntry) {
  if (pickNumber(rawEntry, DPR_KEYS) !== null) return null
  const map = normaliseKeys(rawEntry)
  const pixelWidth = numberFromMap(map, PIXEL_SIZE_KEYS)
  const pixelHeight = numberFromMap(map, ['height', 'pixelheight', 'physicalheight'])
  const windowSize = readSize(pickObject(rawEntry, WINDOW_KEYS))
  if (!pixelWidth || !pixelHeight || !windowSize) return null
  const widthRatio = pixelWidth / windowSize.width
  const heightRatio = pixelHeight / windowSize.height
  const scale = [1, 1.25, 1.5, 2, 2.5, 3].find(
    (candidate) =>
      Math.abs(widthRatio - candidate) / candidate <= 0.015 &&
      Math.abs(heightRatio - candidate) / candidate <= 0.015,
  )
  return scale ?? null
}

/** Manifest-level facts worth keeping: they tie a report to a build. */
function readProvenance(parsed) {
  const map = normaliseKeys(parsed)
  if (!map) return null
  const provenance = {}
  for (const key of PROVENANCE_KEYS) {
    if (map[key] !== undefined) provenance[key] = map[key]
  }
  return Object.keys(provenance).length > 0 ? provenance : null
}

/** Per-capture crop: either {"crop":{"top":28,...}} or {"cropTop":28}. */
function readEntryInsets(rawEntry) {
  const record = pickObject(rawEntry, CROP_KEYS)
  const insets = emptyInsets()
  let declared = false
  if (record) {
    for (const key of ['top', 'right', 'bottom', 'left']) {
      const value = pickNumber(record, [key])
      if (value !== null) {
        if (value < 0 || !Number.isInteger(value)) return null
        insets[key] = value
        declared = true
      }
    }
  }
  const top = pickNumber(rawEntry, ['cropTop', 'crop_top'])
  if (top !== null) {
    if (top < 0 || !Number.isInteger(top)) return null
    insets.top = top
    declared = true
  }
  return declared ? insets : null
}

function extractCaptureList(parsed, manifestPath) {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    for (const key of ['captures', 'states', 'items', 'entries', 'results', 'screenshots', 'shots']) {
      if (Array.isArray(parsed[key])) return parsed[key]
    }
    // A plain map of state -> capture is also a reasonable hand-written input.
    const values = Object.values(parsed)
    if (values.length > 0 && values.every((value) => value && typeof value === 'object' && !Array.isArray(value))) {
      return Object.entries(parsed).map(([state, value]) => ({ ...value, state }))
    }
  }
  throw new FatalError(
    `${manifestPath} does not contain a capture list`,
    'Expected an array, or an object with one of: captures, states, items, entries, results.',
  )
}

async function listImages(dir) {
  let names
  try {
    names = await fs.readdir(dir)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw new FatalError(`cannot read directory ${dir}: ${error.message}`)
  }
  return names
    .filter((name) => IMAGE_EXTENSIONS.includes(path.extname(name).toLowerCase()))
    .sort()
    .map((name) => path.join(dir, name))
}

async function fileExists(target) {
  try {
    const stats = await fs.stat(target)
    return stats.isFile()
  } catch {
    return false
  }
}

async function guessImageFile(dir, state) {
  for (const extension of IMAGE_EXTENSIONS) {
    const candidate = path.join(dir, `${state}${extension}`)
    if (await fileExists(candidate)) return candidate
  }
  return null
}

/**
 * Read one side's manifest. Missing manifests are fatal unless the caller
 * explicitly opted into filename scanning, because "no manifest" almost always
 * means "the capture step never ran" rather than "the captures are fine".
 */
async function readCaptureSet(side, dir, options) {
  const manifestPath = path.join(dir, 'capture.json')
  const result = {
    side,
    dir,
    manifestPath,
    manifestPresent: false,
    scannedDirectory: false,
    duplicateStates: new Set(),
    provenance: null,
    unreferencedImages: [],
    imageFilesOnDisk: 0,
    entries: new Map(),
    order: [],
    declaredCount: 0,
    notes: [],
  }

  let raw
  try {
    raw = await fs.readFile(manifestPath, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new FatalError(`cannot read ${manifestPath}: ${error.message}`)
    }
    if (!options.allowDirScan) {
      throw new FatalError(
        `missing capture manifest: ${relativePath(manifestPath)}`,
        `Write ${relativePath(manifestPath)} (see the README for the format), or pass --allow-dir-scan to derive states from image filenames.`,
      )
    }
    const files = await listImages(dir)
    if (files.length === 0) {
      throw new FatalError(
        `no captures for "${side}": neither ${relativePath(manifestPath)} nor any image in ${relativePath(dir)} exists`,
        'Run the capture step first, or point --original/--native at the right directory.',
      )
    }
    for (const file of files) {
      const state = path.basename(file, path.extname(file))
      result.entries.set(state, {
        state,
        file,
        dpr: null,
        window: null,
        content: null,
        chromeTop: null,
        raw: null,
      })
      result.order.push(state)
    }
    result.scannedDirectory = true
    result.declaredCount = files.length
    result.imageFilesOnDisk = files.length
    result.notes.push(`capture.json absent; ${files.length} states derived from image filenames`)
    return result
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new FatalError(`${relativePath(manifestPath)} is not valid JSON: ${error.message}`)
  }

  const list = extractCaptureList(parsed, relativePath(manifestPath))
  if (list.length === 0) {
    throw new FatalError(
      `${relativePath(manifestPath)} declares no captures`,
      'An empty manifest is a failed capture step, not an empty comparison.',
    )
  }

  result.manifestPresent = true
  result.declaredCount = list.length
  result.provenance = readProvenance(parsed)

  for (const [index, rawEntry] of list.entries()) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      throw new FatalError(`${relativePath(manifestPath)}: capture #${index} is not an object`)
    }
    const state = pickString(rawEntry, STATE_KEYS)
    if (!state) {
      throw new FatalError(
        `${relativePath(manifestPath)}: capture #${index} has no state name (one of ${STATE_KEYS.join(', ')})`,
      )
    }
    if (result.entries.has(state)) {
      // A producer that appends on retry must not abort the whole run, but the
      // state is genuinely ambiguous, so it gets an error and no score.
      result.duplicateStates.add(state)
      continue
    }
    const fileValue = pickString(rawEntry, FILE_KEYS)
    const file = fileValue ? path.resolve(dir, fileValue) : null
    result.entries.set(state, {
      state,
      file,
      dpr: pickNumber(rawEntry, DPR_KEYS),
      dprInferred: inferDpr(rawEntry),
      pixelSize: (() => {
        const map = normaliseKeys(rawEntry)
        const width = numberFromMap(map, PIXEL_SIZE_KEYS)
        const height = numberFromMap(map, ['height', 'pixelheight', 'physicalheight'])
        return isFiniteNumber(width) && isFiniteNumber(height) ? { width, height } : null
      })(),
      window: readSize(pickObject(rawEntry, WINDOW_KEYS)),
      content: readSize(pickObject(rawEntry, CONTENT_KEYS)),
      chromeTop: pickNumber(rawEntry, CHROME_KEYS),
      crop: readEntryInsets(rawEntry),
      raw: rawEntry,
    })
    result.order.push(state)
  }

  // A manifest that lags behind the capture directory would silently compare
  // fewer states than were captured; call that out instead of looking green.
  const imagesOnDisk = await listImages(dir)
  result.imageFilesOnDisk = imagesOnDisk.length
  const referenced = new Set([...result.entries.values()].filter((entry) => entry.file).map((entry) => path.resolve(entry.file)))
  result.unreferencedImages = imagesOnDisk
    .filter((file) => !referenced.has(path.resolve(file)))
    .map((file) => path.basename(file))

  return result
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function validateInsets(insets, dims, side) {
  const width = dims.width - insets.left - insets.right
  const height = dims.height - insets.top - insets.bottom
  if (width < 16 || height < 16) {
    const error = new Error(
      `cropping ${side} by top=${insets.top} right=${insets.right} bottom=${insets.bottom} left=${insets.left} leaves ${width}x${height}, which is not comparable`,
    )
    error.code = 'crop-out-of-bounds'
    throw error
  }
  return { width, height }
}

async function applyCrop(magick, file, insets, dims, target) {
  const cropped = validateInsets(insets, dims, 'image')
  const args = [
    file,
    '-crop',
    `${cropped.width}x${cropped.height}+${insets.left}+${insets.top}`,
    '+repage',
    target,
  ]
  await magick.must(args, { label: 'crop' })
  return { file: target, width: cropped.width, height: cropped.height }
}

async function applyResize(magick, file, target, size) {
  await magick.must(
    [file, '-filter', 'Lanczos', '-resize', `${size.width}x${size.height}!`, '-strip', target],
    { label: 'resize' },
  )
  return { file: target, width: size.width, height: size.height }
}

// ---------------------------------------------------------------------------
// Artefacts
// ---------------------------------------------------------------------------

function labelArguments(text) {
  return [
    '-gravity',
    'north',
    '-background',
    LABEL_BACKGROUND,
    '-splice',
    `0x${LABEL_BAR_HEIGHT}`,
    '-fill',
    LABEL_INK,
    '-pointsize',
    '14',
    '-annotate',
    '+0+7',
    text,
  ]
}

async function writeSideBySide(magick, leftPath, rightPath, outPath, labels) {
  if (labels) {
    const labeled = await magick.run([
      '(',
      leftPath,
      ...labelArguments('original'),
      ')',
      '(',
      rightPath,
      ...labelArguments('native'),
      ')',
      '+append',
      outPath,
    ])
    if (labeled.code === 0) return { labeled: true, warning: null }
    const warning = `caption rendering failed, wrote an uncaptioned pair: ${trimError(labeled.stderr)}`
    await fs.rm(outPath, { force: true })
    const plain = await magick.run([leftPath, rightPath, '+append', outPath])
    if (plain.code !== 0) {
      throw Object.assign(new Error(`side-by-side failed: ${trimError(plain.stderr)}`), { code: 'render-failed' })
    }
    return { labeled: false, warning }
  }
  const plain = await magick.run([leftPath, rightPath, '+append', outPath])
  if (plain.code !== 0) {
    throw Object.assign(new Error(`side-by-side failed: ${trimError(plain.stderr)}`), { code: 'render-failed' })
  }
  return { labeled: false, warning: null }
}

async function writeOverlay(magick, leftPath, rightPath, outPath) {
  const result = await magick.run([leftPath, rightPath, '-evaluate-sequence', 'mean', outPath])
  if (result.code !== 0) {
    throw Object.assign(new Error(`overlay failed: ${trimError(result.stderr)}`), { code: 'render-failed' })
  }
}

async function writeDifference(magick, leftPath, rightPath, outPath, { width, height, autoLevel, empty }) {
  if (empty) {
    // Everything matches: an auto-levelled difference of two identical images
    // is meaningless, so state "no difference" explicitly.
    const black = await magick.run(['-size', `${width}x${height}`, 'xc:black', outPath])
    if (black.code !== 0) {
      throw Object.assign(new Error(`difference failed: ${trimError(black.stderr)}`), { code: 'render-failed' })
    }
    return
  }
  const args = [
    '(',
    leftPath,
    '-alpha',
    'off',
    ')',
    '(',
    rightPath,
    '-alpha',
    'off',
    ')',
    '-compose',
    'difference',
    '-composite',
  ]
  if (autoLevel) args.push('-auto-level')
  args.push(outPath)
  const result = await magick.run(args)
  if (result.code !== 0) {
    throw Object.assign(new Error(`difference failed: ${trimError(result.stderr)}`), { code: 'render-failed' })
  }
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

async function readMetrics(magick, leftPath, rightPath, { width, height, fuzz }) {
  const rmseRun = await magick.run(['compare', '-metric', 'RMSE', leftPath, rightPath, 'null:'])
  if (rmseRun.code !== 0 && rmseRun.code !== 1) {
    throw Object.assign(new Error(`compare RMSE failed: ${trimError(rmseRun.stderr)}`), { code: 'metric-failed' })
  }
  const rmse = parseCompareMetric(rmseRun.stderr)
  if (!rmse) {
    throw Object.assign(new Error(`could not parse the RMSE metric from "${trimError(rmseRun.stderr)}"`), {
      code: 'metric-failed',
    })
  }

  // Diff pixel counts come from a thresholded difference image rather than
  // `compare -metric AE`, because AE reports a fractional value under
  // Q16-HDRI builds and a pixel count must be exact.
  const countDiff = async (threshold) => {
    const level = threshold === 0 ? '0' : `${threshold}%`
    const run = await magick.run([
      '(',
      leftPath,
      '-alpha',
      'off',
      ')',
      '(',
      rightPath,
      '-alpha',
      'off',
      ')',
      '-compose',
      'difference',
      '-composite',
      '-colorspace',
      'gray',
      '-threshold',
      level,
      '-format',
      '%[fx:mean]',
      'info:',
    ])
    if (run.code !== 0) {
      throw Object.assign(new Error(`difference counting failed: ${trimError(run.stderr)}`), {
        code: 'metric-failed',
      })
    }
    const fraction = Number(String(run.stdout).trim())
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
      throw Object.assign(new Error(`difference fraction out of range: "${trimError(run.stdout)}"`), {
        code: 'metric-failed',
      })
    }
    const pixels = Math.round(fraction * width * height)
    return { fraction, pixels, percent: fraction * 100 }
  }

  const exact = await countDiff(fuzz)
  const tolerant = TOLERANT_THRESHOLD_PERCENT === fuzz ? exact : await countDiff(TOLERANT_THRESHOLD_PERCENT)

  return {
    rmse: {
      absolute: round(rmse.absolute, 4),
      normalized: round(rmse.normalized),
      percent: round(rmse.normalized * 100, 4),
      raw: trimError(rmseRun.stderr),
    },
    diff: {
      fuzzPercent: fuzz,
      pixels: exact.pixels,
      percent: round(exact.percent, 4),
      fraction: round(exact.fraction),
      totalPixels: width * height,
    },
    tolerant: {
      thresholdPercent: TOLERANT_THRESHOLD_PERCENT,
      pixels: tolerant.pixels,
      percent: round(tolerant.percent, 4),
    },
  }
}

/**
 * A documented heuristic bucket so a reader can triage without pretending the
 * bucket is an acceptance verdict. Thresholds live here and in the README.
 */
function diffBand(percent) {
  if (!isFiniteNumber(percent)) return null
  if (percent <= 0.25) return 'negligible'
  if (percent <= 1) return 'minor'
  if (percent <= 4) return 'noticeable'
  return 'major'
}

// ---------------------------------------------------------------------------
// Per-state comparison
// ---------------------------------------------------------------------------

async function inspectSide(side, entry, ctx, state, errors) {
  const { options, magick, captureSet } = ctx
  const dir = captureSet.dir

  if (!entry) {
    errors.push({
      code: 'counterpart-missing',
      side,
      message: `${side}/capture.json does not declare state "${state}"`,
    })
    return null
  }

  let file = entry.file
  if (!file) {
    file = await guessImageFile(dir, state)
    if (file) {
      errors.push({
        code: 'file-inferred',
        severity: 'info',
        side,
        message: `${side} entry has no file field; resolved ${relativePath(file)} from the state name`,
      })
    }
  }
  if (!file) {
    errors.push({
      code: 'image-missing',
      side,
      message: `${side} capture for "${state}" has no image (looked for ${IMAGE_EXTENSIONS.map((ext) => `${state}${ext}`).join(', ')} in ${relativePath(dir)})`,
    })
    return null
  }

  let stats
  try {
    stats = await fs.stat(file)
  } catch (error) {
    errors.push({
      code: 'image-missing',
      side,
      message: `${side} image ${relativePath(file)} cannot be read: ${error.code ?? error.message}`,
    })
    return null
  }
  if (!stats.isFile() || stats.size === 0) {
    errors.push({
      code: 'image-empty',
      side,
      message: `${side} image ${relativePath(file)} is ${stats.isFile() ? 'zero bytes' : 'not a regular file'}`,
    })
    return null
  }

  let probe
  try {
    probe = await probeImage(magick, file)
  } catch (error) {
    errors.push({ code: error.code ?? 'image-unreadable', side, message: `${side} image ${relativePath(file)}: ${error.message}` })
    return null
  }

  if (!options.allowBlank) {
    if (probe.opaque === false && isFiniteNumber(probe.alphaMean) && probe.alphaMean <= BLANK_MEAN_EPSILON) {
      errors.push({
        code: 'image-transparent',
        side,
        message: `${side} image ${relativePath(file)} is fully transparent (alpha mean ${probe.alphaMean})`,
      })
      return null
    }
    if (isFiniteNumber(probe.mean) && probe.mean <= BLANK_MEAN_EPSILON) {
      errors.push({
        code: 'image-blank',
        side,
        message: `${side} image ${relativePath(file)} is uniformly black (mean ${probe.mean}); the capture step most likely failed`,
      })
      return null
    }
  }

  return {
    state,
    side,
    dir,
    file,
    bytes: stats.size,
    declared: {
      file: entry.file ? relativePath(entry.file) : null,
      dpr: entry.dpr ?? null,
      dprInferred: entry.dprInferred ?? null,
      pixelSize: entry.pixelSize ?? null,
      window: entry.window ?? null,
      content: entry.content ?? null,
      chromeTop: entry.chromeTop ?? null,
    },
    probe,
    insets: options.cropsExplicit[side] ? options.crops[side] : (entry.crop ?? options.crops[side]),
    workFile: null,
    workSize: { width: probe.width, height: probe.height },
  }
}

function normalizationNotes(sides) {
  const notes = []
  const [a, b] = sides
  const declaredA = a.declared.dpr
  const declaredB = b.declared.dpr
  const inferredA = a.declared.dprInferred
  const inferredB = b.declared.dprInferred
  if (declaredA !== null && declaredB !== null && declaredA !== declaredB) {
    notes.push(
      `declared DPR differs (original ${declaredA}, native ${declaredB}); physical pixels were compared as-is, no DPR resampling`,
    )
  } else if (declaredA !== declaredB) {
    notes.push(
      `declared DPR is one-sided (original ${declaredA ?? 'unset'}, native ${declaredB ?? 'unset'}); physical pixels were compared as-is`,
    )
  }
  if (declaredA === null && declaredB === null && (inferredA !== null || inferredB !== null)) {
    notes.push(
      `no DPR declared; inferred original ${inferredA ?? 'unknown'}, native ${inferredB ?? 'unknown'} from pixel size over the window frame`,
    )
  } else if (inferredA !== null && inferredB !== null && inferredA !== inferredB) {
    notes.push(`inferred DPR differs (original ${inferredA}, native ${inferredB}); physical pixels were compared as-is`)
  }
  if (a.declared.content && b.declared.content) {
    const dw = a.declared.content.width - b.declared.content.width
    const dh = a.declared.content.height - b.declared.content.height
    if (Math.abs(dw) >= 1 || Math.abs(dh) >= 1) {
      notes.push(
        `declared content areas differ: original ${a.declared.content.width}x${a.declared.content.height} vs native ${b.declared.content.width}x${b.declared.content.height} (original minus native: ${dw}x${dh})`,
      )
    }
  }
  if (a.declared.window && b.declared.window) {
    const dw = a.declared.window.width - b.declared.window.width
    const dh = a.declared.window.height - b.declared.window.height
    if (Math.abs(dw) >= 1 || Math.abs(dh) >= 1) {
      notes.push(
        `declared window frames differ: original ${a.declared.window.width}x${a.declared.window.height} vs native ${b.declared.window.width}x${b.declared.window.height} (original minus native: ${dw}x${dh})`,
      )
    }
  }
  for (const side of sides) {
    const declaredChrome = side.declared.chromeTop
    if (isFiniteNumber(declaredChrome) && declaredChrome > 0 && side.insets.top === 0) {
      notes.push(
        `${side.side} declares ${declaredChrome}px of window chrome at the top; pass --${side.side}-crop-top ${declaredChrome} if the chrome is in the image`,
      )
    }
  }
  return notes
}

async function compareState(state, ctx) {
  const { options, magick, captureSets, stateDir } = ctx
  const errors = []
  const result = {
    state,
    status: 'error',
    errors,
    notes: [],
    original: null,
    native: null,
    normalization: null,
    outputs: null,
    metrics: null,
    diffBand: null,
  }

  const inspected = []
  for (const side of SIDES) {
    const entry = captureSets[side].entries.get(state)
    const inspectedSide = await inspectSide(side, entry, { options, magick, captureSet: captureSets[side] }, state, errors)
    if (inspectedSide) inspected.push(inspectedSide)
    result[side] = inspectedSide
      ? {
          file: relativePath(inspectedSide.file),
          bytes: inspectedSide.bytes,
          declared: inspectedSide.declared,
          probed: inspectedSide.probe,
        }
      : null
  }

  const duplicateSides = SIDES.filter((side) => captureSets[side].duplicateStates.has(state))
  if (duplicateSides.length > 0) {
    errors.push({
      code: 'duplicate-state',
      message: `${duplicateSides.join(' and ')} capture.json declares state "${state}" more than once; the first entry was kept and this state is not scored`,
    })
  }

  const fatalForState = errors.some((error) => error.severity !== 'info')
  result.notes.push(
    ...normalizationNotes(
      SIDES.map((side) => {
        const entry = captureSets[side].entries.get(state)
        return {
          side,
          declared: {
            dpr: entry?.dpr ?? null,
            dprInferred: entry?.dprInferred ?? null,
            window: entry?.window ?? null,
            content: entry?.content ?? null,
            chromeTop: entry?.chromeTop ?? null,
          },
          insets: options.crops[side],
        }
      }),
    ),
  )

  if (fatalForState || inspected.length !== 2) {
    result.status = 'error'
    return result
  }

  const [left, right] = inspected // original, native
  const normalization = {
    crop: { original: left.insets, native: right.insets },
    cropped: { original: false, native: false },
    sizeMismatch: false,
    aspectDrift: null,
    resize: { applied: false, mode: options.resizeMode, target: null, scale: { original: null, native: null } },
    dpr: {
      original: left.declared.dpr,
      native: right.declared.dpr,
      mismatch: left.declared.dpr !== right.declared.dpr,
    },
  }
  result.normalization = normalization

  try {
    // 1. Crop chrome away before any size reasoning; the insets are explicit.
    for (const side of [left, right]) {
      const cropped = validateInsets(side.insets, side.workSize, side.side)
      if (side.insets.top || side.insets.right || side.insets.bottom || side.insets.left) {
        const target = path.join(stateDir, `${side.side}-cropped.png`)
        const written = await applyCrop(magick, side.file, side.insets, side.workSize, target)
        side.workFile = written.file
        side.workSize = { width: written.width, height: written.height }
        normalization.cropped[side.side] = true
        result.notes.push(
          `cropped ${side.side} by top=${side.insets.top} right=${side.insets.right} bottom=${side.insets.bottom} left=${side.insets.left} -> ${cropped.width}x${cropped.height}`,
        )
      } else {
        side.workFile = side.file
      }
    }

    // 2. Reconcile sizes. Aspect drift is checked first: silently squashing a
    //    4:3 capture into a 16:9 one produces a number that means nothing.
    const a = left.workSize
    const b = right.workSize
    normalization.sizeMismatch = a.width !== b.width || a.height !== b.height

    let target = { width: a.width, height: a.height }
    if (normalization.sizeMismatch) {
      const aspectDrift = Math.abs(a.width / a.height - b.width / b.height) / Math.max(a.width / a.height, b.width / b.height)
      normalization.aspectDrift = round(aspectDrift, 4)
      result.notes.push(
        `physical size mismatch: original ${a.width}x${a.height}, native ${b.width}x${b.height}; aspect drift ${(aspectDrift * 100).toFixed(3)}%`,
      )
      if (aspectDrift > options.maxAspectDrift) {
        const message = `aspect drift ${(aspectDrift * 100).toFixed(2)}% exceeds --max-aspect-drift ${(options.maxAspectDrift * 100).toFixed(2)}%; the captures do not show the same content`
        if (options.aspectPolicy === 'error') {
          const error = new Error(message)
          error.code = 'aspect-mismatch'
          throw error
        }
        result.notes.push(`${options.aspectPolicy === 'warn' ? 'warning' : 'policy resize'}: ${message}`)
      }

      switch (options.resizeMode) {
        case 'none': {
          const error = new Error(
            `sizes differ (${a.width}x${a.height} vs ${b.width}x${b.height}) and --resize-mode none forbids normalising`,
          )
          error.code = 'size-mismatch'
          throw error
        }
        case 'original':
          target = { width: a.width, height: a.height }
          break
        case 'native':
          target = { width: b.width, height: b.height }
          break
        case 'min':
        default:
          target = { width: Math.min(a.width, b.width), height: Math.min(a.height, b.height) }
          break
      }

      if (target.width < 16 || target.height < 16) {
        const error = new Error(`normalised size ${target.width}x${target.height} is too small to compare`)
        error.code = 'degenerate-size'
        throw error
      }

      for (const side of [left, right]) {
        const sourceSize = side.workSize
        const scale = { x: target.width / sourceSize.width, y: target.height / sourceSize.height }
        normalization.resize.scale[side.side] = { x: round(scale.x, 4), y: round(scale.y, 4) }
        if (sourceSize.width === target.width && sourceSize.height === target.height) continue
        const output = path.join(stateDir, `${side.side}-normalized.png`)
        const written = await applyResize(magick, side.workFile, output, target)
        side.workFile = written.file
        side.workSize = target
      }
      normalization.resize.applied = true
      normalization.resize.target = target
      result.notes.push(
        `resized both sides to ${target.width}x${target.height} (mode ${options.resizeMode}); one side was ${a.width}x${a.height}, the other ${b.width}x${b.height}`,
      )
    } else {
      result.notes.push(`sizes already agree at ${a.width}x${a.height}; no resize`)
    }

    const size = normalization.sizeMismatch ? normalization.resize.target : a
    const leftPath = left.workFile
    const rightPath = right.workFile

    // 3. Metrics, then artefacts. A state without metrics must not ship images
    //    that look like a result, so metrics come first.
    result.metrics = await readMetrics(magick, leftPath, rightPath, {
      width: size.width,
      height: size.height,
      fuzz: options.fuzz,
    })
    result.diffBand = diffBand(result.metrics.diff.percent)

    // 4. Artefacts.
    const base = path.join(options.outDir, sanitizeState(state))
    const sideBySidePath = `${base}-side-by-side.png`
    const overlayPath = `${base}-overlay.png`
    const diffPath = `${base}-diff.png`
    await fs.mkdir(options.outDir, { recursive: true })
    const sideBySide = await writeSideBySide(magick, leftPath, rightPath, sideBySidePath, options.labels)
    if (sideBySide.warning) result.notes.push(sideBySide.warning)
    await writeOverlay(magick, leftPath, rightPath, overlayPath)
    await writeDifference(magick, leftPath, rightPath, diffPath, {
      width: size.width,
      height: size.height,
      autoLevel: options.diffAutoLevel,
      empty: result.metrics.diff.pixels === 0,
    })

    result.outputs = {
      sideBySide: relativePath(sideBySidePath),
      overlay: relativePath(overlayPath),
      diff: relativePath(diffPath),
      labeled: sideBySide.labeled,
      size,
    }
    result.normalization.size = size
    result.status = 'compared'
  } catch (error) {
    errors.push({
      code: error.code ?? 'compare-failed',
      message: error.message,
    })
    result.status = 'error'
    result.metrics = null
    result.diffBand = null
    result.outputs = null
  }

  return result
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function buildSummary(results) {
  const compared = results.filter((entry) => entry.status === 'compared')
  const failed = results.filter((entry) => entry.status !== 'compared')
  const rmseValues = compared.map((entry) => entry.metrics.rmse.normalized)
  const diffValues = compared.map((entry) => entry.metrics.diff.percent)

  const worst = compared.reduce(
    (acc, entry) => (acc === null || entry.metrics.diff.percent > acc.metrics.diff.percent ? entry : acc),
    null,
  )
  const best = compared.reduce(
    (acc, entry) => (acc === null || entry.metrics.diff.percent < acc.metrics.diff.percent ? entry : acc),
    null,
  )

  return {
    states: results.length,
    compared: compared.length,
    errors: failed.length,
    meanRmseNormalized: compared.length ? round(rmseValues.reduce((sum, value) => sum + value, 0) / compared.length) : null,
    maxRmseNormalized: compared.length ? round(Math.max(...rmseValues)) : null,
    meanDiffPercent: compared.length ? round(diffValues.reduce((sum, value) => sum + value, 0) / compared.length, 4) : null,
    maxDiffPercent: compared.length ? round(Math.max(...diffValues), 4) : null,
    worstState: worst ? { state: worst.state, diffPercent: worst.metrics.diff.percent } : null,
    bestState: best ? { state: best.state, diffPercent: best.metrics.diff.percent } : null,
    errorsByCode: failed.reduce((acc, entry) => {
      for (const error of entry.errors) {
        if (error.severity === 'info') continue
        acc[error.code] = (acc[error.code] ?? 0) + 1
      }
      return acc
    }, {}),
  }
}

function renderMarkdown({ options, tools, captureSets, results, summary, startedAt }) {
  const lines = []
  const push = (...items) => lines.push(...items)

  push('# Parity capture comparison', '')
  push(`Generated: ${startedAt}${options.localStartedAt ? ` (${options.localStartedAt}, ${options.timeZone})` : ''}`)
  push(`Harness: \`scripts/compare-parity-captures.mjs\``)
  push(`Node: ${tools.node}`)
  push(`ImageMagick: ${tools.magick}`)
  push('')
  push('## Command', '', '```')
  push(tools.command)
  push('```', '')

  push('## Inputs', '')
  push('| side | directory | manifest | declared states |')
  push('| --- | --- | --- | --- |')
  for (const side of SIDES) {
    const set = captureSets[side]
    const manifest = set.manifestPresent
      ? relativePath(set.manifestPath)
      : set.scannedDirectory
        ? 'absent (filename scan)'
        : 'absent'
    push(`| ${side} | ${relativePath(set.dir)} | ${manifest} | ${set.declaredCount} |`)
  }
  let provenanceLines = 0
  for (const side of SIDES) {
    const set = captureSets[side]
    if (set.provenance) {
      const text = JSON.stringify(set.provenance)
      push(`- ${side} provenance: \`${text.length > 320 ? `${text.slice(0, 317)}...` : text}\``)
      provenanceLines += 1
    }
    if (set.duplicateStates.size > 0) {
      push(`- ${side} declares duplicate states: ${[...set.duplicateStates].join(', ')}`)
      provenanceLines += 1
    }
    if (set.unreferencedImages.length > 0) {
      const shown = set.unreferencedImages.slice(0, 8).join(', ')
      const more = set.unreferencedImages.length > 8 ? `, +${set.unreferencedImages.length - 8} more` : ''
      push(
        `- ${side}: ${set.unreferencedImages.length} of ${set.imageFilesOnDisk} image files are not referenced by capture.json: \`${shown}${more}\``,
      )
      provenanceLines += 1
    }
  }
  if (provenanceLines > 0) push('')
  push('')

  push('## Summary', '')
  push(`- states paired: **${summary.states}**`)
  push(`- states compared: **${summary.compared}**`)
  push(`- states with errors: **${summary.errors}**`)
  if (summary.compared > 0) {
    push(`- mean normalised RMSE: **${formatRatio(summary.meanRmseNormalized)}** (${formatPercent((summary.meanRmseNormalized ?? 0) * 100)}%)`)
    push(`- mean diff: **${formatPercent(summary.meanDiffPercent)}%**, max diff: **${formatPercent(summary.maxDiffPercent)}%**`)
    if (summary.worstState) {
      push(`- largest diff: \`${summary.worstState.state}\` at ${formatPercent(summary.worstState.diffPercent)}%`)
    }
  } else {
    push('- no state produced a score; see the errors below')
  }
  push('')

  push('## States', '')
  if (results.length === 0) {
    push('_No states were paired._', '')
  } else {
    push('| state | original px | native px | compared px | RMSE (norm) | RMSE % | diff px | diff % | diff @2% | band |')
    push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const entry of results) {
      const originalSize = entry.original?.probed
        ? `${entry.original.probed.width}x${entry.original.probed.height}`
        : '—'
      const nativeSize = entry.native?.probed ? `${entry.native.probed.width}x${entry.native.probed.height}` : '—'
      if (entry.status !== 'compared') {
        push(`| \`${escapeTable(entry.state)}\` | ${originalSize} | ${nativeSize} | — | — | — | — | — | — | **error** |`)
        continue
      }
      const size = entry.normalization.size
      push(
        `| \`${escapeTable(entry.state)}\` | ${originalSize} | ${nativeSize} | ${size.width}x${size.height} | ${formatRatio(entry.metrics.rmse.normalized)} | ${formatPercent(entry.metrics.rmse.percent)} | ${entry.metrics.diff.pixels} | ${formatPercent(entry.metrics.diff.percent)} | ${formatPercent(entry.metrics.tolerant.percent)} | ${entry.diffBand} |`,
      )
    }
    push('')
  }

  push('## Errors', '')
  const failed = results.filter((entry) => entry.status !== 'compared')
  if (failed.length === 0) {
    push('_None: every paired state was compared._', '')
  } else {
    for (const entry of failed) {
      push(`### \`${entry.state}\``, '')
      for (const error of entry.errors) {
        const severity = error.severity === 'info' ? 'info' : 'error'
        push(`- **${error.code}** (${severity}${error.side ? `, ${error.side}` : ''}): ${error.message}`)
      }
      push('')
    }
    push('A failed state has **no score** by design. Fix the capture and rerun.', '')
  }

  const informational = results.flatMap((entry) =>
    entry.errors
      .filter((error) => error.severity === 'info')
      .map((error) => ({ state: entry.state, error })),
  )
  if (informational.length > 0) {
    push('## Informational', '')
    for (const { state, error } of informational) {
      push(`- \`${state}\` **${error.code}** (${error.side ?? 'n/a'}): ${error.message}`)
    }
    push('')
  }

  const withNotes = results.filter((entry) => entry.notes.length > 0)
  push('## Normalisation log', '')
  if (withNotes.length === 0) {
    push('_No crops or resizes were needed._', '')
  } else {
    for (const entry of withNotes) {
      push(`### \`${entry.state}\``, '')
      for (const note of entry.notes) push(`- ${note}`)
      push('')
    }
  }

  push('## Artefacts', '')
  const compared = results.filter((entry) => entry.status === 'compared')
  if (compared.length === 0) {
    push('_None._', '')
  } else {
    push(`Written to \`${relativePath(options.outDir)}\`:`, '')
    for (const entry of compared) {
      push(
        `- \`${entry.outputs.sideBySide}\`, \`${entry.outputs.overlay}\`, \`${entry.outputs.diff}\` (${entry.state})`,
      )
    }
    push('')
  }

  push('## How to read these numbers', '')
  push('- `RMSE (norm)` is ImageMagick `compare -metric RMSE` normalised to 0..1.')
  push('- `diff %` is the share of pixels whose difference exceeds the fuzz threshold (default exact, 0).')
  push('- `diff @2%` repeats that count with a 2% per-channel tolerance, which ignores most font anti-aliasing.')
  push('- `band` is a triage heuristic (<=0.25 negligible, <=1 minor, <=4 noticeable, else major), not an acceptance verdict.')
  push('')
  push('Window chrome, DPR differences and font rasterisation make a non-zero baseline normal. ')
  push('See `qa/parity-2026-11-23/README.md` for the format, the crop recipes and the full caveat list.')
  push('')

  return `${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(argv) {
  const options = parseOptions(argv)
  if (options.help) {
    process.stdout.write(HELP)
    return 0
  }

  const magick = createMagick(options.magickBin)
  const magickVersion = await magick.version()

  const captureSets = {
    original: await readCaptureSet('original', options.originalDir, options),
    native: await readCaptureSet('native', options.nativeDir, options),
  }

  // Union of states, ordered by the original manifest then native-only extras.
  const ordered = []
  const seen = new Set()
  for (const side of SIDES) {
    for (const state of captureSets[side].order) {
      if (!seen.has(state)) {
        seen.add(state)
        ordered.push(state)
      }
    }
  }

  let states = ordered
  if (options.requestedStates.length > 0) {
    const unknown = options.requestedStates.filter((state) => !seen.has(state))
    if (unknown.length > 0) {
      throw new FatalError(
        `--state requested states that no manifest declares: ${unknown.join(', ')}`,
        `Known states: ${ordered.join(', ')}`,
      )
    }
    const requested = new Set(options.requestedStates)
    states = ordered.filter((state) => requested.has(state))
  }

  const startedAt = new Date().toISOString()
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-parity-'))
  const results = []

  try {
    for (const state of states) {
      const stateDir = path.join(workRoot, sanitizeState(state))
      await fs.mkdir(stateDir, { recursive: true })
      const result = await compareState(state, { options, magick, captureSets, stateDir })
      results.push(result)
      if (!options.quiet) {
        if (result.status === 'compared') {
          process.stdout.write(
            `${state}: rmse=${formatRatio(result.metrics.rmse.normalized)} diff=${formatPercent(result.metrics.diff.percent)}% (${result.metrics.diff.pixels}px)\n`,
          )
        } else {
          const reasons = result.errors
            .filter((error) => error.severity !== 'info')
            .map((error) => error.code)
            .join(', ')
          process.stdout.write(`${state}: ERROR ${reasons}\n`)
        }
      }
    }
  } finally {
    if (!options.keepWork) {
      await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {})
    } else if (!options.quiet) {
      process.stdout.write(`intermediates kept in ${workRoot}\n`)
    }
  }

  const summary = buildSummary(results)
  const tools = {
    node: `v${process.versions.node}`,
    magick: magickVersion,
    command: `node scripts/compare-parity-captures.mjs ${argv.filter((arg) => arg !== '--quiet' && arg !== '-q').join(' ')}`.trim(),
  }

  const reportJson = {
    schema: SCHEMA,
    generatedAt: startedAt,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    root: relativePath(options.rootDir),
    cwd: options.cwd,
    tools,
    options: {
      crops: options.crops,
      resizeMode: options.resizeMode,
      maxAspectDrift: options.maxAspectDrift,
      aspectPolicy: options.aspectPolicy,
      fuzzPercent: options.fuzz,
      tolerantThresholdPercent: TOLERANT_THRESHOLD_PERCENT,
      allowBlank: options.allowBlank,
      labels: options.labels,
      diffAutoLevel: options.diffAutoLevel,
      requestedStates: options.requestedStates,
    },
    inputs: Object.fromEntries(
      SIDES.map((side) => [
        side,
        {
          dir: relativePath(captureSets[side].dir),
          manifest: captureSets[side].manifestPresent ? relativePath(captureSets[side].manifestPath) : null,
          manifestPresent: captureSets[side].manifestPresent,
          scannedDirectory: captureSets[side].scannedDirectory,
          declaredCount: captureSets[side].declaredCount,
          provenance: captureSets[side].provenance,
          duplicateStates: [...captureSets[side].duplicateStates],
          imageFilesOnDisk: captureSets[side].imageFilesOnDisk,
          unreferencedImages: captureSets[side].unreferencedImages.slice(0, 50),
          notes: captureSets[side].notes,
        },
      ]),
    ),
    summary,
    states: results,
  }

  await fs.mkdir(path.dirname(options.reportPath), { recursive: true })
  await fs.mkdir(path.dirname(options.jsonPath), { recursive: true })
  await fs.writeFile(options.jsonPath, `${JSON.stringify(reportJson, null, 2)}\n`, 'utf8')
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const localStartedAt = new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(startedAt))
  await fs.writeFile(
    options.reportPath,
    renderMarkdown({
      options: { ...options, localStartedAt, timeZone },
      tools,
      captureSets,
      results,
      summary,
      startedAt,
    }),
    'utf8',
  )

  process.stdout.write(
    `\n${summary.compared}/${summary.states} states compared, ${summary.errors} with errors\n` +
      `report: ${relativePath(options.reportPath)}\n` +
      `json:   ${relativePath(options.jsonPath)}\n` +
      `artefacts: ${relativePath(options.outDir)}\n`,
  )

  return summary.errors > 0 ? 1 : 0
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    if (error instanceof FatalError) {
      process.stderr.write(`compare-parity-captures: ${error.message}\n`)
      if (error.hint) process.stderr.write(`  ${error.hint}\n`)
    } else {
      process.stderr.write(`compare-parity-captures: ${error?.stack ?? error}\n`)
    }
    process.exitCode = 2
  })
