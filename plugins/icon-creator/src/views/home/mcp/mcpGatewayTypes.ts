import type { FabricObject } from 'fabric'
import type {
  ExportIconContainerRequest,
  ExportIconContainerResult,
  ExportSizeSetRequest,
  ExportSizeSetResult
} from '../editor/modules/export-delivery/exportDeliveryTypes'
import type { DocumentStylePresetSummary, DocumentSwatch } from '../documentStyleMeta'
import type { BitmapFilterSetting } from '../bitmapFilters'

/** MCP 侧位图滤镜设置：与编辑器内部 BitmapFilterSetting 同构（type 小写约定 + 可选参数）。 */
export type McpBitmapFilterSetting = BitmapFilterSetting

/**
 * 对齐参考线的对外结构（用户从标尺拖出的辅助线，与 set_keyline 的 Keyline 安全区模板无关）：
 * orientation 取 horizontal（水平线，position 为 y）/ vertical（垂直线，position 为 x），
 * position 为画布坐标系像素。
 */
export interface McpGuide {
  id: string
  orientation: 'horizontal' | 'vertical'
  position: number
}

/** set_guides 的入参条目：与 McpGuide 相比省略 id（由实现侧生成）。 */
export interface McpGuideInput {
  orientation: 'horizontal' | 'vertical'
  position: number
}

/**
 * set_pattern_fill 的请求参数：source 为 null 表示清除图案恢复纯色；
 * repeat 缺省 repeat；scale 为图案缩放倍数（缺省 1，越界值自动收敛到 0.05-20）。
 */
export interface McpPatternFillRequest {
  source: string | null
  repeat?: 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat'
  scale?: number
}

/**
 * update_text 的更新字段（全部可选但至少一项）：对象必须是文本对象（Text/Textbox/IText）。
 * fontSize 取 6-500，charSpacing 为字间距（千分之一 em，取 -200~800），
 * lineHeight 为行高倍数（取 0.5-3），越界值由调度层校验报错。
 */
export interface McpUpdateTextRequest {
  /** 新文本内容（支持换行符）。 */
  text?: string
  fontSize?: number
  fontFamily?: string
  /** 字重：'normal'/'bold' 或 100-900 的数字。 */
  fontWeight?: 'normal' | 'bold' | number
  fontStyle?: 'normal' | 'italic'
  charSpacing?: number
  lineHeight?: number
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  underline?: boolean
  linethrough?: boolean
}

/**
 * 摘要中渐变样式的可读 JSON 形式：coords 单位与 fabric Gradient 一致
 * （percentage 表示 1 = 对象宽度/高度的 100%）。
 */
export type McpGradientSummary = {
  type: 'linear' | 'radial'
  gradientUnits: 'percentage' | 'pixels'
  coords: Record<string, number>
  stops: Array<{ offset: number; color: string }>
}

/** 摘要中阴影样式的可读 JSON 形式。 */
export type McpShadowSummary = {
  color: string
  blur: number
  offsetX: number
  offsetY: number
}

/**
 * MCP 网关向编辑器运行时暴露的只读画布信息，
 * 是 tools/call 里所有查询类操作的基础返回结构。
 */
export interface McpCanvasOverview {
  canvasWidth: number
  canvasHeight: number
  canvasBg: string
  zoom: number
  showPixelGrid: boolean
  snapToPixelGrid: boolean
  pixelGridSize: number
  keylineTemplate: string
  activeArtboardId: string
  artboardCount: number
  objectCount: number
  selectionCount: number
  canUndo: boolean
  canRedo: boolean
  historyLength: number
  historyIndex: number
  activeObjectIds: string[]
}

/**
 * 单个画布对象的摘要信息，供 list / 查询操作返回。
 * fill/stroke 为纯色时是颜色字符串，为渐变时是 McpGradientSummary 结构。
 */
