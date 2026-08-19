import { expect, test } from "playwright/test";
import {
  CHAT_TIME_GAP_MS,
  ensureNotebookAiMessageCreatedAt,
  formatChatMessageTime,
  getMessageCreatedAt,
  shouldShowChatTimeDivider,
} from "../../src/lib/notebook-ai/messageTime";

/** 固定「现在」：2026-08-05 15:30:00 本地 */
function fixedNow() {
  return new Date(2026, 7, 5, 15, 30, 0);
}

function at(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
) {
  return new Date(year, monthIndex, day, hour, minute, 0).getTime();
}

test("formatChatMessageTime：今天只显示 HH:mm", () => {
  const now = fixedNow();
  expect(formatChatMessageTime(at(2026, 7, 5, 14, 32), now)).toBe("14:32");
  expect(formatChatMessageTime(at(2026, 7, 5, 9, 5), now)).toBe("09:05");
});

test("formatChatMessageTime：昨天带「昨天」前缀", () => {
  const now = fixedNow();
  expect(formatChatMessageTime(at(2026, 7, 4, 22, 10), now)).toBe(
    "昨天 22:10",
  );
});

test("formatChatMessageTime：7 天内显示星期X", () => {
  const now = fixedNow();
  // 2026-08-05 是星期三；前 2 天 = 星期一 8/3
  expect(formatChatMessageTime(at(2026, 7, 3, 8, 0), now)).toBe(
    "星期一 08:00",
  );
  // 前 6 天 = 星期四 7/30
  expect(formatChatMessageTime(at(2026, 6, 30, 18, 45), now)).toBe(
    "星期四 18:45",
  );
});

test("formatChatMessageTime：同年更早显示 M月D日", () => {
  const now = fixedNow();
  // 超过 7 天但同年
  expect(formatChatMessageTime(at(2026, 6, 20, 11, 20), now)).toBe(
    "7月20日 11:20",
  );
  expect(formatChatMessageTime(at(2026, 0, 1, 0, 1), now)).toBe("1月1日 00:01");
});

test("formatChatMessageTime：跨年显示 YYYY年M月D日", () => {
  const now = fixedNow();
  expect(formatChatMessageTime(at(2025, 11, 31, 23, 59), now)).toBe(
    "2025年12月31日 23:59",
  );
});

test("formatChatMessageTime：无效时间返回空串", () => {
  expect(formatChatMessageTime(Number.NaN)).toBe("");
  expect(formatChatMessageTime(Infinity)).toBe("");
});

test("shouldShowChatTimeDivider：首条 / 间隔 / 缺时间戳", () => {
  const t0 = at(2026, 7, 5, 10, 0);
  const withinGap = t0 + CHAT_TIME_GAP_MS - 1;
  const overGap = t0 + CHAT_TIME_GAP_MS;

  expect(
    shouldShowChatTimeDivider({ metadata: { createdAt: t0 } }, null),
  ).toBe(true);

  expect(
    shouldShowChatTimeDivider(
      { metadata: { createdAt: withinGap } },
      { metadata: { createdAt: t0 } },
    ),
  ).toBe(false);

  expect(
    shouldShowChatTimeDivider(
      { metadata: { createdAt: overGap } },
      { metadata: { createdAt: t0 } },
    ),
  ).toBe(true);

  expect(shouldShowChatTimeDivider({ metadata: {} }, null)).toBe(false);
  expect(
    shouldShowChatTimeDivider(
      { metadata: { createdAt: t0 } },
      { metadata: {} },
    ),
  ).toBe(true);
});

test("getMessageCreatedAt 与 ensureNotebookAiMessageCreatedAt", () => {
  expect(getMessageCreatedAt({ metadata: { createdAt: 123 } })).toBe(123);
  expect(getMessageCreatedAt({ metadata: {} })).toBeUndefined();

  const now = 1_700_000_000_000;
  const messages = [
    { id: "a", metadata: { createdAt: 100 } },
    { id: "b", metadata: { displayText: "x" } },
    { id: "c" },
  ];
  const ensured = ensureNotebookAiMessageCreatedAt(messages, now);
  expect(ensured[0].metadata?.createdAt).toBe(100);
  expect(ensured[1].metadata?.createdAt).toBe(now);
  expect(ensured[2].metadata?.createdAt).toBe(now);

  // 全部已有 createdAt 时返回原数组引用
  const allSet = [{ id: "a", metadata: { createdAt: 1 } }];
  expect(ensureNotebookAiMessageCreatedAt(allSet, now)).toBe(allSet);
});
