/**
 * hunk 导航锚点下标翻译单元测试（roadmap 任务 UI-010）。
 *
 * 覆盖 `src/stores/nav.ts` 的纯函数出口 `translateAnchorToPaired`（导航态
 * 本身依赖 diffStore 响应式单例，归视图层集成验证；本文件专注可单测的
 * 「原始 rows → 配对序列」下标翻译）：
 * - 快路径：配对未合并任何行（两序列等长）时锚点原样返回；
 * - 常规翻译：del+add 配对为 modify 后，锚点两端点按存在侧 lineNo 平移；
 * - 端点形态：del 开头 / add 开头 / 单对折叠（start === end）/ 跨全序列；
 * - 防御：anchor 非法（start < 0 / end < start / end 越界 / 非整数）与
 *   lineNo 定位失败一律返回 { start: -1, end: -1 }；
 * - 纯函数约定：不改入参（不可变风格，对齐 core 层）。
 */
import { describe, expect, it } from 'vitest'
import { translateAnchorToPaired } from '../../src/stores/nav'
import type { DiffRow } from '../../src/core/types'

/* -------------------------------------------------------------------------- */
/* DiffRow 测试夹具（形状对齐 core/types.ts 契约）                              */
/* -------------------------------------------------------------------------- */

function equal(leftLineNo: number, rightLineNo: number, text: string): DiffRow {
  return {
    type: 'equal',
    left: { lineNo: leftLineNo, text },
    right: { lineNo: rightLineNo, text },
  }
}

function del(lineNo: number, text: string): DiffRow {
  return { type: 'del', left: { lineNo, text } }
}

function add(lineNo: number, text: string): DiffRow {
  return { type: 'add', right: { lineNo, text } }
}

function modify(
  leftLineNo: number,
  rightLineNo: number,
  leftText: string,
  rightText: string,
): DiffRow {
  return {
    type: 'modify',
    left: { lineNo: leftLineNo, text: leftText },
    right: { lineNo: rightLineNo, text: rightText },
  }
}

const NOT_FOUND = { start: -1, end: -1 }

/* -------------------------------------------------------------------------- */
/* 快路径与常规翻译                                                            */
/* -------------------------------------------------------------------------- */

describe('translateAnchorToPaired：快路径', () => {
  it('配对未合并任何行（两序列等长）→ 锚点原样返回（纯增删 diff 的常见形态）', () => {
    const original = [equal(1, 1, 'a'), del(2, 'b'), add(2, 'c'), equal(3, 3, 'd')]
    // 等长即可走快路径（函数契约只看长度；此处构造上同为「无合并」形态）。
    const paired = [equal(1, 1, 'a'), del(2, 'b'), add(2, 'c'), equal(3, 3, 'd')]
    expect(translateAnchorToPaired({ start: 1, end: 2 }, original, paired)).toEqual({
      start: 1,
      end: 2,
    })
    expect(translateAnchorToPaired({ start: 0, end: 3 }, original, paired)).toEqual({
      start: 0,
      end: 3,
    })
  })
})