export interface McpObjectSummary {
  id: string
  name: string
  type: string
  visible: boolean
  locked: boolean
  left: number
  top: number
  /** angle=0 时的包围盒左上角 x（left/top 是对象中心点，不能直接当左上角使用）。 */
  bboxLeft: number
  /** angle=0 时的包围盒左上角 y。 */
  bboxTop: number
  width: number
  height: number
  scaleX: number
  scaleY: number
  angle: number
  opacity: number
  fill: string | McpGradientSummary | null
  stroke: string | McpGradientSummary | null
  strokeWidth: number
  /** 圆角半径（仅可编辑路径对象携带；按本体几何重建后的生效值）。 */
  cornerRadius?: number
  shadow: McpShadowSummary | null
  /** 是否设置了 clipPath 蒙版（mask_objects 应用后为 true，unmask_object 后为 false）。 */
  masked: boolean
  zIndex: number
  /** 混合模式（对外约定名，normal 表示正常；所有对象都携带）。 */
  blendMode?: string
  /** 位图滤镜设置列表（仅位图对象携带，按面板固定顺序，含禁用条目）。 */
  filters?: McpBitmapFilterSetting[]
}

/**
 * 创建类操作（add_shape / insert_svg / create_objects 条目）可选携带的初始样式字段：
 * 值语义与 set_object_props 完全一致——fill/stroke 支持 hex/rgba、"swatch:名字" 色板引用、
 * 渐变 JSON 对象与 'none'；shadow 支持 { color, blur, offsetX, offsetY }、null 或 'none'；
 * cornerRadius 按本体几何重建圆角，opacity 取 0-1。
 * 类型保持 unknown 原样透传，解析统一在网关层的 applyPropsToObject 路径完成。
 */
export interface McpCreateStyleSettings {
  /** 初始填充色（hex/rgba、"swatch:名字"、渐变 JSON 或 'none'）。 */
  fill?: unknown
  /** 初始描边色（取值语义同 fill）。 */
  stroke?: unknown
  /** 初始描边宽度。 */
  strokeWidth?: unknown
  /** 初始圆角半径（按本体几何重建，仅基础形状等可编辑路径对象生效）。 */
  cornerRadius?: unknown
  /** 初始不透明度（0-1）。 */
  opacity?: unknown
  /** 初始阴影（{ color, blur, offsetX, offsetY }、null 或 'none'）。 */
  shadow?: unknown
}

/**
 * 批量创建对象的单个条目：shape / svg / text 三选一（同时提供时按 svg > shape > text 优先），
 * 其余字段为可选的位置、尺寸与初始样式设置（样式字段语义见 McpCreateStyleSettings）。
 */
export interface McpCreateObjectItem extends McpCreateStyleSettings {
  /** 基础图形短名或 base- 前缀目录 id（同 add_shape 的 shape 参数）。 */
  shape?: string
  /** SVG 文本（完整 <svg> 文档、<path> 片段或 path d 属性均可）。 */
  svg?: string
  /** 文本内容。 */
  text?: string
  /** 目标位置坐标（语义由 anchor 决定，缺省为包围盒中心点；省略时使用画布中心）。 */
  x?: number
  y?: number
  /**
   * x/y 的定位锚点：'center'（默认）时 x/y 为对象包围盒中心点，
   * 'top-left' 时 x/y 为包围盒左上角。省略 x/y 时本字段不生效（对象落在画布中心）。
   */
  anchor?: 'center' | 'top-left'
  /** 目标显示尺寸，仅对 shape 生效（形状按该尺寸生成本体几何）。 */
  width?: number
  height?: number
  /** SVG 缩放倍数（仅对 svg 生效，默认 1）。 */
  scale?: number
  /** 图层名（省略时沿用默认自动命名）。 */
  name?: string
}

/**
 * batch_set_props 逐对象条目形态的单条设置：每个条目给指定对象应用各自的属性键值
 * （值语义与 setObjectProps 的 props 一致），与"objectIds + props 同值批量"形态二选一。
 */
export interface McpBatchPropsItem {
  /** 目标对象 id。 */
  objectId: string
  /** 该对象各自应用的属性键值（语义与 setObjectProps 的 props 一致）。 */
  props: Record<string, unknown>
}

/**
 * 导出类操作的通用选项：指定 artboardId 时临时把该画板设为活动画板完成导出，
 * 结束后自动恢复原画板；省略时导出当前画布。
 */
export interface McpExportArtboardOptions {
  artboardId?: string
}

/**
 * 画布快速预览图（缩略图）选项：size 为输出宽度像素；
 * outputPath 为可选的绝对文件路径，提供时把缩略图 PNG 落盘并返回 filePath（不再返回 dataUrl）。
 */
export interface McpCanvasThumbnailOptions extends McpExportArtboardOptions {
  size?: number
  outputPath?: string
}

/**
 * 画布快速预览图结果：width/height 为实际输出像素。
 * 提供 outputPath 时返回 filePath（不返回 dataUrl，节省 token）；未提供时返回 dataUrl（透明底 PNG）。
 */
