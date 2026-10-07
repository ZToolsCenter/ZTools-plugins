import { describe, it, expect } from 'vitest';
import { parseColorInput as parseStrict, parseColorByType } from '../pages/ColorPage';
import { parseColorInput as parseLoose } from '../pages/AIPalettePage';

/**
 * 一个项目里有两套颜色解析, 行为不同 —— 这是**已知设计分歧**, 不是 bug:
 *
 * | 位置                     | 实现              | 特点                                       |
 * |--------------------------|-------------------|--------------------------------------------|
 * | pages/ColorPage.tsx      | 逐格式正则        | 严格; 支持 hex/rgb/hsl/hsi/hsv/cmyk/lab    |
 * | pages/AIPalettePage.tsx  | 直接 chroma(str)  | 宽松; 接受 chroma 认识的任何写法           |
 *
 * 测试记录**当前**行为, 不做"修正"; 若将来要统一, 应作为独立一轮讨论。
 */

describe('ColorPage.parseColorInput(严格)', () => {
  it.each([
    ['#fff', '#ffffff'],
    ['#ffffff', '#ffffff'],
    ['#FF0000', '#ff0000'],
    ['ff0000', '#ff0000'],
    ['rgb(255, 0, 0)', '#ff0000'],
    ['hsl(120, 50%, 50%)', '#40bf40'],
    ['hsi(120, 50%, 50%)', '#40ff40'],
    ['hsv(120, 50%, 50%)', '#408040'],
    ['lab(50, 40, 30)', '#bf5846'],
  ])('接受 %s → %s', (input, expected) => {
    expect(parseStrict(input)?.hex()).toBe(expected);
  });

  it.each(['not-a-color', '#ggg', '', '#ff', '#12345', '255, 0, 0', 'cmyk(0, 100, 100, 0)'])(
    '拒绝 %s',
    (input) => {
      expect(parseStrict(input)).toBeNull();
    },
  );

  it('8 位 hex 丢弃前两位 alpha(#11223344 → #223344)', () => {
    expect(parseStrict('#11223344')?.hex()).toBe('#223344');
  });

  it('短于 4 字符的输入直接拒绝(不进入格式判定)', () => {
    expect(parseStrict('#f')).toBeNull();
    expect(parseStrict('abc')).toBeNull();
  });
});

describe('ColorPage.parseColorByType(按格式)', () => {
  it('hex 只接受不带 # 的 6 位', () => {
    expect(parseColorByType('hex', 'ff0000')?.hex()).toBe('#ff0000');
    expect(parseColorByType('hex', '#ff0000')).toBeNull();
    expect(parseColorByType('hex', 'fff')).toBeNull();
  });

  it('rgb 同时支持逗号与空格分隔', () => {
    expect(parseColorByType('rgb', '255, 0, 0')?.hex()).toBe('#ff0000');
    expect(parseColorByType('rgb', '255 0 0')?.hex()).toBe('#ff0000');
  });

  it('rgb 不做上界校验 —— 999 被交给 chroma 钳制(现状, 未修改)', () => {
    // 上游 plugin.json 的颜色正则会挡住这类输入, 这里是用户手输格式框的宽松路径
    expect(parseColorByType('rgb', '999,0,0')).not.toBeNull();
  });

  it('cmyk 支持百分数与 0..1 两种写法', () => {
    expect(parseColorByType('cmyk', '0, 100, 100, 0')?.hex()).toBe('#ff0000');
    expect(parseColorByType('cmyk', '0%, 100%, 100%, 0%')?.hex()).toBe('#ff0000');
    expect(parseColorByType('cmyk', '1, 1, 1, 1')?.hex()).toBe('#000000');
  });

  it('hsl / hsi / hsv 走 chroma 对应色彩空间, 结果互不相同', () => {
    const hsl = parseColorByType('hsl', '120, 50%, 50%')!.hex();
    const hsi = parseColorByType('hsi', '120, 50%, 50%')!.hex();
    const hsv = parseColorByType('hsv', '120, 50%, 50%')!.hex();
    expect(hsl).toBe('#40bf40');
    expect(hsi).toBe('#40ff40');
    expect(hsv).toBe('#408040');
    expect(new Set([hsl, hsi, hsv]).size).toBe(3);
  });

  it('未知格式一律 null', () => {
    expect(parseColorByType('nope', '123')).toBeNull();
  });
});

describe('AIPalettePage.parseColorInput(宽松)', () => {
  it.each(['#fff', '#ffffff', '#FF0000', 'ff0000', 'rgb(255, 0, 0)', 'hsl(120, 50%, 50%)', 'red'])(
    '接受 %s',
    (input) => {
      expect(parseLoose(input)).not.toBeNull();
    },
  );

  it.each(['not-a-color', '#ggg', '', '255, 0, 0'])('拒绝 %s', (input) => {
    expect(parseLoose(input)).toBeNull();
  });

  it('null 输入返回 null', () => {
    expect(parseLoose(null)).toBeNull();
  });
});

describe('两套实现的已知分歧(记录现状, 不视为缺陷)', () => {
  it('cmyk: 严格实现能解析, 宽松实现(纯 chroma)不能', () => {
    // chroma 本身没有 cmyk 字符串语法
    expect(parseStrict('cmyk(0, 100, 100, 0)')).toBeNull();
    expect(parseLoose('cmyk(0, 100, 100, 0)')).toBeNull();
    // 但严格实现"按格式"这条路径能处理 —— 页面上 cmyk 输入框直接走 parseColorByType
    expect(parseColorByType('cmyk', '0, 100, 100, 0')).not.toBeNull();
  });

  it('#11223344: 两者**不一致** —— 严格实现丢弃前两位, chroma 当成 RGBA', () => {
    // 这是真实的分歧点, 不是笔误:
    //   ColorPage  把 8 位当 "忽略 alpha 的 #RRGGBBAA" -> 取后 6 位 #223344
    //   chroma     把 8 位当 RGBA, 前两位是 alpha 通道 -> 显式 hex() 给 #11223345
    // 8 位 hex 只可能从上游 plugin.json 的正则进来(输入框不产出), 影响面小;
    // 若将来要统一, 应作为独立一轮讨论, 这里只记录现状。
    expect(parseStrict('#11223344')!.hex()).toBe('#223344');
    expect(parseLoose('#11223344')!.hex()).toBe('#11223345');
  });

  it('对非法输入两者都返回 null', () => {
    for (const bad of ['not-a-color', '#ggg', 'zzz']) {
      expect(parseStrict(bad)).toBeNull();
      expect(parseLoose(bad)).toBeNull();
    }
  });
});
