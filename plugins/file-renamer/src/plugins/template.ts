import type { PluginActionDefinition, WorkflowContext } from '../core/types';
import {
  pluginDescription,
  pluginFieldDescription,
  pluginFieldLabel,
  pluginName
} from './i18n';

/**
 * 用于使用模板和占位符生成文件名的插件。
 * 支持各种占位符，包括名称、扩展名、索引和日期值。
 */
export const templatePlugin: PluginActionDefinition = {
  id: 'template',
  name: pluginName('template', 'Template'),
  description: pluginDescription('template', 'Build names quickly with placeholders.'),
  configSchema: {
    template: { 
      type: 'string', 
      label: pluginFieldLabel('template', 'template', 'Template'),
      default: '[NAME]_[INDEX]',
      description: pluginFieldDescription('template', 'template', 'Supports [NAME] [EXT] [INDEX] [YYYY] [MM] [DD].')
    }
  },
  /**
   * 使用带占位符的模板转换文件名。
   * @param currentName - 要转换的当前文件名
   * @param config - 包含模板字符串的配置
   * @param config.template - 带占位符的模板字符串 ([NAME], [EXT], [INDEX], [YYYY], [MM], [DD])
   * @param context - 包含文件元数据的工作流上下文
   * @returns 基于模板的转换后文件名
   */
  apply: (currentName: string, config: any, context: WorkflowContext) => {
    const { template = '[NAME]' } = config;
    const lastDot = currentName.lastIndexOf('.');
    const name = lastDot === -1 ? currentName : currentName.substring(0, lastDot);
    const ext = lastDot === -1 ? '' : currentName.substring(lastDot);
    
    const date = new Date(context.file.lastModified);
    const yyyy = date.getFullYear().toString();
    const mm = (date.getMonth() + 1).toString().padStart(2, '0');
    const dd = date.getDate().toString().padStart(2, '0');

    return template
      .replace(/\[NAME\]/gi, name)
      .replace(/\[EXT\]/gi, ext.replace(/^\./, ''))
      .replace(/\[INDEX\]/gi, (context.index + 1).toString())
      .replace(/\[YYYY\]/gi, yyyy)
      .replace(/\[MM\]/gi, mm)
      .replace(/\[DD\]/gi, dd);
  }
};
