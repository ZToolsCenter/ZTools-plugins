'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { execFile: execFileCallback } = require('node:child_process')
const { promisify } = require('node:util')

const defaultExecFile = promisify(execFileCallback)
const TOOLS = Object.freeze({
  claude: { label: 'Claude Code', package: '@anthropic-ai/claude-code', update: ['update'], installer: "bash -c 'tmp=$(mktemp) && curl -fsSL https://claude.ai/install.sh -o $tmp && bash $tmp; status=$?; rm -f $tmp; exit $status'" },
  codex: { label: 'Codex', package: '@openai/codex', update: ['update'] },
  gemini: { label: 'Gemini CLI', package: '@google/gemini-cli' },
  grok: { label: 'Grok Build', package: '@xai-official/grok', update: ['update'], installer: "bash -c 'tmp=$(mktemp) && curl -fsSL https://x.ai/cli/install.sh -o $tmp && bash $tmp; status=$?; rm -f $tmp; exit $status'" },
  opencode: { label: 'OpenCode', package: 'opencode-ai', update: ['upgrade'], installer: "bash -c 'tmp=$(mktemp) && curl -fsSL https://opencode.ai/install -o $tmp && bash $tmp; status=$?; rm -f $tmp; exit $status'" },
  openclaw: { label: 'OpenClaw', package: 'openclaw', update: ['update', '--yes'] },
  hermes: { label: 'Hermes', package: null, update: ['update'], installer: "bash -c 'tmp=$(mktemp) && curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh -o $tmp && bash $tmp; status=$?; rm -f $tmp; exit $status'" }
})
const COMMON_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']

