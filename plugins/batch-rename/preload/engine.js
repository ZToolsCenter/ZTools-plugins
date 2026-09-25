const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

let lastTransaction = null
let busy = false

function pathKey(value) {
  return process.platform === 'win32' ? value.replaceAll('/', '\\').toLowerCase() : value
}

function nameError(name) {
  if (typeof name !== 'string' || !name.length) return '目标文件名不能为空'
  if (name === '.' || name === '..' || path.basename(name) !== name) return '目标文件名无效'
  if (name.includes('\0') || name.includes('/')) return '目标文件名包含非法字符'
  if (process.platform === 'win32') {
    if (/[<>:"\\|?*\x00-\x1f]/.test(name)) return '目标文件名包含 Windows 非法字符'
    if (/[. ]$/.test(name)) return '目标文件名不能以空格或句点结尾'
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) return '目标文件名是 Windows 保留名称'
  }
  return ''
}

async function statOrNull(filePath) {
  try { return await fs.lstat(filePath) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function prepareItem(intent) {
  const id = typeof intent?.id === 'string' ? intent.id : ''
  const sourcePath = intent?.sourcePath
  const targetName = intent?.targetName
  const item = { id, sourcePath, targetName, targetPath: '', status: 'error', error: '' }
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    item.error = '源文件路径无效'; return item
  }
  item.error = nameError(targetName)
  if (item.error) return item
  item.targetPath = path.join(path.dirname(sourcePath), targetName)
  try {
    const source = await statOrNull(sourcePath)
    if (!source || !source.isFile()) {
      item.error = source ? '仅支持普通文件' : '源文件不存在'; return item
    }
    if (intent.expectedDev !== undefined &&
      (source.dev !== intent.expectedDev || source.ino !== intent.expectedIno)) {
      item.error = '文件已被其他操作替换'; return item
    }
  } catch (error) { item.error = `无法读取源文件：${error.message}`; return item }
  item.status = sourcePath === item.targetPath ? 'unchanged' : 'ready'
  return item
}

function markDuplicateTargets(items) {
  const targetMap = new Map()
  for (const item of items) {
    if (item.status === 'error') continue
    const key = pathKey(item.targetPath)
    const previous = targetMap.get(key)
    if (previous) {
      previous.status = 'error'; previous.error = '同一目录的目标文件名重复'
      item.status = 'error'; item.error = '同一目录的目标文件名重复'
    } else targetMap.set(key, item)
  }
}

async function markOccupiedTargets(items) {
  let changed
  do {
    changed = false
    const moving = new Set(items.filter((item) => item.status === 'ready').map((item) => pathKey(item.sourcePath)))
    for (const item of items) {
      if (item.status !== 'ready' || moving.has(pathKey(item.targetPath))) continue
      try {
        if (await statOrNull(item.targetPath)) {
          item.status = 'error'; item.error = '目标文件已存在'; changed = true
        }
      } catch (error) {
        item.status = 'error'; item.error = `无法检查目标文件：${error.message}`; changed = true
      }
    }
  } while (changed)
}

async function validatePlan(intents) {
  if (!Array.isArray(intents) || intents.length > 10000) throw new Error('改名计划无效')
  const items = []
  for (let index = 0; index < intents.length; index += 64) {
    items.push(...await Promise.all(intents.slice(index, index + 64).map(prepareItem)))
  }
  markDuplicateTargets(items)
  await markOccupiedTargets(items)
  return items
}

function groupsFor(items) {
  const ready = items.filter((item) => item.status === 'ready')
  const bySource = new Map(ready.map((item) => [pathKey(item.sourcePath), item]))
  const seen = new Set()
  const groups = []
  for (const item of ready) {
    if (seen.has(item)) continue
    const group = []
    const queue = [item]
    while (queue.length) {
      const current = queue.pop()
      if (seen.has(current)) continue
      seen.add(current); group.push(current)
      const next = bySource.get(pathKey(current.targetPath))
      if (next && !seen.has(next)) queue.push(next)
    }
    groups.push(group)
  }
  return groups
}

async function tempPath(sourcePath) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = path.join(path.dirname(sourcePath), `.ztools-rename-${randomUUID()}.tmp`)
    if (!await statOrNull(candidate)) return candidate
  }
  throw new Error('无法生成唯一临时文件名')
}

async function locateFile(entry) {
  for (const filePath of [entry.item.sourcePath, entry.item.targetPath, entry.temp]) {
    if (!filePath) continue
    const stats = await statOrNull(filePath).catch(() => null)
    if (stats && stats.dev === entry.stats.dev && stats.ino === entry.stats.ino) return filePath
  }
  return entry.temp || entry.item.sourcePath
}

