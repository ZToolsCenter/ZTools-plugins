// @ts-nocheck TODO: 添加类型注解后移除
export { amberTheme } from './amber.js';
export { midnightTheme } from './midnight.js';
export { deepnightTheme } from './deepnight.js';
export { buildOverrides } from './buildOverrides.js';

import { amberTheme } from './amber.js';
import { midnightTheme } from './midnight.js';
import { deepnightTheme } from './deepnight.js';

/** 所有可用主题列表，后期新增主题在此添加即可 */
export const themes = [amberTheme, midnightTheme, deepnightTheme];

/** 默认主题名称 */
export const defaultThemeName = 'amber';

/** 按名称查找主题 */
export function getThemeByName(name) {
  return themes.find(t => t.name === name) || themes[0];
}
