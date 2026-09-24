<!--
  UiSelect：北欧风下拉选择（替代 ztools-ui ZSelect，reka-ui Select 系列）。

  与原 API 对齐：modelValue（string | null）+ options[{label, value}] +
  placeholder + disabled，emit update:modelValue（恒 string）。modelValue 为
  null 时触发器显示 placeholder（「动作菜单」模式复用此形态：选中即回弹 null）。

  视觉：触发器 = 纸面按钮 + 细描边 + 行尾 chevron；浮层 = Portal 到 body 的
  纸面卡片（发丝边 + 轻阴影 + 小圆角），条目 hover 轻洗色，选中项以雾松绿
  小圆点标记（Scandi 的「彩色小点做状态标记」）。宽度由消费方控制：默认
  inline-flex，外层给定宽（pane 头部 88px）或满宽（侧边栏）均可。
-->
<script setup lang="ts">
import { SelectContent, SelectItem, SelectItemText, SelectPortal, SelectRoot, SelectTrigger, SelectValue, SelectViewport } from 'reka-ui'
import UiIcon from './UiIcon.vue'

withDefaults(
  defineProps<{
    /** 当前值：null 显示 placeholder（动作菜单 / 未选择） */
    modelValue: string | null
    options: { label: string; value: string }[]
    placeholder?: string
    disabled?: boolean
    ariaLabel?: string
  }>(),
  { placeholder: '', disabled: false, ariaLabel: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <SelectRoot
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', String($event))"
  >
    <SelectTrigger class="ui-select-trigger" :aria-label="ariaLabel">
      <SelectValue class="ui-select-value" :placeholder="placeholder" />
      <UiIcon name="chevron-down" :size="13" class="ui-select-chevron" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        class="ui-select-content"
        position="popper"
        :side-offset="4"
        :avoid-collisions="true"
      >
        <SelectViewport class="ui-select-viewport">
          <SelectItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            class="ui-select-item"
          >
            <span class="ui-select-item-dot" aria-hidden="true"></span>
            <SelectItemText>{{ option.label }}</SelectItemText>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style scoped>
/* 触发器：与 UiButton small 同档（高 26px），纸面 + 细描边 */
.ui-select-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--control-border, #ddd7cb);
  border-radius: var(--radius-s, 6px);
  background-color: var(--surface, #ffffff);
  color: var(--text-color, #2e2c28);
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  text-align: left;
  cursor: pointer;
  box-shadow: var(--shadow-1);
  transition: border-color 0.12s var(--ease-quiet), background-color 0.12s var(--ease-quiet);
}

.ui-select-trigger:hover {
  border-color: var(--border-strong, #d7d1c4);
}

/* 展开态：描边转主色（识别「当前操作中」的控件） */
.ui-select-trigger[data-state='open'] {
  border-color: color-mix(in srgb, var(--primary-color, #4e7a60) 55%, transparent);
}

.ui-select-trigger:focus-visible {
  outline: 1.5px solid var(--primary-color);
  outline-offset: 1px;
}

.ui-select-trigger:disabled {
  opacity: 0.45;
  cursor: default;
}

.ui-select-trigger:disabled .ui-select-value {
  color: var(--text-color, #2e2c28);
}

.ui-select-value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* placeholder 态文字弱化 */
.ui-select-value[data-placeholder] {
  color: var(--placeholder-color, #b6afa2);
}

.ui-select-chevron {
  flex: none;
  color: var(--text-secondary, #8a8377);
  transition: transform 0.12s var(--ease-quiet);
}

.ui-select-trigger[data-state='open'] .ui-select-chevron {
  transform: rotate(180deg);
}
</style>

<!--
  浮层样式必须放在非 scoped 块：popper 定位下 reka-ui 会在浮层外再包一层
  [data-reka-popper-content-wrapper]，scoped 的 data-v 落在该包裹层，而
  class 落在内层内容元素上，两者不在同一元素 → scoped 选择器永不命中
  （表现为浮层丢背景/描边/阴影）。类名统一 ui-select- 前缀以避免全局冲突。
-->
<style>
/* 浮层：纸面卡片（Portal 挂 body，不受侧边栏 overflow 裁剪） */
.ui-select-content {
  z-index: 21000;
  min-width: var(--reka-select-trigger-width);
  border: 1px solid var(--border-color, #e8e4dc);
  border-radius: var(--radius-m, 8px);
  background-color: var(--surface, #ffffff);
  box-shadow: var(--shadow-2);
  /* reka 进出场（data-state open/closed）淡入 + 轻微下沉，短促干净 */
  animation: ui-select-in 0.12s var(--ease-quiet);
}

.ui-select-content[data-state='closed'] {
  animation: none;
  opacity: 0;
}

@keyframes ui-select-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ui-select-content {
    animation: none;
  }
}

.ui-select-viewport {
  padding: 4px;
}

/* 条目：hover 轻洗色；行首圆点仅在选中项显色（Scandi 状态点） */
.ui-select-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 8px 0 4px;
  border-radius: var(--radius-s, 6px);
  font-size: 12px;
  line-height: 24px;
  color: var(--text-color, #2e2c28);
  cursor: pointer;
  user-select: none;
  outline: none;
}

.ui-select-item[data-highlighted] {
  background-color: var(--hover-bg, #f2f0ea);
}

.ui-select-item[data-state='checked'] {
  font-weight: 600;
}

.ui-select-item-dot {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background-color: transparent;
}

.ui-select-item[data-state='checked'] .ui-select-item-dot {
  background-color: var(--primary-color, #4e7a60);
}
</style>