async function rollback(entries) {
  const failures = []
  for (const entry of entries) {
    if (!entry.targetCreated) continue
    try {
      const stats = await statOrNull(entry.item.targetPath)
      if (stats && stats.dev === entry.stats.dev && stats.ino === entry.stats.ino) {
        await fs.unlink(entry.item.targetPath)
      } else failures.push(`目标文件已变化：${entry.item.targetPath}`)
    } catch (error) { failures.push(`无法清理目标文件：${error.message}`) }
  }
  for (const entry of entries) {
    if (!entry.sourceRemoved) continue
    try { await fs.link(entry.temp, entry.item.sourcePath) } catch (error) {
      failures.push(`无法恢复原文件名：${error.message}`)
    }
  }
  for (const entry of entries) {
    try {
      const restored = await statOrNull(entry.item.sourcePath)
      if (restored && restored.dev === entry.stats.dev && restored.ino === entry.stats.ino) {
        await fs.unlink(entry.temp)
      }
    } catch (error) { failures.push(`无法清理临时文件：${error.message}`) }
  }
  return failures
}

async function runGroup(group) {
  const entries = []
  try {
    for (const item of group) {
      const stats = await fs.lstat(item.sourcePath)
      if (!stats.isFile()) throw new Error(`源文件不再是普通文件：${item.sourcePath}`)
      const temp = await tempPath(item.sourcePath)
      await fs.link(item.sourcePath, temp)
      const linked = await fs.lstat(temp)
      entries.push({ item, stats: linked, temp, sourceRemoved: false, targetCreated: false })
      if (stats.dev !== linked.dev || stats.ino !== linked.ino) throw new Error('源文件在准备期间发生变化')
    }
    for (const entry of entries) {
      const current = await fs.lstat(entry.item.sourcePath)
      if (current.dev !== entry.stats.dev || current.ino !== entry.stats.ino) {
        throw new Error('源文件在执行期间发生变化')
      }
      await fs.unlink(entry.item.sourcePath)
      entry.sourceRemoved = true
    }
    for (const entry of entries) {
      await fs.link(entry.temp, entry.item.targetPath)
      entry.targetCreated = true
    }
    const cleanupWarnings = []
    for (const entry of entries) {
      try { await fs.unlink(entry.temp) } catch (error) {
        cleanupWarnings.push(`临时文件未清理：${entry.temp}（${error.message}）`)
      }
    }
    return entries.map((entry) => ({ ...entry.item, status: 'success',
      actualPath: entry.item.targetPath, dev: entry.stats.dev, ino: entry.stats.ino,
      error: cleanupWarnings.join('；') }))
  } catch (error) {
    const failures = await rollback(entries)
    const entryMap = new Map(entries.map((entry) => [entry.item.id, entry]))
    const results = []
    for (const item of group) {
      const entry = entryMap.get(item.id)
      results.push({ ...item, status: 'error', error: [error.message, ...failures].join('；'),
        actualPath: entry ? await locateFile(entry) : item.sourcePath })
    }
    return results
  }
}

async function executePlan(intents) {
  if (busy) throw new Error('已有文件操作正在执行')
  busy = true
  try {
    const checked = await validatePlan(intents)
    const results = checked.filter((item) => item.status !== 'ready').map((item) => ({ ...item, actualPath: item.sourcePath }))
    for (const group of groupsFor(checked)) results.push(...await runGroup(group))
    const successes = results.filter((item) => item.status === 'success')
    if (successes.length) lastTransaction = successes.map((item) => ({
      id: item.id, beforePath: item.sourcePath, afterPath: item.targetPath,
      expectedDev: item.dev, expectedIno: item.ino
    }))
    return { results, canUndo: Boolean(lastTransaction) }
  } finally { busy = false }
}

async function undo() {
  if (busy) throw new Error('已有文件操作正在执行')
  if (!lastTransaction) return { results: [], canUndo: false }
  const transaction = lastTransaction
  lastTransaction = null
  busy = true
  try {
    const intents = transaction.map((entry) => ({
      id: entry.id, sourcePath: entry.afterPath, targetName: path.basename(entry.beforePath),
      expectedDev: entry.expectedDev, expectedIno: entry.expectedIno
    }))
    const checked = await validatePlan(intents)
    const results = checked.filter((item) => item.status !== 'ready').map((item) => ({ ...item, actualPath: item.sourcePath }))
    for (const group of groupsFor(checked)) results.push(...await runGroup(group))
    return { results, canUndo: false }
  } finally { busy = false }
}

function resetTask() {
  if (busy) throw new Error('文件操作尚未结束')
  lastTransaction = null
}

module.exports = { validatePlan, executePlan, undo, resetTask }
