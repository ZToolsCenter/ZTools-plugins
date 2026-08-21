/**
 * 滤镜工具 — 统一管理 fabric.Image 的滤镜读写与预设
 *
 * Fabric.js 5.3.0 提供以下常用滤镜（均挂在 fabric.Image.filters 命名空间下）：
 *   Brightness   亮度      -1 ~ 1（0 为原样）
 *   Contrast     对比度    -1 ~ 1
 *   Saturation   饱和度    -1 ~ 1
 *   HueRotation  色相旋转  弧度（0 ~ 2π，可取负值）
 *   Blur         高斯模糊  0 ~ 1
 *   Sepia        棕褐      0 ~ 1（值越大越深）
 *   Grayscale    灰度      0 ~ 1（1 为完全黑白）
 *   Vibrance     自然饱和  -1 ~ 1
 *
 * 每个 fabric.Image 实例都有一个 `filters` 数组，滤镜对象按顺序应用。
 * 本模块约定：同一类型的滤镜在数组中只保留一个实例，覆盖式更新。
 */

import { clamp } from './helpers.js';

/** 滤镜类型 → fabric.Image.filters 类名 映射 */
const FILTER_CLASS_NAME = {
  brightness: 'Brightness',
  contrast: 'Contrast',
  saturation: 'Saturation',
  hue: 'HueRotation',
  blur: 'Blur',
  sepia: 'Sepia',
  grayscale: 'Grayscale',
  vibrance: 'Vibrance',
};

/** 滤镜类型 → 该滤镜在 fabric 中的属性名 */
const FILTER_ATTR_NAME = {
  brightness: 'brightness',
  contrast: 'contrast',
  saturation: 'saturation',
  hue: 'rotation',
  blur: 'blur',
  sepia: 'sepia',
  grayscale: 'grayscale',
  vibrance: 'vibrance',
};

/**
 * UI 滑块范围定义（百分比或度数）
 * 仅这 5 项在属性面板暴露滑块；sepia / grayscale 仅通过预设触发
 */
export const FILTER_RANGES = {
  brightness: { min: -100, max: 100, step: 1, default: 0 },
  contrast:   { min: -100, max: 100, step: 1, default: 0 },
  saturation: { min: -100, max: 100, step: 1, default: 0 },
  hue:        { min: -180, max: 180, step: 1, default: 0 },
  blur:       { min: 0,    max: 100, step: 1, default: 0 },
};

/** 仅通过预设使用的滤镜类型 → 默认值（用于应用预设时重置） */
const PRESET_ONLY_DEFAULTS = {
  sepia: 0,
  grayscale: 0,
  vibrance: 0,
};

/** 应用预设时需要重置的全部滤镜类型 */
const ALL_RESETTABLE_TYPES = [...Object.keys(FILTER_RANGES), ...Object.keys(PRESET_ONLY_DEFAULTS)];

/**
 * 将 UI 滑块值（百分比或度数）换算为 fabric 滤镜实际值
 * @param {string} type
 * @param {number} uiValue
 * @returns {number}
 */
export function uiToFilterValue(type, uiValue) {
  switch (type) {
    case 'brightness':
    case 'contrast':
    case 'saturation':
    case 'sepia':
    case 'grayscale':
    case 'vibrance':
      // 0~100 → 0~1（brightness/contrast/saturation/vibrance 允许 -100~100）
      return clamp(uiValue, -100, 100) / 100;
    case 'hue':
      // -180°~180° → -π~π 弧度
      return clamp(uiValue, -180, 180) * Math.PI / 180;
    case 'blur':
      return clamp(uiValue, 0, 100) / 100;
    default:
      return uiValue;
  }
}

/**
 * 将 fabric 滤镜值换算为 UI 滑块值
 * @param {string} type
 * @param {number} filterValue
 * @returns {number}
 */
export function filterToUiValue(type, filterValue) {
  switch (type) {
    case 'brightness':
    case 'contrast':
    case 'saturation':
    case 'sepia':
    case 'grayscale':
    case 'vibrance':
      return Math.round((filterValue || 0) * 100);
    case 'hue':
      return Math.round((filterValue || 0) * 180 / Math.PI);
    case 'blur':
      return Math.round((filterValue || 0) * 100);
    default:
      return Math.round(filterValue || 0);
  }
}

function getFilterClass(type) {
  const className = FILTER_CLASS_NAME[type];
  if (!className) return null;
  return (typeof fabric !== 'undefined' && fabric.Image && fabric.Image.filters)
    ? fabric.Image.filters[className]
    : null;
}

/**
 * 读取图片上某类滤镜的当前值（无则返回默认值）
 * @param {fabric.Image} image
 * @param {string} type
 * @returns {number} UI 滑块值
 */
export function getFilterUiValue(image, type) {
  if (!image || !Array.isArray(image.filters)) {
    return FILTER_RANGES[type] ? FILTER_RANGES[type].default : 0;
  }

  const className = FILTER_CLASS_NAME[type];
  const filter = image.filters.find(f => f && f.type === className);
  if (!filter) return FILTER_RANGES[type] ? FILTER_RANGES[type].default : 0;

  const attr = FILTER_ATTR_NAME[type];
  return filterToUiValue(type, filter[attr]);
}