describe('translateAnchorToPaired：常规翻译', () => {
  // 典型替换区：原 2 行删、新 2 行增，相似度达标配对为两条 modify。
  const original = [
    equal(1, 1, 'head'),
    del(2, 'old-1'),
    del(3, 'old-2'),
    add(2, 'new-1'),
    add(3, 'new-2'),
    equal(4, 4, 'tail'),
  ]
  const paired = [
    equal(1, 1, 'head'),
    modify(2, 2, 'old-1', 'new-1'),
    modify(3, 3, 'old-2', 'new-2'),
    equal(4, 4, 'tail'),
  ]

  it('hunk 覆盖整个替换区（del 开头、add 结尾）→ 两端点各自平移为 modify 区间', () => {
    expect(translateAnchorToPaired({ start: 1, end: 4 }, original, paired)).toEqual({
      start: 1,
      end: 2,
    })
  })

  it('端点是 add 行（其镜像 del 已被配对）→ 按 right.lineNo 定位到 modify', () => {
    expect(translateAnchorToPaired({ start: 3, end: 4 }, original, paired)).toEqual({
      start: 1,
      end: 2,
    })
  })

  it('端点是 del 行（其镜像 add 已被配对）→ 按 left.lineNo 定位到 modify', () => {
    // original[2] = del(3)，镜像 add(3) 已配对为 paired[2] 的 modify。
    expect(translateAnchorToPaired({ start: 2, end: 2 }, original, paired)).toEqual({
      start: 2,
      end: 2,
    })
  })

  it('equal 行两端（hunk 含上下文行）→ 原位 1:1 保留，端点平移一致', () => {
    expect(translateAnchorToPaired({ start: 0, end: 5 }, original, paired)).toEqual({
      start: 0,
      end: 3,
    })
    expect(translateAnchorToPaired({ start: 5, end: 5 }, original, paired)).toEqual({
      start: 3,
      end: 3,
    })
  })

  it('单对折叠（1 del + 1 add → 1 modify）→ start === end 的合法退化区间', () => {
    const singleOriginal = [del(1, 'x'), add(1, 'y')]
    const singlePaired = [modify(1, 1, 'x', 'y')]
    expect(
      translateAnchorToPaired({ start: 0, end: 1 }, singleOriginal, singlePaired),
    ).toEqual({ start: 0, end: 0 })
  })

  it('多处替换区配对：锚点在任一区段内都能正确定位', () => {
    const multiOriginal = [
      del(1, 'a1'),
      add(1, 'a2'),
      equal(2, 2, 'mid'),
      del(3, 'b1'),
      add(3, 'b2'),
    ]
    const multiPaired = [
      modify(1, 1, 'a1', 'a2'),
      equal(2, 2, 'mid'),
      modify(3, 3, 'b1', 'b2'),
    ]
    expect(translateAnchorToPaired({ start: 0, end: 1 }, multiOriginal, multiPaired)).toEqual({
      start: 0,
      end: 0,
    })
    expect(translateAnchorToPaired({ start: 3, end: 4 }, multiOriginal, multiPaired)).toEqual({
      start: 2,
      end: 2,
    })
  })
})

/* -------------------------------------------------------------------------- */
/* 防御：非法锚点与定位失败                                                     */
/* -------------------------------------------------------------------------- */

describe('translateAnchorToPaired：防御', () => {
  const original = [equal(1, 1, 'a'), del(2, 'b'), add(2, 'c'), equal(3, 3, 'd')]
  const paired = [equal(1, 1, 'a'), modify(2, 2, 'b', 'c'), equal(3, 3, 'd')]

  it('start < 0 → { start: -1, end: -1 }', () => {
    expect(translateAnchorToPaired({ start: -1, end: 2 }, original, paired)).toEqual(NOT_FOUND)
  })

  it('end < start → { start: -1, end: -1 }', () => {
    expect(translateAnchorToPaired({ start: 2, end: 1 }, original, paired)).toEqual(NOT_FOUND)
  })

  it('end 越过原始序列 → { start: -1, end: -1 }', () => {
    expect(translateAnchorToPaired({ start: 0, end: 4 }, original, paired)).toEqual(NOT_FOUND)
  })

  it('非整数下标 → { start: -1, end: -1 }', () => {
    expect(translateAnchorToPaired({ start: 0.5, end: 2 }, original, paired)).toEqual(NOT_FOUND)
  })

  it('lineNo 在配对序列中定位失败（行被配对序列缺失）→ { start: -1, end: -1 }', () => {
    // paired 缺失原 del(2) / modify 行：del 的 left.lineNo=2 无处可定位。
    const brokenPaired = [equal(1, 1, 'a'), add(2, 'c'), equal(3, 3, 'd')]
    expect(translateAnchorToPaired({ start: 1, end: 2 }, original, brokenPaired)).toEqual(
      NOT_FOUND,
    )
  })

  it('空序列防御：originalRows 为空时任何锚点都返回 { start: -1, end: -1 }', () => {
    expect(translateAnchorToPaired({ start: 0, end: 0 }, [], [])).toEqual(NOT_FOUND)
  })
})

/* -------------------------------------------------------------------------- */
/* 纯函数约定：不改入参                                                         */
/* -------------------------------------------------------------------------- */

describe('translateAnchorToPaired：不可变', () => {
  it('翻译不修改入参数组与行对象', () => {
    const original = [equal(1, 1, 'a'), del(2, 'b'), add(2, 'c')]
    const paired = [equal(1, 1, 'a'), modify(2, 2, 'b', 'c')]
    const originalSnapshot = JSON.stringify(original)
    const pairedSnapshot = JSON.stringify(paired)
    translateAnchorToPaired({ start: 1, end: 2 }, original, paired)
    expect(JSON.stringify(original)).toBe(originalSnapshot)
    expect(JSON.stringify(paired)).toBe(pairedSnapshot)
  })
})
