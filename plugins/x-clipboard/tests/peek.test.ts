/*
 * 详情浮层的「弹不弹」判定。
 *
 * 跑法（同样不需要装任何东西）：
 *   node --experimental-strip-types --test tests/peek.test.ts
 *
 * 这套判定是浮层唯一的守门人：判松了，一行能看全的短文本也弹，挡住后面的行；
 * 判紧了，图片和长文本又看不到全文。所以四种组合都要钉住。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { PEEK_GAP, PEEK_SOFT_MAX, peekGeom, peekKindOf } from '../src/lib/peek.ts'

test('图片永远弹 —— 列表里的缩略图只有 32×24，本来就看不出来是什么', () => {
  assert.equal(peekKindOf({ type: 'image' }, false), 'image')
  assert.equal(peekKindOf({ type: 'image' }, true), 'image')
})

test('文本只在这行真被截断时才弹', () => {
  assert.equal(peekKindOf({ type: 'text' }, false), null)
  assert.equal(peekKindOf({ type: 'text' }, true), 'text')
})

test('文件：多文件必弹，单个文件只在名字显示不全时才弹', () => {
  const many = { type: 'file' as const, files: [{ name: 'a.pdf' }, { name: 'b.pdf' }] }
  assert.equal(peekKindOf(many, false), 'file')

  const one = { type: 'file' as const, files: [{ name: 'a.pdf' }] }
  assert.equal(peekKindOf(one, false), null)
  assert.equal(peekKindOf(one, true), 'file')
})

test('没有 files 的文件记录不弹 —— 弹出来是个空壳', () => {
  assert.equal(peekKindOf({ type: 'file', files: [] }, true), null)
  assert.equal(peekKindOf({ type: 'file' }, true), null)
})

/*
 * 落位与宽度。
 *
 * 数就按真实窗口来：窗口 800 宽，`.root` 铺满，
 * `.list` 的 padding 是 8，里面还蹲着一条 7px 的自绘滚动条 ——
 * 所以**行宽 = 800 - 8*2 - 7 = 777**，而行左边 = 8。
 *
 * 顶上的 bug 就是当初拿 `.list` 的宽度当尺子（800 - 16 = 784），
 * 比行宽多出 7px，浮层右边一直顶到滚动条上。
 */
const ROOT = { top: 0, bottom: 600, left: 0, width: 800 }
const LIST = { top: 0, bottom: 600, left: 0, width: 800 }
/** 选中行：第 3 行，往下还有大把空间 */
const ROW = { top: 76, bottom: 112, left: 8, width: 777 }

test('★ 宽度和左边距都以「行」为准 —— 用 .list 的会把滚动条算进去，右边多出 7px', () => {
  const g = peekGeom(ROW, LIST, ROOT)
  assert.ok(g)
  assert.equal(g.width, ROW.width, '宽度必须是行宽，不是 list.width - 16')
  assert.equal(g.left, ROW.left, '左边距必须跟行左对齐')
  // 左右必须各自贴齐行的两边 —— 老大报的就是"右边填满、左边还留缝"
  assert.equal(g.left + g.width, ROW.left + ROW.width, '右边没跟行对齐')
})

test('下方够就往下弹，offset / 高度都算对', () => {
  const g = peekGeom(ROW, LIST, ROOT)
  assert.ok(g)
  assert.equal(g.dir, 'down')
  assert.equal(g.offset, ROW.bottom - ROOT.top + PEEK_GAP)
  assert.equal(g.maxH, Math.min(PEEK_SOFT_MAX, LIST.bottom - ROW.bottom - PEEK_GAP))
})

test('下方不够、上方更宽敞就翻到上面，offset 用 bottom 定位', () => {
  // 行在列表最底部：下面只剩 4px
  const bottomRow = { top: 556, bottom: 592, left: 8, width: 777 }
  const g = peekGeom(bottomRow, LIST, ROOT)
  assert.ok(g)
  assert.equal(g.dir, 'up')
  assert.equal(g.offset, ROOT.bottom - bottomRow.top + PEEK_GAP)
})

test('上下都塞不下就不弹（返回 null），不会挤出一个半截的浮层', () => {
  // 列表只有 100px 高，行占中间，上下都不到 PEEK_MIN
  const tinyList = { top: 0, bottom: 100, left: 0, width: 800 }
  const midRow = { top: 46, bottom: 82, left: 8, width: 777 }
  assert.equal(peekGeom(midRow, tinyList, ROOT), null)
})

test('内容再长，限高也压在 PEEK_SOFT_MAX 以内（超出在浮层里滚）', () => {
  const hugeList = { top: 0, bottom: 5000, left: 0, width: 800 }
  const g = peekGeom(ROW, hugeList, ROOT)
  assert.ok(g)
  assert.equal(g.maxH, PEEK_SOFT_MAX)
  assert.ok(g.maxH > 0)
})
