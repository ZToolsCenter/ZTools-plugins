import { describe, expect, it } from 'vitest'
import { buildSmartMessages, parseSmartNames } from './smart'
import { createPreview } from './preview'
import { appendFiles, clearFiles, removeFile, replaceTask } from './session'

const session = replaceTask([
  { path: 'C:\\Photos\\a.jpg', name: 'a.jpg', size: 12 },
  { path: 'C:\\Photos\\b.jpg', name: 'b.jpg', size: 34 }
], 'win32')

describe('智能重命名', () => {
  it('只将文件元数据和用户指令发给模型，解析后进入正常预览', () => {
    const messages = buildSmartMessages(session.files, '改成旅行照片')
    expect(JSON.parse(messages[1].content).files).toEqual([
      { id: 0, name: 'a.jpg', size: 12 }, { id: 1, name: 'b.jpg', size: 34 }
    ])
    const names = parseSmartNames('```json\n[{"id":1,"name":"旅行2.jpg"},{"id":0,"name":"旅行1.jpg"}]\n```', session.files)
    const preview = createPreview({ ...session, activeModule: 'smart', smartNames: names })
    expect(preview.map((item) => [item.targetName, item.status])).toEqual([
      ['旅行1.jpg', 'ready'], ['旅行2.jpg', 'ready']
    ])
  })

  it.each([
    ['缺项', '[{"id":0,"name":"x.jpg"}]'],
    ['重复编号', '[{"id":0,"name":"x.jpg"},{"id":0,"name":"y.jpg"}]'],
    ['路径', '[{"id":0,"name":"../x.jpg"},{"id":1,"name":"y.jpg"}]'],
    ['改扩展名', '[{"id":0,"name":"x.png"},{"id":1,"name":"y.jpg"}]'],
    ['无效响应', '不是 JSON']
  ])('%s不会进入预览', (_, response) => {
    expect(() => parseSmartNames(response, session.files)).toThrow()
  })

  it('文件集合变化后清除旧候选名', () => {
    const named = { ...session, smartNames: { [session.files[0].id]: '旅行1.jpg' } }
    expect(removeFile(named, session.files[1].id).smartNames).toEqual({})
    expect(clearFiles(named).smartNames).toEqual({})
    expect(appendFiles(named, [{ path: 'C:\\Photos\\c.jpg', name: 'c.jpg' }], 'win32').smartNames).toEqual({})
  })
})
