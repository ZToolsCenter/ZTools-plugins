<script setup lang="ts">
/**
 * 差异条组件
 * 显示差异比较结果的缩略图导航条
 */

import { ref } from 'vue'
import ZTooltip from '@/components/ui/ZTooltip.vue'
import { useI18n } from 'vue-i18n'
import ZIcon from '@/components/ui/ZIcon.vue'
import ZBadge from '@/components/ui/ZBadge.vue';

const { t } = useI18n();

/** 滚动容器引用 */
const scrollContainerRef = ref<HTMLElement | null>(null)
defineExpose({ scrollContainer: scrollContainerRef })

/**
 * 差异项数据类型
 */
export interface DiffBarItem {
    /** 差异类型 */
    type: 'equal' | 'delete' | 'insert' | 'modify' | 'added' | 'removed'
    /** 源文本（删除时） */
    sourceText?: string
    /** 目标文本（插入时） */
    targetText?: string
}

/**
 * 组件属性
 */
const props = defineProps<{
    /** 标题 */
    title: string
    /** 差异项列表 */
    items: DiffBarItem[]
    /** 当前激活的差异项索引 */
    activeIndex?: number
}>()

/**
 * 事件定义
 */
defineEmits<{
    scroll: [e: Event]
    itemClick: [index: number]
}>()
</script>

<template>
    <div
        class="diff-bar w-12 flex-shrink-0 bg-[var(--color-surface)] border-x border-[var(--color-border)] overflow-hidden flex flex-col no-scrollbar shadow-[0_0_15px_-3px_rgba(0,0,0,0.05)] z-10">
        <ZBadge :content="title"
            class="diff-bar-header h-8 border-b border-[var(--color-border)] flex items-center justify-center bg-[var(--color-background)] flex-shrink-0 text-[10px] font-bold text-[var(--color-secondary)] uppercase tracking-tighter sticky top-0 z-40 shadow-sm">
            {{ title }}
        </ZBadge>
        <div ref="scrollContainerRef" class="overflow-auto scrollbar-hide flex-1 py-1 overflow-y-auto min-h-0"
            @scroll="$emit('scroll', $event)">
            <div :id="'diff-bar-item-' + idx" v-for="(item, idx) in items" :key="'bar-' + idx"
                class=" h-8 flex items-center justify-center relative">
                <ZTooltip v-if="item.type !== 'equal'" position="top">
                    <div :class="[
                        'hover:cursor-pointer',
                        'diff-icon-wrapper relative z-10 cursor-pointer',
                        'diff-icon--' + item.type,
                        activeIndex === idx ? 'diff-icon--active' : ''
                    ]" @click="$emit('itemClick', idx)">
                        <ZIcon v-if="item.type === 'modify'" name="edit" :size="14" />
                        <ZIcon v-else-if="item.type === 'insert' || item.type === 'added'" name="plus" :size="14"
                            stroke-width="3" />
                        <ZIcon v-else-if="item.type === 'delete' || item.type === 'removed'" name="minus" :size="14"
                            stroke-width="3" />
                    </div>
                    <template #content>
                        <div class="p-1 px-2 text-xs">
                            <div class="font-bold mb-1 opacity-70 text-center">
                                {{ item.type === 'modify' ? t('modified') :
                                    (item.type === 'insert' ? t('added') : t('removed')) }}
                            </div>
                            <div class="flex items-center gap-2 whitespace-nowrap">
                                <!-- 修改前内容 -->
                                <span v-if="item.sourceText" class="text-red-400 line-through">{{ item.sourceText
                                }}</span>
                                <!-- 箭头图标 -->
                                <ZIcon v-if="item.type === 'modify'" name="arrow-right" :size="10" />
                                <!-- 修改后内容 -->
                                <span v-if="item.targetText" class="text-green-400 font-bold">{{ item.targetText
                                    }}</span>
                            </div>
                        </div>
                    </template>

                </ZTooltip>
                <div v-else class="w-1 h-1 rounded-full bg-[var(--color-border)] opacity-40"></div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.diff-icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.diff-icon--modify {
    color: #eab308;
    background-color: rgba(234, 179, 8, 0.1);
}

.diff-icon--insert,
.diff-icon--added {
    color: #10b981;
    background-color: rgba(16, 185, 129, 0.1);
}

.diff-icon--delete,
.diff-icon--removed {
    color: #ef4444;
    background-color: rgba(239, 68, 68, 0.1);
}

.diff-icon--active {
    transform: scale(1.15);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.diff-icon--active.diff-icon--modify {
    background-color: #eab308;
    color: white !important;
}

.diff-icon--active.diff-icon--insert,
.diff-icon--active.diff-icon--added {
    background-color: #10b981;
    color: white !important;
}

.diff-icon--active.diff-icon--delete,
.diff-icon--active.diff-icon--removed {
    background-color: #ef4444;
    color: white !important;
}

.dark .diff-icon--active.diff-icon--modify,
.dark .diff-icon--active.diff-icon--insert,
.dark .diff-icon--active.diff-icon--added,
.dark .diff-icon--active.diff-icon--delete,
.dark .diff-icon--active.diff-icon--removed {
    color: #111 !important;
}

.diff-icon-wrapper:hover:not(.diff-icon--active) {
    transform: scale(1.1);
    filter: brightness(1.2);
}

.no-scrollbar::-webkit-scrollbar {
    display: none;
}
</style>