export interface McpCanvasThumbnailResult {
  width: number
  height: number
  dataUrl?: string
  filePath?: string
}

/** SVG 文本导出选项。 */
export interface McpExportSvgTextOptions extends McpExportArtboardOptions {
  includeBackground?: boolean
}

/** PNG/WebP dataURL 导出选项：quality 仅对 webp 生效（0-1，默认 0.92）。 */
export interface McpExportPngDataUrlOptions extends McpExportArtboardOptions {
  size?: number
  transparentBackground?: boolean
  format?: 'png' | 'webp'
  quality?: number
}

/** SVG 文件导出选项：outputDir 为绝对目录（缺省写入下载目录）。 */
export interface McpExportSvgFileOptions extends McpExportArtboardOptions {
  fileName?: string
  includeBackground?: boolean
  outputDir?: string
}

/** PNG/WebP 文件导出选项：outputDir 为绝对目录（缺省写入下载目录）。 */
export interface McpExportPngFileOptions extends McpExportArtboardOptions {
  size?: number
  fileName?: string
  transparentBackground?: boolean
  format?: 'png' | 'webp'
  quality?: number
  outputDir?: string
}

/** 多尺寸 PNG 批量导出选项（继承模块请求结构，另支持按画板导出）。 */
export type McpExportSizeSetOptions = ExportSizeSetRequest & McpExportArtboardOptions
/** 多尺寸 PNG 批量导出结果。 */
export type McpExportSizeSetResult = ExportSizeSetResult
/** 图标容器（ico/icns）导出选项。 */
export type McpExportIconContainerOptions = ExportIconContainerRequest & McpExportArtboardOptions
/** 图标容器导出结果。 */
export type McpExportIconContainerResult = ExportIconContainerResult

/** 命名快照摘要（list_snapshots / delete_snapshot 返回结构）。 */
export interface McpSnapshotSummary {
  name: string
  createdAt: number
  /** 快照画布 JSON 中的顶层对象数量。 */
  objectCount: number
}

/**
 * 符号定义摘要（list_symbols / define_symbol / update_symbol 的返回结构）：
 * instanceCount 为画布上当前引用此定义的实例数量（实时统计）。
 */
export interface McpSymbolSummary {
  id: string
  name: string
  /** 定义创建时间（毫秒时间戳）。 */
  createdAt: number
  /** 定义内的对象数量。 */
  objectCount: number
  /** 画布上引用此定义的实例数量。 */
  instanceCount: number
}

/** insert_symbol_instance 的返回结构：objectId 为实例 Group 的编辑器对象 id。 */
export interface McpSymbolInstanceInsertResult {
  objectId: string
  symbolId: string
  symbolInstanceId: string
}

/** save_snapshot 的返回结构。 */
export interface McpSnapshotSaveResult {
  name: string
  objectCount: number
  createdAt: number
}

/** restore_snapshot 的返回结构：backupName 为恢复前自动创建的当前画布备份快照名。 */
export interface McpSnapshotRestoreResult {
  name: string
  backupName: string
  objectCount: number
}

/**
 * 编辑器向 MCP 网关提供的全部能力。
 * 由 useHomeEditorRuntime 在运行时组装，网关只持有引用不做拷贝，
 * 因此页面卸载时置空 gateway 即可同步失效，避免捕获过期闭包。
 */
export interface McpEditorGateway {
  /** 读取画布与文档的整体概览（尺寸、背景、视口、历史状态等）。 */
  getOverview: () => McpCanvasOverview
  /** 读取全部对象摘要，按图层级（与图层面板一致的数组顺序）。 */
  listObjects: () => McpObjectSummary[]
  /** 按 editorObjectId 读取单个对象摘要，未找到返回 null。 */
  getObjectSummary: (objectId: string) => McpObjectSummary | null
  /** 读取当前选中的对象 id 列表。 */
  getSelectionIds: () => string[]
  /** 读取当前选中对象组成的 SVG 片段（未选中时返回整块画布 SVG）。 */
  getSelectionSvg: () => Promise<string>
  /** 读取当前选中对象的属性键值摘要，用于属性面板式查询。 */
  getActiveObjectProps: () => Record<string, unknown> | null
  /** 读取全部画板（含名称、尺寸与对象数）。 */
  listArtboards: () => Array<{ id: string; name: string; width: number; height: number; objectCount: number; active: boolean }>
  /** 读取撤销历史记录（描述与时间戳）。 */
  listHistory: () => Array<{ index: number; description: string; timestamp: number }>

