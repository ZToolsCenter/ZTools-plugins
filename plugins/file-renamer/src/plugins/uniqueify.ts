import type { PluginActionDefinition, WorkflowContext } from '../core/types';
import {
  pluginDescription,
  pluginFieldDescription,
  pluginFieldLabel,
  pluginFieldOptionLabel,
  pluginName
} from './i18n';

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
 * 根据大小写敏感设置规范化文件名以进行重复检测。
 * @param name - 要规范化的文件名
 * @param caseSensitive - 是否在规范化中保留大小写
 * @returns 用于比较的规范化文件名
 */
function normalizeKey(name: string, caseSensitive: boolean): string {
  return caseSensitive ? name : name.toLowerCase();
}

/**
 * 使用指定的序列号和样式构建唯一的候选文件名。
 * @param baseName - 不含扩展名的基本文件名
 * @param ext - 文件扩展名（含点号）
 * @param serial - 要追加的序列号
 * @param style - 序列号后缀的样式 ('dash' | 'underscore' | 'paren')
 * @param padding - 零填充的最小数字位数
 * @returns 唯一的候选文件名
 */
function buildCandidate(
  baseName: string,
  ext: string,
  serial: number,
  style: string,
  padding: number
): string {
  const serialString = String(serial).padStart(Math.max(0, padding), '0');

  if (style === 'dash') {
    return `${baseName}-${serialString}${ext}`;
  }

  if (style === 'underscore') {
    return `${baseName}_${serialString}${ext}`;
  }

  return `${baseName}(${serialString})${ext}`;
}

type UniqueifyRunState = {
  seen: Set<string>;
  nextSerialByOriginal: Map<string, number>;
};

function getRunState(context: WorkflowContext): UniqueifyRunState {
  const stateKey = `uniqueify:${context.actionInstanceId}`;
  const existing = context.runtime.sharedState.get(stateKey) as UniqueifyRunState | undefined;
  if (existing) {
    return existing;
  }

  const initialState: UniqueifyRunState = {
    seen: new Set<string>(),
    nextSerialByOriginal: new Map<string, number>()
  };

  context.runtime.sharedState.set(stateKey, initialState);
  return initialState;
}

/**
 * 用于通过追加序列号确保文件名唯一的插件。
 * 自动处理批处理中的名称冲突。
 */
export const uniqueifyPlugin: PluginActionDefinition = {
  id: 'uniqueify',
  name: pluginName('uniqueify', 'Smart Unique'),
  description: pluginDescription('uniqueify', 'Automatically append sequence numbers when names collide.'),
  configSchema: {
    style: {
      type: 'select',
      label: pluginFieldLabel('uniqueify', 'style', 'Suffix Style'),
      default: 'paren',
      description: pluginFieldDescription('uniqueify', 'style', 'How duplicate indexes should be displayed.'),
      options: [
        { label: pluginFieldOptionLabel('uniqueify', 'style', 'paren', '(1) style'), value: 'paren' },
        { label: pluginFieldOptionLabel('uniqueify', 'style', 'dash', '-1 style'), value: 'dash' },
        { label: pluginFieldOptionLabel('uniqueify', 'style', 'underscore', '_1 style'), value: 'underscore' }
      ]
    },
    start: {
      type: 'number',
      label: pluginFieldLabel('uniqueify', 'start', 'Start Number'),
      default: 1,
      description: pluginFieldDescription('uniqueify', 'start', 'First index used when a collision occurs.')
    },
    padding: {
      type: 'number',
      label: pluginFieldLabel('uniqueify', 'padding', 'Zero Padding'),
      default: 0,
      description: pluginFieldDescription('uniqueify', 'padding', 'Set 2 to generate values like 01 and 02.')
    },
    caseSensitive: {
      type: 'boolean',
      label: pluginFieldLabel('uniqueify', 'caseSensitive', 'Case Sensitive'),
      default: false,
      description: pluginFieldDescription('uniqueify', 'caseSensitive', 'When disabled, File and file are treated as duplicates.')
    }
  },
  /**
   * 通过在检测到重复时追加序列号来生成唯一的文件名。
   * @param currentName - 要转换的当前文件名
   * @param config - 唯一化配置
   * @param config.style - 后缀样式 ('paren' | 'dash' | 'underscore')
   * @param config.start - 冲突时的起始编号
   * @param config.padding - 序列号的零填充宽度
   * @param config.caseSensitive - 重复检测是否区分大小写
   * @param context - 包含文件索引的工作流上下文
   * @returns 如果需要则带后缀的唯一文件名
   */
  apply: (currentName: string, config: any, context: WorkflowContext) => {
    const runState = getRunState(context);

    const {
      style = 'paren',
      start = 1,
      padding = 0,
      caseSensitive = false
    } = config || {};

    const normalizedCurrent = normalizeKey(currentName, Boolean(caseSensitive));
    if (!runState.seen.has(normalizedCurrent)) {
      runState.seen.add(normalizedCurrent);
      return currentName;
    }

    const { name, ext } = splitNameAndExt(currentName);
    const originalKey = normalizeKey(currentName, Boolean(caseSensitive));

    const safeStart = Number.isFinite(Number(start)) ? Number(start) : 1;
    const safePadding = Number.isFinite(Number(padding))
      ? Math.max(0, Math.floor(Number(padding)))
      : 0;

    let serial = runState.nextSerialByOriginal.get(originalKey) ?? safeStart;

    while (true) {
      const candidate = buildCandidate(name, ext, serial, String(style), safePadding);
      const candidateKey = normalizeKey(candidate, Boolean(caseSensitive));
      if (!runState.seen.has(candidateKey)) {
        runState.seen.add(candidateKey);
        runState.nextSerialByOriginal.set(originalKey, serial + 1);
        return candidate;
      }
      serial += 1;
    }
  }
};
