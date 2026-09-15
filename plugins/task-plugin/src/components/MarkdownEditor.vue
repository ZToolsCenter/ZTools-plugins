<template>
  <div class="rte" :class="{ 'rte-dark': dark }">
    <EditorContent v-if="editor" :editor="editor" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'

const props = defineProps<{ modelValue: string; dark?: boolean; placeholder?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const editor = shallowRef<Editor>()

function getMarkdown(): string {
  return (editor.value?.storage as any)?.markdown?.getMarkdown() ?? ''
}

onMounted(() => {
  editor.value = new Editor({
    content: props.modelValue || '',
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: props.placeholder ?? '输入描述，# 空格 为标题、- 空格 为列表、**加粗**…' }),
      Markdown.configure({ html: false, breaks: true, linkify: true })
    ],
    onUpdate: () => {
      emit('update:modelValue', getMarkdown())
    }
  })
})

// 外部重置（切换任务）时同步内容
let syncing = false
watch(
  () => props.modelValue,
  val => {
    const ed = editor.value
    if (!ed) return
    if (getMarkdown() === val) return
    syncing = true
    ed.commands.setContent(val || '')
    syncing = false
  }
)

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<style scoped>
.rte {
  width: 100%;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 6px;
  overflow: hidden;
}
.rte :deep(.ProseMirror) {
  min-height: 150px;
  max-height: 240px;
  overflow-y: auto;
  outline: none;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.7;
}
.rte :deep(.ProseMirror p) {
  margin: 4px 0;
}
.rte :deep(.ProseMirror h1) {
  font-size: 17px;
  margin: 8px 0 4px;
}
.rte :deep(.ProseMirror h2) {
  font-size: 15.5px;
  margin: 8px 0 4px;
}
.rte :deep(.ProseMirror h3) {
  font-size: 14px;
  margin: 6px 0 4px;
}
.rte :deep(.ProseMirror ul),
.rte :deep(.ProseMirror ol) {
  padding-left: 18px;
  margin: 4px 0;
}
.rte :deep(.ProseMirror blockquote) {
  border-left: 3px solid #18a058;
  padding-left: 10px;
  margin: 6px 0;
  opacity: 0.85;
}
.rte :deep(.ProseMirror code) {
  background: rgba(128, 128, 128, 0.15);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 12px;
}
.rte :deep(.ProseMirror pre) {
  background: rgba(128, 128, 128, 0.12);
  border-radius: 6px;
  padding: 8px 10px;
  overflow-x: auto;
}
.rte :deep(.ProseMirror pre code) {
  background: transparent;
  padding: 0;
}
.rte :deep(.ProseMirror hr) {
  border: none;
  border-top: 1px solid rgba(128, 128, 128, 0.3);
  margin: 8px 0;
}
.rte :deep(.ProseMirror a) {
  color: #18a058;
}
/* placeholder */
.rte :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
  opacity: 0.4;
}
</style>
