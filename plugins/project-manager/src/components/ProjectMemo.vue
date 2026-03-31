<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Project } from '../types';
import { useProjectStore } from '../stores/project';
import { useI18n } from 'vue-i18n';
import { marked } from 'marked';

const { t } = useI18n();
const props = defineProps<{ project: Project }>();
const projectStore = useProjectStore();

// Editor modes: 'preview' | 'edit' | 'split'
const editorMode = ref<'preview' | 'edit' | 'split'>('preview');
const memoContent = ref('');
const isDirty = ref(false);

// Sync memo content from project
watch(() => props.project.id, () => {
    memoContent.value = props.project.memo || '';
    isDirty.value = false;
    editorMode.value = 'preview';
}, { immediate: true });

watch(() => props.project.memo, (newMemo) => {
    if (!isDirty.value) {
        memoContent.value = newMemo || '';
    }
});

function handleInput(e: Event) {
    memoContent.value = (e.target as HTMLTextAreaElement).value;
    isDirty.value = memoContent.value !== (props.project.memo || '');
}

function saveMemo() {
    const project = projectStore.projects.find(p => p.id === props.project.id);
    if (project) {
        project.memo = memoContent.value;
        isDirty.value = false;
    }
}

function enterEditMode() {
    editorMode.value = 'edit';
}

function enterSplitMode() {
    editorMode.value = 'split';
}

function backToPreview() {
    if (isDirty.value) {
        saveMemo();
    }
    editorMode.value = 'preview';
}

const renderedHtml = computed(() => {
    if (!memoContent.value) return '';
    return marked(memoContent.value);
});
</script>

<template>
    <div class="absolute inset-0 flex flex-col bg-slate-50 dark:bg-[#0f172a] overflow-hidden">
        <!-- Toolbar -->
        <div class="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 dark:border-slate-700/20 bg-white dark:bg-[#1e293b] shrink-0">
            <div class="flex items-center gap-2">
                <div class="i-mdi-note-text text-sm text-slate-400" />
                <span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{{ t('memo.title') }}</span>
                <span class="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 font-mono">Markdown</span>
                <span v-if="isDirty" class="text-[10px] text-amber-500 font-bold">●</span>
            </div>
            <div class="flex items-center gap-1.5">
                <!-- Preview mode: show Edit button -->
                <template v-if="editorMode === 'preview'">
                    <button @click="enterEditMode"
                        class="px-2 py-0.5 text-[11px] rounded border transition-all duration-150 flex items-center gap-1 bg-blue-500/8 text-blue-600 dark:text-blue-400 border-blue-500/15 hover:bg-blue-500/15">
                        <div class="i-mdi-pencil text-xs" />
                        {{ t('memo.edit') }}
                    </button>
                </template>
                <!-- Edit/Split mode: show mode toggle + back + save -->
                <template v-else>
                    <button v-if="editorMode === 'edit'" @click="enterSplitMode"
                        class="px-2 py-0.5 text-[11px] rounded border transition-all duration-150 flex items-center gap-1 bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700">
                        <div class="i-mdi-view-split-vertical text-xs" />
                        {{ t('memo.split') }}
                    </button>
                    <button v-else @click="enterEditMode"
                        class="px-2 py-0.5 text-[11px] rounded border transition-all duration-150 flex items-center gap-1 bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700">
                        <div class="i-mdi-pencil text-xs" />
                        {{ t('memo.edit') }}
                    </button>
                    <button v-if="isDirty" @click="saveMemo"
                        class="px-2 py-0.5 text-[11px] rounded bg-emerald-500/8 text-emerald-600 dark:text-emerald-400 border border-emerald-500/15 hover:bg-emerald-500/15 transition-all duration-150 flex items-center gap-1">
                        <div class="i-mdi-content-save text-xs" />
                        {{ t('common.save') }}
                    </button>
                    <button @click="backToPreview"
                        class="px-2 py-0.5 text-[11px] rounded border transition-all duration-150 flex items-center gap-1 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-300 border-slate-200 dark:border-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700">
                        <div class="i-mdi-eye text-xs" />
                        {{ t('memo.preview') }}
                    </button>
                </template>
            </div>
        </div>

        <!-- Content area -->
        <div class="flex-1 overflow-hidden flex min-h-0">
            <!-- Edit mode: only editor -->
            <div v-if="editorMode === 'edit'" class="flex-1 flex flex-col overflow-hidden">
                <textarea
                    :value="memoContent"
                    @input="handleInput"
                    class="flex-1 w-full p-4 bg-white dark:bg-[#0f172a] text-slate-700 dark:text-slate-300 font-mono text-xs leading-relaxed resize-none outline-none border-none"
                    :placeholder="t('memo.placeholder')"
                    spellcheck="false"
                />
            </div>

            <!-- Preview mode: only rendered -->
            <div v-if="editorMode === 'preview'" class="flex-1 overflow-y-auto">
                <div v-if="!memoContent" class="flex flex-col items-center justify-center h-full text-slate-300 dark:text-slate-600">
                    <div class="i-mdi-note-text-outline text-5xl mb-3 opacity-20" />
                    <p class="text-xs">{{ t('memo.empty') }}</p>
                    <button @click="editorMode = 'edit'" class="mt-2 text-xs text-blue-500 hover:text-blue-600">
                        {{ t('memo.startEditing') }}
                    </button>
                </div>
                <div v-else class="p-4 markdown-body" v-html="renderedHtml" />
            </div>

            <!-- Split mode: editor + preview side by side -->
            <template v-if="editorMode === 'split'">
                <div class="flex-1 flex flex-col overflow-hidden border-r border-slate-200 dark:border-slate-700/20">
                    <textarea
                        :value="memoContent"
                        @input="handleInput"
                        class="flex-1 w-full p-4 bg-white dark:bg-[#0f172a] text-slate-700 dark:text-slate-300 font-mono text-xs leading-relaxed resize-none outline-none border-none"
                        :placeholder="t('memo.placeholder')"
                        spellcheck="false"
                    />
                </div>
                <div class="flex-1 overflow-y-auto">
                    <div class="p-4 markdown-body" v-html="renderedHtml" />
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
.markdown-body {
    color: inherit;
    font-size: 13px;
    line-height: 1.7;
}

