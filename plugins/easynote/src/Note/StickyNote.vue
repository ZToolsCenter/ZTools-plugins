<template>
  <div class="sticky" :style="{ '--note-font-size': settings.fontSize + 'px' }">
    <div class="sticky-titlebar">
      <span class="sticky-title" :title="draftTitle">{{ draftTitle || '便签' }}</span>
      <div class="sticky-actions">
        <el-button link size="small" @click="copyRaw">复制原文</el-button>
        <el-button link size="small" @click="copyPlain">复制纯文本</el-button>
        <el-button link size="small" type="primary" @click="onSave">保存</el-button>
        <el-button link size="small" :icon="Close" @click="onClose" />
      </div>
    </div>

    <MarkdownEditor
      :content="draft.content"
      :mode="settings.mode"
      @update:content="updateDraft"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Close } from '@element-plus/icons-vue'
import MarkdownEditor from './components/MarkdownEditor.vue'
import { useNotes } from './composables/useNotes'
import { useSettings } from './composables/useSettings'
import { toPlainText, extractTitle } from './utils/md'

const props = defineProps<{ embedded?: boolean }>()
const emit = defineEmits<{
  (e: 'back'): void
  (e: 'saved'): void
}>()

const { draft, savedNotes, updateDraft, saveDraft } = useNotes()
const { settings } = useSettings()

const draftTitle = computed(() => extractTitle(draft.value.content))

function onSave() {
  if (!draft.value.content.trim()) {
    ElMessage.warning('内容为空，未保存')
    return
  }
  saveDraft()
  ElMessage.success('已保存')
  emit('saved')
}

function copyRaw() {
  window.ztools.copyText(draft.value.content || '')
  ElMessage.success('已复制原文')
}

function copyPlain() {
  window.ztools.copyText(toPlainText(draft.value.content))
  ElMessage.success('已复制纯文本')
}

function onClose() {
  // 检查是否有未保存的修改
  const content = draft.value.content || ''
  const isDirty = content.trim() && (!draft.value.noteId || savedNotes.value.find((x) => x.id === draft.value.noteId)?.content !== content)
  if (isDirty && !confirm('当前便签有未保存的修改，确定要关闭吗？')) {
    return
  }
  // embedded（dev 主窗口内）：返回 Home；独立窗口：关闭自身
  if (props.embedded) emit('back')
  else window.close()
}
</script>
