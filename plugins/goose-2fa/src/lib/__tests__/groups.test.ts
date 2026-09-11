import { describe, expect, it } from "vitest";
import type { AccountData, VaultGroup } from "../types";
import {
  MAX_GROUP_NAME_LENGTH,
  UNGROUPED_KEY,
  buildGroupTallies,
  filterByGroup,
  resolveSelectedGroup,
  normalizeGroupName,
  nextGroupOrder,
} from "../groups";

function makeAccount(partial: Partial<AccountData> = {}): AccountData {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? "user",
    issuer: partial.issuer ?? "GitHub",
    secret: "SECRET",
    type: "totp",
    digits: 6,
    period: 30,
    counter: 0,
    algorithm: "SHA-1",
    createdAt: 1,
    groupId: partial.groupId,
    ...partial,
  };
}

function makeGroup(partial: Partial<VaultGroup> & { id: string; name: string }): VaultGroup {
  return {
    order: partial.order ?? 0,
    createdAt: partial.createdAt ?? 1,
    ...partial,
  };
}

describe("filterByGroup", () => {
  const accounts = [
    makeAccount({ id: "1", groupId: "work" }),
    makeAccount({ id: "2", groupId: null }),
    makeAccount({ id: "3" }),
    makeAccount({ id: "4", groupId: "home" }),
  ];

  it("null 返回全部", () => {
    expect(filterByGroup(accounts, null)).toHaveLength(4);
  });

  it("按分组过滤", () => {
    expect(filterByGroup(accounts, "work").map((a) => a.id)).toEqual(["1"]);
  });

  it("未分组包含 null 与缺省", () => {
    expect(filterByGroup(accounts, UNGROUPED_KEY).map((a) => a.id)).toEqual(["2", "3"]);
  });
});

describe("buildGroupTallies", () => {
  it("按 order 排列并统计未分组", () => {
    const groups = [
      makeGroup({ id: "b", name: "生活", order: 2 }),
      makeGroup({ id: "a", name: "工作", order: 1 }),
    ];
    const accounts = [
      makeAccount({ groupId: "a" }),
      makeAccount({ groupId: "a" }),
      makeAccount({ groupId: "b" }),
      makeAccount({ groupId: null }),
    ];
    const tallies = buildGroupTallies(groups, accounts);
    expect(tallies.map((t) => t.id)).toEqual(["a", "b", UNGROUPED_KEY]);
    expect(tallies[0]).toMatchObject({ name: "工作", count: 2 });
    expect(tallies[2]).toMatchObject({ id: UNGROUPED_KEY, count: 1 });
  });
});

describe("resolveSelectedGroup", () => {
  const groups = [makeGroup({ id: "work", name: "工作" })];
  const accounts = [makeAccount({ groupId: "work" })];

  it("保留全部与未分组", () => {
    expect(resolveSelectedGroup(null, groups, accounts)).toBeNull();
    expect(resolveSelectedGroup(UNGROUPED_KEY, groups, accounts)).toBe(UNGROUPED_KEY);
  });

  it("已删除分组回退全部", () => {
    expect(resolveSelectedGroup("gone", groups, accounts)).toBeNull();
  });

  it("空数据时保留持久化选中，避免 hydrate 闪断", () => {
    expect(resolveSelectedGroup("work", [], [])).toBe("work");
  });
});

describe("group helpers", () => {
  it("normalizeGroupName 去首尾空白并压缩中间空格", () => {
    expect(normalizeGroupName("  工  作  ")).toBe("工 作");
  });

  it("normalizeGroupName 将名称限制在界面可承载的最大长度", () => {
    const longName = "这是一段明显超过二十个字符限制的一级分组名称";
    expect(normalizeGroupName(longName)).toHaveLength(MAX_GROUP_NAME_LENGTH);
  });

  it("nextGroupOrder 递增", () => {
    expect(nextGroupOrder([])).toBe(0);
    expect(
      nextGroupOrder([
        makeGroup({ id: "a", name: "A", order: 2 }),
        makeGroup({ id: "b", name: "B", order: 5 }),
      ]),
    ).toBe(6);
  });
});
