const fs = require('node:fs')
const path = require('node:path')

const FORMAT_CONFIG = Object.freeze({
  sgf: { extension: '.sgf', name: 'SGF 棋谱' },
  json: { extension: '.json', name: 'JSON 棋谱' },
  txt: { extension: '.txt', name: '文本棋谱' },
})

/**
 * 校验并规范化页面传入的棋谱保存参数。
 * @param {unknown} input 页面提交的参数。
 * @returns {{format: 'sgf' | 'json' | 'txt', suggestedName: string, text: string}} 安全的保存参数。
 * @throws 参数类型、文件名或内容不合法时抛出错误。
 */
function normalizeSaveInput(input) {
  if (!input || typeof input !== 'object') throw new Error('棋谱保存参数无效')
  const { format, suggestedName, text } = input
  if (!Object.prototype.hasOwnProperty.call(FORMAT_CONFIG, format)) {
    throw new Error('不支持的棋谱格式')
  }
  if (typeof suggestedName !== 'string' || !suggestedName.trim()) {
    throw new Error('请输入有效的文件名')
  }
  if (typeof text !== 'string' || text.length === 0 || text.length > 2 * 1024 * 1024) {
    throw new Error('棋谱内容为空或超过 2 MB')
  }

  const cleanName = path.basename(suggestedName.trim()).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
  if (!cleanName) throw new Error('请输入有效的文件名')
  return { format, suggestedName: cleanName.slice(0, 160), text }
}

/**
 * 使用宿主保存对话框选择目标文件，并写入 UTF-8 棋谱。
 * @param {unknown} input 页面提交的保存参数。
 * @returns {{cancelled: boolean, path?: string}} 保存结果。
 * @throws 宿主能力不可用或写入失败时抛出错误。
 */
function saveTextFile(input) {
  const normalized = normalizeSaveInput(input)
  const config = FORMAT_CONFIG[normalized.format]
  const ztools = globalThis.ztools || globalThis.window?.ztools
  if (!ztools || typeof ztools.showSaveDialog !== 'function') {
    throw new Error('当前环境不支持系统保存对话框')
  }

  let selectedPath = ztools.showSaveDialog({
    title: '导出五子棋棋谱',
    defaultPath: normalized.suggestedName,
    filters: [{ name: config.name, extensions: [config.extension.slice(1)] }],
  })
  if (!selectedPath) return { cancelled: true }
  if (path.extname(selectedPath).toLowerCase() !== config.extension) {
    selectedPath += config.extension
  }
  fs.writeFileSync(selectedPath, normalized.text, 'utf8')
  return { cancelled: false, path: selectedPath }
}

window.gomokuBridge = Object.freeze({ saveTextFile })
