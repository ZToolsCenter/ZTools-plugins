import type { PluginActionDefinition, WorkflowContext } from '../core/types';
import {
  pluginDescription,
  pluginFieldDescription,
  pluginFieldLabel,
  pluginFieldOptionLabel,
  pluginName
} from './i18n';

/**
 * 用于在文件名中添加序列号的插件。
 * 支持自定义起始值、步长、填充和位置选项。
 */
export const sequencePlugin: PluginActionDefinition = {
  id: 'sequence',
  name: pluginName('sequence', 'Smart Sequence'),
  description: pluginDescription('sequence', 'Append increasing numbers to file names.'),
  configSchema: {
    start: {
      type: 'number',
      label: pluginFieldLabel('sequence', 'start', 'Start'),
      default: 1,
      description: pluginFieldDescription('sequence', 'start', 'Starting number for the first file.')
    },
    step: {
      type: 'number',
      label: pluginFieldLabel('sequence', 'step', 'Step'),
      default: 1,
      description: pluginFieldDescription('sequence', 'step', 'Increment value between files.')
    },
    padding: {
      type: 'number',
      label: pluginFieldLabel('sequence', 'padding', 'Padding'),
      default: 2,
      description: pluginFieldDescription('sequence', 'padding', 'Left-pad with zeros to this length.')
    },
    position: { 
      type: 'select', 
      label: pluginFieldLabel('sequence', 'position', 'Position'),
      description: pluginFieldDescription('sequence', 'position', 'Number position or full replace.'),
      options: [
        { label: pluginFieldOptionLabel('sequence', 'position', 'prefix', 'Prefix'), value: 'prefix' },
        { label: pluginFieldOptionLabel('sequence', 'position', 'suffix', 'Suffix'), value: 'suffix' },
        { label: pluginFieldOptionLabel('sequence', 'position', 'replace', 'Replace File Name'), value: 'replace' }
      ],
      default: 'suffix'
    }
  },
  /**
   * 根据文件在批处理中的位置将序列号应用于文件名。
   * @param currentName - 要转换的当前文件名
   * @param config - 序列号生成的配置
   * @param config.start - 第一个文件的起始编号
   * @param config.step - 连续数字之间的增量
   * @param config.padding - 最小数字长度（用零填充）
   * @param config.position - 数字位置 ('prefix' | 'suffix' | 'replace')
   * @param context - 包含文件索引的工作流上下文
   * @returns 应用了序列号的转换后文件名
   */
  apply: (currentName: string, config: any, context: WorkflowContext) => {
    const rawStart = Number(config?.start ?? 1);
    const rawStep = Number(config?.step ?? 1);
    const rawPadding = Number(config?.padding ?? 1);
    const position = ['prefix', 'suffix', 'replace'].includes(config?.position)
      ? config.position
      : 'suffix';

    const start = Number.isFinite(rawStart) ? rawStart : 1;
    const step = Number.isFinite(rawStep) ? rawStep : 1;
    const padding = Number.isFinite(rawPadding)
      ? Math.max(1, Math.floor(rawPadding))
      : 1;

    const num = start + (context.index * step);
    const numStr = num.toString().padStart(padding, '0');

    const lastDot = currentName.lastIndexOf('.');
    const name = lastDot === -1 ? currentName : currentName.substring(0, lastDot);
    const ext = lastDot === -1 ? '' : currentName.substring(lastDot);

    if (position === 'replace') {
      return `${numStr}${ext}`;
    }

    if (position === 'prefix') {
      return `${numStr}${name}${ext}`;
    } else {
      return `${name}${numStr}${ext}`;
    }
  }
};
