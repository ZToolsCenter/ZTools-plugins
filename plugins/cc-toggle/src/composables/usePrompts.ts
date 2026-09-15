import { ref, computed } from 'vue';
import { getSkillNest } from './shared';
import type {
  Prompt,
  BackupMap,
  PromptSaveResult,
  PromptBackupSelection
} from '../types/ztools-cctoggle';

const ALL_AGENTS = ['codex', 'claude', 'gemini', 'openclaw', 'opencode'] as const;
const AGENT_LABELS: Record<string, string> = {
  codex: 'Codex',
  claude: 'Claude',
  gemini: 'Gemini',
  openclaw: 'OpenClaw',
  opencode: 'OpenCode'
};

// OpenClaw 提示词文件清单（与 preload utils.OPENCLAW_PROMPT_FILES 保持一致）
const OPENCLAW_PROMPT_FILES: { file: string; label: string }[] = [
  { file: 'AGENTS.md', label: '总体行为准则 · 红线' },
  { file: 'SOUL.md', label: '性格调性' },
  { file: 'IDENTITY.md', label: '身份人设' },
  { file: 'USER.md', label: '用户笔记' },
  { file: 'TOOLS.md', label: '环境备注' },
  { file: 'HEARTBEAT.md', label: '心跳清单' }
];

const prompts = ref<Prompt[]>([]);
const activePrompt = ref<Prompt | null>(null);
const loading = ref(false);
const activeAgentTab = ref('all');
const backups = ref<BackupMap>({});
const originalPrompts = ref<Record<string, string>>({});

function loadPrompts(): void {
  loading.value = true;
  try {
    prompts.value = getSkillNest().listPrompts() || [];
  } catch (e) {
    console.error('Failed to load prompts:', e);
    prompts.value = [];
  } finally {
    loading.value = false;
  }
}

const filteredPrompts = computed(() => {
  if (activeAgentTab.value === 'all') return prompts.value;
  return prompts.value.filter(p => p.agents?.includes(activeAgentTab.value));
});

function generateId(): string {
  return 'prompt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function savePrompt(prompt: Partial<Prompt>): PromptSaveResult {
  loading.value = true;
  try {
    const now = new Date().toISOString();
    const promptData: Prompt = {
      id: prompt.id || generateId(),
      name: String(prompt.name || ''),
      description: String(prompt.description || ''),
      content: String(prompt.content || ''),
      fileName: prompt.fileName || null,
      fileNames:
        Array.isArray(prompt.fileNames) && prompt.fileNames.length ? [...prompt.fileNames] : null,
      files: prompt.files && typeof prompt.files === 'object' ? { ...prompt.files } : null,
      agents: Array.isArray(prompt.agents) ? [...prompt.agents] : [],
      variables: Array.isArray(prompt.variables) ? [...prompt.variables] : [],
      tags: Array.isArray(prompt.tags) ? [...prompt.tags] : [],
      isTemplate: !!prompt.isTemplate,
      templateId: prompt.templateId || null,
      createdAt: prompt.createdAt || now,
      updatedAt: now
    };

    const result = getSkillNest().savePrompt(promptData);
    if (result?.success !== false) {
      loadPrompts();
      return { success: true, prompt: promptData };
    }
    return { success: false, error: result?.error || 'Save failed' };
  } catch (e: any) {
    console.error('Failed to save prompt:', e);
    return { success: false, error: e.message };
  } finally {
    loading.value = false;
  }
}

function deletePrompt(id: string) {
  loading.value = true;
  try {
    const result = getSkillNest().deletePrompt(id);
    if (result?.success !== false) {
      if (activePrompt.value?.id === id) {
        activePrompt.value = null;
      }
      loadPrompts();
      return { success: true };
    }
    return { success: false, error: result?.error || 'Delete failed' };
  } catch (e: any) {
    console.error('Failed to delete prompt:', e);
    return { success: false, error: e.message };
  } finally {
    loading.value = false;
  }
}

function duplicatePrompt(id: string) {
  loading.value = true;
  try {
    const result = getSkillNest().duplicatePrompt(id);
    if (result?.success !== false) {
      loadPrompts();
      return { success: true, prompt: result?.prompt };
    }
    return { success: false, error: result?.error || 'Duplicate failed' };
  } catch (e: any) {
    console.error('Failed to duplicate prompt:', e);
    return { success: false, error: e.message };
  } finally {
    loading.value = false;
  }
}

function setActivePrompt(prompt: Prompt | null): void {
  activePrompt.value = prompt ? { ...prompt } : null;
}

function exportPrompts(): string | null {
  try {
    return JSON.stringify(prompts.value, null, 2);
  } catch (e) {
    console.error('Failed to export prompts:', e);
    return null;
  }
}

function importPrompts(jsonString: string) {
  loading.value = true;
  try {
    const data = JSON.parse(jsonString);
    if (!Array.isArray(data)) {
      return { success: false, error: 'Invalid format: expected array' };
    }

    let imported = 0;
    for (const prompt of data) {
      if (prompt.name && prompt.content) {
        const result = savePrompt(prompt);
        if (result.success) imported++;
      }
    }

    return { success: true, count: imported };
  } catch (e: any) {
    console.error('Failed to import prompts:', e);
    return { success: false, error: e.message };
  } finally {
    loading.value = false;
  }
}

