<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { computed, ref } from 'vue';
  import { usePrompts } from '../../composables/usePrompts';

  const props = defineProps({
    prompt: { type: Object, required: true }
  });

  const emit = defineEmits(['edit', 'delete', 'updated']);

  const message = useMessage();
  const dialog = useDialog();
  const { ALL_AGENTS, AGENT_LABELS, OPENCLAW_PROMPT_FILES, togglePromptAgent, applyPromptToAgent } =
    usePrompts();

  // Truncate content for preview
  function truncateContent(content, maxLength = 80) {
    if (!content) return '';
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  }

  // Check if agent is associated
  function isAgentAssociated(agent) {
    return props.prompt.agents?.includes(agent);
  }

  // ─── OpenClaw 多文件选择 ───

  const openClawAssociated = computed(() => isAgentAssociated('openclaw'));

  const isPackPrompt = computed(() => {
    return !!(props.prompt.files && Object.keys(props.prompt.files).length);
  });

  const openClawFullFiles = OPENCLAW_PROMPT_FILES.map(f => f.file);

  // 当前已应用的文件列表（openclaw）
  const openClawAppliedFiles = computed(() => {
    if (Array.isArray(props.prompt.fileNames) && props.prompt.fileNames.length) {
      return props.prompt.fileNames.filter(f => f !== 'MEMORY.md');
    }
    if (props.prompt.fileName) return [props.prompt.fileName];
    if (isPackPrompt.value) return openClawFullFiles;
    return [];
  });

  const openClawPackApplied = computed(() => {
    return (
      isPackPrompt.value &&
      openClawAppliedFiles.value.length === openClawFullFiles.length &&
      openClawFullFiles.every(f => openClawAppliedFiles.value.includes(f))
    );
  });

  // chip 标签：未关联 → OpenClaw；整套人设包 → 人设包；多文件 → 首个 +N；单文件 → 文件名
  const openClawChipLabel = computed(() => {
    if (!openClawAssociated.value) return 'OpenClaw';
    const applied = openClawAppliedFiles.value;
    if (openClawPackApplied.value) return '人设包';
    if (applied.length > 1) return `${applied[0]} +${applied.length - 1}`;
    if (applied.length === 1) return applied[0];
    return 'AGENTS.md';
  });

  // 多选面板状态
  const openClawMenuOpen = ref(false);
  const selectedFiles = ref<string[]>([]);

  // 「整套人设包」= 是否全选 6 个文件（联动）
  const packChecked = computed(() => {
    return openClawFullFiles.every(f => selectedFiles.value.includes(f));
  });

  // 打开面板时初始化勾选状态
  function handleOpenClawMenu(show) {
    openClawMenuOpen.value = show;
    if (show) {
      selectedFiles.value = isPackPrompt.value
        ? [...openClawAppliedFiles.value]
        : [...openClawFullFiles];
    }
  }

  function toggleOpenClawFile(f) {
    const idx = selectedFiles.value.indexOf(f);
    if (idx === -1) selectedFiles.value.push(f);
    else selectedFiles.value.splice(idx, 1);
  }

  function togglePack() {
    if (packChecked.value) {
      selectedFiles.value = [];
    } else {
      selectedFiles.value = [...openClawFullFiles];
    }
  }

  function applySelectedOpenClaw() {
    if (packChecked.value && isPackPrompt.value) {
      const result = applyPromptToAgent(props.prompt.id, 'openclaw');
      if (result.success) {
        message.success('已应用整套人设包');
        openClawMenuOpen.value = false;
        emit('updated');
      } else {
        message.error('应用失败：' + (result.error || '未知错误'));
      }
      return;
    }
    if (selectedFiles.value.length === 0) {
      message.warning('请至少选择一个文件');
      return;
    }
    const result = applyPromptToAgent(props.prompt.id, 'openclaw', [...selectedFiles.value]);
    if (result.success) {
      message.success(`已应用到 OpenClaw ${selectedFiles.value.length} 个文件`);
      openClawMenuOpen.value = false;
      emit('updated');
    } else {
      message.error('应用失败：' + (result.error || '未知错误'));
    }
  }

  function unbindOpenClaw() {
    const result = togglePromptAgent(props.prompt.id, 'openclaw');
    if (result.success) {
      openClawMenuOpen.value = false;
      emit('updated');
    }
  }

  // Toggle agent association — apply to agent config when turning on, just un-associate when turning off
  function handleToggleAgent(agent) {
    if (isAgentAssociated(agent)) {
      // 取消关联：只更新数据库
      const result = togglePromptAgent(props.prompt.id, agent);
      if (result.success) {
        emit('updated');
      }
    } else {
      // 关联：写入 Agent 配置文件
      const result = applyPromptToAgent(props.prompt.id, agent);
      if (result.success) {
        message.success(`已应用到 ${AGENT_LABELS[agent]}`);
        emit('updated');
      } else {
        message.error('应用失败：' + (result.error || '未知错误'));
      }
    }
  }

  // Delete with confirmation dialog
  function confirmDelete() {
    dialog.warning({
      title: '删除提示词',
      content: `确定删除提示词「${props.prompt.name}」？`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => {
        emit('delete', props.prompt);
      }
    });
  }
