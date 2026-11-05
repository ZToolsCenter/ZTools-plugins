/**
 * 文件路径展示 + 资源管理器定位 回归测试
 *   node --experimental-strip-types design/check-files.mts
 *
 * 覆盖三件事：
 *   1. 路径解析（文件名 / 所在目录 / 长路径折叠）在两种分隔符下都正确
 *   2. 文件行高度与 FileCard 的实际排版严格对齐（虚拟列表算错高度就会错位）
 *   3. 定位能力：优先宿主 shellShowItemInFolder，缺失时降级 preload
 */

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  期望=${String(expected)} 实际=${String(actual)}`}`)
}

/* ------------------------------------------------------------------ */
/* 1. 路径解析                                                         */
/* ------------------------------------------------------------------ */

const { fileName, fileDir, shrinkPath } = await import('../src/utils/format.ts')

console.log('--- 文件名 ---')
check('Windows 路径', fileName('D:\\Downloads\\设计稿-v3.fig'), '设计稿-v3.fig')
check('Unix 路径', fileName('/home/u/docs/report.pdf'), 'report.pdf')
check('根目录文件', fileName('C:\\a.txt'), 'a.txt')
check('无分隔符', fileName('notes.md'), 'notes.md')
check('结尾带分隔符不误判', fileName('D:\\a\\b\\'), 'b')

console.log('\n--- 所在目录 ---')
check('Windows 目录', fileDir('D:\\Downloads\\设计稿-v3.fig'), 'D:\\Downloads')
check('Unix 目录', fileDir('/home/u/docs/report.pdf'), '/home/u/docs')
check('盘符根目录文件', fileDir('C:\\a.txt'), 'C:\\')
check('Unix 根下文件', fileDir('/a.txt'), '/')
check('无分隔符时无目录', fileDir('notes.md'), '')

console.log('\n--- 长路径折叠 ---')
const long = 'D:\\Users\\someone\\Projects\\y-clipboard\\src-ztools\\preload\\services.js'
const shrunk = shrinkPath(long, 40)
check('超长时被折叠', shrunk.length <= 40, true)
check('折叠后带省略号', shrunk.includes('…'), true)
check('只保留盘符作为开头', shrunk.startsWith('D:\\…'), true)
check('保留末尾（最关键的那几层目录）', shrunk.endsWith('preload\\services.js'), true)
check('短路径原样返回', shrinkPath('D:\\a\\b.txt', 40), 'D:\\a\\b.txt')
check('极长路径折叠后仍在长度上限内', shrinkPath(long, 20).length <= 20, true)
check('Unix 长路径也保留末尾', shrinkPath('/home/u/p/q/r/s/t/report.pdf', 24).endsWith('t/report.pdf'), true)

/* ------------------------------------------------------------------ */
/* 2. 文件行高度                                                       */
/* ------------------------------------------------------------------ */

const layout = await import('../src/utils/layout.ts')
const { fileLinesOf, filePathsOf, fileRowHeight, rowHeightOf, ROW_GAP, FILE_LINE_H, FILE_CARD_PAD, FILE_MAX_LINES, FILE_MORE_H } = layout

function fileRec(files: string[] | undefined, content = ''): any {
  return { id: 'f', kind: 'file', rawType: 'file', content, files, createdAt: 0 }
}

console.log('\n--- 路径提取 ---')
check('files 优先', filePathsOf(fileRec(['D:\\a.txt', 'D:\\b.txt'], 'D:\\c.txt')).length, 2)
check('files 为空时用 content 兜底', filePathsOf(fileRec([], 'D:\\c.txt')).join('|'), 'D:\\c.txt')
check('files 缺失时用 content 兜底', filePathsOf(fileRec(undefined, 'D:\\c.txt')).join('|'), 'D:\\c.txt')
check('都没有时为空数组', filePathsOf(fileRec(undefined, '')).length, 0)

console.log('\n--- 行高与排版对齐 ---')
const expectH = (n: number): number => {
  const lines = Math.min(Math.max(n, 1), FILE_MAX_LINES)
  const more = n > FILE_MAX_LINES ? FILE_MORE_H : 0
  return FILE_CARD_PAD * 2 + lines * FILE_LINE_H + more + ROW_GAP
}
check('单文件行高', fileRowHeight(fileRec(['D:\\a.txt'])), expectH(1))
check('双文件行高', fileRowHeight(fileRec(['D:\\a.txt', 'D:\\b.txt'])), expectH(2))
check('四文件（刚好到上限）', fileLinesOf(fileRec(['1', '2', '3', '4'])), 4)
check('六文件折叠为四条 + 提示行', fileRowHeight(fileRec(['1', '2', '3', '4', '5', '6'])), expectH(6))
check('折叠后行数不再增长', fileLinesOf(fileRec(['1', '2', '3', '4', '5', '6', '7'])), FILE_MAX_LINES)
check('无 files 的记录也占一行', fileRowHeight(fileRec(undefined, 'D:\\a.txt')), expectH(1))
check('空记录不至于塌陷为 0', fileRowHeight(fileRec(undefined, '')) > 0, true)

