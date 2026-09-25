import { describe, expect, it } from 'vitest'
import { createPreview } from './preview'
import {
  clearFiles,
  applyBatchResults,
  createSession,
  extractFilePaths,
  removeFile,
  replaceTask,
  type FileInfo
} from './session'

const file = (path: string, error?: string): FileInfo => ({
  path,
  name: path.split(/[\\/]/).at(-1) || '',
  error
})

describe('文件入口与会话', () => {
  it('仅处理文件入口，并校验、去重绝对路径', () => {
    expect(extractFilePaths({ code: 'batch-rename', payload: '' }, 'win32')).toBeNull()
    expect(extractFilePaths({ code: 'batch-rename-files', payload: [
      { path: 'C:\\Test\\A.txt', isFile: true },
      { path: 'c:/test/a.txt', isFile: true },
      { path: 'relative.txt', isFile: true },
      { path: 'C:\\Test\\folder', isDirectory: true },
      null
    ] }, 'win32')).toEqual(['C:\\Test\\A.txt'])
    expect(extractFilePaths({ code: 'batch-rename-files', payload: 'bad' }, 'win32')).toEqual([])
  })

  it('新任务恢复默认状态；普通入口不产生替换任务', () => {
    const old = replaceTask([file('C:\\Old\\old.txt')], 'win32')
    const next = replaceTask([file('C:\\New\\new.txt')], 'win32')
    expect(old.files[0].currentName).toBe('old.txt')
    expect(next.files.map((item) => item.currentName)).toEqual(['new.txt'])
    expect(next.sortMode).toBe('name-asc')
    expect(next.activeModule).toBe('replace')
    expect(extractFilePaths({ code: 'batch-rename' }, 'win32')).toBeNull()
  })

  it('移除和清空只影响会话', () => {
    const session = replaceTask([file('C:\\A\\a.txt'), file('C:\\A\\b.txt')], 'win32')
    const reduced = removeFile(session, session.files[0].id)
    expect(reduced.files.map((item) => item.currentName)).toEqual(['b.txt'])
    expect(clearFiles(reduced).files).toEqual([])
    expect(session.files).toHaveLength(2)
    expect(createSession().files).toEqual([])
  })

  it('执行结果更新名称，但保留当前模块、排序和规则', () => {
    const session = replaceTask([file('C:\\A\\old.txt')], 'win32')
    session.activeModule = 'number'
    session.sortMode = 'size-desc'
    session.numberRule.prefix = '测试'
    const next = applyBatchResults(session, [{
      id: session.files[0].id, sourcePath: session.files[0].sourcePath,
      targetName: '测试1.txt', targetPath: 'C:\\A\\测试1.txt',
      actualPath: 'C:\\A\\测试1.txt', status: 'success'
    }], 'win32')
    expect(next.activeModule).toBe('number')
    expect(next.sortMode).toBe('size-desc')
    expect(next.numberRule.prefix).toBe('测试')
    expect(next.files[0].currentName).toBe('测试1.txt')
    expect(next.files[0].id).toBe(session.files[0].id)
  })

  it('执行错误不会永久阻止文件重新预览', () => {
    const session = replaceTask([file('C:\\A\\old.txt')], 'win32')
    const next = applyBatchResults(session, [{
      id: session.files[0].id, sourcePath: session.files[0].sourcePath,
      targetName: 'new.txt', targetPath: 'C:\\A\\new.txt',
      actualPath: 'C:\\A\\old.txt', status: 'error', error: '目标文件被占用'
    }], 'win32')
    expect(next.files[0].error).toBeUndefined()
    expect(next.files[0].currentName).toBe('old.txt')
  })
})

describe('基础预览', () => {
  it('按名称自然升序排列，目标名称不变，不修改源列表', () => {
    const session = replaceTask([file('C:\\A\\10.txt'), file('C:\\A\\2.txt')], 'win32')
    const preview = createPreview(session)
    expect(preview.map((item) => item.currentName)).toEqual(['2.txt', '10.txt'])
    expect(preview.map((item) => item.targetName)).toEqual(['2.txt', '10.txt'])
    expect(preview.map((item) => item.status)).toEqual(['unchanged', 'unchanged'])
    expect(session.files[0].currentName).toBe('10.txt')
  })

  it('逐项显示读取错误，其他文件仍可预览', () => {
    const session = replaceTask([
      file('C:\\A\\missing.txt', '源文件不存在'),
      file('C:\\A\\ok.txt')
    ], 'win32')
    const preview = createPreview(session)
    expect(preview[0]).toMatchObject({ status: 'error', errorMessage: '源文件不存在' })
    expect(preview[1]).toMatchObject({ status: 'unchanged', targetName: 'ok.txt' })
  })

  it('智能重命名界面不生成虚假的改名目标', () => {
    const session = replaceTask([file('C:\\A\\old.txt')], 'win32')
    session.activeModule = 'smart'
    expect(createPreview(session)[0]).toMatchObject({ targetName: 'old.txt', status: 'unchanged' })
  })

  it('一万文件的规则与排序预览可在主线程快速完成', () => {
    const infos = Array.from({ length: 10000 }, (_, index) => file(`C:\\Bulk\\file-${index}.txt`))
    const session = replaceTask(infos, 'win32')
    session.activeModule = 'replace'
    session.replaceRules[0].find = 'file-'
    session.replaceRules[0].replacement = 'item-'
    const started = performance.now()
    const result = createPreview(session)
    expect(result).toHaveLength(10000)
    expect(result[0].targetName).toBe('item-0.txt')
    expect(performance.now() - started).toBeLessThan(1500)
  })
})
