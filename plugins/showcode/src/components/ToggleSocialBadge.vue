<template>
    <Toggle
        v-bind="$attrs"
        :popover-title="`${t('common.socialBadge')} ${t('common.settings')}`"
        :settings-tooltip="t('tooltip.configureSocialBadge')"
    >
        <template #popover>
            <div class="flex w-80 flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
                <div class="grid grid-cols-2 items-center p-2">
                    <Label class="p-2 text-right">{{ t('common.type') }}</Label>

                    <Select
                        :model-value="socialType"
                        @update:model-value="$emit('update:social-type', $event)"
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem v-for="type in types" :key="type.name" :value="type.name">
                                {{ type.title }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div class="grid grid-cols-2 items-center p-2">
                    <Label class="p-2 text-right">{{ t('common.username') }}</Label>

                    <Input
                        type="text"
                        autocomplete="off"
                        :value="socialUsername"
                        @update:model-value="$emit('update:social-username', $event)"
                    />
                </div>

                <div class="grid grid-cols-2 items-center p-2">
                    <Label class="p-2 text-right">{{ t('common.displayName') }}</Label>

                    <Input
                        type="text"
                        autocomplete="off"
                        :value="socialDisplayName"
                        @update:model-value="$emit('update:social-display-name', $event)"
                    />
                </div>

                <div class="grid grid-cols-2 items-center p-2">
                    <Label class="p-2 text-right">{{ t('common.position') }}</Label>

                    <Select
                        :model-value="socialPosition"
                        @update:model-value="$emit('update:social-position', $event)"
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem v-for="pos in positions" :key="pos.name" :value="pos.name">
                                {{ pos.title }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div class="grid grid-cols-2 items-center p-2">
                    <Label class="p-2 text-right">
                        {{ t('common.borderRadius') }}

                        <span class="text-xs text-zinc-400 dark:text-zinc-500">
                            ({{ socialBorderRadius }} px)
                        </span>
                    </Label>

                    <Slider
                        :max="25"
                        :step="1"
                        :model-value="[socialBorderRadius]"
                        @update:model-value="$emit('update:social-border-radius', $event[0])"
                    />
                </div>
            </div>
        </template>
    </Toggle>
</template>

<script setup>
import useSocials from '@/composables/useSocials';
import useI18n from '@/composables/useI18n';

defineProps({
    socialType: String,
    socialPosition: String,
    socialUsername: String,
    socialDisplayName: String,
    socialBorderRadius: Number,
});

const { types, positions } = useSocials();
const { t } = useI18n();
</script>
