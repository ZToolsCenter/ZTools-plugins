<script setup lang="ts">
import { computed } from 'vue'

/**
 * 徽章组件属性
 */
const props = defineProps<{
  /** 徽章样式变体 */
  variant?: 'primary' | 'secondary' | 'glass' | 'outline' | 'success' | 'danger' | 'warning' | 'surface'
  /** 徽章尺寸 */
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /** 是否显示圆点指示器 */
  dot?: boolean
  /** 是否启用脉冲动画 */
  pulse?: boolean
}>()

/**
 * 计算徽章的CSS类名
 * @returns 包含基础类名和变体类名的数组
 */
const classes = computed(() => [
  'z-badge',
  `z-badge--${props.variant || 'secondary'}`,
  `z-badge--${props.size || 'md'}`,
])
</script>

<template>
    <div :class="classes">
        <span v-if="dot" :class="['z-badge__dot', { 'animate-pulse': pulse }]"></span>
        <slot />
    </div>
</template>

<style scoped lang="scss">
.z-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 6px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
    line-height: 1;
    transition: all 0.2s ease;
    border: 1px solid transparent;

    &--xs {
        padding: 2px 5px;
        font-size: 9px;
        border-radius: 4px;
        gap: 4px;
    }

    &--sm {
        padding: 4px 8px;
        font-size: 10px;
        border-radius: 5px;
    }

    &--md {
        padding: 6px 12px;
        font-size: 11px;
    }

    &--lg {
        padding: 8px 16px;
        font-size: 13px;
        border-radius: 8px;
    }

    /* ── Variants ───────────────────────────────────── */

    &--secondary {
        background: var(--color-surface);
        color: var(--color-secondary);
        border-color: var(--color-border);
    }

    &--primary {
        background: color-mix(in srgb, var(--color-cta) 12%, transparent);
        color: var(--color-cta);
        border-color: color-mix(in srgb, var(--color-cta) 20%, transparent);
    }

    &--surface {
        background: var(--color-surface);
        color: var(--color-text);
        border-color: var(--color-border);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    &--glass {
        background: color-mix(in srgb, var(--color-background) 60%, transparent);
        backdrop-filter: blur(12px);
        color: var(--color-text);
        border-color: var(--color-border);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    &--success {
        background: color-mix(in srgb, var(--color-insert-text) 12%, transparent);
        color: var(--color-insert-text);
        border-color: color-mix(in srgb, var(--color-insert-text) 20%, transparent);
    }

    &--danger {
        background: color-mix(in srgb, var(--color-delete-text) 12%, transparent);
        color: var(--color-delete-text);
        border-color: color-mix(in srgb, var(--color-delete-text) 20%, transparent);
    }

    &--warning {
        background: color-mix(in srgb, var(--color-modify-text) 12%, transparent);
        color: var(--color-modify-text);
        border-color: color-mix(in srgb, var(--color-modify-text) 20%, transparent);
    }

    &--outline {
        background: transparent;
        border-color: var(--color-border);
        color: var(--color-secondary);

        &:hover {
            border-color: var(--color-secondary);
            color: var(--color-text);
        }
    }

    &__dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: currentColor;
    }

    &--xs &__dot {
        width: 4px;
        height: 4px;
    }
}
</style>
