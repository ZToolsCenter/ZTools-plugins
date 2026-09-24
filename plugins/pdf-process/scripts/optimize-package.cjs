const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const asar = require('@electron/asar')
const archiver = require('archiver')
const esbuild = require('esbuild')

const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'dist')
const preloadSource = path.join(root, 'public', 'preload')
const preloadDist = path.join(dist, 'preload')
const sourceModules = path.join(preloadSource, 'node_modules')
const distModules = path.join(preloadDist, 'node_modules')
const tempBase = path.join(os.tmpdir(), `pdf-process-size-${process.pid}`)
const asarPath = tempBase + '.asar'
const zipPath = tempBase + '.zip'
const maxPackageBytes = 15 * 1024 * 1024

function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, { recursive: true })
}

function packagePath(name) {
  return path.join(sourceModules, ...name.split('/'))
}

function copyPackageFile(name, relativePath) {
  copy(path.join(packagePath(name), relativePath), path.join(distModules, ...name.split('/'), relativePath))
}

function listFiles(directory, prefix = '') {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? path.join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) files.push(...listFiles(path.join(directory, entry.name), relativePath))
    else if (entry.isFile()) files.push(relativePath)
  }
  return files
}

function verifyPackage() {
  const rootManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(dist, 'plugin.json'), 'utf8'))
  if (pluginManifest.version !== rootManifest.version) {
    throw new Error(`Version mismatch: package.json=${rootManifest.version}, plugin.json=${pluginManifest.version}`)
  }
  if (JSON.stringify(pluginManifest.platform) !== JSON.stringify(['win32'])) {
    throw new Error('plugin.json platform must be exactly ["win32"] for the Windows PR build')
  }
  if ('unpack' in pluginManifest) {
    throw new Error('plugin.json must not declare unpack when the package has no native runtime files')
  }

  for (const relativePath of [pluginManifest.main, pluginManifest.preload, pluginManifest.logo]) {
    if (!relativePath || !fs.existsSync(path.join(dist, relativePath))) {
      throw new Error(`Missing packaged entry: ${relativePath || '(empty)'}`)
    }
  }

  const forbidden = listFiles(dist).filter((file) =>
    /(^|[\\/])__tests__([\\/]|$)|\.(exe|map|py|pyc)$|(^|[\\/])package-lock\.json$/i.test(file),
  )
  if (forbidden.length) {
    throw new Error('Forbidden files in dist:\n' + forbidden.join('\n'))
  }
}

function createPrZip() {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', () => resolve(archive.pointer()))
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
      const entryPath = path.join(dist, entry.name)
      if (entry.isDirectory()) archive.directory(entryPath, entry.name)
      else archive.file(entryPath, { name: entry.name })
    }
    archive.finalize()
  })
}

async function main() {
  if (!fs.existsSync(sourceModules)) {
    throw new Error('Preload dependencies are missing; run npm install first')
  }

  const bundlePath = path.join(root, '.preload-services.cjs')
  await esbuild.build({
    entryPoints: [path.join(preloadSource, 'services.js')],
    outfile: bundlePath,
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['pdfjs-dist/*'],
    logLevel: 'info',
  })

  fs.rmSync(preloadDist, { recursive: true, force: true })
  fs.mkdirSync(preloadDist, { recursive: true })
  fs.renameSync(bundlePath, path.join(preloadDist, 'services.js'))
  fs.writeFileSync(path.join(preloadDist, 'package.json'), '{"type":"commonjs"}\n')

  for (const file of [
    'package.json',
    'legacy/build/pdf.mjs',
    'legacy/build/pdf.worker.mjs',
    'cmaps',
    'standard_fonts',
    'wasm',
  ]) {
    const source = path.join(packagePath('pdfjs-dist'), file)
    if (fs.existsSync(source)) copyPackageFile('pdfjs-dist', file)
  }

  fs.rmSync(path.join(dist, 'bin'), { recursive: true, force: true })
  verifyPackage()

  fs.rmSync(asarPath, { force: true })
  fs.rmSync(asarPath + '.unpacked', { recursive: true, force: true })
  fs.rmSync(zipPath, { force: true })
  await asar.createPackage(dist, asarPath)

  const rawBytes = listFiles(dist)
    .reduce((total, file) => total + fs.statSync(path.join(dist, file)).size, 0)
  const asarBytes = fs.statSync(asarPath).size
  const zipBytes = await createPrZip()
  fs.rmSync(asarPath, { force: true })
  fs.rmSync(asarPath + '.unpacked', { recursive: true, force: true })
  fs.rmSync(zipPath, { force: true })
  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2)
  console.log(`Optimized dist: ${mb(rawBytes)} MB raw`)
  console.log(`PR package: ${mb(zipBytes)} MB ZIP (limit 15 MB)`)
  console.log(`Runtime package: ${mb(asarBytes)} MB ASAR (limit 15 MB)`)

  if (zipBytes > maxPackageBytes) {
    throw new Error(`PR ZIP is ${mb(zipBytes)} MB; limit is 15 MB`)
  }
  if (asarBytes > maxPackageBytes) {
    throw new Error(`ASAR package is ${mb(asarBytes)} MB; limit is 15 MB`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
