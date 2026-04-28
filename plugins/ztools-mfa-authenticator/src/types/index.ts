export interface AccountRecord {
  _id: string
  data: AccountData
}

export type OtpType = 'totp' | 'hotp' | 'steam'

export interface AccountData {
  id: string
  issuer: string
  label: string
  encryptedSecret: string
  iv: string
  algorithm: 'SHA1' | 'SHA256' | 'SHA512'
  digits: 5 | 6 | 8
  period: number
  type: OtpType
  counter: number
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface Account {
  id: string
  issuer: string
  label: string
  secret: string
  algorithm: 'SHA1' | 'SHA256' | 'SHA512'
  digits: 5 | 6 | 8
  period: number
  type: OtpType
  counter: number
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface TotpDisplay {
  code: string
  nextCode: string
  remaining: number
  period: number
  isHotp: boolean
}

export interface EncryptionKeyMeta {
  salt: string
  keyCheckValue: string
  iv: string
}

export interface AccountInput {
  issuer: string
  label: string
  secret: string
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512'
  digits?: 5 | 6 | 8
  period?: number
  type?: OtpType
  counter?: number
}

export interface ExportPayload {
  version: 1 | 2
  accounts: AccountInput[]
}
