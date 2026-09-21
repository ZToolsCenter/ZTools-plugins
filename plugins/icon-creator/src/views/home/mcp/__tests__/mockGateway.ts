import { vi } from 'vitest'
import type { McpEditorGateway } from '../mcpGatewayTypes'

/**
 * 创建编辑器网关的测试替身（Mock 工厂）。
 *
 * McpEditorGateway 接口方法多达数十个，逐一手写 mock 成本过高：
 * 这里基于 Proxy 惰性自动补齐未配置的方法——每个方法名首次访问时
 * 创建并缓存一个 vi.fn(() => undefined)，保证多次访问拿到的是同一个 mock 实例；
 * 显式传入的 overrides（vi.fn 或普通值）优先级最高，
 * 用于注入需要断言调用参数与次数的方法，或提供特定返回值。
 *
 * @param overrides 按需覆盖的网关方法/属性（键名与 McpEditorGateway 一致），未覆盖项自动补齐
 * @returns 类型为 McpEditorGateway 的测试网关，可直接包在 provider 中使用：
 *          `dispatchMcpOperation(() => createMockGateway({ addShape }), input)`
 */
export function createMockGateway(overrides: Partial<McpEditorGateway> = {}): McpEditorGateway {
  /** 自动补齐方法的缓存：同一方法名只创建一次 vi.fn，避免断言时实例不一致。 */
  const autoFilled = new Map<string, unknown>()
  const target: Record<string, unknown> = { ...overrides }
  return new Proxy(target, {
    get(current, prop) {
      // 显式覆盖优先返回；symbol 键（如 Symbol.toStringTag 等内部访问）不参与方法补齐
      if (Object.prototype.hasOwnProperty.call(current, prop)) {
        return current[prop as string]
      }
      if (typeof prop !== 'string') return undefined
      if (!autoFilled.has(prop)) {
        autoFilled.set(prop, vi.fn(() => undefined))
      }
      return autoFilled.get(prop)
    }
  }) as unknown as McpEditorGateway
}
