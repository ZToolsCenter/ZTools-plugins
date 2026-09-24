/*
 * 当前行的落位规则。
 * 这几条都是真机上踩出来的 —— 尤其「切回全部」那条。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { resolveSelection, type Selection } from '../src/lib/selection.ts'

const sel = (active: string): Selection => ({ active })

const KEYS = ['a', 'b', 'c', 'd']

test('范围变了 → 无条件落回第一条，哪怕旧选中项还活着', () => {
  // 就是「文件 → 全部」：旧那条 d 在全部里当然还在，但必须落到 a
  const next = resolveSelection(KEYS, sel('d'), true)
  assert.deepEqual(next, { active: 'a' })
})

test('只是刷新 → 选中项还活着就原地不动（别人复制东西不该把光标踢走）', () => {
  const next = resolveSelection(KEYS, sel('c'), false)
  assert.equal(next.active, 'c')
})

test('刷新后选中项没了 → 落回第一条', () => {
  const next = resolveSelection(['b', 'c'], sel('a'), false)
  assert.deepEqual(next, { active: 'b' })
})

test('空列表 → 落成空串，不留一个指向空气的键', () => {
  assert.deepEqual(resolveSelection([], sel('a'), false), { active: '' })
})

test('空列表 + 范围变了 → 同样是空', () => {
  assert.deepEqual(resolveSelection([], sel('a'), true), { active: '' })
})

test('单条列表 → 就选那一条', () => {
  assert.deepEqual(resolveSelection(['only'], sel('x'), true), { active: 'only' })
})

test('范围变了 + 旧键恰好还在 + 列表非空 → 仍然落第一条', () => {
  // 「文本 → 全部」且旧项是全部里的第一条时，两条规则给的结果一样，
  // 容易以为是"原地不动"过了，其实走的是 forceTop 那条路
  assert.deepEqual(resolveSelection(['d', 'a'], sel('d'), true), { active: 'd' })
  assert.deepEqual(resolveSelection(['a', 'd'], sel('d'), true), { active: 'a' })
})

/*
 * ★ 接线：搜索框那条路必须经过「搜索框一改 ⇒ 落回第一条」这一处。
 *
 * 纯函数再对，接线漏一条也是白搭。老大报的 bug 就是这个形状 ——
 * 插件代按退格走了 `commitTypedQuery`，而**用户自己在宿主搜索框里退格**
 * （真正的主路径，焦点就在那个框上）还挂着老的裸 `syncSelection()`：
 * 搜索词一改、列表整张重筛，选中却赖在旧列表里那条（可能已经不在新列表里），按 ↑↓ 就从那儿走。
 *
 * 所以锁两件事：落位规矩只有 `commitTypedQuery` 一处，
 * 且 `setSubInput` 回调确实接了它 —— 别再有人在回调里直接写 `syncSelection()`。
 */
test('★ setSubInput 回调走 commitTypedQuery，不再自己裸调 syncSelection', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')

  const start = sfc.indexOf('async function attachSubInput(')
  assert.ok(start > -1, 'App.vue 里找不到 attachSubInput —— 测试要跟着改名走')
  const nextFn = sfc.indexOf('\nfunction ', start)
  const attach = sfc.slice(start, nextFn > start ? nextFn : start + 2500)

  const cbStart = attach.indexOf('setSubInput(')
  const cbEnd = attach.indexOf('SUB_INPUT_PLACEHOLDER')
  assert.ok(cbStart > -1 && cbEnd > cbStart, '看不出 setSubInput 的头上那段')
  const cb = attach.slice(cbStart, cbEnd)

  assert.match(
    cb,
    /commitTypedQuery\(/,
    'setSubInput 回调没接 commitTypedQuery —— 原生退格退光后又不会回第一条了'
  )
  assert.doesNotMatch(
    cb.replace(/\/\*[\s\S]*?\*\//g, ''),
    /^\s*syncSelection\(\)/m,
    'setSubInput 回调里又出现裸 syncSelection() —— 落位规矩必须只留 commitTypedQuery 一处'
  )
})

test('★ commitTypedQuery：**无条件**落回第一条 + 显式把列表拉回顶上', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')
  const fn = sfc.slice(sfc.indexOf('function commitTypedQuery('))
  const body = fn.slice(0, fn.indexOf('\n}\n'))

  // ⚠️ 这一条是**无条件**的：打字 / 退一格 / 退到一半 / 退光，全都算。
  // 09-17 第一轮只在"退成空"时 pin（当时用 isScopeReset 判），真机上老大立刻又报了一条
  // 「删到一半时列表已经重筛了，为什么 ↑↓ 不从第一行开始」—— 半条规则作废，判据也删了。
  assert.doesNotMatch(body, /isScopeReset/, 'isScopeReset 那半条规则又回来了？')
  assert.doesNotMatch(
    body.replace(/if \(keyword\.value === next\) return/, ''),
    /\bif\s*\(/,
    'commitTypedQuery 里出现了别的条件判断 —— 搜索框内容一变就该落回第一条，不分类'
  )
  assert.match(body, /pinToTop = true/, '没置 pinToTop，选中项不会落回第一条')
  assert.match(
    body,
    /nextTick\(scrollActiveIntoView\)/,
    '缺了显式滚动 —— 选中项恰好就是第一条时 activeKey 不变、watch 不触发，列表会停在老位置'
  )
  // 值没变的闸：宿主 setSubInputValue 会把我们写进去的值异步回声一次，
  // 没这道闸会跑两遍；迟到的第二遍可能把用户刚按 ↑↓ 挪走的选中又拽回第一条
  assert.match(
    body,
    /if \(keyword\.value === next\) return/,
    'commitTypedQuery 少了「值没变就返回」的闸 —— 宿主回声会重复落位'
  )
  // 顺序：先 pinToTop 再 syncSelection，反过来那次 pin 就白设了
  assert.ok(
    body.indexOf('pinToTop = true') < body.lastIndexOf('syncSelection()'),
    'pinToTop 必须落在 syncSelection() 之前'
  )
})

/*
 * ★ 「列表自己变了」那条路**不能**回顶 —— 别把上一条的规矩错误地推到它身上。
 *
 * 两者形状很像（都是列表换了），但用户在看的东西完全不是一回事：
 *   · 搜索框被改了 ⇒ 是**用户换了要搜的东西**，列表整张重筛 ⇒ 新列表从头看起（回顶）；
 *   · 别人复制了新东西（reload / refreshFavorites）⇒ **用户看的还是那一行**，只是被刷新了
 *     ⇒ 选中项还活着就原地不动（`pinToTop = false`），否则复制一下东西光标就被踢走。
 */
test('★ 刷新（reload / 收藏刷新）不走 commitTypedQuery，也不置 pinToTop', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')

  for (const name of ['async function reload(', 'async function refreshFavorites(']) {
    const start = sfc.indexOf(name)
    assert.ok(start > -1, `找不到 ${name}`)
    const end = sfc.indexOf('\n}\n', start)
    const body = sfc.slice(start, end > start ? end : start + 600)
    assert.match(body, /syncSelection\(\)/, `${name} 刷新后没有修一次选中项`)
    assert.doesNotMatch(
      body,
      /pinToTop\s*=\s*true|commitTypedQuery/,
      `${name} 不该回顶 —— 那是"列表被刷新"，不是"用户换了搜的东西"`
    )
  }
})
