// ZTools 插件：网盘链接速开（preload）v1.5.0
// 主窗口粘贴网盘/视频等链接 → 识别域名 → mainPush 返回「打开 XX App」候选项
// 点击候选项 → 直接 spawn 启动本地 App（不写剪贴板、不开浏览器）
//
// v1.5.0 性能优化：
//   1. 百度/夸克图标 base64 直接预置进插件（内置 ICON_DATA），不再走 PowerShell 抽取、
//      不再读缓存文件 → mainPush 响应毫秒级（原版首次要 execFileSync 等 PowerShell ~1s）
//   2. findExe 结果内存缓存（exeCache），避免每次 mainPush 重复 fs.existsSync 探测
//   3. 保留 extractIcon 作为兜底（用户自定义 exe 规则仍可运行时抽图标）

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn, execFileSync } = require('child_process')

// ─── 预置图标（从本地 app exe 抽出的真实图标，base64 内嵌，零 IO）───
const ICON_DATA = {
  baidu: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAT/SURBVFhHxZdpbFRVFMf7SY0aA5qgGNEPGlyCESyIaEVBhIASSI20UQnLByOBAC2WJRatgFIiKUuooAmiBLRCW4qlUval6bRlm7aUTgdKC3SbdqbAm5nOvDdv5v30zgPxvT7KRFP5J+fTPff+/3c595wTF2eCV5KyvJKE3+8nEAigKMp/MrGGWMvr9QrLMvP9Da/XO0KVlR2RSITeglhbVdUdgqsbeTgcNvv3GgRXIBC4JULs3OzU21AVpSkqQtx5bx777SA4BbcQYB6LCYEINMlwSYauf6lfcMeJFxorNOC0H75thTG18FoVxJ+CoScgzQmHPKAKpxghuONEmMQCsW51AKZehLcdkHAWXq2EIRUwyAYvHIeEUjjojl2E4I4TsRoLTvp08lEOeKMGkutgQT2knIfJdhh4FJ46CPFHoNBlnm2NYDAYuwBx7O84dQEz6qHaD56QbjU+SDoDT+6HR/dA8gnzbGsI7pgEBCOQfrSBzD+qmHMuQE2X2QMcQsSRILPWniJpfQ2uwJ3vIWYBktRFS2Y2vmWrse8rR1K6f1q+kIYtt4JrSUto/WApLRc6zC7dcEcBYg/iiFub3JC+QrdtO8FnETkBGS37N3h3Htq4OTTZ6mgLQqSHg+hRgBSGok5Ia4RPz8qoS1fC58shaxM0t5ndobUDFq+DCXOjAj4scJNcDj9dgg7Z7KzDUoAQLD6XaechoQqGV8IrZ+DAd3lEFi2H1AzYsAVa2iEo69bmJrJyM0xKQZswl9Lpa+i7m6g9kAuD90HlNQibTsNSgEeFr5v0OI/Guh0S7JBW6MT1xRpI+RJmL4XMjbAlDzbnQsYGtMRUeG8enkmLmL+qjP5F8NAuXYCwZBtcMT1eSwE5nTDWASNr4P06KPeCEgFJidB+2kHXwky0T9Jh5hKYuhCSF0BiCtrE+YSmLMFTWMZ1fyj6PR9zw8sH4ME86JMLy2sMVNYC0pvhrVoY74DtbsMQkXCYwweqKcv4EaYvho/SYEoqJM6ndtZa6vPL0JRQ9BpvYtNF6F8A9+bAuCP/GLidAPHbCQEfXwBn0DAURUEHjLDBmKJOZmx3Mn1rHZML2slr10/KjFoJ4ot1AQMKjGOWAmY2wJu1kHQeqi0+nBwXDLXBcyX69/vScchqsCYXOHkVBhfDPb/C04XGMUsBa9pgtANGnYNlV8AX1iNDxHOLAomVMKgUnj0G8SVQ7NZDdn0jfOOEBr/+2sUcrwqzT0PffLgvB6aVGaisBRzzwmSnnnBGn4UVV2B3J2xzwRwnvGiD50tgeBlkX4aQBhUSPHMQntgr8oDGxkaN7ZchtQr67YL7d0L/XbCt0UBlLUCOwE7PrXwvUu6wMxBfcSP1lsLIE8bcX98FQw7D43vhsSLo9zs8kg99boThw/mwygE+1UBlLUDAH4ZsF4w/d0vAsFMwuBwmVkKuy5jzxfXsEEVKyQ0Bhfon1KcABuyBFDtc606jp+OeCpLrKuR7YGMzfN8MxVd7LjbEWGErrHbCVw6NHxqhNai/BytEC5JYSjKxw56SihnC9eZD7AnRkkx0LHcL0aJUtEt3tSyPNiaq+r83JiFZ1huTu9GaqaoqGlVjfyjUiHbpttex34aW+Bna2NkGG7Aagw1cBz/bzZN1iLXFzruR34QQYW7PRayKv0I+VIE8IwM5abHB4jcoBnt9k8Ivdov2XJKid25oSv/Cn0uoZUnHywkFAAAAAElFTkSuQmCC',
  quark: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAR8SURBVFhHzZd9TFVlHMdPgracKxzpH9pcZstpuvqLsfWmm5aRWpJJzHBcVoEvzTRRZtncsLAsliO6kstyzlZkcbGVkTR7VWe1qRMyihACrwm7XO459+Xce8/5tOc+F4GHe4GWaZ/t7G7n9/J87+/5nedF05IAjAfmAxuB8/xzRIyIFTnGq/mTAqQDpcA5NeO/QOQSOdPV8QYAZAKNavRlROTOVMeNAWTYtt2pRlxu4mNkqIOn27b9q+r8XxEfq2864vNzpSntHTwNaFetQ/GLEWF/S5hXj0UpP2zjOgEdXarXsIgx04SAeaolGWdMA0dHC1N+auPaTz1oFUG0tVFSV9jc5IB1b8Nf3WrUkMwTAkrUt4k4Ev6T+7q+ZFrbUSY2niX9hwtMqvEzcUeEMUUWKUttrsmCO9fAmVY1OiklQoBbfavSZLlZZuxmjnc/GRfr2dzZzlHdpD1o0eK1OXjKJqvMZszDkLoQ7lgNF0ZWCbcQMCRRLF4P7WaFfwuP6ruoM9tUlxhRCza9C2MWE6vE2irVIzHDCmi1m3kh6GBdsJAD4UOqeQBCxIItsgqTnhhZYw4roD78CW+Y97ItlENZsIWvIhaGrXr14TomqzB6Ebx3WLUOJqmAi0Eo+BGebH8NV/RWtgdzGN3pYZTHz+16gD3hiBoSo6kDxi+DsUvgxsdhZSV09qhefSQUcF6HzOoI2l7Ib32Zj60ZlAbySevQ0Tr9aF4DrcdgfdDEUmLbu2D603DdI5C6SPbDXRvA7VEc4wwSYNmwvNpC2x4htQrymp3sjM5nZ+gZTodDvBmIcLPPz6geIyZkn1IJES/WgiOnYUlpX1Pm7ZA2lUECTrTA2GKLlK0RlteCyzzEc6ECioPFXIzvVQ2WxRSfrMQ9RoComiROOAo5ZbIS47LhRJPqkUBAmQs0h8UNJRYN56GZc+QHtpIb2MYu87tLfo5ACM2rM9Xnx2cn+GtxTv0BaY/JKmyvVq0JBKx2gpZtc1uxjRGU68DmoIsH/FXMNT6i3PydmrCXGXp3rAIZeoDE7SjRAzD9KdAehNVvqdYEAja+A1oWTHaAO76a/WZ185D/c2brddyiH2eC7yzjetxo3h6cZlhNMQDRfJPzZM5Ne1RrAgEffgspC+V3XHGw732D5SMv0MA0vZF0XyuTfV1sDYWSzn8v5TUyl1icDnyvWhMI8Ogws0gGTciFD74Bq9+31obJSUw8gz7AgYgG3FsP6TmyCcX+0ONXvaSAQZtR7TG5kIhPSPzO2QSFFbDGCc86Yb0T1jqhqBIqP5ODiWV49xewqlL63r1BrgWjF8P1S6HuZ3WUGLHNKOF2/P7Xcu5E94r5E0006FkgbSdboKldTl3snbBlydipBVB7XM1+idh2nPRA0uyGF/fB3BKYvQpmrYRZ4jf+zCiC7JfAY8huz30FZhbKct//PJRVy5VxCGIHkhEdyQIm+EP9HhOMkOolbcGhP4xe5JHsqh9K/xfH8riIq3cx6eWqXs166Xc5HfnZdnhEruEvp/25UtfzvwF00KtfWFiexQAAAABJRU5ErkJggg=='
}

