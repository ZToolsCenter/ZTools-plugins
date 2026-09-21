/*
 * 键位映射。
 *
 * 重点盯两件事，都是真出过问题的：
 *   1. **⌘K = 收藏当前项**。09-15 一度把这条删了（理由写的是"收藏已经能从 Tab
 *      那一站到达"），但那是「切到收藏视图」，跟「把当前项加进收藏」是两回事 ——
 *      删掉之后收藏只剩鼠标点行尾 ☆ 一条路。老大当天让加回来，这里锁住。
 *   2. **不带修饰键的 k 什么都不是**。搜索框里打字随时会敲到 k，
 *      要是没这道判断，打两个字就把当前行收藏了。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { pasteSlot, resolveKey } from '../src/lib/keys.ts'

/** 造一个够用的键盘事件 —— resolveKey 只读这四个字段 */
function ev(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { metaKey: false, ctrlKey: false, shiftKey: false, key: '', ...init } as KeyboardEvent
}

test('⌘K / Ctrl+K 都是收藏当前项（两个修饰键都收，不做平台分支）', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: 'k' })), 'favorite')
  assert.equal(resolveKey(ev({ ctrlKey: true, key: 'k' })), 'favorite')
})

test('大写 K 也认（withMod 走 toLowerCase）', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: 'K' })), 'favorite')
})

test('不带修饰键的 k → null。不然打字就在收藏', () => {
  assert.equal(resolveKey(ev({ key: 'k' })), null)
})

test('⌘D 仍然映射到收藏 —— 宿主现在拦着它，但代码里这条路不能断', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: 'd' })), 'favorite')
})

test('Tab / ⇧Tab 切分类', () => {
  assert.equal(resolveKey(ev({ key: 'Tab' })), 'cycleType')
  assert.equal(resolveKey(ev({ key: 'Tab', shiftKey: true })), 'cycleTypeBack')
})

/*
 * ★ Backspace 不再等于删除（09-17 改）。
 *
 * 锁的是一次真实的数据丢失：删除能在设置里关掉确认框之后，按下去就是真删
 * （宿主硬删、图像连磁盘文件一起 unlink、没有撤销），
 * 而「想删搜索词里的一个字」是高频动作 —— 两者共用一个键迟早出事。
 * 现在：裸 Backspace = 退搜索框；删数据只剩 `Delete` 和 `⌘⌫`。
 */
test('★ 裸 Backspace 是退格，不是删除', () => {
  assert.equal(resolveKey(ev({ key: 'Backspace' })), 'backspaceSearch')
  assert.notEqual(resolveKey(ev({ key: 'Backspace' })), 'remove', 'Backspace 绝不能回到删除')
})

test('删除只剩 Delete 和 ⌘⌫ / Ctrl+⌫（macOS 惯例）', () => {
  assert.equal(resolveKey(ev({ key: 'Delete' })), 'remove')
  assert.equal(resolveKey(ev({ metaKey: true, key: 'Backspace' })), 'remove')
  assert.equal(resolveKey(ev({ ctrlKey: true, key: 'Backspace' })), 'remove')
})

/*
 * 光有映射还不够：onKeydown 里没接上，这个键就是**静默无反应**（连退格都不退了）。
 * `resolveKey` 是纯函数能单测，接线长在 App.vue 里，只能做源码断言 ——
 * 跟下面确认框那条一个路子。
 */
test('onKeydown 真的把 backspaceSearch 接到了处理函数上', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')
  const kd = sfc.slice(sfc.indexOf('function onKeydown('))
  assert.match(
    kd,
    /case 'backspaceSearch':[\s\S]{0,120}?backspaceSearch\(\)/,
    "onKeydown 里没有接 backspaceSearch —— 那样退格键会变成哑键"
  )
})

/*
 * ⌘/ 开设置。**这条锁的不是一个便利键，是「全隐」那一档的唯一出路** ——
 * 底栏设成「全隐」之后鼠标没有任何入口，这条映射要是没了，
 * 选了那档的人连改回其他档都做不到。所以它必须一直在这儿。
 */
test('⌘/ / Ctrl+/ 开设置', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: '/' })), 'openSettings')
  assert.equal(resolveKey(ev({ ctrlKey: true, key: '/' })), 'openSettings')
})

test('不带修饰键的 / 仍然是「回到搜索框」，不是开设置', () => {
  assert.equal(resolveKey(ev({ key: '/' })), 'focusSearch')
})

/*
 * 底栏提示条里必须真的写着「⌘/ 设置」。
 *
 * 跟上面那条映射同一个理由，但锁的是**可发现性**：`⌘/` 原先在整个界面上
 * 一处都没写 —— 唯一提到它的地方是设置面板里「底栏 = 全隐」那句解释，
 * 而那要先进设置才看得到，等于藏起来的入口。09-16 老大指出后补进提示条，
 * 这条锁住它别哪天被当成"重复信息"删掉。
 *
 * 演示写法：`<kbd>{{ modKey('/') }}</kbd>设置`（修饰键按平台渲染成 ⌘ / Ctrl）。
 */
test('底栏键位提示里有 ⌘/ 设置这一项', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')
  // .hints 里没有嵌套 div，所以这里用非贪婪是准的（跟 styles.test.ts 抽 <template> 的贪婪规则不同）
  const hints = sfc.match(/<div class="hints">[\s\S]*?<\/div>/)
  assert.ok(hints, 'App.vue 里找不到底栏的 .hints 块')
  assert.match(hints[0], /\{\{\s*modKey\('\/'\)\s*\}\}<\/kbd>设置/, '提示条里没写 ⌘/ 设置')
})

