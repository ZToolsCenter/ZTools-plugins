/*
 * 搜索命中：切分（`splitHighlight`）与前移（`rowText`）。
 *
 * 这个功能有两条**错了不会报错、只会看着别扭**的红线，各锁一组：
 *   ① 切出来的片段必须**拼回原文一字不差**，而且用的是**原文那一段的大小写**
 *      （`toLowerCase` 只用来找位置，绝不能把小写那份拿去显示）；
 *   ② 命中在看不见的地方时，**必须**把它挪进前面那 24 个字里 ——
 *      否则"这行匹配了却一个高亮都没有"，功能等于一半没做。
 *
 * ⚠️ 关键词是用户随手打的，可能含 `.*`、`(`、`[`。这些串拼进 `RegExp` 会抛异常或
 *    静默匹配到别处，所以实现全程 `indexOf`；下面专门有一条拿元字符当关键词。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { PREVIEW_SCAN, type ClipContent } from '../src/lib/clipboard.ts'
import { rowText, splitHighlight, type Seg } from '../src/lib/highlight.ts'

function clip(part: Partial<ClipContent> & { type: ClipContent['type'] }): ClipContent {
  return part as ClipContent
}

/** 片段拼回原文 —— 每条断言都顺手验一次"没丢字、没串位" */
function join(segs: Seg[]): string {
  return segs.map((s) => s.t).join('')
}

/** 被标底色的那些片段 */
function hits(segs: Seg[]): string[] {
  return segs.filter((s) => s.hit).map((s) => s.t)
}

/* ---------------------------------------------------------------- 切分 */

test('没命中 / 没关键词：原样一段，不切成空数组', () => {
  assert.deepEqual(splitHighlight('开会纪要', '报告'), [{ t: '开会纪要', hit: false }])
  assert.deepEqual(splitHighlight('开会纪要', ''), [{ t: '开会纪要', hit: false }])
  assert.deepEqual(splitHighlight('开会纪要', '   '), [{ t: '开会纪要', hit: false }])
  assert.deepEqual(splitHighlight('', '报告'), [])
})

test('命中切成三段：前面 / 命中 / 后面', () => {
  const segs = splitHighlight('本周报告已发', '报告')
  assert.deepEqual(segs, [
    { t: '本周', hit: false },
    { t: '报告', hit: true },
    { t: '已发', hit: false }
  ])
  assert.equal(join(segs), '本周报告已发')
})

test('★ 一行里出现多次就全部标出来，不止第一个', () => {
  const segs = splitHighlight('报告A报告B报告', '报告')
  assert.deepEqual(hits(segs), ['报告', '报告', '报告'])
  assert.equal(join(segs), '报告A报告B报告')
})

test('★ 大小写不敏感，但显示的是原文那一段（不能吐小写化那份）', () => {
  const segs = splitHighlight('Meeting Notes 2026', 'meeting')
  assert.deepEqual(segs[0], { t: 'Meeting', hit: true })
  assert.equal(join(segs), 'Meeting Notes 2026')

  // 关键词大写、原文小写，也要标到，且标的还是原文
  const up = splitHighlight('visual studio code', 'VSC')
  assert.deepEqual(hits(up), [])
  assert.deepEqual(splitHighlight('visual studio code', 'VISUAL')[0], {
    t: 'visual',
    hit: true
  })
})

test('★ 关键词含正则元字符也不能炸、不能匹配到别处（全程 indexOf，不建 RegExp）', () => {
  for (const kw of ['.*', '(', '[', '+', 'a|b', '\\', '$^', '??']) {
    const segs = splitHighlight(`前缀 ${kw} 后缀`, kw)
    assert.deepEqual(hits(segs), [kw], `关键词 ${kw} 没被当成字面量`)
    assert.equal(join(segs), `前缀 ${kw} 后缀`)
  }
  // 元字符是字面量：`.*` 不该匹配到 'abc'
  assert.deepEqual(splitHighlight('abc', '.*'), [{ t: 'abc', hit: false }])
})

test('命中贴着两端时不多出空片段', () => {
  assert.deepEqual(splitHighlight('报告全文', '报告'), [
    { t: '报告', hit: true },
    { t: '全文', hit: false }
  ])
  assert.deepEqual(splitHighlight('全文报告', '报告'), [
    { t: '全文', hit: false },
    { t: '报告', hit: true }
  ])
})

/* ---------------------------------------------------------------- 前移 */

const long = (head: string, tail: string, pad = 60): string => head + 'x'.repeat(pad) + tail

test('没有关键词：走 previewText 老路，一个字都不变', () => {
  const item = clip({ type: 'text', content: '  a\n\nb   c  ' })
  assert.equal(rowText(item, ''), 'a b c')
  assert.equal(rowText(item, '   '), 'a b c')
})

test('★ 命中本来就看得到 ⇒ 不做任何前移（避免"一搜索整列内容就跳"）', () => {
  const item = clip({ type: 'text', content: '报告已发，请查收' })
  assert.equal(rowText(item, '报告'), '报告已发，请查收')
})

