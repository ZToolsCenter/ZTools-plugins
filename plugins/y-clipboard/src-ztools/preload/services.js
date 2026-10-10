/**
 * Y剪贴板 preload
 *
 * 插件的核心能力（剪贴板历史、搜索、写入）由宿主 window.ztools 提供；
 * 这里补两件宿主没直接给的事：
 *   1. 把本地磁盘上的图片文件读成 data URL
 *      —— 插件页面受浏览器安全策略限制，不能直接用 file:// 加载本地图片。
 *   2. 在文件管理器中定位到某个文件
 *      —— 宿主 ztools.shellShowItemInFolder 可用时优先走宿主；
 *         这里是兜底通道（老版本宿主 / 直接调试页面）。
 */

const fs = require('node:fs')
const path = require('node:path')

const MIME_MAP = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  svg: 'image/svg+xml'
}

function mimeOf(filePath) {
  const ext = path.extname(String(filePath)).toLowerCase().slice(1)
  return MIME_MAP[ext] || 'image/png'
}

window.services = {
  ready() {
    return typeof window.ztools !== 'undefined'
  },

  /**
   * 本地图片文件 → data URL；读取失败返回 null。
   * 超过 20MB 的文件直接跳过，避免拖慢界面。
   */
  readImageDataUrl(filePath) {
    try {
      if (!filePath) return null
      if (/^(data:|https?:)/i.test(filePath)) return filePath
      if (!fs.existsSync(filePath)) return null
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return null
      const buf = fs.readFileSync(filePath)
      return 'data:' + mimeOf(filePath) + ';base64,' + buf.toString('base64')
    } catch (e) {
      return null
    }
  },

  fileExists(filePath) {
    try {
      return fs.existsSync(String(filePath))
    } catch (e) {
      return false
    }
  },

  /**
   * 在文件管理器中选中并高亮给定文件（Windows 资源管理器 / macOS Finder / Linux 文件管理器）。
   * 成功唤起返回 true；路径不存在或平台不支持返回 false，由调用方提示用户。
   */
  revealInFolder(filePath) {
    try {
      const target = String(filePath || '')
      if (!target) return false

      // 目录：直接打开它本身；文件：打开所在目录（不存在就退回上一层存在的目录）
      let dir = target
      if (fs.existsSync(target)) {
        const stat = fs.statSync(target)
        if (!stat.isDirectory()) dir = path.dirname(target)
      } else {
        let p = path.dirname(target)
        while (p && !fs.existsSync(p)) {
          const up = path.dirname(p)
          if (up === p) break
          p = up
        }
        dir = p || path.dirname(target)
      }

      // 优先 Electron shell：它能真正"选中"文件，而不只是打开目录
      try {
        const electron = require('electron')
        if (electron && electron.shell && typeof electron.shell.showItemInFolder === 'function') {
          electron.shell.showItemInFolder(target)
          return true
        }
      } catch (e) {
        /* preload 里拿不到 electron（沙箱 / 版本差异）：走下面的系统命令 */
      }

      const { spawn } = require('node:child_process')
      let cmd = ''
      let args = []
      if (process.platform === 'win32') {
        cmd = 'explorer'
        // "/select," 与路径分开传：explorer 会把它拼成 /select,"D:\a\b.txt"
        args = fs.existsSync(target) && !fs.statSync(target).isDirectory()
          ? ['/select,', target]
          : [dir]
      } else if (process.platform === 'darwin') {
        cmd = 'open'
        args = fs.existsSync(target) ? ['-R', target] : [dir]
      } else {
        cmd = 'xdg-open'
        args = [dir]
      }

      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
      child.on('error', () => { /* 起不来就当失败 */ })
      child.unref()
      return true
    } catch (e) {
      return false
    }
  },

  /** 用系统默认方式打开文件（可选能力，暂未被 UI 使用） */
  openPath(filePath) {
    try {
      const electron = require('electron')
      if (electron && electron.shell && typeof electron.shell.openPath === 'function') {
        const err = electron.shell.openPath(String(filePath))
        return !err
      }
    } catch (e) {
      /* ignore */
    }
    return false
  }
}
