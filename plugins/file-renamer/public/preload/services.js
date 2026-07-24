const fs = require('node:fs')
const { webUtils } = require('electron')

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 重命名文件
  rename(oldPath, newPath) {
    return new Promise((resolve, reject) => {
      fs.rename(oldPath, newPath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  },
  // 判断文件是否存在
  exists(targetPath) {
    return fs.existsSync(targetPath)
  },
  // 读取文件状态信息
  getStats(targetPath) {
    return new Promise((resolve, reject) => {
      fs.stat(targetPath, (err, stats) => {
        if (err) {
          reject(err)
          return
        }

        resolve({
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          ctimeMs: stats.ctimeMs,
          birthtimeMs: stats.birthtimeMs
        })
      })
    })
  },
  // 获取拖拽 File 对象的本地绝对路径（Electron 22+ 废弃 File.path，改用 webUtils）
  getPathForFile(file) {
    return webUtils.getPathForFile(file)
  }
}
