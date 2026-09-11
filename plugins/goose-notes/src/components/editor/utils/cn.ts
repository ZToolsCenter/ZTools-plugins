import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 编辑器包私有的极轻量 className 合并工具。
 * 与 `@/lib/utils` 的 `cn` 等价，但不携带 app 层的平台/快捷键辅助，
 * 保证编辑器内核自包含、不反向依赖宿主。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
