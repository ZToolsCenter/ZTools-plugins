import { replacePlugin } from './replace';
import { addPrefixSuffixPlugin } from './add-prefix-suffix';
import { caseTransformPlugin } from './case-transform';
import { sequencePlugin } from './sequence';
import { templatePlugin } from './template';
import { timestampPlugin } from './timestamp';
import { cleanNamePlugin } from './clean-name';
import { extensionTransformPlugin } from './extension-transform';
import { uniqueifyPlugin } from './uniqueify';
import { deleteCharPlugin } from './delete-char';

/**
 * 聚合所有内置插件以进行集中导出。
 * 这些插件在应用程序初始化时自动注册。
 */
export const builtInPlugins = [
  replacePlugin,
  addPrefixSuffixPlugin,
  caseTransformPlugin,
  sequencePlugin,
  templatePlugin,
  timestampPlugin,
  cleanNamePlugin,
  extensionTransformPlugin,
  uniqueifyPlugin,
  deleteCharPlugin
];
