<template>
  <Milkdown />
</template>

<script setup lang="ts">
import { Milkdown, useEditor } from '@milkdown/vue'
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { nord } from '@milkdown/theme-nord'
import '@milkdown/theme-nord/style.css'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

// useEditor 必须在 MilkdownProvider 的子组件中调用（inject provider 提供的 context）。
// 回调返回「未 create 的 Editor」，由 Milkdown 组件内部（useGetEditor）负责 create()。
useEditor((root) =>
  Editor.make()
    .config(nord)
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, props.modelValue || '')
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        if (markdown !== props.modelValue) emit('update:modelValue', markdown)
      })
    })
    .use(commonmark)
    .use(listener)
)
</script>
