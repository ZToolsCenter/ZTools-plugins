/**
 * 清理失效历史 回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-stale.mts
 *
 * 背景：剪贴板里的「文件」「图片」两类记录只有一串路径 —— 源文件在别处被
 * 移动或删除后，这条记录就永远用不了了（点复制只会失败，定位也定位不到）。
 * 「清理失效」就是把这类记录找出来删掉。
 *
 * 这套测试守三件事：
 *   1. 判定分两档且保守 —— 全没了 = 可清理；只缺一部分 = 也能清理但要用户确认
 *      （代价是把还剩那几个一起丢掉）；判断不了的谁也不许动；
 *   2. 清理真的生效 —— 界面、计数、宿主三处同步，收藏不受影响；
 *   3. 问过用户才删 —— 没确认、或选了取消，就不许动列表。
 *
 * 「弹窗本身长什么样、怎么问」在 check-confirm.mts 里单独立一套。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  期望=${e} 实际=${a}`}`)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string): string => readFileSync(join(root, 'src', p), 'utf8')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ */
/* 一、判定：纯函数，用注入的磁盘状态覆盖各种情形                         */
/* ------------------------------------------------------------------ */

const { localPathsOf, staleVerdict, pathFromSrc, pickStale } = await import(
  '../src/utils/stale.ts'
)

console.log('--- 路径提取 ---')
check(
  'file:// URL 还原成本地路径',
  pathFromSrc('file:///E:/a/b/%E6%B5%8B%E8%AF%95.png'),
  'E:/a/b/测试.png'
)
check('非 file:// 原样返回空', pathFromSrc('https://x.com/a.png'), '')

const fileRec = (paths: string[]) => ({
  id: 'f', kind: 'file' as const, rawType: 'file', content: paths[0] ?? '',
  files: paths, createdAt: 0
})
const imageRec = (raw: Record<string, unknown>, content = '') => ({
  id: 'i', kind: 'image' as const, rawType: 'image', content, raw, createdAt: 0
})
const textRec = { id: 't', kind: 'text' as const, rawType: 'text', content: 'hello', createdAt: 0 }

check('文件记录取 files 列表', localPathsOf(fileRec(['D:\\a.txt', 'D:\\b.txt'])), ['D:\\a.txt', 'D:\\b.txt'])
check(
  '图片记录从 raw 里取宿主保存的本地路径',
  localPathsOf(imageRec({ imagePath: 'E:\\shots\\x.png' })),
  ['E:\\shots\\x.png']
)
check(
  '图片记录的本地路径也能从 file:// content 反推',
  localPathsOf(imageRec({}, 'file:///E:/shots/y.png')),
  ['E:/shots/y.png']
)
check('data URL 图片不依赖磁盘', localPathsOf(imageRec({ content: 'data:image/png;base64,AAA' })), [])
check('网络地址不是本地路径', localPathsOf(imageRec({ imagePath: 'https://x.com/a.png' })), [])
check('文本记录不解路径', localPathsOf(textRec as never), [])

/** 假磁盘：路径里带"已删除"的不存在；网络路径（\\server）读不了 → null */
const disk: Array<string | null> = []
function fakeExists(p: string): boolean | null {
  disk.push(p)
  if (/^\\\\/.test(p)) return null
  return !/已删除/.test(p)
}

console.log('\n--- 判定：全没了 = stale ---')
check('全部文件都不在了 → 失效', staleVerdict(fileRec(['D:\\已删除.txt']), { exists: fakeExists }), 'stale')
check('图片原图没了 → 失效', staleVerdict(imageRec({ imagePath: 'E:\\已删除.png' }), { exists: fakeExists }), 'stale')
check('连路径都没有的文件记录 = 残缺，算失效', staleVerdict(fileRec([]), { exists: fakeExists }), 'stale')

console.log('\n--- 判定：缺一部分 = partial ---')
check(
  '有活着的也有没了的 → 部分失效（界面上标"已不存在"的就是这条）',
  staleVerdict(fileRec(['D:\\a.txt', 'D:\\已删除.txt']), { exists: fakeExists }),
  'partial'
)
check(
  '部分缺失里掺着读不到的路径，仍按部分失效处理（不能当成整条没了）',
  staleVerdict(fileRec(['D:\\a.txt', 'D:\\已删除.txt', '\\\\nas\\share\\x.txt']), { exists: fakeExists }),
  'partial'
)