// ─── 识别规则（host 匹配，含子域；exe = 本地安装路径候选） ────────
const RULES = [
  { name: '百度网盘', emoji: '📦', iconKey: 'baidu', hosts: ['pan.baidu.com'],
    exe: [
      '%APPDATA%\\baidu\\BaiduNetdisk\\BaiduNetdisk.exe',
      'C:\\Program Files (x86)\\BaiduNetdisk\\BaiduNetdisk.exe',
      'C:\\Program Files\\BaiduNetdisk\\BaiduNetdisk.exe'
    ]
  },
  { name: '夸克网盘', emoji: '🌀', iconKey: 'quark', hosts: ['pan.quark.cn'],
    exe: [
      'C:\\Program Files (x86)\\QuarkCloudDrive\\quark_cloud_drive.exe',
      'C:\\Program Files\\QuarkCloudDrive\\quark_cloud_drive.exe',
      '%LOCALAPPDATA%\\QuarkCloudDrive\\quark_cloud_drive.exe'
    ]
  },
  { name: '阿里云盘', emoji: '🌌', hosts: ['www.alipan.com', 'alipan.com', 'www.aliyundrive.com', 'aliyundrive.com'], exe: [] },
  { name: 'UC 网盘', emoji: '🔵', hosts: ['drive.uc.cn'], exe: [] },
  { name: '天翼云盘', emoji: '☁️', hosts: ['cloud.189.cn'], exe: [] },
  { name: '115 网盘', emoji: '🔶', hosts: ['115.com', '115cdn.com', 'www.115.com'], exe: [] },
  { name: '迅雷云盘', emoji: '⚡', hosts: ['pan.xunlei.com'], exe: [] },
  { name: '123 云盘', emoji: '🟩', hosts: ['123pan.com', 'www.123pan.com', 'www.123684.com'], exe: [] },
  { name: '哔哩哔哩', emoji: '📺', hosts: ['bilibili.com', 'www.bilibili.com', 'b23.tv'], exe: [] },
]

