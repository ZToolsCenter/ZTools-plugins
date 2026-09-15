<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import { useSegmentIndicator } from '../composables/useSegmentIndicator'

export interface NavChild {
  /** 子项唯一 key（即叶子 activeKey） */
  key: string
  /** 子项显示名称 */
  label: string
  /** 是否禁用 */
  disabled?: boolean
  /** 该子项对应的页面组件（保留兼容，布局本身不直接渲染） */
  component?: Component
}

export interface NavItem {
  /** 主按钮 key；无 children 时即为叶子 activeKey */
  key: string
  /** 主按钮显示名称 */
  label: string
  /** 图标（SVG 字符串 / emoji） */
  icon?: string
  /** 该项对应的页面组件（保留兼容，布局本身不直接渲染） */
  component?: Component
  /** 是否禁用 */
  disabled?: boolean
  /** 右侧附加文案（保留兼容） */
  extra?: string
  /** 子项列表：存在多个时显示子切换条，单/无 children 时作普通叶子 */
  children?: NavChild[]
}

const props = withDefaults(
  defineProps<{
    /** 当前选中项 key（叶子 key） */
    modelValue: string
    /** 主按钮列表 */
    items: NavItem[]
    /** 标题（保留兼容，底部栏不渲染） */
    title?: string
    /** 版本号（保留兼容，底部栏不渲染） */
    version?: string | null
    /**
     * 悬浮导航栏水平对齐：默认居中。
     * 'left' 用于公式识别模式——避免居中遮挡右下角的复制按钮组。
     */
    dockAlign?: 'center' | 'left'
  }>(),
  {
    title: '',
    version: null,
    dockAlign: 'center'
  }
)

const emit = defineEmits<{ (e: 'update:modelValue', key: string): void }>()

/**
 * 当前激活项所属的主组：
 *   - 无 children 的 item：自身即组，modelValue === item.key 时命中
 *   - 有 children 的 item：modelValue 等于任一 child.key 时命中
 */
const activeGroup = computed(() =>
  props.items.find(
    (it) =>
      props.modelValue === it.key ||
      (it.children?.some((c) => c.key === props.modelValue) ?? false)
  )
)

/** 激活主组是否有多个子项（决定是否渲染子切换条） */
const showSubBar = computed(
  () => !!activeGroup.value && (activeGroup.value.children?.length ?? 0) > 1
)

/** 鼠标是否悬停在页面底部触发区（用于显隐悬浮栏） */
const dockVisible = ref(false)

/** 鼠标移入悬浮栏本身时锁定显示，避免抖动 */
const dockHovered = ref(false)

/** 子切换条展开状态：未激活主组时折叠，点击主组后可展开 */
function onContentMove(e: MouseEvent) {
  // 距视口底部 64px 内触发显示
  const fromBottom = window.innerHeight - e.clientY
  dockVisible.value = fromBottom <= 64
}

function onContentLeave() {
  dockVisible.value = false
}

function onDockEnter() {
  dockHovered.value = true
}

function onDockLeave() {
  dockHovered.value = false
}

const dockShow = computed(() => dockVisible.value || dockHovered.value)

// 激活主按钮在 items 中的索引（驱动滑动高亮指示条）
const activeIndex = computed(() =>
  props.items.findIndex((it) => activeGroup.value?.key === it.key)
)
const {
  containerRef: dockMainRef,
  setItemRef: setDockItemRef,
  pos: dockIndicator,
  noAnim: dockNoAnim
} = useSegmentIndicator(activeIndex, dockShow)

/** 点击主按钮：有 children 则落到首个子项（若当前不在该组），否则直接切到自身 key */
function selectMain(item: NavItem) {
  if (item.disabled) return
  if (item.children?.length) {
    const belongs = item.children.some((c) => c.key === props.modelValue)
    if (!belongs) emit('update:modelValue', item.children[0].key)
    return
  }
  emit('update:modelValue', item.key)
}

function selectChild(child: NavChild) {
  if (child.disabled) return
  emit('update:modelValue', child.key)
}
</script>

