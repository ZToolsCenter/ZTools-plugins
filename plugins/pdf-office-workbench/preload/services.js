const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PDFDocument } = require('pdf-lib')
const { createFileDragGrantStore } = require('./file-drag-grants.js')

let shell
try {
  shell = require('electron').shell
} catch (_) {
  shell = null
}

const MINIMUM_VERSION = '2.4.0'
const dragGrants = createFileDragGrantStore({ fs, path, requiredExtension: '.pdf' })

function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = value.match(/^\s*v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?\s*$/)
  if (!match) return null
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] || 0)]
  return parts.every(Number.isSafeInteger) ? parts : null
}

function isPrereleaseVersion(value) {
  return typeof value === 'string' && /^\s*v?\d+\.\d+(?:\.\d+)?-/.test(value)
}

function isSupportedHost() {
  const ztools = window.ztools
  if (!ztools) return { version: '', supported: true }
  let getAppVersion
  try { getAppVersion = ztools.getAppVersion } catch (_) { return { version: '', supported: false } }
  if (typeof getAppVersion !== 'function') return { version: '', supported: false }
  let version
  try { version = getAppVersion.call(ztools) } catch (_) { return { version: '', supported: false } }
  const current = parseVersion(version)
  const minimum = parseVersion(MINIMUM_VERSION)
  const atMinimum = Boolean(current && minimum) && current.every((part, index) => part === minimum[index])
  const supported = Boolean(current && minimum) && !(
    atMinimum && isPrereleaseVersion(version)
  ) && (current[0] > minimum[0] || (current[0] === minimum[0] && (current[1] > minimum[1] || (current[1] === minimum[1] && current[2] >= minimum[2]))))
  return { version: typeof version === 'string' ? version : '', supported }
}

function hostPath(name, fallback) {
  try {
    const value = window.ztools?.getPath?.(name)
    if (value) return value
  } catch (_) {
    // Standalone previews do not inject window.ztools.
  }
  return fallback
}

function downloadsDirectory() {
  return hostPath('downloads', path.join(os.homedir(), 'Downloads'))
}

function normalizePaths(value) {
  if (typeof value === 'string') return value ? [value] : []
  if (!Array.isArray(value)) return []
  return value
    .flatMap(item => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return []
      return item.path || item.filePath || item.url || []
    })
    .filter(item => typeof item === 'string' && item.length > 0)
}

function basenameWithoutExtension(filePath) {
  const name = path.basename(String(filePath))
  const extension = path.extname(name)
  return extension ? name.slice(0, -extension.length) : name
}

function sanitizeFileName(value) {
  return String(value || '未命名')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[. ]+$/g, '') || '未命名'
}

function parsePageRanges(expression) {
  const ranges = String(expression ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part)
      if (!match) throw new Error(`无效页码范围：${part}`)
      const start = Number(match[1])
      const end = Number(match[2] || match[1])
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
        throw new Error(`无效页码范围：${part}`)
      }
      return [start, end]
    })
  if (ranges.length === 0) throw new Error('请输入至少一个页码范围')
  return ranges
}

function ensurePdfPath(filePath) {
  const resolved = path.resolve(String(filePath || ''))
  if (!resolved.toLowerCase().endsWith('.pdf')) throw new Error(`仅支持 PDF 文件：${resolved}`)
  if (!fs.existsSync(resolved)) throw new Error(`文件不存在：${resolved}`)
  return resolved
}

async function readPdfInfo(filePath) {
  const resolved = ensurePdfPath(filePath)
  const bytes = fs.readFileSync(resolved)
  const document = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return {
    path: resolved,
    name: path.basename(resolved),
    pages: document.getPageCount(),
    size: bytes.length
  }
}

async function chooseFiles() {
  const selected = await Promise.resolve(window.ztools?.showOpenDialog?.({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
  }))
  const paths = normalizePaths(selected)
  const results = []
  for (const filePath of paths) {
    try {
      results.push(await readPdfInfo(filePath))
    } catch (error) {
      window.ztools?.showNotification?.(error instanceof Error ? error.message : String(error))
    }
  }
  return results
}

async function chooseSavePath(defaultPath) {
  return await Promise.resolve(window.ztools?.showSaveDialog?.({
    defaultPath,
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
  }))
}

async function mergePdfs(paths, outputPath) {
  const sources = normalizePaths(paths).map(ensurePdfPath)
  if (sources.length < 2) throw new Error('至少选择两个 PDF 文件才能合并')
  const output = path.resolve(String(outputPath || ''))
  if (!output.toLowerCase().endsWith('.pdf')) throw new Error('合并输出文件必须是 .pdf')
  if (sources.includes(output)) throw new Error('输出文件不能覆盖输入文件')

  const merged = await PDFDocument.create()
  let totalPages = 0
  for (const source of sources) {
    const document = await PDFDocument.load(fs.readFileSync(source), { ignoreEncryption: true })
    const pages = await merged.copyPages(document, document.getPageIndices())
    pages.forEach(page => merged.addPage(page))
    totalPages += pages.length
  }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, await merged.save())
  dragGrants.grant(output)
  return { path: output, pages: totalPages, size: fs.statSync(output).size }
}

