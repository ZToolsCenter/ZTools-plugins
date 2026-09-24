/**
 * preload services 编码白名单 vm harness 单元测试（roadmap 任务 INT-005）。
 *
 * 被测对象是 preload 侧脚本 `public/preload/services.js`（CommonJS、
 * 挂 window.services，运行于 ZTools 注入的 preload 环境）—— 渲染层单测环境
 * 无法直接 import，故沿用 INT-002 导出链路的验证方式：node:vm 在新建上下文
 * 中执行脚本源码，沙箱注入最小全局（window / require / TextDecoder，均为
 * preload 真实运行环境的最小投影），随后断言 window.services 的行为。
 *
 * 覆盖（对照 services.js 的 ENCODING_MAP 白名单与 BOM 策略注释）：
 * - utf-16be（INT-005 新增的 API 级能力）：带 BOM / 无 BOM 的 UTF-16 BE
 *   文本均正确解码，BOM 按 TextDecoder 标签语义剥除（Node 实测 ignoreBOM
 *   默认 false 时剥 FE FF）；大小写归一（'UTF-16BE'）可用；
 * - 既有四项回归：'utf-16' → utf-16le、'gbk'、'utf-8'（含 'utf8' 别名与
 *   BOM 剥除）、缺省参数等价 'utf-8'；
 * - 白名单外编码仍抛中文错误（'iso-8859-1'）；
 * - path 非法仍拒绝（参数校验不受扩展影响）。
 *
 * 临时文件写在 os.tmpdir()（afterAll 递归删除），不触碰仓库目录。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

/** services.js 源码路径（相对本文件定位，不依赖运行 cwd） */
const SERVICES_PATH = fileURLToPath(
  new URL('../../public/preload/services.js', import.meta.url),
)

/** 沙箱 window 上挂载的服务集形状（仅本测试用到的 readTextFile） */
interface ServicesHarness {
  services: {
    readTextFile: (path: string, encoding?: string) => string
  }
}

/** vm 新建上下文执行 services.js，返回暴露在沙箱 window 上的 services */
function loadServices(): ServicesHarness['services'] {
  const code = readFileSync(SERVICES_PATH, 'utf-8')
  const sandbox = {
    // preload 的真实全局：宿主注入的 window（services 挂其上）
    window: {} as ServicesHarness,
    // preload 环境可 require（f-provider 已证明），此处给 Node 的 require
    require: createRequire(import.meta.url),
    // Node ≥11 的全局 TextDecoder（与 preload 运行时同源）
    TextDecoder,
  }
  runInNewContext(code, sandbox)
  if (!sandbox.window.services) {
    throw new Error('services.js 执行后未在 window.services 上暴露服务')
  }
  return sandbox.window.services
}

/** 文本 → UTF-16BE 字节（TextEncoder 只出 UTF-8，BE 用 LE 编码后字节对交换） */
function utf16beBytes(text: string): Buffer {
  return Buffer.from(text, 'utf16le').swap16()
}

let tempDir = ''
let services: ServicesHarness['services']

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'diffffff-preload-'))
  services = loadServices()
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

/** 写临时文件并返回其路径 */
function writeTemp(name: string, bytes: Buffer): string {
  const path = join(tempDir, name)
  writeFileSync(path, bytes)
  return path
}

describe('preload services.readTextFile 编码白名单（INT-005 vm harness）', () => {
  it("新增 'utf-16be'：带 BOM 的 UTF-16 BE 文件解码正确且剥除 BOM", () => {
    const text = '中文 UTF-16BE ✓'
    const path = writeTemp('be-bom.txt', Buffer.concat([Buffer.from([0xfe, 0xff]), utf16beBytes(text)]))
    expect(services.readTextFile(path, 'utf-16be')).toBe(text)
  })

  it("新增 'utf-16be'：无 BOM 的 UTF-16 BE 文件解码正确", () => {
    const text = 'plain BE text 中文'
    const path = writeTemp('be-nobom.txt', utf16beBytes(text))
    expect(services.readTextFile(path, 'utf-16be')).toBe(text)
  })

  it("编码入参大小写归一：'UTF-16BE' 与 'utf-16be' 等价", () => {
    const text = 'uppercase label'
    const path = writeTemp('be-upper.txt', utf16beBytes(text))
    expect(services.readTextFile(path, 'UTF-16BE')).toBe(text)
  })

  it("既有 'utf-16' 按 utf-16le 解码并剥除 FF FE BOM（回归）", () => {
    const text = '中文 LE'
    const leBytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    const path = writeTemp('le-bom.txt', leBytes)
    expect(services.readTextFile(path, 'utf-16')).toBe(text)
  })

  it("既有 'gbk'：GBK 字节（中文）解码正确", () => {
    // 「中文」的 GBK 字节序列：D6 D0 CE C4
    const path = writeTemp('gbk.txt', Buffer.from([0xd6, 0xd0, 0xce, 0xc4]))
    expect(services.readTextFile(path, 'gbk')).toBe('中文')
  })

  it("既有 'utf-8' 与别名 'utf8'：EF BB BF BOM 剥除（回归）", () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello 中文', 'utf-8')])
    const path = writeTemp('utf8-bom.txt', bytes)
    expect(services.readTextFile(path, 'utf-8')).toBe('hello 中文')
    expect(services.readTextFile(path, 'utf8')).toBe('hello 中文')
  })

  it('缺省 encoding 等价 utf-8（回归）', () => {
    const path = writeTemp('default.txt', Buffer.from('缺省编码', 'utf-8'))
    expect(services.readTextFile(path)).toBe('缺省编码')
  })

  it('白名单外编码抛中文错误（非法 encoding 仍拒绝）', () => {
    const path = writeTemp('any.txt', Buffer.from('x', 'utf-8'))
    expect(() => services.readTextFile(path, 'iso-8859-1')).toThrowError(/不支持的编码格式/)
  })

  it('path 非法仍拒绝（参数校验不受白名单扩展影响）', () => {
    expect(() => services.readTextFile('', 'utf-8')).toThrowError(/path 必须是非空字符串/)
    expect(() => services.readTextFile(42 as unknown as string, 'utf-8')).toThrowError(
      /path 必须是非空字符串/,
    )
  })
})
