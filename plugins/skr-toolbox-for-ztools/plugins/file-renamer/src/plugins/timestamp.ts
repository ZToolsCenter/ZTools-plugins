import type { PluginActionDefinition, WorkflowContext } from '../core/types';
import {
  pluginDescription,
  pluginFieldDescription,
  pluginFieldLabel,
  pluginName
} from './i18n';

/**
 * 用于在文件名中添加时间戳信息的插件。
 * 支持可自定义的日期/时间格式，并可使用文件修改时间或当前时间。
 */
export const timestampPlugin: PluginActionDefinition = {
  id: 'timestamp',
  name: pluginName('timestamp', 'Timestamp'),
  description: pluginDescription('timestamp', 'Apply time values to file names.'),
  configSchema: {
    format: { 
      type: 'string', 
      label: pluginFieldLabel('timestamp', 'format', 'Date Format'),
      default: 'YYYY-MM-DD_HHmmss',
      description: pluginFieldDescription('timestamp', 'format', 'Supports YYYY/MM/DD/HH/mm/ss.')
    },
    useCurrentTime: {
      type: 'boolean',
      label: pluginFieldLabel('timestamp', 'useCurrentTime', 'Use Current Time'),
      default: false,
      description: pluginFieldDescription('timestamp', 'useCurrentTime', 'Use file modified time when disabled.')
    }
  },
  /**
   * 根据配置在文件名前面或后面添加时间戳。
   * @param currentName - 要转换的当前文件名
   * @param config - 时间戳格式配置
   * @param config.format - 日期/时间格式字符串（支持YYYY, MM, DD, HH, mm, ss）
   * @param config.useCurrentTime - 是否使用当前时间而非文件的修改时间
   * @param context - 包含文件元数据的工作流上下文
   * @returns 应用了时间戳的转换后文件名
   */
  apply: (currentName: string, config: any, context: WorkflowContext) => {
    const { format = 'YYYY-MM-DD', useCurrentTime = false } = config;
    const date = useCurrentTime
      ? new Date(context.runtime.batchTimestamp)
      : new Date(context.file.lastModified);
    
    const lastDot = currentName.lastIndexOf('.');
    const ext = lastDot === -1 ? '' : currentName.substring(lastDot);

    const pad = (n: number) => n.toString().padStart(2, '0');
    
    const yyyy = date.getFullYear().toString();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    const ss = pad(date.getSeconds());

    const result = format
      .replace(/YYYY/g, yyyy)
      .replace(/MM/g, mm)
      .replace(/DD/g, dd)
      .replace(/HH/g, hh)
      .replace(/mm/g, min)
      .replace(/ss/g, ss);

    return `${result}${ext}`;
  }
};
