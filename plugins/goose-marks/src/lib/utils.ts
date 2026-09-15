import type { ClassValue } from "clsx"
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getTemplateLabel(url: string): string {
  const label = (url.match(/{([^}]+)}/)?.[1] ?? '').trim()
  return label || '搜索内容'
}

const COMMON_SECOND_LEVEL_SUFFIXES = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'gov',
  'mil',
  'net',
  'org',
])

const ensureProtocol = (url: string) => {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

const isIpv4Host = (hostname: string) => {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
}

const getPrimaryHostname = (hostname: string) => {
  if (!hostname || hostname === 'localhost' || isIpv4Host(hostname)) {
    return hostname
  }

  const parts = hostname.split('.').filter(Boolean)
  if (parts.length <= 2) return hostname

  const last = parts[parts.length - 1]
  const secondLast = parts[parts.length - 2]
  const useThreeParts = last.length === 2 && COMMON_SECOND_LEVEL_SUFFIXES.has(secondLast)

  return parts.slice(useThreeParts ? -3 : -2).join('.')
}

export function getTemplateFallbackUrl(rawUrl: string): string | null {
  const input = rawUrl.trim()
  if (!input) return null

  try {
    const url = new URL(ensureProtocol(input))
    const queryIndex = input.indexOf('?')
    const templateIndex = input.indexOf('{')

    if (queryIndex !== -1 && templateIndex > queryIndex) {
      const hostname = getPrimaryHostname(url.hostname)
      return `${url.protocol}//${hostname}`
    }

    return url.origin
  } catch {
    return null
  }
}

export function resolveBookmarkLaunchUrl(rawUrl: string, query = ''): string | null {
  const input = rawUrl.trim()
  if (!input) return null

  const trimmedQuery = query.trim()
  const hasTemplate = /{[^}]+}/.test(input)

  if (hasTemplate) {
    if (trimmedQuery) {
      const resolved = input.replace(/{[^}]+}/g, encodeURIComponent(trimmedQuery))
      return ensureProtocol(resolved)
    }

    return getTemplateFallbackUrl(input)
  }

  return ensureProtocol(input)
}
