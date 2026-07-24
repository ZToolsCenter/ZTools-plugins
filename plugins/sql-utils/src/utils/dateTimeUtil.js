/*日期时间类工具类*/
import dayjs from 'dayjs'

/**
 * 随机日期
 * @param startDate
 * @param endDate
 * @param format
 * @returns {*}
 */
export function randomDate(startDate, endDate, format) {
  // 解析起始日期和结束日期
  const start = dayjs(startDate);
  const end = dayjs(endDate);

  // 确保开始日期不晚于结束日期
  if (start.isAfter(end)) {
    return '开始日期不能晚于结束日期';
  }

  // 计算两个日期之间的毫秒差值
  const startTimestamp = start.valueOf();
  const endTimestamp = end.valueOf();
  const timeDiff = endTimestamp - startTimestamp;

  // 生成0到时间差之间的随机数（包含两端）
  const randomDiff = Math.random() * timeDiff;

  // 计算随机日期并格式化
  const randomDate = dayjs(startTimestamp + randomDiff);
  return randomDate.format(format);
}

/**
 * 随机时间戳
 * @param startDate
 * @param endDate
 * @returns {number}
 */
export function randomTimestamp(startDate, endDate) {
  // 将传入的日期对象转换为对应的时间戳
  const start = dayjs(startDate).valueOf();
  const end = dayjs(endDate).valueOf();
  // 生成一个在 start 到 end 之间的随机数
  return Math.floor(Math.random() * (end - start + 1)) + start;
}
