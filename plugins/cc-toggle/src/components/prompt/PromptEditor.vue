<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
  import {
    NDrawer,
    NDrawerContent,
    NInput,
    NButton,
    NSpace,
    NText,
    NTabs,
    NTabPane,
    NSelect,
    NSwitch
  } from 'naive-ui';
  import { usePrompts } from '../../composables/usePrompts';
  import { useAiOptimize } from '../../composables/useAiOptimize';
  import { renderMarkdown } from '../../utils/markdown';

  const props = defineProps({
    show: { type: Boolean, default: false },
    prompt: { type: Object, default: null }
  });

  const emit = defineEmits(['update:show', 'save', 'cancel']);

  const { savePrompt, OPENCLAW_PROMPT_FILES } = usePrompts();
  const { streaming: aiStreaming, optimize, abort: abortAi } = useAiOptimize();

  // Form state
  const formData = ref({
    id: null,
    name: '',
    description: '',
    content: '',
    fileName: 'AGENTS.md',
    files: null,
    agents: [],
    tags: []
  });

  const activeTab = ref('edit');
  const activePackFile = ref('AGENTS.md');
  const personaPackMode = ref(false);
  const isSaving = ref(false);
  const packTabsRef = ref(null);

  // 切换文件 tab 时，自动滚动导航条让被选中的 tab 完整可见
  // 用双 rAF 等布局/自适应完全稳定后再滚，避免中途测量把弹窗滚动带跑
  watch(activePackFile, () => {
    requestAnimationFrame(() => requestAnimationFrame(scrollActivePackTabIntoView));
  });

  function scrollActivePackTabIntoView() {
    const tabsEl = packTabsRef.value?.$el;
    if (!tabsEl) return;
    const scrollContainer = tabsEl.querySelector('.v-x-scroll');
    const tab = tabsEl.querySelector('.n-tabs-tab[data-name="' + activePackFile.value + '"]');
    if (!scrollContainer || !tab) return;
    const cRect = scrollContainer.getBoundingClientRect();
    const tRect = tab.getBoundingClientRect();
    if (tRect.left < cRect.left) {
      // 多滚动约 1.5 个 tab 宽度，让前边的 tab 也露出一截
      const prevTab =
        tab.parentElement && tab.parentElement.previousElementSibling
          ? tab.parentElement.previousElementSibling.querySelector('.n-tabs-tab')
          : null;
      const extra = (prevTab ? prevTab.offsetWidth : tab.offsetWidth) * 1.5;
      scrollContainer.scrollLeft += tRect.left - cRect.left - extra;
    } else if (tRect.right > cRect.right) {
      // 多滚动约 1.5 个 tab 宽度，让后边的 tab 也露出一截
      const nextTab =
        tab.parentElement && tab.parentElement.nextElementSibling
          ? tab.parentElement.nextElementSibling.querySelector('.n-tabs-tab')
          : null;
      const extra = (nextTab ? nextTab.offsetWidth : tab.offsetWidth) * 1.5;
      scrollContainer.scrollLeft += tRect.right - cRect.right + extra;
    }
  }

  // 目标文件下拉（仅 openclaw 生效）
  const fileOptions = computed(() => {
    return OPENCLAW_PROMPT_FILES.map(f => ({
      label: `${f.file} — ${f.label}`,
      value: f.file
    }));
  });

  const openClawBound = computed(() => {
    return Array.isArray(formData.value.agents) && formData.value.agents.includes('openclaw');
  });

  const mixedAgents = computed(() => {
    return openClawBound.value && formData.value.agents.some(a => a !== 'openclaw');
  });

  // Rendered markdown content
  const renderedContent = computed(() => {
    const content = personaPackMode.value
      ? formData.value.files?.[activePackFile.value] || ''
      : formData.value.content;
    return renderMarkdown(content) || '<p style="color: var(--text-secondary);">暂无内容</p>';
  });

  // 初始化人设包文件字典（保留已有内容，AGENTS.md 回退到 content）
  function initPersonaFiles() {
    const files = {};
    OPENCLAW_PROMPT_FILES.forEach(f => {
      const existing = formData.value.files?.[f.file];
      files[f.file] =
        existing != null ? existing : f.file === 'AGENTS.md' ? formData.value.content : '';
    });
    formData.value.files = files;
  }

  // 切换人设包模式
  function handlePersonaPackChange(checked) {
    if (checked) {
      initPersonaFiles();
    } else {
      formData.value.files = null;
    }
  }

  // Watch for prompt prop changes
  watch(
    () => props.prompt,
    newPrompt => {
      if (newPrompt) {
        personaPackMode.value = !!(newPrompt.files && Object.keys(newPrompt.files).length > 0);
        formData.value = {
          id: newPrompt.id || null,
          name: newPrompt.name || '',
          description: newPrompt.description || '',
          content: newPrompt.content || '',
          fileName: newPrompt.fileName || 'AGENTS.md',
          files: newPrompt.files ? { ...newPrompt.files } : null,
          agents: Array.isArray(newPrompt.agents) ? [...newPrompt.agents] : [],
          tags: newPrompt.tags || []
        };
        if (personaPackMode.value) initPersonaFiles();
      } else {
        resetForm();
      }
    },
    { immediate: true }
  );

  // 关闭弹窗时重置表单，避免下次打开残留上次内容
  watch(
    () => props.show,
    visible => {
      if (!visible) resetForm();
    }
  );

  // Reset form
  function resetForm() {
    formData.value = {
      id: null,
      name: '',
      description: '',
      content: '',
      fileName: 'AGENTS.md',
      files: null,
      agents: [],
      tags: []
    };
    personaPackMode.value = false;
    activePackFile.value = 'AGENTS.md';
  }

  // Save handler
  async function handleSave() {
    if (!formData.value.name.trim()) {
      return;
    }

    isSaving.value = true;
    try {
      const data = { ...formData.value };
      if (personaPackMode.value) {
        data.content = data.files?.['AGENTS.md'] ?? data.content;
        data.fileName = null;
      }
      const result = await savePrompt(data);
      if (result.success) {
        emit('save', result.prompt);
        emit('update:show', false);
      }
    } finally {
      isSaving.value = false;
    }
  }

  // Cancel handler
  function handleCancel() {
    resetForm();
    emit('cancel');
    emit('update:show', false);
  }

  // AI Optimize handler
  async function handleAiOptimize() {
    const content = personaPackMode.value
      ? formData.value.files?.[activePackFile.value] || ''
      : formData.value.content;
    if (!content.trim()) return;

    try {
      await optimize(content, text => {
        if (personaPackMode.value) {
          if (formData.value.files) formData.value.files[activePackFile.value] = text;
        } else {
          formData.value.content = text;
        }
      });
    } catch {
      // 用户中止或错误，不做额外处理
    }
  }

  // Keyboard shortcuts
  function handleKeydown(e) {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      handleCancel();
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown);
  });

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown);
  });
