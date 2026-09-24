// Npm Lite preload 服务：双源聚合搜索 + 包元数据 + 代理配置 + 本地文件读写 +
//                     全局包管理 + 本地 Node 版本探测
// 1. npm 官方 registry.npmjs.org
// 2. npmmirror registry.npmmirror.com（默认镜像，固定不变；用户通过 HTTP 代理访问官方源）

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execFileP = promisify(execFile)

const SEARCH_SIZE = 20
const TIMEOUT_MS = 5000
const OFFICIAL_BASE = 'https://registry.npmjs.org'
const MIRROR_BASE = 'https://registry.npmmirror.com'

// ------------------------------------------------------------------
// PATH 增强：Electron 渲染进程继承的 PATH 经常被沙箱化，会丢掉
// /usr/local/bin、/opt/homebrew/bin、nvm 各自的 bin；这里拼回去。
// ------------------------------------------------------------------
function buildAugmentedEnv() {
  const sep = process.platform === 'win32' ? ';' : ':'
  const extras = []

  if (process.platform === 'darwin') {
    extras.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin')
  } else if (process.platform === 'linux') {
    extras.push('/usr/local/bin', '/usr/bin', `${os.homedir()}/.local/bin`)
  } else if (process.platform === 'win32') {
    if (process.env.ProgramFiles) extras.push(path.join(process.env.ProgramFiles, 'nodejs'))
    if (process.env['ProgramFiles(x86)']) extras.push(path.join(process.env['ProgramFiles(x86)'], 'nodejs'))
  }

  // 把 ~/.nvm/versions/node/*/bin 也加进 PATH（即便用户没装 nvm-fish 也不会出问题）
  if (process.platform !== 'win32') {
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node')
    try {
      if (fs.existsSync(nvmDir)) {
        for (const v of fs.readdirSync(nvmDir)) {
          const bin = path.join(nvmDir, v, 'bin')
          if (fs.existsSync(bin)) extras.push(bin)
        }
      }
    } catch { /* 忽略 */ }
  } else {
    // nvm-windows：bin 直接在 NVM_HOME\v\<version>\ 下（带 node.exe / npm.cmd）
    const nvmHome = process.env.NVM_HOME
    if (nvmHome) {
      const vDir = path.join(nvmHome, 'v')
      try {
        if (fs.existsSync(vDir)) {
          for (const v of fs.readdirSync(vDir)) {
            const p = path.join(vDir, v)
            if (fs.existsSync(p)) extras.push(p)
          }
        }
      } catch { /* 忽略 */ }
    }
  }

  const augmentedPath = [...extras, process.env.PATH || ''].filter(Boolean).join(sep)
  const home = os.homedir()

  // 探测 nvm 安装目录（脚本里 export NVM_DIR / NVM_BIN 让 nvm 包了 npm 时认得回 home）
  let nvmDir = process.env.NVM_DIR || ''
  if (!nvmDir && process.platform !== 'win32') {
    const nvmCandidate = path.join(home, '.nvm')
    try { if (fs.existsSync(path.join(nvmCandidate, 'nvm.sh'))) nvmDir = nvmCandidate } catch {}
  }
  const nvmBin = process.env.NVM_BIN
    || (nvmDir ? path.join(nvmDir, 'versions', 'node') : '')

  return {
    ...process.env,
    // Electron 渲染进程经常把 HOME / USER 从 process.env 剥掉；显式兜底，
    // 否则 npm / pnpm 等子进程会 prefix fallback 到 /tmp 等位置，列表变空。
    HOME: process.env.HOME || home,
    USER: process.env.USER || process.env.USERNAME || '',
    USERPROFILE: process.env.USERPROFILE || (process.platform === 'win32' ? home : undefined),
    LOGNAME: process.env.LOGNAME || process.env.USER || process.env.USERNAME || '',
    // nvm 的 npm wrapper 某些版本会读 NVM_DIR / NVM_BIN
    NVM_DIR: nvmDir,
    NVM_BIN: nvmBin,
    PATH: augmentedPath,
    NO_UPDATE_NOTIFIER: '1',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  }
}

