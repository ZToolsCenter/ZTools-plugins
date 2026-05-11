<script setup lang="ts">
defineProps<{
    items: Array<{
        label: string
        swatchClass: string
    }>
}>()
</script>

<template>
    <div
        class="diff-legend h-6 bg-[var(--color-surface)] border-t border-[var(--color-border)] flex items-center px-4 gap-4 flex-shrink-0">
        <div v-for="(item, i) in items" :key="i" class="flex items-center gap-1.5">
            <div :class="[
                'w-2.5 h-2.5 rounded-sm',
                item.swatchClass
            ]"></div>
            <span class="text-[10px] text-[var(--color-secondary)]">{{ item.label }}</span>
        </div>
    </div>
</template>
