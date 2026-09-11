import { Cron } from "croner";
import {
  MIN_INTERVAL_MINUTES,
  type Schedule,
} from "./types";

const WEEKDAY_LABELS = [
  "周日",
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
] as const;

/** 默认时区：系统 → Asia/Shanghai */
export function defaultTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === "string" && tz.trim()) return tz.trim();
  } catch {
    // ignore
  }
  return "Asia/Shanghai";
}

function clampHour(h: number): number {
  if (!Number.isFinite(h)) return 0;
  return Math.min(23, Math.max(0, Math.floor(h)));
}

function clampMinute(m: number): number {
  if (!Number.isFinite(m)) return 0;
  return Math.min(59, Math.max(0, Math.floor(m)));
}

function clampDayOfWeek(d: number): number {
  if (!Number.isFinite(d)) return 0;
  return Math.min(6, Math.max(0, Math.floor(d)));
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * 将预设转为 5 字段 cron（分 时 日 月 周）。
 * manual / once / interval 返回 null（不走 cron 表达式）。
 */
export function scheduleToCron(schedule: Schedule): string | null {
  switch (schedule.kind) {
    case "manual":
    case "once":
    case "interval":
      return null;
    case "daily": {
      const h = clampHour(schedule.hour);
      const m = clampMinute(schedule.minute);
      return `${m} ${h} * * *`;
    }
    case "weekdays": {
      const h = clampHour(schedule.hour);
      const m = clampMinute(schedule.minute);
      return `${m} ${h} * * 1-5`;
    }
    case "weekly": {
      const h = clampHour(schedule.hour);
      const m = clampMinute(schedule.minute);
      const d = clampDayOfWeek(schedule.dayOfWeek);
      return `${m} ${h} * * ${d}`;
    }
    case "cron": {
      const expr = schedule.expression?.trim();
      return expr || null;
    }
    default:
      return null;
  }
}

/**
 * 计算下次触发时间（ms）。
 * manual → null；once 已过 → null；interval 从 fromMs + everyMinutes。
 */
export function computeNextRunAt(
  schedule: Schedule,
  fromMs: number,
  timeZone: string = defaultTimeZone(),
): number | null {
  const from = Number.isFinite(fromMs) ? fromMs : Date.now();
  const tz = timeZone?.trim() || defaultTimeZone();

  switch (schedule.kind) {
    case "manual":
      return null;

    case "once": {
      const at = schedule.atMs;
      if (!Number.isFinite(at) || at <= from) return null;
      return Math.floor(at);
    }

    case "interval": {
      const mins = Math.max(
        MIN_INTERVAL_MINUTES,
        Math.floor(
          Number.isFinite(schedule.everyMinutes) ? schedule.everyMinutes : MIN_INTERVAL_MINUTES,
        ),
      );
      return from + mins * 60_000;
    }

    case "daily":
    case "weekdays":
    case "weekly":
    case "cron": {
      const expr = scheduleToCron(schedule);
      if (!expr) return null;
      try {
        const job = new Cron(expr, {
          timezone: tz,
          legacyMode: true,
        });
        // nextRun 从 prev 之后找；传入 from 作为起点
        const next = job.nextRun(new Date(from));
        if (!next) return null;
        const ms = next.getTime();
        // 若恰好落在 from（秒级抹平后），再取下一次
        if (ms <= from) {
          const next2 = job.nextRun(new Date(from + 1000));
          return next2 ? next2.getTime() : null;
        }
        return ms;
      } catch {
        return null;
      }
    }

    default:
      return null;
  }
}

/** 中文人类可读标签 */
export function formatScheduleLabel(schedule: Schedule): string {
  switch (schedule.kind) {
    case "manual":
      return "仅手动";
    case "daily":
      return `每天 ${pad2(clampHour(schedule.hour))}:${pad2(clampMinute(schedule.minute))}`;
    case "weekdays":
      return `工作日 ${pad2(clampHour(schedule.hour))}:${pad2(clampMinute(schedule.minute))}`;
    case "weekly": {
      const day =
        WEEKDAY_LABELS[clampDayOfWeek(schedule.dayOfWeek)] ?? "周日";
      return `每${day} ${pad2(clampHour(schedule.hour))}:${pad2(clampMinute(schedule.minute))}`;
    }
    case "interval": {
      const mins = Math.max(
        MIN_INTERVAL_MINUTES,
        Math.floor(
          Number.isFinite(schedule.everyMinutes)
            ? schedule.everyMinutes
            : MIN_INTERVAL_MINUTES,
        ),
      );
      if (mins % 60 === 0) {
        const h = mins / 60;
        return `每 ${h} 小时`;
      }
      return `每 ${mins} 分钟`;
    }
    case "once": {
      if (!Number.isFinite(schedule.atMs)) return "一次性（无效时间）";
      const d = new Date(schedule.atMs);
      const y = d.getFullYear();
      const mo = pad2(d.getMonth() + 1);
      const day = pad2(d.getDate());
      const h = pad2(d.getHours());
      const m = pad2(d.getMinutes());
      return `一次 ${y}-${mo}-${day} ${h}:${m}`;
    }
    case "cron": {
      const expr = schedule.expression?.trim() || "—";
      return `Cron ${expr}`;
    }
    default:
      return "未知计划";
  }
}

/** 校验 cron 表达式是否可被 croner 解析 */
export function isValidCronExpression(expression: string): boolean {
  const expr = expression?.trim();
  if (!expr) return false;
  try {
    // 构造即校验
    new Cron(expr, { legacyMode: true });
    return true;
  } catch {
    return false;
  }
}
