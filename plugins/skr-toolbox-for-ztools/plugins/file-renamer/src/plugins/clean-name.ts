import type { PluginActionDefinition } from '../core/types';
import {
  pluginDescription,
  pluginFieldDescription,
  pluginFieldLabel,
  pluginName,
  pluginText
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
 * 用于清理和规范文件名的插件。
 * 删除空格、无效字符和冗余点号。
 */
export const cleanNamePlugin: PluginActionDefinition = {
  id: 'clean-name',
  name: pluginName('clean-name', 'Name Cleanup'),
  description: pluginDescription('clean-name', 'Clean whitespace, illegal characters, and redundant dots.'),
  configSchema: {
    trim: {
      type: 'boolean',
      label: pluginFieldLabel('clean-name', 'trim', 'Trim Edges'),
      default: true,
      description: pluginFieldDescription('clean-name', 'trim', 'Remove leading and trailing whitespace.')
    },
    collapseWhitespace: {
      type: 'boolean',
      label: pluginFieldLabel('clean-name', 'collapseWhitespace', 'Collapse Spaces'),
      default: true,
      description: pluginFieldDescription('clean-name', 'collapseWhitespace', 'Convert consecutive whitespace into a single space.')
    },
    replaceIllegal: {
      type: 'boolean',
      label: pluginFieldLabel('clean-name', 'replaceIllegal', 'Replace Illegal Chars'),
      default: true,
      description: pluginFieldDescription('clean-name', 'replaceIllegal', 'Replace forbidden Windows characters like < > : " / \\ | ? *.')
    },
    illegalReplacement: {
      type: 'string',
      label: pluginFieldLabel('clean-name', 'illegalReplacement', 'Illegal Char Replacement'),
      default: '_',
      description: pluginFieldDescription('clean-name', 'illegalReplacement', 'Leave empty to remove illegal characters directly.')
    },
    normalizeDots: {
      type: 'boolean',
      label: pluginFieldLabel('clean-name', 'normalizeDots', 'Normalize Dots'),
      default: true,
      description: pluginFieldDescription('clean-name', 'normalizeDots', 'Merge repeated dots and trim dots at both ends.')
    }
  },
  /**
   * 通过应用各种转换来清理和规范文件名。
   * @param currentName - 要转换的当前文件名
   * @param config - 清理选项的配置
   * @param config.trim - 是否删除前导/尾随空格
   * @param config.collapseWhitespace - 是否将多个空格合并为单个空格
   * @param config.replaceIllegal - 是否替换无效的文件名字符
   * @param illegalReplacement - 用于替换无效字符的字符（空值则删除）
   * @param config.normalizeDots - 是否合并重复的点号并修剪边缘点号
   * @returns 清理和规范后的文件名
   */
  apply: (currentName: string, config: any) => {
    const {
      trim = true,
      collapseWhitespace = true,
      replaceIllegal = true,
      illegalReplacement = '_',
      normalizeDots = true
    } = config || {};

    const { name, ext } = splitNameAndExt(currentName);
    let next = name;

    if (trim) {
      next = next.trim();
    }

    if (collapseWhitespace) {
      next = next.replace(/[\s\u3000]+/g, ' ');
    }

    if (normalizeDots) {
      next = next.replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '');
    }

    if (replaceIllegal) {
      const replacement = String(illegalReplacement ?? '').replace(INVALID_FILE_NAME_CHARS, '');
      next = next.replace(INVALID_FILE_NAME_CHARS, replacement);
    }

    if (!next) {
      next = pluginText('clean-name', 'fallback_name', 'untitled');
    }

    return `${next}${ext}`;
  }
};