/**
 * 设置/替换图片上的某类滤镜
 * @param {fabric.Image} image
 * @param {string} type
 * @param {number} uiValue
 * @param {boolean} [skipApply=false] 为 true 时跳过 applyFilters(image) 重算，
 *   用于批量设置（如应用预设）时避免多次重复调用昂贵的滤镜重算；
 *   调用方需在批量结束后自行触发一次重算
 */
export function setFilter(image, type, uiValue, skipApply = false) {
  if (!image) return;

  if (!Array.isArray(image.filters)) {
    image.filters = [];
  }

  const FilterClass = getFilterClass(type);
  if (!FilterClass) return;

  // 移除同类型旧滤镜
  const className = FILTER_CLASS_NAME[type];
  image.filters = image.filters.filter(f => !(f && f.type === className));

  // 默认值不写入（避免无效滤镜堆积）
  const defaultValue = FILTER_RANGES[type]
    ? FILTER_RANGES[type].default
    : (PRESET_ONLY_DEFAULTS[type] != null ? PRESET_ONLY_DEFAULTS[type] : 0);
  if (uiValue === defaultValue) {
    if (!skipApply) applyFilters(image);
    return;
  }

  const filterValue = uiToFilterValue(type, uiValue);
  const attr = FILTER_ATTR_NAME[type];
  const filter = new FilterClass({ [attr]: filterValue });
  image.filters.push(filter);
  if (!skipApply) applyFilters(image);
}

/**
 * 清除图片上的所有滤镜
 * @param {fabric.Image} image
 */
export function clearFilters(image) {
  if (!image) return;
  image.filters = [];
  applyFilters(image);
}

/**
 * 应用滤镜到图片（触发重新渲染）
 * @param {fabric.Image} image
 */
function applyFilters(image) {
  if (typeof image.applyFilters === 'function') {
    image.applyFilters();
  }
}

/**
 * 判断图片是否完全无滤镜
 * @param {fabric.Image} image
 * @returns {boolean}
 */
export function hasNoFilters(image) {
  if (!image || !Array.isArray(image.filters)) return true;
  return image.filters.length === 0;
}

// ── 预设 ──

/**
 * 滤镜预设定义
 * 每个预设的 filters 字段为 { type: uiValue } 映射，未列出的类型重置为默认值
 */
export const FILTER_PRESETS = [
  {
    preset: 'filter-original',
    label: '原图',
    filters: {},
  },
  {
    preset: 'filter-warm',
    label: '暖色',
    filters: { brightness: 6, saturation: 18, hue: -12 },
  },
  {
    preset: 'filter-cool',
    label: '冷色',
    filters: { brightness: 2, saturation: -8, hue: 14 },
  },
  {
    preset: 'filter-vintage',
    label: '复古',
    filters: { brightness: 4, contrast: -8, saturation: -12, sepia: 55 },
  },
  {
    preset: 'filter-bw',
    label: '黑白',
    filters: { grayscale: 100, contrast: 8 },
  },
  {
    preset: 'filter-vivid',
    label: '鲜艳',
    filters: { saturation: 40, contrast: 14, brightness: 4 },
  },
  {
    preset: 'filter-soft',
    label: '柔光',
    filters: { brightness: 10, contrast: -16, blur: 6 },
  },
  {
    preset: 'filter-sharp',
    label: '锐利',
    filters: { contrast: 26, saturation: 10, brightness: -2 },
  },
];

/**
 * 应用滤镜预设到图片
 * @param {fabric.Image} image
 * @param {string} presetName
 */
export function applyFilterPreset(image, presetName) {
  if (!image) return false;
  const preset = FILTER_PRESETS.find(p => p.preset === presetName);
  if (!preset) return false;

  // 重置全部为默认值，再应用预设覆盖
  // 批量设置时跳过逐次 applyFilters，循环结束后统一应用一次，避免重复重算
  ALL_RESETTABLE_TYPES.forEach(type => {
    const value = preset.filters[type] != null
      ? preset.filters[type]
      : (FILTER_RANGES[type] ? FILTER_RANGES[type].default : (PRESET_ONLY_DEFAULTS[type] != null ? PRESET_ONLY_DEFAULTS[type] : 0));
    setFilter(image, type, value, true);
  });
  applyFilters(image);
  return true;
}

/**
 * 判断当前图片是否匹配某个预设（用于预设按钮高亮）
 * @param {fabric.Image} image
 * @param {string} presetName
 * @returns {boolean}
 */
export function isPresetActive(image, presetName) {
  if (!image) return false;
  const preset = FILTER_PRESETS.find(p => p.preset === presetName);
  if (!preset) return false;

  return ALL_RESETTABLE_TYPES.every(type => {
    const expected = preset.filters[type] != null
      ? preset.filters[type]
      : (FILTER_RANGES[type] ? FILTER_RANGES[type].default : (PRESET_ONLY_DEFAULTS[type] != null ? PRESET_ONLY_DEFAULTS[type] : 0));
    const actual = getFilterUiValue(image, type);
    return Math.abs(actual - expected) < 0.5;
  });
}
