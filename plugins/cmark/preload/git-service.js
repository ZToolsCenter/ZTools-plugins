/**
 * git-service.js —— 笔记插件的 Git 服务层（v2，按代码评审结论加固）
 *
 * 相对 v1 的关键修正：
 *   P0-1 备份失败必须中止：backupFile 返回结构化结果，复制后校验字节数
 *   P0-2 路径按字面量处理：全局 GIT_LITERAL_PATHSPECS=1，杜绝 n[1].md 命中 n1.md
 *   P1-3 非 ASCII 路径：含路径的输出加 -z + core.quotepath=false
 *   P1-4 porcelain v2 rename 记录正确取 path（slice(9)）并保留 oldPath
 *   P1-5 回溯/丢弃用 cat-file 直接写字节，绕开 .gitattributes 与 autocrlf
 *   P1-6 提交范围限定在笔记目录子树，不再 add -A 整个仓库
 *   P1-7 拉取默认 ff-only，绝不把冲突标记写进用户笔记
 *   P1-8 检测本地/远端分叉，避免 rebase 重写已发布历史
 *   P1-10 正确检测游离 HEAD，remote 不硬编码
 *   P2  日志脱敏、错误分类补 rejected/diverged、版本号校验、配置缓存
 *
 * 铁律：不改用户文件内容；备份/日志只写仓库外；破坏性操作先备份，失败即中止。
 */
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const wsPrefs = require('./ws-prefs.js')

const DEFAULTS = {
  autoSync: false,
  // 两种触发方式互斥：interval=固定间隔，stop-edit=停止编辑后
  autoMode: 'interval',
  intervalMs: 5 * 60 * 1000,
  onStopEditMinutes: 0,
  pullBeforePush: true,
  pushEnabled: true,
  commitScope: 'notes',
  // 提交信息固定，不开放给用户配置（少一个配置项，也避免有人把模板改坏导致历史不可读）
  commitMessage: 'cmark sync:{{datetime}}',
  lastRunAt: 0,
  failCount: 0
}

