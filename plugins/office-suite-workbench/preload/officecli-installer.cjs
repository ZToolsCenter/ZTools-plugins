'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')
const { spawn: defaultSpawn } = require('node:child_process')

const MIRROR_BASE = 'https://d.officecli.ai'
const GITHUB_BASE = 'https://github.com/iOfficeAI/OfficeCLI'
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000
const VERSION_TIMEOUT_MS = 15 * 1000
const VERSION_CACHE_MS = 30 * 60 * 1000

class OfficeCliInstallerError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'OfficeCliInstallerError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

function releaseAsset(platform, arch, isMusl = false) {
  if (platform === 'darwin') {
    if (arch === 'arm64') return 'officecli-mac-arm64'
    if (arch === 'x64') return 'officecli-mac-x64'
  }
  if (platform === 'win32') {
    if (arch === 'arm64') return 'officecli-win-arm64.exe'
    if (arch === 'x64') return 'officecli-win-x64.exe'
  }
  if (platform === 'linux') {
    const suffix = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : null
    if (suffix) return `officecli-linux-${isMusl ? 'alpine-' : ''}${suffix}`
  }
  throw new OfficeCliInstallerError(
    'UNSUPPORTED_PLATFORM',
    `OfficeCLI one-click installation does not support ${platform}/${arch}.`,
    { platform, arch }
  )
}

function latestVersionFromUrl(value) {
  return String(value || '').match(/\/releases\/tag\/(v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/u)?.[1] || null
}

function checksumForAsset(manifest, asset) {
  for (const line of String(manifest || '').split(/\r?\n/u)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/u)
    if (match && match[2] === asset) return match[1].toLowerCase()
  }
  return null
}

function versionParts(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/u)
  if (!match) return null
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4] || ''
  }
}

function compareVersions(leftInput, rightInput) {
  const left = versionParts(leftInput)
  const right = versionParts(rightInput)
  if (!left || !right) {
    throw new OfficeCliInstallerError('INVALID_VERSION', 'OfficeCLI version must use semantic version format.')
  }
  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) return left.numbers[index] > right.numbers[index] ? 1 : -1
  }
  if (left.prerelease === right.prerelease) return 0
  if (!left.prerelease) return 1
  if (!right.prerelease) return -1
  return left.prerelease.localeCompare(right.prerelease, 'en', { numeric: true })
}

function redirectRequest(url, options = {}, redirects = 0) {
  const requestImpl = options.request || https.request
  const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS
  const maxBytes = options.maxBytes || MAX_DOWNLOAD_BYTES
  if (redirects > 8) {
    return Promise.reject(new OfficeCliInstallerError('DOWNLOAD_REDIRECT_LIMIT', 'OfficeCLI download redirected too many times.'))
  }

  return new Promise((resolve, reject) => {
    const request = requestImpl(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'ZTools-Office-Suite-Workbench/0.1',
        Accept: 'application/octet-stream'
      }
    }, (response) => {
      const status = response.statusCode || 0
      const location = response.headers?.location
      if (status >= 300 && status < 400 && location) {
        response.resume()
        const next = new URL(location, url).toString()
        redirectRequest(next, options, redirects + 1).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) {
        response.resume()
        reject(new OfficeCliInstallerError('DOWNLOAD_HTTP_ERROR', `OfficeCLI download returned HTTP ${status}.`, { status }))
        return
      }

      const chunks = []
      let bytes = 0
      response.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > maxBytes) {
          response.destroy(new OfficeCliInstallerError('DOWNLOAD_TOO_LARGE', 'OfficeCLI download exceeded the size limit.'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve({ body: Buffer.concat(chunks), finalUrl: response.url || url }))
      response.on('error', reject)
    })
    request.setTimeout(timeoutMs, () => request.destroy(new OfficeCliInstallerError(
      'DOWNLOAD_TIMEOUT',
      'OfficeCLI download timed out.'
    )))
    request.on('error', reject)
    request.end()
  })
}

