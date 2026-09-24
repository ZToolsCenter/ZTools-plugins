import { describe, expect, it } from 'vitest'
import { extractVariables, renderVariables } from './index'

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
})
