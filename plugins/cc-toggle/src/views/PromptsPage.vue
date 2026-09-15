<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { ref, computed, onMounted } from 'vue';
  import { useRouter } from 'vue-router';
  import { usePrompts } from '../composables/usePrompts';
  import PromptCard from '../components/prompt/PromptCard.vue';
  import PromptEditor from '../components/prompt/PromptEditor.vue';
  import PromptPreview from '../components/prompt/PromptPreview.vue';

  const router = useRouter();
  const message = useMessage();
  const dialog = useDialog();

  const {
    prompts,
    loading,
    activePrompt,
    ALL_AGENTS,
    AGENT_LABELS,
    OPENCLAW_PROMPT_FILES,
    originalPrompts,
    backups,
    loadPrompts,
    deletePrompt,
    setActivePrompt,
    exportPrompts,
    importPrompts,
    loadBackups,
    backupOriginalPrompts,
    backupSelectedPrompts,
    loadOriginalPrompts,
    restoreOriginalPrompt,
    restoreAllOriginalPrompts,
    hasBackup,
    getBackupContent,
    hasFileBackup,
    getFileBackupContent
  } = usePrompts();

  // UI state
  const showEditor = ref(false);
  const showPreview = ref(false);
  const showRestore = ref(false);
  const showBackupModal = ref(false);
  const editingPrompt = ref(null);
  const viewingAgent = ref(null);
  const viewingContent = ref('');
  const viewingFile = ref(null); // { agent, fileName }
  const viewingFileContent = ref('');
  const selectedBackupAgents = ref([]);
  const openclawBackupFiles = ref([]);
  const openClawExpanded = ref(false);

  // Load prompts on mount
  onMounted(() => {
    loadPrompts();
    loadBackups();
    loadOriginalPrompts();
  });

  // Create new prompt
  function handleCreate() {
    editingPrompt.value = null;
    showEditor.value = true;
  }

  // Edit prompt
  function handleEdit(prompt) {
    editingPrompt.value = { ...prompt };
    showEditor.value = true;
  }

  // Save prompt
  function handleSave() {
    message.success('提示词已保存');
    showEditor.value = false;
    editingPrompt.value = null;
  }

  // Delete prompt
  function handleDelete(prompt) {
    const result = deletePrompt(prompt.id);
    if (result.success) {
      message.success('提示词已删除');
      if (showPreview.value && activePrompt.value?.id === prompt.id) {
        showPreview.value = false;
        setActivePrompt(null);
      }
    } else {
      message.error('删除失败');
    }
  }

  // Export prompts
  function handleExport() {
    const json = exportPrompts();
    if (json) {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'prompts-export.json';
      a.click();
      URL.revokeObjectURL(url);
      message.success('导出成功');
    }
  }

  // Import prompts
  function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = event => {
        const result = importPrompts(event.target.result);
        if (result.success) {
          message.success(`成功导入 ${result.count} 个提示词`);
        } else {
          message.error('导入失败：' + result.error);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // View backup content for agent
  function handleViewContent(agent) {
    viewingAgent.value = agent;
    viewingContent.value = getBackupContent(agent) || '';
  }

  // View backup content for a specific openclaw file
  function handleViewFileContent(agent, fileName) {
    viewingFile.value = { agent, fileName };
    viewingFileContent.value = getFileBackupContent(agent, fileName) || '';
  }

  // Close the content view modal
  function closeContentView() {
    viewingAgent.value = null;
    viewingFile.value = null;
  }

  // Edit prompt from preview
  function handlePreviewEdit(prompt) {
    showPreview.value = false;
    handleEdit(prompt);
  }

  // 已备份文件数（openclaw 多文件）
  function backupFileCount(agent) {
    const agentBackups = backups.value[agent] || {};
    return Object.keys(agentBackups).filter(f => !!agentBackups[f]?.backedUpAt).length;
  }

  const viewTitle = computed(() => {
    if (viewingFile.value)
      return `${AGENT_LABELS[viewingFile.value.agent]}/${viewingFile.value.fileName} 备份内容`;
    if (viewingAgent.value) return `${AGENT_LABELS[viewingAgent.value]} 备份内容`;
    return '';
  });
  const viewBody = computed(() =>
    viewingFile.value ? viewingFileContent.value : viewingContent.value
  );

  // Open backup modal
  function handleBackup() {
    selectedBackupAgents.value = [];
    openclawBackupFiles.value = [];
    showBackupModal.value = true;
  }

  // 勾选 / 取消某个 Agent（openclaw 选中时默认全选 6 个提示词文件）
  function toggleBackupAgent(agent) {
    const idx = selectedBackupAgents.value.indexOf(agent);
    if (idx === -1) {
      selectedBackupAgents.value.push(agent);
      if (agent === 'openclaw') {
        openclawBackupFiles.value = OPENCLAW_PROMPT_FILES.map(f => f.file);
      }
    } else {
      selectedBackupAgents.value.splice(idx, 1);
    }
  }

  // 勾选 / 取消 openclaw 具体文件
  function toggleOpenClawFile(file) {
    const idx = openclawBackupFiles.value.indexOf(file);
    if (idx === -1) {
      openclawBackupFiles.value.push(file);
    } else {
      openclawBackupFiles.value.splice(idx, 1);
    }
  }

  // Confirm backup selected agents
  function handleConfirmBackup() {
    if (selectedBackupAgents.value.length === 0) {
      message.warning('请至少选择一个 Agent');
      return;
    }
    const selections = selectedBackupAgents.value.map(agent => {
      if (agent === 'openclaw') {
        return { agent: 'openclaw', files: [...openclawBackupFiles.value] };
      }
      return { agent };
    });
    const result = backupSelectedPrompts(selections);
    if (result.success) {
      message.success(`已备份 ${selectedBackupAgents.value.length} 个 Agent 的原始提示词`);
      showBackupModal.value = false;
    } else {
      message.error('备份失败：' + (result.error || '未知错误'));
    }
  }

  // Restore single agent / single file prompt
  function handleRestore(agent, fileName) {
    const label = fileName ? `${AGENT_LABELS[agent]}/${fileName}` : AGENT_LABELS[agent];
    dialog.warning({
      title: '恢复原始提示词',
      content: `确定恢复 ${label} 的原始提示词？当前内容将被覆盖。`,
      positiveText: '恢复',
      negativeText: '取消',
      onPositiveClick: () => {
        const result = restoreOriginalPrompt(agent, fileName);
        if (result.success) {
          message.success(`已恢复 ${label} 的原始提示词`);
        } else {
          message.error(`恢复失败：${result.error}`);
        }
      }
    });
  }

  // Restore all prompts
  function handleRestoreAll() {
    const backupCount = ALL_AGENTS.filter(a => hasBackup(a)).length;
    if (backupCount === 0) {
      message.warning('没有可恢复的备份');
      return;
    }
    dialog.warning({
      title: '恢复所有原始提示词',
      content: `确定恢复所有 Agent 的原始提示词？共 ${backupCount} 个备份，当前内容将被覆盖。`,
      positiveText: '恢复',
      negativeText: '取消',
      onPositiveClick: () => {
        const result = restoreAllOriginalPrompts();
        if (result.success) {
          const count = result.succeeded?.length || 0;
          const failCount = result.failed?.length || 0;
          if (failCount > 0) {
            message.warning(`已恢复 ${count} 个，${failCount} 个失败`);
          } else {
            message.success(`已恢复所有原始提示词（${count} 个）`);
          }
        } else {
          message.error(result.error || '恢复失败');
        }
      }
    });
  }
</script>

<template>
  <div class="prompts-page">
    <n-page-header title="提示词管理" @back="router.push('/')">
      <template #extra>
        <n-space :size="8">
          <n-button size="small" quaternary @click="handleBackup">备份原始</n-button>
          <n-button size="small" quaternary @click="showRestore = true">恢复原始</n-button>
          <n-button size="small" quaternary @click="handleImport">导入</n-button>
          <n-button size="small" quaternary @click="handleExport">导出</n-button>
          <n-button type="primary" size="small" @click="handleCreate">+ 新建</n-button>
        </n-space>
      </template>
    </n-page-header>

    <div class="sub-content">
      <div v-if="loading" class="prompts-page__loading">
        <n-text depth="3">加载中...</n-text>
      </div>

      <div v-else-if="prompts.length === 0" class="prompts-page__empty">
        <n-text depth="3">暂无提示词</n-text>
        <n-space :size="8" justify="center" style="margin-top: 12px">
          <n-button size="small" @click="handleCreate">新建提示词</n-button>
        </n-space>
      </div>

      <div v-else class="prompts-page__list">
        <PromptCard
          v-for="prompt in prompts"
          :key="prompt.id"
          :prompt="prompt"
          @edit="handleEdit"
          @delete="handleDelete"
          @updated="loadPrompts"
        />
      </div>
    </div>

    <!-- Editor Drawer -->
    <PromptEditor
      v-model:show="showEditor"
      :prompt="editingPrompt"
      @save="handleSave"
      @cancel="showEditor = false"
    />

    <!-- Preview Modal -->
    <n-modal :show="showPreview" @update:show="showPreview = $event">
      <PromptPreview
        v-if="activePrompt"
        :prompt="activePrompt"
        @close="showPreview = false"
        @edit="handlePreviewEdit"
      />
    </n-modal>

    <!-- Restore Drawer -->
    <n-drawer :show="showRestore" :width="'50%'" @update:show="showRestore = $event">
      <n-drawer-content title="恢复原始提示词" closable>
        <div class="restore-list">
          <div v-for="agent in ALL_AGENTS" :key="agent" class="restore-item">
            <div class="restore-info">
              <span class="restore-agent">{{ AGENT_LABELS[agent] }}</span>
              <span class="restore-status" v-if="hasBackup(agent)"> 已备份 </span>
              <span class="restore-status restore-status--none" v-else> 未备份 </span>
              <div class="restore-actions">
                <n-button
                  v-if="agent === 'openclaw'"
                  size="tiny"
                  quaternary
                  @click="openClawExpanded = !openClawExpanded"
                >
                  {{ openClawExpanded ? '收起' : '按文件展开' }}
                </n-button>
                <n-button
                  v-if="originalPrompts[agent]"
                  size="tiny"
                  quaternary
                  @click="handleViewContent(agent)"
                >
                  查看
                </n-button>
                <n-button
                  size="tiny"
                  quaternary
                  :disabled="!hasBackup(agent)"
                  @click="handleRestore(agent)"
                >
                  恢复全部
                </n-button>
              </div>
            </div>
            <div class="restore-content" v-if="hasBackup(agent) && getBackupContent(agent)">
              <pre
                >{{ getBackupContent(agent).substring(0, 80)
                }}{{ getBackupContent(agent).length > 80 ? '...' : '' }}</pre>
            </div>
            <div class="restore-content restore-content--empty" v-else-if="hasBackup(agent)">
              {{
                agent === 'openclaw'
                  ? `已备份 ${backupFileCount(agent)} 个文件，点「按文件展开」查看`
                  : '备份内容为空'
              }}
            </div>
            <div class="restore-content restore-content--empty" v-else>无备份</div>

            <template v-if="agent === 'openclaw' && openClawExpanded">
              <div class="restore-file-list">
                <div v-for="f in OPENCLAW_PROMPT_FILES" :key="f.file" class="restore-file-item">
                  <div class="restore-file-info">
                    <span class="restore-file-name">{{ f.file }}</span>
                    <span class="restore-file-label">{{ f.label }}</span>
                    <span class="restore-status" v-if="hasFileBackup('openclaw', f.file)">
                      已备份
                    </span>
                    <span class="restore-status restore-status--none" v-else> 未备份 </span>
                  </div>
                  <div class="restore-file-actions">
                    <n-button
                      size="tiny"
                      quaternary
                      :disabled="!hasFileBackup('openclaw', f.file)"
                      @click="handleViewFileContent('openclaw', f.file)"
                    >
                      查看
                    </n-button>
                    <n-button
                      size="tiny"
                      quaternary
                      :disabled="!hasFileBackup('openclaw', f.file)"
                      @click="handleRestore('openclaw', f.file)"
                    >
                      恢复
                    </n-button>
                  </div>
                </div>
                <div class="restore-file-item restore-file-item--memory">
                  <div class="restore-file-info">
                    <span class="restore-file-name">MEMORY.md</span>
                    <span class="restore-file-label">记忆文件</span>
                  </div>
                  <n-text depth="3" style="font-size: 11px">不参与恢复</n-text>
                </div>
              </div>
            </template>
          </div>
        </div>

        <template #footer>
          <n-space justify="end">
            <n-button @click="showRestore = false">取消</n-button>
            <n-button
              type="warning"
              :disabled="!ALL_AGENTS.some(a => hasBackup(a))"
              @click="handleRestoreAll"
              >恢复全部</n-button
            >
          </n-space>
        </template>
      </n-drawer-content>
    </n-drawer>

    <!-- Backup Selection Modal -->
    <n-modal :show="showBackupModal" @update:show="showBackupModal = $event">
      <n-card
        style="width: 400px; max-width: 90vw"
        title="备份原始提示词"
        :bordered="false"
        size="small"
      >
        <div class="backup-agent-list">
          <div
            v-for="agent in ALL_AGENTS"
            :key="agent"
            class="backup-agent-item"
            @click="toggleBackupAgent(agent)"
          >
            <n-checkbox
              :checked="selectedBackupAgents.includes(agent)"
              style="pointer-events: none"
            >
              {{ AGENT_LABELS[agent] }}
            </n-checkbox>
            <span v-if="hasBackup(agent)" class="backup-agent-hint">已备份</span>
          </div>

          <div v-if="selectedBackupAgents.includes('openclaw')" class="backup-file-list">
            <div
              v-for="f in OPENCLAW_PROMPT_FILES"
              :key="f.file"
              class="backup-file-item"
              @click="toggleOpenClawFile(f.file)"
            >
              <n-checkbox
                :checked="openclawBackupFiles.includes(f.file)"
                style="pointer-events: none"
              >
                {{ f.file }}
              </n-checkbox>
              <span class="backup-file-label">{{ f.label }}</span>
            </div>
            <div class="backup-file-item backup-file-item--disabled">
              <n-checkbox disabled style="pointer-events: none">MEMORY.md</n-checkbox>
              <span class="backup-agent-hint">记忆文件不参与备份</span>
            </div>
          </div>
        </div>
        <template #footer>
          <n-space justify="end">
            <n-button @click="showBackupModal = false">取消</n-button>
            <n-button
              type="primary"
              :disabled="selectedBackupAgents.length === 0"
              @click="handleConfirmBackup"
            >
              备份（{{ selectedBackupAgents.length }}）
            </n-button>
          </n-space>
        </template>
      </n-card>
    </n-modal>

    <!-- View Content Modal -->
    <n-modal
      :show="!!viewingAgent || !!viewingFile"
      @update:show="
        v => {
          if (!v) closeContentView();
        }
      "
    >
      <n-card
        style="width: 600px; max-width: 90vw; max-height: 80vh"
        :title="viewTitle"
        :bordered="false"
        size="small"
      >
        <template #header-extra>
          <n-button quaternary size="small" @click="closeContentView">关闭</n-button>
        </template>
        <pre v-if="viewBody" class="view-content">{{ viewBody }}</pre>
        <n-text v-else depth="3" style="display: block; padding: 20px; text-align: center"
          >暂无提示词内容</n-text
        >
      </n-card>
    </n-modal>
  </div>
</template>

<style lang="scss" scoped>
  .prompts-page {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  /* n-page-header 统一样式 */
  .prompts-page :deep(.n-page-header) {
    padding: 8px 16px;
    min-height: 44px;
    border-bottom: 1px solid var(--border);
  }
  .prompts-page :deep(.n-page-header__title) {
    font-size: 14px !important;
    font-weight: 600;
  }
  .prompts-page :deep(.n-page-header__back) {
    margin-right: 8px;
  }
  .prompts-page :deep(.n-page-header__back:hover) {
    color: var(--primary);
  }
  .prompts-page :deep(.n-page-header .n-button) {
    font-size: 12px;
  }

  .sub-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .prompts-page__loading,
  .prompts-page__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    color: var(--text-secondary);
  }

  .prompts-page__list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .restore-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .restore-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-hover);
  }

  .restore-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .restore-agent {
    font-size: 13px;
    font-weight: 600;
  }

  .restore-status {
    font-size: 11px;
    color: var(--success);
  }

  .restore-status--none {
    color: var(--text-muted);
  }

  .restore-content {
    font-size: 12px;
    color: var(--text-secondary);
    background: var(--bg-card);
    padding: 8px;
    border-radius: 4px;
    max-height: 60px;
    overflow: hidden;
  }

  .restore-content pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    font-family: monospace;
    font-size: 11px;
  }

  .restore-content--empty {
    color: var(--text-muted);
    font-style: italic;
  }

  .restore-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .view-content {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    font-family: monospace;
    font-size: 12px;
    line-height: 1.6;
    max-height: 60vh;
    overflow-y: auto;
    background: var(--bg-hover);
    padding: 12px;
    border-radius: 6px;
  }

  .backup-agent-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .backup-agent-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-hover);
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .backup-agent-item:hover {
    border-color: var(--primary);
  }

  .backup-agent-hint {
    font-size: 11px;
    color: var(--success);
  }

  /* openclaw 按文件展开 */
  .restore-file-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-left: 8px;
    padding-left: 12px;
    border-left: 2px solid var(--border);
  }

  .restore-file-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    background: var(--bg-card);
    border-radius: 4px;
  }

  .restore-file-item--memory {
    opacity: 0.6;
  }

  .restore-file-info {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: nowrap;
  }

  .restore-file-name {
    font-size: 12px;
    font-weight: 500;
    font-family: monospace;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .restore-file-label {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
    min-width: 0;
  }

  .restore-file-info .restore-status {
    flex-shrink: 0;
  }

  .restore-file-actions {
    flex-shrink: 0;
  }

  .backup-file-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-left: 8px;
    padding-left: 12px;
    border-left: 2px solid var(--border);
  }

  .backup-file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
  }

  .backup-file-item:hover {
    background: var(--bg-card);
  }

  .backup-file-item--disabled {
    cursor: default;
    opacity: 0.6;
  }

  .backup-file-item--disabled:hover {
    background: none;
  }

  .backup-file-label {
    font-size: 11px;
    color: var(--text-secondary);
  }
</style>
