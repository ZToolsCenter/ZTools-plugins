export type CategoryKind = "all" | "folder" | "extension" | "custom";

export type SelectionMode = "single" | "toggle" | "range";

export interface FinderCategory {
  id: string;
  label: string;
  kind: CategoryKind;
  rule: string;
  enabled?: boolean;
}

export interface FinderResult {
  name: string;
  path: string;
  fullPath: string;
  highlightedName: string;
  highlightedPath: string;
  extension: string;
  size: number;
  modifiedAt: number;
  isDirectory?: boolean;
}

export type FinderSortMode =
  | "name-asc"
  | "name-desc"
  | "path-asc"
  | "path-desc"
  | "size-asc"
  | "size-desc"
  | "modified-asc"
  | "modified-desc";

export const DEFAULT_CATEGORIES: FinderCategory[] = [
  { id: "all", label: "全部", kind: "all", rule: "" },
  { id: "folder", label: "文件夹", kind: "folder", rule: "folder:" },
  { id: "excel", label: "EXCEL", kind: "extension", rule: "ext:xls;xlsx;xlsm;csv" },
  { id: "word", label: "WORD", kind: "extension", rule: "ext:doc;docx;rtf" },
  { id: "ppt", label: "PPT", kind: "extension", rule: "ext:ppt;pptx" },
  { id: "pdf", label: "PDF", kind: "extension", rule: "ext:pdf" },
  { id: "image", label: "图片", kind: "extension", rule: "ext:jpg;jpeg;png;gif;webp;bmp;svg;ico" },
  { id: "video", label: "视频", kind: "extension", rule: "ext:mp4;mkv;avi;mov;wmv;flv;webm" },
  { id: "audio", label: "音频", kind: "extension", rule: "ext:mp3;wav;flac;aac;ogg;m4a" },
  { id: "archive", label: "压缩文件", kind: "extension", rule: "ext:zip;rar;7z;tar;gz;iso" },
];

export const DEFAULT_CATEGORY_ORDER: string[] = DEFAULT_CATEGORIES.map((c) => c.id);

export function normalizeCategoryOrder(
  storedOrder: string[] | undefined,
  allCategoryIds: string[],
): string[] {
  const validIdSet = new Set(allCategoryIds);
  const result: string[] = [];
  const seen = new Set<string>();

  if (Array.isArray(storedOrder)) {
    for (const id of storedOrder) {
      if (typeof id === "string" && validIdSet.has(id) && !seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
  }

  for (const id of allCategoryIds) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  return result;
}

export function reorderArray<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= list.length ||
    toIndex < 0 ||
    toIndex >= list.length ||
    fromIndex === toIndex
  ) {
    return [...list];
  }
  const result = [...list];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result;
}

/**
 * 构建发送给 Everything 搜索引擎的最终查询语句。
 *
 * 组合逻辑：
 * 1. `prefix`（可选）：限制搜索的目标前缀目录。
 *    - 若前缀包含空格（如 `C:\Program Files\App`），根据 Everything 语法规则必须用双引号包裹 `"${prefix}"`，
 *      否则空格会被解析为 AND 运算符导致拆词检索失效；若已有双引号则保留。
 * 2. `keyword`：用户在输入框中键入的搜索词。
 * 3. `category.rule`：当前分类的筛选规则（如 `ext:pdf`、`folder:` 等）。
 */
export function buildEverythingQuery(
  keyword: string,
  category: FinderCategory,
  prefix: string = "",
): string {
  const rule = normalizeCategoryRule(category.rule);
  const trimmedPrefix = prefix.trim();
  const formattedPrefix = trimmedPrefix
    ? trimmedPrefix.startsWith('"') && trimmedPrefix.endsWith('"')
      ? trimmedPrefix
      : /\s/.test(trimmedPrefix)
        ? `"${trimmedPrefix}"`
        : trimmedPrefix
    : "";

  return [formattedPrefix, keyword.trim(), rule].filter(Boolean).join(" ");
}

export function getNextVisibleCount(current: number, total: number, pageSize: number): number {
  return Math.min(total, current + pageSize);
}

export function getNextSelectedPath(
  paths: string[],
  currentPath: string,
  direction: -1 | 1,
): string {
  if (paths.length === 0) return "";

  const currentIndex = paths.indexOf(currentPath);
  if (currentIndex === -1) return paths[0];

  const nextIndex = Math.max(0, Math.min(paths.length - 1, currentIndex + direction));
  return paths[nextIndex];
}

