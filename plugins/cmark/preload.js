/**
 * CMark V1.1.0 —— preload 入口
 *
 * 职责边界：
 *   渲染层（React）只关心界面，不碰文件系统；
 *   一切磁盘读写、git 操作、导出、附件都在这里。
 *
 * 挂到 window 上的三块能力：
 *   window.__ZNOTES      笔记数据层（笔记/目录/排序/只读/附件），实现见 preload/ndb.js
 *   window.__znotesGit 版本控制（init/adopt/commit/push/pull/sync/日志），见 preload/git-service.js
 *   window.services   导出、剪贴板、图片、文件杂项，见 preload/services.js
 *
 * 另加 window.__CMARK 作为本版本新增的控制面（配置读写、选目录、重扫）。
 */
// 宿主适配必须在一切之前：uTools 只注入 window.utools，ZTools 只注入 window.ztools，
// 补齐之后下面的代码才能统一用 window.ztools.xxx（两套 API 名字一致）
try { require('./preload/host').applyHostShim() } catch (e) {}

const path = require('path')

/** 启动期模块挂载失败时记一笔，方便用户/开发者直接在控制台看原因 */
function bootError(label, err) {
  try {
    window.__CMARK_BOOT_ERRORS = (window.__CMARK_BOOT_ERRORS || []).concat(
      label + ': ' + ((err && err.stack) || (err && err.message) || String(err))
    )
  } catch (e) {}
}
const fs = require('fs')
const { exportDocCss, exportDocColors } = require('./preload/export-css')
const os = require('os')

const CFG_PATH = path.join(os.homedir(), '.cmark-config.json')
const LEGACY_CFG = path.join(os.homedir(), '.znotes-config.json') // V1.0.0 的配置，首次启动时迁移

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (e) {
    return null
  }
}

function writeJSON(p, obj) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8')
    return true
  } catch (e) {
    console.error('[cmark] 写配置失败', e)
    return false
  }
}

/* ---------------- 配置：优先新文件，没有就从 V1.0.0 的配置迁移 ---------------- */
function loadConfig() {
  const cur = readJSON(CFG_PATH)
  if (cur && cur.workspace) return cur

  const legacy = readJSON(LEGACY_CFG)
  if (legacy && legacy.workspace) {
    const migrated = {
      workspace: legacy.workspace,
      initialized: legacy.initialized !== false,
      autoSync: legacy.autoSync || null,
      commit: legacy.commit || null,
    }
    writeJSON(CFG_PATH, migrated)
    return migrated
  }
  return { workspace: '', initialized: false }
}

function saveConfig(patch) {
  const next = Object.assign({}, loadConfig(), patch || {})
  writeJSON(CFG_PATH, next)
  return next
}

let config = loadConfig()

/* ---------------- 主题：light / dark / system ----------------
 * 用户在设置里选，配置存在 ~/.cmark-config.json 的 theme 字段。
 * 这里在 document-start 阶段就把 data-theme 写到 <html>，
 * 避免首帧先渲染浅色再跳深色。
 */
const THEME_MODES = ['light', 'dark', 'system']

function themeMode () {
  const m = (config || {}).theme
  return THEME_MODES.indexOf(m) >= 0 ? m : 'system'
}

function resolveTheme (mode) {
  if (mode === 'light' || mode === 'dark') return mode
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch (e) {
    return 'light'
  }
}

let themeRetryArmed = false

function applyTheme () {
  const mode = themeMode()
  const resolved = resolveTheme(mode)
  let applied = false
  try {
    const el = document && document.documentElement
    if (el) {
      el.setAttribute('data-theme', resolved)
      el.setAttribute('data-theme-mode', mode)
      el.style.colorScheme = resolved
      applied = true
    }
  } catch (e) {}
  // document-start 阶段 <html> 可能还不存在（页面重载时尤其明显）：
  // 之前这里静默失败后不再重试，结果 data-theme 永远没写上，
  // 界面回退浅色，而设置面板读配置仍显示「深色」——两边对不上。
  if (!applied && !themeRetryArmed) {
    themeRetryArmed = true
    try {
      if (document && typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', function () { themeRetryArmed = false; applyTheme() }, { once: true })
      }
    } catch (e) {}
    setTimeout(function () { themeRetryArmed = false; try { applyTheme() } catch (e) {} }, 80)
  }
  try {
    if (window && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('cmark-theme', { detail: { mode: mode, resolved: resolved } }))
    }
  } catch (e) {}
  return { mode: mode, resolved: resolved }
}

const themeApi = {
  get: function () { return { mode: themeMode(), resolved: resolveTheme(themeMode()) } },
  set: function (mode) {
    if (THEME_MODES.indexOf(mode) < 0) mode = 'system'
    config = saveConfig({ theme: mode })
    return applyTheme()
  },
  apply: applyTheme
}

try {
  if (window) window.__CMARK_THEME = themeApi
} catch (e) {}

applyTheme()

// 跟随系统时，系统深浅色切换要实时生效
try {
  const mq = matchMedia('(prefers-color-scheme: dark)')
  const onChange = function () { if (themeMode() === 'system') applyTheme() }
  if (mq.addEventListener) mq.addEventListener('change', onChange)
  else if (mq.addListener) mq.addListener(onChange)
} catch (e) {}

// 工作区未设置或不存在时，退到 ~/Documents/CMark，不弹任何框
let workspace = config.workspace
if (!workspace || !fs.existsSync(workspace)) {
  const docs = path.join(os.homedir(), 'Documents')
  workspace = path.join(fs.existsSync(docs) ? docs : os.homedir(), 'CMark')
  try {
    fs.mkdirSync(workspace, { recursive: true })
  } catch (e) {}
}

/* ---------------- Git 集成开关 ----------------
 * 存配置文件而不是 localStorage：插件跑在 file:// origin 下，localStorage 可能直接抛 SecurityError
 * （被 try/catch 静默吞掉，表现就是「开关点了没生效、状态读不到」）。
 * 这里给渲染层与注入脚本一个同步读写的入口，set 时广播事件让各界面同步。
 */
const wsPrefs = require('./preload/ws-prefs.js')

function currentWs () {
  try {
    if (config && config.workspace) return config.workspace
    // workspace 在下方才声明；这里用 typeof 兜住 TDZ，读取时它通常已初始化
    return typeof workspace === 'string' ? workspace : ''
  } catch (e) { return '' }
}

const gitApi = {
  // 返回 true / false / null（null = 该工作区还没设置过）
  // 存在「按工作区」的 prefs.json 里：换笔记库不会沿用上一个库的开关
  get: function () {
    const p = wsPrefs.read(currentWs())
    if (typeof p.gitEnabled === 'boolean') return p.gitEnabled
    // 兼容上一版写在全局配置里的值
    if (config && typeof config.gitEnabled === 'boolean') return config.gitEnabled
    return null
  },
  set: function (on) {
    wsPrefs.patch(currentWs(), { gitEnabled: !!on })
    try {
      if (window) window.dispatchEvent(new CustomEvent('cmark-git-changed', { detail: { enabled: !!on } }))
    } catch (e) {}
    return !!on
  }
}
try { if (window) window.__CMARK_GIT = gitApi } catch (e) {}

/* ---------------- 挂载数据层 ---------------- */
// ndb.js 的第二个参数是"能读到 workspace 字段的 JSON 路径"
try {
  require('./preload/ndb.js')(window, CFG_PATH)
} catch (e) {
  console.error('[cmark] ndb 挂载失败', e)
  bootError('ndb', e)
}

/* ---------------- 挂载版本控制 ---------------- */
try {
  require('./preload/git-service.js')(window, workspace)
} catch (e) {
  console.error('[cmark] git 服务挂载失败', e)
  bootError('git-service', e)
}

/* ---------------- 挂载导出/附件/剪贴板 ---------------- */
try {
  window.services = require('./preload/services.js')(window)
} catch (e) {
  console.error('[cmark] services 挂载失败', e)
  bootError('services', e)
  window.services = {}
}

