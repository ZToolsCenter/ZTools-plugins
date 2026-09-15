import { describe, expect, test } from "bun:test";

const {
  QUERY_PREF_KEY,
  QUERY_LEFT_AT_PREF_KEY,
  QUERY_STALE_MS,
  resolveEntryQuery,
  resolvePersistedQuery,
} = require("./plugin-state.cjs") as {
  QUERY_PREF_KEY: string;
  QUERY_LEFT_AT_PREF_KEY: string;
  QUERY_STALE_MS: number;
  resolveEntryQuery: (entry: unknown, savedQuery: unknown) => string;
  resolvePersistedQuery: (savedQuery: unknown, leftAt: unknown, now?: number) => string;
};

describe("uTools 搜索恢复", () => {
  test("普通进入恢复上次筛选词", () => {
    expect(QUERY_PREF_KEY).toBe("pk_query");
    expect(QUERY_LEFT_AT_PREF_KEY).toBe("pk_query_left_at");
    expect(QUERY_STALE_MS).toBe(5 * 60 * 1000);
    expect(resolveEntryQuery({ type: "text" }, "chrome gpu")).toBe("chrome gpu");
  });

  test("带词进入优先于历史筛选", () => {
    expect(resolveEntryQuery({ type: "regex", payload: "结束进程 node" }, "chrome"))
      .toBe("node");
  });

  test("关闭未满 5 分钟保留历史筛选", () => {
    const leftAt = 1_000_000;
    const now = leftAt + QUERY_STALE_MS - 1;
    expect(resolvePersistedQuery("chrome", leftAt, now)).toBe("chrome");
    expect(resolvePersistedQuery("chrome", String(leftAt), now)).toBe("chrome");
  });

  test("关闭满 5 分钟清空历史筛选", () => {
    const leftAt = 1_000_000;
    const now = leftAt + QUERY_STALE_MS;
    expect(resolvePersistedQuery("chrome", leftAt, now)).toBe("");
    expect(resolvePersistedQuery("chrome", String(leftAt), now + 1)).toBe("");
  });

  test("无退出时间戳时兼容旧数据仍恢复", () => {
    expect(resolvePersistedQuery("node", null, Date.now())).toBe("node");
    expect(resolvePersistedQuery("node", "", Date.now())).toBe("node");
    expect(resolvePersistedQuery("node", "bad", Date.now())).toBe("node");
  });
});
