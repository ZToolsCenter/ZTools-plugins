const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { checkAbort, aborted } = require('./latest.cjs')
const { normalizeMatch } = require('./content.cjs')

/** 宿主集成只处理当前选中文件，不建立索引，不预读文件集；系统进程仅同时保留一个预览。 */
function createHost(ztools, request, launch = spawn, { everything } = {}) {
  let previewProcess = null, previewTarget = null, previewGeneration = 0
  const validPath = target => {
    if (typeof target !== 'string' || !path.isAbsolute(target) || target.includes('\0')) throw new Error('文件路径无效')
    return target
  }
  function result(value, label) {
    if (!value || value.success !== true) throw new Error(value?.error || label + '失败')
  }
  const dispose = () => { previewGeneration++; if (previewProcess) { previewProcess.kill(); previewProcess = null; previewTarget = null } }
  return {
    dispose,
    async open(target) {
      validPath(target)
      result(await ztools.shellOpenPath(target), '打开文件')
      if (everything) return
      // 打开成功后才写入 FSearch 的 frecency；记录失败明确报告，不伪称已保存。
      try { await request({ op: 'open', path: target }) }
      catch (error) { return { warning: new Error('文件已打开，但最近记录未保存：' + error.message) } }
    },
    async openLine(target, line, editor = 'vscode') {
      if (everything) throw new Error('Windows 暂不支持正文跳行')
      validPath(target)
      if (!Number.isSafeInteger(line) || line < 1) throw new Error('命中行号无效')
      if (!['vscode', 'cursor'].includes(editor)) throw new Error('未知编辑器')
      const encoded = target.split('/').map(encodeURIComponent).join('/')
      result(await ztools.shellOpenExternal(`${editor}://file${encoded}:${line}:1`), '跳转编辑器')
      try { await request({ op: 'open', path: target }) } catch (error) { return { warning: new Error('编辑器已打开，但最近记录未保存：' + error.message) } }
    },
    copyFile(target) {
      validPath(target)
      if (ztools.copyFile(target) !== true) throw new Error('复制文件失败')
      return true
    },
    async quickLook(target) {
      if (everything) throw new Error('快速预览仅在 macOS 可用')
      validPath(target)
      const version = ++previewGeneration
      await fs.access(target)
      if (version !== previewGeneration) throw aborted()
      if (previewProcess && previewTarget === target) { dispose(); return }
      dispose()
      // 参数数组避免路径中的空格/元字符被 shell 执行；关闭插件时释放子进程。
      await new Promise((resolve, reject) => {
        const child = launch('/usr/bin/qlmanage', ['-p', target], { stdio: 'ignore' })
        previewProcess = child; previewTarget = target
        child.once('error', error => { if (previewProcess === child) { previewProcess = null; previewTarget = null }; reject(error) })
        child.once('spawn', resolve)
        child.once('exit', code => { if (previewProcess === child) { previewProcess = null; previewTarget = null }; if (code && code !== 0) ztools.showNotification?.('系统快速预览失败，请确认文件仍可访问') })
      })
    },
    /** 单文件正文仍由引擎读取，每次最多 100 处命中和各 3 行上下文，不缓存整篇正文。 */
    async preview(options, target, { signal, isCurrent = () => true } = {}) {
      if (everything) throw new Error('Windows 暂不支持正文预览')
      validPath(target)
      if (!['content', 'symbol'].includes(options.field)) throw new Error('请先切换文件内容或定义搜索')
      const stat = await fs.stat(target)
      if (!stat.isFile()) throw new Error('预览对象不是文件')
      if (stat.size > 10 * 1024 * 1024) throw new Error('文件超过引擎单文件读取上限（10 MB）')
      checkAbort(signal); if (!isCurrent()) throw aborted()
      const response = await request({ op: 'grep', file: target, pattern: options.query, mode: options.field === 'symbol' ? 'symbol' : options.mode, case: options.caseSensitive ? 'sensitive' : 'insensitive', context: 3, per_file: 100 }, { signal })
      if (!Array.isArray(response.files)) throw new Error('正文预览响应无效')
      return { matches: response.files[0]?.matches.map(normalizeMatch) || [], limited: response.files[0]?.matches.length === 100, complete: response.complete }
    },
    async diagnostics() {
      if (everything) return { status: await everything.status() }
      const status = await request({ op: 'status' })
      const config = path.join(os.homedir(), 'Library/Application Support/FSearch/content-skip.txt')
      let skipped = ''
      try {
        const handle = await fs.open(config, 'r')
        try { const buffer = Buffer.alloc(16384); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); skipped = buffer.subarray(0, bytesRead).toString('utf8') } finally { await handle.close() }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      return { status, skipped, config }
    }
  }
}
module.exports = { createHost }
