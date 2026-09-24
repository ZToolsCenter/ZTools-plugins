import type {
  McpCanvasOverview,
  McpEditorGateway,
  McpEditorGatewayProvider,
  McpPatternFillRequest,
  McpUpdateTextRequest
} from './mcpGatewayTypes'
import { isSupportedColorString } from '../documentStyleMeta'
import {
  BITMAP_FILTER_TYPES,
  normalizeBlendMode,
  normalizeBitmapFilterSetting,
  type BitmapFilterSetting
} from '../bitmapFilters'

/**
 * MCP 工具调用的统一响应。
 * ok=false 时 message 携带面向 AI 的可读错误说明。
 */
export interface McpToolResponse<T = unknown> {
  ok: boolean
  message?: string
  data?: T
}

/**
 * 单条操作定义。operation 字符串即 MCP 参数中的命令名，
 * handler 从编辑器网关执行具体动作并返回需要回传给 AI 的数据。
 */
type McpOperationHandler = (
  gateway: McpEditorGateway,
  args: Record<string, unknown>
) => unknown | Promise<unknown>

interface McpOperation {
  description: string
  handler: McpOperationHandler
}

/** 读取参数中的可选数字，非法或缺失返回 undefined。 */
function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 读取参数中的可选布尔，仅接受真实布尔值。 */
function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** 读取参数中的可选字符串，空白视为缺失。 */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/** 读取参数中的可选字符串数组，逐项过滤空白。 */
function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim())
  return list.length ? list : undefined
}

/** 读取参数中的可选属性对象（值可为任意 JSON 类型）。 */
function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** 读取参数中的可选对象数组（条目须为普通对象），供批量创建条目解析使用。 */
function optionalRecordArray(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter(
    (item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)
  )
}

/** 读取参数中的可选数字数组（接受数字或纯数字字符串），空数组视为缺失。 */
function optionalNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value
    .map((item) => (typeof item === 'string' && item.trim() !== '' ? Number(item.trim()) : item))
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
  return list.length ? list : undefined
}

/** 校验可选的位图导出格式，仅接受 png/webp，非法值抛错。 */
function optionalImageFormat(value: unknown): 'png' | 'webp' | undefined {
  const format = optionalString(value)
  if (format === undefined) return undefined
  if (format !== 'png' && format !== 'webp') throw new Error('format 必须是 png 或 webp')
  return format
}

/**
 * 校验可选的创建定位锚点，仅接受 center/top-left，非法值抛错。
 * center 表示 x/y 为对象包围盒中心点（默认），top-left 表示 x/y 为包围盒左上角。
 */
function optionalAnchor(value: unknown): 'center' | 'top-left' | undefined {
  const anchor = optionalString(value)
  if (anchor === undefined) return undefined
  if (anchor !== 'center' && anchor !== 'top-left') throw new Error('anchor 必须是 center 或 top-left')
  return anchor
}

/** 校验可选的编码质量（0-1，仅对 webp 生效），缺省返回 undefined。 */
function optionalQuality(value: unknown): number | undefined {
  const quality = optionalNumber(value)
  if (quality === undefined) return undefined
  if (quality < 0 || quality > 1) throw new Error('quality 取值范围 0-1')
  return quality
}

/**
 * 归一化单条位图滤镜设置（apply_image_filter 的 filters 条目）：
 * type 必填且仅接受受支持的 7 种滤镜；enabled 缺省视为启用；
 * 数值参数由 normalizeBitmapFilterSetting 收敛到各自合法区间（越界截断不报错）。
 */
function parseBitmapFilterSetting(raw: unknown, index: number): BitmapFilterSetting {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`filters[${index}] 必须是对象`)
  }
  const entry = raw as Record<string, unknown>
  const type = optionalString(entry.type)
  if (!type || !BITMAP_FILTER_TYPES.includes(type as BitmapFilterSetting['type'])) {
    throw new Error(`filters[${index}].type 必须是 ${BITMAP_FILTER_TYPES.join('/')} 之一`)
  }
  return normalizeBitmapFilterSetting({ ...entry, type })!
}

/** 校验可选的输出目录（必须为绝对路径：盘符、UNC 或 POSIX 根），非法值抛错。 */
function optionalOutputDir(value: unknown): string | undefined {
  const dir = optionalString(value)
  if (dir === undefined) return undefined
  if (!/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(dir)) throw new Error(`outputDir 必须是绝对目录路径（如 D:\\exports 或 /Users/me/exports）: ${dir}`)
  return dir
}

/** 校验可选的输出文件路径（必须为绝对路径：盘符、UNC 或 POSIX 根），非法值抛错。 */
function optionalOutputPath(value: unknown): string | undefined {
  const filePath = optionalString(value)
  if (filePath === undefined) return undefined
  if (!/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(filePath)) {
    throw new Error(`outputPath 必须是绝对文件路径（如 D:\\icons\\thumb.png 或 /tmp/thumb.png）: ${filePath}`)
  }
  return filePath
}

/** 文本数值字段的合法区间：字号 6-500、字间距 -200~800（千分之一 em）、行高 0.5-3。 */
const UPDATE_TEXT_NUMBER_RANGES: Record<'fontSize' | 'charSpacing' | 'lineHeight', { min: number; max: number }> = {
  fontSize: { min: 6, max: 500 },
  charSpacing: { min: -200, max: 800 },
  lineHeight: { min: 0.5, max: 3 }
}

/**
 * 解析 update_text 的更新字段（纯字符串/数字校验，不引入 fabric 依赖，
 * 文本对象类型校验由网关层完成）：数值字段越界或枚举非法时抛中文错误；
 * 未提供任何合法字段时返回 undefined，由调用方报"至少提供一项"。
 */
function parseUpdateTextRequest(args: Record<string, unknown>): McpUpdateTextRequest | undefined {
  const request: McpUpdateTextRequest = {}
  const text = optionalString(args.text)
  if (text !== undefined) request.text = text
  const fontFamily = optionalString(args.fontFamily)
  if (fontFamily !== undefined) request.fontFamily = fontFamily
  for (const key of ['fontSize', 'charSpacing', 'lineHeight'] as const) {
    const value = optionalNumber(args[key])
    if (value === undefined) continue
    const range = UPDATE_TEXT_NUMBER_RANGES[key]
    if (value < range.min || value > range.max) {
      throw new Error(`${key} 取值范围 ${range.min}-${range.max}`)
    }
    request[key] = value
  }
  if (args.fontWeight !== undefined && args.fontWeight !== null) {
    const raw = args.fontWeight
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      if (raw < 100 || raw > 900) throw new Error('fontWeight 数字取值范围 100-900')
      request.fontWeight = raw
    } else if (raw === 'normal' || raw === 'bold') {
      request.fontWeight = raw
    } else {
      throw new Error('fontWeight 必须是 normal/bold 或 100-900 的数字')
    }
  }
  const fontStyle = optionalString(args.fontStyle)
  if (fontStyle !== undefined) {
    if (fontStyle !== 'normal' && fontStyle !== 'italic') throw new Error('fontStyle 必须是 normal 或 italic')
    request.fontStyle = fontStyle
  }
  const textAlign = optionalString(args.textAlign)
  if (textAlign !== undefined) {
    if (textAlign !== 'left' && textAlign !== 'center' && textAlign !== 'right' && textAlign !== 'justify') {
      throw new Error('textAlign 必须是 left/center/right/justify 之一')
    }
    request.textAlign = textAlign
  }
  const underline = optionalBoolean(args.underline)
  if (underline !== undefined) request.underline = underline
  const linethrough = optionalBoolean(args.linethrough)
  if (linethrough !== undefined) request.linethrough = linethrough
  return Object.keys(request).length ? request : undefined
}

/** 创建类条目支持的初始样式字段集合（键名固定，值类型保持 unknown 原样透传）。 */
type CreateStyleFields = Partial<Record<'fill' | 'stroke' | 'strokeWidth' | 'cornerRadius' | 'opacity' | 'shadow', unknown>>

/**
 * 从创建类入参（add_shape / insert_svg / create_objects 条目）中收集初始样式字段：
 * 值原样透传、不在此解析（styleValueParser 依赖 fabric，禁止在调度层引入以免破坏
 * Node 测试链路，样式合法性由网关层 applyPropsToObject 内的归一化校验兜底）；
 * undefined/null 视为未提供，与"省略字段"语义一致。
 */
function collectCreateStyleFields(source: Record<string, unknown>): CreateStyleFields {
  const style: CreateStyleFields = {}
  for (const field of ['fill', 'stroke', 'strokeWidth', 'cornerRadius', 'opacity', 'shadow'] as const) {
    const value = source[field]
    if (value !== undefined && value !== null) style[field] = value
  }
  return style
}