  /** 画布尺寸调整（宽高为可选参数，未传保持不变）。 */
  resizeCanvas: (width?: number, height?: number) => void
  /** 设置画布背景色，支持 hex/rgba/'transparent'。 */
  setCanvasBackground: (color: string) => void
  /** 控制像素网格显示、吸附与网格尺寸。 */
  setPixelGrid: (options: { visible?: boolean; snap?: boolean; size?: number }) => void
  /** 控制 Keyline 安全区模板与边距（模板参考线 overlay，与对齐参考线无关）。 */
  setKeyline: (options: { template?: string; margin?: number }) => void

  /** 列出文档级对齐参考线（用户参考线，随工程保存与撤销历史持久化）。 */
  listGuides: () => { guides: McpGuide[] }
  /**
   * 整体替换对齐参考线：position 越界（负值 / 超出画布）时夹取到画布范围内而非报错，
   * id 由实现生成，返回夹取后的完整列表。整个操作合并为一条撤销记录。
   */
  setGuides: (guides: McpGuideInput[]) => { guides: McpGuide[] }
  /** 清空全部对齐参考线，返回空列表；整个操作合并为一条撤销记录。 */
  clearGuides: () => { guides: McpGuide[] }

  /**
   * 从画布现有对象创建（或按 id 覆盖）文档级符号定义（见 symbols.ts 说明）：
   * objectIds 须为画布上已存在的对象 id，原对象保持不变（不自动转为实例），
   * 定义坐标按包围盒左上角归一化。整个操作合并为一条撤销记录，返回符号摘要。
   */
  defineSymbol: (name: string, objectIds: string[]) => McpSymbolSummary
  /** 列出全部文档级符号定义（含定义对象数与画布实例数）。 */
  listSymbols: () => { symbols: McpSymbolSummary[] }
  /**
   * 插入符号定义的一个联动实例（一个 fabric Group，携带 symbolId / symbolInstanceId 元数据）：
   * x/y 为实例包围盒中心点（anchor 默认 'center'，省略 x/y 时落画布中心），
   * anchor='top-left' 时 x/y 为包围盒左上角。symbolId 不存在时抛错；
   * 实例超出画布时操作仍成功。整个操作为一条撤销记录，返回实例摘要。
   */
  insertSymbolInstance: (
    symbolId: string,
    options?: { x?: number; y?: number; anchor?: 'center' | 'top-left' }
  ) => Promise<McpSymbolInstanceInsertResult>
  /**
   * 用画布对象重写指定符号定义并同步全部实例（update_symbol）：
   * 实例按新定义重建，保持各自的包围盒中心、显示尺寸与旋转角（见 symbols.ts 映射策略）。
   * 整个操作合并为一条撤销记录，返回更新后的符号摘要。
   */
  updateSymbol: (symbolId: string, objectIds: string[]) => Promise<McpSymbolSummary>
  /**
   * 解除单个对象与符号定义的关联（detach_symbol_instance）：
   * 移除 symbolId / symbolInstanceId 元数据转普通对象，外观与定义均不变；
   * 目标不是符号实例时抛错。整个操作为一条撤销记录，返回解除后的对象摘要。
   */
  detachSymbolInstance: (objectId: string) => Promise<McpObjectSummary>
  /**
   * 全局颜色替换：把全部对象的 fill/stroke 与渐变色标中等于 from 的颜色整体替换为 to
   * （写法简并比较，大小写不敏感，支持 transparent），返回替换对象数 / 槽位数与
   * 归一化后的 from/to；没有匹配时不产生撤销记录，有替换则合并为一条。
   */
  replaceColor: (from: string, to: string) => { replacedObjects: number; replacedSlots: number; from: string; to: string }

