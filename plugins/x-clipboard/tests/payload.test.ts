/*
 * 把一条内容写回剪贴板的两条路。
 *
 * 锁三件事：
 *   1. 三种类型各走宿主的哪个接口（文本 copyText / 文件 copyFile / 图像 copyImage）；
 *   2. 「内容取哪个字段」—— 图像优先 `imagePath`、退回 `content`，文件只认 `files[].path`；
 *   3. 取不到内容的（空文件列表 / 空图像路径）**不调接口**，直接返回 false。
 *
 * 为什么值得单测：`copyOne` 把三种类型挤在一条路径上，而这条路径没有界面 ——
 * 写错了只有真机上点一下才发现。宿主那三个同步接口本来是「一写就动系统剪贴板」的东西，
 * 所以这里塞一个只记录调用的假 `window.ztools`，一个字节也不碰真剪贴板。
 */

import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { copyOne, pasteOne, payloadOf } from '../src/lib/payload.ts'

/** 每次调用的流水账，断言直接看它 */
let log: string[] = []

;(globalThis as unknown as { window: unknown }).window = {
  ztools: {
    copyText: (text: string) => {
      log.push(`text=${text}`)
      return true
    },
    copyImage: (image: string) => {
      log.push(`image=${image}`)
      return true
    },
    copyFile: (p: string | string[]) => {
      log.push(`file=${Array.isArray(p) ? p.join('|') : p}`)
      return true
    },
    clipboard: {
      writeContent: async (data: { type: string; content: string | string[] }, paste: boolean) => {
        log.push(`writeContent=${data.type}:${JSON.stringify(data.content)}:paste=${paste}`)
        return { success: true }
      }
    }
  }
}

beforeEach(() => {
  log = []
})

test('文本 → copyText，取 content', () => {
  assert.equal(copyOne({ type: 'text', content: '你好' }), true)
  assert.deepEqual(log, ['text=你好'])
})

test('文件 → copyFile，整个路径数组一起给（顺序不动）', () => {
  const ok = copyOne({
    type: 'file',
    files: [
      { name: 'a.txt', path: '/tmp/a.txt' },
      { name: 'b.txt', path: '/tmp/b.txt' }
    ]
  })
  assert.equal(ok, true)
  assert.deepEqual(log, ['file=/tmp/a.txt|/tmp/b.txt'])
})

test('图像 → copyImage，优先用 imagePath', () => {
  assert.equal(copyOne({ type: 'image', imagePath: '/tmp/x.png', content: '不该用它' }), true)
  assert.deepEqual(log, ['image=/tmp/x.png'])
})

test('图像没有 imagePath 时退回 content', () => {
  assert.equal(copyOne({ type: 'image', content: '/tmp/y.png' }), true)
  assert.deepEqual(log, ['image=/tmp/y.png'])
})

test('文件列表为空 → 不调接口，直接 false', () => {
  assert.equal(copyOne({ type: 'file', files: [] }), false)
  assert.deepEqual(log, [])
})

test('图像路径为空 → 不调接口，直接 false', () => {
  assert.equal(copyOne({ type: 'image' }), false)
  assert.deepEqual(log, [])
})

test('文本为空串仍然写 —— 空文本也是合法的剪贴板内容', () => {
  assert.equal(copyOne({ type: 'text' }), true)
  assert.deepEqual(log, ['text='])
})

test('pasteOne 走宿主的 writeContent，并且要求粘贴（true）', async () => {
  assert.equal(await pasteOne({ type: 'text', content: 'abc' }), true)
  assert.deepEqual(log, ['writeContent=text:"abc":paste=true'])
})

test('pasteOne 内容取不到 → false，且一个宿主接口都不碰', async () => {
  assert.equal(await pasteOne({ type: 'file', files: [] }), false)
  assert.deepEqual(log, [])
})

test('payloadOf：三种类型各自的形状，取不到内容一律 null', () => {
  assert.deepEqual(payloadOf({ type: 'text', content: 'x' }), { type: 'text', content: 'x' })
  assert.deepEqual(payloadOf({ type: 'text' }), { type: 'text', content: '' })
  assert.deepEqual(payloadOf({ type: 'file', files: [{ name: 'a', path: '/a' }] }), {
    type: 'file',
    content: ['/a']
  })
  assert.equal(payloadOf({ type: 'file', files: [] }), null)
  assert.equal(payloadOf({ type: 'image' }), null)
})