module.exports = function installGitService(win, argvPath) {

  // 传进来的可能是配置文件路径而不是目录，这里做一次纠正
  let WS = argvPath
  try {
    const isDir = WS && fs.existsSync(WS) && fs.statSync(WS).isDirectory()
    if (!isDir) {
      let fromCfg = null
      try {
        const c = JSON.parse(fs.readFileSync(WS, 'utf8'))
        if (c && typeof c.workspace === 'string') fromCfg = c.workspace
      } catch (e) {}
      if (!fromCfg && win && win.__ZNOTES_WS) fromCfg = win.__ZNOTES_WS
      if (fromCfg) WS = fromCfg
    }
  } catch (e) {}
  if (!WS) WS = '.'

  // ======================= 路径 =======================
  const hash = crypto.createHash('md5').update(String(WS).toLowerCase()).digest('hex').slice(0, 12)
  const baseDir = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const dataDir = path.join(baseDir, 'znotes-data', hash)
  const backupDir = path.join(dataDir, 'backup')
  const configFile = path.join(dataDir, 'git-config.json')
  const logFile = path.join(dataDir, 'git.log')

  function mkdirp(d) { try { fs.mkdirSync(d, { recursive: true }) } catch (e) {} }
  mkdirp(backupDir)

  // ---------- 配置（内存缓存 + 白名单） ----------
  let cfgCache = null
  function readConfig() {
    if (cfgCache) return cfgCache
    try {
      cfgCache = Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(configFile, 'utf8')))
    } catch (e) {
      cfgCache = Object.assign({}, DEFAULTS)
    }
    return cfgCache
  }
  function writeConfig(patch) {
    const next = Object.assign({}, readConfig())
    const ALLOW = ['autoSync', 'autoMode', 'intervalMs', 'onStopEditMinutes', 'pullBeforePush', 'pushEnabled', 'commitScope', 'commitMessage', 'lastRunAt', 'lastAutoResult', 'failCount']
    Object.keys(patch || {}).forEach((k) => { if (ALLOW.indexOf(k) >= 0) next[k] = patch[k] })
    if (next.autoMode != null && next.autoMode !== 'interval' && next.autoMode !== 'stop-edit') delete next.autoMode
    if (next.intervalMs) next.intervalMs = Math.max(60000, parseInt(next.intervalMs, 10) || DEFAULTS.intervalMs)
    if (next.onStopEditMinutes != null) next.onStopEditMinutes = Math.max(0, parseInt(next.onStopEditMinutes, 10) || 0)
    if (typeof next.commitMessage === 'string') next.commitMessage = next.commitMessage.trim().slice(0, 200) || DEFAULTS.commitMessage
    if (next.commitScope !== 'repo') next.commitScope = 'notes'
    cfgCache = next
    try {
      fs.writeFileSync(configFile, JSON.stringify(next, null, 2), 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, message: '配置保存失败：' + e.message }
    }
  }

  // ---------- 日志（脱敏 + 按行滚动） ----------
  function redact(text) {
    return String(text || '')
      .replace(/(\/\/)[^@\/\s]+@/g, '$1***@')
      .replace(/(token|password|passwd|secret|authorization)([=:]\s*)\S+/gi, '$1$2***')
  }
  function log(level, text) {
    try {
      fs.appendFileSync(logFile, '[' + new Date().toISOString() + '] [' + level + '] ' + redact(text).slice(0, 800) + '\n', 'utf8')
      if (fs.statSync(logFile).size > 400 * 1024) {
        const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
        fs.writeFileSync(logFile, lines.slice(-1500).join('\n') + '\n', 'utf8')
      }
    } catch (e) {}
  }
  function logTail(n) {
    try {
      return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-(n || 80)).map(redact).join('\n')
    } catch (e) { return '' }
  }

  // ======================= 仓库定位 =======================
  let repoRoot = null
  let scopeRel = ''

  function locateRepo() {
    let cur = WS
    repoRoot = null
    let depth = 0
    // 最多向上 4 层：既支持"仓库根在笔记目录上一级"，又不会误认到家目录或盘根的仓库
    while (cur && cur !== path.dirname(cur) && depth < 4) {
      depth++
      try {
        if (fs.existsSync(path.join(cur, '.git'))) { repoRoot = cur; break }
      } catch (e) {}
      cur = path.dirname(cur)
    }
    if (repoRoot) {
      const r = path.relative(repoRoot, WS)
      scopeRel = (r && !r.startsWith('..')) ? r.split(path.sep).join('/') : ''
    } else {
      scopeRel = ''
    }
    return repoRoot
  }
  locateRepo()

  // 工作区元数据目录名（固定放在仓库根）
  const META_DIR = '.cmark'

  // 仓库根的版本控制配置文件：不属于笔记内容，但由插件自己维护（initRepo 会写 .gitignore），
  // 而它们住在仓库根。工作区是仓库的子目录时，若不显式纳入提交范围，
  // 这些文件的改动永远进不了暂存区 —— 表现就是「改动面板里一直挂着、怎么提交都提交不掉」。
  const ROOT_VCS = ['.gitignore', '.gitattributes']
  function rootVcsPresent () {
    if (!repoRoot) return []
    return ROOT_VCS.filter((f) => {
      try { return fs.existsSync(path.join(repoRoot, f)) } catch (e) { return false }
    })
  }

  function gitDir() {
    if (!repoRoot) return null
    const g = path.join(repoRoot, '.git')
    try {
      if (fs.statSync(g).isFile()) {
        const m = fs.readFileSync(g, 'utf8').trim().match(/^gitdir:\s*(.+)$/i)
        if (m) return path.resolve(repoRoot, m[1].trim())
      }
    } catch (e) {}
    return g
  }

  function inspectRepoState() {
    // 之前只在模块加载时 locateRepo 一次，结果永久缓存：
    // 用户先打开插件、后来才把仓库 clone 进来（或刚删掉 .git），
    // 面板就会一直显示"尚未初始化 git 仓库"。这里每次检查都复核一次。
    try {
      if (repoRoot && !fs.existsSync(path.join(repoRoot, '.git'))) repoRoot = null
      if (!repoRoot) locateRepo()
    } catch (e) {}
    const gd = gitDir()
    const out = { isRepo: !!repoRoot, repoRoot, scopeRel, locked: false, lockFile: null, lockAgeMs: 0, inProgress: null }
    if (!gd) return out
    const lock = path.join(gd, 'index.lock')
    try {
      if (fs.existsSync(lock)) {
        out.locked = true
        out.lockFile = lock
        out.lockAgeMs = Date.now() - fs.statSync(lock).mtimeMs
      }
    } catch (e) {}
    const marks = [['rebase-merge', 'rebase'], ['rebase-apply', 'rebase'], ['MERGE_HEAD', 'merge'], ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert']]
    for (const [f, name] of marks) {
      if (fs.existsSync(path.join(gd, f))) { out.inProgress = name; break }
    }
    return out
  }

  // ======================= git 执行 =======================
  const ERR_RULES = [
    { kind: 'rejected', re: /non-fast-forward|fetch first|Updates were rejected|\[rejected\]/i },
    { kind: 'conflict', re: /CONFLICT|unmerged|fix conflicts|would be overwritten|Please commit your changes or stash/i },
    { kind: 'lock', re: /index\.lock|Unable to create.*\.lock|another git process/i },
    { kind: 'badrev', re: /not a full refname|unknown revision|bad revision|invalid reference/i },
    { kind: 'detached', re: /detached HEAD|not currently on a branch/i },
    { kind: 'norepo', re: /not a git repository/i },
    { kind: 'noUpstream', re: /no upstream configured|has no upstream branch|couldn't find remote ref/i },
    { kind: 'auth', re: /(Authentication failed|Permission denied \(publickey|invalid username or password|could not read Username|could not read Password|No such identity)/i },
    { kind: 'network', re: /could not resolve host|Unable to access|Connection (refused|reset|timed out)|Failed to connect|network is unreachable|Operation timed out/i },
    { kind: 'perm', re: /Permission denied|EACCES|Read-only file system|No space left/i },
    { kind: 'dirty', re: /local changes would be lost|Your local changes|uncommitted changes/i }
  ]

  const ERR_TEXT = {
    network: '网络不通或远端不可达',
    auth: '认证失败（检查 SSH key 或凭据）',
    conflict: '存在冲突，需要先解决',
    lock: 'git 被其他进程占用（index.lock）',
    detached: 'HEAD 处于游离状态，请先切回分支',
    norepo: '当前目录不是 git 仓库',
    noUpstream: '当前分支没有配置上游分支',
    dirty: '本地有未提交改动，阻止了本次操作',
    busy: '上一个 git 操作还在进行中',
    timeout: 'git 命令超时',
    rejected: '远端有你没有的提交，请先拉取再推送',
    diverged: '本地与远端已分叉，无法自动快进',
    badrev: '版本号或分支名无效',
    perm: '文件或目录权限不足（可能被杀毒软件占用）',
    backup: '备份失败，操作已中止',
    nothing: '没有需要提交的改动',
    noremote: '未配置远程仓库，请先在设置中填写地址。',
    unknown: 'git 执行失败'
  }

  function classify(text) {
    for (const r of ERR_RULES) if (r.re.test(text)) return r.kind
    return 'unknown'
  }

  let busy = false
  let currentOp = null

  // credential.helper 用空值先清空叠加的列表，再指定 manager：
  // 否则 system 级的 helper-selector（便携版 git 自带）会和 global 的 manager 叠加，
  // git 会弹出「选择凭据助手」的 GUI 窗口，在插件里就是卡死。
  const BASE_ARGS = ['-c', 'core.quotepath=false', '-c', 'credential.helper=', '-c', 'credential.helper=manager']

  // ---- 远端凭据（一键建仓用）----
  // token 存在 ~/.cmark-config.json 的 remoteToken 里，网络命令用内联 credential helper
  // 从环境变量读取：不写进 .git/config，也不出现在 git 的命令行参数里。
  const NET_CFG_FILE = path.join(os.homedir(), '.cmark-config.json')
  let netCfgCache = { t: -1, data: null }
  function readNetCfg () {
    try {
      const st = fs.statSync(NET_CFG_FILE)
      if (netCfgCache.data && netCfgCache.t === st.mtimeMs) return netCfgCache.data
      const d = JSON.parse(fs.readFileSync(NET_CFG_FILE, 'utf8'))
      netCfgCache = { t: st.mtimeMs, data: d }
      return d
    } catch (e) { return null }
  }
  const NET_CMDS = { push: 1, pull: 1, fetch: 1, 'ls-remote': 1, clone: 1 }
  function netToken (args) {
    if (!args.some(function (a) { return NET_CMDS[a] })) return null
    // 先取本工作区的凭据，再回退到旧版全局配置（迁移兼容）
    try {
      const p = wsPrefs.read(WS)
      if (p.remoteToken && p.remoteToken.token) return p.remoteToken.token
    } catch (e) {}
    const c = readNetCfg()
    const t = c && c.remoteToken
    return t && t.token ? t.token : null
  }
  const TOKEN_HELPER = '!f() { echo username=x-access-token; echo password=$CMARK_GIT_TOKEN; }; f'

  function exec(args, opt) {
    const o = opt || {}
    const token = o.token || netToken(args)
    const pre = token
      ? ['-c', 'core.quotepath=false', '-c', 'credential.helper=', '-c', 'credential.helper=' + TOKEN_HELPER]
      : BASE_ARGS
    return new Promise((resolve) => {
      execFile('git', pre.concat(args), {
        cwd: repoRoot || WS,
        encoding: o.buffer ? 'buffer' : 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        timeout: o.timeout || 30000,
        env: Object.assign({}, process.env, {
          GCM_INTERACTIVE: 'never',
          GIT_TERMINAL_PROMPT: '0',
          GIT_LITERAL_PATHSPECS: '1',
          LC_ALL: 'C',
          CMARK_GIT_TOKEN: token || ''
        })
      }, (err, stdout, stderr) => {
        if (err) {
          const killed = err.killed || err.signal === 'SIGTERM'
          const text = String(stderr || '') + String(stdout || '') + ' ' + String(err.message || '')
          const kind = killed ? 'timeout' : classify(text)
          resolve({
            ok: false,
            kind,
            code: err.code,
            message: (killed ? ERR_TEXT.timeout : redact(String(stderr || stdout || err.message || '').trim())) || ERR_TEXT[kind],
            raw: redact(text.trim()).slice(0, 3000)
          })
        } else {
          resolve({ ok: true, data: stdout })
        }
      })
    })
  }

  function runGit(args, opt) {
    const o = opt || {}
    return exec(args, o).then((r) => {
      log(r.ok ? 'OK' : 'ERR', (o.label || args[0]) + ' ' + args.slice(1).join(' ').slice(0, 160) + (r.ok ? '' : ' -> ' + r.kind + ': ' + String(r.message).slice(0, 200)))
      return r
    })
  }

  function enqueue(label, fn) {
    if (busy) return Promise.resolve({ ok: false, kind: 'busy', message: ERR_TEXT.busy })
    busy = true
    currentOp = label
    return Promise.resolve().then(fn).catch((e) => {
      log('ERR', label + ' 异常: ' + ((e && e.message) || e))
      return { ok: false, kind: 'unknown', message: (e && e.message) || String(e) }
    }).then((r) => { busy = false; currentOp = null; return r })
  }

  function precheck(opts) {
    const o = opts || {}
    const st = inspectRepoState()
    if (!st.isRepo) return { ok: false, kind: 'norepo', message: ERR_TEXT.norepo }
    if (st.locked) {
      const stale = st.lockAgeMs > 10 * 60 * 1000
      return {
        ok: false, kind: 'lock',
        message: ERR_TEXT.lock + (stale ? '（已存在超过 10 分钟，可能是陈旧锁，可尝试清理）' : '，请稍后重试'),
        staleLock: stale, lockFile: st.lockFile
      }
    }
    if (st.inProgress && !o.allowInProgress) {
      return { ok: false, kind: 'conflict', message: '仓库正处于 ' + st.inProgress + ' 过程，请先中止或完成', inProgress: st.inProgress }
    }
    return { ok: true }
  }

  // ======================= 路径 =======================
  function relOf(absPath) {
    if (!repoRoot) return null
    const r = path.relative(repoRoot, absPath)
    if (!r || r.startsWith('..')) return null
    return r.split(path.sep).join('/')
  }
  function absOf(rel) {
    if (!repoRoot || !rel) return null
    return path.join(repoRoot, rel.split('/').join(path.sep))
  }
  // rel 必须是规范相对路径，且回算一致（防 ../ 与绝对路径）
  function normRel(rel) {
    if (!rel || typeof rel !== 'string' || rel.indexOf('\0') >= 0) return null
    if (/^[\/\\]/.test(rel) || /^[a-zA-Z]:/.test(rel)) return null
    const segs = rel.split('/')
    if (segs.some((x) => x === '..' || x === '.' || x === '')) return null
    if (segs.indexOf('.git') >= 0) return null
    const abs = absOf(rel)
    if (!abs) return null
    return relOf(abs) === rel ? rel : null
  }

  // ======================= 状态 =======================
  async function getState() {
    const st = inspectRepoState()
    if (!st.isRepo) {
      return { ok: true, data: Object.assign({}, st, { files: [], dirty: 0, branch: '', ahead: 0, behind: 0, busy, currentOp }) }
    }
    const r = await runGit(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], { timeout: 20000, label: 'status' })
    if (!r.ok) {
      return { ok: false, kind: r.kind, message: r.message, data: Object.assign({}, st, { files: null, dirty: -1, busy, currentOp }) }
    }
    const files = []
    let branch = ''
    let ahead = 0
    let behind = 0
    let detached = false
    const parts = r.data.split('\0')
    for (let i = 0; i < parts.length; i++) {
      const line = parts[i]
      if (!line) continue
      if (line[0] === '#') {
        if (line.startsWith('# branch.head ')) {
          const v = line.slice(14).trim()
          if (v === '(detached)') detached = true
          else branch = v
        } else if (line.startsWith('# branch.ab ')) {
          const m = line.match(/\+(\d+)\s+-(\d+)/)
          if (m) { ahead = parseInt(m[1], 10); behind = parseInt(m[2], 10) }
        }
        continue
      }
      const code = line[0]
      if (code === '1' || code === '2') {
        const seg = line.split(' ')
        const xy = seg[1] || '..'
        // type 2（rename/copy）：索引 8 是 <X><score>，path 从 9 开始
        const p = (code === '2' ? seg.slice(9) : seg.slice(8)).join(' ')
        const item = { path: p, x: xy[0], y: xy[1], kind: 'tracked' }
        if (code === '2') {
          i++
          if (parts[i]) item.oldPath = parts[i]
        }
        if (seg[2] && seg[2].charAt(0) === 'S') item.submodule = true
        files.push(item)
      } else if (code === '?') {
        files.push({ path: line.slice(2), x: '?', y: '?', kind: 'untracked' })
      } else if (code === 'u') {
        const seg = line.split(' ')
        files.push({ path: seg.slice(10).join(' '), x: 'U', y: 'U', kind: 'conflict' })
      }
    }
    return {
      ok: true,
      data: {
        isRepo: true, repoRoot, scopeRel, branch, detached, ahead, behind,
        files, dirty: files.length,
        locked: st.locked, lockAgeMs: st.lockAgeMs, inProgress: st.inProgress,
        busy, currentOp
      }
    }
  }

  // ======================= 读 =======================
  async function fileLog(rel, limit, skip) {
    const safe = normRel(rel)
    if (!safe) return { ok: false, kind: 'badrev', message: '路径不合法' }
    const lim = Math.max(1, parseInt(limit, 10) || 10)
    const sk = Math.max(0, parseInt(skip, 10) || 0)
    // --follow 与 --skip 组合时 git 的结果会错位（实测会重复某条），
    // 因此先取 skip+limit 条，再在内存里切片。
    const r = await runGit(['log', '-' + String(sk + lim), '--follow',
      '--date=format:%Y-%m-%d %H:%M',
      '--pretty=format:%H%x1f%h%x1f%ad%x1f%an%x1f%s', '--', safe], { label: 'log' })
    if (!r.ok) return r
    const all = r.data.split('\n').filter(Boolean).map((line) => {
      const p = line.split('\x1f')
      return { hash: p[0], short: p[1], date: p[2], author: p[3], subject: p[4] || '' }
    })
    return { ok: true, data: sk ? all.slice(sk) : all }
  }

  // 该文件被改过多少次（用于"修订次数"与分页）
  async function repoLogCount() {
    const r = await runGit(['rev-list', '--count', 'HEAD'], { label: 'rev-count-all' })
    if (!r.ok) return r
    return { ok: true, data: parseInt(r.data.trim(), 10) || 0 }
  }

  async function fileLogCount(rel) {
    const safe = normRel(rel)
    if (!safe) return { ok: false, kind: 'badrev', message: '路径不合法' }
    const r = await runGit(['rev-list', '--count', 'HEAD', '--', safe], { label: 'rev-count' })
    if (!r.ok) return r
    return { ok: true, data: parseInt(r.data.trim(), 10) || 0 }
  }

  async function repoLog(limit, skip) {
    const args = ['log', '-' + String(limit || 60)]
    if (skip) args.push('--skip=' + String(skip))
    args.push('--date=format:%Y-%m-%d %H:%M',
      '--pretty=format:%H%x1f%h%x1f%ad%x1f%an%x1f%s', '--')
    const r = await runGit(args, { label: 'log' })
    if (!r.ok) return r
    return { ok: true, data: r.data.split('\n').filter(Boolean).map((line) => {
      const p = line.split('\x1f')
      return { hash: p[0], short: p[1], date: p[2], author: p[3], subject: p[4] || '' }
    }) }
  }

  async function verifyRev(rev) {
    if (!rev || typeof rev !== 'string') return null
    if (!/^[0-9a-zA-Z\/_\.\-\^~@{}]{1,120}$/.test(rev)) return null
    if (rev.charAt(0) === '-') return null
    const r = await runGit(['rev-parse', '--verify', '--quiet', rev + '^{commit}'], { label: 'rev-parse' })
    return r.ok ? r.data.trim() : null
  }

  async function showAt(commit, rel) {
    const sha = await verifyRev(commit)
    if (!sha) return { ok: false, kind: 'badrev', message: ERR_TEXT.badrev }
    const safe = rel ? normRel(rel) : null
    if (rel && !safe) return { ok: false, kind: 'badrev', message: '路径不合法' }
    const r = await runGit(['show', sha + (safe ? ':' + safe : '')], { label: 'show' })
    return r.ok ? { ok: true, data: r.data } : r
  }

  async function commitFiles(commit) {
    const sha = await verifyRev(commit)
    if (!sha) return { ok: false, kind: 'badrev', message: ERR_TEXT.badrev }
    // -z：路径按 NUL 分隔且不转义，中文名不会被 C-quote
    const r = await runGit(['show', '-z', '--name-status', '--format=', '--no-renames', sha], { label: 'show-files' })
    if (!r.ok) return r
    const toks = r.data.split('\0').filter((x) => x !== '')
    const out = []
    for (let i = 0; i + 1 < toks.length; i += 2) {
      const status = (toks[i] || '').trim()
      const p = toks[i + 1] || ''
      if (status && p) out.push({ status: status.charAt(0), path: p })
    }
    return { ok: true, data: out }
  }

  async function diffOf(commit, rel) {
    const safe = rel ? normRel(rel) : null
    if (rel && !safe) return { ok: false, kind: 'badrev', message: '路径不合法' }
    if (commit) {
      const sha = await verifyRev(commit)
      if (!sha) return { ok: false, kind: 'badrev', message: ERR_TEXT.badrev }
      return runGit(['show', '--format=', '-U999999', '--no-color', '--no-ext-diff', sha, '--'].concat(safe ? [safe] : []), { label: 'diff' })
    }
    // 未跟踪文件（新建笔记）diff 恒为空，这里直接合成一份新增 diff
    if (safe) {
      const st = await runGit(['status', '--porcelain=v1', '-z', '--', safe], { label: 'status-one' })
      if (st.ok && st.data.indexOf('??') === 0) {
        try {
          const content = fs.readFileSync(absOf(safe), 'utf8')
          const lines = content.split('\n')
          return {
            ok: true,
            data: '--- /dev/null\n+++ b/' + safe + '\n@@ 新文件，共 ' + lines.length + ' 行 @@\n' + lines.map((l) => '+' + l).join('\n')
          }
        } catch (e) {
          return { ok: true, data: '(无法读取文件：' + e.message + ')' }
        }
      }
    }
    const r = await runGit(['diff', '-U999999', '--no-color', '--no-ext-diff', '--'].concat(safe ? [safe] : []), { label: 'diff' })
    if (!r.ok) return r
    if (r.data) return { ok: true, data: r.data }
    const r2 = await runGit(['diff', '--cached', '-U999999', '--no-color', '--'].concat(safe ? [safe] : []), { label: 'diff-staged' })
    return { ok: true, data: r2.ok ? r2.data : '' }
  }

  // 工作区 vs 指定提交：看"那次提交到现在改了什么"
  async function diffWork(commit, rel) {
    const safe = normRel(rel)
    if (!safe) return { ok: false, kind: 'badrev', message: '路径不合法' }
    const sha = await verifyRev(commit)
    if (!sha) return { ok: false, kind: 'badrev', message: ERR_TEXT.badrev }
    const r = await runGit(['diff', '-U999999', '--no-color', '--no-ext-diff', sha, '--', safe], { label: 'diff-work' })
    return r.ok ? { ok: true, data: r.data } : r
  }

  // ======================= 备份 =======================
  function pruneBackups(keep) {
    try {
      const list = fs.readdirSync(backupDir).map((f) => ({ n: f, t: fs.statSync(path.join(backupDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
      list.slice(keep || 300).forEach((f) => { try { fs.unlinkSync(path.join(backupDir, f.n)) } catch (e) {} })
    } catch (e) {}
  }

  // { ok, path?, skip?, reason? }；!ok 时调用方必须中止操作
  function backupFile(rel, tag) {
    const safe = normRel(rel)
    if (!safe) return { ok: false, reason: '路径不合法' }
    const abs = absOf(safe)
    if (!fs.existsSync(abs)) return { ok: true, skip: true, reason: '源文件不存在' }
    try {
      const before = fs.statSync(abs).size
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const dest = path.join(backupDir, stamp + '_' + (tag || 'bak') + '_' + safe.replace(/[\/\\]/g, '__'))
      mkdirp(backupDir)
      fs.copyFileSync(abs, dest)
      const after = fs.statSync(dest).size
      if (after !== before) return { ok: false, reason: '备份大小不一致（' + after + '≠' + before + '）' }
      pruneBackups(300)
      return { ok: true, path: dest, size: after }
    } catch (e) {
      return { ok: false, reason: e.message }
    }
  }

  // ======================= 写操作 =======================
  async function stage(rel) {
    const pre = precheck()
    if (!pre.ok) return pre
    const safe = rel ? normRel(rel) : null
    if (rel && !safe) return { ok: false, kind: 'badrev', message: '路径不合法' }
    return enqueue('stage', () => runGit(['add', '-A', '--'].concat(safe ? [safe] : (scopeRel ? [scopeRel, META_DIR].concat(rootVcsPresent()) : ['.'])), { label: 'add' }))
  }

  async function unstage(rel) {
    const pre = precheck()
    if (!pre.ok) return pre
    const safe = rel ? normRel(rel) : null
    if (rel && !safe) return { ok: false, kind: 'badrev', message: '路径不合法' }
    return enqueue('unstage', async () => {
      const r = await runGit(['restore', '--staged', '--'].concat(safe ? [safe] : (scopeRel ? [scopeRel, META_DIR].concat(rootVcsPresent()) : ['.'])), { label: 'unstage' })
      if (r.ok) return r
      return runGit(['reset', 'HEAD', '--'].concat(safe ? [safe] : (scopeRel ? [scopeRel, META_DIR].concat(rootVcsPresent()) : ['.'])), { label: 'unstage-reset' })
    })
  }

  // 该文件是否存在未提交改动（含暂存/未跟踪）；只有这种情况回溯才会丢数据
  async function isDirty(safe) {
    const st = await runGit(['status', '--porcelain=v1', '-z', '--', safe], { timeout: 15000, label: 'status-one' })
    return st.ok && !!st.data.trim()
  }

  // 用 cat-file 取字节直接落盘：绕开 .gitattributes 与 autocrlf，保证字节级一致
  // 直接写字节；是否覆盖未提交改动由调用方（restoreTo/discard）在确认后决定
  async function writeBlob(revPath, rel) {
    const safe = normRel(rel)
    if (!safe) return { ok: false, kind: 'badrev', message: '路径不合法' }
    const blob = await runGit(['cat-file', 'blob', revPath + ':' + safe], { label: 'cat-file', buffer: true })
    if (!blob.ok) return { ok: false, kind: blob.kind, message: blob.message }
    try {
      const abs = absOf(safe)
      mkdirp(path.dirname(abs))
      fs.writeFileSync(abs, blob.data)
    } catch (e) {
      return { ok: false, kind: 'perm', message: '写入失败：' + e.message }
    }
    return { ok: true, data: { path: safe } }
  }

  async function discard(rel, opts) {
    const o = opts || {}
    const pre = precheck()
    if (!pre.ok) return pre
    const safe = normRel(rel)
    if (!safe) return { ok: false, kind: 'badrev', message: '路径不合法' }
    const tracked = await runGit(['ls-files', '--error-unmatch', '--', safe], { label: 'ls-files' })

    // 已跟踪文件：回退到 HEAD。丢弃的内容本身来自工作区，不做备份，但必须先确认
    if (tracked.ok) {
      if (!o.force) {
        return {
          ok: false, kind: 'confirm-needed', dirty: true, path: safe,
          message: '撤销会丢弃这篇笔记的未提交改动，无法恢复。'
        }
      }
      return enqueue('discard', async () => {
        // 先把该文件从暂存区撤出（index 回到 HEAD），否则工作区恢复了、
        // git status 仍会因为它有暂存内容而继续列出这个文件，看起来像"丢弃没生效"
        await runGit(['reset', 'HEAD', '--', safe], { label: 'reset-one' })
        const r = await writeBlob('HEAD', safe)
        if (r.ok) r.data.action = 'restored'
        return r
      })
    }

    // 未跟踪文件：删除后 git 里没有任何副本，保留一份备份（唯一例外）
    return enqueue('discard', async () => {
      const bk = backupFile(safe, 'before-discard-untracked')
      if (!bk.ok) return { ok: false, kind: 'backup', message: ERR_TEXT.backup + '：' + bk.reason }
      try {
        const abs = absOf(safe)
        if (fs.existsSync(abs)) fs.unlinkSync(abs)
        return { ok: true, data: { backup: bk.path || null, skippedBackup: !!bk.skip, action: 'removed', path: safe } }
      } catch (e) {
        return { ok: false, kind: 'perm', message: '删除失败：' + e.message, backup: bk.path || null }
      }
    })
  }

  async function restoreTo(commit, rel, opts) {
    const o = opts || {}
    const pre = precheck()
    if (!pre.ok) return pre
    const sha = await verifyRev(commit)
    if (!sha) return { ok: false, kind: 'badrev', message: ERR_TEXT.badrev }
    const safe = normRel(rel)
    if (!safe) return { ok: false, kind: 'badrev', message: '路径不合法' }
    // 工作区有未提交改动时，回溯会直接覆盖它们；不做备份，但必须先让用户确认
    const dirty = await isDirty(safe)
    if (dirty && !o.force) {
      return {
        ok: false, kind: 'confirm-needed', dirty: true, path: safe, commit: sha,
        message: '这篇笔记有未提交的改动，回溯会直接覆盖它们，且无法恢复。'
      }
    }
    return enqueue('restore', async () => {
      const r = await writeBlob(sha, safe)
      if (r.ok) { r.data.commit = sha; r.data.hadLocalChanges = dirty }
      return r
    })
  }

  // ======================= 提交 =======================
  function formatMessage(tpl, extra) {
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const date = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
    const time = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds())
    return String(tpl || DEFAULTS.commitMessage)
      .replace(/\{\{date\}\}/g, date)
      .replace(/\{\{time\}\}/g, time)
      .replace(/\{\{datetime\}\}/g, date + ' ' + time)
      .replace(/\{\{count\}\}/g, String((extra && extra.count) || 0))
      .trim()
  }

  // 实际提交逻辑（不占 enqueue 队列）。push/sync 内部已经在队列里，必须用这个版本，
  // 否则 commitAll 会再次 enqueue → 被 busy 挡掉 → 推送永远返回"上一个操作还在进行中"。
  async function commitAllCore(message) {
    const cfg = readConfig()
    // 提交范围固定为工作区：scopeRel 为空说明工作区就是仓库根，此时等价于整个仓库；
    // 非空则只提交工作区内的改动，避免把仓库根部的无关文件一起带上。
    // 例外：.cmark 是工作区元数据（排序/只读状态/附件），固定住在仓库根，
    // 工作区是仓库的子目录时必须显式带上，否则 tree-order.json 这类改动永远提交不进去。
    // 例外二：仓库根的 .gitignore / .gitattributes（插件维护的版本控制配置）同理，
    // 不带上的话它们会永远留在「未提交改动」里。
    const scope = scopeRel ? [scopeRel, META_DIR].concat(rootVcsPresent()) : []
    const scopeArgs = scope.length ? ['--'].concat(scope) : []
    const addArgs = ['add', '-A'].concat(scopeArgs)
    const add = await runGit(addArgs, { label: 'add' })
    if (!add.ok) return add

    const staged = await runGit(['diff', '--cached', '--name-only', '-z'].concat(scopeArgs), { label: 'diff-cached' })
    if (!staged.ok) return staged
    const names = staged.data.split('\0').filter(Boolean)
    if (!names.length) return { ok: false, kind: 'nothing', message: ERR_TEXT.nothing }

    // 固定使用内置模板：cmark sync:YYYY-MM-DD HH:mm:ss
    const msg = formatMessage(DEFAULTS.commitMessage, { count: names.length })
    const r = await runGit(['commit', '-m', msg], { label: 'commit', timeout: 90000 })
    if (!r.ok) return r
    return { ok: true, data: { message: msg, files: names.length } }
  }

  async function commitAll(message) {
    const pre = precheck()
    if (!pre.ok) return pre
    return enqueue('commit', () => commitAllCore(message))
  }

  // 远端列表：空数组表示这是纯本地仓库，pull/push 无从下手
  async function remoteNames() {
    const r = await runGit(['remote'], { label: 'remote', timeout: 15000 })
    if (!r.ok) return []
    return String(r.data || '').split('\n').map((x) => x.trim()).filter(Boolean)
  }

  // fetch 后先判断能否快进；默认绝不 rebase，避免把冲突标记写进笔记
  async function pull() {
    const pre = precheck()
    if (!pre.ok) return pre
    if (!(await remoteNames()).length) return { ok: false, kind: 'noremote', message: ERR_TEXT.noremote }
    return enqueue('pull', async () => {
      const f = await runGit(['fetch', '--prune'], { label: 'fetch', timeout: 120000 })
      if (!f.ok) return f
      const up = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { label: 'upstream' })
      if (!up.ok) return { ok: false, kind: 'noUpstream', message: ERR_TEXT.noUpstream }

      const behindR = await runGit(['rev-list', '--count', 'HEAD..@{u}'], { label: 'count-behind' })
      const aheadR = await runGit(['rev-list', '--count', '@{u}..HEAD'], { label: 'count-ahead' })
      const behind = behindR.ok ? (parseInt(behindR.data.trim(), 10) || 0) : 0
      const ahead = aheadR.ok ? (parseInt(aheadR.data.trim(), 10) || 0) : 0

      if (behind === 0) return { ok: true, data: { behind: 0, ahead, note: '已是最新' } }
      if (ahead > 0) {
        return {
          ok: false, kind: 'diverged',
          message: '本地 ' + ahead + ' 个提交、远端 ' + behind + ' 个提交，无法自动合并。请先推送本地提交或手动处理。',
          localAhead: ahead, remoteBehind: behind
        }
      }
      const m = await runGit(['merge', '--ff-only', '@{u}'], { label: 'merge-ff', timeout: 120000 })
      if (!m.ok) return m
      return { ok: true, data: { behind, ahead: 0, output: String(m.data || '').trim() } }
    })
  }

  async function push() {
    const pre = precheck()
    if (!pre.ok) return pre
    if (!(await remoteNames()).length) return { ok: false, kind: 'noremote', message: ERR_TEXT.noremote }
    return enqueue('push', async () => {
      // 规范：推送 = 提交 + 推送。先把工作区改动落成提交，否则它们推不上去。
      // 用 commitAllCore：已经在 enqueue 内部，不能再嵌套 enqueue。
      const c = await commitAllCore()
      if (!c.ok && c.kind !== 'nothing') return c
      const br = await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], { label: 'branch' })
      if (!br.ok) return { ok: false, kind: 'detached', message: ERR_TEXT.detached }
      const branch = br.data.trim()
      if (!branch || branch === 'HEAD') return { ok: false, kind: 'detached', message: ERR_TEXT.detached }

      const up = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { label: 'upstream' })
      if (!up.ok) {
        const remotes = await runGit(['remote'], { label: 'remote' })
        const first = remotes.ok ? ((remotes.data.split('\n').map((x) => x.trim()).filter(Boolean))[0] || 'origin') : 'origin'
        const r = await runGit(['push', '-u', first, branch], { label: 'push-setup', timeout: 180000 })
        if (!r.ok) return r
        return { ok: true, data: { branch, remote: first, setUpstream: true, committed: c.ok, output: String(r.data || '').trim() } }
      }
      const r = await runGit(['push'], { label: 'push', timeout: 180000 })
      if (!r.ok) return r
      return { ok: true, data: { branch, committed: c.ok, output: String(r.data || '').trim() } }
    })
  }

  async function sync(message, opt) {
    const o = Object.assign({ pull: true, push: true }, opt || {})
    const st = inspectRepoState()
    if (!st.isRepo) return { ok: false, kind: 'norepo', message: ERR_TEXT.norepo }
    if (st.locked) return { ok: false, kind: 'lock', message: ERR_TEXT.lock }
    if (st.inProgress) return { ok: false, kind: 'conflict', message: '仓库处于 ' + st.inProgress + ' 过程，请先中止或完成' }

    const cfg = readConfig()
    const steps = []
    const c = await commitAll(message)
    if (c.ok) steps.push('commit')
    else if (c.kind !== 'nothing') return { ok: false, kind: c.kind, message: c.message, steps }

    // 纯本地仓库：提交就是全部工作，没有远端可拉可推，直接算成功
    if (!(await remoteNames()).length) {
      writeConfig({ lastRunAt: Date.now(), failCount: 0 })
      log('INFO', 'sync 完成（本地仓库，无远程地址）: ' + (steps.join(',') || '无改动'))
      return {
        ok: true,
        data: {
          steps, local: true,
          message: c.ok ? c.data.message : '',
          note: '已提交到本机（未配置远程仓库）'
        }
      }
    }

    // 规范：同步 = 提交 + 拉取 + 推送。三步固定执行，不受配置开关影响。
    if (o.pull) {
      const p = await pull()
      if (!p.ok) return { ok: false, kind: p.kind, message: p.message, steps }
      steps.push('pull')
    }
    if (o.push) {
      const ps = await push()
      if (!ps.ok) return { ok: false, kind: ps.kind, message: ps.message, steps }
      steps.push('push')
    }
    writeConfig({ lastRunAt: Date.now(), failCount: 0 })
    log('INFO', 'sync 完成: ' + (steps.join(',') || '无改动'))
    return { ok: true, data: { steps, message: c.ok ? c.data.message : '' } }
  }

  // ======================= 自动同步 =======================
  let intervalTimer = null
  let stopEditTimer = null
  let catchupTimer = null
  // 用于给 UI 展示"下一次自动同步还有多久"
  let intervalStartedAt = 0
  let stopEditDeadline = 0

  function clearTimers() {
    if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null }
    if (stopEditTimer) { clearTimeout(stopEditTimer); stopEditTimer = null }
    if (catchupTimer) { clearTimeout(catchupTimer); catchupTimer = null }
  }

  function scheduleAuto() {
    clearTimers()
    intervalStartedAt = 0
    stopEditDeadline = 0
    const cfg = readConfig()
    if (!cfg.autoSync) return
    // 两种触发方式互斥：停止编辑模式下不装固定间隔定时器，
    // 但启动时要给出一个截止时间，UI 才能显示秒级倒计时
    if (cfg.autoMode === 'stop-edit') {
      const wait = Math.max(60000, (cfg.onStopEditMinutes || 1) * 60000)
      if (!stopEditDeadline) stopEditDeadline = Date.now() + wait
      return
    }
    const iv = Math.max(60000, cfg.intervalMs || DEFAULTS.intervalMs)
    intervalStartedAt = Date.now()
    intervalTimer = setInterval(() => {
      intervalStartedAt = Date.now()
      autoRun('interval')
    }, iv)
    if (intervalTimer.unref) intervalTimer.unref()
    const lastOk = cfg.lastRunAt || 0
    if (lastOk && Date.now() - lastOk >= iv) {
      catchupTimer = setTimeout(() => { catchupTimer = null; autoRun('catchup') }, 8000)
      if (catchupTimer.unref) catchupTimer.unref()
    }
  }

  function noteEditActivity() {
    const cfg = readConfig()
    if (!cfg.autoSync || cfg.autoMode !== 'stop-edit' || !cfg.onStopEditMinutes) return
    if (stopEditTimer) clearTimeout(stopEditTimer)
    const wait = Math.max(60000, cfg.onStopEditMinutes * 60000)
    stopEditDeadline = Date.now() + wait
    stopEditTimer = setTimeout(() => { stopEditTimer = null; stopEditDeadline = 0; autoRun('stop-edit') }, wait)
    if (stopEditTimer.unref) stopEditTimer.unref()
  }

  // 供 UI 显示倒计时：返回 { at, mode } 或 null
  function nextAutoAt() {
    const cfg = readConfig()
    if (!cfg.autoSync) return null
    if (cfg.autoMode === 'stop-edit') {
      return (stopEditDeadline && stopEditDeadline > Date.now())
        ? { at: stopEditDeadline, mode: 'stop-edit' } : null
    }
    const iv = Math.max(60000, cfg.intervalMs || DEFAULTS.intervalMs)
    if (!intervalStartedAt) return null
    let at = intervalStartedAt + iv
    const now = Date.now()
    while (at <= now) at += iv
    return { at, mode: 'interval' }
  }

  let autoBusy = false
  async function autoRun(reason) {
    if (autoBusy) return { ok: false, kind: 'busy', message: '自动同步已在执行' }
    const cfg = readConfig()
    if (!cfg.autoSync && reason !== 'manual') return { ok: false, kind: 'off', message: '自动同步未开启' }
    autoBusy = true
    try {
      const st = await getState()
      if (!st.ok) return st
      if (!st.data.isRepo) return { ok: false, kind: 'norepo', message: ERR_TEXT.norepo }
      if (!st.data.dirty) return { ok: true, data: { steps: [], note: '无改动' } }

      const r = await sync(null, { pull: true, push: cfg.pushEnabled })
      if (r.ok) {
        writeConfig({ lastRunAt: Date.now(), failCount: 0, lastAutoResult: { at: new Date().toISOString(), ok: true, steps: r.data.steps } })
        log('INFO', 'auto(' + reason + ') 完成: ' + r.data.steps.join(','))
      } else {
        const fc = (readConfig().failCount || 0) + 1
        writeConfig({ failCount: fc, lastAutoResult: { at: new Date().toISOString(), ok: false, kind: r.kind, message: r.message } })
        log('ERR', 'auto(' + reason + ') 失败(' + fc + '): ' + r.kind + ' ' + r.message)
        // 连续失败 5 次后暂停自动同步，避免无限重试
        if (fc >= 5) {
          writeConfig({ autoSync: false })
          clearTimers()
          log('ERR', '连续失败 ' + fc + ' 次，已暂停自动同步')
        }
      }
      return r
    } catch (e) {
      log('ERR', 'auto 异常: ' + ((e && e.message) || e))
      return { ok: false, kind: 'unknown', message: (e && e.message) || String(e) }
    } finally {
      autoBusy = false
      // 停止编辑模式：一次自动触发结束后清掉截止时间，等下次编辑再重新计时，
      // 否则倒计时会停在 0 秒
      try {
        const c2 = readConfig()
        if (c2.autoMode === 'stop-edit' && reason !== 'manual') stopEditDeadline = 0
      } catch (e) {}
    }
  }

  // ======================= 仓库初始化 =======================
  // mode: 'local' 完全本地 | 'remote' 绑定远程
  // 只做安全操作：init、写 .gitignore、add、首次 commit、可选 push -u
  // 绝不 clone 覆盖已有文件，绝不 reset --hard
  async function initRepo(opts) {
    const o = opts || {}
    if (repoRoot) return { ok: false, kind: 'exists', message: '当前目录已经在 git 仓库中：' + repoRoot }
    if (!fs.existsSync(WS) || !fs.statSync(WS).isDirectory()) {
      return { ok: false, kind: 'norepo', message: '笔记目录不存在：' + WS }
    }
    const branch = String(o.branch || 'main').replace(/[^A-Za-z0-9._\/-]/g, '') || 'main'

    // 先把参数全部校验完，再动仓库；否则失败会留下半初始化的 .git
    let url = ''
    if (o.mode === 'remote') {
      url = String(o.remoteUrl || '').trim()
      if (!url) return { ok: false, kind: 'badrev', message: '请填写远程仓库地址' }
      if (!/^(https?:\/\/|git@|ssh:\/\/|file:\/\/|[A-Za-z]:[\\/]|\\\\|\/)/.test(url)) {
        return { ok: false, kind: 'badrev', message: '远程地址格式不正确：' + url }
      }
      // 备份到"空仓库"：远端已经有分支就别推了，直接提示改用「接入已有仓库」，
      // 否则会 push 被拒（non-fast-forward），只留下一个半初始化的本地仓库
      try {
        const probe = await runGit(['ls-remote', '--heads', url], { label: 'ls-remote', timeout: 60000 })
        if (probe.ok && String(probe.data || '').trim()) {
          return {
            ok: false, kind: 'badrev',
            message: '这个远程仓库里已经有内容了。想把它的笔记下载下来，请改用「接入已有仓库」。'
          }
        }
      } catch (e) {}
    }

    const init = await runGit(['init', '-b', branch], { label: 'init' })
    if (!init.ok) {
      // 老版本 git 不支持 -b
      const init2 = await runGit(['init'], { label: 'init-plain' })
      if (!init2.ok) return init2
    }
    locateRepo()
    if (!repoRoot) return { ok: false, kind: 'unknown', message: 'git init 之后仍未识别到仓库' }

    const steps = ['init']

    // .gitignore：忽略编辑器状态，但保留 attachments
    try {
      const gi = path.join(repoRoot, '.gitignore')
      if (!fs.existsSync(gi)) {
        fs.writeFileSync(gi, [
          '.obsidian/workspace.json',
          '.obsidian/workspace-mobile.json',
          '.obsidian/cache',
          '.DS_Store',
          'Thumbs.db',
          'desktop.ini',
          ''
        ].join('\n'), 'utf8')
        steps.push('gitignore')
      }
    } catch (e) {}

    if (o.userName || o.userEmail) {
      if (o.userName) await runGit(['config', 'user.name', String(o.userName)], { label: 'cfg-name' })
      if (o.userEmail) await runGit(['config', 'user.email', String(o.userEmail)], { label: 'cfg-email' })
      steps.push('identity')
    }

    if (o.mode === 'remote' && url) {
      const add = await runGit(['remote', 'add', 'origin', url], { label: 'remote-add' })
      if (!add.ok && !/already exists/i.test(add.message || '')) return Object.assign(add, { steps })
      steps.push('remote')
    }

    // 首次提交（目录里已有笔记时）
    const st0 = await runGit(['status', '--porcelain'], { label: 'status' })
    if (st0.ok && st0.data.trim()) {
      const add = await runGit(['add', '-A'], { label: 'add' })
      if (!add.ok) return Object.assign(add, { steps })
      const c = await runGit(['commit', '-m', 'notes: 初始化仓库'], { label: 'commit', timeout: 120000 })
      if (!c.ok) {
        // 首次提交失败（常见于未配置 user.name/email）：回滚本次新建的 .git，避免留下半初始化状态
        try {
          const gd = gitDir()
          if (gd && fs.existsSync(gd)) fs.rmSync(gd, { recursive: true, force: true })
          repoRoot = null
          scopeRel = ''
        } catch (e) {}
        return {
          ok: false, kind: c.kind,
          message: '首次提交失败：' + c.message + '（已回滚，可填写提交者姓名与邮箱后重试）',
          steps
        }
      }
      steps.push('commit')
    }

    // 绑定远程后尝试首次推送
    if (o.mode === 'remote' && o.remoteUrl && o.push !== false) {
      const ps = await runGit(['push', '-u', 'origin', branch], { label: 'push-first', timeout: 180000 })
      if (ps.ok) steps.push('push')
      else {
        return {
          ok: true,
          data: {
            steps, warning: '推送未成功：' + ps.message + '。本地仓库已建好，可稍后在面板里点「推送」。',
            repoRoot, branch
          }
        }
      }
    }

    log('INFO', '初始化仓库完成 mode=' + (o.mode || 'local') + ' branch=' + branch + ' steps=' + steps.join(','))
    return { ok: true, data: { steps, repoRoot, branch, scopeRel } }
  }

  /**
   * 接入已有远程仓库（云 → 本地）。
   * 安全约束：只允许空文件夹（最多存在自动生成的示例笔记与 .attachments）。
   * 只要检测到用户文件或已有 .git 就直接拒绝，绝不覆盖任何本地内容。
   */
  // 校验远端地址是否可用：能 ls-remote 通才算有效。
  // 空仓库（一个分支都没有）也算有效——那是合法的"新建仓库"。
  async function checkRemote (url) {
    const u = String(url || '').trim()
    if (!u) return { ok: false, message: '请填写远端地址' }
    const r = await runGit(['ls-remote', '--heads', u], { label: 'checkRemote', timeout: 25000 })
    if (!r.ok) {
      const msg = String(r.message || '无法连接').replace(/\s+/g, ' ').trim().slice(0, 200)
      return { ok: false, kind: r.kind, message: msg }
    }
    const branches = String(r.data || '').split('\n')
      .map(function (line) {
        const m = /refs\/heads\/(.+)$/.exec(line.trim())
        return m ? m[1] : ''
      })
      .filter(Boolean)
    return { ok: true, branches: branches }
  }

  // 接入前预检：把 adoptRepo 里的空目录判断独立出来，
  // 让 UI 能在弹确认框之前就发现"目录非空"，而不是让用户点两次才看到错误。
  function adoptPrecheck () {
    const out = { ok: true, blocking: [], keepable: [], reason: '' }
    try {
      if (!fs.existsSync(WS) || !fs.statSync(WS).isDirectory()) {
        out.ok = false
        out.reason = '文件夹不存在：' + WS
        return out
      }
      const entries = fs.readdirSync(WS, { withFileTypes: true })
      const PLUGIN_OWNED = ['.cmark', '.attachments', 'backup']
      for (const e of entries) {
        if (e.name === '.git') { out.blocking.push('.git'); continue }
        if (PLUGIN_OWNED.indexOf(e.name) >= 0) { out.keepable.push(e.name); continue }
        if (!e.isDirectory() && /^CMark 快速上手\.(md|markdown)$/i.test(e.name)) { out.keepable.push(e.name); continue }
        out.blocking.push(e.name + (e.isDirectory() ? '/' : ''))
      }
      out.ok = out.blocking.length === 0
      if (!out.ok) out.reason = '工作区里有 ' + out.blocking.length + ' 项内容'
    } catch (e) {
      out.ok = false
      out.reason = '无法读取文件夹：' + e.message
    }
    return out
  }

  async function adoptRepo(opts) {
    const o = opts || {}
    const url = String(o.remoteUrl || '').trim()
    const branch = String(o.branch || 'main').replace(/[^A-Za-z0-9._\-\/]/g, '') || 'main'
    if (!url) return { ok: false, kind: 'badrev', message: '请填写远程仓库地址' }
    try { if (!fs.existsSync(WS)) fs.mkdirSync(WS, { recursive: true }) } catch (e) {}
    if (!fs.existsSync(WS) || !fs.statSync(WS).isDirectory()) {
      return { ok: false, kind: 'norepo', message: '文件夹不存在：' + WS }
    }

    // ---------- 防御性检查：目录必须为空 ----------
    let entries = []
    try { entries = fs.readdirSync(WS, { withFileTypes: true }) } catch (e) {
      return { ok: false, kind: 'perm', message: '无法读取文件夹：' + e.message }
    }
    const keepable = []     // 自动生成的示例笔记：备份后清掉
    const blocking = []     // 用户内容：直接拒绝
    // 插件自己生成的目录不算用户内容：.cmark（排序/只读/附件）、.attachments（旧版附件）、
    // backup（改动前的自动备份）。选文件夹时插件就会建 .cmark，
    // 若不剔除，用户刚选完目录再想接入远程仓库就永远被判定"非空"。
    const PLUGIN_OWNED = ['.cmark', '.attachments', 'backup']
    for (const e of entries) {
      if (e.name === '.git') { blocking.push('.git'); continue }
      if (PLUGIN_OWNED.indexOf(e.name) >= 0) { keepable.push(e.name); continue }
      if (!e.isDirectory() && /^CMark 快速上手\.(md|markdown)$/i.test(e.name)) { keepable.push(e.name); continue }
      blocking.push(e.name + (e.isDirectory() ? '/' : ''))
    }
    if (blocking.length) {
      return {
        ok: false, kind: 'dirty',
        message: '这个文件夹里已经有 ' + blocking.length + ' 项内容（' + blocking.slice(0, 3).join('、') +
          (blocking.length > 3 ? ' 等' : '') + '）。接入远程 git 仓库需要一个新的空文件夹。'
      }
    }

    // ---------- 备份示例笔记再清掉 ----------
    let backupPath = ''
    if (keepable.length) {
      try {
        backupPath = path.join(backupDir, 'adopt-pre-' + Date.now())
        fs.mkdirSync(backupPath, { recursive: true })
        keepable.forEach(function (n) {
          try { fs.cpSync(path.join(WS, n), path.join(backupPath, n), { recursive: true }) } catch (e) {}
        })
        keepable.forEach(function (n) { try { fs.rmSync(path.join(WS, n), { recursive: true, force: true }) } catch (e) {} })
      } catch (e) {}
    }

    // ---------- init + remote + fetch + reset ----------
    const steps = []
    const init = await runGit(['init', '-b', branch], { label: 'init' })
    if (!init.ok) {
      const init2 = await runGit(['init'], { label: 'init-plain' })
      if (!init2.ok) return init2
    }
    locateRepo()
    if (!repoRoot) return { ok: false, kind: 'unknown', message: 'git init 之后仍未识别到仓库' }
    steps.push('init')

    const add = await runGit(['remote', 'add', 'origin', url], { label: 'remote-add' })
    if (!add.ok && !/already exists/i.test(add.message || '')) return Object.assign(add, { steps })
    steps.push('remote')

    const fetch = await runGit(['fetch', 'origin', '--prune'], { label: 'fetch-adopt', timeout: 300000 })
    if (!fetch.ok) {
      return { ok: false, kind: fetch.kind, steps, message: '拉取远端失败：' + fetch.message + '（请检查仓库地址与访问权限）' }
    }
    steps.push('fetch')

    const rev = await runGit(['rev-parse', '--verify', 'origin/' + branch], { label: 'rev-adopt' })
    if (!rev.ok) {
      return {
        ok: false, kind: 'badrev', steps,
        message: '远端没有分支 ' + branch + '。如果这是一个空仓库，请改用「备份到新的空仓库」。'
      }
    }

    const reset = await runGit(['reset', '--hard', 'origin/' + branch], { label: 'reset-adopt' })
    if (!reset.ok) return Object.assign(reset, { steps })
    steps.push('reset')

    await runGit(['branch', '--set-upstream-to=origin/' + branch, branch], { label: 'upstream' })
    steps.push('upstream')

    log('INFO', '接入远程仓库完成 url=' + url + ' branch=' + branch + ' steps=' + steps.join(',') + (backupPath ? ' backup=' + backupPath : ''))
    return { ok: true, data: { steps, repoRoot, branch, scopeRel, backup: backupPath } }
  }

  // ======================= 分支 =======================
  // 本地 + 远程分支列表（只读，不排队，打开面板要即时）
  async function branches() {
    if (!repoRoot) return { ok: false, kind: 'norepo', message: ERR_TEXT.norepo }
    const r = await runGit(['for-each-ref', '--format=%(refname:short)|%(refname)|%(HEAD)|%(upstream:short)', 'refs/heads', 'refs/remotes'], { label: 'for-each-ref', timeout: 30000 })
    if (!r.ok) return r
    const local = []
    const remote = []
    let cur = ''
    String(r.data || '').split('\n').forEach(function (line) {
      const p = String(line).split('|')
      if (p.length < 3) return
      const short = p[0]
      const full = p[1]
      const head = p[2]
      const up = p[3] || ''
      if (!short || !full) return
      if (full.indexOf('refs/heads/') === 0) {
        local.push({ name: short, upstream: up })
        if (head === '*') cur = short
      } else if (full.indexOf('refs/remotes/') === 0) {
        if (/\/HEAD$/.test(short)) return
        remote.push({ name: short })
      }
    })
    return { ok: true, data: { local: local, remote: remote, current: cur } }
  }

  // 切换分支：有未提交改动时直接拒绝，避免把改动带到别的分支上
  async function checkoutBranch(name) {
    const n = String(name || '').trim()
    if (!n) return { ok: false, kind: 'badrev', message: '分支名不能为空' }
    return enqueue('checkout', async () => {
      const st = await getState()
      if (st && st.ok && st.data && typeof st.data.dirty === 'number' && st.data.dirty > 0) {
        return { ok: false, kind: 'dirty', message: '有 ' + st.data.dirty + ' 个文件未提交，先提交或撤销改动再切换分支' }
      }
      const r = await runGit(['checkout', n], { label: 'checkout', timeout: 180000 })
      if (!r.ok && n.indexOf('/') > 0) {
        // 远程分支（origin/xxx）：建一个同名本地分支跟踪它
        const localName = n.split('/').slice(1).join('-')
        const r2 = await runGit(['checkout', '-b', localName, '--track', n], { label: 'checkout-track', timeout: 180000 })
        if (r2.ok) { locateRepo(); return { ok: true, data: { branch: localName } } }
        return r2
      }
      if (!r.ok) return r
      locateRepo()
      return { ok: true, data: { branch: n } }
    })
  }

  // 新建分支并切过去（基于当前 HEAD 或指定分支）
  async function createBranch(name, from) {
    const n = String(name || '').trim().replace(/[\\/:*?"<>|\s]/g, '-')
    if (!n) return { ok: false, kind: 'badrev', message: '请填写分支名' }
    return enqueue('branch-new', async () => {
      const args = ['checkout', '-b', n]
      if (from) args.push(String(from))
      const r = await runGit(args, { label: 'branch-new', timeout: 180000 })
      if (!r.ok) return r
      locateRepo()
      return { ok: true, data: { branch: n } }
    })
  }

  // ======================= 中断恢复 =======================
  async function abortInProgress() {
    const st = inspectRepoState()
    if (!st.inProgress) return { ok: true, data: { note: '当前没有进行中的操作' } }
    return enqueue('abort', async () => {
      const cmd = st.inProgress === 'rebase' ? ['rebase', '--abort']
        : st.inProgress === 'merge' ? ['merge', '--abort']
          : st.inProgress === 'cherry-pick' ? ['cherry-pick', '--abort']
            : ['revert', '--abort']
      const r = await runGit(cmd, { label: 'abort-' + st.inProgress })
      return r.ok ? { ok: true, data: { aborted: st.inProgress } } : r
    })
  }

  async function clearStaleLock() {
    const st = inspectRepoState()
    if (!st.locked) return { ok: true, data: { note: '没有 index.lock' } }
    if (st.lockAgeMs < 10 * 60 * 1000) {
      return { ok: false, kind: 'lock', message: '锁文件创建仅 ' + Math.round(st.lockAgeMs / 1000) + ' 秒，可能有 git 操作正在进行' }
    }
    try {
      const dest = path.join(backupDir, 'stale-index-lock-' + Date.now() + '.lock')
      fs.copyFileSync(st.lockFile, dest)
      fs.unlinkSync(st.lockFile)
      log('INFO', '已移除陈旧 index.lock，备份 ' + dest)
      return { ok: true, data: { removed: st.lockFile, backup: dest } }
    } catch (e) {
      return { ok: false, kind: 'perm', message: '移除锁文件失败：' + e.message }
    }
  }

  // ======================= 对外 =======================
  // 远端地址：读取 / 设置（空字符串 = 移除远端，回到纯本地仓库）
  async function getRemoteInfo() {
    try {
      const names = await remoteNames()
      if (!names.length) return { ok: true, data: { hasRemote: false, name: '', url: '' } }
      const r = await runGit(['remote', 'get-url', names[0]], { label: 'remote-url' })
      return { ok: true, data: { hasRemote: true, name: names[0], url: r.ok ? String(r.data || '').trim() : '' } }
    } catch (e) {
      return { ok: false, message: (e && e.message) || String(e) }
    }
  }

  // ---- 手填远程地址的支持 ----
  // 远程地址可能是需要授权的私有仓库（GitHub/Gitee/自建 GitLab 等）。
  // 这里给两个能力：先探测（看能不能免授权访问），再用显式 token 探测/绑定。
  async function probeRemote (url, token) {
    const u = String(url || '').trim()
    if (!u) return { ok: false, kind: 'badrev', message: '请填写远程仓库地址' }
    if (!/^(https?:\/\/|git@|ssh:\/\/|file:\/\/|[A-Za-z]:[\\/]|\\\\|\/)/.test(u)) {
      return { ok: false, kind: 'badrev', message: '远程地址格式不正确：' + u }
    }
    const r = await runGit(['ls-remote', '--heads', u], { label: 'probe', timeout: 60000, token: token || undefined })
    if (r.ok) return { ok: true, data: { hasRefs: !!String(r.data || '').trim() } }
    return { ok: false, kind: r.kind, message: r.message }
  }

  /** 保存手填地址用的访问令牌（按工作区存，记录地址用于展示） */
  function setRemoteToken (token, url) {
    const t = String(token || '').trim()
    if (!t) return { ok: false, message: '令牌为空' }
    const res = wsPrefs.patch(WS, { remoteToken: { provider: 'custom', token: t, url: String(url || '').trim() } })
    if (res && res.ok === false) return res
    return { ok: true }
  }

  async function setRemote(url) {
    const pre = precheck()
    if (!pre.ok) return pre
    const u = String(url || '').trim()
    return enqueue('set-remote', async () => {
      const names = await remoteNames()
      if (!u) {
        if (!names.length) return { ok: true, data: { removed: false, hasRemote: false } }
        const r = await runGit(['remote', 'remove', names[0]], { label: 'remote-remove' })
        if (!r.ok) return r
        return { ok: true, data: { removed: true, hasRemote: false } }
      }
      if (!names.length) {
        const r = await runGit(['remote', 'add', 'origin', u], { label: 'remote-add' })
        if (!r.ok) return r
        return { ok: true, data: { added: true, hasRemote: true, url: u } }
      }
      const r = await runGit(['remote', 'set-url', names[0], u], { label: 'remote-set-url' })
      if (!r.ok) return r
      return { ok: true, data: { updated: true, hasRemote: true, url: u } }
    })
  }

  // 提交者身份：读全局（user.name/email）与本仓库局部配置，供设置面板预填
  async function getIdentity() {
    try {
      const gN = await runGit(['config', '--get', 'user.name'], { label: 'id-g-name' })
      const gE = await runGit(['config', '--get', 'user.email'], { label: 'id-g-email' })
      const lN = await runGit(['config', '--local', '--get', 'user.name'], { label: 'id-l-name' })
      const lE = await runGit(['config', '--local', '--get', 'user.email'], { label: 'id-l-email' })
      const t = (r) => (r && r.ok ? String(r.data || '').trim() : '')
      return { ok: true, data: { globalName: t(gN), globalEmail: t(gE), localName: t(lN), localEmail: t(lE) } }
    } catch (e) {
      return { ok: false, message: (e && e.message) || String(e) }
    }
  }

  // 写入本仓库身份；传空则清除局部配置（回落到全局）
  async function setIdentity(name, email) {
    const pre = precheck()
    if (!pre.ok) return pre
    return enqueue('identity', async () => {
      const nn = String(name == null ? '' : name).trim()
      const ee = String(email == null ? '' : email).trim()
      if (nn) {
        const r = await runGit(['config', '--local', 'user.name', nn], { label: 'id-set-name' })
        if (!r.ok) return r
      } else {
        await runGit(['config', '--local', '--unset', 'user.name'], { label: 'id-unset-name' })
      }
      if (ee) {
        const r = await runGit(['config', '--local', 'user.email', ee], { label: 'id-set-email' })
        if (!r.ok) return r
      } else {
        await runGit(['config', '--local', '--unset', 'user.email'], { label: 'id-unset-email' })
      }
      return { ok: true, data: { name: nn, email: ee } }
    })
  }

  const api = {
    get repoRoot() { return repoRoot },
    get scopeRel() { return scopeRel },
    state: getState,
    inspect: inspectRepoState,
    rediscover: () => { cfgCache = null; return locateRepo() },
    log: fileLog,
    logCount: fileLogCount,
    repoLog,
    repoLogCount,
    show: showAt,
    commitFiles,
    diff: diffOf,
    diffWork,
    stage, unstage, discard, restoreTo,
    commitAll, push, pull, sync,
    remoteInfo: getRemoteInfo, setRemote,
    probeRemote, setRemoteToken,
    identity: getIdentity, setIdentity,
    abortInProgress,
    clearStaleLock,
    initRepo,
    adoptRepo,
    adoptPrecheck,
    checkRemote,
    branches,
    checkoutBranch,
    createBranch,
    config: () => {
      const c = readConfig()
      return {
        ok: true,
        data: {
          autoSync: !!c.autoSync, autoMode: c.autoMode || 'interval',
          intervalMs: c.intervalMs, onStopEditMinutes: c.onStopEditMinutes || 0,
          pullBeforePush: !!c.pullBeforePush, pushEnabled: !!c.pushEnabled, commitScope: c.commitScope || 'notes',
          commitMessage: c.commitMessage, lastRunAt: c.lastRunAt || 0, failCount: c.failCount || 0,
          lastAutoResult: c.lastAutoResult || null
        }
      }
    },
    setConfig: (patch) => {
      const r = writeConfig(patch)
      if (!r.ok) return r
      scheduleAuto()
      log('INFO', 'config: ' + JSON.stringify(patch))
      return api.config()
    },
    autoRun,
    noteEditActivity,
    nextAutoAt,
    logTail,
    relOf, absOf,
    formatMessage,
    isBusy: () => busy
  }

  win.__znotesGit = api
  scheduleAuto()
  log('INFO', 'git service v2 启动 repo=' + (repoRoot || '(无)') + ' scope=' + (scopeRel || '(整仓)') + ' ws=' + WS)
  return api
}