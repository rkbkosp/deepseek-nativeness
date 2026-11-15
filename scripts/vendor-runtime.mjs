#!/usr/bin/env node
/**
 * Vendor the immutable dsh runtime carried by an installed DeepSeek Harness app.
 *
 * The official bundle keeps the runtime inside one app.asar, which plain Node
 * cannot read. This copies the `dsh` subtree out into real files and verifies
 * every byte against the tree's own sealed manifest (`dsh/desktop-runtime.json`:
 * path, bytes, sha256 and executable per file). Nothing in the installed app,
 * in `~/.dsh`, or in the backend source is written.
 *
 * Usage:
 *   node scripts/vendor-runtime.mjs                 # /Applications app -> build/runtime
 *   node scripts/vendor-runtime.mjs --from-app <app> --out <dir> --force
 *   node scripts/vendor-runtime.mjs --no-runtime    # dsh tree only
 *   node scripts/vendor-runtime.mjs --verify-only   # verify an existing target
 */

import { createHash } from 'node:crypto'
import {
  chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  readSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const DEFAULT_APP = '/Applications/DeepSeek Harness.app'
const CHUNK = 8 * 1024 * 1024
const SUPPORT_ENTRIES = ['versions.json', 'bin', 'cli', 'primary-runtime']

function fail(message) {
  console.error(`vendor-runtime: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const options = { fromApp: DEFAULT_APP, out: 'build/runtime', runtime: true, force: false, verifyOnly: false }
  const takesValue = { '--from-app': 'fromApp', '--out': 'out' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg in takesValue) {
      const value = argv[++index]
      if (value === undefined || value === '') fail(`${arg} needs a value`)
      options[takesValue[arg]] = value
    } else if (arg === '--no-runtime') options.runtime = false
    else if (arg === '--force') options.force = true
    else if (arg === '--verify-only') options.verifyOnly = true
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').trim())
      process.exit(0)
    } else fail(`unknown argument ${arg}`)
  }
  return options
}

/** sha256 of a whole file, in bounded chunks. */
function sha256File(path) {
  const hash = createHash('sha256')
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(CHUNK)
    for (;;) {
      const read = readSync(fd, buffer, 0, CHUNK, null)
      if (read === 0) break
      hash.update(buffer.subarray(0, read))
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

/** asar header: 4-byte size prefix, header pickle, then the packed data block. */
function readAsarHeader(archive) {
  const fd = openSync(archive, 'r')
  try {
    const prefix = Buffer.alloc(16)
    if (readSync(fd, prefix, 0, 16, 0) !== 16) fail('asar is too short')
    const headerSize = prefix.readUInt32LE(4)
    const jsonLength = prefix.readUInt32LE(12)
    if (jsonLength <= 0 || jsonLength > 64 * 1024 * 1024) fail('asar header length is implausible')
    const json = Buffer.alloc(jsonLength)
    if (readSync(fd, json, 0, jsonLength, 16) !== jsonLength) fail('asar header is truncated')
    return { fd, dataStart: 8 + headerSize, root: JSON.parse(json.toString('utf8')).files }
  } catch (error) {
    closeSync(fd)
    throw error
  }
}

/** Flatten one asar subtree into `{ path, entry }` rows. */
function flatten(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    if (entry.files === undefined) out.push({ path, entry })
    else flatten(entry, path, out)
  }
  return out
}

/** Copy one packed entry out of the data block, returning its sha256. */
function extractPacked(fd, dataStart, entry, target) {
  const offset = dataStart + Number(entry.offset)
  const size = Number(entry.size)
  const hash = createHash('sha256')
  mkdirSync(dirname(target), { recursive: true })
  const out = openSync(target, 'w', entry.executable === true ? 0o755 : 0o644)
  try {
    const buffer = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(size, 1)))
    let copied = 0
    while (copied < size) {
      const want = Math.min(buffer.length, size - copied)
      const read = readSync(fd, buffer, 0, want, offset + copied)
      if (read <= 0) fail(`short read while extracting ${target}`)
      const piece = buffer.subarray(0, read)
      hash.update(piece)
      let written = 0
      while (written < read) written += writeSync(out, piece, written, read - written)
      copied += read
    }
  } finally {
    closeSync(out)
  }
  return hash.digest('hex')
}

function copyTree(source, target) {
  const info = lstatSync(source, { throwIfNoEntry: false })
  if (info === undefined) fail(`missing ${source}`)
  if (info.isSymbolicLink()) {
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(readlinkSync(source), target)
    return
  }
  if (info.isDirectory()) {
    mkdirSync(target, { recursive: true })
    for (const name of readdirSync(source)) copyTree(join(source, name), join(target, name))
    return
  }
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  // copyFileSync preserves the mode, but be explicit about the executable bit
  chmodSync(target, (info.mode & 0o111) !== 0 ? 0o755 : 0o644)
}

function extractDsh(archive, unpackedRoot, target) {
  const { fd, dataStart, root } = readAsarHeader(archive)
  const subtree = root.dsh
  if (subtree === undefined) fail('asar has no dsh subtree')
  const entries = flatten(subtree, '', [])
  let packed = 0
  let unpacked = 0
  let links = 0
  try {
    for (const { path, entry } of entries) {
      const destination = join(target, ...path.split('/'))
      if (entry.link !== undefined) {
        mkdirSync(dirname(destination), { recursive: true })
        symlinkSync(entry.link, destination)
        links += 1
      } else if (entry.unpacked === true) {
        const source = join(unpackedRoot, 'dsh', ...path.split('/'))
        if (!existsSync(source)) fail(`unpacked entry missing on disk: ${path}`)
        copyTree(source, destination)
        unpacked += 1
      } else {
        extractPacked(fd, dataStart, entry, destination)
        packed += 1
      }
      if ((packed + unpacked + links) % 5000 === 0) {
        console.log(`  extracted ${packed + unpacked + links}/${entries.length}`)
      }
    }
  } finally {
    closeSync(fd)
  }
  console.log(`  packed ${packed}, unpacked ${unpacked}, links ${links}`)
}

function verifyTree(root) {
  const descriptorPath = join(root, 'desktop-runtime.json')
  if (!existsSync(descriptorPath)) fail(`no desktop-runtime.json under ${root}`)
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'))
  if (descriptor.schemaVersion !== 1) fail(`unsupported descriptor schema ${descriptor.schemaVersion}`)
  console.log(`descriptor: ${descriptor.release.version} ` +
    `hostProtocol=${descriptor.release.hostProtocolVersion} node=${descriptor.release.nodeVersion} ` +
    `pnpm=${descriptor.release.pnpmVersion} ${descriptor.platform}/${descriptor.arch} ` +
    `files=${descriptor.files.length} shared=${descriptor.sharedPackages.length}`)

  const expected = new Set()
  let bytes = 0
  let problems = 0
  for (const file of descriptor.files) {
    expected.add(file.path)
    const path = join(root, ...file.path.split('/'))
    const info = statSync(path, { throwIfNoEntry: false })
    if (info === undefined) { console.error(`  MISSING ${file.path}`); problems += 1; continue }
    if (info.size !== file.bytes) { console.error(`  SIZE ${file.path}`); problems += 1; continue }
    if (sha256File(path) !== file.sha256) { console.error(`  SHA256 ${file.path}`); problems += 1; continue }
    const executable = (info.mode & 0o111) !== 0
    if (executable !== file.executable) {
      console.error(`  MODE ${file.path} executable=${String(executable)} expected=${String(file.executable)}`)
      problems += 1
      continue
    }
    bytes += file.bytes
  }

  let extras = []
  const walk = (directory, prefix) => {
    for (const name of readdirSync(directory)) {
      const path = prefix === '' ? name : `${prefix}/${name}`
      const full = join(directory, name)
      const info = statSync(full)
      if (info.isDirectory()) walk(full, path)
      else if (!expected.has(path)) extras.push(path)
    }
  }
  walk(root, '')

  console.log(`verified ${descriptor.files.length - problems}/${descriptor.files.length} files ` +
    `(${(bytes / 1024 / 1024).toFixed(1)} MiB), ${problems} problem(s), ${extras.length} extra file(s)`)
  for (const extra of extras.slice(0, 10)) console.log(`  EXTRA ${extra}`)
  if (problems !== 0) fail(`${problems} file(s) failed verification`)
  if (extras.length > 1 || (extras.length === 1 && extras[0] !== 'desktop-runtime.json')) {
    fail(`unexpected extra files: ${extras.join(', ')}`)
  }
  return { descriptor, bytes, extras }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const archive = join(options.fromApp, 'Contents/Resources/app.asar')
  const unpackedRoot = join(options.fromApp, 'Contents/Resources/app.asar.unpacked')
  const supportRoot = join(options.fromApp, 'Contents/Resources/runtime')
  if (!existsSync(archive)) fail(`no asar at ${archive} (pass --from-app)`)
  if (!existsSync(supportRoot)) fail(`no runtime support directory at ${supportRoot}`)

  if (options.verifyOnly) {
    const { descriptor, bytes } = verifyTree(join(options.out, 'dsh'))
    console.log(`OK: ${descriptor.files.length} files verified`)
    return
  }

  if (existsSync(options.out) && !options.force) fail(`${options.out} exists; pass --force to replace it`)
  const stage = `${options.out}.partial-${process.pid}`
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })

  try {
    const asarSha256 = sha256File(archive)
    console.log(`source asar ${archive} (${(statSync(archive).size / 1024 / 1024).toFixed(1)} MiB) sha256=${asarSha256}`)
    console.log('extracting dsh subtree')
    extractDsh(archive, unpackedRoot, join(stage, 'dsh'))
    // The launcher is this repository's own file, not part of the official
    // bundle: stage it beside the payload so the tree is self-describing.
    const launcherSource = resolve('runtime/launcher.mjs')
    if (!existsSync(launcherSource)) fail(`missing launcher at ${launcherSource}`)
    copyFileSync(launcherSource, join(stage, 'launcher.mjs'))
    console.log('staged launcher.mjs')
    if (options.runtime) {
      console.log('copying runtime support payload')
      for (const name of SUPPORT_ENTRIES) {
        if (!existsSync(join(supportRoot, name))) fail(`missing ${join(supportRoot, name)}`)
        copyTree(join(supportRoot, name), join(stage, name))
      }
    }
    const { descriptor, bytes, extras } = verifyTree(join(stage, 'dsh'))
    const manifest = {
      schemaVersion: 1,
      vendoredAt: new Date().toISOString(),
      source: { app: options.fromApp, asar: 'Contents/Resources/app.asar', asarSha256 },
      release: descriptor.release,
      platform: descriptor.platform,
      arch: descriptor.arch,
      sharedPackages: descriptor.sharedPackages.length,
      dshFiles: descriptor.files.length,
      dshBytes: bytes,
      extras,
      runtimePayload: options.runtime ? SUPPORT_ENTRIES : [],
    }
    writeFileSyncSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
    rmSync(options.out, { recursive: true, force: true })
    renameSync(stage, options.out)
    console.log(`OK: ${options.out}`)
  } catch (error) {
    rmSync(stage, { recursive: true, force: true })
    throw error
  }
}

function writeFileSyncSync(path, contents) {
  const fd = openSync(path, 'w', 0o644)
  try {
    writeSync(fd, contents)
  } finally {
    closeSync(fd)
  }
}

main()