// 内容高度必须 <= 行高（含间距），否则卡片会被裁切
const contentH = (n: number): number => fileRowHeight(fileRec(new Array(n).fill('x'))) - ROW_GAP
check('卡片内容高度不超过行高', contentH(3) <= fileRowHeight(fileRec(['1', '2', '3'])), true)

console.log('\n--- 与虚拟列表度量一致 ---')
check('rowHeightOf 对文件走文件度量', rowHeightOf(fileRec(['D:\\a.txt']), 600, 'md', 600), expectH(1))
check('文件行不随图片档位变化', rowHeightOf(fileRec(['D:\\a.txt']), 600, 'lg', 600), expectH(1))
check('多文件行高于单文件', rowHeightOf(fileRec(['1', '2']), 600, 'md', 600) > rowHeightOf(fileRec(['1']), 600, 'md', 600), true)

// 混合队列：文件行参与前缀和/二分定位后仍然精确
const mixed: any[] = []
for (let i = 0; i < 12; i++) {
  mixed.push(
    i % 3 === 0
      ? { ...fileRec(['D:\\a.txt', 'D:\\b.txt']), id: 'f' + i }
      : { id: 't' + i, kind: 'text', rawType: 'text', content: 'x', createdAt: 0 }
  )
}
const heights = mixed.map((r) => rowHeightOf(r, 600, 'md', 600))
const offsets = new Array<number>(heights.length + 1)
offsets[0] = 0
for (let i = 0; i < heights.length; i++) offsets[i + 1] = offsets[i] + heights[i]

function indexAt(y: number): number {
  let lo = 0
  let hi = mixed.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1] <= y) lo = mid + 1
    else hi = mid
  }
  return lo
}
let hitOk = true
for (let i = 0; i < mixed.length; i++) {
  if (indexAt(offsets[i]) !== i) hitOk = false
  if (indexAt(offsets[i] + heights[i] / 2) !== i) hitOk = false
  if (indexAt(offsets[i + 1] - 1) !== i) hitOk = false
}
check('含文件行的混合队列定位精确', hitOk, true)

/* ------------------------------------------------------------------ */
/* 3. 定位能力：宿主优先、preload 兜底                                  */
/* ------------------------------------------------------------------ */

console.log('\n--- 定位：宿主 API 优先 ---')

const hostCalls: string[] = []
const svcCalls: string[] = []
;(globalThis as any).window = {
  ztools: {
    shellShowItemInFolder(p: string) {
      hostCalls.push(p)
    }
  },
  services: {
    revealInFolder(p: string) {
      svcCalls.push(p)
      return true
    }
  }
}
// 重新加载模块以获取新的 window 绑定
const { api: apiHost } = await import('../src/api.ts?host=1')
check('宿主可用时定位成功', await apiHost.reveal('D:\\a.txt'), true)
check('调的是宿主 API', hostCalls.length, 1)
check('路径原样透传', hostCalls[0], 'D:\\a.txt')
check('宿主可用时不走 preload 兜底', svcCalls.length, 0)

console.log('\n--- 定位：宿主缺失时降级 preload ---')
;(globalThis as any).window = {
  ztools: {},
  services: {
    revealInFolder(p: string) {
      svcCalls.push(p)
      return true
    }
  }
}
const { api: apiFallback } = await import('../src/api.ts?fallback=1')
check('降级后仍定位成功', await apiFallback.reveal('D:\\b.txt'), true)
check('preload 收到请求', svcCalls[svcCalls.length - 1], 'D:\\b.txt')

console.log('\n--- 定位：两条路都没有时如实失败 ---')
;(globalThis as any).window = { ztools: {}, services: {} }
const { api: apiNone } = await import('../src/api.ts?none=1')
check('无法定位时返回 false（调用方据此提示）', await apiNone.reveal('D:\\c.txt'), false)

console.log('\n--- 定位：宿主 API 抛错时不崩 ---')
;(globalThis as any).window = {
  ztools: {
    shellShowItemInFolder() {
      throw new Error('boom')
    }
  },
  services: {
    revealInFolder() {
      return true
    }
  }
}
const { api: apiThrow } = await import('../src/api.ts?throw=1')
check('宿主抛错时转 preload，不向上冒泡', await apiThrow.reveal('D:\\d.txt'), true)

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
