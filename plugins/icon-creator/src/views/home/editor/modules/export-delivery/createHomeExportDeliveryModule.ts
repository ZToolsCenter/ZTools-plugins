import { computed, reactive, ref } from 'vue'
import JSZip from 'jszip'
import { Canvas, Shadow, util, type FabricObject } from 'fabric'
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_DISPLAY_GROUPS,
  SHORTCUT_STORAGE_KEY,
  createDefaultShortcutBindings,
  formatShortcutForDisplay,
  getEditorPlatform,
  normalizeKeyboardEventShortcut,
  normalizeShortcutString,
  sanitizeShortcutBindings,
  type ShortcutActionDefinition,
  type ShortcutActionId,
  type ShortcutGroupId
} from '../../../shortcuts'
import type { EditorModule } from '../../runtime/editorTypes'
import type { AnyFabricObject } from '../../../fabric/objectMetadata'
import { SERIALIZED_OBJECT_PROPS } from '../../../fabric/objectMetadata'
import { buildIcoFile, buildIcnsFile, ICO_MAX_SIZE, ICNS_MAX_SIZE, type IconContainerFrame } from '../../../fabric/iconContainer'
import { ensureOptimizedSVGRoot, stripFabricSVGNoise, svgEscapeText, trimSVGWhitespace } from '../../../exportUtils'
import { fabricStrokeToPathKitWithApi, type FabricBooleanStyleSnapshot } from '../../../geometry/fabricToPathKit'
import { getPathKit, type PathKitApi } from '../../../geometry/pathkit'
import { pathKitToFabricPath } from '../../../geometry/pathKitToFabric'
import type { ExportDialogState, ExportFormat, IconCreatorProjectArtboard, InternalClipboard } from '../../../types'
import type {
  ExportIconContainerRequest,
  ExportIconContainerResult,
  ExportSizeSetRequest,
  ExportSizeSetResult,
  HomeExportDeliveryClipboardOptions,
  HomeExportDeliveryController,
  HomeExportDeliveryExportOptions,
  HomeExportDeliveryShortcutOptions
} from './exportDeliveryTypes'

export interface CreateHomeExportDeliveryModuleOptions {
  clipboard: HomeExportDeliveryClipboardOptions
  exportWorkflow: HomeExportDeliveryExportOptions
  shortcut: HomeExportDeliveryShortcutOptions
}

export interface CreateHomeExportDeliveryModuleResult {
  controller: HomeExportDeliveryController
  module: EditorModule
}

type ExportPresetId = 'favicon' | 'pwa' | 'android' | 'ios' | 'electron'

const EXPORT_PRESET_SIZES: Record<ExportPresetId, number[]> = {
  favicon: [16, 32, 48, 64, 128, 256],
  pwa: [72, 96, 128, 144, 152, 192, 384, 512],
  android: [48, 72, 96, 144, 192, 512],
  ios: [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024],
  electron: [16, 24, 32, 48, 64, 128, 256, 512, 1024]
}

/**
 * 创建 Home 编辑器的 Export / Clipboard / Shortcut 模块，集中管理输出文件、剪贴板和快捷键抽屉工作流。
 * 页面层只消费模块状态与命令，导出文件命名、批量画板 ZIP、系统剪贴板写入和快捷键持久化都在模块内编排。
 */
