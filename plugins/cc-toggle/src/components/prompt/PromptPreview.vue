<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { ref, computed } from 'vue';
  import { usePrompts } from '../../composables/usePrompts';

  const props = defineProps({
    prompt: { type: Object, required: true }
  });

  const emit = defineEmits(['close', 'edit']);

  const { AGENT_LABELS, OPENCLAW_PROMPT_FILES } = usePrompts();

  const activePackFile = ref('AGENTS.md');

  // 人设包模式
  const isPersonaPack = computed(() => {
    return !!(props.prompt.files && Object.keys(props.prompt.files).length > 0);
  });

  // 已应用文件（多文件时展示列表）
  const appliedFileLabel = computed(() => {
    if (Array.isArray(props.prompt.fileNames) && props.prompt.fileNames.length) {
      return props.prompt.fileNames.filter(f => f !== 'MEMORY.md').join(', ');
    }
    return props.prompt.fileName || '';
  });

  // 预览内容：人设包按 activePackFile，否则 content
  const previewContent = computed(() => {
    if (isPersonaPack.value) {
      return props.prompt.files[activePackFile.value] || '';
    }
    return props.prompt.content;
  });

  // Agent tags
  const agentTags = computed(() => {
    if (!props.prompt.agents?.length) return [];
    return props.prompt.agents.map(agent => ({
      label: AGENT_LABELS[agent] || agent,
      value: agent
    }));
  });

  const packFileOptions = computed(() => {
    return OPENCLAW_PROMPT_FILES.filter(f => (props.prompt.files || {})[f.file] != null);
  });
</script>

<template>
  <n-card
    style="width: 90%; max-width: 700px; max-height: 85vh"
    :title="prompt.name"
    :bordered="false"
    size="small"
  >
    <template #header-extra>
      <n-space :size="4">
        <n-button size="small" quaternary @click="emit('edit', prompt)"> 编辑 </n-button>
        <n-button size="small" quaternary @click="emit('close')"> 关闭 </n-button>
      </n-space>
    </template>

    <div class="prompt-preview">
      <div v-if="prompt.description" class="prompt-preview__desc">
        <n-text depth="3">{{ prompt.description }}</n-text>
      </div>

      <div class="prompt-preview__meta">
        <n-space :size="8" align="center">
          <n-text depth="3" strong>关联 Agent：</n-text>
          <n-tag
            v-for="tag in agentTags"
            :key="tag.value"
            size="small"
            :bordered="false"
            type="info"
          >
            {{ tag.label }}
          </n-tag>
          <template v-if="!isPersonaPack && appliedFileLabel">
            <n-text depth="3" strong>目标文件：</n-text>
            <n-tag size="small" :bordered="false" type="warning">{{ appliedFileLabel }}</n-tag>
          </template>
        </n-space>
      </div>

      <template v-if="isPersonaPack">
        <n-tabs v-model:value="activePackFile" type="line" size="small">
          <n-tab-pane v-for="f in packFileOptions" :key="f.file" :name="f.file" :tab="f.file">
            <div class="prompt-preview__content">
              <n-text>{{ previewContent }}</n-text>
            </div>
          </n-tab-pane>
        </n-tabs>
      </template>
      <div v-else class="prompt-preview__content">
        <n-text>{{ previewContent }}</n-text>
      </div>
    </div>
  </n-card>
</template>

<style lang="scss" scoped>
  .prompt-preview {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 12px 0;
  }

  .prompt-preview__desc {
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }

  .prompt-preview__meta {
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }

  .prompt-preview__content {
    padding: 16px;
    background: var(--bg-hover);
    border-radius: 6px;
    white-space: pre-wrap;
    font-size: 13px;
    line-height: 1.6;
    max-height: 400px;
    overflow-y: auto;
  }
</style>