</script>

<template>
  <div class="prompt-item" @click="emit('edit', prompt)">
    <div class="prompt-icon">📝</div>
    <div class="prompt-info">
      <span class="prompt-name">{{ prompt.name }}</span>
      <span v-if="prompt.description" class="prompt-desc">{{ prompt.description }}</span>
      <span class="prompt-preview">{{ truncateContent(prompt.content) }}</span>
    </div>
    <div class="prompt-agents" @click.stop>
      <button
        v-for="agent in ALL_AGENTS.filter(a => a !== 'openclaw')"
        :key="agent"
        class="agent-chip"
        :class="{ 'agent-chip--on': isAgentAssociated(agent) }"
        :title="isAgentAssociated(agent) ? '点击取消关联' : '点击应用到 ' + AGENT_LABELS[agent]"
        @click="handleToggleAgent(agent)"
      >
        {{ AGENT_LABELS[agent] }}
      </button>
      <n-popover
        trigger="click"
        placement="bottom-start"
        :show="openClawMenuOpen"
        @update:show="handleOpenClawMenu"
        style="padding: 0"
      >
        <template #trigger>
          <button
            class="agent-chip agent-chip--openclaw"
            :class="{ 'agent-chip--on': openClawAssociated }"
            :title="'点击选择要应用的文件'"
          >
            {{ openClawChipLabel }}
          </button>
        </template>
        <div class="openclaw-menu">
          <div
            v-for="f in OPENCLAW_PROMPT_FILES"
            :key="f.file"
            class="openclaw-menu__item"
            @click="toggleOpenClawFile(f.file)"
          >
            <n-checkbox :checked="selectedFiles.includes(f.file)" style="pointer-events: none">
              <span class="openclaw-menu__name">{{ f.file }}</span>
            </n-checkbox>
            <span class="openclaw-menu__label">{{ f.label }}</span>
          </div>
          <div class="openclaw-menu__item openclaw-menu__item--disabled">
            <n-checkbox disabled style="pointer-events: none">MEMORY.md</n-checkbox>
            <span class="openclaw-menu__label">记忆文件，不参与切换</span>
          </div>
          <div v-if="isPackPrompt" class="openclaw-menu__item" @click="togglePack">
            <n-checkbox :checked="packChecked" style="pointer-events: none">
              <span class="openclaw-menu__name">📦 整套人设包</span>
            </n-checkbox>
            <span class="openclaw-menu__label">一次写入全部 6 个文件</span>
          </div>
          <div class="openclaw-menu__footer">
            <n-button v-if="openClawAssociated" size="tiny" quaternary @click="unbindOpenClaw">
              取消关联
            </n-button>
            <n-button
              size="tiny"
              type="primary"
              :disabled="selectedFiles.length === 0 && !(packChecked && isPackPrompt)"
              @click="applySelectedOpenClaw"
            >
              应用所选
            </n-button>
          </div>
        </div>
      </n-popover>
    </div>
    <div class="prompt-actions" @click.stop>
      <button class="btn-delete" title="删除" @click="confirmDelete">✕</button>
    </div>
  </div>
</template>

<style scoped>
  .prompt-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-card);
    transition: border-color 0.15s;
    cursor: pointer;
  }

  .prompt-item:hover {
    border-color: var(--primary);
  }

  .prompt-icon {
    font-size: 18px;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .prompt-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .prompt-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
  }

  .prompt-desc {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .prompt-preview {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .prompt-agents {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }

  .agent-chip {
    padding: 3px 10px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--bg);
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-muted);
    white-space: nowrap;
    transition: all 0.15s;
  }

  .agent-chip:hover {
    border-color: var(--primary);
    color: var(--primary);
  }

  .agent-chip--on {
    border-color: var(--primary);
    color: var(--primary);
  }

  .prompt-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .btn-delete {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-delete:hover {
    border-color: var(--danger, #e74c3c);
    color: var(--danger, #e74c3c);
    background: rgba(231, 76, 60, 0.06);
  }

  /* OpenClaw 多选面板 */
  .openclaw-menu {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 240px;
    padding: 6px;
  }

  .openclaw-menu__item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .openclaw-menu__item:hover {
    background: var(--bg-hover);
  }

  .openclaw-menu__item--disabled {
    cursor: default;
    opacity: 0.55;
  }

  .openclaw-menu__item--disabled:hover {
    background: none;
  }

  .openclaw-menu__name {
    font-size: 12px;
    font-weight: 500;
    font-family: monospace;
  }

  .openclaw-menu__label {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .openclaw-menu__footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 6px;
    margin-top: 4px;
    border-top: 1px solid var(--border);
  }
</style>
