<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import ZIcon from '@/components/ui/ZIcon.vue'

/**
 * 下拉选择器组件属性
 */
const props = defineProps<{
  /** 双向绑定选中值 */
  modelValue: string
  /** 下拉选项列表 */
  options: { label: string, value: string }[]
}>()

/**
 * 发射事件
 */
const emit = defineEmits(['update:modelValue'])

/** 下拉菜单展开状态 */
const open = ref(false)
/** 选择器根元素引用 */
const selectRef = ref<HTMLElement | null>(null)

/**
 * 切换下拉菜单展开/收起状态
 */
const toggle = () => { open.value = !open.value }

/**
 * 选择选项并发射更新事件
 * @param val - 选中的值
 */
const pick = (val: string) => {
  emit('update:modelValue', val)
  open.value = false
}

/**
 * 点击外部关闭下拉菜单
 * @param e - 鼠标事件对象
 */
const onClickOutside = (e: MouseEvent) => {
  if (selectRef.value && !selectRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<template>
    <div class="select-root" ref="selectRef">
        <!-- Trigger Button -->
        <button type="button" class="select-trigger" :class="{ 'select-trigger--open': open }" @click="toggle">
            <span class="select-value">{{options.find(o => o.value === modelValue)?.label ?? ''}}</span>
            <ZIcon class="select-chevron" :class="{ 'select-chevron--up': open }" name="chevron-down" :size="14" />
        </button>

        <!-- Dropdown Menu -->
        <Transition name="select-dropdown">
            <div v-show="open" class="select-menu">
                <div class="select-menu-inner" role="listbox">
                    <button v-for="opt in options" :key="opt.value" type="button" role="option" class="select-option"
                        :class="{ 'select-option--active': opt.value === modelValue }" @click="pick(opt.value)">
                        <span class="select-option-indicator"></span>
                        <span class="select-option-label">{{ opt.label }}</span>
                        <!-- Checkmark for selected -->
                        <ZIcon v-if="opt.value === modelValue" class="select-check" name="check" :size="13" />
                    </button>
                </div>
            </div>
        </Transition>
    </div>
</template>

<style scoped lang="scss">
/* ── Root ──────────────────────────────────────────────── */
.select-root {
    position: relative;
    display: inline-block;
    min-width: 110px;
}

/* ── Trigger ────────────────────────────────────────────── */
.select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-background);
    color: var(--color-text);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    user-select: none;
    transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
    outline: none;

    &:hover {
        border-color: var(--color-secondary);
        background: var(--color-background);
    }

    &:focus-visible {
        border-color: var(--color-cta);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-cta) 20%, transparent);
    }

    &--open {
        border-color: var(--color-cta);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-cta) 20%, transparent);
    }
}

.select-value {
    flex: 1;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* ── Chevron ────────────────────────────────────────────── */
.select-chevron {
    color: var(--color-secondary);
    flex-shrink: 0;
    transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1), color 160ms ease;

    &--up {
        transform: rotate(180deg);
        color: var(--color-cta);
    }
}

/* ── Dropdown ───────────────────────────────────────────── */
.select-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 100;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-background);
    box-shadow:
        0 4px 6px -1px rgba(0, 0, 0, 0.15),
        0 10px 20px -2px rgba(0, 0, 0, 0.15);
    overflow: hidden;
    overflow-y: auto;
    max-height: 240px;

    /* Scroller styling */
    &::-webkit-scrollbar {
        width: 4px;
    }

    &::-webkit-scrollbar-track {
        background: transparent;
    }

    &::-webkit-scrollbar-thumb {
        background: var(--color-border);
        border-radius: 4px;

        &:hover {
            background: var(--color-secondary);
        }
    }

    /* Dark mode: stronger shadow so the panel lifts visually */
    :global(.dark) & {
        box-shadow:
            0 4px 6px -1px rgba(0, 0, 0, 0.4),
            0 10px 20px -2px rgba(0, 0, 0, 0.4);
    }
}

.select-menu-inner {
    padding: 4px;
}

/* ── Option ─────────────────────────────────────────────── */
.select-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border-radius: 7px;
    border: none;
    background: transparent;
    color: var(--color-secondary);
    font-size: 13px;
    font-weight: 400;
    cursor: pointer;
    text-align: left;
    transition: background 140ms ease, color 140ms ease;
    position: relative;

    &:hover {
        background: color-mix(in srgb, var(--color-cta) 10%, transparent);
        color: var(--color-text);
    }

    &--active {
        color: var(--color-text);
        font-weight: 600;
        background: color-mix(in srgb, var(--color-cta) 12%, transparent);

        .select-option-indicator {
            background: var(--color-cta);
        }
    }
}

/* Left accent bar for selected item */
.select-option-indicator {
    display: block;
    width: 2px;
    height: 14px;
    border-radius: 2px;
    background: transparent;
    flex-shrink: 0;
    transition: background 160ms ease;
}

.select-option-label {
    flex: 1;
}

.select-check {
    color: var(--color-cta);
    flex-shrink: 0;
}

/* ── Transition ─────────────────────────────────────────── */
.select-dropdown-enter-active {
    transition: opacity 160ms ease, transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
}

.select-dropdown-leave-active {
    transition: opacity 130ms ease, transform 130ms ease;
}

.select-dropdown-enter-from {
    opacity: 0;
    transform: translateY(-6px) scale(0.97);
}

.select-dropdown-leave-to {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
}
</style>