/* ---------------- 挂载 V1.0.0 自研面板（原封不动搬过来，不再用 React 重写） ---------------- */
// git-panel.js / settings-panel.js / rename-note.js 都是本项目自己写的独立 DOM 模块：
// 自带 CSS、自带渲染、只依赖 __znotesGit 与少量宿主钩子。
// 直接 require 安装，才能做到与 V1.0.0 像素级一致。
try {
  /** React 侧通过 window.__cmarkHost() 提供当前笔记与若干动作 */
  const host = () => (window.__cmarkHost && window.__cmarkHost()) || {}

  window.__znotesFindInstance = function () {
    const st = host()
    return { state: { workNote: st.currentRel ? { _id: 'note/' + st.currentRel } : null } }
  }
  window.__znotesFlushSave = function () {
    const st = host()
    if (st.flushSave) st.flushSave()
  }
  window.__znotesReloadNote = function (rel) {
    const st = host()
    if (!st.reloadNote) return
    // git 面板传进来的是「仓库相对路径」，通常会带一层笔记目录前缀（例如 Notes/归档/a.md）；
    // 而笔记侧一律使用「笔记目录内相对路径」（归档/a.md）。不剥掉这一层，
    // readNote 会拼出 Notes/Notes/... 而报 ENOENT，看上去就像文件被删了。
    let r = String(rel == null ? '' : rel).replace(/\\/g, '/')
    let sc = ''
    try { sc = (window.__znotesGit && window.__znotesGit.scopeRel) || '' } catch (e) {}
    if (sc) {
      if (r === sc) r = ''
      else if (r.indexOf(sc + '/') === 0) r = r.slice(sc.length + 1)
    }
    st.reloadNote(r)
  }
  window.__ZNOTES_REFRESH = function () {
    const st = host()
    if (st.refreshTree) st.refreshTree()
  }
  window.__znotesPickDir = function () {
    const st = host()
    if (st.pickDir) st.pickDir()
  }
  // 右键「在资源管理器中打开」：必须走 Electron shell，ztools 会隐藏插件窗口
  window.__znotesRevealCtx = function () {
    try {
      const { shell } = require('electron')
      if (shell && shell.openPath) {
        const r = shell.openPath(workspace)
        if (r && typeof r.catch === 'function') r.catch(function () {})
      }
    } catch (e) {}
  }

  require('./preload/git-panel.js')(window, workspace)
} catch (e) {
  console.error('[cmark] git-panel 挂载失败', e)
  bootError('git-panel', e)
}

// 每个模块单独 try：之前三个挤在一个 try 里，前面任一个抛错，设置面板就整块不挂载，
// 表现就是「点设置没反应」（uTools 里尤其容易踩到）。
try {
  require('./preload/remote-setup.js')(window)
} catch (e) {
  console.error('[cmark] remote-setup 挂载失败', e)
  bootError('remote-setup', e)
}
try {
  require('./preload/remote-wizard.js')(window)
} catch (e) {
  console.error('[cmark] remote-wizard 挂载失败', e)
  bootError('remote-wizard', e)
}
try {
  require('./preload/settings-panel.js')(window)
} catch (e) {
  console.error('[cmark] settings-panel 挂载失败', e)
  bootError('settings-panel', e)
}

try {
  require('./preload/rename-note.js')(window, window.__znotesFindInstance)
} catch (e) {
  console.error('[cmark] rename-note 挂载失败', e)
  bootError('rename-note', e)
}

