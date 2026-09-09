export const WORKSPACE_EXPLORER_MIN_WIDTH = 240;
export const WORKSPACE_EXPLORER_MAX_WIDTH = 520;
export const WORKSPACE_EXPLORER_DEFAULT_WIDTH = 320;

export function clampWorkspaceExplorerWidth(value: unknown): number {
  const width = typeof value === 'number' && Number.isFinite(value)
    ? value
    : WORKSPACE_EXPLORER_DEFAULT_WIDTH;
  return Math.min(WORKSPACE_EXPLORER_MAX_WIDTH, Math.max(WORKSPACE_EXPLORER_MIN_WIDTH, Math.round(width)));
}

export function readWorkspaceExplorerWidth(settings: { workspaceExplorerWidth?: unknown }): number {
  return clampWorkspaceExplorerWidth(settings.workspaceExplorerWidth);
}

export function persistWorkspaceExplorerWidth(
  settings: { workspaceExplorerWidth?: number },
  width: number,
): number {
  const normalized = clampWorkspaceExplorerWidth(width);
  settings.workspaceExplorerWidth = normalized;
  return normalized;
}
