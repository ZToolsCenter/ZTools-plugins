import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * public/plugin.json 的颜色匹配正则 —— 最需要上锁的地方
 *
 * 两条硬约束:
 *   1. 裸 hex 分支必须要求"同时含数字和 a-f 字母", 只用 `^[a-f0-9]{6}$` 会把
 *      decade / facade / accede / beaded 这类英文单词和 123456 / 000000 / ffffff
 *      一起误判成颜色。故加两个 lookahead。
 *   2. 大小写不敏感必须写在 pattern 本身([a-fA-F0-9] / [rR][gG][bB] ...),
 *      不能靠结尾的 /i —— 宿主在主输入框边打边搜时会丢光 flags,
 *      依赖 flag 的话 `#FFF` / `FF0000` 在主输入框里根本不匹配。
 */

interface PluginCmd { type?: string; match?: string; minLength?: number; maxLength?: number; label?: string }
interface PluginFeature { code: string; explain?: string; cmds: Array<string | PluginCmd> }

const plugin = JSON.parse(
  readFileSync(resolve(__dirname, '../public/plugin.json'), 'utf-8'),
) as { features: PluginFeature[] };

/** 取某个功能里 type=regex 的那条命令; 该功能没有 regex 命令时返回 undefined */
function regexCmd(featureCode: string): PluginCmd | undefined {
  const feature = plugin.features.find((f) => f.code === featureCode);
  if (!feature) throw new Error(`plugin.json 里找不到 feature: ${featureCode}`);
  return feature.cmds.find((c): c is PluginCmd => typeof c === 'object' && c.type === 'regex');
}

/** 该功能必须有 regex 命令, 取不到就抛 —— 给"颜色"这条必填路径用 */
function requiredRegexCmd(featureCode: string): PluginCmd {
  const cmd = regexCmd(featureCode);
  if (!cmd) throw new Error(`feature ${featureCode} 里没有 regex 命令`);
  return cmd;
}

/** JSON 里存的是 "/^...$/i" 字符串, 剥掉首尾定界符还原成 RegExp */
function toRegExp(match: string): RegExp {
  const m = match.match(/^\/(.*)\/([a-z]*)$/s);
  if (!m) throw new Error(`match 不是 /.../flags 形式: ${match}`);
  return new RegExp(m[1]!, m[2]!);
}

/**
 * 模拟宿主"边打边搜"分支: parseMatchPattern 的 preserveFlags 为 false, flags 被整个丢掉。
 */
function toRegExpWithoutFlags(match: string): RegExp {
  const m = match.match(/^\/(.*)\/([a-z]*)$/s);
  if (!m) throw new Error(`match 不是 /.../flags 形式: ${match}`);
  return new RegExp(m[1]!);
}

const colorRe = toRegExp(requiredRegexCmd('color').match!);
/** flags 被丢掉后的版本 —— 主输入框实际用到的就是它 */
const colorReNoFlags = toRegExpWithoutFlags(requiredRegexCmd('color').match!);

/** 全部应当匹配的用例, 供两组正则共用 */
const SHOULD_MATCH = [
  '#fff',
  '#FFF',
  '#ffffff',
  '#FFFFFF',
  '#11223344',
  '#11223344'.toUpperCase(),
  'ff0000',
  'FF0000',
  'a1b2c3',
  'A1B2C3',
  '255, 0, 0',
  '255 0 0',
  'rgb(1,2,3)',
  'RGB(1,2,3)',
  'rgb(1, 2, 3)',
  'rgba(1,2,3,0.5)',
  'RGBA(1,2,3,0.5)',
  'hsl(120, 50%, 50%)',
  'HSL(120, 50%, 50%)',
  'hsla(120, 50%, 50%, 0.5)',
  'hsv(120, 50%, 50%)',
  'hsi(120, 50%, 50%)',
  'hsl(120deg, 50%, 50%)',
  '#fff;',
];

const SHOULD_REJECT = [
  // 裸 hex 分支最典型的假阳性: 英文单词与纯数字串
  'decade',
  'facade',
  'accede',
  'beaded',
  '123456',
  '000000',
  'ffffff',
  'DECADE',
  'FACADE',
  // 其它非法输入
  '#gggggg',
  '#GGGGGG',
  '',
  'rgb(1,2,3',
  'rgb(1,2,3)extra',
  'rgb(255, 0, 0,)',
  'hsl(120, 50%, 50%%',
  'rgb(999,0,0)',
  '1,2',
  '1,2,3,4',
  '999,999,999',
  '#ffff',
  'the cafe',
  'the CAFE',
  'red',
  '##fff',
  '#ff',
];