  /**
   * 添加基础图形。shape 取值见 editorCatalog.basicShapes 的 id；
   * x/y 为对象包围盒中心点（anchor 默认 'center'，未传 x/y 时以画布中心插入），
   * anchor='top-left' 时 x/y 为包围盒左上角；width/height 指定目标尺寸时
   * 形状按该尺寸生成本体几何（scale 保持 1），返回新对象 id。
   * settings 可携带初始样式字段（fill/stroke/strokeWidth/cornerRadius/opacity/shadow，
   * 值语义与 setObjectProps 一致，见 McpCreateStyleSettings），创建后统一应用。
   */
  addShape: (
    shape: string,
    options?: { x?: number; y?: number; width?: number; height?: number; anchor?: 'center' | 'top-left' } & McpCreateStyleSettings
  ) => string
  /**
   * 添加文本对象。preset 为 textPresets id 或省略时用正文样式；
   * text 为实际文本内容，fill 支持颜色字符串或 "swatch:名字" 色板引用，返回新对象 id。
   */
  addText: (options: { text?: string; preset?: string; x?: number; y?: number; fontSize?: number; fill?: string }) => string
  /**
   * 导入 SVG 内容（完整 <svg> 文档、<path> 片段或 path d 属性均可）。
   * 默认按原始尺寸 1:1 导入；scale 为可选缩放倍数。
   * x/y 为对象包围盒中心点（anchor 默认 'center'），anchor='top-left' 时 x/y 为包围盒左上角。
   * 导入对象超出画布边界时操作仍成功，返回的 message 字段携带提示信息。
   * settings 可携带初始样式字段（fill/stroke/strokeWidth/cornerRadius/opacity/shadow，
   * 值语义与 setObjectProps 一致，见 McpCreateStyleSettings），导入后统一应用。
   */
  insertSvg: (
    svg: string,
    options?: { name?: string; x?: number; y?: number; scale?: number; anchor?: 'center' | 'top-left' } & McpCreateStyleSettings
  ) => Promise<{ objectId: string; message?: string }>
  /** 从 Iconify 插入图标，iconName 形如 "mdi:home"。 */
  insertIconifyIcon: (iconName: string, options?: { x?: number; y?: number }) => Promise<string>
  /** 插入内置图标模板（iconTemplates id）。 */
  insertIconTemplate: (templateId: string) => Promise<string>
  /** 应用内置图标模板为新文档（替换当前画布）。 */
  applyIconTemplateAsDocument: (templateId: string) => Promise<void>

  /** 按对象 id 数组设置选中（空数组表示清空选中）。 */
  selectObjects: (objectIds: string[], mode?: 'shape' | 'point' | 'segment') => void
  /** 全选画布对象。 */
  selectAll: () => void

  /**
   * 设置对象属性。props 中键名对应 Fabric 属性（left/top/angle/opacity/fill/stroke/
   * strokeWidth/scaleX/scaleY/visible 等），一次可批量设置多个。
   * fill/stroke 额外支持 "swatch:名字" 色板引用与渐变 JSON 对象；
   * shadow 支持 { color, blur, offsetX, offsetY }、null（清除）或 "none"；
   * fill/stroke 传 "none" 时回到原纯色（无原色则 transparent）。
   */
  setObjectProps: (objectId: string, props: Record<string, unknown>) => void
  /** 对选中/指定对象做图层移动：up/down/top/bottom。 */
  moveLayer: (objectId: string, direction: 'up' | 'down' | 'top' | 'bottom') => void
  /** 显示/隐藏对象。 */
  setObjectVisible: (objectId: string, visible: boolean) => void
  /** 锁定/解锁对象。 */
  setObjectLocked: (objectId: string, locked: boolean) => void
  /** 复制对象（默认当前选中，可传 id 数组指定），返回新对象 id 列表。 */
  duplicateObjects: (objectIds?: string[]) => Promise<string[]>
  /** 删除对象（默认当前选中，可传 id 数组指定）。 */
  deleteObjects: (objectIds?: string[]) => void
  /** 翻转对象，axis 为 'x'（水平）或 'y'（垂直）。 */
  flipObject: (objectId: string, axis: 'x' | 'y') => void
  /** 把指定对象编组（须至少 2 个）。 */
  groupObjects: (objectIds?: string[]) => void
  /** 解散指定编组对象。 */
  ungroupObject: (objectId?: string) => void

