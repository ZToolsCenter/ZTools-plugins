import { URI, HOTP } from 'otpauth'
import type { AccountInput } from '@/types'

export function parseOtpauthUri(uri: string): AccountInput | null {
  try {
    const parsed = URI.parse(uri.trim())

    const issuer = parsed.issuer || ''
    const label = parsed.label || ''
    const secret = parsed.secret.base32

    if (!secret) {
      return null
    }

    const algorithm = (['SHA1', 'SHA256', 'SHA512'] as const).includes(
      parsed.algorithm as any,
    )
      ? (parsed.algorithm as 'SHA1' | 'SHA256' | 'SHA512')
      : undefined

    const digits =
      parsed.digits === 6 || parsed.digits === 8
        ? (parsed.digits as 6 | 8)
        : undefined

    const isHotp = parsed instanceof HOTP

    const period =
      !isHotp && 'period' in parsed && typeof (parsed as any).period === 'number'
        ? (parsed as any).period
        : undefined

    const counter = isHotp ? (parsed as HOTP).counter : undefined

    return {
      issuer,
      label,
      secret,
      algorithm,
      digits,
      period,
      type: isHotp ? 'hotp' : 'totp',
      counter,
    }
  } catch {
    return null
  }
}
