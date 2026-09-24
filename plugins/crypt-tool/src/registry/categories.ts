import type { CategoryId } from './types'

export interface CategoryDef {
  id: CategoryId
  label: string
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'encoding', label: '编码转换' },
  { id: 'hash', label: '哈希摘要' },
  { id: 'symmetric', label: '对称加密' },
  { id: 'asymmetric', label: '非对称加密' },
  { id: 'hmac', label: '消息认证' },
  { id: 'kdf', label: '口令派生' },
  { id: 'tools', label: '工具与实用' }
]

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id
}
