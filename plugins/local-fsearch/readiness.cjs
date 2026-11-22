const fs = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const { createHash } = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const compatibility = require('./compatibility.json')
const { checkAbort } = require('./latest.cjs')
const binaryPath = path.join(os.homedir(), '.local/bin/fsearch')
const socketPath = path.join(os.homedir(), 'Library/Application Support/FSearch/fsearch.sock')

/** 错误保留真实原因；仅将已知的安装、权限、建索引与协议错误转成可操作说明。 */
function failure(error) {
  const detail = error.message || String(error)
  let state = 'connection', title = '暂时无法连接 FSearch', message = '确认 FSearch 已安装，稍后点击“重新检测”。'
  if (error.code === 'FSEARCH_MISSING') { state = 'missing'; title = '请先安装 FSearch'; message = '插件不附带搜索引擎。按安装指引安装后，点击“重新检测”。' }
  else if (['EACCES', 'EPERM'].includes(error.code)) { state = 'permission'; title = '无法访问本地服务'; message = '检查当前用户是否可访问 FSearch 程序和 Socket；不要用 sudo 启动插件。' }
  else if (/indexing|index not ready|initial scan/i.test(detail)) { state = 'indexing'; title = 'FSearch 正在建立初始索引'; message = '等待引擎完成后点击“重新检测”；插件不会额外扫描磁盘。' }
  else if (error.code === 'FSEARCH_PROTOCOL' || /unknown (op|mode|case)|unsupported/i.test(detail)) { state = 'incompatible'; title = 'FSearch 接口不兼容'; message = '请使用安装指引中已验证的 FSearch 版本，再重新检测。不会自动切换搜索方式。' }
  else if (error.code === 'FSEARCH_START_FAILED') { state = 'start-failed'; title = 'FSearch 启动失败'; message = '在终端执行 ~/.local/bin/fsearch status 查看原因，确认 macOS 允许运行此程序。' }
  return { usable: false, state, title, message, detail, binaryPath, socketPath }
}

/** 流式计算已安装文件的指纹，不读取整个二进制到内存；不据此推断正在运行的守护进程版本。 */
async function installedIdentity() {
  try {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(binaryPath)) hash.update(chunk)
    const sha256 = hash.digest('hex')
    return { sha256, version: sha256 === compatibility.fsearch.binarySha256 ? compatibility.fsearch.version : null }
  } catch (error) {
    if (error.code === 'ENOENT') return { version: null, warning: '服务可连接，但标准安装位置没有二进制，无法自动重启或核对安装版本。' }
    return { version: null, warning: '无法核对安装文件指纹：' + error.message }
  }
}

/**
 * 每个插件进程只保留一份微小能力报告；状态每次重读，手动重检才重新执行探针。
 * 探针直接读取临时小文件，不等索引、不搜索用户正文，结束后删除。
 */
function createReadiness(request, { io = fs, platform = process.platform, arch = process.arch, identity = installedIdentity, tempRoot = os.tmpdir() } = {}) {
  let verified = null, checking = null
  const protocol = message => { const error = new Error(message); error.code = 'FSEARCH_PROTOCOL'; throw error }
  async function probe() {
    const folder = await io.mkdtemp(path.join(tempRoot, 'ztools-fsearch-check-'))
    try {
      const target = path.join(folder, 'probe.rs')
      await io.writeFile(target, 'fn ProbeCaseToken() {}\n// probecasetoken\n')
      const file = await io.realpath(target)
      const grep = async (pattern, mode, sensitivity) => {
        const result = await request({ op: 'grep', file, pattern, mode, case: sensitivity, per_file: 3, context: 1 })
        if (!Array.isArray(result.files) || result.complete !== true) protocol('正文探针未返回完整的 files 响应')
        const matches = result.files.flatMap(item => item.matches || [])
        if (matches.some(item => !Number.isSafeInteger(item.line) || !Array.isArray(item.ranges) || !Array.isArray(item.before) || !Array.isArray(item.after))) protocol('正文行号、高亮或上下文接口不兼容')
        return matches.map(item => item.line)
      }
      const insensitive = await grep('ProbeCaseToken', 'literal', 'insensitive')
      const sensitive = await grep('ProbeCaseToken', 'literal', 'sensitive')
      const regex = await grep('(?i:probe.*token)', 'regex', 'sensitive')
      const symbol = await grep('ProbeCaseToken', 'symbol', 'sensitive')
      if (JSON.stringify(insensitive) !== '[1,2]' || JSON.stringify(sensitive) !== '[1]' || JSON.stringify(regex) !== '[1,2]' || JSON.stringify(symbol) !== '[1]') protocol('文本包含、Aa、正则或定义搜索的实际语义与插件要求不一致')
      // 限定探针目录和一条结果，仅确认名称及最近列表接口结构；不修改引擎的打开记录。
      for (const payload of [{ q: 'probe', in: folder, limit: 1, offset: 0 }, { op: 'recent', in: folder, limit: 1 }]) {
        const result = await request(payload)
        if (!Array.isArray(result.hits)) protocol('名称搜索或最近列表接口不兼容')
      }
      return { checkedAt: new Date().toISOString(), identity: await identity(), capabilities: ['名称接口', '最近文件接口', '文本包含', 'Aa', '正则', '代码定义', '行号与上下文'] }
    } finally { await io.rm(folder, { recursive: true, force: true }) }
  }
  return {
    /** 无后台轮询；失败不缓存，稍后重试会重新确认服务与能力。 */
    async inspect({ recheck = false, signal } = {}) {
      if (platform !== 'darwin') return { ...failure(new Error('此插件仅支持 macOS')), state: 'platform', title: '仅支持 macOS' }
      try {
        checkAbort(signal)
        const status = await request({ op: 'status' }, { signal })
        if (!Number.isSafeInteger(status.entries) || status.entries < 0 || typeof status.full_disk_access !== 'boolean' || !Number.isSafeInteger(status.content_pending)) protocol('status 缺少插件需要的索引与权限字段')
        if (recheck) verified = null
        if (!verified) {
          // 并发进入共用一次检查；检查期间只有这一个极小任务，不增加查询并行度。
          if (!checking) checking = probe().then(result => { verified = result; return result }).finally(() => { checking = null })
          await checking
        }
        checkAbort(signal)
        return { usable: true, state: !status.full_disk_access ? 'limited' : status.content_pending > 0 ? 'content-indexing' : 'ready', status, ...verified, arch, binaryPath, socketPath }
      } catch (error) { if (error.name === 'AbortError') throw error; return failure(error) }
    }
  }
}
module.exports = { createReadiness, failure, installedIdentity }
