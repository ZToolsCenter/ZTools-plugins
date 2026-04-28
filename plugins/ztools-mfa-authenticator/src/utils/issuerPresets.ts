export interface IssuerPreset {
  algorithm: 'SHA1' | 'SHA256' | 'SHA512'
  digits: number
  period: number
  type?: 'steam'
}

const presets: Record<string, IssuerPreset> = {
  google: { algorithm: 'SHA1', digits: 6, period: 30 },
  github: { algorithm: 'SHA1', digits: 6, period: 30 },
  aws: { algorithm: 'SHA1', digits: 6, period: 30 },
  amazon: { algorithm: 'SHA1', digits: 6, period: 30 },
  microsoft: { algorithm: 'SHA1', digits: 6, period: 30 },
  facebook: { algorithm: 'SHA1', digits: 6, period: 30 },
  meta: { algorithm: 'SHA1', digits: 6, period: 30 },
  apple: { algorithm: 'SHA1', digits: 6, period: 30 },
  discord: { algorithm: 'SHA1', digits: 6, period: 30 },
  slack: { algorithm: 'SHA1', digits: 6, period: 30 },
  dropbox: { algorithm: 'SHA1', digits: 6, period: 30 },
  cloudflare: { algorithm: 'SHA1', digits: 6, period: 30 },
  gitlab: { algorithm: 'SHA1', digits: 6, period: 30 },
  stripe: { algorithm: 'SHA1', digits: 6, period: 30 },
  paypal: { algorithm: 'SHA1', digits: 6, period: 30 },
  twitter: { algorithm: 'SHA1', digits: 6, period: 30 },
  steam: { algorithm: 'SHA1', digits: 5, period: 30, type: 'steam' },
}

export function getIssuerPreset(issuer: string): IssuerPreset | null {
  const lower = issuer.toLowerCase().trim()
  for (const [key, preset] of Object.entries(presets)) {
    if (lower === key || lower.includes(key)) return preset
  }
  return null
}
