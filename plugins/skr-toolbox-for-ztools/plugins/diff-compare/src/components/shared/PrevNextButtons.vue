<script setup lang="ts">
import ZTooltip from '@/components/ui/ZTooltip.vue'
import ZButton from '@/components/ui/ZButton.vue'
import ZIcon from '@/components/ui/ZIcon.vue'

defineProps<{
    prevLabel?: string
    nextLabel?: string
}>()

defineEmits<{
    prev: []
    next: []
}>()
</script>

<template>
    <ZTooltip :content="prevLabel" position="bottom">
        <ZButton variant="ghost" size="icon-sm" @click="$emit('prev')" class="!w-6 !h-6">
            <ZIcon name="prev" :size="12" />
        </ZButton>
    </ZTooltip>
    <ZTooltip :content="nextLabel" position="bottom">
        <ZButton variant="ghost" size="icon-sm" @click="$emit('next')" class="!w-6 !h-6">
            <ZIcon name="next" :size="12" />
        </ZButton>
    </ZTooltip>
</template>