const SHELL_ENV = buildAugmentedEnv()

if (window.ztools?.http?.setHeaders) {
  window.ztools.http.setHeaders({ 'User-Agent': 'ztools-npm/1.0' })
}

// 启动时从 dbStorage 恢复代理（与 maven 一致）
try {
  const saved = window.ztools?.dbStorage?.getItem?.('npm-proxy')
  if (typeof saved === 'string' && saved.trim()) applyProxy(saved.trim())
} catch {}

class ServiceError extends Error {
  constructor(message, meta) {
    super(message)
    this.name = 'ServiceError'
    this.url = meta.url
    this.status = meta.status
    this.durationMs = meta.durationMs
    this.body = meta.body
  }
}

async function fetchJson(url, init = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const durationMs = Date.now() - start
    if (!res.ok) {
      let body
      try { body = await res.text() } catch {}
      throw new ServiceError(`HTTP ${res.status}`, { url, status: res.status, durationMs, body })
    }
    return { json: await res.json(), durationMs }
  } catch (err) {
    const durationMs = Date.now() - start
    if (err instanceof ServiceError) throw err
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      throw new ServiceError(`请求超时（${timeoutMs}ms）`, { url, status: 0, durationMs, body: err.message })
    }
    throw new ServiceError(`网络错误：${err?.message || String(err)}`, { url, status: 0, durationMs, body: err?.stack })
  } finally {
    clearTimeout(timer)
  }
}

function encodeName(name) {
  return name.startsWith('@') ? encodeURIComponent(name) : name
}

function buildTerm(query) {
  if (query.kind === 'package') return query.name
  return query.text
}

async function searchSource(base, source, query) {
  const term = buildTerm(query)
  if (!term) return []
  const url = `${base}/-/v1/search?text=${encodeURIComponent(term)}&size=${SEARCH_SIZE}`
  const { json } = await fetchJson(url)
  return (json.objects ?? []).map(o => ({
    id: o.package?.name,
    name: o.package?.name,
    version: o.package.version,
    description: o.package.description ?? '',
    keywords: o.package.keywords ?? [],
    date: o.package.date ?? '',
    source,
  }))
}

function dedupeByName(list) {
  const map = new Map()
  const score = (it) =>
    (it.description ? 1 : 0) + ((it.keywords && it.keywords.length) ? 1 : 0) + (it.date ? 1 : 0)
  const ts = (it) => (it.date ? Date.parse(it.date) || 0 : 0)
  for (const item of list) {
    if (!item.name) continue
    const existing = map.get(item.name)
    if (!existing) { map.set(item.name, item); continue }
    if (score(item) > score(existing) || (score(item) === score(existing) && ts(item) > ts(existing))) {
      map.set(item.name, item)
    }
  }
  return [...map.values()]
}

async function npmSearch(query) {
  const settled = await Promise.allSettled([
    searchSource(OFFICIAL_BASE, 'npm', query),
    searchSource(MIRROR_BASE, 'npmmirror', query),
  ])
  const errors = {}
  const results = settled.map((r, i) => {
    const key = i === 0 ? 'npm' : 'npmmirror'
    if (r.status === 'fulfilled') return r.value
    console.warn(`${key} failed:`, r.reason)
    errors[key] = r.reason
    return []
  })
  const [npm, npmmirror] = results
  return {
    data: dedupeByName([...npm, ...npmmirror]),
    sources: { npm, npmmirror },
    errors,
  }
}

async function npmMeta(name, source = 'npm') {
  const base = source === 'npmmirror' ? MIRROR_BASE : OFFICIAL_BASE
  const url = `${base}/${encodeName(name)}`
  const { json } = await fetchJson(url)
  const time = json.time ?? {}
  const versions = Object.keys(json.versions ?? {}).map(v => ({
    v,
    time: time[v] ? Date.parse(time[v]) || 0 : 0,
  }))
  const lic = json.license
  return {
    name: json.name ?? name,
    description: json.description ?? '',
    distTags: json['dist-tags'] ?? {},
    versions,
    readme: json.readme ?? '',
    license: typeof lic === 'string' ? lic : (lic && lic.type) || '',
    homepage: json.homepage ?? '',
    repository: (typeof json.repository === 'string' ? json.repository : (json.repository && json.repository.url) || '') || '',
  }
}

