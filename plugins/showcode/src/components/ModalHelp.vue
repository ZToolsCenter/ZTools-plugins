<template>
    <Dialog :open="modelValue" @update:open="$emit('update:modelValue', $event)">
        <DialogContent class="flex max-h-[80vh] max-w-2xl flex-col gap-0 p-0">
            <DialogHeader
                class="shrink-0 border-b border-zinc-200 px-5 pb-3 pt-4 dark:border-zinc-800"
            >
                <DialogTitle class="text-sm font-semibold">{{ t('menu.help') }}</DialogTitle>
            </DialogHeader>

            <ScrollArea class="flex-1 overflow-auto">
                <div class="space-y-4 p-5">
                    <div
                        v-for="(section, index) in sections"
                        :key="index"
                        class="rounded-lg border border-zinc-200 dark:border-zinc-800"
                    >
                        <div
                            class="rounded-t-lg border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900"
                        >
                            <span class="text-sm font-semibold">{{ section.title }}</span>
                        </div>

                        <div class="space-y-4 px-4 py-4">
                            <template v-for="(block, bIndex) in section.blocks" :key="bIndex">
                                <p
                                    v-if="block.type === 'text'"
                                    class="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
                                >
                                    {{ block.content }}
                                </p>

                                <div v-else-if="block.type === 'image'" class="flex justify-center">
                                    <img
                                        :src="block.src"
                                        :width="block.width"
                                        class="rounded-lg border border-zinc-200 dark:border-zinc-700"
                                    />
                                </div>

                                <div
                                    v-else-if="block.type === 'table'"
                                    class="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
                                >
                                    <table class="w-full text-sm">
                                        <thead>
                                            <tr
                                                class="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                                            >
                                                <th
                                                    v-for="(header, hIndex) in block.headers"
                                                    :key="hIndex"
                                                    class="px-4 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400"
                                                >
                                                    {{ header }}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody
                                            class="divide-y divide-zinc-100 dark:divide-zinc-800/50"
                                        >
                                            <tr v-for="(row, rIndex) in block.rows" :key="rIndex">
                                                <td
                                                    class="px-4 py-2.5 font-medium text-zinc-700 dark:text-zinc-300"
                                                >
                                                    {{ row.label }}
                                                </td>
                                                <td class="px-4 py-2.5">
                                                    <div class="flex items-center gap-1">
                                                        <kbd
                                                            v-for="(key, kIndex) in row.keys"
                                                            :key="kIndex"
                                                            class="rounded-md border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 shadow-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                                                        >
                                                            {{ key }}
                                                        </kbd>
                                                    </div>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            </ScrollArea>
        </DialogContent>
    </Dialog>
</template>

<script setup>
import { computed } from 'vue';
import useI18n from '@/composables/useI18n';

defineProps({ modelValue: { type: [Boolean, Object], default: false } });
defineEmits(['update:modelValue']);

const { t } = useI18n();

const sections = computed(() => [
    {
        title: t('help.codeHighlighting'),
        blocks: [
            {
                type: 'text',
                content: t('help.highlightIntro'),
            },
            {
                type: 'image',
                src: 'help/line-context-menu.png',
                width: 400,
            },
            {
                type: 'text',
                content: t('help.highlightResult'),
            },
            {
                type: 'image',
                src: 'help/highlight-dots.png',
                width: 400,
            },
            {
                type: 'text',
                content: t('help.keyboardShortcutIntro'),
            },
            {
                type: 'table',
                headers: [t('help.style'), t('help.keyboardShortcut')],
                rows: [
                    { label: t('help.addedLine'), keys: ['⌘/Ctrl', 'Shift', 'A'] },
                    { label: t('help.removedLine'), keys: ['⌘/Ctrl', 'Shift', 'R'] },
                    { label: t('help.focusedLine'), keys: ['⌘/Ctrl', 'Shift', 'F'] },
                ],
            },
        ],
    },
]);
</script>
