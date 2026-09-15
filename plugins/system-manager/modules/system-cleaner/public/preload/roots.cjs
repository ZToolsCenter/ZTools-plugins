'use strict'

const path = require('node:path')

function root(id, label, category, targetPath, options = {}) {
  return {
    id,
    label,
    category,
    path: targetPath,
    minAgeDays: options.minAgeDays ?? 7,
    defaultSelected: options.defaultSelected !== false,
    requireOwnership: options.requireOwnership === true
  }
}

function platformRoots(platform, options = {}) {
  const home = options.home || ''
  const temp = options.temp || ''

  if (platform === 'win32') {
    const win = path.win32
    const local = win.join(home, 'AppData', 'Local')
    return [
      root('user-temp', '用户临时文件', 'temporary', win.join(local, 'Temp'), { minAgeDays: 3, requireOwnership: true }),
      root('crash-dumps', '应用崩溃转储', 'logs', win.join(local, 'CrashDumps'), { minAgeDays: 14 }),
      root('internet-cache', '系统网络缓存', 'cache', win.join(local, 'Microsoft', 'Windows', 'INetCache'), { minAgeDays: 7 })
    ]
  }

  if (platform === 'darwin') {
    const normalizedTemp = path.resolve(temp || path.sep)
    const parts = normalizedTemp.replace(/^\/private(?=\/var\/folders\/)/, '').split(path.sep).filter(Boolean)
    const trustedTemp = parts.length === 5 && parts[0] === 'var' && parts[1] === 'folders' && parts[2].length === 2 && parts[3].length >= 8 && parts[4] === 'T'
      ? temp
      : null
    return [
      root('user-caches', '用户应用缓存', 'cache', path.join(home, 'Library', 'Caches'), { minAgeDays: 7 }),
      root('user-logs', '用户应用日志', 'logs', path.join(home, 'Library', 'Logs'), { minAgeDays: 14 }),
      ...(trustedTemp ? [root('user-temp', '用户临时文件', 'temporary', trustedTemp, { minAgeDays: 3, requireOwnership: true })] : [])
    ]
  }

  return [
    root('user-cache', '用户应用缓存', 'cache', path.join(home, '.cache'), { minAgeDays: 7 }),
    root('user-temp', '用户临时文件', 'temporary', '/tmp', { minAgeDays: 3, requireOwnership: true })
  ]
}

module.exports = { platformRoots }
