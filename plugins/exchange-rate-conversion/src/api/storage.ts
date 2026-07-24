// 本地存储 - 收藏货币对 + 上次状态

const FAV_KEY = 'rate.favorites.v1'
const STATE_KEY = 'rate.lastState.v1'

export interface FavPair {
  from: string
  to: string
  /** 添加时间戳，用于排序 */
  ts: number
}

export interface LastState {
  from: string
  to: string
  amount: number
}

function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function safeWrite(key: string, val: string) {
  try {
    localStorage.setItem(key, val)
  } catch {
    /* ignore quota errors */
  }
}

export function getFavorites(): FavPair[] {
  const raw = safeRead(FAV_KEY)
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((x) => x && x.from && x.to)
  } catch {
    return []
  }
}

export function saveFavorites(list: FavPair[]) {
  safeWrite(FAV_KEY, JSON.stringify(list))
}

export function isFavorited(list: FavPair[], from: string, to: string): boolean {
  return list.some((f) => f.from === from && f.to === to)
}

export function toggleFavorite(list: FavPair[], from: string, to: string): FavPair[] {
  if (isFavorited(list, from, to)) {
    return list.filter((f) => !(f.from === from && f.to === to))
  }
  const next = [...list, { from, to, ts: Date.now() }]
  return next
}

export function getLastState(): LastState | null {
  const raw = safeRead(STATE_KEY)
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    if (typeof obj?.from !== 'string' || typeof obj?.to !== 'string') return null
    return { from: obj.from, to: obj.to, amount: Number(obj.amount) || 1 }
  } catch {
    return null
  }
}

export function saveLastState(s: LastState) {
  safeWrite(STATE_KEY, JSON.stringify(s))
}
