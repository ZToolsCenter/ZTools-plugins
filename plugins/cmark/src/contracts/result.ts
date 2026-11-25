/**
 * 通用结果类型
 *
 * 约定：所有端口都返回结构化结果，不抛平台异常给上层。
 * 失败用 `{ ok: false, code, message }`，让 UI 决定文案，适配器只管分类。
 */

export type ErrorCode =
  | 'auth' // 令牌无效 / 用户名不匹配 / 401 403
  | 'network' // 连不上、超时、DNS
  | 'nonfastforward' // 远端有本地没有的提交
  | 'conflict' // 内容冲突
  | 'lock' // index.lock 等锁文件
  | 'notrepo' // 工作区不是 git 仓库
  | 'notfound' // 文件 / 提交不存在
  | 'permission' // 文件权限
  | 'unsupported' // 当前平台不具备该能力
  | 'canceled' // 用户取消
  | 'unknown'

export interface Ok<T = void> {
  ok: true
  value: T
}

export interface Fail {
  ok: false
  code: ErrorCode
  message: string
  /** 适配器原始错误，仅用于日志，不直接展示 */
  detail?: string
}

export type Result<T = void> = Ok<T> | Fail

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const fail = (code: ErrorCode, message: string, detail?: string): Fail => ({ ok: false, code, message, detail })

/** 取消订阅 / 解绑 */
export type Unsubscribe = () => void