  /**
   * 对多个对象做整体对齐：以对象集合的公共包围盒为基准，
   * mode 取 left/center/right（水平方向）或 top/middle/bottom（垂直方向）。
   * objectIds 省略时使用当前选中对象；有效对象不足 2 个时抛错。
   * 返回实际参与对齐的对象 id 列表。
   */
  alignObjects: (
    objectIds: string[] | undefined,
    mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  ) => string[]
  /**
   * 在首尾对象之间等间距分布：axis 取 'x'（水平）或 'y'（垂直），
   * mode 取 'edge'（对象边缘间距相等）或 'center'（对象中心间距相等，默认），
   * 首尾对象位置保持不变。objectIds 省略时使用当前选中对象；有效对象不足 2 个时抛错。
   * 返回实际参与分布的对象 id 列表。
   */
  distributeObjects: (objectIds: string[] | undefined, axis: 'x' | 'y', mode?: 'edge' | 'center') => string[]
  /**
   * 对多个对象应用同一组属性（props 语义与 setObjectProps 一致），
   * 整个批次合并为一条撤销记录，一次 undo 即可整体还原；
   * 返回每个对象应用后的摘要（顺序与 objectIds 一致）。
   */
  batchSetObjectsProps: (objectIds: string[], props: Record<string, unknown>) => McpObjectSummary[]
  /**
   * 按逐对象条目批量设置属性：每个条目给指定对象应用各自的 props
   * （语义与 setObjectProps 一致），适合一次调用完成多个对象的不同属性修改；
   * 整批合并为一条撤销记录，一次 undo 即可整体还原；任一条目目标缺失或
   * 样式值非法时整批报错，不留部分应用状态；返回摘要顺序与 items 一致。
   */
  batchSetObjectsPropsItems: (items: McpBatchPropsItem[]) => McpObjectSummary[]
  /**
   * 按条目顺序批量创建对象（每条目 shape/svg/text 三选一），条目可携带初始样式字段
   * （McpCreateStyleSettings，语义与 setObjectProps 一致，创建后统一应用）与 name；
   * 条目 x/y 的锚点语义与 addShape/insertSvg 一致（默认包围盒中心，anchor='top-left' 按左上角定位）；
   * group 为 true 且创建对象数不少于 2 时把全部新对象编组，groupName 设置组名。
   * 返回全部新对象 id 与可选的组 id。
   */
  createObjects: (
    items: McpCreateObjectItem[],
    options?: { group?: boolean; groupName?: string }
  ) => Promise<{ objectIds: string[]; groupId?: string }>
  /** 设置对象图层名（图层面板与 list_objects 显示的名称）并刷新面板，返回对象摘要；未找到对象返回 null。 */
  setObjectName: (objectId: string, name: string) => McpObjectSummary | null

  /** 添加（或按名称覆盖）文档级命名色板条目，返回更新后的完整色板列表。 */
  addSwatch: (name: string, color: string) => { swatches: DocumentSwatch[] }
  /** 删除指定名称的文档级色板条目，不存在时抛错，返回剩余色板列表。 */
  removeSwatch: (name: string) => { swatches: DocumentSwatch[] }
  /** 列出文档级命名色板。 */
  listSwatches: () => { swatches: DocumentSwatch[] }

  /**
   * 保存文档级自定义样式预设（同名覆盖；与内置预设同名时抛错）。
   * style 键值在应用时才解析（支持 swatch 引用与渐变 JSON），此处仅做结构校验。
   */
  saveStylePreset: (name: string, style: Record<string, unknown>) => { presets: DocumentStylePresetSummary[] }
  /** 删除文档级自定义样式预设；内置预设或未知名称抛错，返回剩余预设列表。 */
  removeStylePreset: (name: string) => { presets: DocumentStylePresetSummary[] }
  /** 列出全部可用样式预设（内置 source='builtin' 在前，自定义 source='custom' 在后）。 */
  listStylePresets: () => { presets: DocumentStylePresetSummary[] }
  /**
   * 把样式预设应用到对象（内部复用 batch_set_props 的应用与撤销合并路径）。
   * objectIds 省略时使用当前选中对象；预设不存在或目标为空时抛错。
   * 返回预设名、来源、实际应用的对象 id 与每对象摘要。
   */
  applyStylePreset: (
    name: string,
    objectIds?: string[]
  ) => { name: string; source: 'builtin' | 'custom'; objectIds: string[]; results: McpObjectSummary[] }

  /**
   * 把文本对象转曲为可编辑路径对象：objectId 省略时使用当前选中对象；
   * 目标不是文本类型时抛错。原文本被移除并由路径对象取代（一条撤销记录内完成），
   * 转曲结果保持选中，返回新路径对象 id。
   */
  outlineText: (objectId?: string) => Promise<{ objectId: string }>