</script>

<template>
  <n-drawer :show="show" :width="'50%'" @update:show="emit('update:show', $event)">
    <n-drawer-content :title="prompt?.id ? '编辑提示词' : '新建提示词'" closable>
      <n-tabs v-model:value="activeTab" type="line" size="small" class="prompt-editor__tabs">
        <n-tab-pane name="edit" tab="编辑">
          <div class="prompt-editor__form">
            <div class="prompt-editor__field">
              <n-text depth="3" class="prompt-editor__label">名称 *</n-text>
              <n-input v-model:value="formData.name" placeholder="输入提示词名称" size="small" />
            </div>

            <div class="prompt-editor__field">
              <n-text depth="3" class="prompt-editor__label">描述</n-text>
              <n-input
                v-model:value="formData.description"
                placeholder="输入描述（可选）"
                size="small"
              />
            </div>

            <div v-if="openClawBound" class="prompt-editor__field">
              <n-text depth="3" class="prompt-editor__label">目标文件</n-text>
              <n-select
                v-model:value="formData.fileName"
                :options="fileOptions"
                size="small"
                placeholder="选择 OpenClaw 提示词文件"
                :disabled="personaPackMode"
              />
              <n-text
                v-if="mixedAgents"
                depth="3"
                style="font-size: 12px; color: var(--text-secondary)"
              >
                目标文件仅对 OpenClaw 生效，其他 Agent 写入各自默认文件
              </n-text>
            </div>

            <div class="prompt-editor__field">
              <div class="prompt-editor__label-row">
                <div class="prompt-editor__label-left">
                  <n-text depth="3" class="prompt-editor__label">整套人设包</n-text>
                  <n-tooltip trigger="hover">
                    <template #trigger>
                      <span class="prompt-editor__hint-icon">?</span>
                    </template>
                    人设包模式：一个提示词同时携带 6 个提示词文件的内容，切换时一次全部写入
                  </n-tooltip>
                </div>
                <n-switch
                  :value="personaPackMode"
                  size="small"
                  @update:value="
                    v => {
                      personaPackMode = v;
                      handlePersonaPackChange(v);
                    }
                  "
                />
              </div>
              <n-text depth="3" style="font-size: 12px; color: var(--text-secondary)">
                仅对 OpenClaw 生效，其他 Agent 仍写各自默认文件
              </n-text>
            </div>

            <div v-if="personaPackMode" class="prompt-editor__field">
              <div class="prompt-editor__label-row">
                <n-text depth="3" class="prompt-editor__label">内容</n-text>
                <n-button
                  size="tiny"
                  quaternary
                  type="primary"
                  :loading="aiStreaming"
                  :disabled="!formData.files?.[activePackFile]?.trim()"
                  @click="aiStreaming ? abortAi() : handleAiOptimize()"
                >
                  {{ aiStreaming ? '中止' : '✨ AI 优化' }}
                </n-button>
              </div>
              <n-tabs
                ref="packTabsRef"
                v-model:value="activePackFile"
                type="line"
                size="small"
                :animated="false"
                class="prompt-editor__pack-tabs"
              >
                <n-tab-pane
                  v-for="f in OPENCLAW_PROMPT_FILES"
                  :key="f.file"
                  :name="f.file"
                  :tab="f.file"
                  display-directive="show"
                >
                  <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 6px">
                    {{ f.label }}
                  </n-text>
                  <n-input
                    v-model:value="formData.files[f.file]"
                    type="textarea"
                    placeholder="输入提示词内容（支持 Markdown）"
                    :autosize="{ minRows: 10, maxRows: 20 }"
                    :disabled="aiStreaming"
                  />
                </n-tab-pane>
              </n-tabs>
              <n-text depth="3" style="font-size: 12px; color: var(--text-secondary)">
                MEMORY.md 为记忆文件，不参与切换与备份
              </n-text>
            </div>

            <div v-else class="prompt-editor__field">
              <div class="prompt-editor__label-row">
                <n-text depth="3" class="prompt-editor__label">内容</n-text>
                <n-button
                  size="tiny"
                  quaternary
                  type="primary"
                  :loading="aiStreaming"
                  :disabled="!formData.content.trim()"
                  @click="aiStreaming ? abortAi() : handleAiOptimize()"
                >
                  {{ aiStreaming ? '中止' : '✨ AI 优化' }}
                </n-button>
              </div>
              <n-input
                v-model:value="formData.content"
                type="textarea"
                placeholder="输入提示词内容（支持 Markdown）"
                :autosize="{ minRows: 12, maxRows: 25 }"
                :disabled="aiStreaming"
              />
            </div>
          </div>
        </n-tab-pane>

        <n-tab-pane name="preview" tab="预览">
          <div class="prompt-editor__preview markdown-body" v-html="renderedContent"></div>
        </n-tab-pane>
      </n-tabs>

      <template #footer>
        <n-space justify="end">
          <n-button size="small" @click="handleCancel">取消</n-button>
          <n-button
            type="primary"
            size="small"
            :loading="isSaving"
            :disabled="!formData.name.trim() || aiStreaming"
            @click="handleSave"
          >
            保存 (Ctrl+S)
          </n-button>
        </n-space>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>

