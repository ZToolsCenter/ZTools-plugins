import { describe, expect, test } from 'bun:test'
import { describeAggressiveAiSaveProviderError } from '../../src/services/aggressiveAiSaveErrors'

describe('AI 保存错误说明', () => {
  test('鉴权失败不会被误判为模型错误', () => {
    const error = describeAggressiveAiSaveProviderError(new Error('401 Invalid API key sk-secret123456'))
    expect(error.message).toBe('AI 服务鉴权失败')
    expect(error.detail).toContain('API Key 无效')
    expect(error.detail).not.toContain('sk-secret123456')
  })

  test('区分限流、网络和结构化输出失败', () => {
    expect(describeAggressiveAiSaveProviderError(new Error('429 rate limit exceeded')).message)
      .toBe('AI 请求受到限制')
    expect(describeAggressiveAiSaveProviderError(new Error('fetch failed: CORS')).message)
      .toBe('无法连接 AI 服务')
    expect(describeAggressiveAiSaveProviderError(new Error('No object generated: JSON schema unsupported')).message)
      .toBe('AI 返回内容格式不正确')
  })

  test('未知错误保留安全诊断并给出恢复动作', () => {
    const error = describeAggressiveAiSaveProviderError(new Error('upstream gateway closed unexpectedly'))
    expect(error.message).toBe('AI 快速保存失败')
    expect(error.detail).toBe('upstream gateway closed unexpectedly')
    expect(error.recovery).toContain('检查 AI 设置')
  })
})