// ─── URL 解析与匹配 ───────────────────────────────────────────────
function extractUrl(text) {
  if (!text) return null
  const m = String(text).match(/https?:\/\/[^\s"'<>]+/i)
  if (!m) return null
  try { return new URL(m[0]) } catch (e) { return null }
}

function matchRule(url) {
  if (!url) return null
  const host = (url.hostname || '').toLowerCase()
  for (const r of RULES) {
    for (const h of r.hosts) {
      if (host === h || host.endsWith('.' + h)) return r
    }
  }
  return null
}

// ─── 本地 App 探测（带内存缓存，避免重复 IO） ─────────────────────
const exeCache = new Map()

function expandEnv(p) {
  return p.replace(/%([^%]+)%/g, (m, k) => process.env[k] || os.homedir() || m)
}

function findExe(rule) {
  const key = rule.name
  if (exeCache.has(key)) return exeCache.get(key)
  let found = null
  for (const cand of rule.exe || []) {
    const p = expandEnv(cand)
    try { if (fs.existsSync(p)) { found = p; break } } catch (e) {}
  }
  exeCache.set(key, found)
  return found
}

// ─── 图标：预置 base64 优先 → 缓存文件 → PowerShell 兜底 ──────────
const ICON_DIR = path.join(os.homedir(), '.config', 'ztools', 'url-to-app', 'icons')
try { fs.mkdirSync(ICON_DIR, { recursive: true }) } catch (e) {}

function extractIcon(exePath) {
  if (!exePath) return null
  const hash = crypto.createHash('md5').update(exePath).digest('hex').slice(0, 12)
  const out = path.join(ICON_DIR, hash + '.png')
  if (fs.existsSync(out)) return out
  // 兜底：用 System.Drawing 抽 EXE 关联图标存 PNG（仅自定义 exe 规则首次需要）
  const ps = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command',
    `Add-Type -AssemblyName System.Drawing;` +
    `$i = [System.Drawing.Icon]::ExtractAssociatedIcon('${exePath.replace(/'/g, "''")}');` +
    `if ($i) { $i.ToBitmap().Save('${out.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png); $i.Dispose(); 'OK' } else { 'NO_ICON' }`
  ]
  try {
    const out_ = execFileSync('powershell', ps, { timeout: 12000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
    if (out_ === 'OK' && fs.existsSync(out)) return out
  } catch (e) {}
  return null
}

// ─── 启动：能跑本地就跑本地，不能跑就回退系统默认（浏览器） ─────
function spawnLocal(exe) {
  try {
    const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    return true
  } catch (e) { return false }
}

function openExternal(url) {
  try {
    if (typeof window !== 'undefined' && window.ztools && window.ztools.shellOpenExternal) {
      window.ztools.shellOpenExternal(url)
    }
  } catch (e) {}
}

function notify(text) {
  try {
    if (typeof window !== 'undefined' && window.ztools && window.ztools.showNotification) {
      window.ztools.showNotification(text)
    }
  } catch (e) {}
}

function launch(rule, url) {
  const exe = findExe(rule)
  if (exe && spawnLocal(exe)) {
    notify(`已启动 ${rule.name}`)
    return
  }
  openExternal(url)
  notify(`未找到本地 ${rule.name}，已用浏览器打开`)
}

function hideAndExit() {
  try { if (typeof window !== 'undefined' && window.ztools && window.ztools.hideMainWindow) window.ztools.hideMainWindow(false) } catch (e) {}
  try { if (typeof window !== 'undefined' && window.ztools && window.ztools.outPlugin) window.ztools.outPlugin() } catch (e) {}
}

function iconFor(rule, exe) {
  // v1.5.0：预置 base64 优先（毫秒级，零 IO）；无预置则抽 exe 图标（兜底）；最后 emoji
  if (rule.iconKey && ICON_DATA[rule.iconKey]) return ICON_DATA[rule.iconKey]
  if (exe) {
    const p = extractIcon(exe)
    if (p) {
      try {
        return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64')
      } catch (e) {}
    }
  }
  return rule.emoji
}

function itemFor(rule, url) {
  const exe = findExe(rule)
  return {
    text: `打开 ${rule.name} ${url}`,
    title: `打开 ${rule.name}`,
    description: (exe ? `将启动本地 ${rule.name} · ` : `未检测到本地 App，将用浏览器打开 · `) + url,
    icon: iconFor(rule, exe),
    url,
    rule
  }
}

// ─── feature: open（mode list，搜索框命令 / 选中文字进入） ────────
const openFeature = {
  mode: 'list',
  args: {
    enter: (action, callbackSetList) => {
      const url = extractUrl(action && action.payload)
      const rule = matchRule(url)
      callbackSetList(rule && url ? [itemFor(rule, url.href)] : [])
    },
    search: (action, searchWord, callbackSetList) => {
      const url = extractUrl(searchWord)
      const rule = matchRule(url)
      callbackSetList(rule && url ? [itemFor(rule, url.href)] : [])
    },
    select: (action, itemData) => {
      if (itemData && itemData.url && itemData.rule) launch(itemData.rule, itemData.url)
      hideAndExit()
    }
  }
}

// ─── 主窗口联想（mainPush）：粘贴链接即出「打开 XX App」 ──────────
if (typeof window !== 'undefined' && window.ztools && window.ztools.onMainPush) {
  window.ztools.onMainPush(({ payload }) => {
    try {
      const url = extractUrl(payload)
      const rule = matchRule(url)
      if (!rule || !url) return { type: 'list', data: [] }
      return { type: 'list', data: [itemFor(rule, url.href)] }
    } catch (e) {
      return { type: 'list', data: [] }
    }
  }, ({ option }) => {
    if (option && option.url && option.rule) {
      launch(option.rule, option.url)
      hideAndExit()
    }
  })
}

// ─── 导出 ─────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.exports = { open: openFeature }
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractUrl, matchRule, findExe, extractIcon, launch, itemFor, RULES, openFeature, ICON_DATA }
}
