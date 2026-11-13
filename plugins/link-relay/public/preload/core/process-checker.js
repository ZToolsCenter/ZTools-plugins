/**
 * 进程检测模块 —— 检测指定可执行文件是否正在运行。
 * 迁移前必须确认 IDE 进程已关闭，防止数据损坏。
 */

const { execSync } = require('node:child_process')

/**
 * 检测指定可执行文件是否正在运行。
 * @param {string[]} exeNames 可执行文件名列表
 * @returns {boolean}
 */
function isRunning(exeNames) {
  if (!exeNames || exeNames.length === 0) return false

  try {
    if (process.platform === 'win32') {
      // Windows: 使用 tasklist 批量获取，然后在结果中查找
      const output = execSync('tasklist /FO CSV /NH', {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 5000,
      })
      const lowerOutput = output.toLowerCase()
      return exeNames.some((name) => lowerOutput.includes(name.toLowerCase()))
    } else {
      // macOS/Linux: 使用 ps
      const output = execSync('ps -A -o comm=', {
        encoding: 'utf-8',
        timeout: 5000,
      })
      const lowerOutput = output.toLowerCase()
      return exeNames.some((name) => lowerOutput.includes(name.toLowerCase()))
    }
  } catch {
    return false
  }
}

module.exports = { isRunning }