console.log('\n--- 判定：判断不了 = unknown（谁也不许动）---')
check('整条都是网络路径 → 判断不了', staleVerdict(fileRec(['\\\\nas\\share\\a.txt']), { exists: fakeExists }), 'unknown')
check(
  '没了的 + 读不到的 → 没法确认"全没了"，保留',
  staleVerdict(fileRec(['D:\\已删除.txt', '\\\\nas\\share\\a.txt']), { exists: fakeExists }),
  'unknown'
)

console.log('\n--- 判定：正常 ---')
check('全都还在 → 正常', staleVerdict(fileRec(['D:\\a.txt', 'D:\\b.txt']), { exists: fakeExists }), 'ok')
check('图片原图还在 → 正常', staleVerdict(imageRec({ imagePath: 'E:\\shots\\x.png' }), { exists: fakeExists }), 'ok')
check('data URL 图片永远有效', staleVerdict(imageRec({ content: 'data:image/png;base64,AAA' }), { exists: fakeExists }), 'ok')
check('文本永远有效', staleVerdict(textRec as never, { exists: fakeExists }), 'ok')

console.log('\n--- 每条被问过的路径（不能重复问同一个）---')
disk.length = 0
pickStale([fileRec(['D:\\dup.txt', 'D:\\dup.txt']), fileRec(['D:\\已删除.txt'])], { exists: fakeExists })
check('同一路径只查一次', disk.filter((p) => p === 'D:\\dup.txt').length, 1)
check('pickStale 只挑全没了的，不含部分缺失', pickStale(
  [fileRec(['D:\\a.txt', 'D:\\已删除.txt']), fileRec(['D:\\已删除.txt'])],
  { exists: fakeExists }
).map((r) => r.files?.[0]), ['D:\\已删除.txt'])

/* ------------------------------------------------------------------ */
/* 二、源码契约                                                        */
/* ------------------------------------------------------------------ */

console.log('\n--- 契约：清之前必须刷新磁盘缓存 /UI 不跳 ---')
const storeSrc = src('composables/useStore.ts')
const sidebarSrc = src('components/Sidebar.vue')

