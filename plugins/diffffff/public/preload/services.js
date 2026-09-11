// 仅暴露插件实际需要的最小桥接能力（FND-007 最小桥接 v1）。
// 原则：不向渲染层暴露 fs/path/electron 原始对象，只提供经过参数校验的最小方法集，
// 全部能力收敛到 window.services 并整体冻结，防止运行时被篡改或无意间扩大暴露面。

const fs = require('node:fs')

// ─── 编码白名单 ────────────────────────────────────────────────────────────
// 键：对外接受的 encoding 入参（小写归一后匹配，'utf8' 是 'utf-8' 的别名）；
// 值：TextDecoder 的编码标签。'utf-16' 统一按 'utf-16le' 解码（Windows 文本导出的
// 事实标准）；'gbk' 依赖 Node/Electron 的 full-icu 构建。
// INT-005：'utf-16be' 仅作为 API 级能力进白名单（TextDecoder 原生支持该标签），
// UI 层编码选择器只暴露 UTF-8 / GBK / UTF-16 三项 —— 大端序文件极少，UI 保持
// 精简；需要精确解码 BE 文件的调用方可直接传 'utf-16be'。
// BOM 策略（INT-005 核实，Node v22 实测）：TextDecoder 对 BOM 敏感编码
// （ignoreBOM 默认 false）在字节流开头命中该编码对应的 BOM 时剥除——
//   utf-8   剥 EF BB BF；GBK 无 BOM 概念，字节原样解码；
//   utf-16le（'utf-16' 的解码标签）剥 FF FE；
//   utf-16be 剥 FE FF —— UTF-16 BE 文件若带 BOM，TextDecoder('utf-16be')
//   按 TextDecoder 标签语义处理：默认剥除，无需手动干预。
const ENCODING_MAP = {
  'utf-8': 'utf-8',
  'utf8': 'utf-8',
  'utf-16': 'utf-16le',
  'utf-16be': 'utf-16be',
  'gbk': 'gbk'
}

// 校验并归一化 encoding 入参：null/undefined/空串视为 'utf-8'（缺省）；
// 不在白名单（忽略大小写）则抛中文错误。返回 TextDecoder 可用的编码标签。
function normalizeEncoding(encoding) {
  if (encoding == null || encoding === '') return ENCODING_MAP['utf-8']
  const label = ENCODING_MAP[String(encoding).toLowerCase()]
  if (!label) {
    throw new Error(
      '不支持的编码格式: ' + encoding + '（仅支持 utf-8 / gbk / utf-16 / utf-16be）'
    )
  }
  return label
}

// 取宿主 API（window.ztools）。preload 环境中由 ZTools 注入；缺失时抛中文错误，
// 避免渲染层拿到晦涩的 "Cannot read properties of undefined" TypeError。
function requireZtools() {
  if (!window.ztools || typeof window.ztools !== 'object') {
    throw new Error('宿主 API（window.ztools）不可用')
  }
  return window.ztools
}

const services = {
  // 读取本地文本文件（同步）。实现为 fs.readFileSync 拿 Buffer 后按白名单编码解码，
  // 而非直接传 encoding 给 fs —— 保证编码入口唯一受控，后续扩展编码只改白名单。
  //   path     文件路径，必须为非空字符串
  //   encoding 文本编码：'utf-8'（默认，接受别名 'utf8'）、'gbk'、'utf-16'
  //            （按 utf-16le 解码）、'utf-16be'（INT-005 API 级能力，UI 不暴露）
  // 返回解码后的文本；BOM 策略见 ENCODING_MAP 上方注释（BOM 敏感编码默认剥除）。
  // 注意：GBK 等编码遇到非法字节序列时 TextDecoder 按标准以 U+FFFD 替换符
  // 呈现、不抛错（乱码可感知，调用方可换编码重读），不在此额外抛错。
  // path 非法、编码不在白名单、或文件不存在/读取失败时抛出
  // 带中文信息的 Error（保留底层原始 message，便于定位 ENOENT 等真实原因）。
  readTextFile(path, encoding) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('读取文件失败: path 必须是非空字符串')
    }
    const label = normalizeEncoding(encoding)
    let buf
    try {
      buf = fs.readFileSync(path)
    } catch (e) {
      throw new Error('读取文件失败: ' + (e && e.message ? e.message : String(e)))
    }
    return new TextDecoder(label).decode(buf)
  },

  // 弹出系统「打开文件」对话框（单选文件）。
  //   filters 可选的文件类型过滤器，如 [{ name: '文本文件', extensions: ['txt'] }]；
  //           需为数组且每项含 name（字符串）与 extensions（字符串数组），否则抛中文错误。
  // 返回所选文件的路径（宿主 showOpenDialog 返回 string[] | undefined，取首个）；
  // 用户取消或未选择时归一化为 null。
  pickOpenFile(filters) {
    if (filters !== undefined) {
      if (!Array.isArray(filters)) {
        throw new Error('filters 必须是数组')
      }
      for (const f of filters) {
        if (!f || typeof f.name !== 'string' || !Array.isArray(f.extensions)) {
          throw new Error('filters 每一项必须包含 name（字符串）与 extensions（字符串数组）')
        }
      }
    }
    const options = { properties: ['openFile'] }
    if (filters !== undefined) options.filters = filters
    const picked = requireZtools().showOpenDialog(options)
    return Array.isArray(picked) && picked.length > 0 ? picked[0] : null
  },

  // 读取系统剪贴板纯文本。经 require('electron').clipboard（f-provider 已证明
  // preload 侧可 require('electron')）；任何失败（宿主未注入 clipboard 等）
  // 都吞掉异常返回空字符串，避免打断渲染层流程。
  readClipboardText() {
    try {
      const { clipboard } = require('electron')
      return clipboard.readText() || ''
    } catch (_) {
      return ''
    }
  }
}

// 仅暴露上述 3 个方法并整体冻结（最小暴露原则）。
window.services = Object.freeze(services)
