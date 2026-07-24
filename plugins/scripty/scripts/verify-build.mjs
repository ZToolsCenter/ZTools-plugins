import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIST_ROOT, hashDirectory, listFiles, readJson, ROOT } from './build-lib.mjs'

const REQUIRED_FILES = ['index.html', 'logo.png', 'plugin.json', 'preload/package.json', 'preload/services.js']
const ALLOWED_PREFIXES = ['assets/']
const FORBIDDEN_TEXT = ['localhost:5173', ROOT, '/Users/Apple/', 'C:\\Users\\']

/** Resolves the installable dist path together with package metadata used during verification. */
export function getBuildPaths() {
  return {
    packageJson: readJson(path.join(ROOT, 'package.json')),
    directory: DIST_ROOT
  }
}

/** Ensures one production manifest is self-contained, version-aligned, and free of development metadata. */
export function verifyManifest(manifest, packageJson, files) {
  if ('$schema' in manifest || 'development' in manifest) throw new Error('Production manifest contains development metadata')
  if (manifest.version !== packageJson.version) throw new Error('Production manifest version differs from package version')
  for (const field of ['main', 'preload', 'logo']) {
    if (typeof manifest[field] !== 'string' || !files.includes(manifest[field])) throw new Error(`Missing manifest ${field} target`)
  }
  const codes = manifest.features?.map(feature => feature.code) ?? []
  if (!codes.length || new Set(codes).size !== codes.length || codes.some(code => typeof code !== 'string' || !code)) {
    throw new Error('Production manifest feature codes are missing or duplicated')
  }
  for (const feature of manifest.features) {
    if (!files.includes(feature.icon)) throw new Error(`Missing feature icon for ${feature.code}`)
    if (!Array.isArray(feature.cmds) || feature.cmds.some(command => typeof command !== 'string' || !command.trim())) {
      throw new Error(`Invalid feature commands for ${feature.code}`)
    }
  }
}

/** Verifies the dist whitelist, local HTML resources, production manifest, and bundled preload closure. */
export function verifyBuildDirectory(directory, packageJson) {
  const files = listFiles(directory)
  for (const required of REQUIRED_FILES) if (!files.includes(required)) throw new Error(`Missing required build file: ${required}`)
  for (const file of files) {
    const allowed = REQUIRED_FILES.includes(file) || ALLOWED_PREFIXES.some(prefix => file.startsWith(prefix))
    if (!allowed || file.endsWith('.map') || file.includes('node_modules/')) throw new Error(`Unexpected build file: ${file}`)
  }
  const manifest = readJson(path.join(directory, 'plugin.json'))
  verifyManifest(manifest, packageJson, files)
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8')
  const resources = [...html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)].map(match => match[1])
  for (const resource of resources) if (!files.includes(resource)) throw new Error(`Missing HTML resource: ${resource}`)
  const textFiles = files.filter(file => /\.(?:html|json|js|css)$/.test(file))
  for (const file of textFiles) {
    const content = fs.readFileSync(path.join(directory, ...file.split('/')), 'utf8')
    for (const forbidden of FORBIDDEN_TEXT) if (content.includes(forbidden)) throw new Error(`Build text leaks forbidden value in ${file}`)
  }
  const preload = fs.readFileSync(path.join(directory, 'preload/services.js'), 'utf8')
  if (/require\(["'](?:cron-parser|luxon|yauzl|yazl|pend|buffer-crc32|\.\/app-service)["']\)/.test(preload)) {
    throw new Error('Preload bundle retains a runtime package or source-module require')
  }
  return { files, manifest, hashes: hashDirectory(directory) }
}

/** Verifies the current installable dist directory without creating any secondary artifact. */
export function verifyCurrentBuild() {
  const paths = getBuildPaths()
  return { ...paths, ...verifyBuildDirectory(paths.directory, paths.packageJson) }
}

/** Runs dist verification as a CLI while preserving exports for clean-copy verification. */
function main() {
  const result = verifyCurrentBuild()
  console.log(JSON.stringify({ directory: result.directory, files: result.files.length }, null, 2))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