<style lang="scss" scoped>
  .prompt-editor__tabs {
    :deep(.n-tabs-nav) {
      margin-bottom: 12px;
    }
  }

  .prompt-editor__form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .prompt-editor__field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .prompt-editor__label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .prompt-editor__label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .prompt-editor__label-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .prompt-editor__hint-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    background: var(--bg-card);
    font-size: 10px;
    font-weight: 600;
    cursor: help;
    user-select: none;
  }

  .prompt-editor__preview {
    background: var(--bg-hover);
    border-radius: 6px;
    padding: 16px;
    font-size: 13px;
    line-height: 1.6;
    overflow-y: auto;
  }

  .markdown-body {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text);

    :deep(h1),
    :deep(h2),
    :deep(h3) {
      margin: 12px 0 8px;
      font-weight: 600;
    }

    :deep(h1) {
      font-size: 18px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }

    :deep(h2) {
      font-size: 16px;
    }

    :deep(h3) {
      font-size: 14px;
    }

    :deep(p) {
      margin: 8px 0;
    }

    :deep(code) {
      background: var(--bg-card);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
      font-family: monospace;
    }

    :deep(pre) {
      background: var(--bg-card);
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
    }

    :deep(pre code) {
      background: none;
      padding: 0;
    }

    :deep(blockquote) {
      border-left: 3px solid var(--primary);
      padding-left: 12px;
      margin: 8px 0;
      color: var(--text-secondary);
    }

    :deep(ul),
    :deep(ol) {
      padding-left: 20px;
      margin: 8px 0;
    }

    :deep(li) {
      margin: 4px 0;
    }

    :deep(a) {
      color: var(--primary);
      text-decoration: none;
    }

    :deep(a:hover) {
      text-decoration: underline;
    }

    :deep(table) {
      border-collapse: collapse;
      width: 100%;
      margin: 8px 0;
    }

    :deep(th),
    :deep(td) {
      border: 1px solid var(--border);
      padding: 8px 12px;
      text-align: left;
    }

    :deep(th) {
      background: var(--bg-card);
      font-weight: 600;
    }

    :deep(hr) {
      border: none;
      border-top: 1px solid var(--border);
      margin: 16px 0;
    }

    :deep(img) {
      max-width: 100%;
      border-radius: 4px;
    }
  }
</style>
