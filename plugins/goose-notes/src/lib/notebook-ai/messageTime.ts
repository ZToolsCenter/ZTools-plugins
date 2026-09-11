/** 相邻消息间隔达到该值才再显示时间分隔条（微信风格） */
export const CHAT_TIME_GAP_MS = 5 * 60 * 1000;

const WEEKDAY_LABELS = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
] as const;

type MessageWithCreatedAt = {
  metadata?: { createdAt?: number };
};

function startOfLocalDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatHm(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function getMessageCreatedAt(
  message: MessageWithCreatedAt,
): number | undefined {
  const value = message.metadata?.createdAt;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * 微信风格时间文案；无效时间返回 ""。
 * - 今天：HH:mm
 * - 昨天：昨天 HH:mm
 * - 昨天之前且 7 天内：星期X HH:mm
 * - 同年更早：M月D日 HH:mm
 * - 跨年：YYYY年M月D日 HH:mm
 */
export function formatChatMessageTime(
  timestamp: number,
  now?: number | Date,
): string {
  if (!Number.isFinite(timestamp)) return "";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const nowDate = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(nowDate.getTime())) return "";

  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = startOfLocalDay(nowDate);
  const msgDayStart = startOfLocalDay(date);
  const dayDiff = Math.round((todayStart - msgDayStart) / dayMs);
  const hm = formatHm(date);

  if (dayDiff === 0) return hm;
  if (dayDiff === 1) return `昨天 ${hm}`;
  if (dayDiff >= 2 && dayDiff < 7) {
    return `${WEEKDAY_LABELS[date.getDay()]} ${hm}`;
  }
  if (date.getFullYear() === nowDate.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
}

/**
 * 是否在本条消息上方展示时间分隔。
 * - current 无 createdAt → false
 * - 无 previous 或 previous 无 createdAt → true
 * - gap >= 5min → true
 */
export function shouldShowChatTimeDivider(
  current: MessageWithCreatedAt,
  previous: MessageWithCreatedAt | null | undefined,
): boolean {
  const currentAt = getMessageCreatedAt(current);
  if (currentAt === undefined) return false;

  if (!previous) return true;
  const previousAt = getMessageCreatedAt(previous);
  if (previousAt === undefined) return true;

  return currentAt - previousAt >= CHAT_TIME_GAP_MS;
}

/** 为缺少 createdAt 的消息补上时间戳（不覆盖已有值） */
export function ensureNotebookAiMessageCreatedAt<T extends MessageWithCreatedAt>(
  messages: T[],
  now = Date.now(),
): T[] {
  let changed = false;
  const next = messages.map((message) => {
    if (getMessageCreatedAt(message) !== undefined) return message;
    changed = true;
    return {
      ...message,
      metadata: {
        ...message.metadata,
        createdAt: now,
      },
    } as T;
  });
  return changed ? next : messages;
}
