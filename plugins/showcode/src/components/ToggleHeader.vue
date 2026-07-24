<template>
    <Toggle
        v-bind="$attrs"
        :popover-title="`${t('common.header')} ${t('common.settings')}`"
        :settings-tooltip="t('tooltip.configureHeader')"
    >
        <template #popover>
            <div
                class="grid grid-cols-2 grid-rows-2"
                :class="{
                    'pointer-events-none opacity-40 grayscale select-none': locked,
                }"
            >
                <div
                    class="flex items-center justify-between gap-2 border-r border-b border-zinc-200 p-2 dark:border-zinc-800"
                >
                    <Label>{{ t('common.title') }}</Label>

                    <div class="flex items-center">
                        <Toggle
                            :model-value="showTitle"
                            @update:model-value="$emit('update:show-title', $event)"
                        />
                    </div>
                </div>

                <div
                    class="flex items-center justify-between gap-2 border-b border-zinc-200 p-2 dark:border-zinc-800"
                >
                    <Label>{{ t('common.accent') }}</Label>

                    <div class="flex items-center">
                        <Toggle
                            :model-value="showHeaderAccent"
                            @update:model-value="$emit('update:show-header-accent', $event)"
                        />
                    </div>
                </div>

                <div
                    class="flex items-center justify-between gap-2 border-r border-zinc-200 p-2 dark:border-zinc-800"
                >
                    <Label class="whitespace-nowrap">{{ t('common.menu') }}</Label>

                    <div class="flex items-center">
                        <Toggle
                            :model-value="showMenu"
                            @update:model-value="$emit('update:show-menu', $event)"
                        />
                    </div>
                </div>

                <div class="flex items-center justify-between gap-2 p-2">
                    <Label class="whitespace-nowrap">{{ t('common.menuColor') }}</Label>

                    <div class="flex items-center">
                        <Toggle
                            :model-value="showColorMenu"
                            @update:model-value="$emit('update:show-color-menu', $event)"
                        />
                    </div>
                </div>
            </div>
        </template>
    </Toggle>
</template>

<script setup>
import useI18n from '@/composables/useI18n';

defineProps({
    showTitle: { type: Boolean, required: true },
    showMenu: { type: Boolean, required: true },
    showColorMenu: { type: Boolean, required: true },
    showHeaderAccent: { type: Boolean, required: true },
    locked: { type: Boolean, default: false },
});

defineEmits([
    'update:show-title',
    'update:show-menu',
    'update:show-color-menu',
    'update:show-header-accent',
]);

const { t } = useI18n();
</script>
