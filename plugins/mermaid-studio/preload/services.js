const fs = require('node:fs')
const path = require('node:path')

/** 导出格式白名单：扩展名 -> MIME 前缀 */
const FORMATS = {
  png: 'image/png',
  svg: 'image/svg+xml',
  pdf: 'application/pdf'
}

/** 单次写入的体积上限（字节），防止误传超大内容 */
const MAX_BYTES = 64 * 1024 * 1024

/** 默认配置；新增字段必须在这里给出明确默认值 */
const DEFAULT_SETTINGS = {
  theme: 'default',
  layout: 'split',
  exportScale: 2,
  autoSave: true
}

const SETTINGS_KEY = 'settings'

/** 主题与布局白名单 */
const THEMES = ['default', 'dark', 'forest', 'neutral']
const LAYOUTS = ['split', 'editor', 'preview']
const SCALES = [1, 2, 3, 4]

/**
 * 把任意对象收敛为合法配置。
 * @param {object} source 待规范化的配置
 * @returns {{theme: string, layout: string, exportScale: number, autoSave: boolean}} 合法配置
 */
function normalizeSettings(source) {
  const input = source && typeof source === 'object' ? source : {}
  const scale = Number(input.exportScale)
  return {
    theme: THEMES.includes(input.theme) ? input.theme : DEFAULT_SETTINGS.theme,
    layout: LAYOUTS.includes(input.layout) ? input.layout : DEFAULT_SETTINGS.layout,
    exportScale: SCALES.includes(scale) ? scale : DEFAULT_SETTINGS.exportScale,
    autoSave: typeof input.autoSave === 'boolean' ? input.autoSave : DEFAULT_SETTINGS.autoSave
  }
}

/**
 * 读取并规范化配置，过滤未知值。
 * @returns {{theme: string, layout: string, exportScale: number, autoSave: boolean}} 合法配置
 */
function readSettings() {
  let raw = null
  try {
    raw = window.ztools.dbStorage.getItem(SETTINGS_KEY)
  } catch (error) {
    raw = null
  }
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch (error) {
      raw = null
    }
  }
  return normalizeSettings(raw)
}

/**
 * 保存配置，仅保留已声明的字段。
 * @param {object} patch 需要更新的配置片段
 * @returns {{theme: string, layout: string, exportScale: number, autoSave: boolean}} 保存后的配置
 */
function writeSettings(patch) {
  const next = readSettings()
  if (patch && typeof patch === 'object') {
    if (typeof patch.theme === 'string') next.theme = patch.theme
    if (typeof patch.layout === 'string') next.layout = patch.layout
    if (patch.exportScale !== undefined) next.exportScale = Number(patch.exportScale)
    if (typeof patch.autoSave === 'boolean') next.autoSave = patch.autoSave
  }
  const normalized = normalizeSettings(next)
  window.ztools.dbStorage.setItem(SETTINGS_KEY, normalized)
  return normalized
}

/**
 * 校验并解码 base64 内容。
 * @param {string} base64 纯 base64 字符串
 * @returns {Buffer} 解码后的二进制内容
 */
function decodeBase64(base64) {
  if (typeof base64 !== 'string' || !base64.trim()) {
    throw new Error('导出内容为空')
  }
  const buffer = Buffer.from(base64, 'base64')
  if (!buffer.length) {
    throw new Error('导出内容无法解码')
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error(`导出内容超过 ${Math.round(MAX_BYTES / 1024 / 1024)}MB 上限`)
  }
  return buffer
}

/**
 * 规范化导出文件名，避免路径穿越并补全扩展名。
 * @param {string} name 用户可见文件名
 * @param {string} format 导出格式（png/svg/pdf）
 * @returns {string} 安全的文件名
 */
function safeFileName(name, format) {
  const ext = `.${format}`
  const base = String(name || '')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\.(png|svg|pdf)$/i, '')
    .replace(/^\.+/, '')
    .trim()
  const fallback = `mermaid-${Date.now()}`
  return `${base || fallback}${ext}`
}

/**
 * 把导出的图表内容写入用户选择的位置。
 * 未指定目标时默认保存到系统下载目录。
 * @param {{format: string, base64: string, fileName?: string, saveAs?: boolean}} request 导出请求
 * @returns {Promise<{saved: boolean, filePath?: string}>} 保存结果；用户取消时 saved 为 false
 */
async function saveFile(request) {
  const format = String(request && request.format || '').toLowerCase()
  if (!FORMATS[format]) {
    throw new Error('不支持的导出格式')
  }
  const buffer = decodeBase64(request && request.base64)
  const fileName = safeFileName(request && request.fileName, format)

  // 默认直接写入下载目录，避免每次导出都弹窗打断操作
  if (!request || !request.saveAs) {
    const dir = window.ztools.getPath('downloads')
    const filePath = path.join(dir, fileName)
    fs.writeFileSync(filePath, buffer)
    return { saved: true, filePath }
  }

  const result = await window.ztools.showSaveDialog({
    title: '保存图表',
    defaultPath: fileName,
    filters: [
      { name: format.toUpperCase(), extensions: [format] },
      { name: '全部文件', extensions: ['*'] }
    ]
  })
  if (!result || result.canceled || !result.filePath) {
    return { saved: false }
  }
  fs.writeFileSync(result.filePath, buffer)
  return { saved: true, filePath: result.filePath }
}

// 只暴露插件实际需要的最小能力
window.mermaidStudio = Object.freeze({
  saveFile,
  readSettings,
  writeSettings
})