async function splitPdf(sourcePath, expression, outputDirectory) {
  const source = ensurePdfPath(sourcePath)
  const ranges = parsePageRanges(expression)
  const sourceDocument = await PDFDocument.load(fs.readFileSync(source), { ignoreEncryption: true })
  const pageCount = sourceDocument.getPageCount()
  const outputDir = path.resolve(String(outputDirectory || path.join(downloadsDirectory(), 'PDF 办公工坊')))
  fs.mkdirSync(outputDir, { recursive: true })
  const base = basenameWithoutExtension(source)
  const outputs = []

  for (const [start, end] of ranges) {
    if (end > pageCount) throw new Error(`页码 ${start}-${end} 超出文档总页数 ${pageCount}`)
    const document = await PDFDocument.create()
    const pages = await document.copyPages(
      sourceDocument,
      Array.from({ length: end - start + 1 }, (_, offset) => start - 1 + offset)
    )
    pages.forEach(page => document.addPage(page))
    const suffix = start === end ? `p${start}` : `p${start}-${end}`
    const output = path.join(outputDir, `${sanitizeFileName(base)}-${suffix}.pdf`)
    fs.writeFileSync(output, await document.save())
    outputs.push({ path: output, pages: pages.length, size: fs.statSync(output).size })
  }
  outputs.forEach(item => dragGrants.grant(item.path))
  return outputs
}

async function renameFiles(paths, template) {
  const sources = normalizePaths(paths).map(item => path.resolve(item))
  if (!sources.length) throw new Error('请先选择需要重命名的 PDF 文件')
  const pattern = String(template || '{name}-{index}')
  const operations = sources.map((source, index) => {
    const name = basenameWithoutExtension(source)
    const targetName = sanitizeFileName(pattern
      .replace(/\{name\}/g, name)
      .replace(/\{index\}/g, String(index + 1)))
    return { source, target: path.join(path.dirname(source), `${targetName}.pdf`) }
  })
  const targets = new Set()
  for (const operation of operations) {
    if (targets.has(operation.target)) throw new Error(`重命名目标重复：${operation.target}`)
    targets.add(operation.target)
    if (operation.target !== operation.source && fs.existsSync(operation.target) && !sources.includes(operation.target)) {
      throw new Error(`目标文件已存在：${operation.target}`)
    }
  }
  for (const operation of operations) {
    if (operation.source !== operation.target) fs.renameSync(operation.source, operation.target)
  }
  operations.forEach(operation => dragGrants.grant(operation.target))
  return operations.map(operation => ({ path: operation.target, name: path.basename(operation.target) }))
}

const services = {
  chooseFiles,
  chooseSavePath,
  readPdfInfo,
  mergePdfs,
  splitPdf,
  renameFiles,
  getDefaultOutputDirectory() {
    return path.join(downloadsDirectory(), 'PDF 办公工坊')
  },
  reveal(filePath) {
    if (shell?.showItemInFolder) shell.showItemInFolder(filePath)
  },
  hostCompatibility: isSupportedHost,
  canStartDrag() {
    return typeof window.ztools?.startDrag === 'function'
  },
  async startDrag(paths) {
    if (typeof window.ztools?.startDrag !== 'function') throw new Error('请升级到 ZTools 3.2.0 以拖出文件。')
    const values = dragGrants.consume(normalizePaths(paths))
    await Promise.resolve(window.ztools.startDrag(values.length === 1 ? values[0] : values))
  },
  async handlePluginEnter(action) {
    if (!isSupportedHost().supported) return
    const paths = normalizePaths(action?.payload)
    if (!paths.length) return
    const files = []
    for (const filePath of paths) {
      try {
        files.push(await readPdfInfo(filePath))
      } catch (_) {
        // Ignore non-PDF launch payloads and let the user choose files manually.
      }
    }
    if (files.length) window.dispatchEvent(new CustomEvent('pdf-office-enter', { detail: { files, action } }))
  }
}

window.services = services

if (isSupportedHost().supported) {
  window.ztools?.onPluginEnter?.(action => {
    services.handlePluginEnter(action).catch(error => {
      window.ztools?.showNotification?.(error instanceof Error ? error.message : String(error))
    })
  })
}

module.exports = { MINIMUM_VERSION, parseVersion, isSupportedHost, normalizePaths, parsePageRanges, services }
