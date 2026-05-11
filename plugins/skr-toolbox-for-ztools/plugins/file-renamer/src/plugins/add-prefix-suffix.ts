import type { PluginActionDefinition } from '../core/types';
import {
  pluginDescription,
  pluginFieldDescription,
  pluginFieldLabel,
  pluginName
} from './i18n';

/**
 * 用于在文件名开头和/或结尾添加前缀和/或后缀的插件。
 * 仅修改基本名称，保留文件扩展名。
 */
export const addPrefixSuffixPlugin: PluginActionDefinition = {
  id: 'add-prefix-suffix',
  name: pluginName('add-prefix-suffix', 'Add Prefix/Suffix'),
  description: pluginDescription('add-prefix-suffix', 'Add text to the beginning or end of file names.'),
  configSchema: {
    prefix: {
      type: 'string',
      label: pluginFieldLabel('add-prefix-suffix', 'prefix', 'Prefix'),
      default: '',
      description: pluginFieldDescription('add-prefix-suffix', 'prefix', 'Added before the file name.')
    },
    suffix: {
      type: 'string',
      label: pluginFieldLabel('add-prefix-suffix', 'suffix', 'Suffix'),
      default: '',
      description: pluginFieldDescription('add-prefix-suffix', 'suffix', 'Added after the file name.')
    }
  },
  /**
   * 通过添加前缀和/或后缀来转换当前文件名。
   * 仅修改基本名称，保留文件扩展名。
   * @param currentName - 要转换的当前文件名
   * @param config - 包含前缀和后缀的配置对象
   * @param config.prefix - 要添加到文件名前面（在扩展名之前）的字符串
   * @param config.suffix - 要追加到文件名后面（在扩展名之前）的字符串
   * @returns 添加了前缀/后缀的转换后文件名
   */
  apply: (currentName: string, config: any) => {
    const { prefix = '', suffix = '' } = config;
    const lastDot = currentName.lastIndexOf('.');
    if (lastDot === -1) return `${prefix}${currentName}${suffix}`;
    
    const name = currentName.substring(0, lastDot);
    const ext = currentName.substring(lastDot);
    return `${prefix}${name}${suffix}${ext}`;
  }
};
