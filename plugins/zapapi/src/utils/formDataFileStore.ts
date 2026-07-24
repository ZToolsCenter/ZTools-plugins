const filesByToken = new Map<string, File>()

function generateToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function ensureFileToken(token?: string): string {
  if (token) return token
  return generateToken()
}

export function setFormDataFile(token: string, file: File): void {
  filesByToken.set(token, file)
}

export function getFormDataFile(token?: string): File | undefined {
  if (!token) return undefined
  return filesByToken.get(token)
}

export function clearFormDataFile(token?: string): void {
  if (!token) return
  filesByToken.delete(token)
}