// 通用 npm 调用：传 npmBin 用绝对路径（确保走指定 Node 自带的 npm），
// 传空则用 PATH 上的 'npm'（即系统默认，可能根本不存在）。
function runNpm(npmBin, args, opts = {}) {
  const cmd = npmBin || 'npm'
  if (npmBin && !fs.existsSync(npmBin)) {
    return Promise.reject(new Error(`npm 可执行文件不存在：${npmBin}`))
  }
  return execFileP(cmd, args, { timeout: 15000, windowsHide: true, env: SHELL_ENV, ...opts })
}

// 列出指定 Node 版本下安装的全局包
async function npmListGlobal({ npmBin, prefix } = {}) {
  let stdout = '', stderr = ''
  const args = ['ls', '-g', '--depth=0', '--json']
  // 关键：explicit --prefix 让 npm 别自己乱猜 prefix
  // 不带这 flag 时 nvm 的 npm wrapper/shim 会读到错误 prefix，返回 {"name":"lib"} 这种退化输出
  if (prefix) args.push('--prefix', prefix)
  try {
    const r = await runNpm(npmBin, args)
    stdout = r.stdout || ''
    stderr = r.stderr || ''
  } catch (e) {
    // npm 在有 extraneous / missing 包时退出码非 0，但 stdout 仍有有效 JSON
    stdout = (e && e.stdout) || ''
    stderr = (e && e.stderr) || ''
    if (!stdout) {
      const tail = stderr ? ` / npm-stderr: ${String(stderr).trim().slice(0, 200)}` : ''
      const msg = (e?.message || String(e)) + tail
      if (/ENOENT/.test(msg)) {
        throw new Error('未在 PATH 中找到 npm。请先安装 Node.js（https://nodejs.org 或 brew install node），或到「设置」配置 HTTP 代理后重试')
      }
      throw new Error('调用 npm 失败：' + msg)
    }
  }
  let json
  try { json = JSON.parse(stdout) } catch {
    throw new Error('无法解析 npm 输出：' + stdout.slice(0, 200))
  }
  const deps = json?.dependencies || {}
  const packages = Object.entries(deps)
    .map(([name, info]) => ({
      name,
      version: info?.version || '',
      description: info?.description || '',
      path: info?.path || '',
      extraneous: !!info?.extraneous,
      missing: !!info?.missing,
    }))
  return {
    packages,
    debug: {
      npmBin: npmBin || 'npm (PATH 上第一个)',
      prefix: json?.path || json?.prefix || prefix || '(未声明)',
      problems: json?.problems || [],
      rawStdout: stdout.length > 2000 ? stdout.slice(0, 2000) + '\n…(截断)' : stdout,
      rawStderr: stderr.length > 500 ? stderr.slice(0, 500) + '\n…(截断)' : stderr,
    },
  }
}

// 卸载指定 Node 版本下的全局包
async function npmUninstallGlobal(name, { npmBin, prefix } = {}) {
  if (typeof name !== 'string' ||
      !/^@?[a-z0-9][a-z0-9._-]{0,213}(\/[a-z0-9][a-z0-9._-]{0,213})?$/i.test(name)) {
    throw new Error('非法的包名：' + String(name))
  }
  const args = ['uninstall', '-g', name]
  if (prefix) args.push('--prefix', prefix)
  const { stdout, stderr } = await runNpm(npmBin, args, { timeout: 60000 }).catch((e) => {
    if (/ENOENT/.test(e?.message || '')) {
      throw new Error('未在 PATH 中找到 npm。请先安装 Node.js（https://nodejs.org 或 brew install node）')
    }
    throw e
  })
  return { stdout: stdout || '', stderr: stderr || '' }
}

