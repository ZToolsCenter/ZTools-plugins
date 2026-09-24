<template>
  <ZPopover
    :show="open"
    trigger="focus"
    placement="bottom-start"
    :to="false"
    width="trigger"
    :show-arrow="false"
    @update:show="handleShowChange"
  >
    <template #trigger>
      <div class="collection-select">
        <input
          ref="inputRef"
          class="collection-select__input"
          :value="inputValue"
          :placeholder="placeholder"
          autocomplete="off"
          spellcheck="false"
          @input="handleInput"
          @keydown.enter.prevent="selectFirstMatch"
        />
      </div>
    </template>
    <div class="collection-select__panel">
      <button
        v-for="option in filteredOptions"
        :key="option.value"
        type="button"
        class="collection-select__option"
        :class="{ 'is-active': option.value === modelValue }"
        :title="option.label"
        @mousedown.prevent
        @click="select(option)"
      >
        <span class="collection-select__option-label">{{ option.label }}</span>
        <span v-if="option.tag" class="collection-select__option-tag">{{ option.tag }}</span>
      </button>
      <div v-if="!filteredOptions.length" class="collection-select__empty">
        {{ loading ? '图标集列表加载中…' : '无匹配图标集' }}
      </div>
    </div>
  </ZPopover>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ZPopover } from 'ztools-ui'

type SelectOption = {
  label: string
  value: string
  /** 可选的引用式标签文案（如图标集前缀），渲染为名称后的小标签。 */
  tag?: string
}

const props = withDefaults(defineProps<{
  /** 当前选中的图标集前缀；空字符串表示「全部图标集」。 */
  modelValue: string
  /** 全量选项列表（含首项「全部图标集」）。 */
  options: SelectOption[]
  /** 全量图标集列表是否正在加载。 */
  loading?: boolean
}>(), {
  loading: false
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

const open = ref(false)
const keyword = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

const selectedLabel = computed(() =>
  props.options.find((option) => option.value === props.modelValue)?.label ?? ''
)

// 关闭时输入框展示选中项文案，展开时切换为可编辑的过滤关键词。
const inputValue = computed(() => (open.value ? keyword.value : selectedLabel.value))

const placeholder = computed(() => {
  if (open.value) return selectedLabel.value || '输入前缀或名称筛选图标集'
  return '全部图标集'
})

// 按前缀 / 名称做不区分大小写的包含匹配，输入即过滤。
const filteredOptions = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.options
  return props.options.filter((option) =>
    option.label.toLowerCase().includes(kw) || option.value.toLowerCase().includes(kw)
  )
})

// 展开时清空关键词重新过滤；关闭交由外部点击 / 选择完成。
function handleShowChange(show: boolean) {
  open.value = show
  if (show) keyword.value = ''
}

function handleInput(event: Event) {
  keyword.value = (event.target as HTMLInputElement).value
}

// mousedown.prevent 保证点击选项时焦点不离开输入框（避免触发 popover 的失焦关闭），选中后主动失焦复位。
function select(option: SelectOption) {
  emit('update:modelValue', option.value)
  close()
}

function selectFirstMatch() {
  const first = filteredOptions.value[0]
  if (first) select(first)
}

function close() {
  open.value = false
  inputRef.value?.blur()
}
</script>

<style lang="scss" scoped>
/* ztools-ui 的 popover 触发器默认 inline-flex 收缩宽度，这里撑满所在行。 */
:deep(.zt-popover__trigger) {
  width: 100%;
}

.collection-select {
  width: 100%;
}

/* 输入框对齐 ztools-ui 的 zt-input 规范：2px 主题边框、圆角 6px、
   small 尺寸（28px 高 / 12px 字号），hover 与 focus 反馈与 ZInput 一致。 */
.collection-select__input {
  width: 100%;
  min-height: 28px;
  padding: 3px 10px;
  border: 2px solid var(--control-border);
  border-radius: 6px;
  background: var(--control-bg);
  color: var(--text-color);
  font: inherit;
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
  transition: all 0.2s;

  &::placeholder {
    color: var(--placeholder-color);
  }

  &:hover {
    background: var(--hover-bg);
    border-color: color-mix(in srgb, var(--primary-color), black 15%);
  }

  &:focus {
    background: var(--active-bg);
    border-color: color-mix(in srgb, var(--primary-color), black 15%);
    box-shadow: 0 0 0 3px var(--primary-light-bg);
  }
}
.collection-select__panel {
  max-height: 264px;
  overflow-y: auto;
  padding: 4px;
  background: #fff;
}
.collection-select__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #333;
  font-size: 12px;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--primary-light-bg);
  }

  &.is-active {
    color: var(--primary-color);
    font-weight: 700;
  }
}
.collection-select__option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collection-select__option-tag {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.14);
  color: #666;
  font-size: 10px;
  font-weight: 400;
  line-height: 1.5;

  .is-active & {
    background: color-mix(in srgb, var(--primary-color) 14%, transparent);
    color: var(--primary-color);
  }
}
.collection-select__empty {
  padding: 10px 8px;
  color: #888;
  font-size: 12px;
  text-align: center;
}
</style>