  /**
   * 更新文本对象的内容与排版属性（request 字段见 McpUpdateTextRequest，至少一项）：
   * text 变更后实现会重算文本布局（换行与宽高随内容刷新）。
   * 目标不存在或非文本对象时抛错；整个操作合并为一条撤销记录，返回更新后的对象摘要。
   */
  updateText: (objectId: string, request: McpUpdateTextRequest) => Promise<McpObjectSummary>

  /**
   * 把蒙版对象设为目标对象的 clipPath 裁切：裁剪区域与蒙版当前在画布上的
   * 视觉位置/尺寸一致（内部换算目标与蒙版之间的旋转/缩放/位移差）。
   * removeMaskObject 为 true 时应用后从画布移除蒙版对象。
   * 整个操作合并为一条撤销记录，返回目标 id 与蒙版来源 id。
   */
  maskObjects: (
    objectId: string,
    maskId: string,
    removeMaskObject?: boolean
  ) => Promise<{ objectId: string; clipPathId?: string }>
  /** 移除目标对象上的 clipPath 蒙版恢复完整显示，返回移除后的对象摘要；对象没有蒙版时抛错。 */
  unmaskObject: (objectId: string) => Promise<McpObjectSummary>

  /**
   * 整体替换目标位图的滤镜列表（与属性面板数据一致，按固定顺序重建），
   * 可选同时设置混合模式（normal 表示正常）；filters 省略时保留现有滤镜只设混合模式。
   * 整个操作合并为一条撤销记录，目标不存在或非位图时抛错，返回更新后的对象摘要。
   */
  applyImageFilter: (
    objectId: string,
    filters: McpBitmapFilterSetting[] | undefined,
    blendMode?: string
  ) => Promise<McpObjectSummary>

  /**
   * 裁剪目标位图：rect 以图片当前显示包围盒为坐标系（angle=0 语义，
   * 与对象摘要的 bboxLeft/bboxTop 同一坐标系），left/top 为矩形左上角。
   * 越界或换算后源区域过小时抛错；整个操作合并为一条撤销记录，返回更新后的对象摘要。
   */
  cropImage: (
    objectId: string,
    rect: { left: number; top: number; width: number; height: number }
  ) => Promise<McpObjectSummary>

  /**
   * 为目标对象设置图案填充（fabric Pattern fill）：source 为 dataURL 或 http(s) 图片 URL，
   * repeat 取 repeat/repeat-x/repeat-y/no-repeat（缺省 repeat），scale 为缩放倍数（缺省 1）。
   * source 为 null 时清除图案并恢复纯色。整个操作合并为一条撤销记录，返回更新后的对象摘要。
   */
  setPatternFill: (
    objectId: string,
    request: McpPatternFillRequest
  ) => Promise<McpObjectSummary>

  /**
   * 把当前画布内容（完整序列化 JSON，不含色板/样式预设等文档级元数据）存为命名快照。
   * 同名覆盖；新增条目超出数量上限时抛错。快照随工程 JSON 保存，不进入撤销历史。
   */
  saveSnapshot: (name: string) => McpSnapshotSaveResult
  /**
   * 用命名快照的画布 JSON 整体替换当前画布内容（一条撤销记录，可 undo 回到恢复前）。
   * 恢复前先把当前画布自动备份为 "__backup__" + 时间戳 的快照防丢失，返回该备份名。
   */
  restoreSnapshot: (name: string) => Promise<McpSnapshotRestoreResult>
  /** 列出全部命名快照（name、createdAt、objectCount）。 */
  listSnapshots: () => { snapshots: McpSnapshotSummary[] }
  /** 删除指定名称的命名快照，不存在时抛错，返回剩余快照列表。 */
  deleteSnapshot: (name: string) => { snapshots: McpSnapshotSummary[] }

  /** 撤销一步。 */
  undo: () => void
  /** 重做一步。 */
  redo: () => void
  /** 跳转到历史记录指定下标。 */
  jumpToHistory: (index: number) => void

  /** 新建空白文档。 */
  newDocument: () => void
  /** 保存当前工程（已有路径则覆盖，否则返回需用户在界面中选择路径）。 */
  saveProject: () => string
  /** 读取当前工程文件内容（JSON 文本）。 */
  getProjectJson: () => string
  /** 从 JSON 文本加载工程内容到当前画布。 */
  loadProjectJson: (json: string) => Promise<void>

