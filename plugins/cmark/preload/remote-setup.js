/**
 * remote-setup.js —— 一键授权建仓 / 绑定远程笔记仓库
 *
 * 为什么要这个模块：
 *   原来绑定远程要用户自己开网页建仓、复制仓库地址、再配 SSH 或凭据管理器，
 *   对不熟 git 的人门槛太高。这里把「授权 → 建仓（或选已有仓库）→ 绑定 remote → 首次推送」串起来。
 *
 * 两个平台的能力差异（查过官方文档）：
 *   GitHub：OAuth Device Flow，只需 client_id，不需要 client_secret，
 *           用户在 github.com/login/device 输入 8 位码即可，桌面端的安全做法。
 *   Gitee ：OAuth2 强制 client_secret（嵌进安装包会被提取），所以改用「私人令牌」，
 *           用户在 gitee.com/profile/personal_access_tokens 生成后粘进来。
 *
 * token 存哪：
 *   ~/.cmark-config.json 的 remoteToken 字段（明文，与 git 自身的凭据存储同级别）。
 *   git 运行时通过内联 credential helper + 环境变量传入，不写进 .git/config。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const https = require('https')
const { execFile } = require('child_process')
const wsPrefs = require('./ws-prefs.js')

const CFG_PATH = path.join(os.homedir(), '.cmark-config.json')
const GITHUB_CLIENT_ID = 'Ov23liDQDiefOfwzHHLA'
const GITHUB_SCOPE = 'repo'
const UA = 'CMark-ZTools-Plugin'

/* ---------------- 配置读写 ---------------- */
function readJSON (p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return null }
}
function readCfg () {
  return readJSON(CFG_PATH) || {}
}
function patchCfg (patch) {
  const next = Object.assign({}, readCfg(), patch || {})
  try {
    fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true })
    fs.writeFileSync(CFG_PATH, JSON.stringify(next, null, 2), 'utf8')
    return true
  } catch (e) { return false }
}

/* ---------------- HTTP ---------------- */
function request (opts) {
  const o = opts || {}
  return new Promise(function (resolve) {
    let body = o.body || ''
    const headers = Object.assign({
      'User-Agent': UA,
      Accept: 'application/json'
    }, o.headers || {})
    if (body && !headers['Content-Type']) headers['Content-Type'] = 'application/x-www-form-urlencoded'
    if (body) headers['Content-Length'] = Buffer.byteLength(body)
    const req = https.request({
      hostname: o.hostname,
      path: o.path,
      method: o.method || 'GET',
      headers: headers,
      timeout: o.timeout || 20000
    }, function (res) {
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', function (c) { buf += c })
      res.on('end', function () {
        let data = null
        try { data = JSON.parse(buf) } catch (e) { data = { raw: buf.slice(0, 500) } }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: data })
      })
    })
    req.on('timeout', function () { req.destroy(new Error('请求超时')) })
    req.on('error', function (e) { resolve({ ok: false, status: 0, data: { message: (e && e.message) || String(e) } }) })
    if (body) req.write(body)
    req.end()
  })
}
function form (obj) {
  return Object.keys(obj).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k] == null ? '' : obj[k])
  }).join('&')
}

/* ---------------- GitHub Device Flow ---------------- */
function ghStart () {
  return request({
    hostname: 'github.com',
    path: '/login/device/code',
    method: 'POST',
    body: form({ client_id: GITHUB_CLIENT_ID, scope: GITHUB_SCOPE })
  }).then(function (r) {
    const d = r.data || {}
    if (!r.ok || !d.device_code) {
      return { ok: false, message: d.error_description || d.message || '申请设备码失败（检查 OAuth App 是否开启 Device Flow）' }
    }
    return {
      ok: true,
      deviceCode: d.device_code,
      userCode: d.user_code,
      verificationUri: d.verification_uri || 'https://github.com/login/device',
      expiresIn: d.expires_in || 900,
      interval: d.interval || 5
    }
  })
}

