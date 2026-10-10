import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * data/ 下 10 个 JSON 的结构与色值合法性
 *
 * 数据是业务资产, 回归成本低 —— 记录数写成基线断言, 改动时会被提醒。
 * 已知的**故意保留项**在下面标了"预期如此", 不是失败。
 */

function load<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(__dirname, `../data/${name}.json`), 'utf-8')) as T;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

type GradientData = string[][];
interface UIItem { title: string; colors: Array<string | string[]> }
interface ChinaGroup { title: string; colors: Array<{ name: string; color: string }> }
interface JapanItem { name: string; jname: string; color: string }

const GRADIENTS = ['gradients-eT', 'gradients-nT', 'gradients-tT'] as const;
const UIS = ['ui-ant-design', 'ui-flat-ui', 'ui-fluent', 'ui-material-design', 'ui-open-color'] as const;
const ALL = [...GRADIENTS, ...UIS, 'traditional-china', 'traditional-japan'];

describe('全部 JSON 都能解析且顶层是数组', () => {
  it.each(ALL)('%s', (name) => {
    expect(Array.isArray(load(name))).toBe(true);
  });
});

describe('记录数基线(数据变更时应被提醒)', () => {
  it.each([
    ['gradients-eT', 10],
    ['gradients-nT', 382],
    ['gradients-tT', 60],
    ['traditional-china', 24],
    ['traditional-japan', 465],
    ['ui-ant-design', 13],
    ['ui-flat-ui', 14],
    ['ui-fluent', 4],
    ['ui-material-design', 19],
    ['ui-open-color', 13],
  ])('%s = %i 条', (name, count) => {
    expect(load<unknown[]>(name as string)).toHaveLength(count as number);
  });

  it('traditional-china 共 24 组 / 384 色', () => {
    const groups = load<ChinaGroup[]>('traditional-china');
    expect(groups).toHaveLength(24);
    expect(groups.reduce((s, g) => s + g.colors.length, 0)).toBe(384);
    // 每组 16 色(24 节气 × 16 = 384)
    expect(new Set(groups.map((g) => g.colors.length))).toEqual(new Set([16]));
  });
});

describe('渐变数据', () => {
  it.each(GRADIENTS)('%s 每个渐变 >= 2 个停靠点', (name) => {
    for (const g of load<GradientData>(name)) {
      expect(g.length).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(GRADIENTS)('%s 非空色值均为 3 或 6 位 hex', (name) => {
    // 3 位 hex 只允许一处(见下一条断言把例外钉死)
    for (const g of load<GradientData>(name)) {
      for (const c of g) {
        expect(c).toMatch(/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/);
      }
    }
  });

  it('gradients-nT[27] 是唯一一处 3 位 hex("#FFF") —— 预期如此, 但记录在案', () => {
    // 全项目其余色值都是 6 位, 只有这一条是 "#FFF"。
    // chroma 能正常解析, 所以不影响渲染; 但若将来做数据清洗应把它规范化为 "#FFFFFF"。
    // 这条断言的作用是把该例外钉住: 多出任何一处 3 位 hex 都会让这条测试变红。
    const threeDigit: Array<{ index: number; value: string }> = [];
    for (const name of GRADIENTS) {
      load<GradientData>(name).forEach((g, i) => {
        for (const c of g) if (/^#[0-9a-fA-F]{3}$/.test(c)) threeDigit.push({ index: i, value: c });
      });
    }
    expect(threeDigit).toEqual([{ index: 27, value: '#FFF' }]);
  });

  it('gradients-nT 有 5 组重复渐变 —— 预期如此(内容决策, 不视为缺陷)', () => {
    const seen = new Set<string>();
    let dup = 0;
    for (const g of load<GradientData>('gradients-nT')) {
      const key = g.join('|');
      if (seen.has(key)) dup++;
      seen.add(key);
    }
    expect(dup).toBe(5);
    expect(seen.size).toBe(377);
  });
});

describe('UI 色卡数据', () => {
  it.each(UIS)('%s 的所有非空色值均为 6 位 hex', (name) => {
    for (const group of load<UIItem[]>(name)) {
      for (const entry of group.colors) {
        const arr = Array.isArray(entry) ? entry : [entry];
        for (const c of arr) {
          if (c === '') continue; // 见下: material 的空串是预期如此
          expect(c).toMatch(HEX6);
        }
      }
    }
  });

  it('ui-material-design 固定 14 槽, 其中 12 个是空串 —— 预期如此', () => {
    // Brown / Grey / Blue Grey 的 A100–A400 Material 官方无此强调色
    const data = load<UIItem[]>('ui-material-design');
    expect(data).toHaveLength(19);
    expect(new Set(data.map((g) => g.colors.length))).toEqual(new Set([14]));
    const empties = data.flatMap((g) => g.colors).filter((c) => c === '').length;
    expect(empties).toBe(12);
  });

  it('ui-flat-ui 每槽是一组色阶(长度为 2 的数组), 不是单个色值', () => {
    for (const group of load<UIItem[]>('ui-flat-ui')) {
      expect(Array.isArray(group.colors[0])).toBe(true);
      expect((group.colors[0] as string[]).length).toBe(2);
    }
  });

  it('每个 UI 色卡都有 title', () => {
    for (const name of UIS) {
      for (const group of load<UIItem[]>(name)) {
        expect(typeof group.title).toBe('string');
        expect(group.title.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('传统色数据', () => {
  it('465 条日本色都有 jname', () => {
    const japan = load<JapanItem[]>('traditional-japan');
    expect(japan).toHaveLength(465);
    expect(japan.filter((c) => !c.jname)).toHaveLength(0);
  });

  it('中国色无重名', () => {
    const names = load<ChinaGroup[]>('traditional-china').flatMap((g) => g.colors.map((c) => c.name));
    expect(names).toHaveLength(384);
    expect(new Set(names).size).toBe(384);
  });

  it('中国色无重色', () => {
    const colors = load<ChinaGroup[]>('traditional-china').flatMap((g) => g.colors.map((c) => c.color.toUpperCase()));
    const dup = colors.length - new Set(colors).size;
    expect(dup).toBe(0);
  });

  it.each(['traditional-china', 'traditional-japan'] as const)('%s 的色值均为 6 位 hex', (name) => {
    const raw = load<ChinaGroup[] | JapanItem[]>(name);
    const colors = Array.isArray(raw) && typeof raw[0] === 'object' && 'colors' in (raw[0] as object)
      ? (raw as ChinaGroup[]).flatMap((g) => g.colors.map((c) => c.color))
      : (raw as JapanItem[]).map((c) => c.color);
    expect(colors.length).toBeGreaterThan(0);
    for (const c of colors) expect(c).toMatch(HEX6);
  });

  it('传统色名称不含占位符', () => {
    const PLACEHOLDER = /^(?:test|测试|unnamed|n\/a|null|undefined|无|-|未知|placeholder)$/i;
    const china = load<ChinaGroup[]>('traditional-china').flatMap((g) => g.colors.map((c) => c.name));
    const japan = load<JapanItem[]>('traditional-japan').map((c) => c.name);
    for (const n of [...china, ...japan]) {
      expect(n).not.toMatch(PLACEHOLDER);
      expect(n.trim().length).toBeGreaterThan(0);
    }
  });
});