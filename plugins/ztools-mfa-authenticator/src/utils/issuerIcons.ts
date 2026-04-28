const issuerEmojiMap: Record<string, string> = {
  google: '🔍',
  github: '🐙',
  aws: '☁️',
  amazon: '☁️',
  microsoft: '🪟',
  apple: '🍎',
  facebook: '👤',
  meta: '👤',
  twitter: '🐦',
  x: '🐦',
  discord: '💬',
  slack: '💼',
  dropbox: '📦',
  steam: '🎮',
  cloudflare: '🌐',
  gitlab: '🦊',
  stripe: '💳',
  paypal: '💰',
}

/**
 * Get the emoji icon for a given issuer name.
 * Case-insensitive, matches if issuer includes the key.
 */
export function getIssuerIcon(issuer: string): string | null {
  const lower = issuer.toLowerCase()
  for (const [key, emoji] of Object.entries(issuerEmojiMap)) {
    if (lower.includes(key)) {
      return emoji
    }
  }
  return null
}

/**
 * Get a deterministic HSL color from a string hash.
 */
export function getIssuerColor(issuer: string): string {
  let hash = 0
  for (let i = 0; i < issuer.length; i++) {
    hash = issuer.charCodeAt(i) + ((hash << 5) - hash)
    hash = hash & hash // Convert to 32-bit int
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 60%, 55%)`
}