/**
 * 解析 set_guides 的 guides 参数：每条须为 { orientation, position }。
 * orientation 枚举校验、position 必须为有限数字；整体替换语义允许空数组（等价清空）。
 */
function parseGuideInputs(value: unknown): Array<{ orientation: 'horizontal' | 'vertical'; position: number }> {
  if (!Array.isArray(value)) throw new Error('guides 必须是数组（可为空数组表示清空全部参考线）')
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`guides[${index}] 必须是包含 orientation 与 position 的对象`)
    }
    const entry = raw as Record<string, unknown>
    const orientation = optionalString(entry.orientation)
    if (orientation !== 'horizontal' && orientation !== 'vertical') {
      throw new Error(`guides[${index}].orientation 必须是 horizontal 或 vertical`)
    }
    const position = optionalNumber(entry.position)
    if (position === undefined) {
      throw new Error(`guides[${index}].position 必须是数字（画布坐标系像素）`)
    }
    return { orientation, position }
  })
}

/** 校验 replace_color 的颜色参数：接受 hex/rgb()/rgba() 与 transparent 关键字，非法抛中文错误。 */
function parseReplaceColorValue(value: string, label: 'from' | 'to'): string {
  if (value.trim().toLowerCase() === 'transparent') return 'transparent'
  if (isSupportedColorString(value)) return value
  throw new Error(`${label} 非法: ${value}。支持 hex（如 #f00/#ff0000/#ff000080）或 rgb()/rgba() 表达式或 transparent`)
}

/**
 * 全部可用操作。operation 名称是稳定契约，新增能力只增不改，
 * 避免已经编排好的 AI 工作流因改名而失效。
 */
