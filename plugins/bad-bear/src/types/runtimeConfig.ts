import type { AuthUser } from './auth'

export interface ShopApiRuntimeConfig {
  baseUrl: string
  token: string
  currentUser: AuthUser | null
}
