/**
 * 日期处理工具函数
 */

/**
 * 格式化日期为 YYYY-MM-DD 格式
 * @param date 日期对象
 * @returns 格式化后的日期字符串
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化周范围（如 "1月15-21日"）
 * @param startDate 周起始日期（周一）
 * @returns 格式化后的周范围字符串
 */
export function formatWeekRange(startDate: Date): string {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);

  const startMonth = startDate.getMonth() + 1;
  const startDay = startDate.getDate();
  const endDay = endDate.getDate();

  return `${startMonth}月${startDay}-${endDay}日`;
}

/**
 * 格式化月份（如 "2024年1月"）
 * @param date 日期对象
 * @returns 格式化后的月份字符串
 */
export function formatMonth(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return `${year}年${month}月`;
}

/**
 * 判断日期是否已过期（早于今天）
 * @param date YYYY-MM-DD 格式的日期字符串
 * @returns 是否已过期
 */
export function isOverdue(date: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [year, month, day] = date.split('-').map(Number);
  const targetDate = new Date(year, month - 1, day);
  targetDate.setHours(0, 0, 0, 0);

  return targetDate < today;
}

/**
 * 判断日期是否是今天
 * @param date YYYY-MM-DD 格式的日期字符串
 * @returns 是否是今天
 */
export function isToday(date: string): boolean {
  const today = new Date();
  const todayStr = formatDate(today);
  return date === todayStr;
}

/**
 * 判断日期是否在本周（周一到周日）
 * @param date YYYY-MM-DD 格式的日期字符串
 * @returns 是否在本周
 */
export function isThisWeek(date: string): boolean {
  const today = new Date();
  const weekStart = getWeekStart(today);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const [year, month, day] = date.split('-').map(Number);
  const targetDate = new Date(year, month - 1, day);
  targetDate.setHours(0, 0, 0, 0);

  return targetDate >= weekStart && targetDate <= weekEnd;
}

/**
 * 获取指定日期所在周的周一
 * @param date 日期对象
 * @returns 周一的日期对象
 */
export function getWeekStart(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * 生成唯一ID
 * @returns UUID 格式的唯一ID
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
