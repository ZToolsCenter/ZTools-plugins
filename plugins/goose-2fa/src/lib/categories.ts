import type { AccountData } from "./types";

export const UNCATEGORIZED_LABEL = "未分类";

/** 分类键：优先 issuer，空则归入「未分类」。 */
export function categoryKey(account: AccountData): string {
  const issuer = account.issuer.trim();
  return issuer || UNCATEGORIZED_LABEL;
}

export interface CategoryGroup {
  key: string;
  label: string;
  count: number;
}

/** 按账户统计分类，返回按数量降序、同数量按名称排序的列表。 */
export function buildCategories(accounts: AccountData[]): CategoryGroup[] {
  const counts = new Map<string, number>();
  for (const account of accounts) {
    const key = categoryKey(account);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh"));
}

export function filterByCategory(
  accounts: AccountData[],
  category: string | null,
): AccountData[] {
  if (!category) return accounts;
  return accounts.filter((a) => categoryKey(a) === category);
}

/**
 * 解析当前应生效的分类选中态（基于全量 accounts，不依赖搜索结果）。
 *
 * - selected 为 null → 「全部」
 * - accounts 为空 → 保留 selected（load 未完成或真无账户时，禁止误清 localStorage）
 * - accounts 非空且 selected 不在其中 → 回退 null
 */
export function resolveSelectedCategory(
  selected: string | null,
  accounts: AccountData[],
): string | null {
  if (selected === null) return null;
  // 空列表无法证明「分类已消失」——可能是异步 load 首帧，必须保留持久化选中
  if (accounts.length === 0) return selected;
  return accounts.some((a) => categoryKey(a) === selected) ? selected : null;
}
