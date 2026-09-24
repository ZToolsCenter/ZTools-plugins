import assert from 'node:assert/strict'
import test from 'node:test'
import { groupConversationsByWorkspace } from '../../src/services/conversation-groups.js'

test('会话按工作区分组且未绑定会话只出现在最近', () => {
  const workspaces = [{ id: 'workspace-a', name: 'A' }, { id: 'workspace-b', name: 'B' }]
  const conversations = [
    { id: 'recent', projectId: '', updatedAt: 30 },
    { id: 'workspace-b-chat', projectId: 'workspace-b', updatedAt: 20 },
    { id: 'workspace-a-chat', projectId: 'workspace-a', updatedAt: 10 },
  ]

  const result = groupConversationsByWorkspace(conversations, workspaces)

  assert.deepEqual(result.workspaceGroups.map((group) => group.conversations.map((item) => item.id)), [['workspace-a-chat'], ['workspace-b-chat']])
  assert.deepEqual(result.recentConversations.map((item) => item.id), ['recent'])
})

test('工作区记录缺失时会话回退到最近避免从侧边栏消失', () => {
  const result = groupConversationsByWorkspace([{ id: 'orphan', projectId: 'removed', updatedAt: 1 }], [])
  assert.deepEqual(result.recentConversations.map((item) => item.id), ['orphan'])
})
