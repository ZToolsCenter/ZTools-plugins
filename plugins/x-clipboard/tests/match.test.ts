/*
 * 关键词过滤：`matchClip`。
 *
 * 为什么值得单测：这条规则现在是**我们自己在用**（宿主搜索已经不再走它），
 * 所以一旦它跟预期对不上，**不会有任何报错** —— 只会"搜不出来"。
 * 锁的就是**三条分支以及它们的顺序**（与宿主搜索的行为一致）：
 *   `content` → `files[].name` → `preview`，全部小写包含，命中即留。
 * ⚠️ 顺序也是行为的一部分：调换分支不会漏结果，但会让"这条为什么排在前面"变得难解释。
 *
 * 跑法：node --experimental-strip-types --test tests/match.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { PAGE_SIZE, matchClip, type ClipContent } from '../src/lib/clipboard.ts'

function clip(part: Partial<ClipContent> & { type: ClipContent['type'] }): ClipContent {
  return part as ClipContent
}

test('空关键词全吃 —— 等价于不过滤', () => {
  const t = clip({ type: 'text', content: '报告' })
  assert.equal(matchClip(t, ''), true)
  assert.equal(matchClip(t, '   '), true)
})

test('文本：按正文匹配，大小写不敏感，关键词两端空格被吃掉', () => {
  const t = clip({ type: 'text', content: 'Meeting Notes 2026' })
  assert.equal(matchClip(t, 'meeting'), true)
  assert.equal(matchClip(t, 'MEETING'), true)
  assert.equal(matchClip(t, '  meeting  '), true)
  assert.equal(matchClip(t, 'meetings'), false)
})

test('文本：正文里没有就是不吃 —— 文本的 preview 本身就是正文前缀，兜不出新东西', () => {
  assert.equal(matchClip(clip({ type: 'text', content: 'abc', preview: 'abc' }), 'xyz'), false)
})

test('图片：没有 content，靠 preview 兜（宿主给的是「[图片] 123KB」）', () => {
  const img = clip({ type: 'image', preview: '[图片] 123KB', imagePath: '/a/b/1789-abc.png' })
  assert.equal(matchClip(img, '图片'), true)
  assert.equal(matchClip(img, 'kb'), true)
  // imagePath 是 `<时间戳>-<随机串>.png` 纯噪声，不该被搜到
  assert.equal(matchClip(img, '1789'), false)
})

test('文件：按文件名匹配，多文件任一命中即可', () => {
  const f = clip({
    type: 'file',
    files: [
      { name: 'report.pdf', path: '/Users/x/Documents/report.pdf' },
      { name: '图.png', path: '/Users/x/Desktop/图.png' }
    ]
  })
  assert.equal(matchClip(f, 'report'), true)
  assert.equal(matchClip(f, 'REPORT'), true)
  assert.equal(matchClip(f, '图'), true)
  assert.equal(matchClip(f, 'desktop'), false)
})

test('★ 文件：只认文件名，不认路径 —— 跟宿主一致，别顺手"改好"', () => {
  const f = clip({ type: 'file', files: [{ name: 'a.pdf', path: '/Users/x/secret/a.pdf' }] })
  assert.equal(matchClip(f, 'secret'), false)
})

test('文件：没有 files 字段时落到 preview', () => {
  const f = clip({ type: 'file', preview: '3 个文件' })
  assert.equal(matchClip(f, '个文件'), true)
  assert.equal(matchClip(f, 'nope'), false)
})

test('★ 文件：files 是空数组 → 直接判否（宿主在这一步就 return 了，不会再看 preview）', () => {
  assert.equal(matchClip(clip({ type: 'file', files: [] }), 'x'), false)
  assert.equal(matchClip(clip({ type: 'file', files: [], preview: 'x1' }), 'x'), false)
})

test('★ PAGE_SIZE 必须等于宿主的 maxItems（1000）', () => {
  /*
   * 前端过滤的前提是「手里这份就是整库」：宿主 `DEFAULT_CONFIG.maxItems = 1e3`，
   * 我们一次就要 1000，所以两个集合相等。
   * 把 `PAGE_SIZE` 改小会让关键词过滤**静默地少结果**（不报错，就是搜不出来）——
   * 所以在这里钉死；真要脱钩，得先解决前端过滤的这个前提。
   */
  assert.equal(
    PAGE_SIZE,
    1000,
    'PAGE_SIZE 跟宿主 maxItems 是绑在一起的，改之前先读 matchClip 上面的注释'
  )
})
