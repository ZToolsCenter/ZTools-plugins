<script setup lang="ts">
/**
 * 下拉选择器组件
 * 支持自定义选项模板、单选、点击外部关闭等功能
 */
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { ChevronUp, Check } from 'lucide-vue-next'

// 组件属性
const props = defineProps<{
  options: { id: string | number; label: string;[key: string]: any }[]  // 选项列表
  modelValue: string | number  // 当前选中的值（v-model 绑定）
  placeholder?: string  // 占位文本
}>()

// 组件事件
const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number): void  // 值更新事件
}>()

// 下拉菜单是否展开
const isOpen = ref(false)
// 组件根元素引用
const selectRef = ref<HTMLElement | null>(null)
// 下拉菜单滚动区域引用
const scrollRef = ref<HTMLElement | null>(null)

/**
 * 切换下拉菜单展开状态
 * 展开时自动滚动到已选中的选项
 */
const toggleOpen = async () => {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    await nextTick()
    const activeEl = scrollRef.value?.querySelector('.is-selected') as HTMLElement | null
    if (activeEl && scrollRef.value) {
      const containerH = scrollRef.value.clientHeight
      const itemTop = activeEl.offsetTop
      const itemH = activeEl.offsetHeight
      scrollRef.value.scrollTop = itemTop - containerH / 2 + itemH / 2
    }
  }
}

/**
 * 选择选项
 * 触发更新事件并关闭下拉菜单
 * @param id - 选中的选项 ID
 */
const selectOption = (id: string | number) => {
  emit('update:modelValue', id)
  isOpen.value = false
}

/**
 * 处理点击外部事件
 * 点击选择器外部时关闭下拉菜单
 * @param e - 鼠标事件对象
 */
const handleClickOutside = (e: MouseEvent) => {
  if (selectRef.value && !selectRef.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', handleClickOutside))
onUnmounted(() => document.removeEventListener('click', handleClickOutside))

/**
 * 获取当前选中的选项标签
 * @returns 当前选中项的显示文本，如果没有选中则返回占位符
 */
const currentLabel = () => {
  const selected = props.options.find(o => o.id === props.modelValue)
  return selected ? selected.label : (props.placeholder || 'Select')
}

/**
 * 获取当前选中的选项对象
 * @returns 当前选中的选项对象
 */
const currentOption = () => {
  return props.options.find(o => o.id === props.modelValue)
}
</script>

<template>
  <div class="cs-select" ref="selectRef">
    <!-- Trigger Button -->
    <button class="cs-select-trigger" :class="{ 'is-open': isOpen }" @click="toggleOpen" type="button">
      <slot name="trigger" :selected="currentOption()" :label="currentLabel()">
        <span class="cs-select-value">{{ currentLabel() }}</span>
      </slot>
      <ChevronUp :size="13" class="cs-select-arrow" :class="{ 'rotate': !isOpen }" />
    </button>

    <!-- Dropdown Menu -->
    <Transition name="cs-dropdown">
      <div v-if="isOpen" class="cs-select-menu">
        <div class="cs-select-scroll" ref="scrollRef">
          <button v-for="option in options" :key="option.id" class="cs-select-option"
            :class="{ 'is-selected': option.id === modelValue }" @click="selectOption(option.id)" type="button">
            <slot name="option" :option="option">
              <span class="cs-select-option-label">{{ option.label }}</span>
            </slot>
            <Check v-if="option.id === modelValue" :size="12" class="cs-select-option-check" />
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style lang="scss" scoped>
.cs-select {
  position: relative;
  display: inline-block;
  min-width: 130px;
}

.cs-select-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-lg);
  padding: 0 var(--spacing-sm) 0 var(--spacing-md);
  height: 28px;
  cursor: pointer;
  outline: none;
  font-family: var(--font-sans);
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--color-text-lighter);
  transition: all 0.15s ease;

  :global(.light-theme) & {
    background: rgba(0, 0, 0, 0.04);
    border-color: rgba(0, 0, 0, 0.1);
    color: var(--color-text-light);

    &:hover {
      background: rgba(0, 0, 0, 0.07);
      border-color: rgba(0, 0, 0, 0.16);
      color: var(--color-text);
    }
  }

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.14);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  &.is-open {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.18);
    box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.15);
  }
}

.cs-select-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  text-align: left;
}

.cs-select-arrow {
  color: var(--color-text-muted-darker);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  flex-shrink: 0;
  margin-left: 4px;

  &.rotate {
    transform: rotate(180deg);
  }
}

.cs-select-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 100%;
  background: var(--color-dropdown-bg);
  backdrop-filter: blur(24px) saturate(160%);
  border: 1px solid var(--color-dropdown-border);
  border-radius: 12px;
  padding: 6px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  z-index: var(--z-dropdown);
  transform-origin: bottom left;
}

.cs-select-scroll {
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }
}

.cs-select-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  border: none;
  padding: 7px var(--spacing-sm);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: var(--font-size-base);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;

  &:hover {
    background: var(--color-dropdown-hover);
    color: var(--color-text);
    padding-left: calc(var(--spacing-sm) + 2px);
  }

  &.is-selected {
    background: rgba(56, 189, 248, 0.12);
    color: var(--color-accent-blue);
    font-weight: 700;
  }
}

.cs-dropdown-enter-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.cs-dropdown-leave-active {
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}

.cs-dropdown-enter-from,
.cs-dropdown-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}
</style>
