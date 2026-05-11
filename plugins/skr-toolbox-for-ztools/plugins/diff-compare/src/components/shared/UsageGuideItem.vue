<script setup lang="ts">
import ZIcon from '@/components/ui/ZIcon.vue'
defineProps<{
    icon: string
    type?: "blue" | "purple" | "amber" | "green" | "red"
    title: string
    desc: string
}>()
</script>

<template>
    <div class="ugi-item">
        <div class="ugi-icon-wrap" :class="'ugi-icon-wrap--' + type">
            <ZIcon :name="icon" :size="15" />
        </div>
        <div class="ugi-text">
            <p class="ugi-title">{{ title }}</p>
            <p class="ugi-desc">{{ desc }}</p>
        </div>
    </div>
</template>

<style scoped lang="scss">
.ugi-item {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: 10px;
    transition: background 150ms ease;

    &:hover {
        background: color-mix(in srgb, var(--color-border) 50%, transparent);
    }
}

.ugi-icon-wrap {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;

    &--blue {
        background: rgba(59, 130, 246, 0.15);
        color: #3b82f6;
    }

    &--purple {
        background: rgba(139, 92, 246, 0.15);
        color: #8b5cf6;
    }

    &--amber {
        background: rgba(245, 158, 11, 0.15);
        color: #f59e0b;
    }

    &--green {
        background: rgba(16, 185, 129, 0.15);
        color: #10b981;
    }

    &--red {
        background: rgba(239, 68, 68, 0.15);
        color: #ef4444;
    }
}

.ugi-text {
    flex: 1;
}

.ugi-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 3px;
    line-height: 1.4;
}

.ugi-desc {
    font-size: 12px;
    color: var(--color-secondary);
    margin: 0;
    line-height: 1.55;
}
</style>