function extractVersion(value) {
  const text = String(value || '').trim()
  return text.match(/\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/)?.[1] || text.split(/\s+/).find(Boolean) || null
}
function inferInstallSource(filePath) {
  const value = String(filePath || '').replaceAll('\\', '/').toLowerCase()
  if (value.includes('/.nvm/')) return 'nvm'
  if (value.includes('/homebrew/') || value.includes('/cellar/')) return 'homebrew'
  if (value.includes('/.volta/') || value.includes('/volta/')) return 'volta'
  if (value.includes('fnm_multishells')) return 'fnm'
  if (value.includes('/mise/')) return 'mise'
  if (value.includes('/.bun/')) return 'bun'
  if (value.includes('/pnpm/')) return 'pnpm'
  if (value.includes('/scoop/')) return 'scoop'
  if (value.includes('/library/python') || value.includes('/site-packages/') || value.includes('/scripts/')) return 'pip'
  if (value.includes('/.local/')) return 'native'
  return 'system'
}
function normalizeTools(values) { return [...new Set((Array.isArray(values) && values.length ? values : Object.keys(TOOLS)).map(String).filter((tool) => TOOLS[tool]))] }
function tailLines(value, count = 8) { return String(value || '').trim().split(/\r?\n/).slice(-count).join('\n') }
function quotePosix(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'` }

function createToolRuntimeManager(options = {}) {
  const execFile = options.execFile || defaultExecFile
  const fetchImpl = options.fetchImpl || fetch
  const platform = options.platform || process.platform
  const pathDelimiter = platform === 'win32' ? ';' : ':'
  const pathEnv = String(options.pathEnv ?? process.env.PATH ?? '')
  const homeDir = path.resolve(options.homeDir || process.env.HOME || process.env.USERPROFILE || '.')
  const commonBinDirs = options.commonBinDirs || COMMON_BIN_DIRS
  const runScript = options.runScript || (async (script) => execFile(platform === 'win32' ? 'cmd.exe' : 'bash', platform === 'win32' ? ['/d', '/s', '/c', script] : ['-c', script], { timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }))

  function executableNames(tool) { return platform === 'win32' ? [`${tool}.exe`, `${tool}.cmd`, `${tool}.bat`] : [tool] }
  async function isExecutable(file) {
    try { const stat = await fsp.stat(file); if (!stat.isFile()) return false; if (platform !== 'win32') await fsp.access(file, fs.constants.X_OK); return true } catch { return false }
  }
  async function candidatePaths(tool) {
    const dirs = [...pathEnv.split(pathDelimiter).filter(Boolean), path.join(homeDir, '.local', 'bin'), path.join(homeDir, '.volta', 'bin'), path.join(homeDir, '.bun', 'bin'), path.join(homeDir, '.npm-global', 'bin'), ...commonBinDirs]
    const seen = new Set(); const output = []
    for (const dir of dirs) for (const name of executableNames(tool)) {
      const candidate = path.resolve(dir, name)
      if (seen.has(candidate) || !(await isExecutable(candidate))) continue
      seen.add(candidate); output.push(candidate)
    }
    return output
  }
  async function probeBinary(file) {
    try {
      const output = await execFile(file, ['--version'], { timeout: 8000, maxBuffer: 1024 * 1024, env: { ...process.env, PATH: `${path.dirname(file)}${pathDelimiter}${pathEnv}` } })
      return { version: extractVersion(output.stdout || output.stderr), runnable: true, error: null }
    } catch (error) {
      const detail = tailLines(error.stderr || error.stdout || error.message, 4)
      return { version: null, runnable: false, error: detail || '版本命令执行失败' }
    }
  }
  async function latestVersion(tool) {
    const pkg = TOOLS[tool].package
    if (!pkg) return null
    try {
      const response = await fetchImpl(`https://registry.npmmirror.com/${pkg.startsWith('@') ? pkg.replace('/', '%2F') : pkg}/latest`, { headers: { accept: 'application/json' } })
      if (!response.ok) return null
      const body = await response.json(); return typeof body.version === 'string' ? body.version : null
    } catch { return null }
  }
  async function installations(tool) {
    const candidates = await candidatePaths(tool); const pathDirs = pathEnv.split(pathDelimiter).filter(Boolean).map((item) => path.resolve(item)); const defaultPath = candidates.find((candidate) => pathDirs.indexOf(path.dirname(candidate)) >= 0) || candidates[0]
    const output = []
    for (const candidate of candidates) {
      const status = await probeBinary(candidate); let real = candidate
      try { real = await fsp.realpath(candidate) } catch {}
      if (output.some((item) => item.realPath === real)) continue
      output.push({ path: candidate, realPath: real, ...status, source: inferInstallSource(real), isPathDefault: candidate === defaultPath })
    }
    return output.sort((a, b) => Number(b.isPathDefault) - Number(a.isPathDefault))
  }
  function npmCommand(tool) { const pkg = TOOLS[tool].package; return pkg ? `npm i -g ${pkg}@latest` : '' }
  function quoteExec(value) { return platform === 'win32' ? `"${String(value).replaceAll('"', '""')}"` : quotePosix(value) }
  function installCommand(tool) {
    const spec = TOOLS[tool]
    if (platform !== 'win32') return spec.installer || npmCommand(tool)
    if (tool === 'hermes') return 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 | iex"'
    if (tool === 'grok') return `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://x.ai/cli/install.ps1 | iex" || ${npmCommand(tool)}`
    return npmCommand(tool)
  }
  function planCommand(tool, installs, action) {
    const spec = TOOLS[tool]; const selected = installs.find((item) => item.isPathDefault) || (installs.length === 1 ? installs[0] : null)
    if (action === 'install') return { command: installCommand(tool), anchored: false }
    if (selected && spec.update?.length) return { command: [quoteExec(selected.path), ...spec.update.map(quoteExec)].join(' '), anchored: true }
    if (selected && spec.package) {
      const npm = path.join(path.dirname(selected.path), platform === 'win32' ? 'npm.cmd' : 'npm')
      if (fs.existsSync(npm)) return { command: `${quoteExec(npm)} i -g ${spec.package}@latest`, anchored: true }
    }
    return { command: spec.update ? `${tool} ${spec.update.join(' ')}${spec.package ? ` || ${npmCommand(tool)}` : ''}` : npmCommand(tool), anchored: false }
  }
  async function probeInstallations(values) {
    const output = []
    for (const tool of normalizeTools(values)) {
      const installs = await installations(tool); const versions = new Set(installs.map((item) => item.version)); const runnable = new Set(installs.map((item) => item.runnable)); const plan = planCommand(tool, installs, installs.length ? 'update' : 'install')
      output.push({ tool, label: TOOLS[tool].label, installs, isConflict: installs.length >= 2 && (versions.size > 1 || runnable.size > 1), needsConfirmation: installs.length >= 2, command: plan.command, anchored: plan.anchored })
    }
    return output
  }
  async function getToolVersions(values) {
    const reports = await probeInstallations(values)
    return Promise.all(reports.map(async (report) => {
      const selected = report.installs.find((item) => item.isPathDefault) || report.installs[0]
      return { name: report.tool, version: selected?.version || null, latestVersion: await latestVersion(report.tool), error: selected?.error || (selected ? null : '未安装'), installedButBroken: Boolean(selected && !selected.runnable), envType: platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : 'unknown', executablePath: selected?.path || null, source: selected?.source || null }
    }))
  }
  async function runLifecycle(values, actionInput) {
    const action = String(actionInput || '')
    if (!['install', 'update'].includes(action)) throw new Error(`不支持的工具操作: ${action}`)
    const tools = normalizeTools(values); if (!tools.length) throw new Error('没有选择受支持的工具')
    const reports = await probeInstallations(tools); const outcomes = []
    for (const tool of tools) {
      const report = reports.find((item) => item.tool === tool); const plan = planCommand(tool, report.installs, action)
      if (!plan.command) { outcomes.push({ tool, success: false, error: '没有可用安装命令' }); continue }
      try { await runScript(platform === 'win32' ? `@echo off\r\n${plan.command}` : `set -e\nset -o pipefail\n${plan.command}`); outcomes.push({ tool, success: true, anchored: plan.anchored }) }
      catch (error) { outcomes.push({ tool, success: false, error: tailLines(error.stderr || error.stdout || error.message) || '命令执行失败', anchored: plan.anchored }) }
    }
    return outcomes
  }

  return { getToolVersions, probeInstallations, runLifecycle }
}

module.exports = { TOOLS, extractVersion, inferInstallSource, normalizeTools, createToolRuntimeManager }
