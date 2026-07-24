<template>
    <Switch
        :model-value="isDark"
        :aria-label="t('action.toggleColorScheme')"
        @update:model-value="toggle"
    >
        <template #thumb>
            <SunIcon v-if="!isDark" class="h-2 w-2 text-amber-500" />
            <MoonIcon v-else class="h-2 w-2 text-indigo-400" />
        </template>
    </Switch>
</template>

<script setup>
import { computed } from 'vue';
import { SunIcon, MoonIcon } from 'lucide-vue-next';
import { colorMode } from '@/composables/useApplicationStore';
import useI18n from '@/composables/useI18n';

const isDark = computed(() => colorMode.value === 'dark');
const { t } = useI18n();

const toggle = () => (colorMode.value = isDark.value ? 'light' : 'dark');
</script>
