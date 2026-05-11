import { i18n } from '../i18n';

/**
 * 使用回退字符串解析翻译键。
 * @param key - 要查找的翻译键
 * @param fallback - 如果找不到翻译键则使用默认字符串
 * @returns 翻译后的字符串或回退值
 */
function resolveText(key: string, fallback: string): string {
  return i18n.global.te(key) ? String(i18n.global.t(key)) : fallback;
}

/**
 * 获取插件的本地化名称。
 * @param pluginId - 插件的唯一标识符
 * @param fallback - 如果找不到翻译则使用默认名称
 * @returns 本地化的插件名称
 */
export function pluginName(pluginId: string, fallback: string): string {
  return resolveText(`plugins.${pluginId}.name`, fallback);
}

/**
 * 获取插件的本地化描述。
 * @param pluginId - 插件的唯一标识符
 * @param fallback - 如果找不到翻译则使用默认描述
 * @returns 本地化的插件描述
 */
export function pluginDescription(pluginId: string, fallback: string): string {
  return resolveText(`plugins.${pluginId}.description`, fallback);
}

/**
 * 获取插件配置字段的本地化标签。
 * @param pluginId - 插件的唯一标识符
 * @param field - 配置字段的名称
 * @param fallback - 如果找不到翻译则使用默认标签
 * @returns 本地化的字段标签
 */
export function pluginFieldLabel(pluginId: string, field: string, fallback: string): string {
  return resolveText(`plugins.${pluginId}.fields.${field}.label`, fallback);
}

/**
 * 获取插件配置字段的本地化描述。
 * @param pluginId - 插件的唯一标识符
 * @param field - 配置字段的名称
 * @param fallback - 如果找不到翻译则使用默认描述
 * @returns 本地化的字段描述
 */
export function pluginFieldDescription(pluginId: string, field: string, fallback: string): string {
  return resolveText(`plugins.${pluginId}.fields.${field}.description`, fallback);
}

/**
 * 获取插件字段选项的本地化标签。
 * @param pluginId - 插件的唯一标识符
 * @param field - 配置字段的名称
 * @param option - 要查找的选项值
 * @param fallback - 如果找不到翻译则使用默认标签
 * @returns 本地化的选项标签
 */
export function pluginFieldOptionLabel(
  pluginId: string,
  field: string,
  option: string,
  fallback: string
): string {
  return resolveText(`plugins.${pluginId}.fields.${field}.options.${option}`, fallback);
}

/**
 * 获取插件的任意本地化文本。
 * @param pluginId - 插件的唯一标识符
 * @param key - 要检索的特定文本键
 * @param fallback - 如果找不到翻译则使用默认文本
 * @returns 本地化的文本或回退值
 */
export function pluginText(pluginId: string, key: string, fallback: string): string {
  return resolveText(`plugins.${pluginId}.${key}`, fallback);
}
