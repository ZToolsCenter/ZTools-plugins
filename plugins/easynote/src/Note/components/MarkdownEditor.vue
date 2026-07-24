<template>
  <div class="md-editor" @wheel="onWheel">
    <MilkdownEditor
      v-if="mode === 'wysiwyg'"
      :model-value="content"
      @update:model-value="onUpdate"
    />
    <div v-else class="md-split">
      <textarea
        class="md-textarea"
        :value="content"
        placeholder="输入 Markdown..."
        spellcheck="false"
        @input="onTextInput"
      />
      <div class="md-preview markdown-body" v-html="rendered" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MilkdownEditor from './MilkdownEditor.vue'
import { renderMarkdown } from '../utils/md'
import { useSettings, type EditMode } from '../composables/useSettings'

const props = defineProps<{ content: string; mode: EditMode }>()
const emit = defineEmits<{ (e: 'update:content', v: string): void }>()

const { adjustFontSize } = useSettings()

const rendered = computed(() => renderMarkdown(props.content))

function onUpdate(v: string) {
  emit('update:content', v)
}

function onTextInput(e: Event) {
  emit('update:content', (e.target as HTMLTextAreaElement).value)
}

// Ctrl + 滚轮 调整字号
function onWheel(e: WheelEvent) {
  if (!e.ctrlKey) return
  e.preventDefault()
  adjustFontSize(e.deltaY)
}
</script>
