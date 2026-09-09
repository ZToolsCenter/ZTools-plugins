<!--
  UiSegmented：分段控件（替代 ztools-ui ZTabs type="segment"，reka-ui Tabs）。

  与原 ZTabs/ZTabPane 用法对齐但简化 API：options 数组代替 ZTabPane 子组件，
  modelValue + update:modelValue（恒 string）。消费场景：侧边栏「视图」
  并排 / 统一、「比对精度」智能 / 行 / 单词 / 字符。

  视觉：浅米灰轨道（surface-2）+ 纸白活动片（1px 阴影）—— 北欧经典分段
  控件；活动片与轨道的对比就是全部层次，无多余描边。data-state 由 reka
  TabsTrigger 提供（active / inactive）。

  活动片是一枚绝对定位的滑块（.ui-segmented-thumb），而非各段自己的背景：
  切换时 transform 平移过去，得到平滑移动的高亮背景。各段等宽（flex: 1 1 0
  + min-width: 0），所以滑块宽度 = 轨道内容宽 / 段数、位移 = 下标 × 自身宽度，
  纯 CSS calc 即可，无需测量 DOM。modelValue 不在 options 内时不渲染滑块。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

const props = defineProps<{
  modelValue: string
  options: { label: string; value: string }[]
  ariaLabel?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

/** 当前选中段下标；-1 表示 modelValue 不在候选内（此时不渲染滑块） */
const activeIndex = computed(() =>
  props.options.findIndex((option) => option.value === props.modelValue),
)
</script>

<template>
  <TabsRoot
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', String($event))"
  >
    <TabsList class="ui-segmented" :aria-label="ariaLabel">
      <span
        v-if="activeIndex >= 0"
        class="ui-segmented-thumb"
        aria-hidden="true"
        :style="{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }"
      />
      <TabsTrigger
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        class="ui-segmented-item"
      >
        {{ option.label }}
      </TabsTrigger>
    </TabsList>
  </TabsRoot>
</template>

<style scoped>
/* 轨道：满宽浅米灰，2px 内衬让活动片有「嵌在槽里」的纸感 */
.ui-segmented {
  position: relative;
  display: flex;
  width: 100%;
  padding: 2px;
  border-radius: var(--radius-s, 6px);
  background-color: var(--surface-2, #f1efe9);
}

/* 活动滑块：纸白片 + 1px 阴影，切换时平移到目标段 */
.ui-segmented-thumb {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  border-radius: 4px;
  background-color: var(--surface, #ffffff);
  box-shadow: var(--shadow-1);
  transition: transform 0.24s var(--ease-quiet), width 0.24s var(--ease-quiet);
  pointer-events: none;
}

/* 段本体只管文字（背景交给滑块）；非活动 hover 仅文字加深（极轻） */
.ui-segmented-item {
  position: relative;
  z-index: 1;
  flex: 1 1 0;
  min-width: 0;
  height: 22px;
  padding: 0 8px;
  border: none;
  border-radius: 4px;
  background-color: transparent;
  color: var(--text-secondary, #8a8377);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition: color 0.12s var(--ease-quiet);
}

.ui-segmented-item:hover {
  color: var(--text-color, #2e2c28);
}

.ui-segmented-item:focus-visible {
  outline: 1.5px solid var(--primary-color);
  outline-offset: 1px;
}

.ui-segmented-item[data-state='active'] {
  color: var(--text-color, #2e2c28);
  font-weight: 600;
}

/* 减少动态效果偏好：滑块直接就位，不做平移动画 */
@media (prefers-reduced-motion: reduce) {
  .ui-segmented-thumb {
    transition: none;
  }
}
</style>