export function createHomeExportDeliveryModule(
  options: CreateHomeExportDeliveryModuleOptions
): CreateHomeExportDeliveryModuleResult {
  let internalClipboard: InternalClipboard | null = null
  const shortcutDrawerOpen = ref(false)
  const shortcutSearch = ref('')
  const shortcutPlatform = getEditorPlatform()
  const shortcutBindings = reactive<Record<ShortcutActionId, string[]>>(createDefaultShortcutBindings(shortcutPlatform))
  const exportDialog = reactive<ExportDialogState>({
    show: false,
    svgEnabled: true,
    svgIncludeBg: false,
    pngEnabled: true,
    pngSizes: [64, 128, 256],
    customSizeInput: '',
    transparentBg: false,
    filePrefix: 'icon',
    exportAllArtboards: false,
    status: '',
    loading: false
  })
  const exportDialogSelectedPreset = ref('')

  /**
   * 规范导出文件名前缀，避免空值或非法文件名字符影响下载目录写入。
   */
  function getExportFilePrefix() {
    return sanitizeExportFilePrefix(exportDialog.filePrefix)
  }

  /**
   * 把任意输入规范化为安全的文件名前缀：替换路径分隔符与非法字符，空值回退为 'icon'。
   */
  function sanitizeExportFilePrefix(raw: string) {
    const normalized = String(raw ?? '').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    return normalized || 'icon'
  }

  /**
   * 将用户输入的 PNG 尺寸约束到可导出的安全整数范围，非法值返回 null 供上层忽略。
   */
  function normalizeExportPngSize(value: unknown) {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return Math.min(4096, Math.max(1, parsed))
  }

  /**
   * 合并预设尺寸和自定义尺寸，去重后升序输出，作为批量 PNG 导出的最终尺寸列表。
   */
  function getExportPngSizes() {
    const sizes = new Set<number>()
    exportDialog.pngSizes.forEach((size) => {
      const normalized = normalizeExportPngSize(size)
      if (normalized) sizes.add(normalized)
    })
    const customSize = normalizeExportPngSize(exportDialog.customSizeInput.trim())
    if (customSize) sizes.add(customSize)
    return Array.from(sizes).sort((a, b) => a - b)
  }

  const exportDialogCanExport = computed(() => (
    exportDialog.svgEnabled || (exportDialog.pngEnabled && getExportPngSizes().length > 0)
  ))

  /**
   * 打开导出面板并清空上一次状态，保留用户上次选择的格式、尺寸和文件名前缀。
   */
  function openExportDialog() {
    exportDialog.show = true
    exportDialog.status = ''
  }

  /**
   * 关闭导出面板时结束加载状态；导出结果文本会在下一次打开时重置。
   */
  function handleExportDialogShowChange(show: boolean) {
    exportDialog.show = show
    if (!show) exportDialog.loading = false
  }

  /**
   * 控制导出格式开关，允许临时全部取消，此时导出按钮会被禁用。
   */
  function setExportFormatEnabled(format: ExportFormat, enabled: boolean) {
    if (format === 'svg') exportDialog.svgEnabled = enabled
    else exportDialog.pngEnabled = enabled
    exportDialog.status = ''
  }

  /**
   * 根据导出选项生成画布背景矩形；透明背景或未勾选保留背景时不输出额外节点。
   */
  function getOptimizedSVGBackgroundMarkup(includeBackground: boolean) {
    if (!includeBackground || options.exportWorkflow.isTransparentCanvasBg(options.exportWorkflow.canvasBg.value)) return ''
    return `<rect width="100%" height="100%" fill="${svgEscapeText(options.exportWorkflow.canvasBg.value)}"/>`
  }

  function isVisiblePaint(value: unknown) {
    if (value == null) return false
    if (typeof value !== 'string') return true
    const normalized = value.trim().toLowerCase()
    return normalized !== '' && normalized !== 'none' && normalized !== 'transparent'
  }

  function isStrokeEnabled(obj: FabricObject) {
    return isVisiblePaint(obj.stroke) && Number(obj.strokeWidth || 0) > 0
  }

  function normalizeStrokeDashArray(value: unknown) {
    if (!Array.isArray(value)) return null
    const numeric = value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0)
    if (!numeric.length) return null
    return [numeric[0], numeric[1] ?? numeric[0]]
  }

  function createStrokeOutlineStyle(style: FabricBooleanStyleSnapshot): FabricBooleanStyleSnapshot {
    const fill = typeof style.stroke === 'string' && isVisiblePaint(style.stroke)
      ? style.stroke
      : style.lastStroke || '#000000'
    return {
      ...style,
      fill,
      stroke: 'transparent',
      strokeWidth: 0,
      strokeDashArray: null,
      lastFill: fill,
      fillMode: 'solid',
      fillGradientType: undefined,
      fillGradientStops: undefined,
      fillGradientAngle: undefined,
      fillGradientCenterX: undefined,
      fillGradientCenterY: undefined,
      fillGradientRadius: undefined
    }
  }

  function shouldKeepFilledSource(obj: FabricObject) {
    return obj.type !== 'line' && isVisiblePaint(obj.fill)
  }

  async function cloneCanvasForSVG(sourceCanvas: Canvas, width: number, height: number) {
    const tempCanvas = new Canvas(null as unknown as HTMLCanvasElement, {
      width,
      height,
      backgroundColor: ''
    })
    const sourceObjects = sourceCanvas.getObjects()
      .filter((obj) => !(obj as AnyFabricObject).excludeFromExport)
    const clones = await Promise.all(sourceObjects.map((obj) => obj.clone(SERIALIZED_OBJECT_PROPS as unknown as string[]))) as FabricObject[]
    clones.forEach((clone) => tempCanvas.add(clone as AnyFabricObject))
    return tempCanvas
  }

  function tryReplaceObjectStrokeWithOutline(canvas: Canvas, pathKit: PathKitApi, obj: FabricObject) {
    if (!canvas.getObjects().includes(obj)) return
    if (!isStrokeEnabled(obj) || normalizeStrokeDashArray(obj.strokeDashArray)?.length) return
    const converted = fabricStrokeToPathKitWithApi(pathKit, obj)
    if (converted.error || !converted.path || !converted.style) return
    try {
      const sourceIndex = Math.max(0, canvas.getObjects().indexOf(obj))
      const outline = pathKitToFabricPath(converted.path, {
        name: `${String((obj as AnyFabricObject).name || obj.type || '对象')} 轮廓`,
        shapeId: 'stroke-outline',
        style: createStrokeOutlineStyle(converted.style),
        sourceCornerRadius: null
      })
      if (!outline) return
      if (shouldKeepFilledSource(obj)) {
        obj.set({ stroke: 'transparent', strokeWidth: 0, strokeDashArray: null })
        ;(obj as AnyFabricObject).lastStroke = converted.style.lastStroke
        ;(obj as AnyFabricObject).lastStrokeWidth = converted.style.lastStrokeWidth
        obj.dirty = true
        obj.setCoords()
        canvas.insertAt(Math.min(sourceIndex + 1, canvas.getObjects().length), outline as AnyFabricObject)
      } else {
        // 描边型对象被轮廓路径整体替换时，阴影必须跟随迁移：
        // shadowEffects 元数据供 multiShadow 多阴影渲染/SVG 导出读取，原生 shadow 供单投影场景使用，
        // 否则描边型图标的阴影会在 SVG 导出中丢失
        const sourceAny = obj as AnyFabricObject
        const outlineAny = outline as AnyFabricObject
        if (Array.isArray(sourceAny.shadowEffects)) {
          outlineAny.shadowEffects = sourceAny.shadowEffects.map(effect => ({ ...effect }))
        }
        outlineAny.shadow = sourceAny.shadow
          ? new Shadow({ ...(sourceAny.shadow as Shadow).toObject() })
          : null
        canvas.remove(obj as AnyFabricObject)
        canvas.insertAt(Math.min(sourceIndex, canvas.getObjects().length), outline as AnyFabricObject)
      }
    } finally {
      converted.path.delete()
    }
  }

  async function outlineSVGCanvasStrokes(canvas: Canvas) {
    const pathKit = await getPathKit()
    const objects = [...canvas.getObjects()]
    objects.forEach((obj) => tryReplaceObjectStrokeWithOutline(canvas, pathKit, obj))
  }

  async function createOptimizedSVGFromCanvas(sourceCanvas: Canvas, width: number, height: number, backgroundMarkup = '') {
    const tempCanvas = await cloneCanvasForSVG(sourceCanvas, width, height)
    try {
      await outlineSVGCanvasStrokes(tempCanvas)
      tempCanvas.requestRenderAll()
      const rawSvg = tempCanvas.toSVG({
        suppressPreamble: true,
        viewBox: { x: 0, y: 0, width, height },
        width: String(width),
        height: String(height)
      })
      return trimSVGWhitespace(ensureOptimizedSVGRoot(
        stripFabricSVGNoise(rawSvg),
        width,
        height,
        backgroundMarkup
      ))
    } finally {
      tempCanvas.dispose()
    }
  }

  /**
   * 生成选中对象的优化 SVG 文本：基于临时裁剪画布输出，未选中时回退为整画布 SVG。
   * 供 MCP 选中导出与后续只读消费场景复用，不触碰系统剪贴板。
   */
  async function createSelectionSvgText() {
    const fabricCanvas = options.exportWorkflow.getFabricCanvas()
    if (!fabricCanvas) return ''
    const selectedObjects = fabricCanvas.getActiveObjects()
    if (!selectedObjects.length) return createOptimizedSVG(false)
    const tempCanvas = await createSelectionCanvas(selectedObjects)
    if (!tempCanvas) return ''
    try {
      return await createOptimizedSVGFromCanvas(tempCanvas, tempCanvas.width!, tempCanvas.height!, '')
    } finally {
      tempCanvas.dispose()
    }
  }

  /**
   * 将 Fabric 原始 SVG 输出压缩为更适合交付的图标资源：规范根节点、viewBox、可选背景并移除冗余元数据。
   */
  async function createOptimizedSVG(includeBackground = false) {    const fabricCanvas = options.exportWorkflow.getFabricCanvas()
    if (!fabricCanvas) return ''
    return createOptimizedSVGFromCanvas(
      fabricCanvas,
      options.exportWorkflow.canvasWidth.value,
      options.exportWorkflow.canvasHeight.value,
      getOptimizedSVGBackgroundMarkup(includeBackground)
    )
  }

  /**
   * 把指定画板临时加载到当前 Fabric 画布后执行导出任务，结束后由调用方负责恢复原画板内容。
   */
  async function withLoadedArtboardForExport<T>(artboard: IconCreatorProjectArtboard, callback: () => T | Promise<T>) {
    await options.exportWorkflow.loadArtboardContent(artboard)
    return callback()
  }

  /**
   * 生成适合目录或文件名使用的画板名称，避免多画板 ZIP 内出现路径分隔符和空名称。
   */
  function sanitizeExportEntryName(value: string, fallback: string) {
    const normalized = value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '-')
    return normalized || fallback
  }

  /**
   * 为 ZIP 条目路径追加序号，确保同名画板或重复尺寸不会在压缩包内互相覆盖。
   */
  function createUniqueZipEntryName(name: string, usedNames: Set<string>) {
    const normalized = name.replace(/\\/g, '/')
    if (!usedNames.has(normalized)) {
      usedNames.add(normalized)
      return normalized
    }
    const slashIndex = normalized.lastIndexOf('/')
    const directory = slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : ''
    const fileName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
    const dotIndex = fileName.lastIndexOf('.')
    const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
    const ext = dotIndex > 0 ? fileName.slice(dotIndex) : ''
    let index = 1
    let candidate = `${directory}${base}-${index}${ext}`
    while (usedNames.has(candidate)) {
      index += 1
      candidate = `${directory}${base}-${index}${ext}`
    }
    usedNames.add(candidate)
    return candidate
  }

  /**
   * 将 dataURL 转为 ZIP 可直接写入的 base64 内容，过滤异常渲染结果以便导出流程报错。
   */
  function getBase64PayloadFromDataUrl(dataUrl: string) {
    const match = /^data:[^;]+;base64,(.*)$/i.exec(dataUrl)
    if (!match) throw new Error('PNG 渲染结果无效')
    return match[1]
  }

  /** 返回位图格式对应的文件扩展名（含点号）。 */
  function extForFormat(format: 'png' | 'webp') {
    return format === 'webp' ? '.webp' : '.png'
  }

  /**
   * 规范化文件名并确保以指定扩展名结尾：替换非法字符，已带目标扩展名时不重复追加。
   */
  function withExtension(fileName: string, ext: string) {
    const normalized = String(fileName ?? '').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    const base = normalized || 'icon'
    return base.toLowerCase().endsWith(ext) ? base : base + ext
  }

  /**
   * 校验输出目录必须为绝对路径（盘符、UNC 或 POSIX 根），渲染进程没有 path 模块，
   * 由调用方保证目录合法性以避免相对路径意外写入工作目录。
   */
  function assertAbsoluteOutputDir(outputDir: string) {
    if (!/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(outputDir)) {
      throw new Error(`输出目录必须是绝对路径: ${outputDir}`)
    }
  }

  /** 拼接输出目录与文件名：去掉目录尾部多余的分隔符后以 / 连接（Windows 文件系统同样接受）。 */
  function joinOutputPath(outputDir: string, fileName: string) {
    assertAbsoluteOutputDir(outputDir)
    return `${outputDir.replace(/[\\/]+$/, '')}/${fileName}`
  }

  /** 读取系统下载目录，供导出结果回显实际输出位置。 */
  function getDownloadsDir() {
    try {
      return window.ztools?.getPath?.('downloads') || ''
    } catch {
      return ''
    }
  }

  /** 把 base64 字节转换为 Uint8Array，用于容器格式打包。 */
  function base64ToUint8Array(base64: string) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  /** 把 Uint8Array 分块转换为 base64，避免 String.fromCharCode 展开超大栈参数。 */
  function uint8ArrayToBase64(bytes: Uint8Array) {
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
  }

  /**
   * 规范化尺寸列表：四舍五入取整、去重升序，并校验落在 1..maxSize 区间内，
   * 非法值直接抛错（面向程序化调用，静默截断更容易掩盖错误）。
   */
  function normalizeExportSizeList(rawSizes: number[], maxSize: number) {
    const sizes = new Set<number>()
    for (const raw of rawSizes) {
      const parsed = Math.round(Number(raw))
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > maxSize) {
        throw new Error(`尺寸必须是 1-${maxSize} 的整数: ${raw}`)
      }
      sizes.add(parsed)
    }
    if (!sizes.size) throw new Error('至少需要一个有效尺寸')
    return Array.from(sizes).sort((a, b) => a - b)
  }

  /**
   * 按预设或自定义尺寸列表批量导出 PNG（始终透明背景由调用方 transparentBackground 决定），
   * 逐尺寸复用 exportPNG 单文件导出，保证与导出面板一致的命名与落盘行为。
   * 返回每个尺寸的文件路径（升序）与实际输出目录。
   */
  function exportSizeSet(request: ExportSizeSetRequest): ExportSizeSetResult {
    const presetId = request.preset && request.preset !== 'custom'
      ? (request.preset as keyof typeof EXPORT_PRESET_SIZES)
      : undefined
    if (request.preset && request.preset !== 'custom' && !presetId) {
      throw new Error(`未知导出预设: ${request.preset}。可用预设: ${Object.keys(EXPORT_PRESET_SIZES).join(', ')}, custom`)
    }
    const presetSizes = presetId ? EXPORT_PRESET_SIZES[presetId] : undefined
    const rawSizes = request.sizes?.length ? request.sizes : presetSizes
    if (!rawSizes?.length) {
      throw new Error(`preset=custom 时必须提供 sizes（1-4096 的整数数组）`)
    }
    const sizes = normalizeExportSizeList(rawSizes, 4096)
    const prefix = sanitizeExportFilePrefix(request.fileNamePrefix ?? 'icon')
    const transparentBackground = request.transparentBackground ?? false
    const outputDir = request.outputDir ? request.outputDir.replace(/[\\/]+$/, '') : getDownloadsDir()

    const files = sizes.map((size) => {
      const fileName = `${prefix}-${size}.png`
      const filePath = exportPNG(size, fileName, transparentBackground, 'png', 0.92, request.outputDir)
      if (!filePath) throw new Error(`导出 ${size}px PNG 失败`)
      return { size, filePath }
    })
    return { files, outputDir }
  }

  /**
   * 渲染各尺寸透明 PNG 并打包为 ICO/ICNS 容器落盘。
   * ICO 帧尺寸上限 256、ICNS 上限 512；未提供 sizes 时使用该格式的常用默认尺寸集。
   * 返回写入的文件路径与实际打包的升序尺寸列表。
   */
  function exportIconContainer(request: ExportIconContainerRequest): ExportIconContainerResult {
    if (request.format !== 'ico' && request.format !== 'icns') {
      throw new Error(`format 必须是 ico 或 icns: ${request.format}`)
    }
    const maxSize = request.format === 'ico' ? ICO_MAX_SIZE : ICNS_MAX_SIZE
    const defaultSizes = request.format === 'ico' ? [16, 24, 32, 48, 64, 128, 256] : [16, 32, 64, 128, 256, 512]
    const sizes = normalizeExportSizeList(request.sizes?.length ? request.sizes : defaultSizes, maxSize)

    const frames: IconContainerFrame[] = sizes.map((size) => {
      const dataUrl = renderPNGDataUrl(size, true, 'png')
      if (!dataUrl) throw new Error(`渲染 ${size}px PNG 失败`)
      return { size, png: base64ToUint8Array(getBase64PayloadFromDataUrl(dataUrl)) }
    })
    const bytes = request.format === 'ico' ? buildIcoFile(frames) : buildIcnsFile(frames)
    const fileName = withExtension(request.fileName ?? 'icon', request.format === 'ico' ? '.ico' : '.icns')
    const base64 = uint8ArrayToBase64(bytes)
    const filePath = request.outputDir
      ? window.services?.writeBinaryFileToPath?.(base64, joinOutputPath(request.outputDir, fileName)) || ''
      : window.services?.writeBinaryFile?.(base64, fileName) || ''
    if (!filePath) throw new Error(`导出 ${request.format.toUpperCase()} 失败`)
    return { filePath, sizes }
  }

  /**
   * 把指定画板临时加载到当前画布执行回调，结束后恢复执行前的完整工程状态
   * （复用多画板 ZIP 导出的“快照-加载-还原”路径，不产生额外撤销记录）。
   * 目标画板即当前画板时直接执行；画板 id 不存在时抛错。
   */
  async function withArtboardExport<T>(artboardId: string, run: () => T | Promise<T>): Promise<T> {
    if (!options.exportWorkflow.getFabricCanvas()) throw new Error('画布尚未初始化')
    const target = options.exportWorkflow.artboards.value.find((artboard) => artboard.id === artboardId)
    if (!target) {
      throw new Error(`未找到画板: ${artboardId}`)
    }
    if (artboardId === options.exportWorkflow.activeArtboardId.value) {
      return run()
    }
    const originalProject = options.exportWorkflow.createProjectFile()
    try {
      await options.exportWorkflow.loadArtboardContent(target)
      return await run()
    } finally {
      await options.exportWorkflow.loadProjectFile(originalProject, { keepDraft: true, resetHistory: false })
    }
  }

  /**
   * 收集多画板导出的对象列表；导出所有画板时先捕获当前画板，确保 ZIP 使用最新编辑状态。
   */
  function getExportTargetArtboards() {
    if (!exportDialog.exportAllArtboards || options.exportWorkflow.artboards.value.length <= 1) return []
    if (options.exportWorkflow.activeArtboardId.value) {
      const currentIndex = options.exportWorkflow.artboards.value.findIndex((artboard) => artboard.id === options.exportWorkflow.activeArtboardId.value)
      if (currentIndex >= 0) options.exportWorkflow.artboards.value[currentIndex] = options.exportWorkflow.captureCurrentArtboard()
    }
    return options.exportWorkflow.artboards.value.map((artboard) => ({
      ...artboard,
      canvas: { ...artboard.canvas },
      fabric: JSON.parse(JSON.stringify(artboard.fabric)) as Record<string, unknown>,
      layerOrder: [...artboard.layerOrder]
    }))
  }

  /**
   * 为单个画板向 ZIP 写入 SVG 与多尺寸 PNG，按画板目录分组以保证图标集合结构清晰。
   */
  async function addArtboardExportEntriesToZip(
    zip: JSZip,
    artboard: IconCreatorProjectArtboard,
    index: number,
    prefix: string,
    pngSizes: number[],
    usedNames: Set<string>
  ) {
    const artboardName = sanitizeExportEntryName(artboard.name, `artboard-${index + 1}`)
    const folderName = `${String(index + 1).padStart(2, '0')}-${artboardName}`
    await withLoadedArtboardForExport(artboard, async () => {
      if (exportDialog.svgEnabled) {
        zip.file(
          createUniqueZipEntryName(`${folderName}/${prefix}.svg`, usedNames),
          await createOptimizedSVG(exportDialog.svgIncludeBg)
        )
      }
      if (exportDialog.pngEnabled) {
        pngSizes.forEach((size) => {
          zip.file(
            createUniqueZipEntryName(`${folderName}/${prefix}-${size}.png`, usedNames),
            getBase64PayloadFromDataUrl(renderPNGDataUrl(size, exportDialog.transparentBg)),
            { base64: true }
          )
        })
      }
    })
  }

  /**
   * 将全部画板按当前导出配置打包为 ZIP，并恢复用户原来正在编辑的画板，避免批量导出破坏工作现场。
   */
  async function exportAllArtboardsZip(prefix: string, pngSizes: number[]) {
    if (!options.exportWorkflow.getFabricCanvas()) return ''
    const originalProject = options.exportWorkflow.createProjectFile()
    const targets = getExportTargetArtboards()
    if (!targets.length) return ''
    const zip = new JSZip()
    const usedNames = new Set<string>()

    try {
      for (const [index, artboard] of targets.entries()) {
        await addArtboardExportEntriesToZip(zip, artboard, index, prefix, pngSizes, usedNames)
      }
    } finally {
      await options.exportWorkflow.loadProjectFile(originalProject, { keepDraft: true, resetHistory: false })
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    return window.services?.writeZipFile?.(blob, `${prefix}-artboards.zip`) || ''
  }

  /**
   * 切换预设 PNG 尺寸并保持尺寸列表升序，便于导出状态和文件名稳定可读。
   */
  function toggleExportPngSize(size: number) {
    const normalized = normalizeExportPngSize(size)
    if (!normalized) return
    if (exportDialog.pngSizes.includes(normalized)) {
      exportDialog.pngSizes = exportDialog.pngSizes.filter((item) => item !== normalized)
    } else {
      exportDialog.pngSizes = [...exportDialog.pngSizes, normalized].sort((a, b) => a - b)
    }
    exportDialog.status = ''
  }

  /**
   * 应用图标套装预设，快速填充目标平台常用 PNG 尺寸并默认开启透明背景。
   */
  function handleExportPresetSelect(presetId: string) {
    exportDialogSelectedPreset.value = presetId
    if (!presetId) return
    const sizes = EXPORT_PRESET_SIZES[presetId as ExportPresetId]
    if (sizes) {
      exportDialog.pngEnabled = true
      exportDialog.pngSizes = sizes
      exportDialog.transparentBg = true
    }
  }

  /**
   * 生成当前整张画布的优化 SVG 文本，供 SVG 模式只读预览等纯文本消费场景复用。
   */
  function createCanvasSVGPreview(includeBackground = false) {
    return createOptimizedSVG(includeBackground)
  }

  /**
   * 导出优化后的 SVG 到下载目录或指定绝对目录（outputDir，同名覆盖），
   * 支持导出面板传入自定义文件名和是否保留画布背景。
   */
  async function exportSVG(fileName?: string, includeBackground = false, outputDir?: string) {
    if (!options.exportWorkflow.getFabricCanvas()) return ''
    options.exportWorkflow.clearBooleanPreview()
    const svgText = await createOptimizedSVG(includeBackground)
    if (outputDir) {
      return window.services?.writeTextFileToPath?.(svgText, joinOutputPath(outputDir, withExtension(fileName ?? 'icon', '.svg'))) || ''
    }
    return window.services?.writeSvgFile?.(svgText, fileName) || ''
  }

  /**
   * 在不改变当前编辑视图的前提下渲染指定宽度的位图 dataURL，并可临时移除背景色实现透明导出。
   * format 支持 png/webp（默认 png，向后兼容），quality 仅对 webp 有损压缩生效（0-1，默认 0.92）。
   */
  function renderPNGDataUrl(size: number, transparentBackground: boolean, format: 'png' | 'webp' = 'png', quality = 0.92) {
    const fabricCanvas = options.exportWorkflow.getFabricCanvas()
    if (!fabricCanvas) return ''
    const currentZoom = fabricCanvas.getZoom()
    const currentWidth = fabricCanvas.getWidth()
    const currentHeight = fabricCanvas.getHeight()
    const currentBg = fabricCanvas.backgroundColor
    const multiplier = size / options.exportWorkflow.canvasWidth.value
    try {
      fabricCanvas.setZoom(1)
      fabricCanvas.setDimensions({ width: options.exportWorkflow.canvasWidth.value, height: options.exportWorkflow.canvasHeight.value })
      if (transparentBackground) fabricCanvas.backgroundColor = ''
      fabricCanvas.requestRenderAll()
      return fabricCanvas.toDataURL({ format, multiplier, quality })
    } finally {
      fabricCanvas.backgroundColor = currentBg
      fabricCanvas.setZoom(currentZoom)
      fabricCanvas.setDimensions({ width: currentWidth, height: currentHeight })
      fabricCanvas.requestRenderAll()
    }
  }

  /**
   * 导出单个位图文件，size 表示输出宽度；format 决定 PNG/WebP 编码，
   * 指定 outputDir（绝对目录）时写入该目录（同名覆盖），缺省写入下载目录（自动避让同名文件）。
   * 返回写入的文件绝对路径，渲染失败返回空字符串。
   */
  function exportPNG(
    size = options.exportWorkflow.canvasWidth.value,
    fileName?: string,
    transparentBackground = false,
    format: 'png' | 'webp' = 'png',
    quality = 0.92,
    outputDir?: string
  ) {
    if (!options.exportWorkflow.getFabricCanvas()) return ''
    options.exportWorkflow.clearBooleanPreview()
    const normalizedSize = normalizeExportPngSize(size) ?? options.exportWorkflow.canvasWidth.value
    const dataUrl = renderPNGDataUrl(normalizedSize, transparentBackground, format, quality)
    if (!dataUrl) return ''
    if (outputDir) {
      return window.services?.writeImageFileToPath?.(dataUrl, joinOutputPath(outputDir, withExtension(fileName ?? 'icon', extForFormat(format)))) || ''
    }
    return window.services?.writeImageFile?.(dataUrl, fileName) || ''
  }

  /**
   * 创建仅包含选中对象的临时画布，用于复制为 SVG/PNG 时生成裁剪后的内容。
   */
  async function createSelectionCanvas(objects: FabricObject[]) {
    if (!objects.length) return null
    const bounds = options.exportWorkflow.getObjectsCombinedBounds(objects)
    if (!bounds) return null
    const tempCanvas = new Canvas(null as unknown as HTMLCanvasElement, {
      width: bounds.width,
      height: bounds.height,
      backgroundColor: ''
    })
    for (const obj of objects) {
      // 带上序列化元数据：多阴影等自绘效果依赖 shadowEffects 元数据在临时画布上继续生效
      const clone = await obj.clone(SERIALIZED_OBJECT_PROPS as unknown as string[])
      clone.set({
        left: (clone.left ?? 0) - bounds.left,
        top: (clone.top ?? 0) - bounds.top
      })
      tempCanvas.add(clone)
    }
    tempCanvas.requestRenderAll()
    return tempCanvas
  }

  /**
   * 复制当前画布或选中对象为 SVG 到剪贴板。
   */
  async function copyAsSVG() {
    const fabricCanvas = options.exportWorkflow.getFabricCanvas()
    if (!fabricCanvas) return
    options.exportWorkflow.clearBooleanPreview()
    const selectedObjects = fabricCanvas.getActiveObjects()
    let svgContent = ''
    if (selectedObjects.length > 0) {
      const tempCanvas = await createSelectionCanvas(selectedObjects)
      if (!tempCanvas) {
        options.shortcut.showToast('无法复制选中对象：边界无效', 'error')
        return
      }
      try {
        svgContent = await createOptimizedSVGFromCanvas(tempCanvas, tempCanvas.width!, tempCanvas.height!, '')
      } finally {
        tempCanvas.dispose()
      }
    } else {
      svgContent = await createOptimizedSVG(false)
    }
    if (!svgContent) {
      options.shortcut.showToast('生成 SVG 失败', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(svgContent)
      options.shortcut.showToast('已复制 SVG 到剪贴板', 'success')
    } catch (error) {
      options.shortcut.showToast('复制到剪贴板失败：' + (error instanceof Error ? error.message : '未知错误'), 'error')
    }
  }

  /**
   * 复制当前画布或选中对象为 PNG 到剪贴板。
   */
  async function copyAsPNG() {
    const fabricCanvas = options.exportWorkflow.getFabricCanvas()
    if (!fabricCanvas) return
    options.exportWorkflow.clearBooleanPreview()
    const selectedObjects = fabricCanvas.getActiveObjects()
    let dataUrl = ''
    if (selectedObjects.length > 0) {
      const tempCanvas = await createSelectionCanvas(selectedObjects)
      if (!tempCanvas) {
        options.shortcut.showToast('无法复制选中对象：边界无效', 'error')
        return
      }
      try {
        dataUrl = tempCanvas.toDataURL({ format: 'png', multiplier: 1 })
      } finally {
        tempCanvas.dispose()
      }
    } else {
      dataUrl = renderPNGDataUrl(options.exportWorkflow.canvasWidth.value, true)
    }
    if (!dataUrl) {
      options.shortcut.showToast('生成 PNG 失败', 'error')
      return
    }
    try {
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ])
      options.shortcut.showToast('已复制 PNG 到剪贴板', 'success')
    } catch (error) {
      options.shortcut.showToast('复制到剪贴板失败：' + (error instanceof Error ? error.message : '未知错误'), 'error')
    }
  }

  /**
   * 按导出面板配置批量输出 SVG 和多尺寸 PNG，并在面板内展示保存路径或错误信息。
   */
  async function runExportDialogExport() {
    if (!options.exportWorkflow.getFabricCanvas() || exportDialog.loading) return
    const pngSizes = getExportPngSizes()
    if (!exportDialog.svgEnabled && (!exportDialog.pngEnabled || !pngSizes.length)) {
      exportDialog.status = '请至少选择一种导出格式或一个 PNG 尺寸。'
      return
    }
    exportDialog.loading = true
    exportDialog.status = ''
    try {
      const prefix = getExportFilePrefix()
      const paths: string[] = []
      if (exportDialog.exportAllArtboards && options.exportWorkflow.artboards.value.length > 1) {
        const path = await exportAllArtboardsZip(prefix, pngSizes)
        if (path) paths.push(path)
      } else {
        if (exportDialog.svgEnabled) {
          const path = await exportSVG(`${prefix}.svg`, exportDialog.svgIncludeBg)
          if (path) paths.push(path)
        }
        if (exportDialog.pngEnabled) {
          pngSizes.forEach((size) => {
            const path = exportPNG(size, `${prefix}-${size}.png`, exportDialog.transparentBg)
            if (path) paths.push(path)
          })
        }
      }
      exportDialog.status = paths.length
        ? `导出成功：\n${paths.join('\n')}`
        : '导出失败：未生成任何文件。'
    } catch (error) {
      exportDialog.status = error instanceof Error ? error.message : '导出失败'
    } finally {
      exportDialog.loading = false
    }
  }

  /**
   * 根据内部剪贴板条目克隆 Fabric 对象，并重置副本名称、主题和万花筒源实例元数据。
   */
  async function cloneClipboardEntry(entry: InternalClipboard['entries'][number], offset: number) {
    const [clone] = await util.enlivenObjects([entry.object]) as FabricObject[]
    clone.set({
      left: (clone.left ?? 0) + offset,
      top: (clone.top ?? 0) + offset,
      name: options.clipboard.nextName(`${entry.sourceName} 副本`)
    })
    options.clipboard.prepareClonedObjectMetadata(clone)
    options.clipboard.applyCanvasThemeToObject(clone)
    options.clipboard.applyDefaultKaleidoscopeMetadata(clone)
    options.clipboard.applyGradientMetadataToCanvasObject(clone)
    const metadata = options.clipboard.getKaleidoscopeMetadata(clone)
    if (entry.kaleidoscopeEnabled && !entry.sourceMissing && options.clipboard.canUseKaleidoscopeAsSource(clone)) {
      const center = options.clipboard.getKaleidoscopeEffectiveCenter(clone)
      metadata!.kaleidoscopeEnabled = true
      metadata!.kaleidoscopeSourceId = options.clipboard.createKaleidoscopeSourceId()
      metadata!.kaleidoscopeManaged = false
      metadata!.kaleidoscopeInstanceOf = ''
      metadata!.kaleidoscopeInstanceIndex = 0
      metadata!.kaleidoscopeCenterX = center.x + offset
      metadata!.kaleidoscopeCenterY = center.y + offset
      metadata!.kaleidoscopeCount = options.clipboard.normalizeKaleidoscopeCount(metadata!.kaleidoscopeCount)
    } else {
      options.clipboard.clearKaleidoscopeMetadata(clone)
    }
    clone.setCoords()
    return clone
  }

  /**
   * 把当前可复制目标写入编辑器内部剪贴板，供快捷键粘贴和重复粘贴偏移复用。
   */
  function copySelectionToInternalClipboard() {
    const targets = options.clipboard.getCurrentCopyTargets()
    if (!targets.length) return false
    internalClipboard = {
      entries: targets.map(options.clipboard.createClipboardEntry),
      pasteCount: 0
    }
    return true
  }

  /**
   * 从内部剪贴板粘贴对象到当前画布，按粘贴次数递增偏移并恢复选中、图层和快照状态。
   */
  async function pasteInternalClipboard(clipboard = internalClipboard) {
    const fabricCanvas = options.clipboard.getFabricCanvas()
    if (!fabricCanvas || !clipboard?.entries.length) return false
    options.clipboard.clearBooleanPreview()
    options.clipboard.clearPointEditing()
    const offset = 16 * (clipboard.pasteCount + 1)
    const pasted: FabricObject[] = []
    const previousSnapshotGate = options.clipboard.snapshotGate.get()
    options.clipboard.snapshotGate.set(true)
    try {
      for (const entry of clipboard.entries) {
        const clone = await cloneClipboardEntry(entry, offset)
        pasted.push(clone)
        fabricCanvas.add(clone as AnyFabricObject)
        if (options.clipboard.isKaleidoscopeSource(clone)) {
          await options.clipboard.rebuildKaleidoscopeInstances(clone)
        }
      }
    } finally {
      options.clipboard.snapshotGate.set(previousSnapshotGate)
    }
    clipboard.pasteCount += 1
    options.clipboard.setSelectionMode('shape')
    options.clipboard.applyActiveObjectsSelection(pasted)
    options.clipboard.refreshLayers()
    fabricCanvas.requestRenderAll()
    options.clipboard.snapshot()
    return true
  }

  /**
   * 复制当前选择并立即粘贴副本，不覆盖用户已保存的内部剪贴板内容。
   */
  async function duplicateSelection() {
    const targets = options.clipboard.getCurrentCopyTargets()
    if (!targets.length) return false
    const tempClipboard: InternalClipboard = {
      entries: targets.map(options.clipboard.createClipboardEntry),
      pasteCount: 0
    }
    return pasteInternalClipboard(tempClipboard)
  }

  /**
   * 用指定快捷键表覆盖当前响应式记录，保持抽屉和全局监听共享同一份配置。
   */
  function assignShortcutBindings(next: Record<ShortcutActionId, string[]>) {
    SHORTCUT_ACTIONS.forEach((action) => {
      shortcutBindings[action.id] = [...next[action.id]]
    })
  }

  /**
   * 启动时加载用户快捷键配置；存储不可用或数据损坏时回退到平台默认键位。
   */
  function loadShortcutBindings() {
    const defaults = createDefaultShortcutBindings(shortcutPlatform)
    const storage = window.ztools?.dbStorage
    if (!storage) {
      assignShortcutBindings(defaults)
      return
    }
    try {
      const stored = storage.getItem(SHORTCUT_STORAGE_KEY)
      assignShortcutBindings(sanitizeShortcutBindings(stored, defaults))
    } catch {
      assignShortcutBindings(defaults)
    }
  }

  /**
   * 将当前快捷键绑定写入宿主存储，失败时仅保留内存配置以免阻断编辑器操作。
   */
  function saveShortcutBindings() {
    const storage = window.ztools?.dbStorage
    if (!storage) return
    const payload = {
      version: 1,
      bindings: Object.fromEntries(SHORTCUT_ACTIONS.map((action) => [action.id, shortcutBindings[action.id]]))
    }
    try {
      storage.setItem(SHORTCUT_STORAGE_KEY, payload)
    } catch {
      // 存储不可用时保留内存配置
    }
  }

  /**
   * 查找某个快捷键是否已被其它动作占用，用于编辑绑定时提示覆盖关系。
   */
  function findShortcutConflict(binding: string, exceptActionId?: ShortcutActionId) {
    return SHORTCUT_ACTIONS.find((action) => action.id !== exceptActionId && shortcutBindings[action.id].includes(binding)) ?? null
  }

  /**
   * 应用抽屉中编辑后的单条快捷键，处理空值删除、重复项去重和跨动作冲突覆盖。
   */
  function applyShortcutBinding(actionId: ShortcutActionId, oldValue: string, nextValue: string) {
    const next = normalizeShortcutString(nextValue)
    const current = normalizeShortcutString(oldValue)
    const bindings = shortcutBindings[actionId]
    const currentIndex = current ? bindings.indexOf(current) : bindings.indexOf('')
    if (!next) {
      if (currentIndex >= 0) bindings.splice(currentIndex, 1)
      saveShortcutBindings()
      return
    }
    if (bindings.includes(next) && next !== current) {
      if (currentIndex >= 0) bindings.splice(currentIndex, 1)
      saveShortcutBindings()
      return
    }
    const conflict = findShortcutConflict(next, actionId)
    if (conflict) {
      const confirmed = window.confirm(`快捷键 ${formatShortcutForDisplay(next, shortcutPlatform)} 已分配给“${conflict.name}”。是否覆盖？`)
      if (!confirmed) {
        if (currentIndex >= 0 && bindings[currentIndex] === '') {
          bindings.splice(currentIndex, 1)
          saveShortcutBindings()
        }
        return
      }
      shortcutBindings[conflict.id] = shortcutBindings[conflict.id].filter((binding) => binding !== next)
    }
    if (currentIndex >= 0) {
      bindings[currentIndex] = next
    } else if (!bindings.includes(next)) {
      bindings.push(next)
    }
    saveShortcutBindings()
  }

  /**
   * 为指定动作追加一个待编辑空快捷键槽位，避免重复插入多个空输入。
   */
  function addShortcutBinding(actionId: ShortcutActionId) {
    if (shortcutBindings[actionId].includes('')) return
    shortcutBindings[actionId].push('')
  }

  /**
   * 删除指定动作的一条快捷键绑定并立即持久化。
   */
  function removeShortcutBinding(actionId: ShortcutActionId, binding: string) {
    shortcutBindings[actionId] = shortcutBindings[actionId].filter((item) => item !== binding)
    saveShortcutBindings()
  }

  /**
   * 恢复平台默认快捷键配置并写回存储。
   */
  function resetShortcutBindingsToDefault() {
    assignShortcutBindings(createDefaultShortcutBindings(shortcutPlatform))
    saveShortcutBindings()
  }

  /**
   * 根据键盘事件匹配当前配置中的动作定义，找不到绑定时返回 null。
   */
  function getShortcutActionByEvent(event: KeyboardEvent) {
    const shortcut = normalizeKeyboardEventShortcut(event)
    if (!shortcut) return null
    return SHORTCUT_ACTIONS.find((action) => shortcutBindings[action.id].includes(shortcut)) ?? null
  }

  /**
   * 查找快捷键分组的显示名称，供搜索同时匹配动作名、描述、分组和键位文本。
   */
  function getShortcutGroupLabel(groupId: ShortcutGroupId) {
    return SHORTCUT_DISPLAY_GROUPS.find((group) => group.id === groupId)?.label ?? groupId
  }

  /**
   * 判断快捷键动作是否命中抽屉搜索词。
   */
  function shortcutMatchesSearch(action: ShortcutActionDefinition) {
    const query = shortcutSearch.value.trim().toLowerCase()
    if (!query) return true
    const groupLabel = getShortcutGroupLabel(action.group)
    const bindingsText = shortcutBindings[action.id].map((binding) => formatShortcutForDisplay(binding, shortcutPlatform)).join(' ')
    return [action.name, action.description, groupLabel, bindingsText]
      .some((text) => text.toLowerCase().includes(query))
  }

  const filteredShortcutGroups = computed(() => SHORTCUT_DISPLAY_GROUPS
    .map((group) => ({
      ...group,
      actions: SHORTCUT_ACTIONS.filter((action) => action.group === group.id && shortcutMatchesSearch(action))
    }))
    .filter((group) => group.actions.length > 0)
  )

  /**
   * 打开快捷键抽屉，供顶栏命令和后续模块入口复用。
   */
  function openShortcutDrawer() {
    shortcutDrawerOpen.value = true
  }

  /**
   * 关闭快捷键抽屉，保持 v-model 与命令层状态一致。
   */
  function closeShortcutDrawer() {
    shortcutDrawerOpen.value = false
  }

  /**
   * 执行匹配到的快捷键动作，集中调度编辑、选择、图层和视图命令。
   */
  async function executeShortcutAction(actionId: ShortcutActionId) {
    switch (actionId) {
      case 'edit.copy':
        copySelectionToInternalClipboard()
        break
      case 'edit.paste':
        await pasteInternalClipboard()
        break
      case 'edit.duplicate':
        await duplicateSelection()
        break
      case 'edit.delete':
        options.shortcut.deleteObject()
        break
      case 'edit.undo':
        options.shortcut.undo()
        break
      case 'edit.redo':
        options.shortcut.redo()
        break
      case 'edit.copyStyle':
        options.shortcut.copyStyle()
        break
      case 'edit.pasteStyle':
        options.shortcut.pasteStyle()
        break
      case 'mode.shape':
        options.shortcut.setSelectionMode('shape')
        break
      case 'mode.point':
        options.shortcut.setSelectionMode('point')
        break
      case 'mode.segment':
        options.shortcut.setSelectionMode('segment')
        break
      case 'mode.pen':
        options.shortcut.activatePenTool()
        break
      case 'mode.paintBucket':
        options.shortcut.activatePaintBucketTool()
        break
      case 'select.all':
        options.shortcut.selectAllByMode()
        break
      case 'organize.group':
        if (options.shortcut.selectionMode.value === 'shape' && options.shortcut.canGroup.value) options.shortcut.groupObjects()
        break
      case 'organize.ungroup':
        if (options.shortcut.selectionMode.value === 'shape' && options.shortcut.canUngroup.value) options.shortcut.ungroupObject()
        break
      case 'layer.up':
        if (options.shortcut.selectionMode.value === 'shape') options.shortcut.layerUp()
        break
      case 'layer.down':
        if (options.shortcut.selectionMode.value === 'shape') options.shortcut.layerDown()
        break
      case 'layer.top':
        if (options.shortcut.selectionMode.value === 'shape') options.shortcut.layerTop()
        break
      case 'layer.bottom':
        if (options.shortcut.selectionMode.value === 'shape') options.shortcut.layerBottom()
        break
      case 'view.zoomIn':
        options.shortcut.setZoom(options.shortcut.zoom.value + 0.1)
        break
      case 'view.zoomOut':
        options.shortcut.setZoom(options.shortcut.zoom.value - 0.1)
        break
      case 'view.fit':
        options.shortcut.fitCanvasInView()
        break
      case 'view.actualSize':
        options.shortcut.setZoom(1)
        break
      case 'view.toggleRuler':
        options.shortcut.toggleRuler()
        break
      case 'file.saveProject':
        options.shortcut.saveProject()
        break
    }
  }

  const commands = {
    addShortcutBinding,
    applyShortcutBinding,
    closeShortcutDrawer,
    copyAsPNG,
    copyAsSVG,
    executeShortcutAction,
    getShortcutActionByEvent,
    handleExportDialogShowChange,
    handleExportPresetSelect,
    loadShortcutBindings,
    openExportDialog,
    openShortcutDrawer,
    removeShortcutBinding,
    resetShortcutBindingsToDefault,
    runExportDialogExport,
    setExportFormatEnabled,
    toggleExportPngSize
  }

  const module: EditorModule = {
    name: 'home-export-delivery',
    onMount(context) {
      if (!context.getCanvas()) return
      loadShortcutBindings()
    },
    onDispose() {
      exportDialog.loading = false
      internalClipboard = null
    }
  }

  return {
    controller: {
      commands,
      helpers: {
        copySelectionToInternalClipboard,
        createCanvasSVGPreview,
        createSelectionCanvas,
        createSelectionSvgText,
        duplicateSelection,
        exportIconContainer,
        exportPNG,
        exportSVG,
        exportSizeSet,
        pasteInternalClipboard,
        renderPNGDataUrl,
        withArtboardExport
      },
      state: {
        exportDialog,
        exportDialogCanExport,
        exportDialogSelectedPreset,
        filteredShortcutGroups,
        shortcutBindings,
        shortcutDrawerOpen,
        shortcutPlatform,
        shortcutSearch
      }
    },
    module
  }
}
