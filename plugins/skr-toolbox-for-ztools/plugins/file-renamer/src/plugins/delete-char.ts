import type { PluginActionDefinition } from '../core/types';
import {
  pluginDescription,
  pluginFieldDescription,
  pluginFieldLabel,
  pluginName
} from './i18n';

/**
 * 用于从文件名中删除特定字符的插件。
 * 支持多种删除模式：按字符、按类型、按位置、去重。
 * 所有删除操作均基于 Unicode 字素簇（grapheme cluster），
 * 以确保 emoji、组合字符等复杂字符被正确处理。
 */
export const deleteCharPlugin: PluginActionDefinition = {
  id: 'delete-char',
  name: pluginName('delete-char', 'Delete Character'),
  description: pluginDescription('delete-char', 'Delete specific characters from file names.'),
  configSchema: {
    /**
     * 删除模式选择：
     * - chars: 删除指定字符
     * - type: 按字符类型删除
     * - position: 按位置删除
     * - dedupe: 移除重复字符
     */
    mode: {
      type: 'select',
      label: pluginFieldLabel('delete-char', 'mode', 'Mode'),
      default: 'chars',
      description: pluginFieldDescription('delete-char', 'mode', 'Choose deletion mode.'),
      options: [
        { value: 'chars', label: 'Delete Specific Characters' },
        { value: 'type', label: 'Delete by Type' },
        { value: 'position', label: 'Delete by Position' },
        { value: 'dedupe', label: 'Remove Duplicates' }
      ]
    },
    /**
     * 要删除的字符列表（模式为 chars 时使用）
     */
    chars: {
      type: 'string',
      label: pluginFieldLabel('delete-char', 'chars', 'Characters'),
      default: '',
      description: pluginFieldDescription('delete-char', 'chars', 'Characters to delete.')
    },
    /**
     * 是否区分大小写（模式为 chars 时使用）
     */
    caseSensitive: {
      type: 'boolean',
      label: pluginFieldLabel('delete-char', 'caseSensitive', 'Case Sensitive'),
      default: false,
      description: pluginFieldDescription('delete-char', 'caseSensitive', 'Match case when disabled.')
    },
    /**
     * 要删除的字符类型（模式为 type 时使用）：
     * - space: 空白字符（含全角空格、制表符等）
     * - alpha: 字母（含所有 Unicode 字母）
     * - digit: 数字（含所有 Unicode 数字）
     * - upper: 大写字母
     * - lower: 小写字母
     * - punct: 标点符号
     * - chinese: 中文字符
     * - non-ascii: 非ASCII字符
     */
    type: {
      type: 'select',
      label: pluginFieldLabel('delete-char', 'type', 'Type'),
      default: 'space',
      description: pluginFieldDescription('delete-char', 'type', 'Character type to delete.'),
      options: [
        { value: 'space', label: 'Space' },
        { value: 'alpha', label: 'Letter' },
        { value: 'digit', label: 'Digit' },
        { value: 'upper', label: 'Uppercase' },
        { value: 'lower', label: 'Lowercase' },
        { value: 'punct', label: 'Punctuation' },
        { value: 'chinese', label: 'Chinese' },
        { value: 'non-ascii', label: 'Non-ASCII' }
      ]
    },
    /**
     * 删除位置（模式为 position 时使用）：
     * - first: 第一个字符
     * - last: 最后一个字符
     * - firstN: 前N个字符
     * - lastN: 后N个字符
     * - nth: 第N个字符
     */
    position: {
      type: 'select',
      label: pluginFieldLabel('delete-char', 'position', 'Position'),
      default: 'first',
      description: pluginFieldDescription('delete-char', 'position', 'Position to delete from.'),
      options: [
        { value: 'first', label: 'First' },
        { value: 'last', label: 'Last' },
        { value: 'firstN', label: 'First N' },
        { value: 'lastN', label: 'Last N' },
        { value: 'nth', label: 'Nth Character' }
      ]
    },
    /**
     * 要删除的字符数量（位置模式使用时生效）
     */
    count: {
      type: 'number',
      label: pluginFieldLabel('delete-char', 'count', 'Count'),
      default: 1,
      min: 1,
      description: pluginFieldDescription('delete-char', 'count', 'Number of characters to delete.')
    },
    /**
     * 去重风格（模式为 dedupe 时使用）：
     * - adjacent: 仅合并相邻的重复字符
     * - all: 移除所有重复字符
     */
    style: {
      type: 'select',
      label: pluginFieldLabel('delete-char', 'style', 'Style'),
      default: 'adjacent',
      description: pluginFieldDescription('delete-char', 'style', 'Deduplication style.'),
      options: [
        { value: 'adjacent', label: 'Adjacent' },
        { value: 'all', label: 'All' }
      ]
    },
    /**
     * 目标字符（模式为 dedupe 时使用）
     * 为空则应用于所有字符，否则仅处理指定字符
     */
    targetChar: {
      type: 'string',
      label: pluginFieldLabel('delete-char', 'targetChar', 'Target Character'),
      default: '',
      description: pluginFieldDescription('delete-char', 'targetChar', 'Leave empty to apply to all.')
    },
    /**
     * 是否保护文件扩展名
     * 启用时，扩展名部分不会被删除
     */
    protectExtension: {
      type: 'boolean',
      label: pluginFieldLabel('delete-char', 'protectExtension', 'Protect Extension'),
      default: true,
      description: pluginFieldDescription('delete-char', 'protectExtension', 'Do not delete characters in file extension.')
    }
  },
  /**
   * 根据配置删除文件名中的字符。
   * 所有操作基于 Unicode 字素簇，保证 emoji、组合字符等不被截断。
   * @param currentName - 要处理的当前文件名
   * @param config - 删除选项配置
   * @param config.mode - 删除模式：chars | type | position | dedupe
   * @param config.chars - 要删除的字符（mode为chars时使用）
   * @param config.caseSensitive - 是否区分大小写
   * @param config.type - 字符类型（mode为type时使用）
   * @param config.position - 删除位置（mode为position时使用）
   * @param config.count - 删除数量
   * @param config.style - 去重风格（mode为dedupe时使用）
   * @param config.targetChar - 目标字符（mode为dedupe时使用）
   * @param config.protectExtension - 是否保护文件扩展名（默认true）
   * @returns 处理后的文件名
   */
  apply: (currentName: string, config: any) => {
    const { mode, protectExtension = true } = config;

    const splitNameAndExt = (name: string): { name: string; ext: string } => {
      const lastDot = name.lastIndexOf('.');
      if (lastDot <= 0) {
        return { name, ext: '' };
      }
      return { name: name.slice(0, lastDot), ext: name.slice(lastDot) };
    };

    const { name: nameWithoutExt, ext } = splitNameAndExt(currentName);

    const splitGraphemes = (value: string): string[] => {
      if (!value) return [];

      if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
        const segmenter = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' });
        return Array.from(segmenter.segment(value), (part: any) => part.segment);
      }

      return Array.from(value);
    };

    const normalizeCompareKey = (value: string, caseSensitive: boolean): string => {
      const normalized = value.normalize('NFC');
      return caseSensitive ? normalized : normalized.toLowerCase();
    };

    const removeSpecificChars = (value: string, chars: string, caseSensitive: boolean): string => {
      const targets = splitGraphemes(chars);
      if (!targets.length) return value;

      const targetSet = new Set(targets.map(char => normalizeCompareKey(char, caseSensitive)));

      return splitGraphemes(value)
        .filter(char => !targetSet.has(normalizeCompareKey(char, caseSensitive)))
        .join('');
    };

    const removeByType = (value: string, type: string): string => {
      const typeRegexMap: Record<string, RegExp> = {
        space: /\p{White_Space}/gu,
        alpha: /\p{L}/gu,
        digit: /\p{Nd}/gu,
        upper: /\p{Lu}/gu,
        lower: /\p{Ll}/gu,
        punct: /\p{P}/gu,
        chinese: /\p{Script=Han}/gu,
        'non-ascii': /\P{ASCII}/gu
      };

      return value.replace(typeRegexMap[type] ?? typeRegexMap.space, '');
    };

    const removeByPosition = (value: string, position: string, count: number): string => {
      const graphemes = splitGraphemes(value);
      const len = graphemes.length;

      if (count <= 0) return value;

      switch (position) {
        case 'first':
          return graphemes.slice(1).join('');
        case 'last':
          return graphemes.slice(0, -1).join('');
        case 'firstN':
          return graphemes.slice(Math.min(count, len)).join('');
        case 'lastN':
          return graphemes.slice(0, -Math.min(count, len)).join('');
        case 'nth':
          if (count < 1 || count > len) return value;
          return graphemes.filter((_, index) => index !== count - 1).join('');
        default:
          return value;
      }
    };

    const dedupeChars = (value: string, style: string, targetChar: string): string => {
      const graphemes = splitGraphemes(value);
      const targetGraphemes = splitGraphemes(targetChar);
      const target = targetGraphemes[0];
      const targetKey = target ? normalizeCompareKey(target, false) : '';

      if (!target) {
        if (style === 'adjacent') {
          const result: string[] = [];
          for (const grapheme of graphemes) {
            if (result[result.length - 1] !== grapheme) {
              result.push(grapheme);
            }
          }
          return result.join('');
        }

        const seen = new Set<string>();
        return graphemes
          .filter(grapheme => {
            if (seen.has(grapheme)) return false;
            seen.add(grapheme);
            return true;
          })
          .join('');
      }

      if (style === 'adjacent') {
        const result: string[] = [];
        let previousKey = '';
        for (const grapheme of graphemes) {
          const key = normalizeCompareKey(grapheme, false);
          if (key !== targetKey || previousKey !== targetKey) {
            result.push(grapheme);
          }
          previousKey = key;
        }
        return result.join('');
      }

      let seenTarget = false;
      return graphemes
        .filter(grapheme => {
          const key = normalizeCompareKey(grapheme, false);
          if (key !== targetKey) return true;
          if (seenTarget) return false;
          seenTarget = true;
          return true;
        })
        .join('');
    };

    const targetName = protectExtension ? nameWithoutExt : currentName;

    let result: string;

    switch (mode) {
      case 'chars': {
        const { chars, caseSensitive } = config;
        if (!chars) return currentName;
        result = removeSpecificChars(targetName, chars, !!caseSensitive);
        break;
      }

      case 'type': {
        const { type } = config;
        result = removeByType(targetName, type);
        break;
      }

      case 'position': {
        const { position, count = 1 } = config;
        result = removeByPosition(targetName, position, count);
        break;
      }

      case 'dedupe': {
        const { style, targetChar } = config;
        result = dedupeChars(targetName, style, targetChar);
        break;
      }

      default:
        return currentName;
    }

    return protectExtension ? `${result}${ext}` : result;
  }
};