test('★ 命中在开头那段里但位置靠后 ⇒ 前移到前面来（正文到此为止，尾巴不补省略号）', () => {
  const item = clip({ type: 'text', content: long('开头这些字都看得见，', '报告在后面') })
  const out = rowText(item, '报告')

  assert.ok(out.startsWith('…'), '前面被截掉了却没有省略号')
  // 正文到这儿就没了 ⇒ 尾巴不能再补省略号，补了就是在说"下面还有"
  assert.ok(!out.endsWith('…'), '正文已经到底了，尾巴却还挂着省略号')
  assert.ok(out.endsWith('报告在后面'), '命中后面的上下文被切没了')

  const at = out.toLowerCase().indexOf('报告')
  assert.ok(at >= 0 && at <= 24, `命中还停在 ${at} —— 没挪进可见范围`)
})

test('★ 命中靠后、而正文比开头那段还长 ⇒ 两端都补省略号', () => {
  // 命中还在前 400 字里，但正文长过 400 ⇒ 窗口取满就收尾，尾巴其实还有一半
  const content = long('开头这些字都看得见，', '报告在后面') + 'y'.repeat(PREVIEW_SCAN)
  assert.ok(content.length > PREVIEW_SCAN, '构造错了：这条测的是"正文比窗口长"')

  const out = rowText(clip({ type: 'text', content }), '报告')
  assert.ok(out.startsWith('…'), '前面被截掉了却没有省略号')
  assert.ok(out.endsWith('…'), '正文后面还有大半，尾巴却没有省略号')

  const at = out.toLowerCase().indexOf('报告')
  assert.ok(at >= 0 && at <= 24, `命中还停在 ${at} —— 没挪进可见范围`)
})

test('★ 命中在 400 字之后（回到全文取片段）也要挪进可见范围', () => {
  const content = 'x'.repeat(PREVIEW_SCAN + 200) + '接口文档在这里'
  const item = clip({ type: 'text', content })

  // 先确认这确实超出了那个窗口 —— 否则这条测的就不是"深命中"这条路
  assert.equal(rowText(item, 'zzz'), content.slice(0, PREVIEW_SCAN).replace(/\s+/g, ' ').trim())

  const out = rowText(item, '接口文档')
  const at = out.toLowerCase().indexOf('接口文档')
  assert.ok(at >= 0, '深命中没被找出来 —— 高亮会整行消失')
  assert.ok(at <= 24, `深命中还停在 ${at} —— 没挪进可见范围`)
  assert.ok(out.length <= PREVIEW_SCAN + 2, '片段比窗口还长')
})

test('深命中：切完再折叠空白，下标不能先被折叠改掉', () => {
  const content = 'a\n\n\nb'.repeat(150) + ' 报告 '
  const out = rowText(clip({ type: 'text', content }), '报告')
  assert.ok(out.toLowerCase().includes('报告'), '折叠改了下标 ⇒ 命中丢了')
  assert.ok(!/\n/.test(out), '片段里还留着换行（行是单行显示）')
})

test('图片 / 文件不参与前移（它们的 preview 短得不可能超出可见范围）', () => {
  const img = clip({ type: 'image', preview: '[图片] 123KB', imagePath: '/a/b.png' })
  assert.equal(rowText(img, '图片'), '[图片] 123KB')

  const f = clip({ type: 'file', files: [{ name: 'report.pdf', path: '/x/report.pdf' }] })
  assert.equal(rowText(f, 'report'), 'report.pdf')
})

test('文本：解析不出命中时兜回开头那段，不返回空串', () => {
  // content 是空串（能进列表是因为 matchClip 认了 preview）
  const item = clip({ type: 'text', content: '', preview: '报告' })
  assert.equal(rowText(item, '报告'), '')
  // 有一点点正文但确实没有关键词
  assert.equal(rowText(clip({ type: 'text', content: 'abc' }), '报告'), 'abc')
})

/* ---------------------------------------------------------------- 与 matchClip 的耦合 */

/*
 * 高亮和"留不留这行"必须用同一条判定，否则会出现
 * 「匹配上了却没有高亮」或者「高亮了却按规则不该匹配」。
 * 这里用一批样例把两条路钉在一起（实现里两边都是 `toLowerCase + indexOf`）。
 */
test('★ 能进列表的行，就一定能切出高亮（跟 matchClip 同一条判定）', () => {
  const cases: [ClipContent, string][] = [
    [clip({ type: 'text', content: '本周报告已发' }), '报告'],
    [clip({ type: 'text', content: 'Meeting Notes' }), 'MEETING'],
    [clip({ type: 'text', content: long('开头', '报告在后面') }), '报告'],
    [clip({ type: 'text', content: 'x'.repeat(900) + '报告' }), '报告'],
    [clip({ type: 'image', preview: '[图片] 123KB' }), 'kb'],
    [clip({ type: 'file', files: [{ name: '报告.pdf', path: '/x/报告.pdf' }] }), '报告']
  ]
  for (const [item, kw] of cases) {
    const segs = splitHighlight(rowText(item, kw), kw)
    assert.ok(
      hits(segs).length > 0,
      `「${kw}」能进列表，却在行里一个字都没标出来 —— 两条判定分叉了`
    )
  }
})
