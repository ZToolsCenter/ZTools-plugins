import { describe, it, expect, beforeEach } from 'vitest';
import { db, dbStorage } from '../utils/platform';
import { COLLECT_SORT_KEY, collectDocId, normalizeHex, saveCollectedColor } from '../utils/collect';

/**
 * 收藏颜色的公共写入 (utils/collect.ts)
 *
 * 与 CollectColorsPage 共用同一份 db 文档形状 —— 这里锁住的正是
 * "两个入口必须写出同一种文档" 这条约束: 改了形状收藏页就认不出来了。
 */

beforeEach(() => {
  localStorage.clear();
  delete (window as any).platform;
});

describe('collectDocId', () => {
  it('色值转小写并去掉 "#"', () => {
    expect(collectDocId('#FF0000')).toBe('color/ff0000');
    expect(collectDocId('ff0000')).toBe('color/ff0000');
  });
});

describe('normalizeHex', () => {
  it('补齐并统一成大写的 #RRGGBB', () => {
    expect(normalizeHex('f00')).toBe('#FF0000');
    expect(normalizeHex('#f00')).toBe('#FF0000');
    expect(normalizeHex('  #FF0000  ')).toBe('#FF0000');
    expect(normalizeHex('rgb(255, 0, 0)')).toBe('#FF0000');
    expect(normalizeHex('hsl(0, 100%, 50%)')).toBe('#FF0000');
  });

  it('半透明色归一化成 8 位 #RRGGBBAA', () => {
    expect(normalizeHex('#ff000080')).toBe('#FF000080');
    expect(normalizeHex('rgba(255, 0, 0, 0.5)')).toBe('#FF000080');
  });

  it('非法色值返回 null', () => {
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex('   ')).toBeNull();
    expect(normalizeHex('not-a-color')).toBeNull();
    expect(normalizeHex(undefined as unknown as string)).toBeNull();
  });
});

describe('saveCollectedColor', () => {
  it('写入收藏页认得的文档形状', () => {
    expect(saveCollectedColor('#FF0000')).toBe(true);

    // dark 走与收藏页同一个 isDarkColor 判据 —— #FF0000 亮度高于阈值, 判为不深
    expect(db.get('color/ff0000')).toMatchObject({
      _id: 'color/ff0000',
      name: '',
      color: '#FF0000',
      dark: false,
    });

    saveCollectedColor('#000000');
    expect(db.get('color/000000')).toMatchObject({ color: '#000000', dark: true });
  });

  it('同一颜色只存一条, 重复收藏返回 false', () => {
    expect(saveCollectedColor('#FF0000')).toBe(true);
    // 大小写/格式不同也算同一个颜色
    expect(saveCollectedColor('rgb(255, 0, 0)')).toBe(false);
    expect(db.allDocs('color/')).toHaveLength(1);
  });

  it('非法色值不写库', () => {
    expect(saveCollectedColor('什么')).toBe(false);
    expect(db.allDocs('color/')).toEqual([]);
  });

  it('把新收藏追加进 collectsort, 收藏页才会在末尾显示它', () => {
    db.put({ _id: 'color/000000', name: '', color: '#000000', dark: true });
    dbStorage.setItem(COLLECT_SORT_KEY, ['color/000000']);

    saveCollectedColor('#FF0000');

    expect(dbStorage.getItem(COLLECT_SORT_KEY)).toEqual(['color/000000', 'color/ff0000']);
  });

  it('补上 db 里已有、索引里缺失的 id, 避免它们永远排在末尾', () => {
    db.put({ _id: 'color/000000', name: '', color: '#000000', dark: true });

    saveCollectedColor('#FF0000');

    expect(dbStorage.getItem(COLLECT_SORT_KEY)).toEqual(['color/000000', 'color/ff0000']);
  });

  it('collectsort 存了非数组时按空索引重建, 不抛错', () => {
    dbStorage.setItem(COLLECT_SORT_KEY, 'broken');

    expect(saveCollectedColor('#FF0000')).toBe(true);
    expect(dbStorage.getItem(COLLECT_SORT_KEY)).toEqual(['color/ff0000']);
  });
});