/* ---------------- 控制面 ---------------- */
window.__CMARK = {

  // ================= 导出（从 V1.0.0 window.services 原样移植） =================

  /** 写笔记文件：dir 为空时弹保存框，带附件时按文件夹写 */
  _writeNoteFile(dir, name, content, attachments, ext, withKatex) {
    // 笔记标题常带冒号/星号等非法文件名字符（"10:30 会议"），必须过滤
    name = String(name || '').replace(/[\\/:*?"<>|]/g, '').trim() || String(Date.now())
    const list = Array.isArray(attachments) ? attachments : []
    let target = null

    if (list.length > 0) {
      // 带附件 = 便携目录模式：先确定目录（不是文件）
      if (!dir) {
        const r = window.ztools.showOpenDialog({
          title: '选择导出目录',
          properties: ['openDirectory', 'createDirectory'],
        })
        dir = Array.isArray(r) ? r[0] : r
        if (!dir) return { ok: false, canceled: true }
      }
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      } catch (e) {
        return { ok: false, message: '无法创建目录 ' + dir + '：' + e.message }
      }
      target = path.join(dir, name + '.' + ext)
      for (const f of list) {
        try {
          fs.copyFileSync(f, path.join(dir, path.basename(f)))
        } catch (e) {
          console.warn('[export] 附件拷贝失败', f, e.message)
        }
      }
    } else if (dir) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      } catch (e) {}
      target = path.join(dir, name + '.' + ext)
    } else {
      const dft = path.join(window.ztools.getPath('downloads') || '', name + '.' + ext)
      target = window.ztools.showSaveDialog({ defaultPath: dft, filters: [{ name: ext, extensions: [ext] }] })
      if (!target) return { ok: false, canceled: true }
    }

    try {
      fs.writeFileSync(target, content, 'utf8')
    } catch (e) {
      return { ok: false, message: '写入失败：' + e.message }
    }
    return { ok: true, path: target }
  },

  writeMarkdownFile(dir, name, content, attachments) {
    return this._writeNoteFile(dir, name, content, attachments || [], 'md', false)
  },

  writeHtmlFile(dir, name, html, attachments, withKatex, selfContained, theme) {
    let css = ''
    // 自包含快照（每个元素都内联了 computed style）不能再套 github-markdown.css，
    // 那套样式会覆盖内联结果，导出的东西又和编辑区不一样了
    if (!selfContained) {
      try {
        const cssDir = fs.existsSync(path.join(__dirname, 'export-file'))
          ? path.join(__dirname, 'export-file')
          : path.join(__dirname, 'dist', 'export-file')
        css = fs.readFileSync(path.join(cssDir, 'github-markdown.css'), 'utf-8').replace(/^\s*[\r\n]/gm, '')
      } catch (e) {}
    }
    const katexLink = withKatex ? '<link rel="stylesheet" href="./katex.min.css">' : ''
    // 导出跟随当前主题；selfContained 快照已内联深/浅色值，壳背景必须匹配，
    // 否则深色文字配白底几乎不可读
    const full = '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8"/>\n<title>' + (name || '') + '</title>\n' +
      katexLink + '\n<style>\n' + exportDocCss(theme) + '\n' + css + '\n</style>\n</head>\n<body>\n' +
      '<article class="markdown-body">\n' + String(html || '').trim() + '\n</article>\n</body>\n</html>'
    const extra = Array.isArray(attachments) ? attachments.slice() : []
    if (withKatex) {
      try {
        extra.push(path.join(__dirname, 'katex.min.css'))
      } catch (e) {}
    }
    return this._writeNoteFile(dir, name, full, extra, 'html', withKatex)
  },

  /** 用隐藏窗口渲染后截图/打印成 PDF（V1.0.0 的做法） */
  exportFile(type, html, css, cb, outDir, theme) {
    if (!window.ztools || typeof window.ztools.createBrowserWindow !== 'function') {
      cb(new Error('当前宿主没有 createBrowserWindow，无法导出 ' + type))
      return
    }
    // 必须 let 先声明：回调可能在赋值前同步触发，const 会 TDZ 抛错让 cb 永远不回调
    let win = null
    let settled = false
    const done = (err, out) => {
      if (settled) return
      settled = true
      cb(err, out)
    }
    // 看门狗：createBrowserWindow 回调不触发时不能让按钮永远转圈
    const watchdog = setTimeout(() => {
      try {
        if (win) win.destroy()
      } catch (e) {}
      done(new Error('导出超时（渲染窗口未响应）'))
    }, 60000)
    win = window.ztools.createBrowserWindow(
      'export-file/index.html',
      { width: 980, height: 600, show: false },
      async () => {
        try {
          let buf
          await new Promise((r) => setTimeout(r, 50))
          // Electron 的 insertCSS 会插到 <head> 最前面，被 export-file/index.html
          // 自带的 background:#fff 覆盖（深色导出曾经导出白底）。改成把 <style>
          // 追加到 body 末尾 + 直接内联背景，一定压得住。
          const colors = exportDocColors(theme)
          await win.webContents.executeJavaScript(
            '(() => {' +
            // export-file/index.html 会加载 github-markdown.css（浅色配色），
            // 它的 .markdown-body / td / blockquote 规则特异性比我们的高，
            // 深色导出会出现「深底 + 深字」和「白底表格」。直接禁用它，
            // 全部改用 exportDocCss 这套随主题的样式。
            '  Array.from(document.querySelectorAll("link[rel=stylesheet]")).forEach(function (l) {' +
            '    if (l.href && l.href.indexOf("github-markdown") >= 0) l.disabled = true;' +
            '  });' +
            '  const css = ' + JSON.stringify(exportDocCss(theme) + '\n' + (css || '')) + ';' +
            '  const st = document.createElement("style");' +
            '  st.id = "__cmark-export-theme";' +
            '  st.textContent = css;' +
            '  document.body.appendChild(st);' +
            '  document.documentElement.style.background = ' + JSON.stringify(colors.bg) + ';' +
            '  document.body.style.background = ' + JSON.stringify(colors.bg) + ';' +
            '  document.body.style.color = ' + JSON.stringify(colors.fg) + ';' +
            '  return "ok";' +
            '})()'
          )
          await win.webContents.executeJavaScript(
            'document.querySelector(".markdown-body").innerHTML = ' + JSON.stringify(String(html || ''))
          )
          await win.webContents.executeJavaScript('window.waitAllImageLoaded()')
          await new Promise((r) => setTimeout(r, 50))
          if (type === 'image') {
            const h = await win.webContents.executeJavaScript('document.body.scrollHeight')
            win.setContentSize(980, h + 25)
            await new Promise((r) => setTimeout(r, 50))
            buf = await win.webContents.capturePage()
            if (buf.toPNG) buf = buf.toPNG()
          } else {
            buf = await win.webContents.printToPDF({
              marginsType: 0,
              printBackground: true,
              printSelectionOnly: false,
              landscape: false,
              pageSize: 'A4',
              scaleFactor: 100,
            })
          }
          clearTimeout(watchdog)
          try {
            win.destroy()
          } catch (e2) {}
          if (!outDir) outDir = window.ztools.getPath('temp')
          const out = path.join(outDir, 'cmark_markdown_render_' + Date.now() + (type === 'image' ? '.png' : '.pdf'))
          fs.writeFileSync(out, buf)
          done(null, out)
        } catch (e) {
          clearTimeout(watchdog)
          try {
            win.destroy()
          } catch (e2) {}
          done(e)
        }
      }
    )
  },

  /** 把临时导出文件挪到用户选的位置 */
  dialogSaveExportFile(tmpPath, name, kind) {
    name = String(name || '').replace(/[/\\]/g, '').trim() || Date.now().toString()
    const ext = path.extname(tmpPath)
    const dft = path.join(window.ztools.getPath('downloads') || '', name + ext)
    const target = window.ztools.showSaveDialog({
      defaultPath: dft,
      filters: [{ name: kind || ext.replace('.', ''), extensions: [kind === 'image' ? 'png' : kind || ext.replace('.', '')] }],
    })
    if (!target) return
    const reveal = () => {
      setTimeout(() => {
        try {
          window.ztools.hideMainWindow(false)
          window.ztools.shellShowItemInFolder(target)
        } catch (e2) {}
      }, 1000)
    }
    try {
      fs.renameSync(tmpPath, target)
    } catch (e) {
      // 跨盘 rename 必失败（temp 在 C 盘、导出到 D 盘是常态），改用拷贝
      try {
        fs.copyFileSync(tmpPath, target)
        try {
          fs.unlinkSync(tmpPath)
        } catch (e2) {}
      } catch (e3) {
        window.ztools.showNotification('导出保存失败：' + e3.message)
        return
      }
    }
    reveal()
  },
  configPath: CFG_PATH,

  getConfig() {
    config = loadConfig()
    return Object.assign({}, config, {
      workspace,
      workspaceExists: fs.existsSync(workspace),
      metaDir: (window.__ZNOTES && window.__ZNOTES.metaDir) || null,
    })
  },

  /**
   * 工作区（仓库根）。
   * 语义：工作区永远是 git 仓库根，笔记可以放在它下面的任意子目录（甚至就是根）。
   * 没显式配置时回退到已探测的仓库根，再回退到当前笔记目录（兼容老数据）。
   */
  repoDir() {
    if (config && config.repoDir) return config.repoDir
    try {
      const st = window.__znotesGit && window.__znotesGit.inspect ? window.__znotesGit.inspect() : null
      if (st && st.repoRoot) return st.repoRoot
    } catch (e) {}
    return workspace
  },

  /** 修改工作区（仓库根）：只校验可写，不搬任何文件 */
  pickRepoDir() {
    let dir
    try {
      dir = window.ztools.showOpenDialog({
        title: '选择工作区目录（git 仓库根）',
        defaultPath: this.repoDir(),
        properties: ['openDirectory', 'createDirectory'],
      })
    } catch (e) {
      return { ok: false, message: '打开目录选择器失败：' + e.message }
    }
    if (!dir) return { ok: false, canceled: true }
    if (Array.isArray(dir)) dir = dir[0]
    try {
      const probe = path.join(dir, '.cmark-write-test')
      fs.writeFileSync(probe, 'ok')
      fs.unlinkSync(probe)
    } catch (e) {
      return { ok: false, message: '这个目录不可写，请换一个' }
    }
    config = saveConfig({ repoDir: dir })
    // 原来的笔记目录不在新工作区里（或没设置）→ 直接落到工作区根
    const ws = config.workspace || workspace
    let rel = ''
    try { rel = path.relative(dir, ws) } catch (e) { rel = '..' }
    if (!ws || rel.startsWith('..') || path.isAbsolute(rel)) {
      workspace = dir
      config = saveConfig({ workspace: dir, initialized: true })
    }
    return { ok: true, repoDir: dir, workspace: workspace, needReload: true }
  },

  /** 选择笔记目录：必须落在工作区（仓库根）之内，可以为根本身 */
  pickNotesDir() {
    const root = this.repoDir()
    let dir
    try {
      dir = window.ztools.showOpenDialog({
        title: '选择笔记目录（工作区内的子目录）',
        defaultPath: root || workspace,
        properties: ['openDirectory', 'createDirectory'],
      })
    } catch (e) {
      return { ok: false, message: '打开目录选择器失败：' + e.message }
    }
    if (!dir) return { ok: false, canceled: true }
    if (Array.isArray(dir)) dir = dir[0]
    let rel = ''
    try { rel = path.relative(root || dir, dir) } catch (e) { rel = '..' }
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, message: '笔记目录必须在工作区（' + (root || '未设置') + '）之内' }
    }
    try {
      const probe = path.join(dir, '.cmark-write-test')
      fs.writeFileSync(probe, 'ok')
      fs.unlinkSync(probe)
    } catch (e) {
      return { ok: false, message: '这个目录不可写，请换一个' }
    }
    workspace = dir
    config = saveConfig({ workspace: dir, initialized: true })
    return { ok: true, workspace: dir, noteRel: rel, needReload: true }
  },

  /** 更换工作区：只校验可写，不搬任何文件 */
  pickWorkspace() {
    let dir
    try {
      dir = window.ztools.showOpenDialog({
        title: '选择 Markdown 笔记目录',
        defaultPath: workspace,
        properties: ['openDirectory', 'createDirectory'],
      })
    } catch (e) {
      return { ok: false, message: '打开目录选择器失败：' + e.message }
    }
    if (!dir) return { ok: false, canceled: true }
    if (Array.isArray(dir)) dir = dir[0]
    try {
      const probe = path.join(dir, '.cmark-write-test')
      fs.writeFileSync(probe, 'ok')
      fs.unlinkSync(probe)
    } catch (e) {
      return { ok: false, message: '这个目录不可写，请换一个' }
    }
    workspace = dir
    config = saveConfig({ workspace: dir, initialized: true })
    // 换目录后需要让 ndb / git 重新绑定：最稳的做法是提示重启插件
    return { ok: true, workspace: dir, needReload: true }
  },

  /**
   * 把工作区里所有 .md 读进内存，供正文搜索使用。
   * 对应 V1.0.0 的 window.NOTES_DIC：搜索要能匹配正文，就必须先有内容。
   * 返回 [{ rel, text }]，rel 是相对工作区的路径。
   */
  loadAllNotes() {
    const out = []
    const SKIP = new Set(['.git', '.cmark', 'node_modules', '.obsidian', 'assets'])
    const walk = (dirAbs, prefix, depth) => {
      if (depth > 12 || out.length > 8000) return
      let list
      try {
        list = fs.readdirSync(dirAbs, { withFileTypes: true })
      } catch (e) {
        return
      }
      for (const ent of list) {
        const name = ent.name
        if (name.startsWith('.') || SKIP.has(name)) continue
        const abs = path.join(dirAbs, name)
        const rel = prefix ? prefix + '/' + name : name
        if (ent.isDirectory()) {
          walk(abs, rel, depth + 1)
        } else if (/\.md$/i.test(name)) {
          try {
            out.push({ rel, text: fs.readFileSync(abs, 'utf8') })
          } catch (e) {}
        }
      }
    }
    walk(workspace, '', 0)
    return out
  },

  /**
   * 在系统默认浏览器里打开笔记。
   *
   * 不能直接把 .md 的 file:// 交给 openExternal —— Electron 在 Windows 上通常
   * 转给文件关联程序（可能是编辑器而不是浏览器）。这里改成写一个临时 HTML，
   * 用 file:// 打开它，系统一定会用浏览器。
   */
  /**
   * 用系统默认程序打开真实的笔记文件（用户浏览器装了 Markdown 渲染插件）。
   * 走 shell.openExternal + file:// 而不是 shellOpenPath：后者会把插件窗口藏到后台。
   */
  /** 取 katex 样式文本：导出时公式排版全靠它，缺了上标会乱 */
  getKatexCss() {
    try {
      const dirs = [__dirname, path.join(__dirname, 'dist')]
      for (const d of dirs) {
        const f = path.join(d, 'katex.min.css')
        if (fs.existsSync(f)) return fs.readFileSync(f, 'utf-8')
      }
      return ''
    } catch (e) {
      return ''
    }
  },

  openNoteInBrowser(rel) {
    try {
      const abs = path.resolve(workspace, String(rel || ''))
      if (!fs.existsSync(abs)) return { ok: false, message: '文件不存在：' + rel }
      const url = 'file:///' + abs.replace(/\\/g, '/')
      if (window.ztools && window.ztools.shellOpenExternal) window.ztools.shellOpenExternal(url)
      else require('electron').shell.openExternal(url)
      return { ok: true, path: abs, url }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  openHtmlInBrowser(rel, html) {
    try {
      const os = require('os')
      const crypto = require('crypto')
      const safe = String(rel || 'note').replace(/[\\/:*?"<>|]/g, '_').replace(/\.md$/i, '')
      // 固定文件名 = 按 rel 生成哈希，同一篇笔记反复打开只覆盖同一个文件，
      // 不再每次留一个新时间戳文件把临时目录撑满
      const tag = crypto.createHash('md5').update(String(rel || '')).digest('hex').slice(0, 8)
      const dir = path.join(os.tmpdir(), 'cmark-preview')
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      } catch (e) {}
      const tmp = path.join(dir, `${safe}-${tag}.html`)
      fs.writeFileSync(tmp, html, 'utf8')
      const url = 'file:///' + tmp.replace(/\\/g, '/')
      require('electron').shell.openExternal(url)
      return { ok: true, path: tmp }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  /** 目录里已有多少 .md（用于接入前的预检提示） */
  countMarkdown(dir) {
    let n = 0
    let folders = 0
    const walk = (d, depth) => {
      if (depth > 8 || n > 5000) return
      let list
      try {
        list = fs.readdirSync(d, { withFileTypes: true })
      } catch (e) {
        return
      }
      for (const it of list) {
        if (it.name.startsWith('.')) continue
        if (it.isDirectory()) {
          folders++
          walk(path.join(d, it.name), depth + 1)
        } else if (/\.(md|markdown)$/i.test(it.name)) {
          n++
        }
      }
    }
    walk(dir || workspace, 0)
    return { markdown: n, folders }
  },

  rescan() {
    try {
      if (window.__ZNOTES && window.__ZNOTES.rescan) return window.__ZNOTES.rescan()
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  /** 工作区变化监听：渲染层订阅后自己决定要不要重扫 */
  onWorkspaceChange(fn) {
    try {
      if (window.__ZNOTES && window.__ZNOTES.onFsChange) window.__ZNOTES.onFsChange(fn)
    } catch (e) {}
  },

  /**
   * 在资源管理器里打开笔记目录。
   * 必须用 Electron 的 shell：ztools.shellOpenPath 会让 ZTools 隐藏主窗口，
   * 而 ztools.showMainWindow() 唤醒的是搜索框、不是插件。
   */
  shellShowWorkspace() {
    try {
      const { shell } = require('electron')
      if (shell && shell.openPath) {
        const r = shell.openPath(workspace)
        if (r && typeof r.catch === 'function') r.catch(function () {})
        return { ok: true }
      }
    } catch (e) {}
    try {
      window.ztools.shellOpenPath(workspace)
      return { ok: true }
    } catch (e) {
      return { ok: false, message: String(e && e.message) }
    }
  },

  /* ---------------- 笔记文件级读写（纯文本语义，保真） ---------------- */

  /** 相对路径 → 绝对路径，并挡住越界（..） */
  /** 向上找 .git 定位仓库根：.cmark 在仓库根下，可能比笔记目录高一级 */
  _repoRoot() {
    let cur = workspace
    for (let i = 0; i < 5; i++) {
      try {
        if (fs.existsSync(path.join(cur, '.git'))) return cur
      } catch (e) {}
      const up = path.dirname(cur)
      if (up === cur) break
      cur = up
    }
    return workspace
  },

  /** 重算文本里所有图片相对路径：旧目录 → 新目录 */
  _rewriteRelInText(txt, oldDir, newDir) {
    if (!txt || oldDir === newDir) return txt
    const root = this._repoRoot()
    const RE = /(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g
    // 代码块和行内代码里的内容只是示例，不能当成真实引用去改。
    // 按这些片段切分，只处理偶数段（普通正文）。
    const segs = String(txt).split(
      /(```[\s\S]*?```|~~~[\s\S]*?~~~|\$\$[\s\S]*?\$\$|`+[^`]*`+)/g,
    )
    return segs
      .map((seg, idx) => (idx % 2 === 1 ? seg : this._rewriteSeg(seg, oldDir, newDir, root, RE)))
      .join('')
  },

  /** 单段普通文本内的路径重算（被 _rewriteRelInText 和外部复用） */
  _rewriteSeg(seg, oldDir, newDir, root, RE) {
    return String(seg).replace(RE, (whole, pre, url, post) => {
      if (/^(https?:|data:|file:|attachment:|#|mailto:)/i.test(url)) return whole
      let abs
      try {
        abs = path.resolve(oldDir, url)
      } catch (e) {
        return whole
      }
      if (abs !== root && !abs.startsWith(root + path.sep)) return whole
      try {
        if (!fs.existsSync(abs)) return whole
      } catch (e) {
        return whole
      }
      let rel = path.relative(newDir, abs).split(path.sep).join('/')
      if (rel && !rel.startsWith('.')) rel = './' + rel
      return pre + rel + post
    })
  },

  /** 单个 md 移动后重写它自己的图片路径 */
  _rewriteImagePaths(absOld, absNew) {
    try {
      if (absOld === absNew) return
      const oldDir = path.dirname(absOld)
      const newDir = path.dirname(absNew)
      if (oldDir === newDir) return
      let txt
      try {
        txt = fs.readFileSync(absNew, 'utf8')
      } catch (e) {
        return
      }
      const next = this._rewriteRelInText(txt, oldDir, newDir)
      if (next !== txt) {
        // 原子写：先写临时文件再 rename。直接覆盖的话，移动一批笔记时
        // 中途崩溃会留下截断的正文，而且没有任何回滚手段。
        const tmp = absNew + '.tmp-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8)
        fs.writeFileSync(tmp, next, 'utf8')
        fs.renameSync(tmp, absNew)
      }
    } catch (e) {}
  },

  /** 目录整体移动：逐个 md 重写 */
  _rewriteDirImagePaths(oldDirAbs, newDirAbs) {
    const walk = (dirNew, dirOld) => {
      let list = []
      try {
        list = fs.readdirSync(dirNew, { withFileTypes: true })
      } catch (e) {
        return
      }
      for (const ent of list) {
        const nAbs = path.join(dirNew, ent.name)
        const oAbs = path.join(dirOld, ent.name)
        if (ent.isDirectory()) {
          walk(nAbs, oAbs)
          continue
        }
        if (!/\.(md|markdown)$/i.test(ent.name)) continue
        this._rewriteImagePaths(oAbs, nAbs)
      }
    }
    walk(newDirAbs, oldDirAbs)
  },

  absOf(rel) {
    const abs = path.resolve(workspace, rel)
    if (abs !== workspace && !abs.startsWith(workspace + path.sep)) {
      throw new Error('路径越界：' + rel)
    }
    return abs
  },

  readNote(rel) {
    try {
      return fs.readFileSync(this.absOf(rel), 'utf8')
    } catch (e) {
      return ''
    }
  },

  /**
   * 带状态的读取：读失败必须能被上层区分出来。
   * 旧 readNote 把任何异常都变成空串，界面会把「读失败」当成「空笔记」，
   * 用户一敲字就把整篇原正文覆盖掉——这是最危险的一条路径。
   */
  readNoteEx(rel) {
    try {
      const abs = this.absOf(rel)
      const st = fs.statSync(abs)
      const text = fs.readFileSync(abs, 'utf8')
      return { ok: true, text, mtime: st.mtimeMs, size: st.size }
    } catch (e) {
      return { ok: false, message: e && e.message ? e.message : String(e), code: e && e.code }
    }
  },

  /** 取文件当前 mtime/size，用来判断磁盘内容是否被外部改过 */
  statNote(rel) {
    try {
      const st = fs.statSync(this.absOf(rel))
      return { ok: true, mtime: st.mtimeMs, size: st.size }
    } catch (e) {
      return { ok: false, code: e && e.code }
    }
  },

  /** 原子写：临时文件 + rename，避免半截文件被 git 提交 */
  writeNote(rel, text) {
    const abs = this.absOf(rel)
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      const tmp = abs + '.tmp-' + process.pid + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
      // 落盘前最后确认一次目标还在：exists() 与 write 之间可能被外部删除
      // （只对已存在的文件做，新建笔记走 createNote 不经过这里）
      if (fs.existsSync(abs) && !fs.statSync(abs).isFile()) {
        throw new Error('目标不是普通文件')
      }
      fs.writeFileSync(tmp, text, 'utf8')
      // Windows 上目标文件可能被杀毒/索引器短暂占用，rename 会抛 EPERM/EBUSY，重试几次
      let lastErr = null
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          fs.renameSync(tmp, abs)
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          const busy = e && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES')
          if (!busy) break
          const until = Date.now() + 40 * (attempt + 1)
          while (Date.now() < until) { /* 短自旋，避免引入异步把保存变复杂 */ }
        }
      }
      if (lastErr) {
        try { fs.unlinkSync(tmp) } catch (e) {}
        throw lastErr
      }
      if (window.__ZNOTES && window.__ZNOTES.rescan) window.__ZNOTES.rescan()
      return { ok: true, mtime: fs.statSync(abs).mtimeMs }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  createNote(dirRel, name, text) {
    let base = String(name || '未命名').replace(/[\\/:*?"<>|]/g, '').trim() || '未命名'
    // 点开头会被目录树扫描跳过，文件建出来却永远看不见，用户会重复创建
    if (base.startsWith('.')) base = base.replace(/^\.+/, '') || '未命名'
    // Windows 保留名与结尾点/空格
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = '_' + base
    base = base.replace(/[. ]+$/, '') || '未命名'
    const dir = dirRel ? this.absOf(dirRel) : workspace
    let rel = path.join(dirRel || '', base + '.md').replace(/\\/g, '/')
    let abs = this.absOf(rel)
    let i = 2
    while (fs.existsSync(abs)) {
      rel = path.join(dirRel || '', base + ' ' + i + '.md').replace(/\\/g, '/')
      abs = this.absOf(rel)
      i++
    }
    try {
      fs.mkdirSync(dir, { recursive: true })
      // 新建笔记必须是完全空白的文件，不预填标题（文件名已经表达了标题）
      fs.writeFileSync(abs, text == null ? '' : text, 'utf8')
      if (window.__ZNOTES && window.__ZNOTES.rescan) window.__ZNOTES.rescan()
      return { ok: true, rel }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  createFolder(dirRel, name) {
    const base = String(name || '新建文件夹').replace(/[\\/:*?"<>|]/g, '').trim() || '新建文件夹'
    let rel = path.join(dirRel || '', base).replace(/\\/g, '/')
    let abs = this.absOf(rel)
    let i = 2
    while (fs.existsSync(abs)) {
      rel = path.join(dirRel || '', base + ' ' + i).replace(/\\/g, '/')
      abs = this.absOf(rel)
      i++
    }
    try {
      fs.mkdirSync(abs, { recursive: true })
      if (window.__ZNOTES && window.__ZNOTES.rescan) window.__ZNOTES.rescan()
      return { ok: true, rel }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  /** 改名：只换最后一段，扩展名由调用方决定（笔记保留 .md） */
  renameNode(rel, newName) {
    const clean = String(newName || '').replace(/[\\/:*?"<>|]/g, '').trim()
    if (!clean) return { ok: false, message: '名称不能为空' }
    const isNote = /\.(md|markdown)$/i.test(rel)
    const tail = isNote ? (/\.(md|markdown)$/i.exec(rel) || ['.md'])[0] : ''
    const dirRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    const targetRel = path.join(dirRel, clean + tail).replace(/\\/g, '/')
    if (targetRel === rel) return { ok: true, rel }
    try {
      const from = this.absOf(rel)
      const to = this.absOf(targetRel)
      if (fs.existsSync(to)) return { ok: false, message: '同名已存在' }
      fs.renameSync(from, to)
      if (window.__ZNOTES && window.__ZNOTES.rescan) window.__ZNOTES.rescan()
      return { ok: true, rel: targetRel }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  /** 删除：直接从磁盘移除（不做回收站，误删靠 git 历史恢复） */
  deleteNode(rel) {
    try {
      const abs = this.absOf(rel)
      if (!fs.existsSync(abs)) return { ok: true }
      fs.rmSync(abs, { recursive: true, force: true })
      if (window.__ZNOTES && window.__ZNOTES.rescan) window.__ZNOTES.rescan()
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  /** 目录里还有几篇笔记（删目录前的拦截） */
  countInDir(rel) {
    try {
      const abs = rel ? this.absOf(rel) : workspace
      let n = 0
      const walk = (d, depth) => {
        if (depth > 20) return
        let list
        try {
          list = fs.readdirSync(d, { withFileTypes: true })
        } catch (e) {
          return
        }
        for (const it of list) {
          if (it.name.startsWith('.')) continue
          if (it.isDirectory()) walk(path.join(d, it.name), depth + 1)
          else if (/\.(md|markdown)$/i.test(it.name)) n++
        }
      }
      walk(abs, 0)
      return n
    } catch (e) {
      return 0
    }
  },

  /** 拖拽移动：把 rel 移到 targetDirRel 下 */
  moveNode(rel, targetDirRel) {
    const base = rel.split('/').pop()
    let targetRel = path.join(targetDirRel || '', base).replace(/\\/g, '/')
    if (targetRel === rel) return { ok: true, rel }
    // 不能把目录移进自己里面
    if (targetDirRel && (targetDirRel === rel || targetDirRel.startsWith(rel + '/'))) {
      return { ok: false, message: '不能移动到自身内部' }
    }
    try {
      const from = this.absOf(rel)
      let to = this.absOf(targetRel)
      if (fs.existsSync(to)) {
        const ext = /\.(md|markdown)$/i.test(base) ? /\.(md|markdown)$/i.exec(base)[0] : ''
        const stem = ext ? base.slice(0, -ext.length) : base
        let i = 2
        while (fs.existsSync(to)) {
          targetRel = path.join(targetDirRel || '', stem + ' ' + i + ext).replace(/\\/g, '/')
          to = this.absOf(targetRel)
          i++
        }
      }
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.renameSync(from, to)
      // 位置变了，笔记正文里的图片相对路径必须同步重算，否则图全断
      try {
        if (fs.statSync(to).isDirectory()) this._rewriteDirImagePaths(from, to)
        else if (/\.(md|markdown)$/i.test(to)) this._rewriteImagePaths(from, to)
      } catch (e) {}
      if (window.__ZNOTES && window.__ZNOTES.rescan) window.__ZNOTES.rescan()
      return { ok: true, rel: targetRel }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  /**
   * 扫描工作区，返回目录树。
   * 节点：{ id, name, type: 'folder'|'note', rel, children? }
   * 排序：目录在前、笔记在后，各自按名字（中文用 localeCompare）
   */
  /**
   * 把一张图片存进工作区的 assets/ 目录，返回相对路径。
   * 用相对路径而不是 ndb 内部的 attachment:<digest>，是为了让文件在
   * Obsidian / VS Code 等其它编辑器里也能直接显示。
   */
  saveImageToWorkspace(srcPath, base64, noteRel) {
    try {
      let buf = null
      let ext = '.png'
      if (base64) {
        const m = /^data:image\/([a-z.+-]+);base64,/i.exec(base64)
        if (!m) return { ok: false, message: '不是图片数据' }
        // svg+xml 这类复合类型要归一化，否则 CT 表查不到、落盘成 .bin
        const sub = m[1].toLowerCase()
        ext = '.' + (sub === 'jpeg' ? 'jpg' : sub === 'svg+xml' ? 'svg' : sub)
        buf = Buffer.from(base64.slice(m[0].length), 'base64')
      } else if (srcPath) {
        if (!fs.existsSync(srcPath)) return { ok: false, message: '图片文件不存在' }
        ext = (path.extname(srcPath) || '.png').toLowerCase()
        if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) {
          return { ok: false, message: '不支持的图片格式' }
        }
        buf = fs.readFileSync(srcPath)
      } else {
        return { ok: false, message: '没有图片数据' }
      }
      if (buf.length > 20 * 1024 * 1024) return { ok: false, message: '图片大小超过 20 M' }

      const crypto = require('crypto')
      const digest = crypto.createHash('md5').update(buf).digest('hex')
      const CT = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
      }
      const EXT = {
        'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
        'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
      }
      const ct = CT[ext.replace('.', '')] || 'application/octet-stream'
      const fileExt = EXT[ct] || 'bin'

      const ndb = window.__NDB
      if (!ndb || typeof ndb.postAttachment !== 'function') {
        return { ok: false, message: '附件存储不可用' }
      }
      const r = ndb.postAttachment('attachment/' + digest, buf, ct)
      if (!r || r.error || !r.ok) return { ok: false, message: (r && r.message) || '附件保存失败' }

      // 补一条元数据：getAttachmentTempPath 靠 content_type 推扩展名，
      // 不写的话临时缓存文件会是裸 digest，没有后缀
      try {
        ndb.put({ _id: 'attachment/' + digest, _attachments: [{ digest: digest, content_type: ct }] })
      } catch (e) {}

      // markdown 里写「相对当前笔记」的路径：其他 markdown 工具按 md 所在目录解析，
      // 只有这种写法才能跨工具显示。attachment: 是私有协议，只有本程序认识。
      const root = this._repoRoot()
      const attachAbs = path.join(root, '.cmark', 'attachments', digest + '.' + fileExt)
      // noteRel 为空时按工作区根目录算，不能落到父目录（那样会算出 ./Notes/... 这种错路径）
      const noteAbs = noteRel ? path.join(workspace, noteRel) : path.join(workspace, '__root__.md')
      let rel = path.relative(path.dirname(noteAbs), attachAbs).split(path.sep).join('/')
      if (rel && !rel.startsWith('.')) rel = './' + rel

      return { ok: true, rel: rel, digest: digest }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  /**
   * 扫描未被任何笔记引用的附件
   *
   * 删图片、换图片、删整篇笔记都不会动 .cmark/attachments 里的文件，
   * 这里把「磁盘上有、但没有任何 md 引用」的挑出来，只统计不删除。
   */
  scanAttachments() {
    try {
      const root = this._repoRoot()
      const attachDir = path.join(root, '.cmark', 'attachments')
      if (!fs.existsSync(attachDir)) {
        return { ok: true, total: 0, usedCount: 0, unused: [], unusedBytes: 0 }
      }

      const used = new Set()
      const MD = /\.(md|markdown)$/i
      const RE_ATTACH = /attachment:([a-f0-9]{16,64})/gi
      const RE_PATH = /attachments\/([a-f0-9]{16,64})\.[a-z0-9]+/gi

      const walk = (dir) => {
        let list = []
        try {
          list = fs.readdirSync(dir, { withFileTypes: true })
        } catch (e) {
          return
        }
        for (const ent of list) {
          if (ent.name.startsWith('.')) continue
          if (ent.name === 'node_modules') continue
          const abs = path.join(dir, ent.name)
          if (ent.isDirectory()) {
            walk(abs)
            continue
          }
          if (!MD.test(ent.name)) continue
          let txt = ''
          try {
            txt = fs.readFileSync(abs, 'utf8')
          } catch (e2) {
            // 有一篇读不出来就无法判断引用关系，宁可整次扫描失败，也不能误判成"无引用"
            throw new Error('无法读取 ' + abs + '：' + e2.message)
          }
          let m
          RE_ATTACH.lastIndex = 0
          while ((m = RE_ATTACH.exec(txt))) used.add(m[1].toLowerCase())
          RE_PATH.lastIndex = 0
          while ((m = RE_PATH.exec(txt))) used.add(m[1].toLowerCase())
        }
      }
      // 必须从仓库根扫：附件存放在 <仓库根>/.cmark/attachments，
      // 而工作目录常常只是仓库的子目录（如 Notes/）。只扫 workspace 会漏掉
      // 仓库里其它位置的引用，把还在用的附件当成垃圾移走。
      walk(this._repoRoot())

      let files = []
      try {
        files = fs.readdirSync(attachDir)
      } catch (e) {
        return { ok: false, message: e.message }
      }

      const unused = []
      let unusedBytes = 0
      let allBytes = 0
      for (const f of files) {
        const abs = path.join(attachDir, f)
        let stt
        try {
          stt = fs.statSync(abs)
        } catch (e) {
          continue
        }
        if (!stt.isFile()) continue
        allBytes += stt.size
        const digest = f.replace(/\.[^.]+$/, '').toLowerCase()
        if (!used.has(digest)) {
          unusedBytes += stt.size
          unused.push({ file: f, size: stt.size })
        }
      }

      return {
        ok: true,
        total: files.length,
        usedCount: files.length - unused.length,
        unused: unused,
        unusedBytes: unusedBytes,
        allBytes: allBytes,
      }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  /** 清理未引用附件：直接删除。附件也在 git 里，删错了可从历史取回 */
  cleanAttachments() {
    try {
      const scan = this.scanAttachments()
      if (!scan.ok) return scan
      if (!scan.unused.length) return { ok: true, deleted: 0, moved: 0, bytes: 0 }

      const root = this._repoRoot()
      const attachDir = path.join(root, '.cmark', 'attachments')

      let deleted = 0
      let bytes = 0
      for (const it of scan.unused) {
        try {
          fs.unlinkSync(path.join(attachDir, it.file))
          deleted++
          bytes += it.size
        } catch (e) {}
      }
      // deleted 是新字段名，moved 留着兼容旧调用方
      return { ok: true, deleted: deleted, moved: deleted, bytes: bytes }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  /** 选一个导出目录：Electron 渲染进程禁用 window.prompt，必须走宿主对话框 */
  pickExportDir() {
    try {
      const r = window.ztools.showOpenDialog({
        title: '选择导出目录',
        properties: ['openDirectory', 'createDirectory'],
      })
      const dir = Array.isArray(r) ? r[0] : r
      if (!dir) return { ok: false, canceled: true }
      return { ok: true, dir }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  /** 选一张图片（走宿主对话框，不会把插件窗口挤到后台） */
  pickImageFile() {
    try {
      const r = window.ztools.showOpenDialog({
        title: '选择图片',
        properties: ['openFile'],
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
        ],
      })
      const f = Array.isArray(r) ? r[0] : r
      if (!f) return { ok: false, canceled: true }
      return { ok: true, path: f }
    } catch (e) {
      return { ok: false, message: '打开文件选择器失败：' + e.message }
    }
  },

  /**
   * 保存目录树顺序到 .cmark/order.txt
   *
   * order.txt 的约定（沙盒里实测的真实库格式）：
   *   目录项写裸名（IWAN、SDIWAN）
   *   笔记项写 note/<相对仓库根的路径>
   * 而 listTree 给出的 id 是纯相对路径，所以这里先做一次 id 转换再交给 ndb。
   */
  saveOrder(tree) {
    try {
      const conv = (list) =>
        (list || []).map((n) => ({
          id: n.type === 'note' ? 'note/' + n.rel : n.rel,
          name: n.name,
          children: n.children && n.children.length ? conv(n.children) : undefined,
        }))
      const z = window.__ZNOTES
      if (!z || typeof z.saveTreeOrder !== 'function') return { ok: false, message: '排序接口不可用' }
      const r = z.saveTreeOrder(conv(tree))
      // 底层返回 false 时不能假装成功，否则用户以为排好了其实没写盘
      if (r === false || (r && r.ok === false)) return { ok: false, message: (r && r.message) || '排序保存失败' }
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  /**
   * 仓库根下的 .cmark 目录。
   * workspace 可能只是仓库的一个子目录（比如仓库是 D:\CMark、笔记在 D:\CMark\Notes），
   * 元数据必须跟 ndb.js 的 REPO_META 指向同一个位置，否则会凭空在笔记目录里造一个 .cmark。
   */
  repoMetaDir() {
    let cur = workspace
    for (let d = 0; d < 5 && cur && cur !== path.dirname(cur); d++) {
      try {
        if (fs.existsSync(path.join(cur, '.git'))) return path.join(cur, '.cmark')
      } catch (e) {}
      cur = path.dirname(cur)
    }
    return path.join(workspace, '.cmark')
  },

  /** 判断工作区里某个相对路径还在不在（用来挡住"给已删除的笔记补写"） */
  exists(rel) {
    try {
      return fs.existsSync(this.absOf(rel))
    } catch (e) {
      return false
    }
  },

  /** 在系统资源管理器里定位某个文件/文件夹 */
  /** 在资源管理器中定位某个笔记/文件夹（同样走 Electron shell，不走 ztools） */
  shellShowItem(rel) {
    try {
      const abs = rel ? this.absOf(rel) : workspace
      const { shell } = require('electron')
      if (!fs.existsSync(abs)) {
        // 路径不在了就退回目录，至少给个可用的落点
        if (shell && shell.openPath) shell.openPath(workspace)
        return { ok: false, message: '路径不存在' }
      }
      try {
        const st = fs.statSync(abs)
        if (st.isDirectory()) {
          if (shell && shell.openPath) shell.openPath(abs)
        } else if (shell && shell.showItemInFolder) {
          shell.showItemInFolder(abs)
        } else if (shell && shell.openPath) {
          shell.openPath(require('path').dirname(abs))
        }
      } catch (e) {}
      return { ok: true }
    } catch (e) {
      return { ok: false, message: String(e && e.message) }
    }
  },

  /** 复制一份（同目录，名字加 -副本 后缀，重名自动编号） */
  duplicateNode(rel) {
    try {
      const abs = this.absOf(rel)
      if (!fs.existsSync(abs)) return { ok: false, message: '文件不存在' }
      const dir = path.dirname(abs)
      const ext = path.extname(abs)
      const base = path.basename(abs, ext)
      let name = base + '-副本'
      let i = 2
      while (fs.existsSync(path.join(dir, name + ext))) {
        name = base + '-副本 ' + i
        i++
      }
      const target = path.join(dir, name + ext)
      if (fs.statSync(abs).isDirectory()) {
        fs.cpSync(abs, target, { recursive: true })
      } else {
        fs.copyFileSync(abs, target)
      }
      // 注：大目录用 cpSync 会阻塞 preload 线程，但这里是用户主动操作且通常是单篇笔记，
      // 真碰到大目录再改成异步队列
      const relTarget = path.relative(workspace, target).replace(/\\/g, '/')
      if (window.__ZNOTES && window.__ZNOTES.rescan) window.__ZNOTES.rescan()
      return { ok: true, rel: relTarget }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  },

  /** 全局搜索：遍历工作区里所有 Markdown，返回命中笔记与片段 */
  searchNotes(query, limit) {
    const q = String(query || '').trim()
    if (!q) return { ok: true, data: [] }
    const lim = Math.max(1, Math.min(200, parseInt(limit, 10) || 60))
    const lower = q.toLowerCase()
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(esc, 'gi')
    const out = []
    const walk = (dir) => {
      if (out.length >= lim) return
      let entries = []
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch (e) {
        return
      }
      for (const e of entries) {
        if (out.length >= lim) return
        if (e.name.startsWith('.')) continue
        const abs = path.join(dir, e.name)
        if (e.isDirectory()) {
          walk(abs)
          continue
        }
        if (!/\.(md|markdown)$/i.test(e.name)) continue
        let text = ''
        try {
          text = fs.readFileSync(abs, 'utf8')
        } catch (e) {
          continue
        }
        const low = text.toLowerCase()
        if (low.indexOf(lower) < 0) continue
        const idx = low.indexOf(lower)
        const start = Math.max(0, idx - 40)
        const snippet = text
          .slice(start, Math.min(text.length, idx + lower.length + 90))
          .replace(/\r?\n/g, ' ')
          .trim()
        const count = (low.match(re) || []).length
        out.push({
          rel: path.relative(workspace, abs).replace(/\\/g, '/'),
          name: e.name.replace(/\.(md|markdown)$/i, ''),
          snippet,
          count,
        })
      }
    }
    try {
      walk(workspace)
    } catch (e) {
      return { ok: false, message: e.message }
    }
    out.sort((a, b) => b.count - a.count)
    return { ok: true, data: out }
  },

  /** 用系统默认浏览器打开外链（编辑器里的 <a> 走这里） */
  openExternal(url) {
    try {
      const u = String(url || '')
      if (!/^https?:\/\//i.test(u)) return
      if (window.ztools && window.ztools.shellOpenExternal) window.ztools.shellOpenExternal(u)
      else require('electron').shell.openExternal(u)
    } catch (e) {}
  },

  /** 工作区内的相对路径图片 → file:// 绝对地址，供 <img src> 使用 */
  /** 把仓库内的图片读成 data URI，导出时内嵌，避免导出文件依赖本机绝对路径 */
  readFileAsDataUri(srcPath) {
    try {
      const raw = decodeURIComponent(String(srcPath || '').replace(/^file:\/\/(\/)?/, ''))
      if (!raw) return null
      // 必须 path.resolve 规范化：调用方给的可能是 D:/x/y（正斜杠），
      // 而 _repoRoot() 返回的是 D:\\x\\y，直接 startsWith 会必然失败
      const abs = path.resolve(raw)
      const root = this._repoRoot() ? path.resolve(this._repoRoot()) : ''
      if (root && !abs.toLowerCase().startsWith(root.toLowerCase())) return null
      if (!fs.existsSync(abs)) return null
      const st = fs.statSync(abs)
      if (!st.isFile() || st.size > 8 * 1024 * 1024) return null
      const ext = path.extname(abs).toLowerCase().replace('.', '')
      const mime =
        {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          webp: 'image/webp',
          svg: 'image/svg+xml',
          bmp: 'image/bmp',
        }[ext] || 'application/octet-stream'
      return 'data:' + mime + ';base64,' + fs.readFileSync(abs).toString('base64')
    } catch (e) {
      return null
    }
  },

  resolveImageUrl(src, noteRel) {
    try {
      const raw = String(src || '')
      if (!raw) return ''
      if (/^(https?:|data:|file:)/i.test(raw)) return raw

      // 老数据：V1.0.0 用私有协议存，继续兼容读取
      if (raw.startsWith('attachment:')) {
        const digest = raw.slice('attachment:'.length)
        // digest 必须是纯 hex。不校验的话 `attachment:../../../../Users/x/secret.png`
        // 会被 getAttachmentTempPath 拼进 path.join 读出任意本地文件
        if (!/^[a-f0-9]{16,64}$/i.test(digest)) return ''
        const s = window.services
        const p = s && s.getAttachmentTempPath ? s.getAttachmentTempPath(digest) : null
        return p ? 'file:///' + p.replace(/\\/g, '/') : ''
      }

      // 相对路径要多基线探测：笔记里有三种并存写法
      //   a) 相对笔记  ../.cmark/attachments/x.png
      //   b) 相对工作区 assets/x.png
      //   c) 相对仓库根  .cmark/attachments/x.png
      // 只按笔记目录解析会让 b/c 两种一律失败并静默返回空串。
      // 不能用 absOf —— 它把路径限制在笔记目录内，而 .cmark 在上一级的仓库根。
      const root = this._repoRoot()
      const noteDir = path.dirname(noteRel ? path.join(workspace, noteRel) : path.join(workspace, '__root__.md'))
      // 多基线依次探测。笔记里三种写法并存，只按笔记目录解析会让另外两种静默失败：
      //   a) 相对笔记    ../.cmark/attachments/x.png
      //   b) 相对工作区  assets/x.png
      //   c) 相对仓库根  .cmark/attachments/x.png
      const bases = [noteDir, workspace, root, path.join(workspace, 'assets'), path.join(root || workspace, '.cmark', 'attachments')]
      for (const b of bases) {
        if (!b) continue
        const abs = path.resolve(b, raw)
        if (root && abs !== root && !abs.startsWith(root + path.sep)) continue
        if (fs.existsSync(abs)) return 'file:///' + abs.replace(/\\/g, '/')
      }
      return ''
    } catch (e) {
      return ''
    }
  },

  listTree() {
    const MAX_FILES = 20000
    let files = 0
    let truncated = false

    const build = (dirAbs, dirRel, depth) => {
      if (depth > 24 || truncated) return []
      let list
      try {
        list = fs.readdirSync(dirAbs, { withFileTypes: true })
      } catch (e) {
        return []
      }
      const folders = []
      const notes = []
      for (const it of list) {
        if (it.name.startsWith('.')) continue
        // 图片附件目录，图片通过 assets/xxx.png 直接引用，不作为笔记目录展示
        if (it.name === 'assets') continue
        const rel = dirRel ? dirRel + '/' + it.name : it.name
        if (it.isDirectory()) {
          folders.push({
            id: rel,
            name: it.name,
            type: 'folder',
            rel,
            children: build(path.join(dirAbs, it.name), rel, depth + 1),
          })
        } else if (/\.(md|markdown)$/i.test(it.name)) {
          if (++files > MAX_FILES) {
            truncated = true
            break
          }
          let mtime = 0
          try {
            mtime = fs.statSync(path.join(dirAbs, it.name)).mtimeMs
          } catch (e) {}
          notes.push({
            id: rel,
            name: it.name.replace(/\.(md|markdown)$/i, ''),
            type: 'note',
            rel,
            mtime,
          })
        }
      }
      folders.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
      notes.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
      // 再按 .cmark/order.txt 里记的先后排一遍：拖拽排序的结果靠它生效，
      // 没记录过的条目保持字典序并排在后面
      const order = {}
      try {
        const z = window.__ZNOTES
        const o = z && z.readTreeOrder ? z.readTreeOrder() : {}
        Object.assign(order, o || {})
      } catch (e) {}
      const list2 = order[dirRel] || []
      const idx = new Map()
      list2.forEach((id, i) => idx.set(String(id), i))
      const keyOf = (n) => (n.type === 'note' ? 'note/' + n.rel : n.name)
      const byOrder = (a, b) => {
        const ia = idx.has(keyOf(a)) ? idx.get(keyOf(a)) : 1e9
        const ib = idx.has(keyOf(b)) ? idx.get(keyOf(b)) : 1e9
        return ia === ib ? 0 : ia - ib
      }
      return folders.sort(byOrder).concat(notes.sort(byOrder))
    }

    const children = build(workspace, '', 0)
    return { workspace, children, truncated, count: files }
  },
}

// 让渲染层尽早知道工作区在哪（避免首帧空白）
try {
  const z = window.ztools
  if (z && z.setExpendHeight) z.setExpendHeight(600)
} catch (e) {}

/* ==================================================================
 * ZTools 工具接口（对应 plugin.json 里的 tools 段）
 * AI 侧通过这些工具读写笔记、把 Markdown 渲染成图片/PDF
 * ================================================================== */
// MCP 工具注册（ZTools 专有）。
// plugin.json 里的 tools 声明已移除：插件本身不需要 MCP —— 其他 AI 直接读写磁盘上的 .md 即可。
// 代码保留，若将来要恢复 MCP，把 tools 声明加回 plugin.json 就能生效；
// uTools 没有 registerTool，这里的 return 会让它在 uTools 下自动跳过。
;(function registerTools() {
  const z = window.ztools
  if (!z || typeof z.registerTool !== 'function') return

  const bridge = window.__CMARK
  const nameOf = (rel) => String(rel).split('/').pop().replace(/\.(md|markdown)$/i, '')

  /** 精简 Markdown → HTML（preload 里没有 marked，够 AI 内容落地即可） */
  function miniMarkdownToHtml(md) {
    const esc = (t) =>
      String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const blocks = []
    let text = String(md || '').replace(/\r\n/g, '\n')

    // 先把代码块挖出来，避免里面的符号被当行内格式
    text = text.replace(/```([a-zA-Z0-9+#-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
      blocks.push('<pre style="background:#f6f8fa;padding:12px;border-radius:4px;overflow:auto"><code>' + esc(code) + '</code></pre>')
      return '\u0000B' + (blocks.length - 1) + '\u0000'
    })

    const lines = text.split('\n')
    const out = []
    let inList = null
    const closeList = () => {
      if (inList) {
        out.push('</' + inList + '>')
        inList = null
      }
    }

    for (const raw of lines) {
      const line = raw
      const ph = /^\u0000B(\d+)\u0000$/.exec(line.trim())
      if (ph) {
        closeList()
        out.push(blocks[Number(ph[1])])
        continue
      }
      if (!line.trim()) {
        closeList()
        continue
      }
      const h = /^(#{1,6})\s+(.*)$/.exec(line)
      if (h) {
        closeList()
        out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>')
        continue
      }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        closeList()
        out.push('<hr/>')
        continue
      }
      const li = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line)
      if (li) {
        const tag = /\d/.test(li[1]) ? 'ol' : 'ul'
        if (inList !== tag) {
          closeList()
          out.push('<' + tag + '>')
          inList = tag
        }
        out.push('<li>' + inline(li[2]) + '</li>')
        continue
      }
      if (/^\s*>\s?/.test(line)) {
        closeList()
        out.push('<blockquote>' + inline(line.replace(/^\s*>\s?/, '')) + '</blockquote>')
        continue
      }
      if (/^\s*\|.*\|\s*$/.test(line)) {
        closeList()
        const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
        if (/^[\s:|-]+$/.test(cells.join('|'))) {
          // 分隔行：把上一层刚输出的 tr 里的 td 换成 th，保证首行是表头
          const last = out.length - 1
          if (last >= 0 && out[last].startsWith('<tr>')) {
            out[last] = out[last].replace(/<td /g, '<th ').replace(/<\/td>/g, '</th>')
          }
          continue
        }
        out.push('<tr>' + cells.map((c) => '<td style="border:1px solid #dfe2e5;padding:4px 8px">' + inline(c) + '</td>').join('') + '</tr>')
        continue
      }
      closeList()
      out.push('<p>' + inline(line) + '</p>')
    }
    closeList()

    function inline(t) {
      let v = esc(t)
      v = v.replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px">$1</code>')
      v = v.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      v = v.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      v = v.replace(/~~([^~]+)~~/g, '<del>$1</del>')
      v = v.replace(/==([^=]+)==/g, '<mark>$1</mark>')
      v = v.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      return v
    }

    // 连续 <tr> 包一层 table
    let html = out.join('\n')
    html = html.replace(/(<tr>[\s\S]*?<\/tr>)+/g, (m) => '<table style="border-collapse:collapse;margin:8px 0">' + m + '</table>')
    return html
  }

  /** 把 Markdown 渲染成图片/PDF，返回文件路径 */
  function renderToFile(markdown, format) {
    return new Promise((resolve) => {
      const S = window.services
      if (!S || typeof S.exportFile !== 'function') {
        resolve({ ok: false, message: '当前环境不支持渲染导出' })
        return
      }
      // preload 环境拿不到 marked（渲染层才有），这里用一个够用的精简转换：
      // 标题 / 粗斜体 / 行内代码 / 代码块 / 列表 / 引用 / 分割线 / 表格 / 链接。
      // 精确渲染仍以前端导出为准，这条路径主要服务 AI 生成内容的落地。
      const html = miniMarkdownToHtml(markdown)
      S.exportFile(
        format === 'pdf' ? 'pdf' : 'image',
        html,
        '',
        (err, filePath) => {
          if (err) resolve({ ok: false, message: err.message })
          else resolve({ ok: true, filePath })
        }
      )
    })
  }

  z.registerTool('markdown_notes_search', async (args) => {
    const query = String(args && args.query ? args.query : '').trim()
    const limit = Math.max(1, Math.min(50, Number(args && args.limit) || 10))
    if (!query) return { notes: [], total: 0, hasMore: false }
    const r = bridge.searchNotes(query, limit)
    const list = (r && r.ok && r.data) || []
    const notes = list.map((h) => ({
      id: h.rel,
      title: h.name,
      snippet: h.snippet,
      matchedField: 'content',
      wordCount: String(h.snippet || '').length,
    }))
    return { notes, total: notes.length, hasMore: list.length >= limit }
  })

  z.registerTool('markdown_notes_get', async (args) => {
    const id = String(args && args.id ? args.id : '')
    const format = (args && args.format) || 'text'
    if (!id) return { id: '', title: '', message: '缺少 id' }
    const content = bridge.readNote(id)
    const title = nameOf(id)
    const st = bridge.statNote ? bridge.statNote(id) : null
    const mtime = st && st.ok && st.mtime ? Math.round(st.mtime) : Date.now()
    if (format === 'text') {
      return { id, title, content, mimeType: 'text/markdown', updateAt: mtime }
    }
    const r = await renderToFile(content, format)
    if (!r.ok) return { id, title, message: r.message }
    return {
      id,
      title,
      filePath: r.filePath,
      mimeType: format === 'pdf' ? 'application/pdf' : 'image/png',
      updateAt: mtime,
    }
  })

  z.registerTool('markdown_notes_create', async (args) => {
    const title = String((args && args.title) || '未命名').slice(0, 50)
    const content = String((args && args.content) || '')
    const r = bridge.createNote('', title, content)
    return { success: !!(r && r.ok), message: r && r.ok ? '已创建笔记：' + title : (r && r.message) || '创建失败' }
  })

  z.registerTool('markdown_render', async (args) => {
    const markdown = String((args && args.markdown) || '')
    const format = (args && args.format) === 'pdf' ? 'pdf' : 'image'
    const r = await renderToFile(markdown, format)
    return r.ok ? { filePath: r.filePath } : { filePath: '', message: r.message }
  })
})()