<template>
  <div
    class="setting-layout"
    @mousemove="onContentMove"
    @mouseleave="onContentLeave"
  >
    <!-- 内容区：底部预留少量 padding 防止悬浮栏遮挡关键内容 -->
    <main class="content" :class="{ 'has-sub': showSubBar }">
      <slot />
    </main>

    <!-- 底部悬浮导航栏：鼠标靠近底部时滑入 -->
    <transition name="dock-slide">
      <nav
        v-show="dockShow"
        class="dock"
        :class="{ 'dock-left': dockAlign === 'left' }"
        role="tablist"
        aria-label="主导航"
        @mouseenter="onDockEnter"
        @mouseleave="onDockLeave"
      >
        <!-- 子项切换条：仅激活主组含多个 children 时出现 -->
        <div
          v-if="showSubBar"
          class="sub-bar"
          role="tablist"
          :aria-label="activeGroup!.label + ' 子项'"
        >
          <button
            v-for="child in activeGroup!.children"
            :key="child.key"
            type="button"
            role="tab"
            class="sub-item"
            :class="{ active: modelValue === child.key, disabled: child.disabled }"
            :disabled="child.disabled"
            @click="selectChild(child)"
          >
            {{ child.label }}
          </button>
        </div>

        <!-- 主按钮栏 -->
        <div class="dock-main" ref="dockMainRef">
          <!-- 滑动高亮指示条：吸附到当前激活主按钮位置 -->
          <span
            class="dock-indicator"
            :class="{ 'no-anim': dockNoAnim }"
            :style="{
              transform: `translateX(${dockIndicator.x}px)`,
              width: dockIndicator.w ? `${dockIndicator.w}px` : '0px'
            }"
          ></span>
          <button
            v-for="(item, i) in items"
            :key="item.key"
            :ref="(el) => setDockItemRef(el, i)"
            type="button"
            role="tab"
            class="dock-item"
            :class="{
              active: activeGroup?.key === item.key,
              disabled: item.disabled
            }"
            :disabled="item.disabled"
            :aria-selected="activeGroup?.key === item.key"
            @click="selectMain(item)"
          >
            <span v-html="item.icon" class="dock-icon"></span>
            <span class="dock-label">{{ item.label }}</span>
          </button>
        </div>
      </nav>
    </transition>
  </div>
</template>

<style scoped>
.setting-layout {
  position: relative;
  width: 100%;
  height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
}

/* ── 内容区 ── */
.content {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  /* 悬浮栏收起时几乎不占位，但仍留少量呼吸空间 */
  padding-bottom: 12px;
}

/* 激活主组带子切换条时，多留一点 */
.content.has-sub {
  padding-bottom: 16px;
}

/* ── 底部悬浮栏 ── */
.dock {
  position: fixed;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* 宽度自适应内容，仅施加上限避免超宽 */
  width: max-content;
  max-width: calc(100vw - 16px);
  padding: 5px;
  border-radius: 12px;
  background: var(--dock-bg, rgba(255, 255, 255, 0.82));
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
  box-sizing: border-box;
  /* 居中↔左对齐切换（如公式→设置）的位置过渡；进入/离开过渡由下方
     .dock-slide-enter-active 覆盖，二者不冲突（后者源序在后、同特异性优先） */
  transition:
    left 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ── 进入/离开过渡 ── */
.dock-slide-enter-active,
.dock-slide-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.dock-slide-enter-from,
.dock-slide-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}

/* 左对齐态：去掉水平居中偏移，进入/离开过渡也同步改为无水平位移 */
.dock.dock-left {
  left: 8px;
  transform: translateX(0);
}

.dock.dock-left.dock-slide-enter-from,
.dock.dock-left.dock-slide-leave-to {
  transform: translate(0, 12px);
}

/* 子项切换条（segmented control 风格） */
.sub-bar {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--sub-bar-bg, rgba(0, 0, 0, 0.05));
  border-radius: 8px;
}

.sub-item {
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 11px;
  line-height: 1.4;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}

.sub-item:hover:not(.disabled):not(.active) {
  color: var(--primary-color, #1976d2);
}

.sub-item.active {
  background: var(--sub-item-active-bg, #fff);
  color: var(--primary-color, #1976d2);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.sub-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 主按钮栏 */
.dock-main {
  position: relative;
  display: flex;
  gap: 2px;
}

/* 滑动高亮指示条：绝对定位吸附到当前激活主按钮，背景即原 active 底色 */
.dock-indicator {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  border-radius: 8px;
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
  pointer-events: none;
  z-index: 0;
  transition:
    transform 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    width 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.dock-indicator.no-anim {
  transition: none;
}

.dock-item {
  /* 横向排列 icon + label，强制不换行 */
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  padding: 5px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary, inherit);
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  /* 置于指示条之上，使文字始终清晰 */
  position: relative;
  z-index: 1;
  transition: background 0.15s, color 0.15s;
}

.dock-item:hover:not(.disabled):not(.active) {
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
}

/* 激活态：仅着色 + 加粗，背景由 .dock-indicator 滑动提供 */
.dock-item.active {
  color: var(--primary-color, #1976d2);
  font-weight: 600;
}

.dock-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dock-icon {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

:deep(.dock-icon svg) {
  width: 18px;
  height: 18px;
}

.dock-label {
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}

/* ── 暗色模式 ── */
@media (prefers-color-scheme: dark) {
  .dock {
    background: var(--dock-bg, rgba(48, 49, 51, 0.82));
    border-color: var(--border-color, rgba(255, 255, 255, 0.1));
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  }

  .sub-bar {
    background: var(--sub-bar-bg, rgba(255, 255, 255, 0.08));
  }

  .sub-item.active {
    background: var(--sub-item-active-bg, rgba(255, 255, 255, 0.14));
  }
}
</style>
