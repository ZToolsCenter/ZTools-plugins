import type { PluginActionDefinition } from '../core/types';
import {
  pluginDescription,
  pluginFieldDescription,
  pluginFieldLabel,
  pluginFieldOptionLabel,
  pluginName
} from './i18n';

/** 匹配Windows文件名中无效字符的正则表达式 */
const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

/**
 * 将文件名分割为名称和扩展名部分。
 * @param currentName - 要分割的文件名
 * @returns 包含名称和扩展名部分的对象
 */
function splitNameAndExt(currentName: string): { name: string; ext: string } {
  const lastDot = currentName.lastIndexOf('.');
  if (lastDot <= 0) {
    return { name: currentName, ext: '' };
  }

  return {
    name: currentName.slice(0, lastDot),
    ext: currentName.slice(lastDot)
  };
}

/**
 * 清理扩展名字符串，包括修剪、删除前导点号和删除无效字符。
 * @param raw - 要清理的原始扩展名值
 * @returns 清理后的扩展名字符串，不含前导点号
 */
function sanitizeExtension(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/^\.+/, '')
    .replace(INVALID_FILE_NAME_CHARS, '');
}

/**
 * 用于转换文件扩展名的插件。
 * 支持小写、大写或设置自定义扩展名。
 */
export const extensionTransformPlugin: PluginActionDefinition = {
  id: 'extension-transform',
  name: pluginName('extension-transform', 'Extension Transform'),
  description: pluginDescription('extension-transform', 'Normalize extension case or set a custom extension.'),
  configSchema: {
    mode: {
      type: 'select',
      label: pluginFieldLabel('extension-transform', 'mode', 'Mode'),
      default: 'lower',
      description: pluginFieldDescription('extension-transform', 'mode', 'Choose how to handle file extensions.'),
      options: [
        { label: pluginFieldOptionLabel('extension-transform', 'mode', 'lower', 'Lowercase'), value: 'lower' },
        { label: pluginFieldOptionLabel('extension-transform', 'mode', 'upper', 'Uppercase'), value: 'upper' },
        { label: pluginFieldOptionLabel('extension-transform', 'mode', 'set', 'Set Custom Extension'), value: 'set' },
        { label: pluginFieldOptionLabel('extension-transform', 'mode', 'keep', 'Keep Original'), value: 'keep' }
      ]
    },
    customExtension: {
      type: 'string',
      label: pluginFieldLabel('extension-transform', 'customExtension', 'Custom Extension'),
      default: '',
      description: pluginFieldDescription('extension-transform', 'customExtension', 'Only used in "Set Custom Extension" mode, such as jpg or md.')
    }
  },
  /**
   * 根据选择的模式转换文件扩展名。
   * @param currentName - 要转换的当前文件名
   * @param config - 扩展名转换的配置
   * @param config.mode - 转换模式 ('lower' | 'upper' | 'set' | 'keep')
   * @param config.customExtension - 要设置的自定义扩展名（当mode为'set'时使用）
   * @returns 修改了扩展名的转换后文件名
   */
  apply: (currentName: string, config: any) => {
    const { mode = 'lower', customExtension = '' } = config || {};
    const { name, ext } = splitNameAndExt(currentName);

    if (mode === 'keep') {
      return currentName;
    }

    if (mode === 'set') {
      const sanitized = sanitizeExtension(customExtension);
      if (!sanitized) {
        return currentName;
      }
      return `${name}.${sanitized}`;
    }

    if (!ext) {
      return currentName;
    }

    const bareExt = ext.slice(1);
    if (mode === 'upper') {
      return `${name}.${bareExt.toUpperCase()}`;
    }

    return `${name}.${bareExt.toLowerCase()}`;
  }
};