// 更新指定 Node 版本下的全局包到最新版
async function npmUpdateGlobal(name, { npmBin, prefix } = {}) {
  if (typeof name !== 'string' ||
      !/^@?[a-z0-9][a-z0-9._-]{0,213}(\/[a-z0-9][a-z0-9._-]{0,213})?$/i.test(name)) {
    throw new Error('非法的包名：' + String(name))
  }
  const args = ['install', '-g', `${name}@latest`]
  if (prefix) args.push('--prefix', prefix)
  const { stdout, stderr } = await runNpm(npmBin, args, { timeout: 180000 }).catch((e) => {
    if (/ENOENT/.test(e?.message || '')) {
      throw new Error('未在 PATH 中找到 npm。请先安装 Node.js（https://nodejs.org 或 brew install node）')
    }
    throw e
  })
  return { stdout: stdout || '', stderr: stderr || '' }
}

// 更新指定 Node 版本下的所有全局包（按 semver 范围）
async function npmUpdateAllGlobal({ npmBin, prefix } = {}) {
  const args = ['update', '-g']
  if (prefix) args.push('--prefix', prefix)
  const { stdout, stderr } = await runNpm(npmBin, args, { timeout: 600000 }).catch((e) => {
    if (/ENOENT/.test(e?.message || '')) {
      throw new Error('未在 PATH 中找到 npm。请先安装 Node.js')
    }
    throw e
  })
  return { stdout: stdout || '', stderr: stderr || '' }
}

// 跨版本"复制"包：在目标版本上 install <pkg>@<exactVer>
// 因为有的包不支持所有 Node 版本，所以按精确版本安装而不是 latest
async function npmInstallGlobal({ name, version, npmBin, prefix, registry } = {}) {
  if (typeof name !== 'string' ||
      !/^@?[a-z0-9][a-z0-9._-]{0,213}(\/[a-z0-9][a-z0-9._-]{0,213})?$/i.test(name)) {
    throw new Error('非法的包名：' + String(name))
  }
  // 用 <name>@<exactVersion> 锁版本（防 latest 装到不支持当前 Node 的版本）
  const spec = version ? `${name}@${version}` : name
  const args = ['install', '-g', spec]
  if (prefix) args.push('--prefix', prefix)
  if (registry) args.push('--registry', registry)
  const { stdout, stderr } = await runNpm(npmBin, args, { timeout: 180000 }).catch((e) => {
    if (/ENOENT/.test(e?.message || '')) {
      throw new Error('未在 PATH 中找到 npm。请先安装 Node.js（https://nodejs.org 或 brew install node）')
    }
    throw e
  })
  return { stdout: stdout || '', stderr: stderr || '' }
}

// 计算某个 Node 版本对应的 npm 可执行文件绝对路径 + 它所属 prefix
// 返回 { npmBin, prefix }：prefix = npmBin 的父目录的父目录（vXX.YY.Z/）
function npmPathsForVersion(manager, sourceDir, version) {
  let npmBin = ''
  if (process.platform !== 'win32') {
    switch (manager) {
      case 'nvm':
      case 'volta':
        npmBin = path.join(sourceDir, version, 'bin', 'npm')
        break
      case 'fnm': {
        // fnm 两种 layout 都试一下
        const cands = [
          path.join(sourceDir, version, 'installation', 'bin', 'npm'),
          path.join(sourceDir, version, 'bin', 'npm'),
        ]
        npmBin = cands.find(p => fs.existsSync(p)) || cands[0]
        break
      }
      case 'nvm-windows':
        npmBin = ''
        break
      default:
        return { npmBin: '', prefix: '' }
    }
  } else {
    // Windows
    switch (manager) {
      case 'nvm':
      case 'nvm-windows':
        npmBin = path.join(sourceDir, version, 'npm.cmd')
        break
      case 'fnm':
      case 'volta':
        npmBin = path.join(sourceDir, version, 'npm.cmd')
        break
      default:
        return { npmBin: '', prefix: '' }
    }
  }
  // prefix = dirname(dirname(npmBin))：.../vXX.YY.Z/bin/npm → .../vXX.YY.Z/
  let prefix = ''
  if (npmBin) {
    try { prefix = path.resolve(path.dirname(npmBin), '..') } catch { prefix = '' }
  }
  return { npmBin, prefix }
}