// 单次轮询：pending = 用户还没在浏览器里确认
function ghPoll (deviceCode) {
  return request({
    hostname: 'github.com',
    path: '/login/oauth/access_token',
    method: 'POST',
    body: form({
      client_id: GITHUB_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  }).then(function (r) {
    const d = r.data || {}
    if (d.access_token) return { ok: true, token: d.access_token }
    if (d.error === 'authorization_pending') return { ok: false, pending: true }
    if (d.error === 'slow_down') return { ok: false, pending: true, slowDown: true }
    if (d.error === 'expired_token') return { ok: false, message: '设备码已过期，请重新发起授权' }
    if (d.error === 'access_denied') return { ok: false, message: '你取消了授权' }
    return { ok: false, message: d.error_description || d.error || ('轮询失败 HTTP ' + r.status) }
  })
}

function ghApi (token, method, apiPath, bodyObj) {
  const body = bodyObj ? JSON.stringify(bodyObj) : ''
  return request({
    hostname: 'api.github.com',
    path: apiPath,
    method: method,
    headers: Object.assign({
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json'
    }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body
  }).then(function (r) { return { ok: r.ok, status: r.status, data: r.data || {} } })
}

function ghUser (token) {
  return ghApi(token, 'GET', '/user').then(function (r) {
    if (!r.ok) return { ok: false, message: (r.data && r.data.message) || '无法读取 GitHub 账号' }
    return { ok: true, login: r.data.login, name: r.data.name || r.data.login }
  })
}

function ghListRepos (token) {
  return ghApi(token, 'GET', '/user/repos?per_page=100&sort=updated&affiliation=owner').then(function (r) {
    if (!r.ok) return { ok: false, message: (r.data && r.data.message) || '读取仓库列表失败' }
    const list = (Array.isArray(r.data) ? r.data : []).map(function (x) {
      return {
        name: x.name,
        fullName: x.full_name,
        private: !!x.private,
        url: x.clone_url,
        updatedAt: x.updated_at,
        empty: x.size === 0
      }
    })
    return { ok: true, repos: list }
  })
}

function ghCreateRepo (token, name, isPrivate) {
  return ghApi(token, 'POST', '/user/repos', {
    name: name,
    private: isPrivate !== false,
    auto_init: false,
    description: 'CMark 笔记'
  }).then(function (r) {
    if (!r.ok) {
      const msg = (r.data && r.data.message) || '建仓失败'
      const detail = (r.data && r.data.errors && r.data.errors[0] && r.data.errors[0].message) || ''
      return { ok: false, message: msg + (detail ? '：' + detail : '') }
    }
    return { ok: true, url: r.data.clone_url, fullName: r.data.full_name }
  })
}

/* ---------------- Gitee（私人令牌） ---------------- */
function giteeApi (method, apiPath, params, token) {
  const query = Object.assign({}, params || {}, { access_token: token })
  const qs = form(query)
  const isGet = method === 'GET'
  return request({
    hostname: 'gitee.com',
    path: '/api/v5' + apiPath + (isGet ? '?' + qs : ''),
    method: method,
    body: isGet ? '' : qs
  }).then(function (r) { return { ok: r.ok, status: r.status, data: r.data || {} } })
}

function giteeVerify (token) {
  return giteeApi('GET', '/user', {}, token).then(function (r) {
    if (!r.ok) return { ok: false, message: (r.data && (r.data.message || r.data.error)) || '令牌无效或已过期' }
    return { ok: true, login: r.data.login || r.data.name, name: r.data.name || r.data.login }
  })
}

function giteeListRepos (token) {
  return giteeApi('GET', '/user/repos', { per_page: 100, sort: 'updated' }, token).then(function (r) {
    if (!r.ok) return { ok: false, message: (r.data && (r.data.message || r.data.error)) || '读取仓库列表失败' }
    const list = (Array.isArray(r.data) ? r.data : []).map(function (x) {
      return {
        name: x.name,
        fullName: x.full_name || (x.namespace && x.namespace.path ? x.namespace.path + '/' + x.name : x.name),
        private: !!x.private,
        url: x.html_url ? x.html_url.replace(/\.git$/, '') + '.git' : '',
        updatedAt: x.updated_at
      }
    })
    return { ok: true, repos: list }
  })
}

function giteeCreateRepo (token, name, isPrivate) {
  return giteeApi('POST', '/user/repos', {
    name: name,
    private: isPrivate !== false,
    auto_init: false,
    description: 'CMark 笔记'
  }, token).then(function (r) {
    if (!r.ok) return { ok: false, message: (r.data && (r.data.message || r.data.error)) || '建仓失败' }
    const full = r.data.full_name || r.data.path
    return { ok: true, url: 'https://gitee.com/' + full + '.git', fullName: full }
  })
}

/* ---------------- git 绑定 ---------------- */
const TOKEN_HELPER = '!f() { echo username=x-access-token; echo password=$CMARK_GIT_TOKEN; }; f'

function git (args, cwd, token, timeout) {
  return new Promise(function (resolve) {
    const pre = token
      ? ['-c', 'core.quotepath=false', '-c', 'credential.helper=', '-c', 'credential.helper=' + TOKEN_HELPER]
      : ['-c', 'core.quotepath=false', '-c', 'credential.helper=', '-c', 'credential.helper=manager']
    execFile('git', pre.concat(args), {
      cwd: cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      timeout: timeout || 120000,
      env: Object.assign({}, process.env, {
        GCM_INTERACTIVE: 'never',
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
        GIT_LITERAL_PATHSPECS: '1',
        CMARK_GIT_TOKEN: token || ''
      })
    }, function (err, stdout, stderr) {
      if (err) {
        resolve({ ok: false, message: String(stderr || stdout || err.message || '').trim().slice(0, 600) })
      } else {
        resolve({ ok: true, data: String(stdout || '').trim() })
      }
    })
  })
}

function isRepo (dir) {
  try { return fs.existsSync(path.join(dir, '.git')) } catch (e) { return false }
}

/**
 * 绑定远程笔记仓库
 * @param {object} o
 *   provider: 'github' | 'gitee'
 *   url:      https 仓库地址（不带 token）
 *   token:    访问令牌
 *   dir:      本地笔记目录
 *   existing: true 表示远程已有内容，需要先拉下来（否则会把本地空历史推上去）
 */
async function bind (o) {
  const opt = o || {}
  const dir = opt.dir
  const url = opt.url
  const token = opt.token
  if (!dir || !url || !token) return { ok: false, message: '参数不完整' }
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }) } catch (e) {
      return { ok: false, message: '无法创建目录：' + dir }
    }
  }

  const steps = []
  if (!isRepo(dir)) {
    const init = await git(['init', '-b', 'main'], dir)
    if (!init.ok) return { ok: false, message: 'git init 失败：' + init.message }
    steps.push('init')
  }

  const getRemote = await git(['remote', 'get-url', 'origin'], dir)
  if (getRemote.ok) {
    const setUrl = await git(['remote', 'set-url', 'origin', url], dir)
    if (!setUrl.ok) return { ok: false, message: '更新远端地址失败：' + setUrl.message }
    steps.push('remote-set')
  } else {
    const add = await git(['remote', 'add', 'origin', url], dir)
    if (!add.ok) return { ok: false, message: '添加 remote 失败：' + add.message }
    steps.push('remote-add')
  }

  if (opt.existing) {
    // 远程已有仓库：把内容拉下来（只能 fast-forward，避免覆盖本地笔记）
    const fetch = await git(['fetch', 'origin'], dir, token, 180000)
    if (!fetch.ok) return { ok: false, message: '拉取失败：' + fetch.message, steps: steps }
    steps.push('fetch')

    // 远端默认分支不一定是 main（Gitee 新建仓库默认 master），按远端 HEAD 指向来合并
    let remoteBranch = 'main'
    try {
      const sym = await git(['ls-remote', '--symref', 'origin', 'HEAD'], dir, token, 60000)
      const m = sym.ok ? /ref:\s+refs\/heads\/(\S+)\s+HEAD/.exec(sym.data || '') : null
      if (m && m[1]) remoteBranch = m[1]
    } catch (e) {}

    if (remoteBranch !== 'main') {
      // 本地是 main、远程是别的名字：把本地主干指到远程分支，避免两个平行根
      await git(['branch', '-M', remoteBranch], dir)
    }
    const merge = await git(['merge', '--ff-only', 'origin/' + remoteBranch], dir, token, 60000)
    if (!merge.ok) {
      return { ok: false, message: '合并远端分支 ' + remoteBranch + ' 失败：' + merge.message, steps: steps }
    }
    steps.push('merge')
  } else {
    // 全新仓库：提交本地内容后首次推送
    const hasCommit = await git(['rev-parse', '--verify', 'HEAD'], dir)
    if (!hasCommit.ok) {
      const addAll = await git(['add', '-A', '--', '.'], dir)
      if (!addAll.ok) return { ok: false, message: '暂存失败：' + addAll.message }
      const commit = await git(['commit', '-m', '初始化笔记仓库'], dir)
      if (!commit.ok && !/nothing to commit/i.test(commit.message)) {
        return { ok: false, message: '提交失败：' + commit.message }
      }
      steps.push('commit')
    }
    const push = await git(['push', '-u', 'origin', 'main'], dir, token, 180000)
    if (!push.ok) return { ok: false, message: '首次推送失败：' + push.message, steps: steps }
    steps.push('push')
  }

  // dir 是工作区（仓库根）。笔记目录若已经在它之内就保持不动，
  // 这样「工作区 D:\Proj + 笔记 D:\Proj\Notes」这种布局不会被建仓流程压平
  const cur = readCfg() || {}
  const curWs = cur.workspace || ''
  let keepWs = false
  try {
    const rel = path.relative(dir, curWs)
    keepWs = !!curWs && !rel.startsWith('..') && !path.isAbsolute(rel)
  } catch (e) { keepWs = false }
  patchCfg(Object.assign({ repoDir: dir, initialized: true }, keepWs ? {} : { workspace: dir }))
  const savedRes = wsPrefs.patch(dir, { remoteToken: { provider: opt.provider || '', token: token, url: url } })
  const saved = !!(savedRes && savedRes.ok)
  return { ok: saved, steps: steps, message: saved ? '' : ((savedRes && savedRes.message) || '写入配置失败') }
}

function attach (win) {
  win.__CMARK_REMOTE = {
    githubClientId: GITHUB_CLIENT_ID,
    ghStart: ghStart,
    ghPoll: ghPoll,
    ghUser: ghUser,
    ghListRepos: ghListRepos,
    ghCreateRepo: ghCreateRepo,
    giteeVerify: giteeVerify,
    giteeListRepos: giteeListRepos,
    giteeCreateRepo: giteeCreateRepo,
    bind: bind,
    // 当前是否已存过凭据
    current: function () {
      const c = readCfg() || {}
      const p = c.workspace ? wsPrefs.read(c.workspace) : {}
      const t = p.remoteToken || c.remoteToken
      return t ? { provider: t.provider, url: t.url } : null
    },
    clear: function () {
      const c = readCfg() || {}
      if (c.workspace) wsPrefs.patch(c.workspace, { remoteToken: null })
      patchCfg({ remoteToken: null })
      return { ok: true }
    },
    openUrl: function (u) { try { win.ztools && win.ztools.shellOpenExternal && win.ztools.shellOpenExternal(u) } catch (e) {} }
  }
  return win.__CMARK_REMOTE
}

module.exports = attach