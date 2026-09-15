import { describe, it, expect } from 'vitest'
import {
  generateTaskId,
  buildTaskOutputPath,
  buildTaskOutputDir,
  buildConvertedFilename,
  buildPageImageFilename,
  sanitizeTaskName,
  formatTaskDate,
} from '../hooks/useTaskFolder'

function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return idx >= 0 ? p.slice(0, idx) : p
}

describe('Task folder structure', () => {
  const downloads = 'C:\\Users\\test\\Downloads'
  const fixed = new Date(2026, 6, 29) // 2026-07-29 local

  it('task folder uses task-yyyymmdd-序号-文件名', () => {
    const taskId = generateTaskId('合同.pdf', fixed)
    expect(taskId).toMatch(/^task-20260729-\d+-合同$/)
    const out = buildTaskOutputPath(downloads, 'watermark', '合同_converted.pdf', taskId)
    expect(out).toBe([downloads, 'pdf-watermark', taskId, '合同_converted.pdf'].join(String.fromCharCode(92)))
  })

  it('formatTaskDate is yyyymmdd', () => {
    expect(formatTaskDate(fixed)).toBe('20260729')
  })

  it('each task gets its own folder', () => {
    const t1 = generateTaskId('a.pdf', fixed)
    const t2 = generateTaskId('a.pdf', fixed)
    expect(t1).not.toBe(t2)
    const d1 = buildTaskOutputDir(downloads, 'watermark', t1)
    const d2 = buildTaskOutputDir(downloads, 'watermark', t2)
    expect(d1).not.toBe(d2)
  })

  it('uses proper path separators', () => {
    const taskId = generateTaskId('report.pdf', fixed)
    const out = buildTaskOutputPath(downloads, 'watermark', 'report_converted.pdf', taskId)
    expect(out).toContain('pdf-watermark')
    expect(out).toContain('task-20260729-')
    expect(out).toContain('-report')
    expect(out.endsWith('.pdf')).toBe(true)
  })

  it('different features get separate task folders', () => {
    const wm = buildTaskOutputPath(downloads, 'watermark', 'x.pdf', generateTaskId('x.pdf', fixed))
    const comp = buildTaskOutputPath(downloads, 'compress', 'x.pdf', generateTaskId('x.pdf', fixed))
    const merge = buildTaskOutputPath(downloads, 'merge', 'x.pdf', generateTaskId('x.pdf', fixed))
    expect(dirname(wm)).toMatch(/pdf-watermark/)
    expect(dirname(comp)).toMatch(/pdf-compress/)
    expect(dirname(merge)).toMatch(/pdf-merge/)
  })

  it('handles trailing separator in downloads path', () => {
    const withTrailing = 'C:\\Users\\test\\Downloads\\'
    const taskId = generateTaskId('doc.pdf', fixed)
    const out = buildTaskOutputPath(withTrailing, 'watermark', 'doc_converted.pdf', taskId)
    expect(out).not.toMatch(/Downloads\\\\pdf/)
    expect(out).toContain('pdf-watermark')
    expect(out).toContain('task-20260729-')
    expect(out).toContain('-doc')
  })

  it('buildTaskOutputDir returns the task directory', () => {
    const taskId = generateTaskId('wm.pdf', fixed)
    const dir = buildTaskOutputDir(downloads, 'watermark', taskId)
    expect(dir).toBe([downloads, 'pdf-watermark', taskId].join(String.fromCharCode(92)))
  })

  it('sanitizeTaskName strips extension and invalid chars', () => {
    expect(sanitizeTaskName('a:b?.pdf')).toBe('a_b_')
    expect(sanitizeTaskName('mx-space部署.pdf')).toBe('mx-space部署')
  })
})

describe('Converted output naming', () => {
  const downloads = 'C:\\Users\\test\\Downloads'
  const fixed = new Date(2026, 6, 29)

  it('buildConvertedFilename uses original name + _converted + ext', () => {
    expect(buildConvertedFilename('report.pdf', '.docx')).toBe('report_converted.docx')
    expect(buildConvertedFilename('C:\\docs\\季度总结.PDF', '.xlsx')).toBe('季度总结_converted.xlsx')
    expect(buildConvertedFilename('a.b.c.pdf', 'pptx')).toBe('a.b.c_converted.pptx')
  })

  it('buildPageImageFilename uses original name + _pageIndex', () => {
    expect(buildPageImageFilename('report.pdf', 1, 'png')).toBe('report_1.png')
    expect(buildPageImageFilename('report.pdf', 12, 'jpg')).toBe('report_12.jpg')
    expect(buildPageImageFilename('C:\\x\\foo.bar.pdf', 3, '.png')).toBe('foo.bar_3.png')
  })

  it('office convert path lands under task folder with converted name', () => {
    const taskId = generateTaskId('合同.pdf', fixed)
    const name = buildConvertedFilename('合同.pdf', '.docx')
    const out = buildTaskOutputPath(downloads, 'word', name, taskId)
    expect(out).toBe([downloads, 'pdf-word', taskId, '合同_converted.docx'].join(String.fromCharCode(92)))
    expect(taskId).toMatch(/^task-20260729-\d+-合同$/)
  })

  it('image convert dir is task folder; page files are name_N.ext', () => {
    const taskId = generateTaskId('slides.pdf', fixed)
    const dir = buildTaskOutputDir(downloads, 'image', taskId)
    expect(dir).toBe([downloads, 'pdf-image', taskId].join(String.fromCharCode(92)))
    expect(buildPageImageFilename('slides.pdf', 1, 'png')).toBe('slides_1.png')
    expect(buildPageImageFilename('slides.pdf', 2, 'png')).toBe('slides_2.png')
  })
})
