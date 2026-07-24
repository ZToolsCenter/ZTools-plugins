import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fileExt(p: string): string {
  const m = p.match(/\.([^.]+)$/)
  return m ? m[1].toLowerCase() : ''
}