check('扫描前清空路径缓存（缓存是本次会话攒的，磁盘早变了）', /clearFileCache\(\)/.test(storeSrc), true)
check('批量 removal fire-and-forget，不拿宿主返回值卡界面', /void api\.remove\(r\.id\)\.catch/.test(storeSrc), true)
check('批量删除同步更新总数', /totalCount\.value = Math\.max\(0, totalCount\.value - ids\.size\)/.test(storeSrc), true)
check('远端搜索结果一起删（只删一边会"复活"）', /remoteResults\.value = remoteResults\.value\.filter\(\(r\) => !ids\.has\(r\.id\)\)/.test(storeSrc), true)
check('删除后按身份重新落位（按下标会指到别人身上）', /restoreSelection\(anchorId\)/.test(storeSrc), true)
check('扫描结果把"缺一部分"单独成档', /v === 'partial'\) partial\.push/.test(storeSrc), true)
check('取消就不许动列表', /if \(choice === 'cancel'\) return/.test(storeSrc), true)
check('主操作是全部清理（含部分缺失）', /choice === 'alt' \? scan\.stale : \[\.\.\.scan\.stale, \.\.\.scan\.partial\]/.test(storeSrc), true)
// 插件内弹窗：window.confirm 在 Electron 里是系统级弹窗，会跳出插件窗口。
// 只查"真的在调用"（后面紧跟括号），注释里提这个名字是说明"为什么不用"，不算数
check('清理不再调用 window.confirm', /window\.confirm\s*\(/.test(storeSrc), false)
check('侧栏也不再调用 window.confirm', /window\.confirm\s*\(/.test(sidebarSrc), false)

// 硬规矩 13：贴底容器里"按条件显隐"一律不能用 v-if，否则整块高度一变、上面跟着跳
const footBlock = sidebarSrc.slice(
  sidebarSrc.indexOf('sidebar-foot'),
  sidebarSrc.indexOf('</nav>')
) || sidebarSrc.slice(sidebarSrc.indexOf('sidebar-foot'))
check('底部操作区没有 v-if（高度不能变）', /v-if|v-show/.test(footBlock), false)
check('清理按钮存在且有说明', /清理失效/.test(sidebarSrc), true)
check('扫描期间按钮不可点', /:disabled="store\.cleaning\.value"/.test(sidebarSrc), true)

/* ------------------------------------------------------------------ */
/* 三、行为：假宿主 + 假磁盘                                            */
/* ------------------------------------------------------------------ */

console.log('\n--- 行为：扫描 ---')

const now = Date.now()
const items: any[] = [
  { id: 't1', type: 'text', content: '还在的文本', timestamp: now },
  { id: 'f1', type: 'file', timestamp: now - 1, files: [{ path: 'D:\\docs\\存在.txt', name: '存在.txt', exists: true }] },
  // 全没了
  { id: 'f2', type: 'file', timestamp: now - 2, files: [{ path: 'D:\\docs\\已删除.zip', name: '已删除.zip', exists: true }] },
  // 缺一部分
  { id: 'f3', type: 'file', timestamp: now - 3, files: [{ path: 'D:\\docs\\存在.txt', name: '存在.txt', exists: true }, { path: 'D:\\docs\\已删除.zip', name: '已删除.zip', exists: true }] },
  { id: 'i1', type: 'image', timestamp: now - 4, imagePath: 'E:\\shots\\已删除.png', appName: 'Snipaste' },
  { id: 'i2', type: 'image', timestamp: now - 5, imagePath: 'E:\\shots\\还在.png' },
  { id: 'i3', type: 'image', timestamp: now - 6, content: 'data:image/png;base64,iVBORw0KGgo=' },
  // 又一条缺一部分
  { id: 'f5', type: 'file', timestamp: now - 6.5, files: [{ path: 'D:\\docs\\存在.txt', name: '存在.txt', exists: true }, { path: 'D:\\docs\\已删除2.zip', name: '已删除2.zip', exists: true }] },
  // 网络路径：fileExists 判断不了 → 必须保留
  { id: 'f4', type: 'file', timestamp: now - 7, files: [{ path: '\\\\nas\\share\\归档.zip', name: '归档.zip' }] }
]

const removedIds: string[] = []
const toasts: string[] = []
const mem = new Map<string, string>()

const ztoolsStub = {
  setSubInput: () => true,
  subInputFocus: () => true,
  subInputSelect: () => true,
  onPluginEnter: () => undefined,
  onPluginOut: () => undefined,
  outPlugin: () => undefined,
  showToast: (m: string) => void toasts.push(m),
  clipboard: {
    async getHistory(_page: number, pageSize: number) {
      const slice = items.slice(0, Math.min(pageSize, items.length))
      return { items: slice, total: items.length, page: _page, pageSize }
    },
    async delete(id: string) {
      removedIds.push(id)
      const i = items.findIndex((r) => r.id === id)
      if (i >= 0) items.splice(i, 1) // 与真实宿主一致：删了就真不在库里了
      return { success: true }
    },
    async clear() {
      const n = items.length
      items.length = 0
      return n
    },
    onChange: () => undefined
  },
  dbStorage: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k)
  },
  isDarkColors: () => false,
  getThemeInfo: () => ({ primaryColor: '#5B8DEF' })
}

;(globalThis as any).window = {
  ztools: ztoolsStub,
  // preload 在真实宿主里就是这么挂的：同步查询磁盘
  services: {
    fileExists: (p: string) => {
      if (/^\\\\/.test(String(p))) return null
      return !/已删除/.test(String(p))
    }
  }
}

const { useStore } = await import('../src/composables/useStore.ts')
const s = useStore()
s.init()
await sleep(40)
// init 会自动开始轮询（宿主推送不可靠），这会让假宿主的旧数据又被拉回来，干扰断言
s.stopWatching()
await s.loadFirst()
await sleep(40)