// 保留旧函数名（不要 breaking）
const npmBinForVersion = (manager, sourceDir, version) =>
  npmPathsForVersion(manager, sourceDir, version).npmBin

// 探测用户当前 shell 实际在用的全局 Node（PATH 上的 node）
// 解析 nvm 默认别名（支持 v22.22.0 / 22.22.0 / 22 / lts/iron / node 等）
function resolveNvmAlias(nvmRoot, alias) {
  if (!alias) return null
  const t = alias.trim()
  if (/^v?\d+\.\d+\.\d+$/.test(t)) return t.replace(/^v/, '')
  if (/^\d+$/.test(t)) {
    // 大版本别名（如 default=22）：取该大版本下最新已安装版本
    const major = t
    try {
      const dir = path.join(nvmRoot, 'versions', 'node')
      if (fs.existsSync(dir)) {
        const inst = fs.readdirSync(dir)
          .filter(n => n.startsWith(`v${major}.`))
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
        if (inst.length) return inst[0].replace(/^v/, '')
      }
    } catch {}
    return null
  }
  if (t.startsWith('lts/')) {
    // lts/iron → ~/.nvm/alias/lts/iron 里存真实版本号
    try {
      const f = path.join(nvmRoot, 'alias', t)
      if (fs.existsSync(f)) {
        const c = fs.readFileSync(f, 'utf8').trim()
        if (/^\d+\.\d+\.\d+$/.test(c)) return c
        if (/^\d+$/.test(c)) return resolveNvmAlias(nvmRoot, c)
      }
    } catch {}
  }
  return null
}

