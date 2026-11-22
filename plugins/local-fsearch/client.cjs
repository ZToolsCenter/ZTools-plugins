const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')
const { aborted, checkAbort } = require('./latest.cjs')
const { execFile } = require('node:child_process')
const socketPath = path.join(os.homedir(), 'Library/Application Support/FSearch/fsearch.sock')
const binaryPath = path.join(os.homedir(), '.local/bin/fsearch')
let starting = null
const connections = new Set()

/**
 * 发送一条 JSON Lines 请求；每次请求独立连接，避免旧查询阻塞新查询的响应归属。
 * @param {object} payload FSearch 请求对象
 * @param {string} target 测试或本地服务的 Unix Socket 路径
 * @returns {Promise<object>} 成功的服务响应
 */
function exchange(payload, target = socketPath, { signal } = {}) {
  return new Promise((resolve, reject) => {
    try { checkAbort(signal) } catch (error) { reject(error); return }
    const socket = net.createConnection(target)
    let chunks = [], bytes = 0, settled = false
    const cancel = () => finish(aborted())
    const finish = (error, value) => {
      if (settled) return
      settled = true; chunks = []; bytes = 0
      connections.delete(cancel); signal?.removeEventListener('abort', cancel)
      socket.destroy(); error ? reject(error) : resolve(value)
    }
    connections.add(cancel); signal?.addEventListener('abort', cancel, { once: true })
    socket.setTimeout(8000, () => finish(new Error('FSearch 响应超时，请稍后重试')))
    socket.on('connect', () => socket.write(JSON.stringify(payload) + '\n'))
    socket.on('data', chunk => {
      if (settled) return
      const newline = chunk.indexOf(10), part = newline < 0 ? chunk : chunk.subarray(0, newline)
      bytes += part.length
      // 按真实字节限制单条响应；只拼接一次，避免逐片字符串复制与 UTF-8 边界问题。
      if (bytes > 8 * 1024 * 1024) return finish(new Error('FSearch 响应超过大小限制'))
      chunks.push(part)
      if (newline < 0) return
      try {
        const response = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))
        if (response.ok !== true) {
          const error = new Error(response.error || 'FSearch 返回无效状态')
          if (typeof response.error !== 'string') error.code = 'FSEARCH_PROTOCOL'
          return finish(error)
        }
        finish(null, response)
      } catch (error) { error.code = 'FSEARCH_PROTOCOL'; finish(error) }
    })
    socket.on('error', error => finish(error))
    socket.on('close', () => { if (!settled) finish(new Error('FSearch 连接已关闭，未收到完整响应')) })
  })
}

/** 退出只释放本插件的连接，不停止共享的 FSearch 守护进程。 */
function closeConnections() { for (const cancel of [...connections]) cancel() }

/**
 * 使用已安装的官方 CLI 启动守护进程；共享启动任务避免并发创建多个服务。
 * @returns {Promise<void>} 启动命令结束
 */
function startService() {
  if (starting) return starting
  starting = fs.access(binaryPath).catch(cause => { if (cause.code !== 'ENOENT') throw cause; const error = new Error('未安装 FSearch，预期位置：' + binaryPath); error.code = 'FSEARCH_MISSING'; throw error }).then(() => new Promise((resolve, reject) => {
    // 仅调用已安装的本地二进制，不拼接 shell，不自动下载或变更系统权限。
    execFile(binaryPath, ['status'], { timeout: 12000, maxBuffer: 1024 * 1024 }, error => {
      if (!error) return resolve()
      const failure = new Error('FSearch 启动失败：' + error.message); failure.code = ['EACCES', 'EPERM'].includes(error.code) ? error.code : 'FSEARCH_START_FAILED'; reject(failure)
    })
  })).finally(() => { starting = null })
  return starting
}

/**
 * 请求本地服务，仅在 Socket 不存在或拒绝连接时启动服务；业务错误原样报告。
 * @param {object} payload FSearch 请求
 * @returns {Promise<object>} 服务响应
 */
async function request(payload, { signal } = {}) {
  checkAbort(signal)
  try { return await exchange(payload, socketPath, { signal }) }
  catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error
    checkAbort(signal)
    await startService()
    checkAbort(signal)
    return exchange(payload, socketPath, { signal })
  }
}
module.exports = { request, exchange, closeConnections }
