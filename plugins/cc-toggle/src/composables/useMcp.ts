// MCP Server 状态管理

import { ref } from 'vue';
import { getSkillNest, toPlain } from './shared';
import type { McpServer, McpServerInput } from '../types/ztools-cctoggle';

const mcpServers = ref<McpServer[]>([]);

function loadServers(): void {
  mcpServers.value = getSkillNest().listMcpServers();
}

function saveServer(data: McpServerInput): void {
  getSkillNest().saveMcpServer(toPlain(data));
  loadServers();
}

function deleteServer(id: string): void {
  getSkillNest().deleteMcpServer(id);
  loadServers();
}

function toggleServer(id: string): boolean {
  const result = getSkillNest().toggleMcpServer(id);
  loadServers();
  return result;
}

function getServer(id: string): McpServer {
  return getSkillNest().getMcpServer(id);
}

function syncFromConfigFiles(): void {
  getSkillNest().syncFromConfigFiles();
  loadServers();
}

export function useMcp() {
  return {
    mcpServers,
    loadServers,
    saveServer,
    deleteServer,
    toggleServer,
    getServer,
    syncFromConfigFiles
  };
}
