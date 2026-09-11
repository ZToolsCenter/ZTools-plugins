/**
 * 存储隔离（ADR 0004）。
 * - 逻辑键：业务代码使用无前缀 key（如 `settings`）
 * - 物理键：platform / preload 写入时加 `ga:` → `ga:settings`
 * - **禁止** `gn:` / `goose-note-*` 及任何跨插件读 note
 */

/** 短前缀，与 preload / web adapter 一致 */
export const STORAGE_PREFIX = "ga:" as const;

/** 命名空间风格（主题等浏览器直写 localStorage 时可用） */
export const STORAGE_NS_PREFIX = "goose-agent-" as const;

/** 禁止使用的 note 前缀（审计 / 防误写） */
export const FORBIDDEN_STORAGE_PREFIXES = [
  "gn:",
  "goose-note-",
  "goose-note:",
] as const;

/**
 * 将逻辑键规范为带 `ga:` 的物理键。
 * 若已带前缀则原样返回（幂等）。
 */
export function toPhysicalKey(logicalKey: string): string {
  if (logicalKey.startsWith(STORAGE_PREFIX)) return logicalKey;
  return `${STORAGE_PREFIX}${logicalKey}`;
}

/** 去掉 `ga:` 得到逻辑键 */
export function toLogicalKey(physicalKey: string): string {
  if (physicalKey.startsWith(STORAGE_PREFIX)) {
    return physicalKey.slice(STORAGE_PREFIX.length);
  }
  return physicalKey;
}

/** 开发期断言：拒绝 note 前缀 */
export function assertAllowedStorageKey(key: string): void {
  for (const bad of FORBIDDEN_STORAGE_PREFIXES) {
    if (key.startsWith(bad)) {
      throw new Error(
        `[goose-agent/storage] 禁止使用 note 前缀「${bad}」，请用 ga: / goose-agent-*（ADR 0004）`,
      );
    }
  }
}