// 优先级：nvm current 符号链接 > nvm alias/default（含 lts 别名）> 登录 shell > which 兜底
async function detectCurrentGlobalNode() {
  const home = os.homedir()
  const nvmRoot = path.join(home, '.nvm')
  const chain = []

  // 方法1：~/.nvm/current 符号链接（nvm 自己维护"当前在用"版本，最准）
  try {
    const currentLink = path.join(nvmRoot, 'current')
    if (fs.existsSync(currentLink)) {
      const real = fs.realpathSync(currentLink)
      const base = path.basename(real)
      if (/^v\d+\.\d+\.\d+/.test(base)) {
        const nodePath = path.join(real, 'bin', 'node')
        const r = { nodePath, version: base, method: 'nvm/current' }
        chain.push(r)
        console.log('[detectNode] nvm/current →', base)
        return r
      }
      chain.push({ method: 'nvm/current', note: `不是版本目录: ${base}` })
    } else {
      chain.push({ method: 'nvm/current', note: '不存在' })
    }
  } catch (e) { chain.push({ method: 'nvm/current', note: e.message }) }

  // 方法2：~/.nvm/alias/default 文件（重启 shell 仍生效的默认）
  try {
    const aliasFile = path.join(nvmRoot, 'alias', 'default')
    if (fs.existsSync(aliasFile)) {
      const alias = fs.readFileSync(aliasFile, 'utf8').trim()
      const ver = resolveNvmAlias(nvmRoot, alias)
      chain.push({ method: 'nvm alias/default', note: `alias=${alias} resolved=${ver || '无法解析'}` })
      if (ver) {
        const version = 'v' + ver
        const nodePath = path.join(nvmRoot, 'versions', 'node', version, 'bin', 'node')
        if (fs.existsSync(nodePath)) {
          const r = { nodePath, version, method: 'nvm alias/default' }
          console.log('[detectNode] nvm alias/default →', alias, '=>', version)
          return r
        }
      }
    } else {
      chain.push({ method: 'nvm alias/default', note: '不存在' })
    }
  } catch (e) { chain.push({ method: 'nvm alias/default', note: e.message }) }

  // 方法3：登录 shell + 显式 source nvm.sh 再问 node（最贴近用户终端 node -v）
  // 注意：-c 是非交互模式，.zshrc/.bashrc 不会被 source（nvm 常挂在里面），
  // 所以必须自己 source "$NVM_DIR/nvm.sh"，它会在启动时按 default alias 激活对应版本。
  const shells = process.env.SHELL
    ? [process.env.SHELL]
    : (process.platform === 'win32' ? [] : ['/bin/zsh', '/bin/bash'])
  for (const sh of shells) {
    try {
      const script = 'source "$NVM_DIR/nvm.sh" 2>/dev/null && node -p process.version'
      const { stdout } = await execFileP(sh, ['-lc', script], {
        timeout: 8000, env: SHELL_ENV, windowsHide: true,
      })
      const v = (stdout || '').trim()
      if (/^\d+\.\d+\.\d+$/.test(v)) {
        const r = { nodePath: '', version: 'v' + v, method: `nvm-src-${path.basename(sh)}` }
        chain.push(r)
        console.log('[detectNode] shell + source nvm →', 'v' + v)
        return r
      }
      chain.push({ method: `shell(${sh})`, note: `stdout=${JSON.stringify(v)}` })
    } catch (e) { chain.push({ method: `shell(${sh})`, note: e.message }) }
  }

  // 方法4：which node 兜底（PATH 顺序可能不代表实际激活，仅备用）
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which'
    const { stdout: whichOut } = await execFileP(whichCmd, ['node'], {
      timeout: 5000, env: SHELL_ENV, windowsHide: true,
    })
    const nodePath = (whichOut || '').trim().split(/\r?\n/)[0]
    if (nodePath) {
      const { stdout: verOut } = await execFileP(nodePath, ['-p', 'process.version'], {
        timeout: 5000, env: SHELL_ENV, windowsHide: true,
      })
      let v = (verOut || '').trim()
      if (v) {
        if (!v.startsWith('v')) v = 'v' + v
        const r = { nodePath, version: v, method: 'which-node' }
        chain.push(r)
        console.log('[detectNode] which node →', v)
        return r
      }
    }
    chain.push({ method: 'which-node', note: 'which 无结果' })
  } catch (e) { chain.push({ method: 'which-node', note: e.message }) }

  console.log('[detectNode] 全部失败：', JSON.stringify(chain))
  return null
}

// 给用户提供「切换到此 Node 的命令」字符串（让用户复制到终端执行）
function switchCommandForManager(manager, version) {
  if (!version) return ''
  const v = version.replace(/^v/, '')
  switch (manager) {
    case 'nvm':
    case 'nvm-windows':
      return `nvm use ${v}`
    case 'fnm':
      return `fnm use ${v}`
    case 'volta':
      return `volta install node@${v} && volta pin node@${v}`
    default:
      return ''
  }
}

// 设置/取消某版本为默认（重启 shell 后仍生效）
function defaultCommandForManager(manager, version) {
  if (!version) return ''
  const v = version.replace(/^v/, '')
  switch (manager) {
    case 'nvm':
    case 'nvm-windows':
      return `nvm alias default ${v}`
    case 'fnm':
      return `fnm default ${v}`
    case 'volta':
      return ''
    default:
      return ''
  }
}

