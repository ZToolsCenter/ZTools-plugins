import { FabricImage, filters, type FabricObject } from 'fabric'
import {
  getBitmapFiltersMeta,
  normalizeBitmapFilterSettings,
  type BitmapFilterSetting
} from '../bitmapFilters'

/** fabric 原生滤镜实例类型（BaseFilter 体系，全部具体滤镜的共同基类）。 */
export type NativeBitmapFilter = filters.BaseFilter<string>

/**
 * 由单条滤镜设置构建 fabric 滤镜实例：
 * 无参滤镜直接实例化；有参滤镜把本模型的参数键换算为 fabric 构造参数
 * （strength → Blur 的 blur，其余同名）。调用方保证仅对启用条目调用。
 */
export function buildNativeBitmapFilter(setting: BitmapFilterSetting): NativeBitmapFilter {
  switch (setting.type) {
    case 'grayscale':
      return new filters.Grayscale()
    case 'invert':
      return new filters.Invert()
    case 'sepia':
      return new filters.Sepia()
    case 'blur':
      return new filters.Blur({ blur: setting.strength ?? 0 })
    case 'brightness':
      return new filters.Brightness({ brightness: setting.brightness ?? 0 })
    case 'contrast':
      return new filters.Contrast({ contrast: setting.contrast ?? 0 })
    case 'saturation':
      return new filters.Saturation({ saturation: setting.saturation ?? 0 })
  }
}

/**
 * 把滤镜设置列表整体应用到目标位图：
 * 先写回 bitmapFilters 元数据（含禁用条目，供面板回显与工程序列化），
 * 再按固定顺序重建原生 filters 数组（仅启用项参与渲染）并 applyFilters 触发重算。
 * 非位图对象直接忽略（滤镜只对 FabricImage 生效）。
 */
export function applyBitmapFilterSettings(target: FabricObject | null | undefined, settings: BitmapFilterSetting[]): boolean {
  if (!target || !(target instanceof FabricImage)) return false
  const metadata = getBitmapFiltersMeta(target)
  if (metadata) {
    metadata.bitmapFilters = normalizeBitmapFilterSettings(settings)
  }
  rebuildNativeBitmapFilters(target)
  return true
}

/** 按对象当前的 bitmapFilters 元数据重建原生 filters 数组并应用（加载/撤销恢复路径复用）。 */
export function rebuildNativeBitmapFilters(target: FabricObject | null | undefined): void {
  if (!target || !(target instanceof FabricImage)) return
  const enabledSettings = readEnabledBitmapFilterSettings(target)
  target.filters = enabledSettings.map(buildNativeBitmapFilter)
  target.applyFilters()
  target.dirty = true
}

/** 读取对象元数据中启用的滤镜设置（元数据缺失视为空列表）。 */
export function readEnabledBitmapFilterSettings(target: FabricImage): BitmapFilterSetting[] {
  const metadata = getBitmapFiltersMeta(target)
  const settings = metadata && Array.isArray(metadata.bitmapFilters)
    ? normalizeBitmapFilterSettings(metadata.bitmapFilters)
    : []
  return settings.filter((setting) => setting.enabled)
}
