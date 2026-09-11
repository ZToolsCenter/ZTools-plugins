import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DIST_ROOT = path.join(ROOT, 'dist')

/** Reads and parses one UTF-8 JSON file, surfacing malformed build inputs as failures. */
export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

/** Returns the lowercase SHA-256 digest for one buffer or file path. */
export function sha256(input) {
  const bytes = Buffer.isBuffer(input) ? input : fs.readFileSync(input)
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

/** Converts a platform path to the canonical POSIX path used by build manifests. */
export function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/')
}

/** Rejects unsafe or colliding paths before they can enter the installable build directory. */
export function validateBuildPaths(paths) {
  const seen = new Set()
  for (const entryPath of paths) {
    const segments = typeof entryPath === 'string' ? entryPath.split('/') : []
    if (
      !entryPath || path.posix.isAbsolute(entryPath) || entryPath.includes('\\') || entryPath.includes('\0') ||
      segments.some(segment => !segment || segment === '.' || segment === '..')
    ) throw new Error(`Unsafe build path: ${entryPath}`)
    const key = entryPath.toLowerCase()
    if (seen.has(key)) throw new Error(`Duplicate build path: ${entryPath}`)
    seen.add(key)
  }
}

/** Recursively lists ordinary files in stable path order and refuses symbolic links or special files. */
export function listFiles(directory) {
  const files = []
  /** Walks one directory while retaining paths relative to the requested build root. */
  function walk(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = relative ? path.join(relative, entry.name) : entry.name
      const child = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Build cannot contain symbolic links: ${childRelative}`)
      if (entry.isDirectory()) walk(child, childRelative)
      else if (entry.isFile()) files.push(toPosix(childRelative))
      else throw new Error(`Build cannot contain special files: ${childRelative}`)
    }
  }
  walk(directory)
  validateBuildPaths(files)
  return files.sort()
}

/** Produces the runtime manifest from the development manifest without editor-only or Vite-only fields. */
export function createProductionManifest(source, packageVersion) {
  const { $schema, development, ...manifest } = source
  if (manifest.version !== packageVersion) throw new Error('Package and plugin versions differ')
  return manifest
}

/** Copies one renderer file into staging while creating only its controlled parent directories. */
function copyRendererFile(rendererDirectory, stagingDirectory, relativePath) {
  const source = path.join(rendererDirectory, relativePath)
  const target = path.join(stagingDirectory, relativePath)
  if (!fs.statSync(source).isFile()) throw new Error(`Missing renderer output: ${relativePath}`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
}

/**
 * Scope-level polyfill prepended to the preload bundle so bundled ZIP libraries (yauzl/yazl via
 * fd-slicer) resolve bare `setImmediate`/`clearImmediate` through the closure scope chain.
 *
 * Some plugin hosts (notably the ZTools preload sandbox on Windows) expose a `globalThis` whose
 * properties are NOT the same object bare identifier resolution reads against, so assigning
 * `globalThis.setImmediate` does not make a bare `setImmediate(...)` call resolvable and yauzl
 * throws ReferenceError "setImmediate is not defined". A `var` declared at bundle top scope sits
 * outside every generated `__commonJS` module wrapper, so bare references inside those wrappers
 * resolve to it via the normal scope chain regardless of how the host wires its global object.
 */
const PRELOAD_RUNTIME_BANNER = `"use strict";
var setImmediate = (function (g) {
  if (typeof g.setImmediate === "function") return g.setImmediate;
  var fn;
  try { var timers = require("node:timers"); if (typeof timers.setImmediate === "function") fn = timers.setImmediate; } catch (e) {}
  if (typeof fn !== "function") fn = function (callback) { var args = Array.prototype.slice.call(arguments, 1); return setTimeout(function () { callback.apply(null, args); }, 0); };
  try { if (typeof g.setImmediate !== "function") g.setImmediate = fn; } catch (e) {}
  return fn;
})(globalThis);
var clearImmediate = (function (g) {
  if (typeof g.clearImmediate === "function") return g.clearImmediate;
  var fn;
  try { var timers = require("node:timers"); if (typeof timers.clearImmediate === "function") fn = timers.clearImmediate; } catch (e) {}
  if (typeof fn !== "function") fn = function (id) { return clearTimeout(id); };
  try { if (typeof g.clearImmediate !== "function") g.clearImmediate = fn; } catch (e) {}
  return fn;
})(globalThis);`

/** Bundles preload and all package dependencies into one CommonJS file, leaving only Node built-ins external. */
async function bundlePreload(stagingDirectory, productionManifest) {
  const output = path.join(stagingDirectory, 'preload/services.js')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: ['public/preload/services.js'],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    packages: 'bundle',
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    banner: { js: PRELOAD_RUNTIME_BANNER },
    plugins: [{
      name: 'production-manifest',
      /** Redirects preload's adjacent manifest import to a path-stable virtual production manifest. */
      setup(buildContext) {
        buildContext.onResolve({ filter: /^\.\.\/plugin\.json$/ }, () => ({ path: 'plugin.json', namespace: 'production-manifest' }))
        buildContext.onLoad({ filter: /^plugin\.json$/, namespace: 'production-manifest' }, () => ({
          contents: fs.readFileSync(productionManifest, 'utf8'),
          loader: 'json'
        }))
      }
    }],
    metafile: true,
    logLevel: 'silent'
  })
  const invalidExternal = Object.keys(result.metafile.inputs).filter(input => !input.startsWith('node_modules/') && !input.startsWith('public/') && input !== 'production-manifest:plugin.json')
  if (invalidExternal.length) throw new Error(`Unexpected preload inputs: ${invalidExternal.join(', ')}`)
  const bundle = fs.readFileSync(output, 'utf8')
  if (/require\(["'](?:cron-parser|luxon|yauzl|yazl|pend|buffer-crc32)["']\)/.test(bundle)) {
    throw new Error('Preload bundle retains a third-party runtime require')
  }
  if (bundle.includes(ROOT)) throw new Error('Preload bundle contains the repository path')
}

/**
 * Replaces the renderer output with installable dist, keeping last-good state if finalization fails.
 *
 * `inputDir` is where Vite wrote the renderer (production: `dist`; dev watch: `.vite-render`).
 * `outputDir` is the final installable directory (always `dist`). When they match, the renderer
 * input doubles as the output, so a failure tears it down to avoid leaving partial state — this
 * preserves the original production behavior. When they differ (watch mode), the renderer output
 * is left untouched and `outputDir` keeps its previous contents on failure.
 */
export async function finalizeDistDirectory({ inputDir = DIST_ROOT, outputDir = DIST_ROOT } = {}) {
  const inputAbs = path.resolve(inputDir)
  const outputAbs = path.resolve(outputDir)
  const sharedInputOutput = inputAbs === outputAbs
  if (!fs.existsSync(inputAbs)) throw new Error(`Missing Vite output directory: ${path.relative(ROOT, inputAbs) || inputAbs}`)
  const packageJson = readJson(path.join(ROOT, 'package.json'))
  const sourceManifest = readJson(path.join(ROOT, 'public/plugin.json'))
  const manifest = createProductionManifest(sourceManifest, packageJson.version)
  const stagingDirectory = `${outputAbs}.staging`
  fs.rmSync(stagingDirectory, { recursive: true, force: true })
  fs.mkdirSync(stagingDirectory, { recursive: true })
  try {
    copyRendererFile(inputAbs, stagingDirectory, 'index.html')
    copyRendererFile(inputAbs, stagingDirectory, 'logo.png')
    for (const file of listFiles(path.join(inputAbs, 'assets'))) copyRendererFile(inputAbs, stagingDirectory, `assets/${file}`)
    const manifestPath = path.join(stagingDirectory, 'plugin.json')
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    fs.mkdirSync(path.join(stagingDirectory, 'preload'), { recursive: true })
    fs.copyFileSync(path.join(ROOT, 'public/preload/package.json'), path.join(stagingDirectory, 'preload/package.json'))
    await bundlePreload(stagingDirectory, manifestPath)
  } catch (error) {
    fs.rmSync(stagingDirectory, { recursive: true, force: true })
    if (sharedInputOutput) fs.rmSync(outputAbs, { recursive: true, force: true })
    throw error
  }
  await swapDirectory(stagingDirectory, outputAbs)
  return { packageJson, manifest }
}

/**
 * Atomically replaces `target` with `staging`, retrying briefly to tolerate Windows EBUSY/EPERM
 * when a host still holds a file handle inside `target` during dev watch. Falls back to a
 * recursive copy if rename keeps failing (e.g. cross-volume staging — not expected here).
 *
 * Retries use real async delays so the event loop can drain between attempts — a synchronous
 * busy-wait would never let the dev server release its file handle, defeating the retry.
 */
async function swapDirectory(stagingDirectory, target) {
  let lastErr
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true })
    } catch {
      /* target may be momentarily busy; attempt the rename regardless */
    }
    try {
      fs.renameSync(stagingDirectory, target)
      return
    } catch (err) {
      lastErr = err
      await new Promise(resolve => setTimeout(resolve, 80 * attempt))
    }
  }
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
  for (const file of listFiles(stagingDirectory)) {
    const segments = file.split('/')
    const dest = path.join(target, ...segments)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(stagingDirectory, ...segments), dest)
  }
  fs.rmSync(stagingDirectory, { recursive: true, force: true })
  if (lastErr) console.warn(`[build] staging rename failed, fell back to copy: ${lastErr.message}`)
}

/** Returns stable per-file hashes for comparing installable build directories across clean builds. */
export function hashDirectory(directory) {
  return Object.fromEntries(listFiles(directory).map(file => [file, sha256(path.join(directory, ...file.split('/')))]))
}
