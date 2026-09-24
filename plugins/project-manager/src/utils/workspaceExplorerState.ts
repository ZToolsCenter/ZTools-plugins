import { normalizeComparablePath } from './workspacePath';
import { ref } from 'vue';

const expandedByWorkspace = new Map<string, Set<string>>();
export const explorerStateVersion = ref(0);

function bucket(workspaceRootId: string): Set<string> {
  const key = normalizeComparablePath(workspaceRootId);
  let state = expandedByWorkspace.get(key);
  if (!state) {
    state = new Set<string>();
    expandedByWorkspace.set(key, state);
  }
  return state;
}

export function isExplorerExpanded(workspaceRootId: string, nodeKey: string, defaultValue = false): boolean {
  const state = bucket(workspaceRootId);
  return state.has(nodeKey) || (defaultValue && !state.has(`!${nodeKey}`));
}

export function setExplorerExpanded(workspaceRootId: string, nodeKey: string, expanded: boolean): void {
  const state = bucket(workspaceRootId);
  state.delete(`!${nodeKey}`);
  if (expanded) state.add(nodeKey);
  else {
    state.delete(nodeKey);
    state.add(`!${nodeKey}`);
  }
  explorerStateVersion.value += 1;
}

export function cleanupExplorerState(workspaceRootId: string, aliveKeys: Set<string>): void {
  const state = bucket(workspaceRootId);
  for (const key of [...state]) {
    if (!aliveKeys.has(key.replace(/^!/, ''))) state.delete(key);
  }
}

export function cleanupRemovedExplorerProjects(workspaceRootId: string, aliveProjectIds: Set<string>): void {
  const state = bucket(workspaceRootId);
  let changed = false;
  for (const key of [...state]) {
    const normalized = key.replace(/^!/, '');
    const projectId = normalized.match(/^(?:project|dir):([^:]+)/)?.[1];
    if (projectId && !aliveProjectIds.has(projectId)) {
      state.delete(key);
      changed = true;
    }
  }
  if (changed) explorerStateVersion.value += 1;
}

export function clearExplorerState(workspaceRootId: string): void {
  expandedByWorkspace.delete(normalizeComparablePath(workspaceRootId));
  explorerStateVersion.value += 1;
}
