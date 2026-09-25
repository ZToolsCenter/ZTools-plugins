import { describe, expect, it } from 'vitest'
import type { FileItem, InsertRule } from './session'
import { applyInsertRule } from './insert'

const file = (currentName: string, extras: Partial<FileItem> = {}): FileItem => {
  const extensionIndex = currentName.lastIndexOf('.')
  const hasExtension = extensionIndex > 0
  return {
    id: currentName,
    sourcePath: `/temp/${currentName}`,
    directory: '/temp',
    currentName,
    baseName: hasExtension ? currentName.slice(0, extensionIndex) : currentName,
    extension: hasExtension ? currentName.slice(extensionIndex) : '',
    ...extras
  }
}

const rule = (patch: Partial<InsertRule>): InsertRule => ({
  kind: 'text', position: 'start', index: 1, text: 'Final_',
  number: { prefix: '', start: 1, style: 'arabic', digits: 0, suffix: '' },
  info: 'modified', prefix: '', suffix: '', ...patch
})

describe('插入内容规则', () => {
  it('TC-10：在文件名前插入固定文本并保留扩展名', () => {
    expect(applyInsertRule(file('video.mp4'), 0, rule({}))).toEqual({ name: 'Final_video.mp4' })
  })

  it('TC-11：在扩展名前插入固定文本', () => {
    expect(applyInsertRule(file('video.mp4'), 0, rule({ position: 'end', text: '_final' })))
      .toEqual({ name: 'video_final.mp4' })
  })

  it('TC-12：指定位置按 1-based 字符边界插入', () => {
    expect(applyInsertRule(file('video.mp4'), 0, rule({ position: 'index', index: 3, text: '_' })))
      .toEqual({ name: 'vi_deo.mp4' })
    expect(applyInsertRule(file('ab.txt'), 0, rule({ position: 'index', index: 99, text: '!' })))
      .toEqual({ name: 'ab!.txt' })
  })

  it('TC-13：序号使用传入的当前排序索引', () => {
    const files = [file('b.jpg'), file('a.jpg')].sort((left, right) => left.currentName.localeCompare(right.currentName))
    const numbering = rule({
      kind: 'number', position: 'end',
      number: { prefix: '-', start: 1, style: 'arabic', digits: 2, suffix: '' }
    })
    expect(files.map((item, index) => applyInsertRule(item, index, numbering).name))
      .toEqual(['a-01.jpg', 'b-02.jpg'])
  })

  it('TC-14：文件修改时间使用安全格式', () => {
    const timestamp = new Date(2024, 0, 2, 3, 4, 5).getTime()
    expect(applyInsertRule(file('video.mp4', { modifiedAt: timestamp }), 0,
      rule({ kind: 'info', position: 'start', info: 'modified', prefix: '[', suffix: ']' })))
      .toEqual({ name: '[2024-01-02_03-04-05]video.mp4' })
  })

  it('支持创建时间、大小、图片尺寸及拍摄时间', () => {
    const timestamp = new Date(2024, 0, 2, 3, 4, 5).getTime()
    const source = file('photo.jpg', {
      createdAt: timestamp, size: 4.6 * 1024 * 1024,
      metadata: { dimensions: '1920 × 1080', capturedAt: timestamp }
    })
    const infoRule = (info: InsertRule['info']) => rule({ kind: 'info', position: 'end', info })
    expect(applyInsertRule(source, 0, infoRule('created')).name).toBe('photo2024-01-02_03-04-05.jpg')
    expect(applyInsertRule(source, 0, infoRule('size')).name).toBe('photo4.6MB.jpg')
    expect(applyInsertRule(source, 0, infoRule('dimensions')).name).toBe('photo1920x1080.jpg')
    expect(applyInsertRule(source, 0, infoRule('captured')).name).toBe('photo2024-01-02_03-04-05.jpg')
  })

  it('TC-15～16：缺失信息返回可显示的错误', () => {
    const missingExif = applyInsertRule(file('plain.png'), 0, rule({ kind: 'info', info: 'captured' }))
    expect(missingExif).toEqual({ name: 'plain.png', error: '无法读取照片拍摄时间' })
    expect(applyInsertRule(file('plain.png'), 0, rule({ kind: 'info', info: 'dimensions' })).error)
      .toBe('无法读取图片尺寸')
    expect(applyInsertRule(file('plain.png'), 0, rule({ kind: 'info', info: 'modified' })).error)
      .toBe('无法读取文件修改时间')
  })

  it('拒绝无效的指定位置', () => {
    expect(applyInsertRule(file('a.txt'), 0, rule({ position: 'index', index: 0 })))
      .toEqual({ name: 'a.txt', error: '指定位置必须是正整数' })
  })
})
