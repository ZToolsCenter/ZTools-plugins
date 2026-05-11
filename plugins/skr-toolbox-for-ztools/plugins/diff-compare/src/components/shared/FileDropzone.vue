<script setup lang="ts">
/**
 * 文件拖放区域组件
 * 提供文件拖放上传功能，支持源文件和目标文件
 */

import ZIcon from '@/components/ui/ZIcon.vue'

/**
 * 组件属性
 */
defineProps<{
    /** 文件侧：source-源文件, target-目标文件 */
    side: 'source' | 'target'
    /** 标题文本 */
    title: string
    /** 提示文本 */
    hint: string
    /** 是否已准备好（文件已上传） */
    isReady: boolean
    /** 文件名称（可选） */
    fileName?: string
    /** 接受的文件类型（MIME类型） */
    accept: string
}>()

/**
 * 事件定义
 */
defineEmits<{
    change: [e: Event]
}>()
</script>

<template>
    <div
        class="file-dropzone flex-1 border-2 border-dashed border-[var(--color-border)] rounded-xl flex flex-col items-center justify-center bg-checker relative group hover:border-[var(--color-cta)] transition-all">
        <input type="file" :accept="accept" class="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full"
            multiple @change="$emit('change', $event)" />
        <div class="text-center p-8 pointer-events-none group-hover:scale-105 transition-transform">
            <div :class="[
                'w-14 h-14 bg-[var(--color-background)] rounded-xl flex items-center justify-center mb-3 mx-auto border border-[var(--color-border)] shadow-sm',
                side === 'source' ? 'text-green-600' : 'text-blue-600'
            ]">
                <slot name="icon">
                    <ZIcon name="file" :size="28" />
                </slot>
            </div>
            <p class="text-sm font-bold">{{ title }}</p>
            <p class="text-xs text-[var(--color-secondary)] mt-1 opacity-70">
                {{ isReady ? 'Ready' : hint }}
            </p>
            <p v-if="fileName" class="text-[10px] truncate max-w-[180px] mt-1 opacity-50 mx-auto">
                {{ fileName }}
            </p>
        </div>
    </div>
</template>

<style scoped>
.bg-checker {
    background-color: var(--color-background);
    background-image: radial-gradient(var(--color-border) 1px, transparent 1px);
    background-size: 20px 20px;
    opacity: 0.4;
}
</style>
