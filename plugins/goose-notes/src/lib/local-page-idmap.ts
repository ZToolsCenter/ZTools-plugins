/**
 * local-page-idmap — 本地文件夹页面稳定 pageId 映射
 *
 * 设计原则（零迁移）：
 * - 首次见到某 relativePath 时，stableId 直接用现行公式生成
 *   `local-{notebookId}-{encodeURIComponent(relativePath)}`
 *   ——存量用户的收藏/置顶/lastActivePage/tabs 全部自动续命，无需迁移。
 * - 此后文件被应用内改名时，映射表更新（旧 relativePath 条目删除、新 relativePath
 *   指向同一 id），id 永不变更。
 * - 如果旧路径后来被重新创建，而旧路径公式生成的 id 已被改名后的文件占用，
 *   给新文件分配带后缀的新 id，避免覆盖现有页面。
 * - 外部直接重命名/删除文件时，旧 id 自然退役（扫描结束清理已消失路径的条目），可接受。
 *
 * 存储：key = `gn:local-idmap:{notebookId}`，值为 { [relativePath]: stableId }
 * 使用 utoolsDbStorage 的 readDbStorageJSON / writeDbStorageJSON，
 * 浏览器 dev 环境自动回落 localStorage，uTools 环境用 dbStorage / db 文档。
 */

import {
  readDbStorageJSON,
  removeDbStorageItem,
  writeDbStorageJSON,
} from "./storage/utoolsDbStorage";

const IDMAP_KEY_PREFIX = "gn:local-idmap:";

export type LocalPageIdMap = Record<string, string>; // relativePath → stableId

function storageKey(notebookId: string): string {
  return `${IDMAP_KEY_PREFIX}${notebookId}`;
}

/** 读取某 notebook 的完整映射表（不存在则返回空对象）。 */
export function readLocalPageIdMap(notebookId: string): LocalPageIdMap {
  return readDbStorageJSON<LocalPageIdMap>(storageKey(notebookId), {});
}

/** 持久化某 notebook 的完整映射表。 */
export function writeLocalPageIdMap(
  notebookId: string,
  map: LocalPageIdMap,
): void {
  writeDbStorageJSON(storageKey(notebookId), map);
}

/** 清除某个本地文件夹记事本的页面 ID 映射（仅应用元数据，不触碰磁盘文件）。 */
export function removeLocalPageIdMap(notebookId: string): void {
  removeDbStorageItem(storageKey(notebookId));
}

/** 从文件路径计算相对路径（不含前导斜杠）。 */
export function toRelativePath(basePath: string, filePath: string): string {
  return filePath.replace(basePath, "").replace(/^[\/\\]/, "");
}

/** 按现行公式生成一个新 stableId（与原 buildLocalPageId 完全等价）。 */
function generateStableId(notebookId: string, relativePath: string): string {
  return `local-${notebookId}-${encodeURIComponent(relativePath)}`;
}

/**
 * 反查某个 stableId 当前归属的 relativePath。
 * 用于判断「按旧路径公式生成的 id」是否已被应用内改名后的文件继续占用。
 */
function findRelativePathById(
  map: LocalPageIdMap,
  id: string,
): string | undefined {
  return Object.keys(map).find((key) => map[key] === id);
}

/**
 * 为新出现的 relativePath 分配可用 stableId。
 *
 * 常规情况下沿用旧公式，保持存量页面 id 不变；如果旧路径被重新创建，而旧公式 id
 * 已经归属于改名后的文件，则追加后缀生成新 id，避免覆盖现有页面。
 */
function generateAvailableStableId(
  notebookId: string,
  relativePath: string,
  map: LocalPageIdMap,
): string {
  const baseId = generateStableId(notebookId, relativePath);
  const existingRelative = findRelativePathById(map, baseId);
  if (!existingRelative || existingRelative === relativePath) {
    return baseId;
  }

  let suffix = 2;
  let candidate = `${baseId}--${suffix}`;
  const usedIds = new Set(Object.values(map));
  while (usedIds.has(candidate)) {
    suffix++;
    candidate = `${baseId}--${suffix}`;
  }

  console.warn(
    "[local-page-idmap] generated id occupied, assigning unique id",
    { baseId, existingRelative, relativePath, candidate },
  );
  return candidate;
}

/**
 * 主查询/分配入口。
 *
 * 传入内存中的映射快照 `map`（调用方统一读取/写回，避免每文件各自 IO）。
 * - 命中 → 直接返回映射 id（不改写 map）
 * - 未命中 → 生成新 stableId 写入 map，标记 `dirty = true`
 *
 * 调用方在扫描结束后判断 dirty 再统一写盘。
 */
export function resolveOrCreateStableId(
  notebookId: string,
  relativePath: string,
  map: LocalPageIdMap,
): { id: string; dirty: boolean } {
  if (map[relativePath]) {
    return { id: map[relativePath], dirty: false };
  }
  const id = generateAvailableStableId(notebookId, relativePath, map);
  map[relativePath] = id;
  return { id, dirty: true };
}

/**
 * 应用内改名：将旧 relativePath 的 id 迁移到新 relativePath。
 * - 删除旧条目
 * - 写入新条目（指向同一 stableId）
 * - 持久化
 *
 * 若映射表内没有旧条目（首次改名），则用旧 pageId（即旧公式生成的 id）迁移。
 */
export function migrateLocalPageIdMapEntry(
  notebookId: string,
  oldRelativePath: string,
  newRelativePath: string,
  currentPageId: string,
): void {
  const map = readLocalPageIdMap(notebookId);
  const stableId = map[oldRelativePath] ?? currentPageId;

  // 防御：新路径已存在且指向不同 id，不覆盖（上层已校验文件名冲突）。
  if (map[newRelativePath] && map[newRelativePath] !== stableId) {
    console.warn(
      "[local-page-idmap] migrateEntry: new path already mapped to different id",
      { newRelativePath, existing: map[newRelativePath], stableId },
    );
    return;
  }

  delete map[oldRelativePath];
  map[newRelativePath] = stableId;
  writeLocalPageIdMap(notebookId, map);
}

/**
 * 扫描结束后清理已不存在路径的条目。
 * @param liveRelativePaths 本次扫描实际存在的相对路径集合
 */
export function pruneLocalPageIdMap(
  notebookId: string,
  liveRelativePaths: Set<string>,
): void {
  const map = readLocalPageIdMap(notebookId);
  let changed = false;
  for (const rel of Object.keys(map)) {
    if (!liveRelativePaths.has(rel)) {
      delete map[rel];
      changed = true;
    }
  }
  if (changed) {
    writeLocalPageIdMap(notebookId, map);
  }
}
