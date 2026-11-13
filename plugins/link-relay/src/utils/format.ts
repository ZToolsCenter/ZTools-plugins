/** 通用格式化纯函数：无状态、无 IO，可在任意层复用。 */

/** 字节数 → 人类可读（0/负数显示 —） */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

/** 把逗号/分号/换行分隔的文本解析为去空字符串数组（进程名、缓存目录名等） */
export function parseLineList(text: string): string[] {
  return text
    .split(/[,，;；\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
