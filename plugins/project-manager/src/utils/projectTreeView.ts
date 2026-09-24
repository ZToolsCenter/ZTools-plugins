import { MAX_PROJECT_DEPTH } from './projectTree';

/***********************树筛选辅助*********************/
export interface ProjectTreeRelation {
  id: string;
  parentId?: string;
}

function collectProjectAncestorIdsFromMap(
  byId: ReadonlyMap<string, ProjectTreeRelation>,
  projectId: string,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(projectId);
  while (current?.parentId && result.length < MAX_PROJECT_DEPTH - 1 && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    result.unshift(parent.id);
    current = parent;
  }
  return result;
}

/** 返回节点到根的祖先链，不包含节点自身，最多回溯项目树允许的层级。 */
export function collectProjectAncestorIds(
  projects: readonly ProjectTreeRelation[],
  projectId: string,
): string[] {
  const byId = new Map(projects.map(project => [project.id, project]));
  return collectProjectAncestorIdsFromMap(byId, projectId);
}

/** 匹配任意层级时保留匹配节点及其所有祖先，为树提供完整路径上下文。 */
export function collectVisibleProjectIds(
  projects: readonly ProjectTreeRelation[],
  matchingIds: Iterable<string>,
): Set<string> {
  const visible = new Set<string>();
  const byId = new Map(projects.map(project => [project.id, project]));
  for (const id of matchingIds) {
    visible.add(id);
    for (const ancestorId of collectProjectAncestorIdsFromMap(byId, id)) {
      visible.add(ancestorId);
    }
  }
  return visible;
}

/** 搜索/筛选时自动展开匹配节点的祖先链；用户手动展开集合由调用方另行保存。 */
export function collectAutoExpandedProjectIds(
  projects: readonly ProjectTreeRelation[],
  matchingIds: Iterable<string>,
): Set<string> {
  const expanded = new Set<string>();
  const byId = new Map(projects.map(project => [project.id, project]));
  for (const id of matchingIds) {
    for (const ancestorId of collectProjectAncestorIdsFromMap(byId, id)) {
      expanded.add(ancestorId);
    }
  }
  return expanded;
}

/***********************临时展开状态*********************/
export interface TemporaryProjectTreeExpansionState {
  expandedIds: Set<string>;
  savedExpandedIds: Set<string> | null;
  constrained: boolean;
}

export function createProjectTreeExpansionState(initialIds: Iterable<string> = []): TemporaryProjectTreeExpansionState {
  return {
    expandedIds: new Set(initialIds),
    savedExpandedIds: null,
    constrained: false,
  };
}

/** 进入搜索/筛选模式时保存用户折叠状态，退出时恢复快照。 */
export function setProjectTreeConstraint(
  state: TemporaryProjectTreeExpansionState,
  constrained: boolean,
): void {
  if (constrained && !state.constrained) {
    state.savedExpandedIds = new Set(state.expandedIds);
  } else if (!constrained && state.constrained && state.savedExpandedIds) {
    state.expandedIds = new Set(state.savedExpandedIds);
    state.savedExpandedIds = null;
  }
  state.constrained = constrained;
}
