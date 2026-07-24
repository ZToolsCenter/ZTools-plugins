<template>
    <ColorPicker
        v-bind="$attrs"
        class="flex justify-center"
        popover-inner-class="overflow-hidden border-2 rounded-lg shadow-xl bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
        #default="{ solid }"
    >
        <Button class="tooltip-target w-full">
            <span class="h-6 w-6 rounded-full" :style="{ backgroundColor: solid }" />

            {{ t('action.pickColor') }}
        </Button>
    </ColorPicker>
</template>

<script setup>
import useI18n from '@/composables/useI18n';

const { t } = useI18n();
</script>