const OPERATIONS: Record<string, McpOperation> = {
  /* ── 查询 ── */
  get_overview: {
    description: '获取画布与文档概览：尺寸、背景、缩放、网格、参考线、对象数、选区、历史状态。',
    handler: (gateway) => gateway.getOverview()
  },
  list_objects: {
    description: '列出全部对象摘要（id、名称、类型、位置、尺寸、层级、样式状态）。',
    handler: (gateway) => ({ objects: gateway.listObjects() })
  },
  get_object: {
    description: '按对象 id 读取单个对象摘要，未找到时 ok=false。',
    handler: (gateway, args) => {
      const id = optionalString(args.objectId ?? args.id)
      if (!id) throw new Error('缺少 objectId 参数')
      const summary = gateway.getObjectSummary(id)
      if (!summary) throw new Error(`未找到对象: ${id}`)
      return summary
    }
  },
  find_objects: {
    description: '按条件查找对象并返回匹配摘要数组（只读查询，不改变画布与选区）。条件字段 name/type/fill 至少提供一个：name 为图层名匹配串，配合 nameMatch 指定匹配方式——prefix 为区分大小写的前缀匹配（默认），exact 为全等匹配；type 为对象类型全等匹配（与摘要 type 一致，如 rectangle/path/group）；fill 为纯色填充匹配（忽略大小写，比较的是色板解析后的实际色值而非 swatch 名，渐变填充对象与无填充对象不参与该条件）。返回 { objects: 匹配摘要数组, count: 数量 }；无匹配不是错误，count 为 0 并携带 message 说明已用条件。长会话中建议按命名约定（如 name=\'lbar-\'）一次召回一组对象 id，再交给 select_objects / batch_set_props 等操作使用。',
    handler: (gateway, args) => {
      const name = optionalString(args.name)
      const type = optionalString(args.type)
      const fill = optionalString(args.fill)
      if (!name && type === undefined && fill === undefined) throw new Error('至少提供 name/type/fill 之一')
      const nameMatchValue = optionalString(args.nameMatch)
      let nameMatch: 'prefix' | 'exact' = 'prefix'
      if (nameMatchValue === 'prefix' || nameMatchValue === 'exact') {
        nameMatch = nameMatchValue
      } else if (nameMatchValue !== undefined) {
        throw new Error('nameMatch 必须是 prefix 或 exact')
      }
      const matched = gateway.listObjects().filter((summary) => {
        if (name !== undefined && (nameMatch === 'exact' ? summary.name !== name : !summary.name.startsWith(name))) return false
        if (type !== undefined && summary.type !== type) return false
        // fill 仅与纯色字符串摘要比较（忽略大小写）；渐变摘要与无填充（null）不参与匹配
        if (fill !== undefined && (typeof summary.fill !== 'string' || summary.fill.toLowerCase() !== fill.toLowerCase())) return false
        return true
      })
      if (!matched.length) {
        // 空结果不是错误，但显式带 message 说明条件，避免调用方把"没找到"误解为静默失败
        const conditions = [
          ...(name !== undefined ? [`name ${nameMatch === 'exact' ? '全等' : '前缀'} "${name}"`] : []),
          ...(type !== undefined ? [`type "${type}"`] : []),
          ...(fill !== undefined ? [`fill "${fill}"`] : [])
        ]
        return { objects: matched, count: 0, message: `未找到匹配对象（条件：${conditions.join('、')}）` }
      }
      return { objects: matched, count: matched.length }
    }
  },
  get_selection: {
    description: '读取当前选中对象的 id 列表与属性摘要。',
    handler: (gateway) => ({
      ids: gateway.getSelectionIds(),
      props: gateway.getActiveObjectProps()
    })
  },
  get_selection_svg: {
    description: '导出当前选中对象为 SVG 文本（未选中时导出整块画布）。',
    handler: (gateway) => gateway.getSelectionSvg().then((svg) => ({ svg }))
  },
  list_artboards: {
    description: '列出全部画板（id、名称、尺寸、对象数、是否激活）。',
    handler: (gateway) => ({ artboards: gateway.listArtboards() })
  },
  list_history: {
    description: '列出撤销历史记录（描述与时间戳）。',
    handler: (gateway) => ({ history: gateway.listHistory() })
  },
  list_swatches: {
    description: '列出文档级命名色板（name/color）。随工程保存与撤销历史持久化；fill/stroke 等样式值可用 "swatch:名字" 引用色板颜色。',
    handler: (gateway) => gateway.listSwatches()
  },
  list_snapshots: {
    description: '列出全部命名画布快照（name、createdAt 毫秒时间戳、objectCount 顶层对象数）。快照保存当前画布完整视觉状态（不含色板/样式预设等文档级元数据），随工程保存持久化；可用 restore_snapshot 恢复、delete_snapshot 删除，数量上限 20 个。',
    handler: (gateway) => gateway.listSnapshots()
  },

  /* ── 色板 ── */
  add_swatch: {
    description: '添加（或按名称覆盖）文档级命名色板：name 必填（非空字符串，与已有同名色板重复时覆盖其颜色），color 必填（hex 如 #ff0000/#ffffffff 或 rgb()/rgba() 表达式，非法报错）。色板随工程保存与撤销历史持久化，fill/stroke 可用 "swatch:名字" 引用。返回更新后的完整色板列表。',
    handler: (gateway, args) => {
      const name = optionalString(args.name)
      const color = optionalString(args.color)
      if (!name) throw new Error('缺少 name 参数')
      if (!color) throw new Error('缺少 color 参数')
      if (!isSupportedColorString(color)) {
        throw new Error(`color 非法: ${color}。支持 hex（如 #f00/#ff0000/#ff000080）或 rgb()/rgba() 表达式`)
      }
      return gateway.addSwatch(name, color)
    }
  },
  remove_swatch: {
    description: '删除指定名称的文档级色板条目：name 必填，不存在时报错。返回剩余色板列表。',
    handler: (gateway, args) => {
      const name = optionalString(args.name)
      if (!name) throw new Error('缺少 name 参数')
      return gateway.removeSwatch(name)
    }
  },

  /* ── 画布设置 ── */
  resize_canvas: {
    description: '调整画布尺寸（width/height 单位像素，均可选）。',
    handler: (gateway, args) => {
      const width = optionalNumber(args.width)
      const height = optionalNumber(args.height)
      if (width === undefined && height === undefined) throw new Error('至少提供 width 或 height 之一')
      if (width !== undefined && (width < 1 || width > 4096)) throw new Error('width 取值范围 1-4096')
      if (height !== undefined && (height < 1 || height > 4096)) throw new Error('height 取值范围 1-4096')
      gateway.resizeCanvas(width, height)
      return gateway.getOverview()
    }
  },
  set_canvas_background: {
    description: "设置画布背景色，支持 hex/rgb/'transparent'。",
    handler: (gateway, args) => {
      const color = optionalString(args.color)
      if (!color) throw new Error('缺少 color 参数')
      gateway.setCanvasBackground(color)
      return gateway.getOverview()
    }
  },
  set_pixel_grid: {
    description: '配置像素网格：visible 显示开关、snap 吸附开关、size 网格尺寸。',
    handler: (gateway, args) => {
      const visible = optionalBoolean(args.visible)
      const snap = optionalBoolean(args.snap)
      const size = optionalNumber(args.size)
      if (visible === undefined && snap === undefined && size === undefined) {
        throw new Error('至少提供 visible / snap / size 之一')
      }
      gateway.setPixelGrid({ visible, snap, size })
      return gateway.getOverview()
    }
  },
  set_keyline: {
    description: '配置图标参考线：template 取值 none/material/ios/favicon/custom，margin 为安全边距。（这是 Keyline 安全区模板 overlay，与用户从标尺拖出的对齐参考线 list_guides/set_guides/clear_guides 是两套独立系统。）',
    handler: (gateway, args) => {
      const template = optionalString(args.template)
      const margin = optionalNumber(args.margin)
      if (!template && margin === undefined) throw new Error('至少提供 template 或 margin 之一')
      gateway.setKeyline({ template, margin })
      return gateway.getOverview()
    }
  },

  /* ── 对齐参考线（用户参考线）── */
  list_guides: {
    description: '列出当前文档的对齐参考线（用户从标尺拖出的辅助线，与 set_keyline 的 Keyline 安全区模板无关）。每条形如 { id, orientation: \'horizontal\'|\'vertical\', position }，position 为画布坐标系像素（水平线为 y、垂直线为 x）。参考线随工程保存与撤销历史持久化。',
    handler: (gateway) => gateway.listGuides()
  },
  set_guides: {
    description: '整体替换当前文档的对齐参考线：guides 必填为数组（传空数组等价清空），每条 { orientation: \'horizontal\'|\'vertical\', position: 数字 }，position 为画布坐标系像素。position 越界（负值或超出画布）时自动夹取到画布范围内（选夹取而非报错，保证每条参考线都可见可再编辑），返回夹取后的完整列表（含生成的 id）。整个操作合并为一条撤销记录。',
    handler: (gateway, args) => {
      if (args.guides === undefined || args.guides === null) throw new Error('缺少 guides 参数（参考线数组，可为空数组）')
      return gateway.setGuides(parseGuideInputs(args.guides))
    }
  },
  clear_guides: {
    description: '清空当前文档的全部对齐参考线（一条撤销记录），返回空列表。',
    handler: (gateway) => gateway.clearGuides()
  },
  replace_color: {
    description: '全局颜色替换：扫描全部对象的 fill/stroke 与渐变色标，把等于 from 的颜色整体替换为 to。颜色写法简并比较（#f00/#ff0000/rgb(255,0,0)/rgba(255,0,0,1) 视为同色，大小写不敏感；支持 hex/rgb()/rgba() 与 transparent）。整个操作合并为一条撤销记录，返回 { replacedObjects 替换对象数, replacedSlots 颜色槽位数, from, to（归一化 hex） }；没有匹配颜色时 replacedObjects 为 0 且不产生撤销记录。',
    handler: (gateway, args) => {
      const from = optionalString(args.from)
      const to = optionalString(args.to)
      if (!from) throw new Error('缺少 from 参数（被替换的源颜色）')
      if (!to) throw new Error('缺少 to 参数（替换后的目标颜色）')
      return gateway.replaceColor(parseReplaceColorValue(from, 'from'), parseReplaceColorValue(to, 'to'))
    }
  },

  /* ── 组件/符号（Symbol）── */
  define_symbol: {
    description: '从画布现有对象创建文档级符号定义（可复用组件）：name 必填（非空字符串），objectIds 必填（非空字符串数组，画布上已存在的对象 id）。定义内容按包围盒左上角归一化存储，画布原对象保持不变（不会自动转为实例）；之后可用 insert_symbol_instance 反复插入联动实例。整个操作合并为一条撤销记录，返回符号摘要（id/name/objectCount/instanceCount）。',
    handler: (gateway, args) => {
      const name = optionalString(args.name)
      if (!name) throw new Error('缺少 name 参数')
      const objectIds = optionalStringArray(args.objectIds)
      if (!objectIds) throw new Error('缺少 objectIds 参数（非空字符串数组，画布上已存在的对象 id）')
      return gateway.defineSymbol(name, objectIds)
    }
  },
  list_symbols: {
    description: '列出当前文档的全部符号定义：每条含 id、name、createdAt（毫秒时间戳）、objectCount（定义内对象数）与 instanceCount（画布上引用此定义的实时实例数）。符号定义随工程保存与撤销历史持久化；可用 insert_symbol_instance 插入实例、update_symbol 更新定义、detach_symbol_instance 解除实例关联。',
    handler: (gateway) => gateway.listSymbols()
  },
  insert_symbol_instance: {
    description: '插入符号定义的一个联动实例（实例为一个 fabric Group，整体移动/缩放/旋转）：symbolId 必填（list_symbols 查询，不存在报错）。x/y 为实例包围盒中心点（默认 anchor=\'center\'，省略 x/y 时定位不生效、落画布中心），anchor=\'top-left\' 时 x/y 为包围盒左上角。实例携带 symbolId/symbolInstanceId 元数据并随工程保存；更新定义时全部实例按新定义重建并保持各自位置/尺寸/角度。返回 { objectId, symbolId, symbolInstanceId }。',
    handler: async (gateway, args) => {
      const symbolId = optionalString(args.symbolId)
      if (!symbolId) throw new Error('缺少 symbolId 参数')
      return gateway.insertSymbolInstance(symbolId, {
        x: optionalNumber(args.x),
        y: optionalNumber(args.y),
        anchor: optionalAnchor(args.anchor)
      })
    }
  },
  update_symbol: {
    description: '用画布现有对象重写指定符号定义，并同步全部实例：symbolId 与 objectIds 均必填。全部实例按新定义重建，保持各自此前的包围盒中心、显示尺寸与旋转角（新定义内容映射进旧实例包围盒，宽高比变化时内容按方向拉伸）；symbolInstanceId 保持不变。整个操作合并为一条撤销记录（undo 可整体回到更新前），返回更新后的符号摘要。',
    handler: async (gateway, args) => {
      const symbolId = optionalString(args.symbolId)
      if (!symbolId) throw new Error('缺少 symbolId 参数')
      const objectIds = optionalStringArray(args.objectIds)
      if (!objectIds) throw new Error('缺少 objectIds 参数（非空字符串数组，画布上已存在的对象 id）')
      return gateway.updateSymbol(symbolId, objectIds)
    }
  },
  detach_symbol_instance: {
    description: '解除单个对象与符号定义的关联：objectId 必填且必须是符号实例（携带 symbolId 元数据，否则报错）。解除后移除 symbolId/symbolInstanceId 元数据转为普通对象，外观与符号定义均不变（后续更新定义不再影响该对象）。整个操作为一条撤销记录，返回解除后的对象摘要。',
    handler: async (gateway, args) => {
      const objectId = optionalString(args.objectId)
      if (!objectId) throw new Error('缺少 objectId 参数')
      return gateway.detachSymbolInstance(objectId)
    }
  },

  /* ── 添加对象 ── */
  add_shape: {
    description: '添加基础图形。shape 取值：rectangle/square/circle/line/triangle/inverted-triangle/rhombus/wide-cross/parallelogram/inverted-parallelogram/trapezoid/inverted-trapezoid/doorway/inverted-arch/rotated-right-triangle/half-moon/pentagon/hexagon/octagon/arrow-right/solid-shaft-arrow/double-solid-shaft-arrow/star/heart（可加 base- 前缀）。x/y 为对象包围盒中心点（默认 anchor=\'center\'，省略 x/y 时定位不生效、落画布中心），anchor=\'top-left\' 时 x/y 为包围盒左上角，可配合摘要的 bboxLeft/bboxTop 核对落位；width/height 可指定目标尺寸，形状按该尺寸直接生成本体几何（scaleX=scaleY=1，圆角/描边不变形），只传其一时另一维度沿用默认尺寸。另可携带初始样式字段 fill/stroke/strokeWidth/cornerRadius/opacity/shadow，取值语义与 set_object_props 完全一致（fill/stroke 支持 hex/rgba、"swatch:名字" 色板引用、渐变 JSON 对象与 \'none\'；shadow 支持 { color, blur, offsetX, offsetY }、null 或 \'none\'；cornerRadius 按本体几何重建圆角；opacity 取 0-1），创建时一步应用，无需再追加 set_object_props。',
    handler: (gateway, args) => {
      const shape = optionalString(args.shape)
      if (!shape) throw new Error('缺少 shape 参数')
      const id = gateway.addShape(shape, {
        x: optionalNumber(args.x),
        y: optionalNumber(args.y),
        width: optionalNumber(args.width),
        height: optionalNumber(args.height),
        anchor: optionalAnchor(args.anchor),
        ...collectCreateStyleFields(args)
      })
      return { objectId: id }
    }
  },
  add_text: {
    description: '添加文本。text 为内容（默认"文字"），preset 可选 display/title/subtitle/body/body-small/caption/label/button-text，x/y 为画布坐标（默认画布中心），fontSize 可覆盖默认字号；fill 可覆盖默认填充色，支持 hex/rgba 或 "swatch:名字" 色板引用（色板见 list_swatches）。',
    handler: (gateway, args) => {
      const text = optionalString(args.text) ?? '文字'
      const id = gateway.addText({
        text,
        preset: optionalString(args.preset),
        x: optionalNumber(args.x),
        y: optionalNumber(args.y),
        fontSize: optionalNumber(args.fontSize),
        fill: optionalString(args.fill)
      })
      return { objectId: id }
    }
  },
  insert_svg: {
    description: '导入 SVG 到画布：svg 传完整 <svg> 文档、<path> 片段或 path d 属性；name 可指定对象名称，x/y 为对象包围盒中心点（默认 anchor=\'center\'，省略 x/y 时定位不生效、落画布中心），anchor=\'top-left\' 时 x/y 为包围盒左上角，可配合摘要的 bboxLeft/bboxTop 核对落位。默认按原始尺寸 1:1 导入不做缩放；scale 为可选缩放倍数（如 0.5）。另可携带初始样式字段 fill/stroke/strokeWidth/cornerRadius/opacity/shadow（取值语义与 set_object_props 完全一致，如 fill 支持 hex/rgba、"swatch:名字" 与渐变 JSON），导入后一步应用。导入对象超出画布边界时操作仍成功，返回的 message 字段会说明越界情况。',
    handler: async (gateway, args) => {
      const svg = optionalString(args.svg)
      if (!svg) throw new Error('缺少 svg 参数')
      const scale = optionalNumber(args.scale)
      if (scale !== undefined && scale <= 0) throw new Error('scale 必须大于 0')
      const result = await gateway.insertSvg(svg, {
        name: optionalString(args.name),
        x: optionalNumber(args.x),
        y: optionalNumber(args.y),
        scale,
        anchor: optionalAnchor(args.anchor),
        ...collectCreateStyleFields(args)
      })
      return result
    }
  },
  insert_iconify_icon: {
    description: '从 Iconify 在线图标库插入图标，iconName 形如 "mdi:home"，x/y 可指定插入位置。',
    handler: async (gateway, args) => {
      const iconName = optionalString(args.iconName)
      if (!iconName) throw new Error('缺少 iconName 参数')
      const id = await gateway.insertIconifyIcon(iconName, {
        x: optionalNumber(args.x),
        y: optionalNumber(args.y)
      })
      return { objectId: id }
    }
  },
  insert_icon_template: {
    description: '插入内置图标模板到当前画布，templateId 见模板目录（如 app-icon-rounded-square）。',
    handler: async (gateway, args) => {
      const templateId = optionalString(args.templateId)
      if (!templateId) throw new Error('缺少 templateId 参数')
      const id = await gateway.insertIconTemplate(templateId)
      return { objectId: id }
    }
  },
  apply_icon_template: {
    description: '把内置图标模板应用为当前文档（替换画布内容，可撤销恢复）。',
    handler: async (gateway, args) => {
      const templateId = optionalString(args.templateId)
      if (!templateId) throw new Error('缺少 templateId 参数')
      await gateway.applyIconTemplateAsDocument(templateId)
      return gateway.getOverview()
    }
  },
  create_objects: {
    description: '按顺序批量创建多个对象。items 为条目数组，每条目 shape/svg/text 三选一（同时提供时按 svg > shape > text 优先）：shape 为基础图形短名（同 add_shape 取值），svg 为 SVG 文本或片段（scale 为可选缩放倍数），text 为文本内容；每条目均可携带 x/y（对象包围盒中心点，默认 anchor=\'center\'，条目省略 x/y 时定位不生效、落画布中心；anchor=\'top-left\' 时 x/y 为包围盒左上角）、anchor（定位锚点，同 add_shape）、name（图层名），以及初始样式字段 fill/stroke/strokeWidth/cornerRadius/opacity/shadow（取值语义与 set_object_props 完全一致：fill/stroke 支持 hex/rgba、"swatch:名字" 色板引用、渐变 JSON 对象与 \'none\'，shadow 支持 { color, blur, offsetX, offsetY }、null 或 \'none\'，cornerRadius 按本体几何重建圆角，opacity 取 0-1），创建时一步应用，如 9 个条形可一次完成创建+赋样式；shape 条目另可用 width/height 指定目标尺寸。group 为 true 且创建对象数不少于 2 时自动编组，groupName 指定组名。items 为空或缺小时报错；返回全部新对象 id 与可选 groupId。',
    handler: async (gateway, args) => {
      const items = optionalRecordArray(args.items)
      if (!items || !items.length) throw new Error('缺少 items 参数（非空对象数组）')
      const group = optionalBoolean(args.group) ?? false
      const groupName = optionalString(args.groupName)
      return gateway.createObjects(
        items.map((item) => ({
          shape: optionalString(item.shape),
          svg: optionalString(item.svg),
          text: typeof item.text === 'string' ? item.text : undefined,
          x: optionalNumber(item.x),
          y: optionalNumber(item.y),
          anchor: optionalAnchor(item.anchor),
          width: optionalNumber(item.width),
          height: optionalNumber(item.height),
          scale: optionalNumber(item.scale),
          name: optionalString(item.name),
          ...collectCreateStyleFields(item)
        })),
        { group, groupName }
      )
    }
  },

  /* ── 选区 ── */
  select_objects: {
    description: '按 id 数组选中对象（objectIds 空数组清空选中），mode 可选 shape/point/segment。',
    handler: (gateway, args) => {
      const ids = optionalStringArray(args.objectIds) ?? []
      gateway.selectObjects(ids, (optionalString(args.mode) as 'shape' | 'point' | 'segment') ?? 'shape')
      return { selectedIds: gateway.getSelectionIds() }
    }
  },
  select_all: {
    description: '全选画布对象。',
    handler: (gateway) => {
      gateway.selectAll()
      return { selectedIds: gateway.getSelectionIds() }
    }
  },

  /* ── 对象操作 ── */
  set_object_props: {
    description: '批量设置对象属性。props 为键值对象，支持 left/top/width/height/angle/opacity/fill/stroke/strokeWidth/scaleX/scaleY/rotateX/rotateY/visible/cornerRadius/shadow 等 Fabric 属性（宽度高度按显示尺寸换算缩放；cornerRadius 仅对基础形状等可编辑路径对象生效，会按当前本体几何重建圆角）。样式值扩展：fill/stroke 支持 "swatch:名字" 引用色板颜色（list_swatches 查询，不存在报错），也支持渐变 JSON 对象 { type: \'linear\'|\'radial\', stops: [{ offset: 0-1, color }], x1,y1,x2,y2（linear）或 x2,y2,r2（radial，percentage 坐标 0-1）}；fill/stroke 传 \'none\' 清除渐变回原纯色；shadow 传 { color, blur, offsetX, offsetY }、null（清除）或 \'none\'。原字符串颜色行为不变。',
    handler: (gateway, args) => {
      const objectId = optionalString(args.objectId)
      const props = optionalRecord(args.props)
      if (!objectId) throw new Error('缺少 objectId 参数')
      if (!props || !Object.keys(props).length) throw new Error('缺少 props 参数')
      gateway.setObjectProps(objectId, props)
      return gateway.getObjectSummary(objectId)
    }
  },
  update_text: {
    description: '更新文本对象的内容与排版：objectId 必填且必须是文本对象（Text/Textbox/IText），否则报错。更新字段全部可选但至少提供一项：text 为新内容（支持换行符，变更后自动重算换行与宽高）；fontSize 取 6-500；fontFamily 为系统字体名（如 Microsoft YaHei/Source Han Sans SC/Arial，渲染取决于查看端系统已安装字体、跨设备可能回退，发布图标建议转曲 outline_text）；fontWeight 取 normal/bold 或 100-900 的数字；fontStyle 取 normal/italic；charSpacing 为字间距（千分之一 em，取 -200~800）；lineHeight 为行高倍数（取 0.5-3）；textAlign 取 left/center/right/justify；underline/linethrough 为下划线/删除线开关。整个操作合并为一条撤销记录，返回更新后的对象摘要。',
    handler: (gateway, args) => {
      const objectId = optionalString(args.objectId)
      if (!objectId) throw new Error('缺少 objectId 参数')
      const request = parseUpdateTextRequest(args)
      if (!request) {
        throw new Error('至少提供 text/fontSize/fontFamily/fontWeight/fontStyle/charSpacing/lineHeight/textAlign/underline/linethrough 之一')
      }
      return gateway.updateText(objectId, request)
    }
  },
  move_layer: {
    description: '调整对象层级：direction 取 up（上移一层）/down（下移一层）/top（置顶）/bottom（置底）。',
    handler: (gateway, args) => {
      const objectId = optionalString(args.objectId)
      const direction = optionalString(args.direction)
      if (!objectId) throw new Error('缺少 objectId 参数')
      if (direction !== 'up' && direction !== 'down' && direction !== 'top' && direction !== 'bottom') {
        throw new Error('direction 必须是 up/down/top/bottom 之一')
      }
      gateway.moveLayer(objectId, direction)
      return { objectId, direction }
    }
  },
  set_object_visible: {
    description: '显示或隐藏对象：visible 布尔值。',
    handler: (gateway, args) => {
      const objectId = optionalString(args.objectId)
      const visible = optionalBoolean(args.visible)
      if (!objectId) throw new Error('缺少 objectId 参数')
      if (visible === undefined) throw new Error('缺少 visible 参数')
      gateway.setObjectVisible(objectId, visible)
      return { objectId, visible }
    }
  },
  set_object_locked: {
    description: '锁定或解锁对象：locked 布尔值。',
    handler: (gateway, args) => {
      const objectId = optionalString(args.objectId)
      const locked = optionalBoolean(args.locked)
      if (!objectId) throw new Error('缺少 objectId 参数')
      if (locked === undefined) throw new Error('缺少 locked 参数')
      gateway.setObjectLocked(objectId, locked)
      return { objectId, locked }
    }
  },
  duplicate_objects: {
    description: '复制对象（objectIds 省略时复制当前选中对象），返回新对象 id 列表。',
    handler: async (gateway, args) => {
      const ids = await gateway.duplicateObjects(optionalStringArray(args.objectIds))
      return { objectIds: ids }
    }
  },
  delete_objects: {
    description: '删除对象（objectIds 省略时删除当前选中对象）。',
    handler: (gateway, args) => {
      gateway.deleteObjects(optionalStringArray(args.objectIds))
      return { objectCount: gateway.listObjects().length }
    }
  },
  flip_object: {
    description: '翻转对象：axis 取 x（水平翻转）或 y（垂直翻转）。',
    handler: (gateway, args) => {
      const objectId = optionalString(args.objectId)
      const axis = optionalString(args.axis)
      if (!objectId) throw new Error('缺少 objectId 参数')
      if (axis !== 'x' && axis !== 'y') throw new Error('axis 必须是 x 或 y')
      gateway.flipObject(objectId, axis)
      return { objectId, axis }
    }
  },
  group_objects: {
    description: '编组对象（objectIds 省略时使用当前选中对象，至少需要 2 个）。',
    handler: (gateway, args) => {
      gateway.groupObjects(optionalStringArray(args.objectIds))
      return { selectedIds: gateway.getSelectionIds() }
    }
  },
  ungroup_object: {
    description: '解散编组（objectId 省略时使用当前选中的编组对象）。',
    handler: (gateway, args) => {
      gateway.ungroupObject(optionalString(args.objectId))
      return { selectedIds: gateway.getSelectionIds() }
    }
  },
  set_object_name: {
    description: '设置对象图层名（图层面板与 list_objects 显示的名称）。objectId 与 name（非空字符串）均必填；名称与当前一致时不产生变更，设置成功后返回对象摘要。',
    handler: (gateway, args) => {
      const objectId = optionalString(args.objectId)
      const name = optionalString(args.name)
      if (!objectId) throw new Error('缺少 objectId 参数')
      if (!name) throw new Error('缺少 name 参数')
      const summary = gateway.setObjectName(objectId, name)
      if (!summary) throw new Error(`未找到对象: ${objectId}`)
      return summary
    }
  },
  align_objects: {
    description: '对多个对象做整体对齐：以对象集合的公共包围盒为基准。mode 必填，取 left（左对齐）/center（水平居中）/right（右对齐）/top（顶对齐）/middle（垂直居中）/bottom（底对齐）；objectIds 至少 2 个（省略时使用当前选中对象），编组对象作为整体参与。返回实际参与对齐的对象 id。',
    handler: (gateway, args) => {
      const mode = optionalString(args.mode)
      if (
        mode !== 'left' && mode !== 'center' && mode !== 'right'
        && mode !== 'top' && mode !== 'middle' && mode !== 'bottom'
      ) {
        throw new Error('mode 必须是 left/center/right/top/middle/bottom 之一')
      }
      const objectIds = gateway.alignObjects(optionalStringArray(args.objectIds), mode)
      return { objectIds, mode }
    }
  },
  distribute_objects: {
    description: '在首尾对象之间等间距分布对象：axis 必填，取 x（水平）或 y（垂直）；mode 可选，取 edge（对象边缘间距相等）或 center（对象中心间距相等，默认），首尾对象位置保持不变。objectIds 至少 2 个（省略时使用当前选中对象），按分布轴坐标自动排序。返回实际参与分布的对象 id。',
    handler: (gateway, args) => {
      const axis = optionalString(args.axis)
      if (axis !== 'x' && axis !== 'y') throw new Error('axis 必须是 x 或 y')
      const mode = optionalString(args.mode)
      if (mode !== undefined && mode !== 'edge' && mode !== 'center') {
        throw new Error('mode 必须是 edge 或 center')
      }
      const resolvedMode: 'edge' | 'center' = mode === 'edge' ? 'edge' : 'center'
      const objectIds = gateway.distributeObjects(optionalStringArray(args.objectIds), axis, resolvedMode)
      return { objectIds, axis, mode: resolvedMode }
    }
  },
  batch_set_props: {
    description: '对多个对象应用属性，整个批次合并为一条撤销记录（一次 undo 即可整体还原）。双形态二选一、不可同时提供：① 同值批量——objectIds（非空字符串数组，至少 1 个）+ props（所有对象应用同一组属性）；② 逐对象条目——items（非空对象数组，每条形如 { objectId, props }，objectId 为目标对象 id，props 为该对象各自应用的属性键值），适合一次调用完成多个对象的不同属性修改（如分别指定 left/top）。props 键值与 set_object_props 相同，支持 left/top/width/height/angle/opacity/fill/stroke/strokeWidth/scaleX/scaleY/visible/cornerRadius/shadow 等（width/height 按显示尺寸换算缩放，cornerRadius 按本体几何重建圆角；fill/stroke 支持 swatch 引用与渐变 JSON，shadow 支持 { color, blur, offsetX, offsetY } 或 null，语义详见 set_object_props），逐对象条目同样支持全部语义并整批一条撤销记录。返回每个对象应用后的摘要（顺序与 objectIds/items 一致）。',
    handler: (gateway, args) => {
      const hasItems = args.items !== undefined
      const hasIdsForm = args.objectIds !== undefined || args.props !== undefined
      if (hasItems && hasIdsForm) {
        throw new Error('objectIds+props 与 items 只能二选一：同值批量用 objectIds+props，逐对象条目用 items')
      }
      // 形态 B：items 逐对象条目，逐条校验后整批透传（网关负责目标存在性与样式值合法性）。
      if (hasItems) {
        if (!Array.isArray(args.items) || !args.items.length) {
          throw new Error('items 必须是非空对象数组，每条形如 { objectId, props }')
        }
        const items = (args.items as unknown[]).map((raw, index) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error(`items[${index}] 必须是包含 objectId 与 props 的对象`)
          }
          const entry = raw as Record<string, unknown>
          const objectId = optionalString(entry.objectId)
          if (!objectId) throw new Error(`items[${index}] 缺少 objectId 参数`)
          const props = optionalRecord(entry.props)
          if (!props || !Object.keys(props).length) throw new Error(`items[${index}] 缺少 props 参数`)
          return { objectId, props }
        })
        const results = gateway.batchSetObjectsPropsItems(items)
        return { results }
      }
      // 形态 A：objectIds + props 同值批量。
      const objectIds = optionalStringArray(args.objectIds)
      if (!objectIds) {
        throw new Error('缺少 objectIds 参数（非空字符串数组），或改用 items 形态逐对象条目批量设置')
      }
      const props = optionalRecord(args.props)
      if (!props || !Object.keys(props).length) {
        throw new Error('缺少 props 参数（与 objectIds 搭配同值批量），或改用 items 形态逐对象条目批量设置')
      }
      const results = gateway.batchSetObjectsProps(objectIds, props)
      return { results }
    }
  },

  /* ── 样式预设 ── */
  save_style_preset: {
    description: '保存文档级自定义样式预设（随工程保存与撤销历史持久化）。name 必填（与内置预设同名报错，与自定义预设同名时覆盖），style 必填且至少包含 fill/stroke/strokeWidth/cornerRadius/shadow/opacity 之一；fill/stroke 支持 "swatch:名字" 引用与渐变 JSON（同 set_object_props 语法，保存原样、应用时解析），shadow 支持 { color, blur, offsetX, offsetY } 或 null。返回全部预设列表（含内置）。',
    handler: (gateway, args) => {
      const name = optionalString(args.name)
      const style = optionalRecord(args.style)
      if (!name) throw new Error('缺少 name 参数')
      if (!style || !Object.keys(style).length) throw new Error('缺少 style 参数（至少包含一个样式键）')
      return gateway.saveStylePreset(name, style)
    }
  },
  remove_style_preset: {
    description: '删除文档级自定义样式预设：name 必填；内置预设不可删除，名称不存在时报错。返回剩余预设列表（含内置）。',
    handler: (gateway, args) => {
      const name = optionalString(args.name)
      if (!name) throw new Error('缺少 name 参数')
      return gateway.removeStylePreset(name)
    }
  },
  list_style_presets: {
    description: '列出全部可用样式预设：内置预设（source=\'builtin\'：flat-fill 纯黑填充无边 / stroke-only 2px #333333 描边无填充 / soft-shadow 黑色25%透明 blur12 offsetY4 阴影 / rounded-card 白色填充圆角24）在前，自定义预设（source=\'custom\'）在后；每项含 name 与 style。预设可经 apply_style_preset 应用到对象。',
    handler: (gateway) => gateway.listStylePresets()
  },
  apply_style_preset: {
    description: '把样式预设应用到对象：name 必填（内置或自定义，未找到报错）；objectIds 可省略（省略时使用当前选中对象）。内部等价于用预设 style 执行 batch_set_props（支持 swatch 引用解析、渐变 JSON、cornerRadius 重建、shadow 应用等全部语义），整个批次合并为一条撤销记录。返回预设名、来源、实际应用的对象 id 列表与每对象摘要。',
    handler: (gateway, args) => {
      const name = optionalString(args.name)
      if (!name) throw new Error('缺少 name 参数')
      return gateway.applyStylePreset(name, optionalStringArray(args.objectIds))
    }
  },

  /* ── 文字转曲 ── */
  outline_text: {
    description: '把文本对象转曲为可编辑路径：objectId 可省略（省略时使用当前选中对象）。目标必须是文本对象（Text/Textbox/IText），否则报错。转曲生成与原文本视觉一致的路径对象（字形固化为矢量路径，不再依赖系统字体，可继续点位编辑/布尔运算/导出），原文本被移除，整体为一条撤销记录，转曲结果自动选中。返回新路径对象 objectId。',
    handler: async (gateway, args) => {
      const objectId = optionalString(args.objectId)
      return gateway.outlineText(objectId)
    }
  },

  /* ── 布尔运算 ── */
  boolean_ops: {
    description: '对 2 个及以上对象执行布尔运算并生成单一结果路径对象：type 必填，取 union（并集）/intersect（交集）/subtract（差集）/xor（异或）；objectIds 可省略（省略时使用当前选中对象），按图层顺序参与运算，subtract 只取前两个对象；subtractDirection 可选 forward（A-B，默认）或 reverse（B-A），仅对 subtract 生效。万花筒实例与布尔预览对象不参与运算。运算成功后结果对象自动选中，返回 { objectId, operation }。',
    handler: async (gateway, args) => {
      // 布尔类型参数命名 type：沿用 operation 会与调度键同名，嵌套 args 合并时被覆盖导致本操作无法路由
      const type = optionalString(args.type)
      if (!type) throw new Error('缺少 type 参数（union/intersect/subtract/xor）')
      const subtractDirection = optionalString(args.subtractDirection)
      if (subtractDirection !== undefined && subtractDirection !== 'forward' && subtractDirection !== 'reverse') {
        throw new Error('subtractDirection 必须是 forward 或 reverse')
      }
      return gateway.booleanOps(
        optionalStringArray(args.objectIds),
        type as 'union' | 'intersect' | 'subtract' | 'xor',
        (subtractDirection as 'forward' | 'reverse') ?? 'forward'
      )
    }
  },

  /* ── 蒙版裁切 ── */
  mask_objects: {
    description: '把一个对象设为另一个对象的蒙版（clipPath 裁切）：objectId 为被裁切的目标对象，maskId 为蒙版对象（两者都必须已存在于画布）。裁剪区域与蒙版当前在画布上的视觉位置/尺寸/旋转完全一致（自动换算目标与蒙版之间的位移/缩放/旋转差），蒙版形状之外的部分被隐藏；removeMaskObject 为 true 时应用后从画布移除蒙版对象（默认 false 保留以便继续编辑复用）。整个操作合并为一条撤销记录。返回 { objectId, clipPathId }。',
    handler: async (gateway, args) => {
      const objectId = optionalString(args.objectId)
      const maskId = optionalString(args.maskId)
      if (!objectId) throw new Error('缺少 objectId 参数')
      if (!maskId) throw new Error('缺少 maskId 参数')
      return gateway.maskObjects(objectId, maskId, optionalBoolean(args.removeMaskObject) ?? false)
    }
  },
  unmask_object: {
    description: '移除对象上的蒙版（clipPath）恢复完整显示：objectId 必填，对象当前没有蒙版时报错。返回移除后的对象摘要（masked=false），操作为一条撤销记录。',
    handler: async (gateway, args) => {
      const objectId = optionalString(args.objectId)
      if (!objectId) throw new Error('缺少 objectId 参数')
      return gateway.unmaskObject(objectId)
    }
  },

  /* ── 位图滤镜与混合模式 ── */
  apply_image_filter: {
    description: '整体替换目标位图的滤镜列表并可选设置混合模式：objectId 必填且必须是位图（FabricImage）对象。filters 为滤镜设置数组（整体替换语义，传空数组清除全部滤镜；省略 filters 时保留现有滤镜只设混合模式），每条形如 { type, enabled?, strength?, brightness?, contrast?, saturation? }：type 取 grayscale（灰度）/invert（反色）/sepia（褐色）/blur（模糊）/brightness（亮度）/contrast（对比度）/saturation（饱和度）之一；enabled 缺省为 true（false 保留参数但不参与渲染）；strength 为模糊强度 0-1（缺省 0.1），brightness/contrast/saturation 取 -1~1（缺省 0），越界值自动收敛。blendMode 可选，取 normal/multiply/screen/overlay/darken/lighten/color-dodge/difference/exclusion/hue/saturation/color/luminosity 之一（normal 表示正常）。滤镜按固定顺序整体应用，整个操作合并为一条撤销记录，返回更新后的对象摘要（含 filters 与 blendMode）。',
    handler: async (gateway, args) => {
      const objectId = optionalString(args.objectId)
      if (!objectId) throw new Error('缺少 objectId 参数')
      const blendModeRaw = optionalString(args.blendMode)
      let blendMode: string | undefined
      if (blendModeRaw !== undefined) {
        const normalized = normalizeBlendMode(blendModeRaw)
        if (!normalized) {
          throw new Error('blendMode 必须是 normal/multiply/screen/overlay/darken/lighten/color-dodge/difference/exclusion/hue/saturation/color/luminosity 之一')
        }
        blendMode = normalized
      }
      let filters: BitmapFilterSetting[] | undefined
      if (args.filters !== undefined && args.filters !== null) {
        if (!Array.isArray(args.filters)) throw new Error('filters 必须是滤镜设置对象数组')
        filters = args.filters.map((raw, index) => parseBitmapFilterSetting(raw, index))
      }
      if (filters === undefined && blendMode === undefined) {
        throw new Error('至少提供 filters 或 blendMode 参数')
      }
      return gateway.applyImageFilter(objectId, filters, blendMode)
    }
  },

  /* ── 位图裁剪 ── */
  crop_image: {
    description: '裁剪位图对象：objectId 必填且必须是位图（FabricImage）。left/top/width/height 必填，为裁剪矩形在图片"当前显示包围盒"坐标系中的位置与尺寸（angle=0 语义，与对象摘要的 bboxLeft/bboxTop 同一坐标系：bboxLeft+left 即相对图片显示区左边缘的偏移，矩形必须完整落在显示范围内，越界报错）。实现负责换算为图片源像素的 cropX/cropY/width/height，图片元素本身不动、缩放/角度等变换保持不变，支持对已裁剪的图连续再裁剪；换算后源区域不足 1×1 像素报错。整个操作合并为一条撤销记录，返回更新后的对象摘要（width/height 为裁剪后的显示尺寸）。',
    handler: async (gateway, args) => {
      const objectId = optionalString(args.objectId)
      if (!objectId) throw new Error('缺少 objectId 参数')
      const left = optionalNumber(args.left)
      const top = optionalNumber(args.top)
      const width = optionalNumber(args.width)
      const height = optionalNumber(args.height)
      if (left === undefined || top === undefined || width === undefined || height === undefined) {
        throw new Error('缺少 left/top/width/height 参数（裁剪矩形，图片显示包围盒坐标系）')
      }
      return gateway.cropImage(objectId, { left, top, width, height })
    }
  },

  /* ── 图案填充 ── */
  set_pattern_fill: {
    description: '为目标对象设置图案填充（fabric Pattern 平铺图片填充）：objectId 必填。source 必填，为 dataURL 图片（data:image/...）或 http(s) 图片 URL；传 null 时清除图案并恢复纯色。repeat 可选平铺方式，取 repeat（重复，默认）/repeat-x（横向平铺）/repeat-y（纵向平铺）/no-repeat（不重复）。scale 可选图案缩放倍数（默认 1，越界值自动收敛到 0.05-20）。清除与设置均合并为一条撤销记录，图片加载失败报错，返回更新后的对象摘要。',
    handler: async (gateway, args) => {
      const objectId = optionalString(args.objectId)
      if (!objectId) throw new Error('缺少 objectId 参数')
      const repeat = optionalString(args.repeat)
      if (repeat !== undefined && repeat !== 'repeat' && repeat !== 'repeat-x' && repeat !== 'repeat-y' && repeat !== 'no-repeat') {
        throw new Error('repeat 必须是 repeat/repeat-x/repeat-y/no-repeat 之一')
      }
      let scale: number | undefined
      const rawScale = optionalNumber(args.scale)
      if (rawScale !== undefined) {
        if (rawScale <= 0) throw new Error('scale 必须是大于 0 的数字')
        scale = rawScale
      }
      if (args.source === null) {
        return gateway.setPatternFill(objectId, { source: null, repeat: repeat as McpPatternFillRequest['repeat'], scale })
      }
      const source = optionalString(args.source)
      if (!source) throw new Error('缺少 source 参数（dataURL 图片或 http(s) 图片 URL，传 null 表示清除图案）')
      // 调度层只做纯字符串校验（本文件禁止 import fabric 依赖），加载失败由网关层报可读错误。
      if (!/^data:image\//i.test(source) && !/^https?:\/\//i.test(source)) {
        throw new Error('source 必须是 dataURL 图片（data:image/...）或 http(s) 图片 URL')
      }
      return gateway.setPatternFill(objectId, { source, repeat: repeat as McpPatternFillRequest['repeat'], scale })
    }
  },

  /* ── 历史与快照 ── */
  undo: {
    description: '撤销上一步操作。',
    handler: (gateway) => {
      gateway.undo()
      return gateway.getOverview()
    }
  },
  redo: {
    description: '重做被撤销的操作。',
    handler: (gateway) => {
      gateway.redo()
      return gateway.getOverview()
    }
  },
  jump_to_history: {
    description: '跳转到撤销历史指定下标（先 list_history 查看可用范围）。',
    handler: (gateway, args) => {
      const index = optionalNumber(args.index)
      if (index === undefined || index < 0) throw new Error('缺少有效的 index 参数')
      gateway.jumpToHistory(Math.floor(index))
      return gateway.getOverview()
    }
  },
  save_snapshot: {
    description: '把当前画布完整内容存为命名快照：name 必填（非空字符串，同名覆盖）；快照只含画布视觉状态（对象、层级、背景，不含色板/样式预设），随工程保存持久化、不占撤销历史。新增快照超出 20 个上限时报错提示先删除。返回 { name, objectCount, createdAt }。',
    handler: (gateway, args) => {
      const name = optionalString(args.name)
      if (!name) throw new Error('缺少 name 参数')
      return gateway.saveSnapshot(name)
    }
  },
  restore_snapshot: {
    description: '把画布内容整体替换为指定命名快照：name 必填（不存在报错，可先 list_snapshots 查询）。恢复前会把当前画布自动备份为名为 "__backup__"+时间戳 的快照防丢失；恢复本身是一条撤销记录（undo 可回到恢复前）。返回 { name, backupName, objectCount }。',
    handler: (gateway, args) => {
      const name = optionalString(args.name)
      if (!name) throw new Error('缺少 name 参数')
      return gateway.restoreSnapshot(name)
    }
  },
  delete_snapshot: {
    description: '删除指定名称的命名画布快照：name 必填，不存在时报错（含自动备份快照，名称形如 __backup__+时间戳）。返回剩余快照列表。',
    handler: (gateway, args) => {
      const name = optionalString(args.name)
      if (!name) throw new Error('缺少 name 参数')
      return gateway.deleteSnapshot(name)
    }
  },

  /* ── 工程文档 ── */
  new_document: {
    description: '新建空白文档（当前内容可先保存或已进入历史）。',
    handler: (gateway) => {
      gateway.newDocument()
      return gateway.getOverview()
    }
  },
  save_project: {
    description: '保存当前工程。若当前标签尚未保存过，需要用户在界面完成路径选择；返回提示文本。',
    handler: (gateway) => ({ message: gateway.saveProject() })
  },
  get_project_json: {
    description: '读取当前工程的完整 JSON 内容（可用于备份或离线处理）。',
    handler: (gateway) => ({ json: gateway.getProjectJson() })
  },
  load_project_json: {
    description: '从 JSON 内容加载工程到当前画布（整体替换，可撤销恢复）。',
    handler: async (gateway, args) => {
      const json = optionalString(args.json)
      if (!json) throw new Error('缺少 json 参数')
      await gateway.loadProjectJson(json)
      return gateway.getOverview()
    }
  },

  /* ── 画板 ── */
  switch_artboard: {
    description: '切换到指定画板。',
    handler: async (gateway, args) => {
      const artboardId = optionalString(args.artboardId)
      if (!artboardId) throw new Error('缺少 artboardId 参数')
      await gateway.switchArtboard(artboardId)
      return { artboards: gateway.listArtboards() }
    }
  },
  add_artboard: {
    description: '新建画板并切换过去，返回新画板 id。',
    handler: async (gateway) => {
      const id = await gateway.addArtboard()
      return { artboardId: id }
    }
  },
  delete_artboard: {
    description: '删除指定画板（至少保留一个）。',
    handler: async (gateway, args) => {
      const artboardId = optionalString(args.artboardId)
      if (!artboardId) throw new Error('缺少 artboardId 参数')
      await gateway.deleteArtboard(artboardId)
      return { artboards: gateway.listArtboards() }
    }
  },
  rename_artboard: {
    description: '重命名画板。',
    handler: (gateway, args) => {
      const artboardId = optionalString(args.artboardId)
      const name = optionalString(args.name)
      if (!artboardId) throw new Error('缺少 artboardId 参数')
      if (!name) throw new Error('缺少 name 参数')
      gateway.renameArtboard(artboardId, name)
      return { artboards: gateway.listArtboards() }
    }
  },

  /* ── 导出 ── */
  export_svg_text: {
    description: '导出优化 SVG 文本（不写文件）。includeBackground 为 true 时包含画布背景；artboardId 可选，指定时临时切换到该画板导出并自动恢复原画板（画板 id 见 list_artboards）。',
    handler: async (gateway, args) => {
      const svg = await gateway.exportSvgText({
        includeBackground: optionalBoolean(args.includeBackground) ?? false,
        artboardId: optionalString(args.artboardId)
      })
      return { svg }
    }
  },
  export_png_data_url: {
    description: '渲染位图并返回 dataURL（不写文件）。size 为输出宽度像素（默认画布宽），transparentBackground 为 true 时透明背景；format 可选 png（默认）或 webp，webp 时 quality 可选 0-1（默认 0.92）；artboardId 可选，指定时按该画板渲染。',
    handler: async (gateway, args) => {
      const dataUrl = await gateway.exportPngDataUrl({
        size: optionalNumber(args.size),
        transparentBackground: optionalBoolean(args.transparentBackground) ?? false,
        format: optionalImageFormat(args.format),
        quality: optionalQuality(args.quality),
        artboardId: optionalString(args.artboardId)
      })
      return { dataUrl }
    }
  },
  get_canvas_thumbnail: {
    description: '渲染画布快速预览缩略图（透明底 PNG），语义是"给 AI 看的快速预览"：建议在每次修改布局/配色后调用本操作做视觉自检（低成本、透明底、适合确认整体效果），确认无误后再继续精调或用 export_* 系列正式导出。size 为输出宽度像素（默认 256，范围 32-512，高度按画布宽高比推导）；artboardId 可选，指定时按该画板渲染。outputPath 可选（绝对文件路径，如 D:\\icons\\thumb.png 或 /tmp/thumb.png）：提供时缩略图 PNG 写入该文件并返回 { filePath, width, height }（不返回 dataUrl，节省 token），不提供时返回 { dataUrl, width, height }。',
    handler: async (gateway, args) => {
      const size = optionalNumber(args.size)
      if (size !== undefined && (size < 32 || size > 512)) throw new Error('size 取值范围 32-512')
      return gateway.getCanvasThumbnail({
        size,
        outputPath: optionalOutputPath(args.outputPath),
        artboardId: optionalString(args.artboardId)
      })
    }
  },
  export_svg_file: {
    description: '导出 SVG 到下载目录，返回文件路径。fileName 可选，includeBackground 为 true 时包含背景；outputDir 可选（绝对目录，同名文件覆盖，缺省写入系统下载目录并自动避让同名文件）；artboardId 可选按该画板导出。',
    handler: async (gateway, args) => {
      const filePath = await gateway.exportSvgFile({
        fileName: optionalString(args.fileName),
        includeBackground: optionalBoolean(args.includeBackground) ?? false,
        outputDir: optionalOutputDir(args.outputDir),
        artboardId: optionalString(args.artboardId)
      })
      return { filePath }
    }
  },
  export_png_file: {
    description: '导出 PNG/WebP 到下载目录，返回文件路径。size 为输出宽度像素（默认画布宽），fileName 与 transparentBackground 可选；format 可选 png（默认）或 webp，webp 时 quality 可选 0-1（默认 0.92）；outputDir 可选（绝对目录，同名文件覆盖，缺省写入系统下载目录）；artboardId 可选按该画板导出。',
    handler: async (gateway, args) => {
      const filePath = await gateway.exportPngFile({
        size: optionalNumber(args.size),
        fileName: optionalString(args.fileName),
        transparentBackground: optionalBoolean(args.transparentBackground) ?? false,
        format: optionalImageFormat(args.format),
        quality: optionalQuality(args.quality),
        outputDir: optionalOutputDir(args.outputDir),
        artboardId: optionalString(args.artboardId)
      })
      return { filePath }
    }
  },
  export_size_set: {
    description: '按预设尺寸集批量导出多尺寸 PNG 文件。preset 取值 favicon/pwa/android/ios/electron/custom：指定预设时 sizes 可省略（使用内置尺寸集，favicon=[16,32,48,64,128,256]、pwa=[72,96,128,144,152,192,384,512]、android=[48,72,96,144,192,512]、ios=[20,29,40,58,60,76,80,87,120,152,167,180,1024]、electron=[16,24,32,48,64,128,256,512,1024]），传 sizes 时覆盖预设尺寸；preset=custom 或省略时 sizes 必填（1-4096 整数，自动去重升序）。fileNamePrefix 默认 icon（文件名形如 icon-256.png），transparentBackground 默认 false；outputDir 可选（绝对目录，同名覆盖，缺省写入系统下载目录）；artboardId 可选按该画板导出。返回 { files: [{ size, filePath }], outputDir }。',
    handler: async (gateway, args) => {
      const preset = optionalString(args.preset)
      if (preset && !['favicon', 'pwa', 'android', 'ios', 'electron', 'custom'].includes(preset)) {
        throw new Error('preset 必须是 favicon/pwa/android/ios/electron/custom 之一')
      }
      const sizes = optionalNumberArray(args.sizes)
      if ((!preset || preset === 'custom') && !sizes) {
        throw new Error('preset=custom 时必须提供 sizes（1-4096 的整数数组）')
      }
      return gateway.exportSizeSet({
        preset: preset as 'favicon' | 'pwa' | 'android' | 'ios' | 'electron' | 'custom' | undefined,
        sizes,
        fileNamePrefix: optionalString(args.fileNamePrefix),
        transparentBackground: optionalBoolean(args.transparentBackground),
        outputDir: optionalOutputDir(args.outputDir),
        artboardId: optionalString(args.artboardId)
      })
    }
  },
  export_icon_container: {
    description: '把当前画布渲染为多尺寸透明 PNG 并打包为图标容器文件落盘：format 必填 ico 或 icns。sizes 可选（ico 默认 [16,24,32,48,64,128,256] 且单帧最大 256px，icns 默认 [16,32,64,128,256,512] 且最大 512px，自动去重升序）；fileName 默认 icon.ico / icon.icns；outputDir 可选（绝对目录，同名覆盖，缺省写入系统下载目录）；artboardId 可选按该画板导出。返回 { filePath, sizes }。',
    handler: async (gateway, args) => {
      const format = optionalString(args.format)
      if (format !== 'ico' && format !== 'icns') throw new Error('缺少 format 参数（必须是 ico 或 icns）')
      return gateway.exportIconContainer({
        format,
        sizes: optionalNumberArray(args.sizes),
        fileName: optionalString(args.fileName),
        outputDir: optionalOutputDir(args.outputDir),
        artboardId: optionalString(args.artboardId)
      })
    }
  },

  /* ── 视图 ── */
  set_viewport: {
    description: '视口控制：zoom 设置缩放倍数，fit 为 true 时自动适配画布到可视区域。',
    handler: (gateway, args) => {
      const zoom = optionalNumber(args.zoom)
      const fit = optionalBoolean(args.fit)
      if (zoom === undefined && !fit) throw new Error('至少提供 zoom 或 fit=true 之一')
      if (zoom !== undefined && (zoom < 0.05 || zoom > 20)) throw new Error('zoom 取值范围 0.05-20')
      gateway.setViewport({ zoom, fit })
      return gateway.getOverview()
    }
  }
}

