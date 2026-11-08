import { describe, expect, it } from 'vitest'
import { extractVariables, getMissingRequiredVariables, renderVariables, resolveVariableValues, syncVariablesFromContent } from './index'

describe('变量解析与渲染', () => {
  it('同时支持双花括号和美元花括号语法', () => {
    const template = '你是 {{role=工程师}}，请处理 ${topic}。'

    expect(extractVariables(template)).toEqual([
      { name: 'role', required: false, defaultValue: '工程师' },
      { name: 'topic', required: true, defaultValue: undefined },
    ])
    expect(renderVariables(template, { role: '设计师', topic: '导入流程' }))
      .toBe('你是 设计师，请处理 导入流程。')
  })

  it('支持中文变量名', () => {
    const template = '请以 {{角色=产品经理}} 的身份，对 {{需求描述}} 进行评审。'

    expect(extractVariables(template)).toEqual([
      { name: '角色', required: false, defaultValue: '产品经理' },
      { name: '需求描述', required: true, defaultValue: undefined },
    ])
    expect(renderVariables(template, { 角色: '架构师', 需求描述: '用户登录模块' }))
      .toBe('请以 架构师 的身份，对 用户登录模块 进行评审。')
  })

  it('忽略括号不匹配的变量语法', () => {
    const template = '错误示例：{{role} 和 ${topic}}，正确示例：{{language}}。'

    expect(extractVariables(template)).toEqual([
      { name: 'language', required: true, defaultValue: undefined },
    ])
    expect(renderVariables(template, { role: '工程师', topic: '导入', language: '中文' }))
      .toBe('错误示例：{{role} 和 ${topic}}，正确示例：中文。')
  })
})

describe('正文变量同步', () => {
  it('删除正文变量后不再保留旧配置，并继承同名变量设置', () => {
    const existing = [
      { name: 'role', required: false, defaultValue: '架构师' },
      { name: 'removed', required: true, defaultValue: '' },
    ]

    expect(syncVariablesFromContent('请以 {{role}} 的身份处理任务。', existing)).toEqual([
      { name: 'role', required: false, defaultValue: '架构师' },
    ])
  })
})

describe('变量实际生效值', () => {
  it.each([
    { title: '必填且无默认值时仍缺少内容', variable: { name: 'value', required: true }, input: '', expected: '', missing: true },
    { title: '必填且有默认值时默认值满足必填', variable: { name: 'value', required: true, defaultValue: '默认内容' }, input: ' ', expected: '默认内容', missing: false },
    { title: '可选且无默认值时替换为空', variable: { name: 'value', required: false }, input: '', expected: '', missing: false },
    { title: '可选且有默认值时留空使用默认值', variable: { name: 'value', required: false, defaultValue: '默认内容' }, input: '', expected: '默认内容', missing: false },
  ])('$title', ({ variable, input, expected, missing }) => {
    expect(resolveVariableValues([variable], { value: input })).toEqual({ value: expected })
    expect(getMissingRequiredVariables([variable], { value: input })).toHaveLength(missing ? 1 : 0)
  })

  it('非空白用户输入优先于默认值，并保留原始空格和换行', () => {
    const variable = { name: 'content', required: true, defaultValue: '默认内容' }
    const input = '  用户内容\n'

    expect(resolveVariableValues([variable], { content: input })).toEqual({ content: input })
    expect(getMissingRequiredVariables([variable], { content: input })).toEqual([])
  })
})
