<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import type { Project } from '../types';
import { useProjectStore } from '../stores/project';
import { useI18n } from 'vue-i18n';
import { marked } from 'marked';
import { api } from '../api';
import { isSafeExternalUrl } from '../utils/externalUrl';

const { t } = useI18n();
const props = defineProps<{ project: Project }>();
const projectStore = useProjectStore();

// Editor modes: 'preview' | 'edit' | 'split'
const editorMode = ref<'preview' | 'edit' | 'split'>('preview');
const memoContent = ref('');
const isDirty = ref(false);
const renderedHtml = ref('');
let renderTimer: number | null = null;

function renderMarkdown(immediate = false) {
    if (renderTimer !== null) {
        window.clearTimeout(renderTimer);
        renderTimer = null;
    }

    if (editorMode.value === 'edit') {
        renderedHtml.value = '';
        return;
    }

    const nextContent = memoContent.value;
    const applyRender = () => {
        const parsed = nextContent ? marked.parse(nextContent, { async: false }) : '';
        renderedHtml.value = typeof parsed === 'string' ? parsed : '';
        renderTimer = null;
    };

    if (immediate || editorMode.value === 'preview') {
        applyRender();
        return;
    }

    renderTimer = window.setTimeout(applyRender, 120);
}

// Sync memo content from project
watch(() => props.project.id, () => {
    memoContent.value = props.project.memo || '';
    isDirty.value = false;
    editorMode.value = 'preview';
    renderMarkdown(true);
}, { immediate: true });

watch(() => props.project.memo, (newMemo) => {
    if (!isDirty.value) {
        memoContent.value = newMemo || '';
        renderMarkdown(true);
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
    renderMarkdown(true);
}

watch([memoContent, editorMode], ([, mode], [, prevMode]) => {
    renderMarkdown(mode === 'preview' || mode !== prevMode);
});

onBeforeUnmount(() => {
    if (renderTimer !== null) {
        window.clearTimeout(renderTimer);
    }
});

function handleMarkdownClick(e: MouseEvent) {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    if (isSafeExternalUrl(href)) void api.openUrl(href);
}
</script>

<template>
    <div class="app-page absolute inset-0">
        <!-- Toolbar -->
        <div class="app-panel-toolbar flex items-center justify-between px-3 py-1.5 shrink-0">
            <div class="flex items-center gap-2">
                <div class="i-mdi-note-text text-sm text-slate-400" />
                <span class="app-text-control text-slate-500 dark:text-slate-400 uppercase tracking-wider">{{ t('memo.title') }}</span>
                <span class="app-muted-pill app-text-caption px-1.5 py-0.5 font-mono">Markdown</span>
                <span v-if="isDirty" class="app-text-caption text-amber-500 font-bold">●</span>
            </div>
            <div class="flex items-center gap-1.5">
                <!-- Preview mode: show Edit button -->
                <template v-if="editorMode === 'preview'">
                    <button @click="enterEditMode"
                        class="app-primary-action app-text-control !min-h-0 px-2 py-0.5">
                        <div class="i-mdi-pencil text-xs" />
                        {{ t('memo.edit') }}
                    </button>
                </template>
                <!-- Edit/Split mode: show mode toggle + back + save -->
                <template v-else>
                    <button v-if="editorMode === 'edit'" @click="enterSplitMode"
                        class="app-outline-action app-text-control px-2 py-0.5">
                        <div class="i-mdi-view-split-vertical text-xs" />
                        {{ t('memo.split') }}
                    </button>
                    <button v-else @click="enterEditMode"
                        class="app-outline-action app-text-control px-2 py-0.5">
                        <div class="i-mdi-pencil text-xs" />
                        {{ t('memo.edit') }}
                    </button>
                    <button v-if="isDirty" @click="saveMemo"
                        class="app-text-control px-2 py-0.5 rounded bg-emerald-500/8 text-emerald-600 dark:text-emerald-400 border border-emerald-500/15 hover:bg-emerald-500/15 transition-all duration-150 flex items-center gap-1">
                        <div class="i-mdi-content-save text-xs" />
                        {{ t('common.save') }}
                    </button>
                    <button @click="backToPreview"
                        class="app-outline-action app-text-control px-2 py-0.5">
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
                    class="memo-editor app-text-body flex-1 w-full p-4 font-mono resize-none outline-none border-none"
                    :placeholder="t('memo.placeholder')"
                    spellcheck="false"
                />
            </div>

            <!-- Preview mode: only rendered -->
            <div v-if="editorMode === 'preview'" class="flex-1 overflow-y-auto">
                <div v-if="!memoContent" class="flex flex-col items-center justify-center h-full text-slate-300 dark:text-slate-600">
                    <div class="i-mdi-note-text-outline text-5xl mb-3 opacity-20" />
                    <p class="app-text-body">{{ t('memo.empty') }}</p>
                    <button @click="editorMode = 'edit'" class="app-text-control mt-2 text-blue-500 hover:text-blue-600">
                        {{ t('memo.startEditing') }}
                    </button>
                </div>
                <div v-else class="p-4 markdown-body" v-html="renderedHtml" @click="handleMarkdownClick" />
            </div>

            <!-- Split mode: editor + preview side by side -->
            <template v-if="editorMode === 'split'">
                <div class="flex-1 flex flex-col overflow-hidden border-r border-[var(--app-border)]">
                    <textarea
                        :value="memoContent"
                        @input="handleInput"
                        class="memo-editor app-text-body flex-1 w-full p-4 font-mono resize-none outline-none border-none"
                        :placeholder="t('memo.placeholder')"
                        spellcheck="false"
                    />
                </div>
                <div class="flex-1 overflow-y-auto">
                    <div class="p-4 markdown-body" v-html="renderedHtml" @click="handleMarkdownClick" />
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
.markdown-body {
    color: inherit;
    font-size: var(--app-font-body);
    line-height: 1.65;
}

.markdown-body :deep(h1) {
    font-size: 1.5em;
    font-weight: 700;
    margin: 0.8em 0 0.4em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--app-border);
}

.markdown-body :deep(h2) {
    font-size: 1.25em;
    font-weight: 600;
    margin: 0.8em 0 0.4em;
    padding-bottom: 0.2em;
    border-bottom: 1px solid var(--app-border);
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
    background: var(--app-surface-soft);
}

.markdown-body :deep(pre) {
    padding: 1em;
    border-radius: 8px;
    overflow-x: auto;
    background: var(--app-surface-soft);
    margin: 0.5em 0;
}

.markdown-body :deep(pre code) {
    padding: 0;
    background: transparent;
}

.markdown-body :deep(blockquote) {
    padding: 0.5em 1em;
    margin: 0.5em 0;
    border-left: 4px solid var(--app-primary);
    background: var(--app-surface-soft);
    color: var(--app-text-secondary);
}

.markdown-body :deep(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5em 0;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
    border: 1px solid var(--app-border);
    padding: 0.4em 0.8em;
    text-align: left;
}

.markdown-body :deep(th) {
    background: var(--app-surface-soft);
    font-weight: 600;
}

.markdown-body :deep(a) {
    color: var(--app-primary);
    text-decoration: none;
}

.markdown-body :deep(a:hover) {
    text-decoration: underline;
}

.markdown-body :deep(hr) {
    border: none;
    border-top: 1px solid var(--app-border);
    margin: 1em 0;
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
    background: color-mix(in srgb, var(--app-text-muted) 52%, transparent);
    border-radius: 2px;
}

.memo-editor {
    background: var(--app-surface);
    color: var(--app-text-secondary);
}
</style>
