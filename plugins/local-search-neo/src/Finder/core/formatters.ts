/**
 * 格式化文件字节大小为人类易读的字符串（如：0 B、512 B、1.5 KB、20 MB 等）
 *
 * @param bytes - 文件大小字节数
 * @returns 带有最适合单位（B, KB, MB, GB, TB）的人类可读字符串
 */
export function formatBytes(bytes: number): string {
  if (Number.isNaN(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${formatNumber(value)} ${units[unitIndex]}`;
}

/**
 * 格式化数值输出，整数保留整数字符串，小数则固定保留一位小数
 *
 * @param value - 待格式化的数字
 * @returns 格式化后的数字字符串
 */
export function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}
