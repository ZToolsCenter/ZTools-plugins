import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { finalizeDistDirectory, DIST_ROOT } from './build-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Directory the dev server project root lives in. */
const DEV_PORT = 5177
/** Intermediate directory Vite writes the renderer into before finalization repackages it to dist. */
const RENDER_OUT = path.join(ROOT, '.vite-render')
/** The only tree whose changes should trigger a dist repackage during dev. */
const PUBLIC_DIR = path.join(ROOT, 'public')

/** Prefixes every console line with a stable tag so dev output is easy to filter from Vite noise. */
function log(message) {
  const stamp = new Date().toISOString().slice(11, 19)
  console.log(`[dev ${stamp}] ${message}`)
}

/**
 * Debounced dispatcher: collapses a burst of watcher events into one repackage.
 * Editors often write several files (or fire multiple events for one save) when touching the
 * preload tree; each burst should produce exactly one rebuild of the installable dist.
 */
class DebouncedCompiler {
  /** @param {() => Promise<void>} compile Invoked after the burst settles. */
  constructor(compile) {
    this.compile = compile
    this.timer = null
    this.running = false
    this.rearm = false
  }

  /** Schedules (or re-arms) a compile; concurrent calls are queued and run once more afterward. */
  request(reason) {
    clearTimeout(this.timer)
    this.timer = setTimeout(async () => {
      this.timer = null
      if (this.running) { this.rearm = true; return }
      this.running = true
      do {
        this.rearm = false
        if (reason) log(`change detected (${reason}) → repackaging dist…`)
        try { await this.compile() }
        catch (error) { log(`repackage failed: ${error?.message ?? error}`) }
      } while (this.rearm)
      this.running = false
    }, 250)
  }

  /** Cancels any trailing compile; used on shutdown. */
  cancel() {
    clearTimeout(this.timer)
    this.timer = null
  }
}

/** Runs a one-shot renderer build into RENDER_OUT, then finalizes the installable dist from it. */
async function packageDist() {
  await build({
    root: ROOT,
    base: './',
    plugins: [vue()],
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: path.relative(ROOT, RENDER_OUT),
      emptyOutDir: true,
      sourcemap: false,
      target: 'es2020'
    }
  })
  await finalizeDistDirectory({ inputDir: RENDER_OUT, outputDir: DIST_ROOT })
}

/** Recursively watches the public tree and reports any change under it. */
function watchPublicTree(compiler) {
  if (!fs.existsSync(PUBLIC_DIR)) return
  try {
    fs.watch(PUBLIC_DIR, { recursive: true }, (_event, file) => {
      if (!file) return
      compiler.request(`public/${file.split(path.sep).join('/')}`)
    })
    return
  } catch {
    // `recursive` is unavailable on some platforms; fall back to a per-directory walker.
  }
  const walk = (dir) => {
    fs.watch(dir, (_event, file) => {
      if (file) compiler.request(`public/${path.relative(PUBLIC_DIR, path.join(dir, file)).split(path.sep).join('/')}`)
    })
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name))
    }
  }
  walk(PUBLIC_DIR)
}

async function main() {
  log('starting dev server + public/ watcher…')

  if (fs.existsSync(RENDER_OUT)) fs.rmSync(RENDER_OUT, { recursive: true, force: true })

  // 1) Vite dev server: serves the renderer with HMR. The host loads it via plugin.json's
  //    `development.main` (http://localhost:<DEV_PORT>), so src/ edits never need a dist rebuild.
  //    Intermediate build dirs are ignored so repackaging dist doesn't retrigger the dev watcher
  //    (which would otherwise spin on dist.staging/ and .vite-render/ as if they were sources).
  const server = await createServer({
    root: ROOT,
    base: './',
    plugins: [vue()],
    configFile: false,
    server: {
      port: DEV_PORT,
      strictPort: true,
      watch: {
        ignored: [
          '**/.vite-render/**',
          '**/dist/**',
          '**/dist.staging/**',
          '**/.git/**',
          '**/node_modules/**'
        ]
      }
    },
    logLevel: 'info'
  })
  await server.listen()
  const address = server.httpServer.address()
  const port = typeof address === 'object' && address ? address.port : DEV_PORT
  log(`dev server ready → http://localhost:${port}/`)

  // 2) Repackage dist whenever public/ (preload bundle sources, plugin.json, logo.png) changes.
  //    The dev server does not serve these — the host loads them from the installed dist, so a
  //    repackage is the only way a preload/manifest edit becomes visible during dev.
  const compiler = new DebouncedCompiler(packageDist)
  watchPublicTree(compiler)

  process.on('SIGINT', async () => {
    log('shutting down…')
    compiler.cancel()
    try { await server.close() } catch { /* ignore close races on shutdown */ }
    process.exit(0)
  })

  // 3) Produce the first installable dist immediately so the plugin is loadable from the start.
  log('initial packaging of dist…')
  try {
    await packageDist()
    log('dist ready.')
  } catch (error) {
    log(`initial packaging failed: ${error?.message ?? error}`)
  }

  log('watching public/ (preload, plugin.json, logo.png) — Ctrl+C to stop.')
  log(`watch output: ${path.relative(ROOT, DIST_ROOT)}/`)
}

await main()