/*
 * 底栏提示条里必须真的写着「⌘1–⌘9 秒贴」。
 *
 * 跟上面那条同一个理由（可发现性），但这一族键更隐蔽 —— **界面上连线索都没有**：
 * 行尾那列「序号」默认是关的，所以连"行尾会显示号码"这件事默认也看不见。
 * 09-17 老大第三次因为「实现了却没提示」提出来，原话「怎么老是忘记这个」。
 * 这条锁住它别哪天被当成"提示太挤"删掉。
 *
 * 演示写法：`<kbd>{{ modKey('1') }}–{{ modKey('9') }}</kbd>秒贴`（修饰键按平台渲染成 ⌘ / Ctrl）。
 */
test('底栏键位提示里有 ⌘1–⌘9 秒贴这一项', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')
  const hints = sfc.match(/<div class="hints">[\s\S]*?<\/div>/)
  assert.ok(hints, 'App.vue 里找不到底栏的 .hints 块')
  assert.match(
    hints[0],
    /\{\{\s*modKey\('1'\)\s*\}\}–\{\{\s*modKey\('9'\)\s*\}\}<\/kbd>秒贴/,
    '提示条里没写 ⌘1–⌘9 秒贴'
  )
})

/*
 * ★ 确认框开着时，Enter 必须是「确定」，**不能穿透成「复制当前项」**。
 *
 * 老大 09-17 真机报的：弹框问「删除这条记录？」时按 Enter ——
 * 结果复制了当前项、**插件窗口也一起关了**，而删除根本没执行。
 * 根因是 `onKeydown` 里没有「弹框优先」这一层，Enter 一路走到 `case 'enter'` → `pasteActive()`。
 *
 * 这段逻辑长在 App.vue 的键盘处理器里、不在可单测的纯函数里，所以只能做源码断言。
 * 锁三件事：守卫在、排在 `resolveKey` 之后（它要用 action）、排在 `case 'enter'` 之前。
 */
test('★ 确认框开着时 Enter = 确定（别让它穿透去 pasteActive）', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')
  const kd = sfc.slice(sfc.indexOf('function onKeydown('))
  const guard = kd.indexOf('if (confirmBox.value)')

  assert.ok(guard > 0, 'onKeydown 里找不到「确认框优先」的守卫')
  assert.ok(
    kd.indexOf('const action = resolveKey(e)') < guard,
    '守卫要排在 resolveKey 之后 —— 它得拿 action 判断，不是自己认 e.key'
  )
  assert.ok(
    guard < kd.indexOf("case 'enter':"),
    "守卫必须拦在 case 'enter' 前面，否则 Enter 照样会去粘贴并关窗"
  )

  const body = kd.slice(guard, kd.indexOf('if (!action)'))
  assert.match(body, /action === 'enter'/, '守卫里没把 Enter 接给「确定」')
  assert.match(body, /runConfirm\(\)/, '守卫里没调 runConfirm')
})

/*
 * ⌘1–⌘9 秒贴。
 *
 * 这条键位有个必须记住的前提：**数字键不在宿主那六个键的白名单里**，
 * 所以它跟 ⌘K 一样，得先按一次 ↑↓ 把焦点搬进插件才收得到。
 * 这里锁的是「映射本身对不对」，收不收得到是宿主的事（见 REFERENCE §26.1-D）。
 */
test('⌘1–⌘9 / Ctrl+1–Ctrl+9 映射到 paste1–paste9（两个修饰键都收）', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: '1' })), 'paste1')
  assert.equal(resolveKey(ev({ ctrlKey: true, key: '5' })), 'paste5')
  assert.equal(resolveKey(ev({ metaKey: true, key: '9' })), 'paste9')
})

/*
 * ⚠️ ⌘0 不做第 10 条。
 * 行尾只给前 9 行显示序号；如果这里认了 0，界面上就会出现一个
 * 「没有标注、但按下去有反应」的键 —— 而且 0 放在 1 前面的直觉也不成立。
 */
test('⌘0 不映射（只做 1–9）', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: '0' })), null)
})

/*
 * 不带修饰键的数字必须是 null。
 * 搜索框里搜「123」是常事，要是这里认了，打一个字就粘走一条。
 */
test('裸数字键 → null，不然在搜索框里打字就会粘贴', () => {
  assert.equal(resolveKey(ev({ key: '1' })), null)
  assert.equal(resolveKey(ev({ key: '9' })), null)
})

test('pasteSlot 把 pasteN 换成 0 基下标，别的动作一律 null', () => {
  assert.equal(pasteSlot('paste1'), 0)
  assert.equal(pasteSlot('paste9'), 8)
  assert.equal(pasteSlot('favorite'), null)
  assert.equal(pasteSlot(null), null)
  assert.equal(pasteSlot(undefined), null)
})

/*
 * ★ ←→ 已经给设置面板领走了（09-18 加）。
 *
 * 列表里左右没有含义 —— 面板开着时这一对键在 `onKeydown` 的守卫里就被拦下
 * （守卫排在列表之前），落到全局那个 switch 里是空分支，这是有意的、不是漏改。
 * 锁这条是为了两件事：① 面板的行内移动真的收得到（宿主那六个转发键本来含 ←→）；
 * ② 以后翻键位表时能看见 ←→ 已经有主。
 */
test('★ ←→ 映射到 left / right（设置面板用）', () => {
  assert.equal(resolveKey(ev({ key: 'ArrowLeft' })), 'left')
  assert.equal(resolveKey(ev({ key: 'ArrowRight' })), 'right')
  // 带修饰键的不是面板内那条路（面板里用的是裸方向键）
  assert.equal(resolveKey(ev({ metaKey: true, key: 'ArrowLeft' })), null)
})
