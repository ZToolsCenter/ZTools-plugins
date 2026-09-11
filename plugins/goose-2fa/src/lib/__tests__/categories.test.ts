import { describe, expect, it } from "vitest";
import type { AccountData } from "../types";
import {
  UNCATEGORIZED_LABEL,
  buildCategories,
  categoryKey,
  filterByCategory,
  resolveSelectedCategory,
} from "../categories";

function makeAccount(partial: Partial<AccountData>): AccountData {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? "",
    issuer: partial.issuer ?? "",
    secret: partial.secret ?? "JBSWY3DPEHPK3PXP",
    type: partial.type ?? "totp",
    digits: partial.digits ?? 6,
    period: partial.period ?? 30,
    counter: partial.counter ?? 0,
    algorithm: partial.algorithm ?? "SHA-1",
    createdAt: partial.createdAt ?? Date.now(),
  };
}

/** 模拟 store 持久化层：与 useAccounts.setSelectedCategory / loadSelectedCategory 同语义 */
const CATEGORY_KEY = "goose-2fa-category";

function loadSelectedCategory(): string | null {
  return localStorage.getItem(CATEGORY_KEY);
}

function setSelectedCategory(category: string | null) {
  if (category) {
    localStorage.setItem(CATEGORY_KEY, category);
  } else {
    localStorage.removeItem(CATEGORY_KEY);
  }
}

/** CodeGrid 写回路径：仅当 resolve 结果与 selected 不同才落盘 */
function applyCategoryResolve(
  selected: string | null,
  accounts: AccountData[],
): string | null {
  const effective = resolveSelectedCategory(selected, accounts);
  if (selected !== effective) {
    setSelectedCategory(effective);
  }
  return effective;
}

describe("categoryKey", () => {
  it("使用 issuer 作为分类键", () => {
    expect(categoryKey(makeAccount({ issuer: "GitHub", name: "a" }))).toBe("GitHub");
  });

  it("issuer 为空时归入未分类", () => {
    expect(categoryKey(makeAccount({ issuer: "", name: "a" }))).toBe(UNCATEGORIZED_LABEL);
    expect(categoryKey(makeAccount({ issuer: "  ", name: "a" }))).toBe(UNCATEGORIZED_LABEL);
  });
});

describe("buildCategories", () => {
  it("统计各分类数量并按数量降序", () => {
    const accounts = [
      makeAccount({ issuer: "GitHub" }),
      makeAccount({ issuer: "GitHub" }),
      makeAccount({ issuer: "Google" }),
      makeAccount({ issuer: "" }),
    ];
    const cats = buildCategories(accounts);
    expect(cats).toHaveLength(3);
    expect(cats[0]).toMatchObject({ key: "GitHub", count: 2 });
    expect(cats.find((c) => c.key === "Google")?.count).toBe(1);
    expect(cats.find((c) => c.key === UNCATEGORIZED_LABEL)?.count).toBe(1);
  });

  it("同数量时按名称排序，并包含未分类", () => {
    const accounts = [
      makeAccount({ issuer: "Zoom" }),
      makeAccount({ issuer: "Apple" }),
      makeAccount({ issuer: "  " }),
    ];
    const cats = buildCategories(accounts);
    const expected = ["Zoom", "Apple", UNCATEGORIZED_LABEL].sort((a, b) =>
      a.localeCompare(b, "zh"),
    );
    expect(cats.map((c) => c.key)).toEqual(expected);
    expect(cats.find((c) => c.key === UNCATEGORIZED_LABEL)?.count).toBe(1);
    expect(cats).toHaveLength(3);
  });
});

describe("filterByCategory", () => {
  const accounts = [
    makeAccount({ id: "1", issuer: "GitHub" }),
    makeAccount({ id: "2", issuer: "Google" }),
    makeAccount({ id: "3", issuer: "" }),
  ];

  it("null 返回全部", () => {
    expect(filterByCategory(accounts, null)).toHaveLength(3);
  });

  it("按分类过滤", () => {
    const result = filterByCategory(accounts, "GitHub");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("1");
  });

  it("过滤未分类", () => {
    const result = filterByCategory(accounts, UNCATEGORIZED_LABEL);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("3");
  });
});

describe("resolveSelectedCategory", () => {
  const accounts = [
    makeAccount({ issuer: "GitHub" }),
    makeAccount({ issuer: "Google" }),
    makeAccount({ issuer: "" }),
  ];

  it("null 保持全部", () => {
    expect(resolveSelectedCategory(null, accounts)).toBeNull();
  });

  it("存在的分类原样返回", () => {
    expect(resolveSelectedCategory("GitHub", accounts)).toBe("GitHub");
    expect(resolveSelectedCategory(UNCATEGORIZED_LABEL, accounts)).toBe(
      UNCATEGORIZED_LABEL,
    );
  });

  it("分类已从全量列表消失时回退 null", () => {
    expect(resolveSelectedCategory("DeletedIssuer", accounts)).toBeNull();
  });

  it("accounts 为空时保留选中（load 首帧 / 禁止误清）", () => {
    expect(resolveSelectedCategory("GitHub", [])).toBe("GitHub");
    expect(resolveSelectedCategory(UNCATEGORIZED_LABEL, [])).toBe(
      UNCATEGORIZED_LABEL,
    );
  });

  it("存在性必须基于全量 accounts 而非搜索子集", () => {
    const full = accounts;
    const searchedOnlyGoogle = [makeAccount({ issuer: "Google" })];
    expect(resolveSelectedCategory("GitHub", full)).toBe("GitHub");
    // 错误地把搜索结果当全量会清掉——调用方必须传 full
    expect(resolveSelectedCategory("GitHub", searchedOnlyGoogle)).toBeNull();
  });
});

describe("persist selected category across hydrate (real store semantics)", () => {
  it("刷新后 accounts 空首帧不得清除 goose-2fa-category", () => {
    localStorage.clear();
    setSelectedCategory("GitHub");
    expect(loadSelectedCategory()).toBe("GitHub");

    // CodeGrid 首帧：accounts=[]（load 异步未完成）
    const afterEmpty = applyCategoryResolve(loadSelectedCategory(), []);
    expect(afterEmpty).toBe("GitHub");
    expect(loadSelectedCategory()).toBe("GitHub");

    // load 完成，GitHub 仍在
    const loaded = [
      makeAccount({ issuer: "GitHub" }),
      makeAccount({ issuer: "Google" }),
    ];
    const afterLoad = applyCategoryResolve(loadSelectedCategory(), loaded);
    expect(afterLoad).toBe("GitHub");
    expect(loadSelectedCategory()).toBe("GitHub");
  });

  it("账户删光该分类后才写回清除", () => {
    localStorage.clear();
    setSelectedCategory("GitHub");

    const onlyGoogle = [makeAccount({ issuer: "Google" })];
    const after = applyCategoryResolve(loadSelectedCategory(), onlyGoogle);
    expect(after).toBeNull();
    expect(loadSelectedCategory()).toBeNull();
  });

  it("搜索无匹配不得因空 searched 清除持久化分类", () => {
    localStorage.clear();
    setSelectedCategory("GitHub");
    const full = [
      makeAccount({ issuer: "GitHub" }),
      makeAccount({ issuer: "Google" }),
    ];
    const effective = resolveSelectedCategory("GitHub", full);
    expect(effective).toBe("GitHub");
    const searched: AccountData[] = [];
    const filtered = filterByCategory(searched, effective);
    expect(filtered).toHaveLength(0);
    expect(loadSelectedCategory()).toBe("GitHub");
  });
});
