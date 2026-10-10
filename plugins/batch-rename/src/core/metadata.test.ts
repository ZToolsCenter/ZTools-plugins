import { mkdtemp, readFile, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

type MetadataResult = { dimensions?: string; capturedAt?: number; error?: string }
const require = createRequire(import.meta.url)
const { readMetadata } = require('../../preload/metadata.js') as {
  readMetadata: (filePath: string, kind?: 'all' | 'dimensions' | 'capturedAt') => Promise<MetadataResult>
}
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'batch-rename-metadata-'))
  temporaryDirectories.push(directory)
  return directory
}

function jpegWithCaptureTime(dateText: string) {
  const date = Buffer.from(`${dateText}\0`, 'ascii')
  const tiff = Buffer.alloc(8 + 18 + 18 + date.length)
  tiff.write('II', 0, 'ascii')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4)
  tiff.writeUInt16LE(1, 8)
  tiff.writeUInt16LE(0x8769, 10)
  tiff.writeUInt16LE(4, 12)
  tiff.writeUInt32LE(1, 14)
  tiff.writeUInt32LE(26, 18)
  tiff.writeUInt32LE(0, 22)
  tiff.writeUInt16LE(1, 26)
  tiff.writeUInt16LE(0x9003, 28)
  tiff.writeUInt16LE(2, 30)
  tiff.writeUInt32LE(date.length, 32)
  tiff.writeUInt32LE(44, 36)
  tiff.writeUInt32LE(0, 40)
  date.copy(tiff, 44)

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff])
  const segment = Buffer.alloc(4)
  segment.writeUInt16BE(0xffe1, 0)
  segment.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), segment, payload, Buffer.from([0xff, 0xd9])])
}

describe('preload 图片元数据读取', () => {
  it('读取真实 PNG 尺寸，并逐项报告缺少 EXIF 拍摄时间', async () => {
    const directory = await createTemporaryDirectory()
    const imagePath = join(directory, 'pixel.png')
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6WQAAAAASUVORK5CYII=',
      'base64'
    )
    await writeFile(imagePath, onePixelPng)

    const result = await readMetadata(imagePath)

    expect(await readFile(imagePath)).toEqual(onePixelPng)
    expect(result.dimensions).toBe('1x1')
    expect(result.capturedAt).toBeUndefined()
    expect(result.error).toContain('图片不含拍摄时间')
  })

  it('解析 EXIF 原始拍摄时间，并按文件修改时间和大小缓存', async () => {
    const directory = await createTemporaryDirectory()
    const imagePath = join(directory, 'capture.jpg')
    await writeFile(imagePath, jpegWithCaptureTime('2024:01:02 03:04:05'))

    const result = await readMetadata(imagePath, 'capturedAt')
    expect(result.capturedAt).toBe(new Date('2024-01-02T03:04:05').getTime())
    expect(result.error).toBeUndefined()

    await writeFile(imagePath, jpegWithCaptureTime('2025:06:07 08:09:10'))
    await utimes(imagePath, new Date('2025-06-07T08:09:10'), new Date('2025-06-07T08:09:10'))
    const updated = await readMetadata(imagePath, 'capturedAt')
    expect(updated.capturedAt).toBe(new Date('2025-06-07T08:09:10').getTime())
  })

  it('相对路径返回明确错误', async () => {
    expect(await readMetadata('relative.jpg')).toEqual({ error: '文件路径必须是绝对路径' })
  })
})
