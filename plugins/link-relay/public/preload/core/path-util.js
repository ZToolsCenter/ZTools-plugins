/**
 * 路径工具 —— 通用的环境变量 / 主目录 / 跨平台路径展开（无状态、纯函数）。
 *
 * 新架构不再有预设库：分组与映射全部由前端维护并以绝对路径传入，
 * 这里仅保留 expandEnv 供 window.services 暴露，以及内部复用的 resolve* 辅助。
 */

const path = require('node:path')
const os = require('node:os')

/** 展开环境变量（Windows %VAR% / Unix ${VAR}、$VAR） */
function expandEnv(p) {
  if (!p) return p
  let result = p
  result = result.replace(/%([^%]+)%/g, (_, key) => process.env[key] || '')
  result = result.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] || '')
  result = result.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, key) => process.env[key] || '')
  return result
}

/** 解析 ~ 为用户主目录 */
function resolveHome(p) {
  if (!p) return p
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1))
  return p
}

/** 展开环境变量 + ~ */
function resolvePath(p) {
  if (!p) return ''
  return resolveHome(expandEnv(p))
}

/** 按当前平台取模板路径（字符串或 {win32,darwin,linux}）并展开 */
function resolvePlatformPath(template) {
  if (!template) return ''
  if (typeof template === 'string') return resolvePath(template)
  return resolvePath(template[process.platform] || template.win32 || '')
}

module.exports = {
  expandEnv,
  resolvePath,
  resolveHome,
  resolvePlatformPath,
}