// 探测本地已安装的 Node 版本（按顺序尝试：nvm / nvm-windows / fnm / volta / 系统）
async function nodeListVersions() {
  const home = os.homedir()
  const current = `v${process.versions.node}`

  const candidates = [
    { dir: path.join(home, '.nvm', 'versions', 'node'), manager: 'nvm' },
    { dir: process.env.NVM_HOME ? path.join(process.env.NVM_HOME, 'v') : '', manager: 'nvm-windows' },
    { dir: path.join(home, '.fnm', 'node-versions'), manager: 'fnm' },
    { dir: path.join(home, '.local', 'share', 'fnm', 'node-versions'), manager: 'fnm' },
    { dir: path.join(home, '.volta', 'tools', 'image', 'node'), manager: 'volta' },
  ].filter(c => c.dir)

  const debug = []
  let found = null
  for (const c of candidates) {
    try {
      if (!fs.existsSync(c.dir)) {
        debug.push(`${c.manager}: 目录不存在 ${c.dir}`)
        continue
      }
      const entries = fs.readdirSync(c.dir, { withFileTypes: true })
        .filter(e => e.isDirectory() || e.isSymbolicLink())
        .map(e => e.name)
        .filter(n => /^v\d+\.\d+\.\d+/.test(n))
      if (entries.length > 0) {
        found = { dir: c.dir, manager: c.manager, versions: entries }
        debug.push(`${c.manager}: 命中 ${entries.length} 个版本于 ${c.dir}`)
        break
      }
      debug.push(`${c.manager}: 目录存在但没匹配 v<digits> 形式 ${c.dir}`)
    } catch (e) {
      debug.push(`${c.manager}: 读取失败 ${e.message}`)
    }
  }

  // 把诊断信息打到 Electron 控制台（用户在 DevTools 里能看到）
  if (debug.length) console.log('[nodeListVersions]', debug.join(' | '))

  // 探测用户 shell 实际激活的 Node 版本（PATH 上的那个）
  const cur = await detectCurrentGlobalNode()
  const currentGlobalVersion = cur?.version || ''
  debug.push(`currentGlobal: ${currentGlobalVersion || '(未探测到)'}${cur?.method ? ' [via ' + cur.method + ']' : ''}`)

  if (!found) {
    return {
      manager: 'system',
      sourceDir: '',
      versions: [{ version: current, current: true, npmBin: '', prefix: '', available: false }],
      currentGlobalVersion,
      debug,
    }
  }
  // 版本号降序排序（用 numeric 比较让 v20.10 > v20.9）
  found.versions.sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
  return {
    manager: found.manager,
    sourceDir: found.dir,
    currentGlobalVersion,
    versions: found.versions.map(v => {
      const p = npmPathsForVersion(found.manager, found.dir, v)
      return {
        version: v,
        current: v === current,
        currentGlobal: v === currentGlobalVersion,
        npmBin: p.npmBin,
        prefix: p.prefix,
        available: !!p.npmBin && fs.existsSync(p.npmBin),
      }
    }),
    debug,
  }
}

// HTTP 代理设置（影响所有 fetch 请求，国内访问官方源时常用）
function applyProxy(url) {
  if (typeof process === 'undefined' || !process?.env) return
  if (!url) {
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.http_proxy
    delete process.env.https_proxy
    delete process.env.NPM_PROXY
    return
  }
  process.env.HTTP_PROXY = url
  process.env.HTTPS_PROXY = url
  process.env.http_proxy = url
  process.env.https_proxy = url
  process.env.NPM_PROXY = url
}

function readFile(filePath) {
  return fs.readFileSync(filePath, { encoding: 'utf-8' })
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: 'utf-8' })
  return filePath
}

function registerServices(api) {
  globalThis.services = api
  if (typeof window !== 'undefined') window.services = api
  return api
}

window.services = registerServices({
  npmSearch,
  npmMeta,
  readFile,
  writeFile,
  npmListGlobal,
  npmUninstallGlobal,
  npmUpdateGlobal,
  npmUpdateAllGlobal,
  npmInstallGlobal,
  nodeListVersions,
  detectCurrentGlobalNode,
  switchCommandForManager,
  defaultCommandForManager,
  setProxy(url) {
    if (typeof url === 'string' && url.trim()) {
      const cleaned = url.trim().replace(/\/+$/, '')
      try {
        const parsed = new URL(cleaned)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          applyProxy(cleaned)
          return cleaned
        }
      } catch { /* fall through to clear */ }
    }
    applyProxy('')
    return ''
  },
  getProxy() {
    if (typeof process === 'undefined' || !process?.env) return ''
    return process.env.HTTP_PROXY || ''
  },
})
