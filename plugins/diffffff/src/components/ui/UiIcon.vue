<!--
  UiIcon：Lucide 线框图标的统一入口（薄封装）。

  北欧视觉原则：图标是简洁图示而非写实图形。统一在本地控制线宽
  （stroke-width 1.6，比 Lucide 默认 2 更细，贴合「纸 + 薄木板」的轻质感），
  颜色永远继承 currentColor（由消费方文字色驱动，随主题自动切换）。
  lucide-vue-next 按命名导入、构建期 tree-shake，无额外资源请求。
-->
<script setup lang="ts">
import type { Component } from 'vue'
import {
  AppWindow,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardPaste,
  Copy,
  FoldVertical,
  FolderOpen,
  Pencil,
  Search,
  Settings,
  Trash2,
  UnfoldVertical,
  X,
} from 'lucide-vue-next'

/** 图标名：按需在 ICONS 内登记，未知名渲染为空（防御）。 */
export type IconName =
  | 'window'
  | 'settings'
  | 'trash'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'x'
  | 'check'
  | 'copy'
  | 'swap'
  | 'unfold'
  | 'fold'
  | 'folder-open'
  | 'clipboard'
  | 'pencil'
  | 'search'
  | 'detach'

const props = withDefaults(
  defineProps<{
    name: IconName
    /** 渲染尺寸（正方形边长，px） */
    size?: number
  }>(),
  { size: 16 },
)

/** 名字 → Lucide 组件映射（component :is 动态渲染，保持消费方 API 简洁） */
const ICONS: Record<IconName, Component> = {
  window: AppWindow,
  settings: Settings,
  trash: Trash2,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  x: X,
  check: Check,
  copy: Copy,
  swap: ArrowLeftRight,
  unfold: UnfoldVertical,
  fold: FoldVertical,
  'folder-open': FolderOpen,
  clipboard: ClipboardPaste,
  pencil: Pencil,
  search: Search,
  detach: ArrowUpRight,
}
</script>

<template>
  <component
    :is="ICONS[props.name]"
    :size="props.size"
    :stroke-width="1.6"
    aria-hidden="true"
  />
</template>
