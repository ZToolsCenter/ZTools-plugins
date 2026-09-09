/***********************项目树共享常量与工具*********************/

/**
 * 项目树最大层级：一级 → 二级 → 三级。
 *
 * 该值与后端 `MAX_SCAN_DEPTH`（src-tauri/src/project.rs）以及
 * uTools/ZTools preload.js 中的同名常量保持一致——扫描深度必须与
 * 项目树能承载的层级对齐，否则会扫出无处安放的深层目录。
 */
export const MAX_PROJECT_DEPTH = 3;

/**
 * 路径归一化：统一分隔符、去掉末尾斜杠、转小写。
 * 用于跨平台的路径去重与"是否已存在于项目库"的匹配。
 */
export function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** 从完整路径中取最后一段作为显示名 */
export function projectFolderName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

/** 拖拽后要写回的序号（只包含需要改的那个字段） */
export interface ManualOrderAssignment {
  id: string;
  pinOrder?: number;
  sortOrder?: number;
}

/**
 * 把拖拽后的顺序翻译成要写回项目的序号。
 *
 * 置顶项写 pinOrder（用它在整个列表里的下标——置顶项恒排在前面，
 * 所以下标就是它们之间的相对次序）；未置顶项写一个独立递增的 sortOrder。
 * 两个字段互不覆盖，取消置顶后仍能回到原来的手动位置。
 *
 * 序号是**同一 parentId 作用域内**的，调用方传进来的列表必须已经是同一层级。
 */
export function computeManualOrderAssignments(
  ordered: { id: string; pinned?: boolean }[],
): ManualOrderAssignment[] {
  const assignments: ManualOrderAssignment[] = [];
  let unpinnedIndex = 0;

  ordered.forEach((item, index) => {
    if (item.pinned) {
      assignments.push({ id: item.id, pinOrder: index });
    } else {
      assignments.push({ id: item.id, sortOrder: unpinnedIndex++ });
    }
  });

  return assignments;
}

/** 排序所需的最小字段 */
export interface ProjectSortFields {
  pinned?: boolean;
  pinOrder?: number;
  sortOrder?: number;
}

/**
 * 手动排序（默认排序模式）的比较器：置顶优先 → pinOrder → sortOrder。
 *
 * 一级项目列表与子项目列表必须共用同一套规则，否则会出现「点了置顶但列表
 * 顺序没变」——子项目列表原先只按 sortOrder 排、完全忽略 pinned。
 *
 * 注意 pinOrder 与 sortOrder 都是**同一 parentId 作用域内**的序号，
 * 跨层级比较没有意义，调用方需先按父级筛选。
 */
export function compareProjectsByPinnedThenOrder(
  a: ProjectSortFields,
  b: ProjectSortFields,
): number {
  if (a.pinned && !b.pinned) return -1;
  if (!a.pinned && b.pinned) return 1;
  if (a.pinned && b.pinned) return (a.pinOrder ?? 0) - (b.pinOrder ?? 0);
  // 未置顶的按手动拖拽序号；没有序号的排在最后并保持原有相对顺序
  const orderA = a.sortOrder ?? Infinity;
  const orderB = b.sortOrder ?? Infinity;
  if (orderA !== orderB) return orderA - orderB;
  return 0;
}

/**
 * 把「按项目自身统计的运行中命令数」向上聚合成「自身 + 全部后代」的运行数。
 *
 * 起因：运行状态的 key 取的是**发起命令那个项目自己**的 id
 * （见 stores/project.ts 的 getProjectIdFromRunId），所以子项目在跑时，
 * 父项目卡片上的计数是 0，主页看不出「这个项目里有东西在跑」。
 *
 * 复杂度 O(项目数 + 运行项数 × 层级深度)。层级深度上限是 MAX_PROJECT_DEPTH，
 * 所以不需要缓存层；**不要**改成对每个项目调用一次「收集后代」——那是 O(n²)。
 *
 * @param projects 全量项目（只需要 id 与 parentId）
 * @param runningCountByProject 按项目自身统计的运行数，0 或缺失表示没在跑
 * @returns 每个项目 id → 自身与后代的运行数之和；没在跑的项目不出现在结果里
 */
export function aggregateRunningSubtreeCount(
  projects: { id: string; parentId?: string }[],
  runningCountByProject: Record<string, number>,
): Record<string, number> {
  const parentById = new Map<string, string | undefined>();
  for (const project of projects) {
    parentById.set(project.id, project.parentId);
  }

  const result: Record<string, number> = {};

  for (const [projectId, count] of Object.entries(runningCountByProject)) {
    if (!count) continue;
    // 项目已被删除但计数尚未清理时跳过，避免凭空造出不存在的条目
    if (!parentById.has(projectId)) continue;

    // 从自身开始沿 parentId 上溯，自身也计入。
    // 循环条件里的 parentById.has 有两个作用：挡住指向已删除父项目的悬空
    // parentId（否则会凭空造出一个不存在的 id 条目），以及配合 seen 防脏数据成环。
    const seen = new Set<string>();
    let current: string | undefined = projectId;
    while (current && parentById.has(current) && !seen.has(current)) {
      seen.add(current);
      result[current] = (result[current] ?? 0) + count;
      current = parentById.get(current);
    }
  }

  return result;
}

/**
 * 为按层级展开的项目分配 sortOrder。
 *
 * 关键点：**每个父级独立计数**，各自从该父级已有子项目数量续号。
 * 若像单层的 addSubProjects 那样共用一个计数器，多层挂载时不同父级下的
 * 子项目会拿到互相穿插的序号，导致列表顺序错乱。
 *
 * @param projects 已按"父在前、子在后"排好序的项目列表
 * @param existingChildCount 返回某父级当前已有的直接子项目数量
 */
export function assignSortOrders<T extends { parentId?: string }>(
  projects: T[],
  existingChildCount: (parentId: string) => number,
): (T & { sortOrder: number })[] {
  const nextOrderByParent = new Map<string, number>();

  return projects.map((project) => {
    // 一级项目（无 parentId）统一归入空串这一桶，从 0 起算
    const key = project.parentId ?? '';
    if (!nextOrderByParent.has(key)) {
      nextOrderByParent.set(key, project.parentId ? existingChildCount(project.parentId) : 0);
    }
    const sortOrder = nextOrderByParent.get(key)!;
    nextOrderByParent.set(key, sortOrder + 1);
    return { ...project, sortOrder };
  });
}
