<template>
    <Toggle
        v-bind="$attrs"
        :popover-title="`${t('common.shine')} ${t('common.settings')}`"
        :settings-tooltip="t('tooltip.configureShine')"
    >
        <template #popover>
            <div class="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
                <div class="flex w-full items-center justify-between gap-2 px-3 py-2">
                    <Label class="w-full text-center">{{ t('common.width') }}</Label>

                    <Slider
                        :max="100"
                        :step="1"
                        :model-value="[shineWidth]"
                        @update:model-value="$emit('update:shine-width', Number($event[0]))"
                    />

                    <Input
                        type="number"
                        class="w-16 text-center"
                        :model-value="shineWidth"
                        @update:model-value="$emit('update:shine-width', Number($event))"
                    />
                </div>

                <div class="flex w-full items-center justify-between gap-2 px-3 py-2">
                    <Label class="w-full text-center">{{ t('common.height') }}</Label>

                    <Slider
                        :max="200"
                        :step="1"
                        :model-value="[shineHeight]"
                        @update:model-value="$emit('update:shine-height', Number($event[0]))"
                    />

                    <Input
                        type="number"
                        class="w-16 text-center"
                        :model-value="shineHeight"
                        @update:model-value="$emit('update:shine-height', Number($event))"
                    />
                </div>

                <div class="flex w-full items-center justify-between gap-2 px-3 py-2">
                    <Label class="w-full text-center">{{ t('common.opacity') }}</Label>

                    <Slider
                        :max="0.1"
                        :step="0.01"
                        :model-value="[shineOpacity]"
                        @update:model-value="$emit('update:shine-opacity', Number($event[0]))"
                    />

                    <Input
                        step="0.01"
                        type="number"
                        class="w-16 text-center"
                        :model-value="shineOpacity"
                        @update:model-value="$emit('update:shine-opacity', Number($event))"
                    />
                </div>
            </div>
        </template>
    </Toggle>
</template>

<script setup>
import useI18n from '@/composables/useI18n';

defineProps({
    shineWidth: {
        type: Number,
        required: true,
    },
    shineHeight: {
        type: Number,
        required: true,
    },
    shineOpacity: {
        type: Number,
        required: true,
    },
});

const { t } = useI18n();
</script>
