'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const JSON5 = require('json5')
const YAML = require('yaml')
const { getClaudeDesktopPaths } = require('./claudeDesktopManager')

const MCP_CLIENTS = ['claude', 'claude-desktop', 'codex', 'gemini', 'opencode', 'hermes', 'grokbuild']
const PROMPT_DIRS = {
  claude: ['.claude', 'commands'], codex: ['.codex', 'prompts'], gemini: ['.gemini', 'commands'],
  opencode: ['.config', 'opencode', 'commands'], openclaw: ['.openclaw', 'prompts'], hermes: ['.hermes', 'prompts'], grokbuild: ['.grok']
}
const MAX_PROMPT_FILE_BYTES = 2 * 1024 * 1024
const MAX_MCP_CONFIG_BYTES = 2 * 1024 * 1024

function safeId(value) {
  const id = String(value || '').trim()
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('ID 只能包含字母、数字、点、下划线和连字符')
  return id
}

function createExtensionManager(options = {}) {
  const homeDir = path.resolve(options.homeDir)
  const dataDir = path.resolve(options.dataDir)
  const storePath = path.join(dataDir, 'extensions.json')
  const desktopPaths = getClaudeDesktopPaths({ homeDir })
  const paths = {
    claude: path.join(homeDir, '.claude.json'),
    ...(desktopPaths.supported ? { 'claude-desktop': desktopPaths.normalConfigPath } : {}),
    codex: path.join(homeDir, '.codex', 'config.toml'),
    gemini: path.join(homeDir, '.gemini', 'settings.json'),
    opencode: path.join(homeDir, '.config', 'opencode', 'opencode.json'),
    hermes: path.join(process.env.HERMES_HOME || path.join(homeDir, '.hermes'), 'config.yaml'),
    grokbuild: path.join(homeDir, '.grok', 'config.toml')
  }
  const currentPromptPaths = {
    claude: path.join(homeDir, '.claude', 'CLAUDE.md'),
    codex: path.join(homeDir, '.codex', 'AGENTS.md'),
    gemini: path.join(homeDir, '.gemini', 'GEMINI.md'),
    opencode: path.join(homeDir, '.config', 'opencode', 'AGENTS.md'),
    openclaw: path.join(homeDir, '.openclaw', 'AGENTS.md'),
    hermes: path.join(process.env.HERMES_HOME || path.join(homeDir, '.hermes'), 'AGENTS.md'),
    grokbuild: path.join(homeDir, '.grok', 'AGENTS.md')
  }

  async function readStore() {
    try {
      const value = JSON.parse(await fsp.readFile(storePath, 'utf8'))
      return { version: 1, mcpServers: Array.isArray(value.mcpServers) ? value.mcpServers : [], prompts: Array.isArray(value.prompts) ? value.prompts : [] }
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, mcpServers: [], prompts: [] }
      throw new Error(`读取扩展数据失败: ${error.message}`)
    }
  }

  async function atomicWrite(filePath, content) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    if (fs.existsSync(filePath)) await fsp.copyFile(filePath, `${filePath}.bak`)
    const temp = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`
    await fsp.writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
    await fsp.rename(temp, filePath)
  }
  const writeJson = (filePath, value) => atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`)
  async function readJson5(filePath, fallback = {}) {
    try { return JSON5.parse(await fsp.readFile(filePath, 'utf8')) } catch (error) {
      if (error.code === 'ENOENT') return fallback
      throw new Error(`解析配置失败 (${filePath}): ${error.message}`)
    }
  }
  async function writeStore(value) { await writeJson(storePath, value) }

  async function readRegularText(filePath, maxBytes = MAX_MCP_CONFIG_BYTES) {
    const stat = await fsp.lstat(filePath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (!stat) return null
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`配置路径不是安全的普通文件: ${filePath}`)
    if (stat.size > maxBytes) throw new Error(`配置文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB 限制`)
    return fsp.readFile(filePath, 'utf8')
  }

  function validateMcp(input) {
    const item = { ...input }
    item.id = safeId(item.id || crypto.randomUUID())
    item.name = String(item.name || item.id).trim()
    item.type = item.type === 'http' ? 'http' : 'command'
    item.command = String(item.command || '').trim()
    item.args = Array.isArray(item.args) ? item.args.map(String) : []
    item.url = String(item.url || '').trim()
    item.env = item.env && typeof item.env === 'object' ? item.env : {}
    item.headers = item.headers && typeof item.headers === 'object' ? item.headers : {}
    item.apps = item.apps && typeof item.apps === 'object' ? item.apps : {}
    if (!item.name) throw new Error('MCP 名称不能为空')
    if (item.type === 'command' && !item.command) throw new Error('本地 MCP 必须填写命令')
    if (item.type === 'http') {
      try { new URL(item.url) } catch { throw new Error('远程 MCP URL 无效') }
    }
    return item
  }

  function validatePrompt(input) {
    const item = { ...input }
    item.id = safeId(item.id || crypto.randomUUID())
    item.name = String(item.name || '').trim()
    item.content = String(item.content || '')
    item.description = String(item.description || '')
    item.apps = item.apps && typeof item.apps === 'object' ? item.apps : {}
    if (!item.name || !item.content.trim()) throw new Error('Prompt 名称和内容不能为空')
    return item
  }

  async function listExtensions() { return readStore() }
  async function saveMcp(input, options = {}) {
    const item = validateMcp(input); const store = await readStore(); const index = store.mcpServers.findIndex((v) => v.id === item.id)
    if (index >= 0 && options.createOnly) throw new Error(`MCP Server ID 已存在: ${item.id}`)
    if (index >= 0) store.mcpServers.splice(index, 1, item); else store.mcpServers.push(item)
    await writeStore(store); return item
  }
  async function savePrompt(input) {
    const item = validatePrompt(input); const store = await readStore(); const index = store.prompts.findIndex((v) => v.id === item.id)
    if (index >= 0) store.prompts.splice(index, 1, item); else store.prompts.push(item)
    await writeStore(store); return item
  }

  function parseTomlValue(rawInput) {
    const raw = String(rawInput || '').trim()
    try { return JSON.parse(raw) } catch {}
    if (raw.startsWith('{') && raw.endsWith('}')) {
      const result = {}
      const pairPattern = /(?:"([^"]+)"|([A-Za-z0-9_.-]+))\s*=\s*("(?:\\.|[^"\\])*")/g
      for (const match of raw.matchAll(pairPattern)) result[match[1] || match[2]] = JSON.parse(match[3])
      return result
    }
    return raw.replace(/^['"]|['"]$/g, '')
  }

  function parseTomlMcpSections(text) {
    const result = {}; let current = null
    for (const line of String(text || '').split(/\r?\n/)) {
      const section = /^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_.-]+))]\s*$/.exec(line)
      if (section) { current = section[1] || section[2]; result[current] = {}; continue }
      if (/^\s*\[/.test(line)) { current = null; continue }
      if (!current || /^\s*(?:#|$)/.test(line)) continue
      const field = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
      if (field) result[current][field[1]] = parseTomlValue(field[2])
    }
    return result
  }

  function normalizeImportedMcp(id, specInput, client) {
    const spec = specInput && typeof specInput === 'object' ? specInput : {}
    const localCommand = Array.isArray(spec.command) ? spec.command.map(String) : null
    const remote = spec.type === 'remote' || Boolean(spec.url)
    return validateMcp({
      id,
      name: String(spec.name || id),
      type: remote ? 'http' : 'command',
      command: localCommand ? localCommand[0] : String(spec.command || ''),
      args: localCommand ? localCommand.slice(1) : (Array.isArray(spec.args) ? spec.args : []),
      url: String(spec.url || ''),
      env: spec.environment || spec.env || {},
      headers: spec.http_headers || spec.headers || {},
      apps: { [client]: true }
    })
  }

  async function readMcpSource(client) {
    const filePath = paths[client]
    if (!filePath) throw new Error(`${client} 暂不支持 MCP 导入`)
    const text = await readRegularText(filePath)
    if (text === null) return {}
    if (client === 'codex' || client === 'grokbuild') return parseTomlMcpSections(text)
    if (client === 'hermes') return YAML.parse(text)?.mcp_servers || {}
    const config = JSON5.parse(text)
    return client === 'opencode' ? (config.mcp || {}) : (config.mcpServers || {})
  }

  async function importMcpFromApps() {
    const store = await readStore(); const imported = []; const updated = []; const errors = []
    for (const client of ['claude', 'codex', 'gemini', 'grokbuild', 'opencode', 'hermes']) {
      try {
        const servers = await readMcpSource(client)
        for (const [rawId, spec] of Object.entries(servers && typeof servers === 'object' ? servers : {})) {
          let incoming
          try { incoming = normalizeImportedMcp(rawId, spec, client) } catch (error) { errors.push(`${client}/${rawId}: ${error.message}`); continue }
          const existing = store.mcpServers.find((item) => item.id === incoming.id)
          if (existing) { existing.apps = { ...existing.apps, [client]: true }; updated.push(`${client}:${incoming.id}`) }
          else { store.mcpServers.push(incoming); imported.push(`${client}:${incoming.id}`) }
        }
      } catch (error) { errors.push(`${client}: ${error.message}`) }
    }
    if (imported.length || updated.length) await writeStore(store)
    return { imported, updated, errors }
  }

  async function getClaudeMcpStatus() {
    const text = await readRegularText(paths.claude)
    if (text === null) return { userConfigPath: paths.claude, userConfigExists: false, serverCount: 0 }
    let root
    try { root = JSON.parse(text) } catch (error) { throw new Error(`解析 Claude MCP 配置失败: ${error.message}`) }
    return { userConfigPath: paths.claude, userConfigExists: true, serverCount: Object.keys(root?.mcpServers && typeof root.mcpServers === 'object' ? root.mcpServers : {}).length }
  }

  function redactSensitiveTree(value) {
    if (Array.isArray(value)) return value.map(redactSensitiveTree)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /(?:api.?key|token|secret|password|authorization)/i.test(key) ? (item ? '••••••••' : item) : redactSensitiveTree(item)]))
  }

  async function readClaudeMcpConfig() {
    const text = await readRegularText(paths.claude)
    if (text === null) return null
    try { return `${JSON.stringify(redactSensitiveTree(JSON.parse(text)), null, 2)}\n` } catch (error) { throw new Error(`解析 Claude MCP 配置失败: ${error.message}`) }
  }

  async function validateMcpCommand(commandInput) {
    const command = String(commandInput || '').trim()
    if (!command || command.includes('\0') || /[\r\n]/.test(command)) return false
    const candidates = []
    if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) candidates.push(path.resolve(command))
    else {
      const extensions = process.platform === 'win32' ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';') : ['']
      for (const directory of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) for (const extension of extensions) candidates.push(path.join(directory, `${command}${extension}`))
    }
    for (const candidate of candidates) {
      try { await fsp.access(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return true } catch {}
    }
    return false
  }

  async function getCurrentPromptFileContent(clientInput) {
    const client = String(clientInput || '')
    const filePath = currentPromptPaths[client]
    if (!filePath) throw new Error(`${client || '该客户端'} 暂不支持全局 Prompt`)
    const stat = await fsp.lstat(filePath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (!stat) return null
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('当前 Prompt 路径不是安全的普通文件')
    if (stat.size > MAX_PROMPT_FILE_BYTES) throw new Error('当前 Prompt 文件超过 2 MB 限制')
    return fsp.readFile(filePath, 'utf8')
  }

  async function importPromptFromFile(clientInput) {
    const client = String(clientInput || '')
    const content = await getCurrentPromptFileContent(client)
    if (content === null) throw new Error('当前客户端的全局 Prompt 文件不存在')
    if (!content.trim()) throw new Error('当前客户端的全局 Prompt 文件为空')
    const now = Date.now()
    const item = await savePrompt({
      id: `imported-${now}-${crypto.randomBytes(2).toString('hex')}`,
      name: `导入的 Prompt ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`,
      description: `从 ${client} 当前全局 Prompt 文件导入`,
      content,
      apps: {}
    })
    return item
  }

  function mcpConfig(item, client) {
    if (client === 'opencode') return item.type === 'http'
      ? { type: 'remote', url: item.url, headers: item.headers, enabled: true }
      : { type: 'local', command: [item.command, ...item.args], environment: item.env, enabled: true }
    return item.type === 'http'
      ? { url: item.url, headers: item.headers }
      : { command: item.command, args: item.args, env: item.env }
  }

  function stripCodexMcp(text, id) {
    const start = `# >>> ztools-mcp:${id} >>>`; const end = `# <<< ztools-mcp:${id} <<<`
    const lines = String(text || '').split(/\r?\n/); const output = []; let managed = false
    for (const line of lines) { if (line.trim() === start) { managed = true; continue } if (line.trim() === end) { managed = false; continue } if (!managed) output.push(line) }
    return output.join('\n').trimEnd()
  }
  function toml(value) { return JSON.stringify(value) }
  function tomlTable(value) { return `{ ${Object.entries(value || {}).map(([key, item]) => `${toml(key)} = ${toml(String(item))}`).join(', ')} }` }

  async function applyMcp(item, client, enabled) {
    if (!MCP_CLIENTS.includes(client)) throw new Error(`${client} 暂不支持 MCP 同步`)
    if (!paths[client]) throw new Error('当前平台不支持 Claude Desktop MCP 同步')
    if (client === 'codex') {
      const current = await fsp.readFile(paths.codex, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
      const preserved = stripCodexMcp(current, item.id)
      let block = ''
      if (enabled) {
        const lines = [`# >>> ztools-mcp:${item.id} >>>`, `[mcp_servers.${item.id}]`]
        if (item.type === 'http') { lines.push(`url = ${toml(item.url)}`); if (Object.keys(item.headers).length) lines.push(`http_headers = ${toml(item.headers)}`) }
        else { lines.push(`command = ${toml(item.command)}`, `args = ${toml(item.args)}`); if (Object.keys(item.env).length) lines.push(`env = ${toml(item.env)}`) }
        lines.push(`# <<< ztools-mcp:${item.id} <<<`); block = lines.join('\n')
      }
      await atomicWrite(paths.codex, `${preserved}${preserved && block ? '\n\n' : ''}${block}${preserved || block ? '\n' : ''}`)
      return
    }
    if (client === 'grokbuild') {
      const current = await fsp.readFile(paths.grokbuild, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
      const preserved = stripCodexMcp(current, item.id); let block = ''
      if (enabled) {
        const lines = [`# >>> ztools-mcp:${item.id} >>>`, `[mcp_servers.${item.id}]`]
        if (item.type === 'http') { lines.push(`url = ${toml(item.url)}`); if (Object.keys(item.headers).length) lines.push(`headers = ${tomlTable(item.headers)}`) }
        else { lines.push(`command = ${toml(item.command)}`, `args = ${toml(item.args)}`); if (Object.keys(item.env).length) lines.push(`env = ${tomlTable(item.env)}`) }
        lines.push(`# <<< ztools-mcp:${item.id} <<<`); block = lines.join('\n')
      }
      await atomicWrite(paths.grokbuild, `${preserved}${preserved && block ? '\n\n' : ''}${block}${preserved || block ? '\n' : ''}`); return
    }
    if (client === 'hermes') {
      const source = await fsp.readFile(paths.hermes, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
      const config = YAML.parse(source) || {}; config.mcp_servers = config.mcp_servers && typeof config.mcp_servers === 'object' ? config.mcp_servers : {}
      if (enabled) config.mcp_servers[item.id] = mcpConfig(item, client); else delete config.mcp_servers[item.id]
      await atomicWrite(paths.hermes, YAML.stringify(config)); return
    }
    const config = await readJson5(paths[client], {})
    const key = client === 'opencode' ? 'mcp' : 'mcpServers'; config[key] = config[key] && typeof config[key] === 'object' ? config[key] : {}
    if (enabled) config[key][item.id] = mcpConfig(item, client); else delete config[key][item.id]
    await writeJson(paths[client], config)
  }

  async function setMcpEnabled(idInput, client, enabled) {
    const id = safeId(idInput); const store = await readStore(); const item = store.mcpServers.find((v) => v.id === id)
    if (!item) throw new Error('MCP Server 不存在')
    await applyMcp(item, client, enabled); item.apps = { ...item.apps, [client]: Boolean(enabled) }; await writeStore(store)
    return { id, client, enabled: Boolean(enabled) }
  }

  async function setPromptEnabled(idInput, client, enabled) {
    const id = safeId(idInput); const store = await readStore(); const item = store.prompts.find((v) => v.id === id)
    if (!item) throw new Error('Prompt 不存在')
    const parts = PROMPT_DIRS[client]; if (!parts) throw new Error(`${client} 暂不支持 Prompt 同步`)
    const extension = client === 'gemini' ? '.toml' : '.md'; const target = client === 'grokbuild' ? path.join(homeDir, ...parts, 'AGENTS.md') : path.join(homeDir, ...parts, `${id}${extension}`)
    if (enabled) {
      const content = client === 'gemini' ? `description = ${JSON.stringify(item.description || item.name)}\nprompt = ${JSON.stringify(item.content)}\n` : `# ${item.name}\n\n${item.content.trim()}\n`
      await atomicWrite(target, content)
      if (client === 'grokbuild') for (const prompt of store.prompts) if (prompt.id !== id && prompt.apps?.grokbuild) prompt.apps.grokbuild = false
    } else await fsp.rm(target, { force: true })
    item.apps = { ...item.apps, [client]: Boolean(enabled) }; await writeStore(store)
    return { id, client, enabled: Boolean(enabled), target }
  }

  async function removeMcp(idInput) {
    const id = safeId(idInput); const store = await readStore(); const item = store.mcpServers.find((v) => v.id === id); if (!item) return false
    for (const [client, enabled] of Object.entries(item.apps || {})) if (enabled) await applyMcp(item, client, false)
    store.mcpServers = store.mcpServers.filter((v) => v.id !== id); await writeStore(store); return true
  }
  async function removePrompt(idInput) {
    const id = safeId(idInput); const store = await readStore(); const item = store.prompts.find((v) => v.id === id); if (!item) return false
    for (const [client, enabled] of Object.entries(item.apps || {})) if (enabled) await setPromptEnabled(id, client, false)
    const refreshed = await readStore(); refreshed.prompts = refreshed.prompts.filter((v) => v.id !== id); await writeStore(refreshed); return true
  }

  return { listExtensions, saveMcp, savePrompt, importMcpFromApps, getClaudeMcpStatus, readClaudeMcpConfig, validateMcpCommand, getCurrentPromptFileContent, importPromptFromFile, setMcpEnabled, setPromptEnabled, removeMcp, removePrompt }
}

module.exports = { MCP_CLIENTS, PROMPT_DIRS, MAX_PROMPT_FILE_BYTES, MAX_MCP_CONFIG_BYTES, createExtensionManager }