  /** 切换到指定画板。 */
  switchArtboard: (artboardId: string) => Promise<void>
  /** 新建画板并切换过去，返回画板 id。 */
  addArtboard: () => Promise<string>
  /** 删除画板。 */
  deleteArtboard: (artboardId: string) => Promise<void>
  /** 重命名画板。 */
  renameArtboard: (artboardId: string, name: string) => void

  /** 导出优化 SVG 文本（不落盘）。includeBackground 为 true 时包含画布背景；artboardId 指定按该画板导出。 */
  exportSvgText: (options?: McpExportSvgTextOptions) => Promise<string>
  /** 导出 PNG/WebP dataURL（不落盘）。size 为输出宽度像素，format 默认 png。 */
  exportPngDataUrl: (options?: McpExportPngDataUrlOptions) => Promise<string>
  /**
   * 渲染画布快速预览图（透明底 PNG），语义为“给 AI 看的低成本视觉自检”：
   * 修改布局/样式后先用它确认效果，再决定是否继续精调或正式导出。
   * size 为输出宽度像素（默认 256），artboardId 指定按该画板渲染；
   * 提供 outputPath（绝对文件路径）时写入该文件并返回 filePath（不返回 dataUrl），未提供时返回 dataUrl。
   */
  getCanvasThumbnail: (options?: McpCanvasThumbnailOptions) => Promise<McpCanvasThumbnailResult>
  /** 导出 SVG 到下载目录或 outputDir（绝对目录），返回写入的文件路径。 */
  exportSvgFile: (options?: McpExportSvgFileOptions) => Promise<string>
  /** 导出 PNG/WebP 到下载目录或 outputDir（绝对目录），返回写入的文件路径。 */
  exportPngFile: (options?: McpExportPngFileOptions) => Promise<string>
  /** 按预设或自定义尺寸列表批量导出 PNG 文件，返回各尺寸文件路径与实际输出目录。 */
  exportSizeSet: (options: McpExportSizeSetOptions) => Promise<McpExportSizeSetResult>
  /** 渲染各尺寸 PNG 并打包为 ICO/ICNS 容器落盘，返回文件路径与实际尺寸列表。 */
  exportIconContainer: (options: McpExportIconContainerOptions) => Promise<McpExportIconContainerResult>
  /**
   * 对指定对象执行布尔运算：union/intersect/subtract/xor，subtractDirection 仅对 subtract 生效
   * （forward=按图层顺序 A-B，reverse=B-A）。objectIds 省略时使用当前选中对象；
   * 万花筒实例与布尔预览对象不参与运算，有效对象不足 2 个时抛错。
   * 返回结果对象 id（运算后自动选中）。
   */
  booleanOps: (
    objectIds: string[] | undefined,
    operation: 'union' | 'intersect' | 'subtract' | 'xor',
    subtractDirection?: 'forward' | 'reverse'
  ) => Promise<{ objectId: string; operation: 'union' | 'intersect' | 'subtract' | 'xor' }>

  /** 视口缩放；fit=true 时自动适配画布到可视区域。 */
  setViewport: (options: { zoom?: number; fit?: boolean }) => void

  /** 面向调试/兜底的逃生通道：在网关上下文执行自定义回调。 */
  runInEditor: <T>(fn: (editor: McpEditorGatewayInternals) => T | Promise<T>) => Promise<T>
}

/**
 * runInEditor 逃生通道注入的编辑器内部句柄。
 * 仅建议 AI 在标准操作不满足时使用，字段全部来自运行时闭包。
 */
export interface McpEditorGatewayInternals {
  fabricCanvas: import('fabric').Canvas | null
  activeObject: FabricObject | null
}

/**
 * 由 useHomeEditorRuntime 实现、MCP 网关持有的“能力提供者”接口。
 * 网关不做任何业务逻辑，只把 MCP 请求转发给该实现，
 * 因此编辑器内部重构不影响 MCP 协议层。
 */
export type McpEditorGatewayProvider = () => McpEditorGateway | null

/** MCP 网关暴露给页面的生命周期控制。 */
export interface McpGatewayController {
  /** 编辑器就绪后调用，绑定能力实现并尝试注册 MCP 工具。 */
  attach: (gateway: McpEditorGateway) => void
  /** 页面卸载时调用，解绑能力实现（工具注册保持不变，仅返回未就绪错误）。 */
  detach: () => void
  /** 工具是否已成功注册到 ZTools 宿主。 */
  isRegistered: () => boolean
}
