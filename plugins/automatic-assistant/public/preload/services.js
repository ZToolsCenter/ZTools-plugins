const vm = require('vm')
const fs = require('fs')
const path = require('path')

// ZTools 环境入口
const zt = window.ztools

// 同步阻塞等待，用于模拟按键前等主窗口隐藏、剪贴板就绪
const sleepMs = (ms) => {
  const end = Date.now() + Number(ms)
  while (Date.now() < end);
}

const pasteModifier = () => (zt.isMacOS() ? 'command' : 'ctrl')

// 脚本沙箱内允许使用的 API 白名单。
// 运行时探测：ZTools 已实现的直接透传，未实现的调用时抛出明确错误，
// 后续 ZTools 补齐 API 后无需修改本文件即可生效。
const PASSTHROUGH_APIS = [
  'showNotification',
  'hideMainWindow',
  'redirect',
  'screenColorPick',
  'screenCapture',
  'getPath',
  'copyFile',
  'copyImage',
  'copyText',
  'readCurrentFolderPath',
  'readCurrentBrowserUrl',
  'shellOpenPath',
  'shellShowItemInFolder',
  'shellOpenExternal',
  'shellBeep',
  'simulateKeyboardTap',
  'simulateMouseClick',
  'simulateMouseRightClick',
  'simulateMouseDoubleClick',
  'simulateMouseMove',
  'getCursorScreenPoint',
  'getPrimaryDisplay',
  'getAllDisplays',
  'getDisplayNearestPoint',
  'getDisplayMatching',
  'isMacOs',
  'isMacOS',
  'isWindows',
  'isLinux'
]

const sandboxApi = {}

for (const name of PASSTHROUGH_APIS) {
  if (typeof zt[name] === 'function') {
    sandboxApi[name] = (...args) => zt[name](...args)
  } else {
    sandboxApi[name] = () => {
      throw new Error(`ztools.${name} 在 ZTools 中暂不支持`)
    }
  }
}

// hideMainWindowPaste* / hideMainWindowTypeString：
// 原生优先——ZTools 已实现则直接透传；
// 未实现时才降级为「复制到剪贴板 → 隐藏主窗口 → 模拟 Ctrl/Cmd+V 粘贴」。
// 注意 typeString 原生语义是"模拟键入"、不碰剪贴板，降级实现会覆写剪贴板，
// 故仅在原生缺失时启用。
const hideAndPaste = () => {
  zt.hideMainWindow()
  sleepMs(150)
  zt.simulateKeyboardTap('v', pasteModifier())
  return true
}

// 原生存在则用原生，否则用 fallback
const nativeOrFallback = (name, fallback) => {
  sandboxApi[name] = (...args) => {
    if (typeof zt[name] === 'function') return zt[name](...args)
    return fallback(...args)
  }
}

nativeOrFallback('hideMainWindowPasteText', (text) => {
  zt.copyText(String(text))
  return hideAndPaste()
})

nativeOrFallback('hideMainWindowTypeString', (str) => {
  zt.copyText(String(str))
  return hideAndPaste()
})

nativeOrFallback('hideMainWindowPasteFile', (file) => {
  if (!zt.copyFile(file)) return false
  return hideAndPaste()
})

nativeOrFallback('hideMainWindowPasteImage', (image) => {
  if (!zt.copyImage(image)) return false
  return hideAndPaste()
})

const SCRIPT_CONTEXT = {
  ztools: sandboxApi,
  Buffer,
  require,
  process,
  TextDecoder,
  TextEncoder,
  URL,
  URLSearchParams,
  runAppleScript: (script) =>
    new Promise((resolve, reject) => {
      let stderr = ''
      let stdout = ''
      const child = require('child_process').spawn('osascript', ['-ss'], { detached: true })
      child.on('close', (code) => {
        if (code === 0) return resolve(stdout.trim())
        stderr = stderr
          .trim()
          .replace(/^\d+:\d+: execution error:/, '')
          .replace(/\(-?(\d+)\)\s*$/, '')
        const err = new Error(stderr)
        err.code = parseInt(RegExp.$1 || code)
        reject(err)
      })
      child.stderr.on('data', (data) => {
        stderr += data
      })
      child.stdout.on('data', (data) => {
        stdout += data
      })
      child.stdin.write(script)
      child.stdin.end()
    }),
  sleep: sleepMs
}

vm.createContext(SCRIPT_CONTEXT)

window.platform = process.platform

window.services = {
  // 在沙箱中执行自动化脚本；enter 为进入插件的 action，print 输出回调
  vmRunScript: async (code, enter, print) => {
    if (!code.trim()) return
    SCRIPT_CONTEXT.ENTER = Object.freeze(enter)
    SCRIPT_CONTEXT.print = print
    return await Promise.resolve(vm.runInContext(`(()=>{${code}})()`, SCRIPT_CONTEXT))
  },
  // 读取本地图片并转成 dataURL（选择图标用；走 preload 避免渲染进程的 file:// 限制）
  readImageDataUrl: (filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return null
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + (ext || 'png')
    return 'data:' + mime + ';base64,' + fs.readFileSync(filePath).toString('base64')
  },
  // 读取内置脚本源码
  getInsetScript: (name) => {
    const file = path.join(__dirname, 'scripts', name + '.js_')
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null
  }
}
