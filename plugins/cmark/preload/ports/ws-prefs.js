/**
 * ws-prefs.js —— 按工作区隔离的插件偏好
 *
 * 为什么需要：
 *   全局 ~/.cmark-config.json 只适合放「所有工作区共用」的东西（当前工作区指针、主题）。
 *   Git 集成开关、远程凭据这类跟具体笔记库绑定的信息，必须按工作区分开存，
 *   否则换一个工作区还沿用上一个库的开关和 token，会出现「绑了 A 库却拿 B 库凭据推送」。
 *
 * 存哪：
 *   %LOCALAPPDATA%\znotes-data\<工作区哈希>\prefs.json
 *   哈希算法与 git-service 的 git-config.json 完全一致（md5(小写路径) 前 12 位），
 *   保证同一个工作区的各类配置落在同一个目录里。
 *   注意：绝不写进笔记仓库（不进 .cmark，也不进 git）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

function hashOf (ws) {
  // 与 git-service.js 保持一致：只做小写，不再做别的规范化，避免老配置目录变位置
  return crypto.createHash('md5').update(String(ws || '').toLowerCase()).digest('hex').slice(0, 12)
}

function dirOf (ws) {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return path.join(base, 'znotes-data', hashOf(ws))
}

function fileOf (ws) {
  return path.join(dirOf(ws), 'prefs.json')
}

function read (ws) {
  if (!ws) return {}
  try {
    return JSON.parse(fs.readFileSync(fileOf(ws), 'utf8')) || {}
  } catch (e) {
    return {}
  }
}

function patch (ws, obj) {
  if (!ws) return { ok: false, message: '工作区为空' }
  const next = Object.assign({}, read(ws), obj || {})
  try {
    fs.mkdirSync(dirOf(ws), { recursive: true })
    fs.writeFileSync(fileOf(ws), JSON.stringify(next, null, 2), 'utf8')
    return { ok: true, data: next }
  } catch (e) {
    return { ok: false, message: '偏好保存失败：' + e.message }
  }
}

module.exports = { hashOf, dirOf, fileOf, read, patch }