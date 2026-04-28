import * as XLSX from 'xlsx'
import { deriveKey, encrypt, decrypt, generateSalt, toBase64, fromBase64 } from './crypto'
import type { AccountInput } from '@/types'

const HEADERS = ['issuer', 'label', 'secret', 'algorithm', 'digits', 'period', 'type', 'counter'] as const
const base32Regex = /^[A-Z2-7]+=*$/i

interface EncryptedEnvelope {
  version: 1
  encrypted: true
  format: 'txt' | 'csv' | 'json' | 'xlsx'
  salt: string
  iv: string
  data: string
}

// ─── Serialize ───

export function serializeToTxt(accounts: AccountInput[]): string {
  return accounts
    .map((a) => [a.issuer, a.label, a.secret, a.algorithm ?? 'SHA1', a.digits ?? 6, a.period ?? 30, a.type ?? 'totp', a.counter ?? 0].join(':'))
    .join('\n')
}

export function serializeToCsv(accounts: AccountInput[]): string {
  const header = HEADERS.join(',')
  const rows = accounts.map((a) =>
    [a.issuer, a.label, a.secret, a.algorithm ?? 'SHA1', a.digits ?? 6, a.period ?? 30, a.type ?? 'totp', a.counter ?? 0]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  )
  return [header, ...rows].join('\n')
}

export function serializeToJson(accounts: AccountInput[]): string {
  return JSON.stringify(
    {
      version: 2,
      encrypted: false,
      accounts: accounts.map((a) => ({
        issuer: a.issuer,
        label: a.label,
        secret: a.secret,
        algorithm: a.algorithm ?? 'SHA1',
        digits: a.digits ?? 6,
        period: a.period ?? 30,
        type: a.type ?? 'totp',
        counter: a.counter ?? 0,
      })),
    },
    null,
    2,
  )
}

export function serializeToExcel(accounts: AccountInput[]): Uint8Array {
  const data = accounts.map((a) => ({
    issuer: a.issuer,
    label: a.label,
    secret: a.secret,
    algorithm: a.algorithm ?? 'SHA1',
    digits: a.digits ?? 6,
    period: a.period ?? 30,
    type: a.type ?? 'totp',
    counter: a.counter ?? 0,
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'MFA Accounts')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

// ─── Parse ───

function normalizeAccount(raw: Record<string, any>): AccountInput | null {
  const issuer = String(raw.issuer ?? '').trim()
  const label = String(raw.label ?? '').trim()
  const secret = String(raw.secret ?? '').replace(/\s/g, '')
  if (!issuer || !label || !secret) return null
  if (!base32Regex.test(secret)) return null

  const algo = String(raw.algorithm ?? 'SHA1').toUpperCase()
  const validAlgo = (['SHA1', 'SHA256', 'SHA512'] as const).includes(algo as any)
    ? (algo as 'SHA1' | 'SHA256' | 'SHA512')
    : 'SHA1'
  const rawDigits = Number(raw.digits)
  const digits = rawDigits === 5 ? 5 : rawDigits === 8 ? 8 : 6
  const period = Number(raw.period) || 30

  const rawType = String(raw.type ?? 'totp').toLowerCase()
  const type = rawType === 'hotp' ? 'hotp' as const : rawType === 'steam' ? 'steam' as const : 'totp' as const
  const counter = Number(raw.counter) || 0

  return { issuer, label, secret, algorithm: validAlgo, digits: digits as 5 | 6 | 8, period, type, counter }
}

export function parseFromTxt(content: string): AccountInput[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [issuer, label, secret, algorithm, digits, period, type, counter] = line.split(':')
      return normalizeAccount({ issuer, label, secret, algorithm, digits, period, type, counter })
    })
    .filter((a): a is AccountInput => a !== null)
}

export function parseFromCsv(content: string): AccountInput[] {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []

  const parseCsvLine = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase())
  return lines
    .slice(1)
    .map((line) => {
      const values = parseCsvLine(line)
      const obj: Record<string, string> = {}
      header.forEach((h, i) => { obj[h] = values[i] ?? '' })
      return normalizeAccount(obj)
    })
    .filter((a): a is AccountInput => a !== null)
}

export function parseFromJson(content: string): AccountInput[] {
  const parsed = JSON.parse(content)
  const accounts = Array.isArray(parsed) ? parsed : parsed.accounts
  if (!Array.isArray(accounts)) return []
  return accounts.map(normalizeAccount).filter((a): a is AccountInput => a !== null)
}

export function parseFromExcel(buffer: ArrayBuffer): AccountInput[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws)
  return rows.map(normalizeAccount).filter((a): a is AccountInput => a !== null)
}

// ─── Encrypt / Decrypt Export ───

export async function encryptExport(
  content: string | Uint8Array,
  password: string,
  format: 'txt' | 'csv' | 'json' | 'xlsx',
): Promise<string> {
  const salt = generateSalt()
  const key = await deriveKey(password, salt)
  const plaintext = content instanceof Uint8Array ? toBase64(content.buffer as ArrayBuffer) : content
  const { ciphertext, iv } = await encrypt(key, plaintext)

  const envelope: EncryptedEnvelope = {
    version: 1,
    encrypted: true,
    format,
    salt: toBase64(salt.buffer as ArrayBuffer),
    iv,
    data: ciphertext,
  }
  return JSON.stringify(envelope)
}

export async function decryptImport(
  envelopeStr: string,
  password: string,
): Promise<{ content: string; format: string; isBinary: boolean }> {
  const envelope: EncryptedEnvelope = JSON.parse(envelopeStr)
  if (!envelope.encrypted) throw new Error('File is not encrypted')

  const salt = new Uint8Array(fromBase64(envelope.salt))
  const key = await deriveKey(password, salt)
  const plaintext = await decrypt(key, envelope.data, envelope.iv)

  return {
    content: plaintext,
    format: envelope.format,
    isBinary: envelope.format === 'xlsx',
  }
}

// ─── Detection ───

export function detectEncrypted(content: string): boolean {
  try {
    const parsed = JSON.parse(content)
    return parsed?.encrypted === true && (parsed?.version === 1 || parsed?.version === 2)
  } catch {
    return false
  }
}

export function detectFormat(filename: string): 'txt' | 'csv' | 'json' | 'xlsx' | 'mfa' {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'csv') return 'csv'
  if (ext === 'json') return 'json'
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx'
  if (ext === 'mfa') return 'mfa'
  return 'txt'
}

export function parseByFormat(content: string, format: string): AccountInput[] {
  switch (format) {
    case 'txt': return parseFromTxt(content)
    case 'csv': return parseFromCsv(content)
    case 'json': return parseFromJson(content)
    default: return parseFromTxt(content)
  }
}

// ─── Download Helper ───

export function downloadFile(content: string | Uint8Array, filename: string) {
  const blob = content instanceof Uint8Array
    ? new Blob([content], { type: 'application/octet-stream' })
    : new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