async function fetchWithFallback(urls, options) {
  let lastError
  for (const url of urls) {
    try {
      return await redirectRequest(url, options)
    } catch (error) {
      lastError = error
    }
  }
  throw new OfficeCliInstallerError(
    'DOWNLOAD_FAILED',
    'Unable to download OfficeCLI from the official mirror or GitHub.',
    { cause: lastError instanceof Error ? lastError.message : String(lastError) }
  )
}

function runVersion(binaryPath, spawnImpl, env) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnImpl(binaryPath, ['--version'], {
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (error) {
      reject(new OfficeCliInstallerError('INSTALL_VERIFY_FAILED', `Unable to start downloaded OfficeCLI: ${error.message}`))
      return
    }
    let output = ''
    let settled = false
    const finish = (error, version) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(version)
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { }
      finish(new OfficeCliInstallerError('INSTALL_VERIFY_TIMEOUT', 'Downloaded OfficeCLI did not respond to --version.'))
    }, VERSION_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    child.on('error', (error) => finish(new OfficeCliInstallerError(
      'INSTALL_VERIFY_FAILED',
      `Downloaded OfficeCLI could not start: ${error.message}`
    )))
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new OfficeCliInstallerError('INSTALL_VERIFY_FAILED', 'Downloaded OfficeCLI failed its version check.', { exitCode: code }))
        return
      }
      const version = output.match(/\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/u)?.[1]
      if (!version) {
        finish(new OfficeCliInstallerError('INSTALL_VERIFY_FAILED', 'Downloaded OfficeCLI returned an invalid version.'))
        return
      }
      finish(null, version)
    })
  })
}

