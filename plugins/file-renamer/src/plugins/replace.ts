import type { PluginActionDefinition } from '../core/types';
import {
  pluginDescription,
  pluginFieldDescription,
  pluginFieldLabel,
  pluginName
} from './i18n';

/**
 * 用于在文件名中查找和替换文本的插件。
 * 支持纯文本和基于正则表达式的替换以及大小写敏感选项。
 */
export const replacePlugin: PluginActionDefinition = {
  id: 'replace',
  name: pluginName('replace', 'Find & Replace'),
  description: pluginDescription('replace', 'Find text in file names and replace it (regex supported).'),
  configSchema: {
    find: {
      type: 'string',
      label: pluginFieldLabel('replace', 'find', 'Find'),
      default: '',
      description: pluginFieldDescription('replace', 'find', 'Text to match.')
    },
    replace: {
      type: 'string',
      label: pluginFieldLabel('replace', 'replace', 'Replace With'),
      default: '',
      description: pluginFieldDescription('replace', 'replace', 'Replacement text.')
    },
    isRegex: {
      type: 'boolean',
      label: pluginFieldLabel('replace', 'isRegex', 'Use Regex'),
      default: false,
      description: pluginFieldDescription('replace', 'isRegex', 'Enable regular expression matching.')
    },
    caseSensitive: {
      type: 'boolean',
      label: pluginFieldLabel('replace', 'caseSensitive', 'Case Sensitive'),
      default: false,
      description: pluginFieldDescription('replace', 'caseSensitive', 'Ignore case when disabled.')
    }
  },
  /**
   * 根据配置替换文件名中的文本。
   * @param currentName - 要转换的当前文件名
   * @param config - 查找和替换的配置对象
   * @param config.find - 要搜索的文本或模式
   * @param config.replace - 替换文本
   * @param config.isRegex - 是否将find视为正则表达式
   * @param config.caseSensitive - 搜索是否区分大小写
   * @returns 应用了替换的转换后文件名
   */
  apply: (currentName: string, config: any) => {
    const { find, replace, isRegex, caseSensitive } = config;
    if (!find) return currentName;

    try {
      if (isRegex) {
        const flags = caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(find, flags);
        return currentName.replace(regex, replace);
      } else {
        if (!caseSensitive) {
          const escapedFind = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(escapedFind, 'gi');
          return currentName.replace(regex, replace);
        }
        return currentName.split(find).join(replace);
      }
    } catch (e) {
      return currentName;
    }
  }
};