function createFromTemplate(template: Partial<Prompt>): PromptSaveResult {
  return savePrompt({
    name: template.name,
    content: template.content,
    description: template.description,
    agents: template.agents || [],
    variables: template.variables || [],
    tags: template.tags || [],
    isTemplate: false,
    templateId: template.id || null
  });
}

function loadBackups(): void {
  try {
    backups.value = getSkillNest().getBackups() || {};
  } catch (e) {
    console.error('Failed to load backups:', e);
    backups.value = {};
  }
}

function backupOriginalPrompts() {
  loading.value = true;
  try {
    const result = getSkillNest().backupOriginalPrompts();
    if (result?.success !== false) {
      loadBackups();
      return { success: true };
    }
    return { success: false, error: result?.error || 'Backup failed' };
  } catch (e: any) {
    console.error('Failed to backup prompts:', e);
    return { success: false, error: e.message || 'Unknown error' };
  } finally {
    loading.value = false;
  }
}

function backupSelectedPrompts(selections: PromptBackupSelection[]) {
  loading.value = true;
  try {
    const result = getSkillNest().backupSelectedPrompts(selections);
    if (result?.success !== false) {
      loadBackups();
      return { success: true };
    }
    return { success: false, error: result?.error || 'Backup failed' };
  } catch (e: any) {
    console.error('Failed to backup prompts:', e);
    return { success: false, error: e.message || 'Unknown error' };
  } finally {
    loading.value = false;
  }
}

function loadOriginalPrompts(): void {
  try {
    originalPrompts.value = getSkillNest().readAllOriginalPrompts() || {};
  } catch (e) {
    console.error('Failed to load original prompts:', e);
    originalPrompts.value = {};
  }
}

function restoreOriginalPrompt(agent: string, fileName?: string) {
  loading.value = true;
  try {
    const result = getSkillNest().restoreOriginalPrompt(agent, fileName);
    if (result?.success !== false) {
      loadOriginalPrompts();
      return { success: true };
    }
    return { success: false, error: result?.error || 'Restore failed' };
  } catch (e: any) {
    console.error('Failed to restore prompt:', e);
    return { success: false, error: e.message };
  } finally {
    loading.value = false;
  }
}

function restoreAllOriginalPrompts() {
  loading.value = true;
  try {
    const results = getSkillNest().restoreAllOriginalPrompts();
    loadOriginalPrompts();
    const agents = Object.keys(results || {});
    const succeeded = agents.filter(a => results[a]?.success);
    const failed = agents.filter(a => !results[a]?.success);
    if (succeeded.length === 0) {
      return { success: false, error: '所有 Agent 恢复失败', results };
    }
    return { success: true, results, succeeded, failed };
  } catch (e: any) {
    console.error('Failed to restore all prompts:', e);
    return { success: false, error: e.message };
  } finally {
    loading.value = false;
  }
}

function hasBackup(agent: string): boolean {
  const agentBackups = backups.value[agent] as Record<string, { backedUpAt?: string }> | undefined;
  if (!agentBackups) return false;
  return Object.keys(agentBackups).some(f => !!agentBackups[f]?.backedUpAt);
}

function getBackupContent(agent: string): string {
  const agentBackups = backups.value[agent] as Record<string, { content?: string }> | undefined;
  if (!agentBackups) return '';
  const files = Object.keys(agentBackups);
  return files.length ? agentBackups[files[0]]?.content || '' : '';
}

function hasFileBackup(agent: string, fileName: string): boolean {
  return !!backups.value[agent]?.[fileName]?.backedUpAt;
}

function getFileBackupContent(agent: string, fileName: string): string {
  return backups.value[agent]?.[fileName]?.content || '';
}

function applyPromptToAgent(promptId: string, agent: string, fileName?: string | string[]) {
  loading.value = true;
  try {
    const result = getSkillNest().applyPromptToAgent(promptId, agent, fileName);
    if (result?.success !== false) {
      loadPrompts();
      return { success: true };
    }
    return { success: false, error: result?.error || 'Apply failed' };
  } catch (e: any) {
    console.error('Failed to apply prompt:', e);
    return { success: false, error: e.message };
  } finally {
    loading.value = false;
  }
}

function togglePromptAgent(promptId: string, agent: string, fileName?: string | string[]) {
  try {
    const result = getSkillNest().togglePromptAgent(promptId, agent, fileName);
    if (result?.success !== false) {
      loadPrompts();
      return { success: true, associated: result?.associated };
    }
    return { success: false, error: result?.error || 'Toggle failed' };
  } catch (e: any) {
    console.error('Failed to toggle agent:', e);
    return { success: false, error: e.message };
  }
}

export function usePrompts() {
  return {
    ALL_AGENTS,
    AGENT_LABELS,
    OPENCLAW_PROMPT_FILES,
    prompts,
    activePrompt,
    loading,
    activeAgentTab,
    filteredPrompts,
    backups,
    originalPrompts,
    loadPrompts,
    savePrompt,
    deletePrompt,
    duplicatePrompt,
    setActivePrompt,
    exportPrompts,
    importPrompts,
    createFromTemplate,
    loadBackups,
    backupOriginalPrompts,
    backupSelectedPrompts,
    loadOriginalPrompts,
    restoreOriginalPrompt,
    restoreAllOriginalPrompts,
    hasBackup,
    getBackupContent,
    hasFileBackup,
    getFileBackupContent,
    applyPromptToAgent,
    togglePromptAgent
  };
}
