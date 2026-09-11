import type { WorkspaceProfileItem, WorkspaceProfileItemType } from '../types';

export const WORKSPACE_PROFILE_PROJECT_PREFIX = 'project:';
export const WORKSPACE_PROFILE_CUSTOM_PREFIX = 'custom:';

/***********************启动组条目编码/解码*********************/

/**
 * 把脚本/自定义命令编码成 select 可安全传输的值，
 * 避免仅靠字符串本身无法区分项目脚本和自定义命令。
 */
export function encodeWorkspaceProfileSelection(
  type: WorkspaceProfileItemType,
  value: string,
): string {
  const prefix = type === 'custom'
    ? WORKSPACE_PROFILE_CUSTOM_PREFIX
    : WORKSPACE_PROFILE_PROJECT_PREFIX;

  return `${prefix}${value}`;
}

/**
 * 从 select 值还原启动组条目。
 * 无法识别时返回 null，避免把未知值塞进 profile。
 */
export function decodeWorkspaceProfileSelection(
  projectId: string,
  encodedValue: string,
): WorkspaceProfileItem | null {
  if (encodedValue.startsWith(WORKSPACE_PROFILE_PROJECT_PREFIX)) {
    return {
      type: 'project',
      projectId,
      nameOrCommandId: encodedValue.slice(WORKSPACE_PROFILE_PROJECT_PREFIX.length),
    };
  }

  if (encodedValue.startsWith(WORKSPACE_PROFILE_CUSTOM_PREFIX)) {
    return {
      type: 'custom',
      projectId,
      nameOrCommandId: encodedValue.slice(WORKSPACE_PROFILE_CUSTOM_PREFIX.length),
    };
  }

  return null;
}

/***********************分组 id 归一化*********************/

/**
 * 批量分组操作在 UI 层会拿到空字符串，
 * 持久化前统一归一化成 undefined，保持和项目表单一致。
 */
export function normalizeProjectGroupId(groupId: string | undefined | null): string | undefined {
  const normalized = groupId?.trim();
  return normalized ? normalized : undefined;
}