check('历史已加载', s.records.value.length, 9)
check('文件分类有 5 条', s.counts.file, 5)
check('图片分类有 3 条', s.counts.image, 3)

console.log('\n--- 扫描 ---')
const scan = await s.scanStale()
check('扫了 9 条', scan.scanned, 9)
check('全没了的有 2 条', scan.stale.map((r) => r.id), ['f2', 'i1'])
check('缺一部分的有 2 条', scan.partial.map((r) => r.id), ['f3', 'f5'])
check('判断不了的有 1 条', scan.unknown, 1)
check('data URL 图片被保留', scan.stale.some((r) => r.id === 'i3'), false)
check('扫描完进度归位', s.cleanProgress.value, null)

console.log('\n--- 取消：一条都不许动 ---')
await s.cleanStale(() => 'cancel')
await sleep(20)
check('列表没变', s.records.value.length, 9)
check('没有通知宿主删除', removedIds.length, 0)
check('没有清理提示', toasts.some((t) => t.startsWith('已清理')), false)

console.log('\n--- 选"只清理完全失效的"：部分缺失那两条留着 ---')
s.setCat('all')
await sleep(20)
// 光标放在 f3 上（它前面两条会被删掉）：清理后它应当还在光标上
s.selectedIndex.value = 3
check('清理前光标在 f3 上', s.filtered.value[3]?.id, 'f3')
await s.cleanStale(() => 'alt')
await sleep(30)
check('界面少了 2 条', s.records.value.length, 7)
check('全没了的两条都没了', ['f2', 'i1'].some((id) => s.records.value.some((r) => r.id === id)), false)
check('缺一部分的两条都还在', s.records.value.filter((r) => r.id === 'f3' || r.id === 'f5').length, 2)
check('通知宿主删的就是这两条', removedIds, ['f2', 'i1'])
check('给了清理提示', toasts.filter((t) => t === '已清理 2 条失效记录').length, 1)
check('"全部"计数同步', s.counts.all, 7)
check('文件分类剩 4 条（缺一部分的两条留着）', s.counts.file, 4)
check('图片分类剩 2 条', s.counts.image, 2)
check('光标前的记录被删掉后，仍锚在同一条记录上', s.filtered.value[s.selectedIndex.value]?.id, 'f3')

console.log('\n--- 选"全部清理"：缺一部分的也一起清掉 ---')
toasts.length = 0
await s.cleanStale(() => 'ok')
await sleep(30)
check('界面再少 2 条', s.records.value.length, 5)
check('缺一部分的两条也没了', s.records.value.filter((r) => r.id === 'f3' || r.id === 'f5').length, 0)
check('通知宿主删的是这两条', removedIds, ['f2', 'i1', 'f3', 'f5'])
check('给了清理提示', toasts.filter((t) => t === '已清理 2 条失效记录').length, 1)
check('"全部"计数同步', s.counts.all, 5)
check('文件分类只剩 2 条（存在的那条 + 网络路径那条）', s.counts.file, 2)

console.log('\n--- 没有失效时不打扰 ---')
const scan2 = await s.scanStale()
check('这轮没有失效记录', scan2.stale.length, 0)
check('这轮也没有部分缺失', scan2.partial.length, 0)
toasts.length = 0
await s.cleanStale(() => 'ok')
await sleep(20)
check('提示"没有发现失效记录"', toasts[0], '没有发现失效记录（已检查 5 条）')
check('一条都没删', s.records.value.length, 5)

console.log('\n--- 收藏不受影响 ---')
const target = s.records.value.find((r) => r.id === 'f1')!
s.toggleStar(target)
check('已收藏一条', s.counts.star, 1)
;(globalThis as any).window.services = {
  fileExists: () => false // 假装所有文件都没了：这一轮连"存在.txt"也算失效
}
const scan3 = await s.scanStale()
check('这轮能扫出更多失效记录', scan3.stale.length >= 1, true)
await s.cleanStale(() => 'ok')
await sleep(20)
check('收藏还在（快照是用户主动留的）', s.counts.star, 1)
check('收藏的那条还能在收藏分类里看到', s.favorites.value[0]?.id, s.favKey(target))

s.stopWatching()
console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
