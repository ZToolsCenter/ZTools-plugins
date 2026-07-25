'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')
const { execFile: execFileCallback } = require('node:child_process')
const { promisify } = require('node:util')

const defaultExecFile = promisify(execFileCallback)
const CLIENT_COMMANDS = Object.freeze({ claude: 'claude', codex: 'codex', gemini: 'gemini', opencode: 'opencode', openclaw: 'openclaw', hermes: 'hermes', grokbuild: 'grok' })

function validateEnvValue(value) { const text = String(value ?? ''); if (text.includes('\0')) throw new Error('Provider 环境变量包含空字符'); return text }
function providerEnvironment(client, provider) {
  if (!CLIENT_COMMANDS[client]) throw new Error(`不支持的客户端: ${client}`)
  const key = validateEnvValue(provider.apiKey || '')
  const baseUrl = validateEnvValue(provider.baseUrl || '')
  const model = validateEnvValue(provider.model || '')
  const common = { ZTOOLS_PROVIDER_ID: validateEnvValue(provider.id || ''), ZTOOLS_PROVIDER_NAME: validateEnvValue(provider.name || '') }
  if (client === 'claude') return { ...common, [provider.claudeAuthField === 'ANTHROPIC_API_KEY' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN']: key, ANTHROPIC_BASE_URL: baseUrl, ...(model ? { ANTHROPIC_MODEL: model } : {}) }
  if (client === 'codex') return { ...common, OPENAI_API_KEY: key, OPENAI_BASE_URL: baseUrl, ...(model ? { OPENAI_MODEL: model } : {}) }
  if (client === 'gemini') return { ...common, GEMINI_API_KEY: key, GOOGLE_GEMINI_BASE_URL: baseUrl, ...(model ? { GEMINI_MODEL: model } : {}) }
  if (client === 'grokbuild') return { ...common, XAI_API_KEY: key, XAI_BASE_URL: baseUrl, ...(model ? { XAI_MODEL: model } : {}) }
  return { ...common, OPENAI_API_KEY: key, OPENAI_BASE_URL: baseUrl, ...(model ? { OPENAI_MODEL: model } : {}) }
}
function quotePosix(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'` }
function quotePowerShell(value) { return `'${String(value).replaceAll("'", "''")}'` }

function createProviderTerminalManager(options = {}) {
  const platform = options.platform || process.platform
  const execFile = options.execFile || defaultExecFile
  const homeDir = path.resolve(options.homeDir || process.env.HOME || process.env.USERPROFILE || '.')

  async function resolveCwd(input) {
    const raw = String(input || homeDir)
    if (/[\r\n\0]/.test(raw)) throw new Error('终端工作目录包含非法字符')
    const target = await fsp.realpath(path.resolve(raw)).catch((error) => { if (error.code === 'ENOENT') throw new Error('终端工作目录不存在'); throw error })
    const stat = await fsp.stat(target).catch((error) => { if (error.code === 'ENOENT') throw new Error('终端工作目录不存在'); throw error })
    if (!stat.isDirectory()) throw new Error('终端工作路径不是目录')
    return target
  }
  async function launch(client, provider, cwdInput) {
    if (!provider || typeof provider !== 'object') throw new Error('Provider 不存在')
    if (!provider.apiKey) throw new Error('该 Provider 没有可用于独立终端的 API Key')
    const cwd = await resolveCwd(cwdInput)
    const env = providerEnvironment(client, provider)
    const command = CLIENT_COMMANDS[client]
    if (platform === 'darwin') {
      const exports = Object.entries(env).map(([key, value]) => `export ${key}=${quotePosix(value)}`).join(' && ')
      const shellCommand = `cd ${quotePosix(cwd)} && ${exports} && exec ${command}`
      const escaped = shellCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const script = `tell application "Terminal"\nactivate\ndo script "${escaped}"\nend tell`
      await execFile('osascript', ['-e', script], { timeout: 10000 })
    } else if (platform === 'win32') {
      const assignments = Object.entries(env).map(([key, value]) => `$env:${key}=${quotePowerShell(value)}`).join('; ')
      const shellCommand = `${assignments}; Set-Location ${quotePowerShell(cwd)}; ${command}`
      await execFile('powershell.exe', ['-NoProfile', '-Command', `Start-Process powershell.exe -ArgumentList @('-NoExit','-Command',${quotePowerShell(shellCommand)})`], { timeout: 10000 })
    } else {
      const exports = Object.entries(env).map(([key, value]) => `export ${key}=${quotePosix(value)}`).join(' && ')
      await execFile('x-terminal-emulator', ['-e', 'bash', '-lc', `cd ${quotePosix(cwd)} && ${exports} && exec ${command}`], { timeout: 10000 })
    }
    return { launched: true, client, providerId: provider.id, cwd }
  }
  return { launch }
}

module.exports = { CLIENT_COMMANDS, providerEnvironment, createProviderTerminalManager }
