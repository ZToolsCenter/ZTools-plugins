import type { CryptResult } from '../types/crypt'

export function runCodec<T = string>(fn: () => CryptResult<T>): CryptResult<T> {
  try {
    return fn()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '计算失败' }
  }
}

export function showError<T>(result: CryptResult<T>): string {
  if (result.ok) return ''
  return result.error
}

export function showData<T>(result: CryptResult<T>): T extends string ? string : T {
  if (!result.ok) return '' as any
  return result.data as any
}