/**
 * 循环切换分类列表。
 *
 * @param categories 启用的分类列表
 * @param currentCategoryId 当前激活的分类 ID
 * @param direction 切换方向：1 为向下切换（末尾循环至首项），-1 为向上切换（首项循环至末尾）
 * @returns 切换后的目标分类对象，列表为空时返回 undefined
 */
export function getNextCyclicCategory<T extends { id: string }>(
  categories: T[],
  currentCategoryId: string,
  direction: -1 | 1,
): T | undefined {
  if (categories.length === 0) return undefined;

  const currentIndex = categories.findIndex((category) => category.id === currentCategoryId);
  if (currentIndex === -1) {
    return direction === 1 ? categories[0] : categories[categories.length - 1];
  }

  const nextIndex = (currentIndex + direction + categories.length) % categories.length;
  return categories[nextIndex];
}

export function getRestoredSelectedPath(results: FinderResult[], currentPath: string): string {
  if (results.length === 0) return "";

  const exists = results.some((item) => item.fullPath === currentPath);
  if (exists) return currentPath;

  return results[0].fullPath;
}

export function getRangeSelectedPaths(
  visiblePaths: string[],
  anchorPath: string,
  targetPath: string,
): string[] {
  if (visiblePaths.length === 0 || !targetPath) return [];

  const targetIndex = visiblePaths.indexOf(targetPath);
  if (targetIndex === -1) return [];

  const anchorIndex = visiblePaths.indexOf(anchorPath);
  if (anchorIndex === -1) return [targetPath];

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return visiblePaths.slice(start, end + 1);
}

export function filterResultsExcludingPaths<T extends Pick<FinderResult, "fullPath">>(
  results: T[],
  pathsToRemove: string[],
): T[] {
  if (pathsToRemove.length === 0) return results;
  const toRemove = new Set(pathsToRemove);
  return results.filter((item) => !toRemove.has(item.fullPath));
}

export function getDragTargetPaths(
  itemPath: string,
  selectedPaths: string[] = [],
): string | string[] {
  if (!itemPath) return "";
  if (selectedPaths.length > 1 && selectedPaths.includes(itemPath)) {
    return [...selectedPaths];
  }
  return itemPath;
}

export function mergeResultsByMatchPathPriority<T extends Pick<FinderResult, "fullPath">>(
  nameResults: T[],
  matchPathResults: T[],
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const item of [...nameResults, ...matchPathResults]) {
    const key = getResultDedupeKey(item);
    if (seen.has(key)) continue;

    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function getResultDedupeKey(item: Pick<FinderResult, "fullPath">): string {
  return item.fullPath.toLowerCase();
}

function normalizeCategoryRule(rule: string): string {
  const trimmed = rule.trim();
  if (!trimmed) return "";
  if (trimmed.includes(":") || trimmed.includes(" ") || trimmed.includes("*")) return trimmed;

  const extensions = trimmed
    .split(/[;,，\s]+/)
    .map((item) => item.trim().replace(/^\./, ""))
    .filter(Boolean);

  return extensions.length > 0 ? `ext:${extensions.join(";")}` : "";
}

export type MatchPathQueryPlan =
  | { mode: "single"; matchPath: false }
  | { mode: "single"; matchPath: true }
  | { mode: "dual" };

/**
 * 决定当前查询是否需要 MatchPath 以及具体的执行计划。
 *
 * 优化策略：
 * 1. 若用户禁用了 matchPathEnabled，始终单次查询（matchPath: false）。
 * 2. 若用户输入的关键词为空（例如仅点击切换分类，无 keyword）：
 *    此时 matchPath=true 与 matchPath=false 的 Everything 返回结果严格一致，执行单次查询（matchPath: false）即可，
 *    避免无意义的双重 IPC 检索与数百个重复对象的序列化。
 * 3. 若用户输入的关键词包含路径分隔符（`\` 或 `/`）：
 *    因为纯文件名中不可能包含路径字符，直接单次查询（matchPath: true），免去一次注定命中为空的 matchPath: false 查询。
 * 4. 普通纯词搜索：执行两阶段双重查询并合并，优先呈现文件名命中的项。
 */
export function getMatchPathQueryPlan(
  matchPathEnabled: boolean,
  keyword: string,
): MatchPathQueryPlan {
  if (!matchPathEnabled) {
    return { mode: "single", matchPath: false };
  }

  const trimmed = keyword.trim();
  if (!trimmed) {
    return { mode: "single", matchPath: false };
  }

  if (trimmed.includes("\\") || trimmed.includes("/")) {
    return { mode: "single", matchPath: true };
  }

  return { mode: "dual" };
}