describe('颜色正则的硬约束', () => {
  it('**不使用 maxLength** —— 这不是 RegexCmd 的字段, 写了也不生效', () => {
    // 官方 RegexCmd 只有 { type, minLength, match, label },
    // maxLength 只存在于 OverCmd / FilesCmd。
    expect(requiredRegexCmd('color').maxLength).toBeUndefined();
  });

  it('**不以 /i 收尾** —— 大小写不敏感必须写在 pattern 里', () => {
    // 一旦有人把 /i 加回来当"保险", 这条会红, 提醒他 pattern 已经自足了
    const m = requiredRegexCmd('color').match!;
    expect(m.match(/^\/(.*)\/([a-z]*)$/s)![2]).toBe('');
  });

  it('**pattern 里不含裸的小写关键字** —— rgb/hsl/deg 等都必须写成 [rR][gG][bB]', () => {
    const body = requiredRegexCmd('color').match!.replace(/^\/|\/$/g, '');
    // 先摘掉括号字符类里的内容, 再看剩下的部分有没有裸露的 rgb/hsl/deg
    const outsideClasses = body.replace(/\[[^\]]*\]/g, '□');
    expect(outsideClasses).not.toMatch(/rgb|hsl|hsv|hsi|deg/);
  });

  it('**AI 配色不挂颜色正则** —— 与「颜色」撞同一个入口只会多出一条冗余候选', () => {
    // 粘一个色值时彩色候选由「颜色」一条负责; AI 配色是重交互页面, 不该出现在
    // 这种即时匹配里, 入口只留 "AI 配色" 文本命令。
    expect(regexCmd('ai')).toBeUndefined();
    expect(plugin.features.find((f) => f.code === 'ai')!.cmds).toEqual(['AI 配色']);
  });
});

describe.each([
  ['color(带 flags)', colorRe],
  ['**color(flags 被宿主丢掉, 即边打边搜)**', colorReNoFlags],
])('%s 功能正则', (_name, re) => {
  it.each(SHOULD_MATCH)('应当匹配: %s', (input) => {
    expect(re.test(input)).toBe(true);
  });

  it.each(SHOULD_REJECT)('应当拒绝: %s', (input) => {
    expect(re.test(input)).toBe(false);
  });
});

describe('边打边搜与粘贴/快捷键两条路径结果必须一致', () => {
  // 边打边搜(preserveFlags: false 丢光 flags)与粘贴/快捷键两条路径, 判定必须一致
  it.each([...SHOULD_MATCH, ...SHOULD_REJECT])(
    'preserveFlags 两分支对 %s 的判定相同',
    (input) => {
      expect(colorReNoFlags.test(input)).toBe(colorRe.test(input));
    },
  );

  it('丢 flag 时这几个样本必须仍然匹配', () => {
    for (const s of ['#FFF', '#FFFFFF', 'FF0000', 'A1B2C3', 'RGB(1,2,3)', 'HSL(120, 50%, 50%)']) {
      expect(colorReNoFlags.test(s)).toBe(true);
    }
  });
});

describe('正则标志', () => {
  it('无 g/y 标志, lastIndex 不会导致交替调用结果漂移', () => {
    expect(colorRe.global).toBe(false);
    expect(colorRe.sticky).toBe(false);
    expect(colorReNoFlags.global).toBe(false);
    expect(colorReNoFlags.sticky).toBe(false);
  });
});

describe('侧边栏顺序与 plugin.json 对齐', () => {
  /**
   * 同一个功能在插件里只该有一个排名 —— App.tsx 的 navItems 与 plugin.json 的
   * features 各排一套的话, 改了一处忘了另一处就开始打架, 而且没人看得出来。
   * pickercolor 是纯动作(执行后落在颜色页), 不在侧边栏里, 故排除。
   */
  it('navItems 的 key 序列是 features 剔除 pickercolor 后的子序列', async () => {
    const { navItems } = await import('../App');
    const menuCodes = plugin.features
      .map((f) => f.code)
      .filter((code) => code !== 'pickercolor');

    expect(navItems.map((item) => item.key)).toEqual(menuCodes);
  });

  it('**侧边栏每项在 plugin.json 里都有同名页签** —— 否则点进去的 code 宿主不认', async () => {
    const { navItems } = await import('../App');
    const codes = new Set(plugin.features.map((f) => f.code));

    navItems.forEach((item) => expect(codes.has(item.key)).toBe(true));
  });
});
