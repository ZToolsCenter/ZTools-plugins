const fs = require('node:fs/promises')
const { checkAbort } = require('./latest.cjs')
const os = require('node:os')
const path = require('node:path')

/** 纯路径展开，不在查询编译或页面线程中同步访问磁盘。 */
function directoryPath(value) {
  if (typeof value !== 'string') throw new Error('目录必须是文本')
  const expanded = value === '~' ? os.homedir() : value.startsWith('~/') || (process.platform === 'win32' && value.startsWith('~\\')) ? path.join(os.homedir(), value.slice(2)) : value
  if (!path.isAbsolute(expanded)) throw new Error('请输入绝对目录路径，或以 ~/ 开头的路径')
  return path.resolve(expanded)
}

/** 每次有效查询异步验证目录；不缓存文件系统状态，失效/无权限不能静默退回全盘。 */
async function resolveDirectories(options, { signal, io = fs } = {}) {
  checkAbort(signal)
  async function resolve(value, required) {
    const expanded = directoryPath(value)
    try {
      if (required) {
        const stat = await io.stat(expanded); checkAbort(signal)
        if (!stat.isDirectory()) throw new Error('搜索位置必须是文件夹')
      }
      const real = await io.realpath(expanded); checkAbort(signal); return real
    } catch (error) {
      checkAbort(signal)
      if (!required && error.code === 'ENOENT') return expanded
      throw new Error('无法访问搜索目录：' + error.message)
    }
  }
  const output = { ...options }
  if (options.file) {
    const target = directoryPath(options.file), stat = await io.stat(target); checkAbort(signal)
    if (!stat.isFile()) throw new Error('正文搜索对象不是文件')
    if (stat.size > 10 * 1024 * 1024) throw new Error('文件超过引擎单文件读取上限（10 MB）')
    output.file = await io.realpath(target); checkAbort(signal)
  }
  if (options.directory) output.directory = await resolve(options.directory, true)
  const excluded = (options.exclude || '').split('\n').map(s => s.trim()).filter(Boolean)
  if (excluded.length > 20) throw new Error('最多排除 20 个目录')
  const real = []
  // 顺序读取至多 20 个目录，避免一次提交过多文件系统任务。
  for (const value of excluded) { checkAbort(signal); real.push(await resolve(value, false)) }
  output.exclude = real.join('\n')
  checkAbort(signal); return output
}

/** 筛选在服务分页之前执行；分类与用户扩展名取交集，不能被扩展名条件扩大。 */
function applyFilters(payload, options, category, content) {
  const { extensions = '', modified = '', size = '', exclude = '', directory = '', git = '', boost = false } = options
  if (typeof extensions !== 'string' || typeof exclude !== 'string') throw new Error('扩展名和排除目录必须是文本')
  const userExts = extensions.toLowerCase().split(/[,，\s]+/).filter(Boolean).map(s => s.replace(/^\./, ''))
  if (userExts.length > 30 || userExts.some(s => !/^[a-z0-9_+-]+$/.test(s))) throw new Error('扩展名请用逗号分隔，如 txt,md,py（最多 30 种）')
  const base = (content ? category.contentExt || category.ext : category.ext)?.split(',')
  const exts = userExts.length && base ? base.filter(s => userExts.includes(s)) : userExts.length ? userExts : base
  if (exts) {
    // 空交集显式返回无结果，不能把空 ext 发成“所有类型”。
    if (!exts.length) return false
    payload.ext = exts.join(',')
    payload.kind = 'file'
  }
  if (modified) {
    if (!['<1d', '<7d', '<30d', '<90d', '>1y'].includes(modified)) throw new Error('未知的修改时间条件')
    payload.mtime = modified
  }
  if (size) {
    if (!/^(?:[<>]=?)?\d+(?:\.\d+)?(?:b|kb|mb|gb|tb)?(?:\.\.\d+(?:\.\d+)?(?:b|kb|mb|gb|tb)?)?$/i.test(size)) throw new Error('大小格式示例：>100mb、<1mb、1mb..10mb')
    if (size.includes('..') && /^[<>]/.test(size)) throw new Error('大小范围不能同时使用比较符')
    payload.size = size
  }
  if (directory) payload.in = directoryPath(directory)
  const excluded = exclude.split('\n').map(s => s.trim()).filter(Boolean)
  if (excluded.length > 20) throw new Error('最多排除 20 个目录')
  for (const value of excluded) {
    // 引擎 q 支持带引号的目录 glob，保留正文原生 cursor 分支；不使用前端过滤。
    const absolute = directoryPath(value, false)
    if (absolute === '/') return false
    if (/["*?\[\]{}\n\r]/.test(absolute)) throw new Error('排除目录不能含引号或 glob 元字符')
    payload.q += ` "!${absolute === '/' ? '' : absolute}/"`
  }
  if (git) {
    if (!['modified', 'staged', 'untracked', 'clean', 'tracked', 'ignored', 'conflict'].includes(git)) throw new Error('未知的 Git 状态')
    if (!directory) throw new Error('Git 筛选需要先指定项目目录')
    payload.q += ` git:${git}`
    if (!content) payload.git = true
  }
  if (!content && boost) payload.boost = true
  return true
}
module.exports = { applyFilters, directoryPath, resolveDirectories }
