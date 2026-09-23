/*
 * 「文件行要不要显示缩略图」(`fileThumbSrc` / `isImageFileName`)。
 *
 * 背景（老大 09-20 问的）：「为什么 .png 结尾的会分到文件里面而不是图片里面？」
 * —— 宿主判 `type` 看的是**剪贴板上放的是文件还是位图**，跟扩展名无关：
 * `hasClipboardFiles()` 先跑，命中就一律 `file`（复制一个 a.png 文件走的就是这条）。
 * 所以插件**改不了类型**，能做的是**显示层**的让步：既然记录里带着完整路径，
 * 单个图片文件就把那个通用文件图标换成真缩略图。
 *
 * ⇒ 这里锁的就是那条让步的边界。**四条最容易改错的**：
 *   ① 只认**恰好一个**文件 —— 多选 5 个却弹其中一张的缩略图，会让人以为"这条就是那张图"；
 *   ② 目录不算（名字叫 `a.png` 的文件夹）；
 *   ③ 结尾才算 —— `a.png.txt`、`png`、`Makefile` 都不是图片；
 *   ④ 认出来的 URL **必须能过 `new URL()`**（Windows 盘符那种）——
 *      跟 `image.test.ts` 同一个道理：拼歪了 mac 上一点都看不出来，Windows 上整列变破图。
 *
 * 跑法：node --experimental-strip-types --test tests/filethumb.test.ts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { fileThumbSrc, isImageFileName, type ClipContent, type ClipFile } from '../src/lib/clipboard.ts'

const file = (name: string, path = `/tmp/${name}`, isDirectory = false): ClipFile => ({
  name,
  path,
  isDirectory
})

const fileItem = (...files: ClipFile[]): ClipContent => ({ type: 'file', files }) as ClipContent

test('单个图片文件：认出扩展名，拼出 file:// URL', () => {
  assert.equal(fileThumbSrc(fileItem(file('cat.png'))), 'file:///tmp/cat.png')
  assert.equal(fileThumbSrc(fileItem(file('照片 2026.jpg'))), 'file:///tmp/%E7%85%A7%E7%89%87%202026.jpg')
})

test('★ 扩展名大小写不敏感（截图工具爱写 .PNG）', () => {
  assert.equal(fileThumbSrc(fileItem(file('Shot.PNG'))), 'file:///tmp/Shot.PNG')
  assert.equal(fileThumbSrc(fileItem(file('a.JpEg'))), 'file:///tmp/a.JpEg')
})

test('★ 只认恰好一个文件 —— 多选一律退成文件图标', () => {
  // 两张图也不行：显示其中一张会让人以为"这条内容就是那张图"
  assert.equal(fileThumbSrc(fileItem(file('a.png'), file('b.png'))), '')
  assert.equal(fileThumbSrc(fileItem(file('a.png'), file('b.txt'))), '')
})

test('★ 目录不算（一个叫 a.png 的文件夹）', () => {
  assert.equal(fileThumbSrc(fileItem(file('a.png', '/tmp/a.png', true))), '')
})

test('★ 只看结尾：`.png.txt` / 无扩展名 / 名字里带 png 都不算', () => {
  for (const name of ['a.png.txt', 'a.png.bak', 'png', 'Makefile', 'png.png.exe', 'a.']) {
    assert.equal(isImageFileName(name), false, `${name} 不该被认成图片`)
    assert.equal(fileThumbSrc(fileItem(file(name))), '', `${name} 不该给缩略图`)
  }
})

test('常见图片格式都收（Chromium 渲染得出来的那几个）', () => {
  for (const name of ['a.png', 'a.jpg', 'a.jpeg', 'a.jfif', 'a.webp', 'a.gif', 'a.bmp', 'a.avif', 'a.ico']) {
    assert.equal(isImageFileName(name), true, `${name} 应该认成图片`)
  }
  // 故意不收：Chromium 打不开（.tif/.heic）或缩到 32×24 里没信息量（.svg）
  for (const name of ['a.tif', 'a.tiff', 'a.heic', 'a.svg']) {
    assert.equal(isImageFileName(name), false, `${name} 不该认成图片（见 clipboard.ts 的说明）`)
  }
})

test('不是文件记录 / 没有文件列表 —— 都给空串', () => {
  assert.equal(fileThumbSrc({ type: 'text', content: 'a.png' } as ClipContent), '')
  assert.equal(fileThumbSrc({ type: 'image', imagePath: '/tmp/a.png' } as ClipContent), '')
  assert.equal(fileThumbSrc({ type: 'file' } as ClipContent), '')
  assert.equal(fileThumbSrc({ type: 'file', files: [] } as ClipContent), '')
})

test('★ Windows 盘符路径也要拼成合法 URL（跟 imageSrc 共用 fileUrl，别在这儿自己拼）', () => {
  const url = fileThumbSrc(
    fileItem(file('a.png', 'C:\\Users\\xiaoxing\\Pictures\\a.png'))
  )
  assert.equal(url, 'file:///C:/Users/xiaoxing/Pictures/a.png')
  assert.doesNotThrow(() => new URL(url), `拼出来的不是合法 URL: ${url}`)
})

/*
 * 模板接线 —— 样式表里没有新类，所以这几条只看"有没有接上、顺序对不对"。
 *
 * 这一格是**三岔**且顺序决定行为：
 *   缩略图 → 文件图标（`type === "file"`）→ 图片占位（`type === "image"`）
 * 把缩略图那条挪到文件图标**后面**，它永远轮不到（`v-else-if` 是短路）；
 * 少了 `@error`，一个被删掉的图片文件会永远挂着一张破图，而不是退回文件图标。
 */
test('★ 模板接线：缩略图那条在文件图标之前，且带 @error 兜底', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')

  const thumb = src.indexOf(':src="row.thumb"')
  const ficon = src.indexOf("v-else-if=\"row.data.type === 'file'\" class=\"ficon\"")
  assert.ok(thumb > -1, '模板里没接上 row.thumb —— 文件行不会出缩略图')
  assert.ok(ficon > -1, '找不到文件图标那一条')
  assert.ok(thumb < ficon, '缩略图那条被排到文件图标后面了 —— v-else-if 短路，它永远轮不到')

  // 那一整条 `<img>`：从它自己的开标签切到下一个分支为止
  const branch = src.slice(src.lastIndexOf('<img', thumb), ficon)
  assert.match(branch, /@error="markBroken\(row\.key\)"/, '缩略图少了 @error —— 文件被删了会挂着一张破图')
  assert.match(branch, /!brokenThumbs\.has\(row\.key\)/, '缩略图没查 brokenThumbs —— @error 之后不会退')
})
