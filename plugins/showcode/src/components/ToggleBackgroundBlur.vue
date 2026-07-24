<template>
    <Toggle
        v-bind="$attrs"
        :popover-title="`${t('common.background')} ${t('common.blur')} ${t('common.settings')}`"
        :settings-tooltip="t('tooltip.configureBackgroundBlur')"
    >
        <template #popover>
            <div class="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
                <div class="flex w-full items-center justify-between gap-2 px-3 py-2">
                    <Label class="w-full text-center">{{ t('common.amount') }}</Label>

                    <Slider
                        :max="100"
                        :step="1"
                        :model-value="[backgroundBlur]"
                        @update:model-value="$emit('update:background-blur-sm', Number($event[0]))"
                    />

                    <Input
                        type="number"
                        class="w-16 text-center"
                        :value="backgroundBlur"
                        @update:model-value="$emit('update:background-blur-sm', Number($event))"
                    />
                </div>
            </div>
        </template>
    </Toggle>
</template>

<script setup>
import useI18n from '@/composables/useI18n';

defineProps({
    backgroundBlur: {
        type: Number,
        required: true,
    },
});

const { t } = useI18n();
</script>
