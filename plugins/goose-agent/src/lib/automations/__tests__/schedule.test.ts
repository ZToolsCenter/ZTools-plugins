import { describe, expect, it } from "vitest";
import {
  computeNextRunAt,
  formatScheduleLabel,
  isValidCronExpression,
  scheduleToCron,
} from "../schedule";
import type { Schedule } from "../types";

const TZ = "Asia/Shanghai";

describe("scheduleToCron", () => {
  it("daily / weekdays / weekly / cron", () => {
    expect(scheduleToCron({ kind: "daily", hour: 9, minute: 30 })).toBe(
      "30 9 * * *",
    );
    expect(scheduleToCron({ kind: "weekdays", hour: 8, minute: 0 })).toBe(
      "0 8 * * 1-5",
    );
    expect(
      scheduleToCron({ kind: "weekly", dayOfWeek: 1, hour: 10, minute: 15 }),
    ).toBe("15 10 * * 1");
    expect(scheduleToCron({ kind: "cron", expression: "0 */2 * * *" })).toBe(
      "0 */2 * * *",
    );
  });

  it("manual / once / interval → null", () => {
    expect(scheduleToCron({ kind: "manual" })).toBeNull();
    expect(scheduleToCron({ kind: "once", atMs: Date.now() + 1000 })).toBeNull();
    expect(scheduleToCron({ kind: "interval", everyMinutes: 30 })).toBeNull();
  });
});

describe("computeNextRunAt", () => {
  it("manual → null", () => {
    expect(computeNextRunAt({ kind: "manual" }, Date.now(), TZ)).toBeNull();
  });

  it("once future returns atMs; past returns null", () => {
    const future = Date.now() + 60_000;
    expect(computeNextRunAt({ kind: "once", atMs: future }, Date.now(), TZ)).toBe(
      future,
    );
    expect(
      computeNextRunAt({ kind: "once", atMs: Date.now() - 1000 }, Date.now(), TZ),
    ).toBeNull();
  });

  it("interval adds everyMinutes (≥5)", () => {
    const from = 1_700_000_000_000;
    expect(
      computeNextRunAt({ kind: "interval", everyMinutes: 10 }, from, TZ),
    ).toBe(from + 10 * 60_000);
    // 低于最小值钳到 5
    expect(
      computeNextRunAt({ kind: "interval", everyMinutes: 1 }, from, TZ),
    ).toBe(from + 5 * 60_000);
  });

  it("daily next is after from in timezone", () => {
    // 2026-08-07 01:00 UTC = 09:00 Asia/Shanghai
    const from = Date.parse("2026-08-07T01:00:00.000Z");
    const next = computeNextRunAt(
      { kind: "daily", hour: 14, minute: 30 },
      from,
      TZ,
    );
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThan(from);
    // 应为当天 14:30 CST = 06:30 UTC
    expect(next).toBe(Date.parse("2026-08-07T06:30:00.000Z"));
  });

  it("weekdays skips weekend", () => {
    // 2026-08-08 is Saturday UTC morning → Shanghai still Saturday
    const satMorning = Date.parse("2026-08-08T01:00:00.000Z"); // 09:00 CST Sat
    const next = computeNextRunAt(
      { kind: "weekdays", hour: 9, minute: 0 },
      satMorning,
      TZ,
    );
    expect(next).not.toBeNull();
    // next weekday 09:00 CST = Monday 2026-08-10 01:00 UTC
    expect(next).toBe(Date.parse("2026-08-10T01:00:00.000Z"));
  });

  it("invalid cron → null", () => {
    expect(
      computeNextRunAt(
        { kind: "cron", expression: "not a cron" },
        Date.now(),
        TZ,
      ),
    ).toBeNull();
  });
});

describe("formatScheduleLabel", () => {
  it("中文标签", () => {
    expect(formatScheduleLabel({ kind: "manual" })).toBe("仅手动");
    expect(
      formatScheduleLabel({ kind: "daily", hour: 9, minute: 5 }),
    ).toBe("每天 09:05");
    expect(
      formatScheduleLabel({ kind: "weekdays", hour: 8, minute: 0 }),
    ).toBe("工作日 08:00");
    expect(
      formatScheduleLabel({
        kind: "weekly",
        dayOfWeek: 1,
        hour: 10,
        minute: 0,
      }),
    ).toBe("每周一 10:00");
    expect(
      formatScheduleLabel({ kind: "interval", everyMinutes: 30 }),
    ).toBe("每 30 分钟");
    expect(
      formatScheduleLabel({ kind: "interval", everyMinutes: 120 }),
    ).toBe("每 2 小时");
    expect(
      formatScheduleLabel({ kind: "cron", expression: "0 0 * * *" }),
    ).toBe("Cron 0 0 * * *");
  });

  it("once 含日期", () => {
    const label = formatScheduleLabel({
      kind: "once",
      atMs: Date.parse("2026-12-25T10:30:00"),
    });
    expect(label.startsWith("一次 ")).toBe(true);
    expect(label).toContain("2026");
  });
});

describe("isValidCronExpression", () => {
  it("valid / invalid", () => {
    expect(isValidCronExpression("0 9 * * 1-5")).toBe(true);
    expect(isValidCronExpression("")).toBe(false);
    expect(isValidCronExpression("xxx")).toBe(false);
  });
});

describe("schedule kinds exhaust", () => {
  it("all kinds produce label", () => {
    const samples: Schedule[] = [
      { kind: "manual" },
      { kind: "daily", hour: 0, minute: 0 },
      { kind: "weekdays", hour: 12, minute: 0 },
      { kind: "weekly", dayOfWeek: 0, hour: 0, minute: 0 },
      { kind: "interval", everyMinutes: 5 },
      { kind: "once", atMs: Date.now() + 1000 },
      { kind: "cron", expression: "* * * * *" },
    ];
    for (const s of samples) {
      expect(formatScheduleLabel(s).length).toBeGreaterThan(0);
    }
  });
});