.markdown-body :deep(h1) {
    font-size: 1.5em;
    font-weight: 700;
    margin: 0.8em 0 0.4em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid #e2e8f0;
}

.dark .markdown-body :deep(h1) {
    border-bottom-color: #1e293b;
}

.markdown-body :deep(h2) {
    font-size: 1.25em;
    font-weight: 600;
    margin: 0.8em 0 0.4em;
    padding-bottom: 0.2em;
    border-bottom: 1px solid #e2e8f0;
}

.dark .markdown-body :deep(h2) {
    border-bottom-color: #1e293b;
}

.markdown-body :deep(h3) {
    font-size: 1.1em;
    font-weight: 600;
    margin: 0.6em 0 0.3em;
}

.markdown-body :deep(p) {
    margin: 0.5em 0;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
    padding-left: 1.5em;
    margin: 0.5em 0;
}

.markdown-body :deep(li) {
    margin: 0.2em 0;
}

.markdown-body :deep(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.85em;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    background: #f1f5f9;
}

.dark .markdown-body :deep(code) {
    background: #1e293b;
}

.markdown-body :deep(pre) {
    padding: 1em;
    border-radius: 8px;
    overflow-x: auto;
    background: #f1f5f9;
    margin: 0.5em 0;
}

.dark .markdown-body :deep(pre) {
    background: #1e293b;
}

.markdown-body :deep(pre code) {
    padding: 0;
    background: transparent;
}

.markdown-body :deep(blockquote) {
    padding: 0.5em 1em;
    margin: 0.5em 0;
    border-left: 4px solid #3b82f6;
    background: #f8fafc;
    color: #64748b;
}

.dark .markdown-body :deep(blockquote) {
    background: #1e293b;
    color: #94a3b8;
}

.markdown-body :deep(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5em 0;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
    border: 1px solid #e2e8f0;
    padding: 0.4em 0.8em;
    text-align: left;
}

.dark .markdown-body :deep(th),
.dark .markdown-body :deep(td) {
    border-color: #334155;
}

.markdown-body :deep(th) {
    background: #f1f5f9;
    font-weight: 600;
}

.dark .markdown-body :deep(th) {
    background: #1e293b;
}

.markdown-body :deep(a) {
    color: #3b82f6;
    text-decoration: none;
}

.markdown-body :deep(a:hover) {
    text-decoration: underline;
}

.markdown-body :deep(hr) {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 1em 0;
}

.dark .markdown-body :deep(hr) {
    border-top-color: #334155;
}

.markdown-body :deep(img) {
    max-width: 100%;
    border-radius: 8px;
}

textarea::-webkit-scrollbar {
    width: 4px;
}
textarea::-webkit-scrollbar-track {
    background: transparent;
}
textarea::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 2px;
}
.dark textarea::-webkit-scrollbar-thumb {
    background: #334155;
}
</style>
