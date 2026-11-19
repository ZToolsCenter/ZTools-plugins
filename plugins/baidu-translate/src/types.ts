/**
 * 全局类型定义。
 *
 * @author yhx
 */

/** 已保存凭证（preload 只回 appId 与"是否已填密钥"，secretKey 永不外传） */
export interface CredsInfo {
  appId: string
  hasSecret: boolean
}

/** 保存凭证的返回 */
export interface SaveResult {
  ok: boolean
  reason?: 'APPID_REQUIRED' | 'SECRET_REQUIRED' | 'ENCRYPT_FAIL'
}

/** 翻译结果条目（dict 为百度词典数据，仅单词/词组查询且开通词典资源时返回） */
export interface TransItem {
  src: string
  dst: string
  dict?: unknown
}

/** 翻译结果（preload.translate 的返回，统一在这层消费） */
export interface TranslateResult {
  ok: boolean
  code?: string
  /** 网络类错误的真实原因（DNS/代理/HTTP 状态等），给错误提示拼接用 */
  msg?: string
  from?: string
  to?: string
  items?: TransItem[]
}

/** 界面上的一条语言选项 */
export interface LangOption {
  code: string
  name: string
}

/** 历史记录条目（存最近翻译，点击可回看重翻） */
export interface HistoryItem {
  id: string
  time: number
  text: string
  result: TranslateResult
}
