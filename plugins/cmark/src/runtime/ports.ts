/**
 * runtime —— 端口装配与解析
 *
 * 全项目只有这里保存「当前平台的实现」。
 * 装配点只有各端入口：apps/<平台>/boot.ts。
 *
 * 为什么用可变单例而不是 React Context：
 *  - preload 注入的面板（非 React 树）也要读端口
 *  - core 里的 services 不是组件，拿不到 Context
 */
import type { Ports } from '../contracts/index'

let current: Ports | null = null
const listeners = new Set<(p: Ports) => void>()

/** 装配端口。重复装配会覆盖并通知订阅者（便于测试与热替换） */
export function installPorts(ports: Ports): void {
  current = ports
  listeners.forEach((fn) => {
    try {
      fn(ports)
    } catch (e) {
      console.error('[cmark] ports listener failed', e)
    }
  })
}

/** 装配前访问会抛错：宁可启动即失败，也不要静默走空实现 */
export function getPorts(): Ports {
  if (!current) {
    throw new Error('runtime 未装配：请先在入口调用 installPorts(createXxxPorts())')
  }
  return current
}

/** 允许在可选的场景里探测（如浏览器预览、单元测试） */
export function hasPorts(): boolean {
  return current !== null
}

export function tryGetPorts(): Ports | null {
  return current
}

/** 订阅装配变化（热替换 / 测试替身） */
export function onPortsChange(fn: (p: Ports) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 仅供测试使用 */
export function resetPortsForTest(): void {
  current = null
}