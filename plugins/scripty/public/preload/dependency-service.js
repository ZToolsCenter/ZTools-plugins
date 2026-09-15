'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')
const { atomicWriteFile } = require('./file-repositories')
const { RepositoryError } = require('./metadata-repository')
const { invoke } = require('./task-service')

const DEPENDENCY_KINDS = ['node', 'python']
const MAX_INSTALL_OUTPUT_BYTES = 256 * 1024
const NODE_MANIFEST_FILE = 'package.json'
const PYTHON_MANIFEST_FILE = 'requirements.txt'
const NODE_NAME_PATTERN = /^(?:@[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?|[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)$/
const PYTHON_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/
const VERSION_SPEC_PATTERN = /^(?:latest|\*|[~^<>=!0-9][0-9A-Za-z.*+<>=!~^, -]*)$/

/** Returns the platform-specific Python executable inside Scripty's shared virtual environment. */
function getVirtualEnvironmentExecutable(rootDirectory, platform = process.platform) {
  return platform === 'win32'
    ? path.join(rootDirectory, '.venv', 'Scripts', 'python.exe')
    : path.join(rootDirectory, '.venv', 'bin', 'python')
}

/** Locates npm's bundled CLI relative to a resolved Node binary across POSIX and Windows install layouts. */
function resolveSiblingNpmCli(nodeExecutable, platform = process.platform, fileSystem = fs) {
  const binDirectory = path.dirname(nodeExecutable)
  const candidates = platform === 'win32'
    ? [path.join(binDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    : [
        path.join(binDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(binDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      ]
  for (const candidate of candidates) {
    try { if (fileSystem.statSync(candidate).isFile()) return candidate } catch {}
  }
  return null
}

/**
 * Spawns the discovered Node binary to ask it for process.execPath, then re-runs the sibling
 * lookup against the real path. Shims (mise, Volta, Scoop, Bun) forward execution to the real
 * Node install, which sets execPath to its own location — re-running the sibling lookup from
 * there finds npm-cli.js even when the shim directory itself has no node_modules sibling.
 */
function resolveNpmCliViaNode(nodeExecutable, platform = process.platform, spawnProcess = spawn, fileSystem = fs) {
  return new Promise(resolve => {
    let child
    try {
      child = spawnProcess(nodeExecutable, ['-e', 'process.stdout.write(process.execPath)'], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch {
      resolve(null)
      return
    }
    let output = ''
    child.stdout?.on('data', chunk => { output += chunk.toString('utf8') })
    const finish = realNode => {
      if (!realNode) { resolve(null); return }
      resolve(resolveSiblingNpmCli(realNode, platform, fileSystem))
    }
    child.once('error', () => finish(null))
    child.once('close', () => finish(output.trim()))
  })
}

/** Prepends one directory to PATH while respecting Windows' case-insensitive environment keys. */
function prependEnvironmentPath(environment, directory, platform = process.platform) {
  if (platform !== 'win32') return { ...environment, PATH: `${directory}${path.delimiter}${environment.PATH ?? ''}` }
  const existingKey = Object.keys(environment).find(name => name.toLocaleLowerCase() === 'path')
  const existingValue = existingKey ? environment[existingKey] : ''
  return { ...environment, PATH: `${directory}${path.delimiter}${existingValue}` }
}

/** Captures bounded installer output and rejects non-zero exits without invoking a command shell. */
function runInstaller(executable, args, options, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    let child
    let settled = false
    try {
      child = spawnProcess(executable, args, { ...options, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(new RepositoryError('DEPENDENCY_INSTALL_FAILED', '无法启动依赖安装程序', error))
      return
    }
    let output = ''
    const append = chunk => {
      if (Buffer.byteLength(output, 'utf8') >= MAX_INSTALL_OUTPUT_BYTES) return
      output += chunk.toString('utf8')
      if (Buffer.byteLength(output, 'utf8') > MAX_INSTALL_OUTPUT_BYTES) output = Buffer.from(output, 'utf8').subarray(0, MAX_INSTALL_OUTPUT_BYTES).toString('utf8')
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.once('error', error => {
      if (settled) return
      settled = true
      reject(new RepositoryError('DEPENDENCY_INSTALL_FAILED', '依赖安装程序启动失败', error))
    })
    child.once('close', code => {
      if (settled) return
      settled = true
      const message = output.trim()
      if (code === 0) resolve({ exitCode: code, output: message })
      else reject(new RepositoryError('DEPENDENCY_INSTALL_FAILED', message || `依赖安装失败（退出码 ${code ?? '未知'}）`))
    })
  })
}

/** Normalizes one registry package name and rejects paths, URLs, flags, and requirement directives. */
function normalizeDependencyName(kind, name) {
  if (!DEPENDENCY_KINDS.includes(kind) || typeof name !== 'string') throw new RepositoryError('VALIDATION_ERROR', '依赖类型或名称无效')
  const normalized = kind === 'python'
    ? name.trim().toLocaleLowerCase().replace(/[-_.]+/g, '-')
    : name.trim().toLocaleLowerCase()
  const pattern = kind === 'node' ? NODE_NAME_PATTERN : PYTHON_NAME_PATTERN
  if (!pattern.test(normalized) || normalized.length > 214) throw new RepositoryError('VALIDATION_ERROR', '依赖名称必须是注册表包名')
  return normalized
}

/** Validates one registry version constraint without allowing file, URL, Git, or command syntax. */
function normalizeVersionSpec(versionSpec) {
  if (typeof versionSpec !== 'string') throw new RepositoryError('VALIDATION_ERROR', '依赖版本无效')
  const normalized = versionSpec.trim() || 'latest'
  if (normalized.length > 100 || !VERSION_SPEC_PATTERN.test(normalized) || /(?:\/|\\|:|@|#|;|`|\$|\||&|\r|\n)/.test(normalized)) {
    throw new RepositoryError('VALIDATION_ERROR', '只允许注册表版本或版本范围')
  }
  return normalized
}

/** Calculates the deterministic declaration fingerprint used to detect stale install environments. */
function calculateDependencyFingerprint(dependencies) {
  const declarations = [...dependencies]
    .sort((left, right) => `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`))
    .map(item => `${item.kind}:${item.name}@${item.versionSpec}`)
    .join('\n')
  return createHash('sha256').update(declarations).digest('hex')
}

/** Generates a private Node project containing only declared direct dependencies. */
function createNodeManifest(dependencies) {
  const direct = Object.fromEntries(dependencies
    .filter(item => item.kind === 'node')
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(item => [item.name, item.versionSpec]))
  return `${JSON.stringify({ name: 'scripty-managed-scripts', private: true, dependencies: direct }, null, 2)}\n`
}

/** Generates a deterministic pip requirements file from direct Python dependency declarations. */
function createPythonManifest(dependencies) {
  const lines = dependencies
    .filter(item => item.kind === 'python')
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(item => item.versionSpec === 'latest' || item.versionSpec === '*' ? item.name : `${item.name}${/^[<>=!~]/.test(item.versionSpec) ? '' : '=='}${item.versionSpec}`)
  return lines.length ? `${lines.join('\n')}\n` : ''
}

/** Reads installed direct versions from package-lock or pip metadata without exposing filesystem paths. */
function readInstalledVersions(rootDirectory, kind, dependencies, platform = process.platform) {
  const versions = new Map()
  if (kind === 'node') {
    const lockPath = path.join(rootDirectory, 'package-lock.json')
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
      for (const dependency of dependencies.filter(item => item.kind === 'node')) {
        const version = lock.packages?.[`node_modules/${dependency.name}`]?.version
        if (typeof version === 'string') versions.set(dependency.name, version)
      }
    } catch {}
    return versions
  }
  const virtualEnvironment = path.join(rootDirectory, '.venv')
  const sitePackagesRoot = platform === 'win32'
    ? path.join(virtualEnvironment, 'Lib', 'site-packages')
    : path.join(virtualEnvironment, 'lib')
  if (!fs.existsSync(sitePackagesRoot)) return versions
  const roots = platform === 'win32'
    ? [sitePackagesRoot]
    : fs.readdirSync(sitePackagesRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith('python')).map(entry => path.join(sitePackagesRoot, entry.name, 'site-packages'))
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root)) {
      const match = /^(.+?)-([0-9][^-]*)\.dist-info$/i.exec(entry)
      if (match) versions.set(match[1].toLocaleLowerCase().replace(/[-_.]+/g, '-'), match[2])
    }
  }
  return versions
}

/** Manages direct declarations and one shared Node/Python environment above the real scripts tree. */
function createDependencyService(rootDirectory, metadataRepository, interpreterResolver, options = {}) {
  if (!path.isAbsolute(rootDirectory)) throw new TypeError('rootDirectory 必须是绝对路径')
  const platform = options.platform ?? process.platform
  const spawnProcess = options.spawnProcess ?? spawn
  const installing = new Set()
  const manifestPaths = { node: path.join(rootDirectory, NODE_MANIFEST_FILE), python: path.join(rootDirectory, PYTHON_MANIFEST_FILE) }
  const fingerprintPaths = { node: path.join(rootDirectory, '.node-dependencies.sha256'), python: path.join(rootDirectory, '.python-dependencies.sha256') }

  /** Moves partially rolled-out manifests out of the scripts tree and creates root-level manifests. */
  function initialize() {
    fs.mkdirSync(rootDirectory, { recursive: true })
    const legacyRoot = path.join(rootDirectory, 'scripts')
    for (const [kind, fileName] of [['node', NODE_MANIFEST_FILE], ['python', PYTHON_MANIFEST_FILE]]) {
      const legacyPath = path.join(legacyRoot, fileName)
      if (!fs.existsSync(manifestPaths[kind]) && fs.existsSync(legacyPath)) fs.renameSync(legacyPath, manifestPaths[kind])
    }
    const dependencies = metadataRepository.read('dependencies')
    const generatedNode = createNodeManifest(dependencies)
    const generatedPython = createPythonManifest(dependencies)
    if (!fs.existsSync(manifestPaths.node) || fs.readFileSync(manifestPaths.node, 'utf8') !== generatedNode) {
      atomicWriteFile(manifestPaths.node, Buffer.from(generatedNode))
    }
    if (!fs.existsSync(manifestPaths.python) || fs.readFileSync(manifestPaths.python, 'utf8') !== generatedPython) {
      atomicWriteFile(manifestPaths.python, Buffer.from(generatedPython))
    }
  }

  /** Returns direct dependencies with installed versions and current environment synchronization state. */
  function list(kind) {
    if (kind !== undefined && !DEPENDENCY_KINDS.includes(kind)) throw new RepositoryError('VALIDATION_ERROR', '依赖类型无效')
    initialize()
    const dependencies = metadataRepository.read('dependencies')
    const filtered = kind ? dependencies.filter(item => item.kind === kind) : dependencies
    const result = []
    for (const currentKind of (kind ? [kind] : DEPENDENCY_KINDS)) {
      const installed = readInstalledVersions(rootDirectory, currentKind, dependencies, platform)
      const fingerprint = calculateDependencyFingerprint(dependencies.filter(item => item.kind === currentKind))
      let installedFingerprint = null
      try { installedFingerprint = fs.readFileSync(fingerprintPaths[currentKind], 'utf8').trim() } catch {}
      const synchronized = fingerprint === installedFingerprint
      for (const dependency of filtered.filter(item => item.kind === currentKind)) {
        const installedVersion = installed.get(dependency.name) ?? null
        result.push({ ...dependency, installedVersion, status: !synchronized ? 'stale' : installedVersion ? 'installed' : 'missing' })
      }
    }
    return result
  }

  /** Persists one declaration change and regenerates controlled manifests without touching the active environment. */
  function commitDeclarations(nextDependencies) {
    const previousDependencies = metadataRepository.read('dependencies')
    const previousNodeManifest = createNodeManifest(previousDependencies)
    const previousPythonManifest = createPythonManifest(previousDependencies)
    const nextNodeManifest = createNodeManifest(nextDependencies)
    const nextPythonManifest = createPythonManifest(nextDependencies)
    atomicWriteFile(manifestPaths.node, Buffer.from(nextNodeManifest, 'utf8'))
    atomicWriteFile(manifestPaths.python, Buffer.from(nextPythonManifest, 'utf8'))
    try {
      metadataRepository.write('dependencies', nextDependencies)
    } catch (error) {
      atomicWriteFile(manifestPaths.node, Buffer.from(previousNodeManifest, 'utf8'))
      atomicWriteFile(manifestPaths.python, Buffer.from(previousPythonManifest, 'utf8'))
      throw error
    }
    return nextDependencies
  }

  /** Returns whether an ecosystem has a ready environment whose fingerprint matches current declarations. */
  function isEnvironmentReady(kind) {
    const dependencies = metadataRepository.read('dependencies').filter(item => item.kind === kind)
    if (dependencies.length === 0) return kind === 'node' || fs.existsSync(getVirtualEnvironmentExecutable(rootDirectory, platform))
    const fingerprint = calculateDependencyFingerprint(dependencies)
    let installedFingerprint = null
    try { installedFingerprint = fs.readFileSync(fingerprintPaths[kind], 'utf8').trim() } catch {}
    const exists = kind === 'node'
      ? fs.existsSync(path.join(rootDirectory, 'node_modules')) || dependencies.length === 0
      : fs.existsSync(getVirtualEnvironmentExecutable(rootDirectory, platform))
    return exists && fingerprint === installedFingerprint
  }

  /** Resolves the shared Python executable and refuses stale environments before task startup. */
  function resolveRuntime(language, fallbackExecutable) {
    if (language !== 'python') return fallbackExecutable
    return isEnvironmentReady('python') ? getVirtualEnvironmentExecutable(rootDirectory, platform) : null
  }

  /** Adds isolation variables so custom task working directories cannot escape shared dependency resolution. */
  function buildRuntimeEnvironment(language, environment) {
    if (language === 'javascript') return { ...environment, NODE_PATH: path.join(rootDirectory, 'node_modules') }
    if (language !== 'python') return environment
    const virtualEnvironment = path.join(rootDirectory, '.venv')
    const binaries = platform === 'win32' ? path.join(virtualEnvironment, 'Scripts') : path.join(virtualEnvironment, 'bin')
    return { ...prependEnvironmentPath(environment, binaries, platform), VIRTUAL_ENV: virtualEnvironment, PYTHONNOUSERSITE: '1' }
  }

  /** Installs one ecosystem into a same-volume candidate and swaps it only after successful completion. */
  async function syncEnvironment(kind) {
    if (!DEPENDENCY_KINDS.includes(kind)) throw new RepositoryError('VALIDATION_ERROR', '依赖类型无效')
    if (installing.has(kind)) throw new RepositoryError('DEPENDENCY_INSTALL_ACTIVE', '该依赖环境正在同步')
    initialize()
    installing.add(kind)
    const stagingRoot = path.join(rootDirectory, '.transactions', `dependencies-${kind}-${randomUUID()}`)
    fs.mkdirSync(stagingRoot, { recursive: true })
    try {
      let result
      if (kind === 'node') {
        atomicWriteFile(path.join(stagingRoot, NODE_MANIFEST_FILE), Buffer.from(fs.readFileSync(manifestPaths.node)))
        const nodeExecutable = interpreterResolver.resolve('javascript', 'node')
        if (!nodeExecutable) throw new RepositoryError('INTERPRETER_UNAVAILABLE', '未找到可用的 Node.js 解释器')

        const configuredNpmCli = options.npmCliPath
        const siblingNpmCli = resolveSiblingNpmCli(nodeExecutable, platform)
        // 当自动发现的 node 是 shim（mise、Volta、Scoop 等）时，sibling lookup 命中不了，
        // 因为 shim 自己的目录里没有 node_modules。这时 spawn 一次让真实 node 报告 execPath，
        // 再用真实路径走 sibling lookup。
        const fallbackNpmCli = configuredNpmCli || siblingNpmCli ? null : await resolveNpmCliViaNode(nodeExecutable, platform, spawnProcess)
        const npmCli = configuredNpmCli ?? siblingNpmCli ?? fallbackNpmCli
        if (!npmCli) throw new RepositoryError('DEPENDENCY_INSTALL_FAILED', '未找到与自动发现的 Node.js 对应的 npm，请确认 npm 已安装且可从终端调用')
        result = await runInstaller(nodeExecutable, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stagingRoot, env: process.env }, spawnProcess)
      } else {
        atomicWriteFile(path.join(stagingRoot, PYTHON_MANIFEST_FILE), Buffer.from(fs.readFileSync(manifestPaths.python)))
        const basePython = interpreterResolver.resolve('python', 'python')
        if (!basePython) throw new RepositoryError('INTERPRETER_UNAVAILABLE', '未找到可用的 Python 解释器')
        await runInstaller(basePython, ['-m', 'venv', path.join(stagingRoot, '.venv')], { cwd: stagingRoot, env: process.env }, spawnProcess)

        // Python pip 已经内置在 venv 中，无需额外查找
        result = await runInstaller(getVirtualEnvironmentExecutable(stagingRoot, platform), ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(stagingRoot, PYTHON_MANIFEST_FILE)], { cwd: stagingRoot, env: process.env }, spawnProcess)
      }
      const targets = kind === 'node' ? ['node_modules', 'package-lock.json'] : ['.venv']
      const swaps = []
      try {
        for (const targetName of targets) {
          const candidate = path.join(stagingRoot, targetName)
          const target = path.join(rootDirectory, targetName)
          const previous = path.join(stagingRoot, `previous-${targetName.replace(/\//g, '-')}`)
          if (fs.existsSync(target)) fs.renameSync(target, previous)
          if (fs.existsSync(candidate)) fs.renameSync(candidate, target)
          swaps.push({ candidate, previous, target })
        }
        const fingerprint = calculateDependencyFingerprint(metadataRepository.read('dependencies').filter(item => item.kind === kind))
        atomicWriteFile(fingerprintPaths[kind], Buffer.from(`${fingerprint}\n`, 'utf8'))
        for (const swap of swaps) fs.rmSync(swap.previous, { recursive: true, force: true })
      } catch (error) {
        for (const swap of swaps.reverse()) {
          try {
            if (fs.existsSync(swap.target)) fs.renameSync(swap.target, swap.candidate)
            if (fs.existsSync(swap.previous)) fs.renameSync(swap.previous, swap.target)
          } catch {}
        }
        throw error
      }

      // 运行依赖同步后处理脚本（如果存在）
      let postinstallOutput = ''
      if (kind === 'node') {
        try {
          const postinstallScript = path.join(rootDirectory, '.postinstall.mjs')
          if (fs.existsSync(postinstallScript)) {
            const nodeExecutable = interpreterResolver.resolve('javascript', 'node')
            if (nodeExecutable) {
              const postinstallResult = await runInstaller(nodeExecutable, [postinstallScript], { cwd: rootDirectory, env: process.env }, spawnProcess)
              postinstallOutput = postinstallResult.output
            }
          }
        } catch (postinstallError) {
          // 后处理失败不影响依赖同步成功状态，仅记录输出
          postinstallOutput = `后处理脚本执行失败: ${postinstallError.message}`
        }
      }

      return { kind, ...result, synchronized: true, postinstallOutput }
    } finally {
      installing.delete(kind)
      fs.rmSync(stagingRoot, { recursive: true, force: true })
    }
  }

  const api = {
    /** Lists direct declarations and installed status for one or both ecosystems. */
    list(kind) { return invoke(() => list(kind)) },

    /** Adds one normalized direct dependency without running an installer implicitly. */
    add(input) {
      return invoke(() => {
        initialize()
        const dependencies = metadataRepository.read('dependencies')
        const kind = input?.kind
        const name = normalizeDependencyName(kind, input?.name)
        const versionSpec = normalizeVersionSpec(input?.versionSpec)
        const postinstall = typeof input?.postinstall === 'string' ? input.postinstall.trim() || null : null
        if (dependencies.some(item => item.kind === kind && item.name === name)) throw new RepositoryError('NAME_CONFLICT', '直接依赖已存在')
        const timestamp = new Date().toISOString()
        const dependency = { id: randomUUID(), kind, name, versionSpec, postinstall, createdAt: timestamp, updatedAt: timestamp }
        commitDeclarations([...dependencies, dependency])
        return dependency
      })
    },

    /** Changes one direct dependency version while preserving its stable ID. */
    updateVersion(id, versionSpec, postinstall) {
      return invoke(() => {
        const dependencies = metadataRepository.read('dependencies')
        const index = dependencies.findIndex(item => item.id === id)
        if (index < 0) throw new RepositoryError('NOT_FOUND', '依赖不存在')
        const postinstallValue = postinstall !== undefined ? (typeof postinstall === 'string' ? postinstall.trim() || null : null) : dependencies[index].postinstall
        const updated = { ...dependencies[index], versionSpec: normalizeVersionSpec(versionSpec), postinstall: postinstallValue, updatedAt: new Date().toISOString() }
        const next = dependencies.slice(); next[index] = updated
        commitDeclarations(next)
        return updated
      })
    },

    /** Removes one direct declaration without deleting an active environment until the next sync. */
    remove(id) {
      return invoke(() => {
        const dependencies = metadataRepository.read('dependencies')
        if (!dependencies.some(item => item.id === id)) throw new RepositoryError('NOT_FOUND', '依赖不存在')
        commitDeclarations(dependencies.filter(item => item.id !== id))
      })
    },

    /** Synchronizes one ecosystem through an isolated candidate environment. */
    sync(kind) { return invoke(() => syncEnvironment(kind)) },

    /** Returns per-ecosystem readiness for status displays without exposing root paths. */
    getStatus() {
      return invoke(() => ({
        node: { ready: isEnvironmentReady('node'), installing: installing.has('node') },
        python: { ready: isEnvironmentReady('python'), installing: installing.has('python') }
      }))
    }
  }

  return { api, buildRuntimeEnvironment, initialize, isEnvironmentReady, resolveRuntime, rootDirectory }
}

module.exports = {
  DEPENDENCY_KINDS,
  MAX_INSTALL_OUTPUT_BYTES,
  NODE_MANIFEST_FILE,
  PYTHON_MANIFEST_FILE,
  calculateDependencyFingerprint,
  createDependencyService,
  createNodeManifest,
  createPythonManifest,
  getVirtualEnvironmentExecutable,
  normalizeDependencyName,
  normalizeVersionSpec,
  prependEnvironmentPath,
  readInstalledVersions,
  resolveNpmCliViaNode,
  resolveSiblingNpmCli,
  runInstaller
}