/** 暴露给 plugin.json inputSchema 引用的操作名与描述清单（保持与 OPERATIONS 同步）。 */
export function listOperationNames(): Array<{ name: string; description: string }> {
  return Object.entries(OPERATIONS).map(([name, operation]) => ({ name, description: operation.description }))
}

/**
 * 执行一次 MCP 工具调用：解析 operation 与 args，转发给编辑器网关。
 * 编辑器未就绪、操作不存在或执行抛错时返回 ok=false，不向上层抛异常，
 * 保证 MCP 客户端总能拿到结构化错误而不是连接中断。
 */
export async function dispatchMcpOperation(
  provider: McpEditorGatewayProvider,
  input: unknown
): Promise<McpToolResponse> {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  // plugin.json 的 inputSchema 把操作参数声明在嵌套的 args 字段里，
  // 这里展开后与顶层字段合并（嵌套优先），兼容两种传参形态。
  const nested = raw.args && typeof raw.args === 'object' ? (raw.args as Record<string, unknown>) : {}
  const args = { ...raw, ...nested }
  const operationName = typeof args.operation === 'string' ? args.operation.trim() : ''
  if (!operationName) {
    return { ok: false, message: "缺少 operation 参数。用 operation='get_overview' 查看画布当前状态。" }
  }

  const operation = OPERATIONS[operationName]
  if (!operation) {
    const available = Object.keys(OPERATIONS).join(', ')
    return { ok: false, message: `未知操作: ${operationName}。可用操作：${available}` }
  }

  const gateway = provider()
  if (!gateway) {
    return { ok: false, message: '编辑器尚未就绪，请先在 ZTools 中打开图标创建工具窗口后重试。' }
  }

  try {
    const data = await operation.handler(gateway, args)
    return { ok: true, data }
  } catch (error) {
    return {
      ok: false,
      message: `操作 ${operationName} 失败: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
