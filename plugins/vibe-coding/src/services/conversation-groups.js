/**
 * 按工作区组织会话，并将未绑定或失效绑定的会话放入最近分组。
 * @param {Array<Record<string, unknown>>} conversations 会话轻量索引。
 * @param {Array<Record<string, unknown>>} workspaces 已登记工作区。
 * @returns {{workspaceGroups: Array<{workspace: Record<string, unknown>, conversations: Array<Record<string, unknown>>}>, recentConversations: Array<Record<string, unknown>>}} 工作区分组和最近会话。
 */
export function groupConversationsByWorkspace(conversations, workspaces) {
  const sortedConversations = [...(Array.isArray(conversations) ? conversations : [])]
    .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt))
  const workspaceList = Array.isArray(workspaces) ? workspaces : []
  const workspaceIds = new Set(workspaceList.map((workspace) => workspace.id))
  const conversationsByWorkspace = new Map(workspaceList.map((workspace) => [workspace.id, []]))
  const recentConversations = []
  // 单次遍历完成分桶，避免工作区数量增加后反复扫描完整会话列表。
  for (const conversation of sortedConversations) {
    if (workspaceIds.has(conversation.projectId)) conversationsByWorkspace.get(conversation.projectId).push(conversation)
    else recentConversations.push(conversation)
  }
  const workspaceGroups = workspaceList.map((workspace) => ({
    workspace,
    conversations: conversationsByWorkspace.get(workspace.id),
  }))
  return { workspaceGroups, recentConversations }
}
