import type { PluginActionDefinition } from '../core/types';
import {
  pluginDescription,
  pluginFieldDescription,
  pluginFieldLabel,
  pluginFieldOptionLabel,
  pluginName
} from './i18n';

/**
 * 用于转换文件名大小写风格的插件。
 * 支持各种大小写约定，包括小写、大写、标题式、驼峰式和蛇形式。
 */
export const caseTransformPlugin: PluginActionDefinition = {
  id: 'case-transform',
  name: pluginName('case-transform', 'Case Transform'),
  description: pluginDescription('case-transform', 'Convert names to different case styles.'),
  configSchema: {
    mode: { 
      type: 'select', 
      label: pluginFieldLabel('case-transform', 'mode', 'Mode'),
      description: pluginFieldDescription('case-transform', 'mode', 'Choose the target naming style.'),
      options: [
        { label: pluginFieldOptionLabel('case-transform', 'mode', 'lower', 'lower case'), value: 'lower' },
        { label: pluginFieldOptionLabel('case-transform', 'mode', 'upper', 'UPPER CASE'), value: 'upper' },
        { label: pluginFieldOptionLabel('case-transform', 'mode', 'title', 'Title Case'), value: 'title' },
        { label: pluginFieldOptionLabel('case-transform', 'mode', 'camel', 'camelCase'), value: 'camel' },
        { label: pluginFieldOptionLabel('case-transform', 'mode', 'snake', 'snake_case'), value: 'snake' }
      ],
      default: 'lower'
    }
  },
  /**
   * 将文件名转换为指定的大小写风格。
   * 处理基本名称并保留文件扩展名。
   * @param currentName - 要转换的当前文件名
   * @param config - 包含大小写模式的配置对象
   * @param config.mode - 目标大小写风格 ('lower' | 'upper' | 'title' | 'camel' | 'snake')
   * @returns 应用了所选大小写风格的转换后文件名
   */
  apply: (currentName: string, config: any) => {
    const { mode } = config;
    const lastDot = currentName.lastIndexOf('.');
    const name = lastDot === -1 ? currentName : currentName.substring(0, lastDot);
    const ext = lastDot === -1 ? '' : currentName.substring(lastDot);

    let transformed = name;
    switch (mode) {
      case 'lower':
        transformed = name.toLowerCase();
        break;
      case 'upper':
        transformed = name.toUpperCase();
        break;
      case 'title':
        transformed = name.replace(/\b\w/g, char => char.toUpperCase());
        break;
      case 'camel':
        transformed = name
          .split(/[-_\s]+/)
          .map((word, i) => i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join('');
        break;
      case 'snake':
        transformed = name
          .replace(/([a-z])([A-Z])/g, '$1_$2')
          .replace(/[-\s]+/g, '_')
          .toLowerCase();
        break;
    }
    return `${transformed}${ext}`;
  }
};