function createOfficeCliInstaller(dependencies = {}) {
  const fsImpl = dependencies.fs || fs
  const spawnImpl = dependencies.spawn || defaultSpawn
  const platform = dependencies.platform || process.platform
  const arch = dependencies.arch || process.arch
  const environment = { ...(dependencies.env || process.env) }
  const homeDir = path.resolve(dependencies.homeDir || os.homedir())
  const request = dependencies.request
  const now = dependencies.now || Date.now
  const isMusl = dependencies.isMusl ?? (platform === 'linux' && !process.report?.getReport()?.header?.glibcVersionRuntime)
  let activeInstallation = null
  let activeVersionCheck = null
  let versionCache = null

  async function resolveVersion(force = false) {
    if (!force && versionCache && now() - versionCache.checkedAt < VERSION_CACHE_MS) return versionCache.version
    if (!force && activeVersionCheck) return activeVersionCheck
    const work = (async () => {
    for (const url of [`${MIRROR_BASE}/releases/latest`, `${GITHUB_BASE}/releases/latest`]) {
      try {
        const response = await redirectRequest(url, { request, timeoutMs: 30_000, maxBytes: 1024 })
        const version = latestVersionFromUrl(response.finalUrl)
        if (version) {
          versionCache = { version, checkedAt: now() }
          return version
        }
      } catch { }
    }
    throw new OfficeCliInstallerError('VERSION_RESOLUTION_FAILED', 'Unable to resolve the latest OfficeCLI version.')
    })()
    activeVersionCheck = work.finally(() => { activeVersionCheck = null })
    return activeVersionCheck
  }

  function defaultInstallPath() {
    const installDirectory = platform === 'win32'
      ? path.join(environment.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'OfficeCLI')
      : path.join(homeDir, '.local', 'bin')
    return path.join(installDirectory, platform === 'win32' ? 'officecli.exe' : 'officecli')
  }

  function updateTarget(targetInput) {
    if (targetInput == null) return defaultInstallPath()
    if (typeof targetInput !== 'string' || !path.isAbsolute(targetInput) || targetInput.includes('\0')) {
      throw new OfficeCliInstallerError('INVALID_UPDATE_TARGET', 'OfficeCLI update target must be an absolute binary path.')
    }
    const target = path.resolve(targetInput)
    const basename = path.basename(target).toLowerCase()
    if (!['officecli', 'officecli.exe'].includes(basename)) {
      throw new OfficeCliInstallerError('INVALID_UPDATE_TARGET', 'OfficeCLI update target must point to the officecli binary.')
    }
    return target
  }

  async function replaceBinary(stagedPath, binaryPath) {
    try {
      await fsImpl.promises.rename(stagedPath, binaryPath)
      return
    } catch (error) {
      if (platform !== 'win32' || !fsImpl.existsSync(binaryPath)) throw error
    }

    const backupPath = `${binaryPath}.previous`
    await fsImpl.promises.rm(backupPath, { force: true })
    await fsImpl.promises.rename(binaryPath, backupPath)
    try {
      await fsImpl.promises.rename(stagedPath, binaryPath)
      await fsImpl.promises.rm(backupPath, { force: true })
    } catch (error) {
      await fsImpl.promises.rename(backupPath, binaryPath).catch(() => undefined)
      throw error
    }
  }

  async function performInstall(targetInput) {
    const asset = releaseAsset(platform, arch, isMusl)
    const version = await resolveVersion(true)
    const mirrorRelease = `${MIRROR_BASE}/releases/download/${version}`
    const githubRelease = `${GITHUB_BASE}/releases/download/${version}`
    const [binaryResponse, checksumResponse] = await Promise.all([
      fetchWithFallback([`${mirrorRelease}/${asset}`, `${githubRelease}/${asset}`], { request }),
      fetchWithFallback([`${mirrorRelease}/SHA256SUMS`, `${githubRelease}/SHA256SUMS`], { request, maxBytes: 2 * 1024 * 1024 })
    ])
    const expected = checksumForAsset(checksumResponse.body.toString('utf8'), asset)
    if (!expected) {
      throw new OfficeCliInstallerError('CHECKSUM_MISSING', `Official checksum manifest does not contain ${asset}.`)
    }
    const actual = crypto.createHash('sha256').update(binaryResponse.body).digest('hex')
    if (actual !== expected) {
      throw new OfficeCliInstallerError('CHECKSUM_MISMATCH', 'OfficeCLI download failed SHA-256 verification.')
    }

    const binaryPath = updateTarget(targetInput)
    const installDirectory = path.dirname(binaryPath)
    const stagedPath = `${binaryPath}.new`
    await fsImpl.promises.mkdir(installDirectory, { recursive: true })
    await fsImpl.promises.writeFile(stagedPath, binaryResponse.body, { mode: platform === 'win32' ? undefined : 0o755 })
    if (platform !== 'win32') await fsImpl.promises.chmod(stagedPath, 0o755)

    try {
      const installedVersion = await runVersion(stagedPath, spawnImpl, environment)
      await replaceBinary(stagedPath, binaryPath)
      return { installed: true, binaryPath, version: installedVersion, release: version, asset }
    } catch (error) {
      await fsImpl.promises.rm(stagedPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  return Object.freeze({
    async check(currentVersion) {
      const latestVersion = await resolveVersion()
      return {
        currentVersion: String(currentVersion || '').replace(/^v/u, ''),
        latestVersion: latestVersion.replace(/^v/u, ''),
        updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
        checkedAt: new Date(now()).toISOString()
      }
    },
    install() {
      if (!activeInstallation) {
        activeInstallation = performInstall().finally(() => { activeInstallation = null })
      }
      return activeInstallation
    },
    update(binaryPath) {
      if (!activeInstallation) {
        activeInstallation = performInstall(binaryPath).finally(() => { activeInstallation = null })
      }
      return activeInstallation
    }
  })
}

module.exports = {
  OfficeCliInstallerError,
  checksumForAsset,
  compareVersions,
  createOfficeCliInstaller,
  latestVersionFromUrl,
  releaseAsset
}
