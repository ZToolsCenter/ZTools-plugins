/**
 * PrefsPort —— 配置读写
 *
 * 分层原则（沿用现状，别改）：
 *  - app / ui / git：这台机器的偏好（界面字号、git 设置、引导标记）
 *  - workspace：属于这库笔记的属性，落在 <仓库根>/.cmark/，随 git 提交
 *
 * 禁用 localStorage 作为唯一来源：插件页面从 file:// 加载时 setItem 会抛
 * SecurityError，被 try/catch 吞掉后表现为「设置点了没保存」。
 */
import type { Result, Unsubscribe } from './result'

export type PrefNs = 'app' | 'ui' | 'git' | 'workspace'

export type PrefValue = string | number | boolean | null | PrefValue[] | { [k: string]: PrefValue }

export interface PrefsPort {
  get<T extends PrefValue = PrefValue>(ns: PrefNs, key: string): Promise<T | undefined>
  set(ns: PrefNs, key: string, value: PrefValue): Promise<Result<void>>
  patch(ns: PrefNs, obj: Record<string, PrefValue>): Promise<Result<void>>
  all(ns: PrefNs): Promise<Record<string, PrefValue>>
  /** 任一项变化时回调；用于让设置面板与界面读同一个源 */
  onChange(ns: PrefNs, cb: () => void): Unsubscribe
}