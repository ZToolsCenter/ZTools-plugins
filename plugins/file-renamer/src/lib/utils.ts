import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 工具函数，使用clsx合并类值并使用twMerge合并冲突的Tailwind类。
 * @param inputs - 要合并的类值
 * @returns 合并后的类字符串
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
