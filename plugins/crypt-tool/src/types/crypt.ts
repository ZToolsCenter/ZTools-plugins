export type CryptResult<T = string> = { ok: true; data: T } | { ok: false; error: string }
