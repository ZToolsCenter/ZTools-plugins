<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import type { Project, ProjectFileEntry } from '../types';
import { useProjectStore } from '../stores/project';
import { api } from '../api';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import { pinyin } from 'pinyin-pro';

const { t, locale } = useI18n();
const props = defineProps<{ project: Project }>();
const projectStore = useProjectStore();

// View mode: 'list' or 'detail'
const viewMode = ref<'list' | 'detail'>('list');

// Current browsing path (for navigating into directories)
const currentPath = ref<string[]>([]);

// Loading state for directory contents
const dirContents = ref<{ name: string; isDirectory: boolean }[]>([]);
const loadingDir = ref(false);
const searchQuery = ref('');

// The project files saved in project data
const projectFiles = computed(() => props.project.projectFiles || []);

// Currently browsing inside a project file directory
const browsingEntry = ref<ProjectFileEntry | null>(null);

// Context menu state
const contextMenuVisible = ref(false);
const contextMenuStyle = ref({ left: '0px', top: '0px' });
const contextMenuTarget = ref<{ path: string; name: string; isDirectory: boolean; isRootEntry?: boolean; entry?: ProjectFileEntry } | null>(null);
const contextMenuRef = ref<HTMLElement | null>(null);

// File preview
const previewVisible = ref(false);
const previewFile = ref<{ name: string; path: string; content: string; type: 'image' | 'text' | 'unsupported' } | null>(null);
const fileListContainerRef = ref<HTMLElement | null>(null);
const showBackToTop = ref(false);
const BACK_TO_TOP_THRESHOLD = 480;

// Breadcrumb path parts
const breadcrumbs = computed(() => {
    if (!browsingEntry.value) return [];
    const parts = [{ name: browsingEntry.value.name, path: browsingEntry.value.path }];
    for (let i = 0; i < currentPath.value.length; i++) {
        const fullPath = joinPath(browsingEntry.value.path, ...currentPath.value.slice(0, i + 1));
        parts.push({ name: currentPath.value[i], path: fullPath });
    }
    return parts;
});

const currentFullPath = computed(() => {
    if (!browsingEntry.value) return '';
    if (currentPath.value.length === 0) return browsingEntry.value.path;
    return joinPath(browsingEntry.value.path, ...currentPath.value);
});

const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLowerCase());
const compactSearchQuery = computed(() => normalizedSearchQuery.value.replace(/\s+/g, ''));
const filteredProjectFiles = computed(() => {
    if (!normalizedSearchQuery.value) return projectFiles.value;
    return projectFiles.value.filter(file => matchesSearchQuery(file.name));
});

const filteredDirContents = computed(() => {
    if (!normalizedSearchQuery.value) return dirContents.value;
    return dirContents.value.filter(entry => matchesSearchQuery(entry.name));
});

function updateBackToTopVisibility() {
    const container = fileListContainerRef.value;
    showBackToTop.value = !!container && container.scrollTop > BACK_TO_TOP_THRESHOLD;
}

function handleFileListScroll() {
    updateBackToTopVisibility();
}

function scrollToTop() {
    fileListContainerRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
}

function joinPath(...parts: string[]): string {
    return parts.join('/').replace(/\\/g, '/');
}

function normalizePath(p: string): string {
    return p.replace(/\//g, '\\');
}

function getParentDir(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx > 0 ? normalized.substring(0, idx) : normalized;
}

// Load directory contents when browsing
watch(currentFullPath, async (path) => {
    if (!path) {
        dirContents.value = [];
        return;
    }
    await loadDirContents(path);
}, { immediate: true });

function buildPinyinSearchText(text: string): string {
    if (!text) return '';
    const syllables = pinyin(text, { toneType: 'none', type: 'array' }) as string[];
    const full = syllables.join('');
    const initials = syllables.map(item => item[0] || '').join('');
    return `${full} ${initials}`.toLowerCase();
}

function normalizeSearchCandidate(text: string) {
    return text.replace(/\\/g, '/').toLowerCase();
}

function matchesSearchQuery(...candidates: string[]) {
    if (!normalizedSearchQuery.value) return true;
    const query = normalizedSearchQuery.value;
    const compactQuery = compactSearchQuery.value;

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeSearchCandidate(candidate);
        if (!normalizedCandidate) continue;
        if (normalizedCandidate.includes(query)) return true;
        if (normalizedCandidate.replace(/\s+/g, '').includes(compactQuery)) return true;
    }

    return candidates.some(candidate => buildPinyinSearchText(candidate).includes(compactQuery));
}

// ---- Deep search index (memory-optimized: no pre-computed searchText) ----
type IndexEntry = {
    id: string;
    name: string;
    path: string;
    isDirectory: boolean;
    sourceEntryId: string;
    relativePath: string;
};

const MAX_INDEX_ENTRIES = 5000;
const MAX_INDEX_DEPTH = 6;

const searchIndexLoading = ref(false);
const searchResults = ref<IndexEntry[]>([]);
const indexedEntries = ref<IndexEntry[]>([]);
const searchIndexCacheKey = ref('');
const searchIndexReady = ref(false);
let searchIndexToken = 0;

const hasSearchQuery = computed(() => normalizedSearchQuery.value.length > 0);
const openMenuLabel = computed(() => t('fileManager.open'));
const previewMenuLabel = computed(() => t('fileManager.preview'));
const locationMenuLabel = computed(() => locale.value.startsWith('zh') ? '显示位置' : t('fileManager.openLocation'));
const removeMenuLabel = computed(() => locale.value.startsWith('zh') ? '移出列表' : t('fileManager.remove'));

function getSearchIndexCacheKey(entries: ProjectFileEntry[]) {
    return entries.map(e => `${e.id}:${e.path}`).sort().join('|');
}

function resetSearchIndex() {
    searchIndexToken += 1;
    searchIndexLoading.value = false;
    searchIndexReady.value = false;
    searchResults.value = [];
    indexedEntries.value = [];
    searchIndexCacheKey.value = '';
}

async function collectSearchEntries(
    sourceEntry: ProjectFileEntry,
    entryPath: string,
    entryName: string,
    isDirectory: boolean,
    results: IndexEntry[],
    relativeSegments: string[] = [],
) {
    if (results.length >= MAX_INDEX_ENTRIES) return;
    results.push({
        id: `${sourceEntry.id}:${relativeSegments.join('/') || '__root__'}`,
        name: entryName,
        path: entryPath,
        isDirectory,
        sourceEntryId: sourceEntry.id,
        relativePath: relativeSegments.join('/'),
    });

    if (!isDirectory || relativeSegments.length >= MAX_INDEX_DEPTH) return;

    try {
        const children = await api.readDir(entryPath);
        for (const child of children) {
            if (results.length >= MAX_INDEX_ENTRIES) break;
            await collectSearchEntries(
                sourceEntry,
                joinPath(entryPath, child.name),
                child.name,
                child.isDirectory,
                results,
                [...relativeSegments, child.name],
            );
        }
    } catch {
        // ignore unreadable dirs
    }
}

async function ensureSearchIndex() {
    const cacheKey = getSearchIndexCacheKey(projectFiles.value);
    if (cacheKey === searchIndexCacheKey.value && searchIndexReady.value) return true;

    const token = ++searchIndexToken;
    searchIndexLoading.value = true;
    searchIndexReady.value = false;
    const nextEntries: IndexEntry[] = [];

    for (const entry of projectFiles.value) {
        await collectSearchEntries(entry, entry.path, entry.name, entry.isDirectory, nextEntries);
        if (token !== searchIndexToken) return false;
    }

    if (token !== searchIndexToken) return false;

    indexedEntries.value = nextEntries;
    searchIndexCacheKey.value = cacheKey;
    searchIndexReady.value = true;
    searchIndexLoading.value = false;
    return true;
}

function matchesIndexEntry(entry: IndexEntry) {
    return matchesSearchQuery(entry.name);
}

async function refreshSearchResults() {
    if (!hasSearchQuery.value) {
        resetSearchIndex();
        return;
    }

    const ready = await ensureSearchIndex();
    if (!ready) return;

    searchResults.value = indexedEntries.value.filter(matchesIndexEntry);
}

watch([normalizedSearchQuery, projectFiles], () => {
    void refreshSearchResults();
}, { immediate: true, deep: true });

watch(
    () => [
        props.project.id,
        browsingEntry.value?.id || '',
        currentFullPath.value,
        viewMode.value,
        hasSearchQuery.value,
        projectFiles.value.length,
        filteredProjectFiles.value.length,
        filteredDirContents.value.length,
        searchResults.value.length,
        loadingDir.value,
    ],
    () => {
        void nextTick(() => {
            updateBackToTopVisibility();
        });
    },
    { immediate: true },
);

function openSearchResult(result: IndexEntry) {
    if (!result.isDirectory) {
        void quickPreviewOrOpen(result.path, result.name);
        return;
    }

    const sourceEntry = projectFiles.value.find(entry => entry.id === result.sourceEntryId);
    if (!sourceEntry) return;

    searchQuery.value = '';
    browsingEntry.value = sourceEntry;
    currentPath.value = result.relativePath ? result.relativePath.split('/').filter(Boolean) : [];
}
// ---- End deep search index ----

onBeforeUnmount(() => {
    resetSearchIndex();
});

async function loadDirContents(path: string) {
    if (!path) return;
    loadingDir.value = true;
    try {
        const entries = await api.readDir(path);
        dirContents.value = entries.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
    } catch (e) {
        console.error('Failed to read directory', e);
        dirContents.value = [];
    } finally {
        loadingDir.value = false;
    }
}

function navigateInto(folderName: string) {
    currentPath.value.push(folderName);
}

function navigateToRoot() {
    browsingEntry.value = null;
    currentPath.value = [];
    dirContents.value = [];
}

function navigateToBreadcrumb(index: number) {
    if (index === 0) {
        currentPath.value = [];
    } else {
        currentPath.value = currentPath.value.slice(0, index);
    }
}

function handleDoubleClick(entry: { name: string; isDirectory: boolean }) {
    if (entry.isDirectory) {
        navigateInto(entry.name);
    } else {
        const filePath = joinPath(currentFullPath.value, entry.name);
        quickPreviewOrOpen(filePath, entry.name);
    }
}

function handleDoubleClickProjectFile(file: ProjectFileEntry) {
    if (file.isDirectory) {
        browsingEntry.value = file;
        currentPath.value = [];
    } else {
        quickPreviewOrOpen(file.path, file.name);
    }
}

async function openFile(path: string) {
    try {
        await api.openFolder(normalizePath(path));
    } catch (e) {
        console.error('Failed to open file', e);
        ElMessage.error(t('common.error'));
    }
}

async function quickPreviewOrOpen(path: string, fileName: string) {
    if (canPreview(fileName)) {
        const previewed = await previewFileContent(path, fileName);
        if (previewed) return;
    }

    await openFile(path);
}

async function openFileLocation(filePath: string) {
    try {
        const parentDir = getParentDir(filePath);
        await api.openFolder(normalizePath(parentDir));
    } catch (e) {
        console.error('Failed to open location', e);
        ElMessage.error(t('common.error'));
    }
}

// Context menu
function onContextMenu(e: MouseEvent, item: { path: string; name: string; isDirectory: boolean; isRootEntry?: boolean; entry?: ProjectFileEntry }) {
    e.preventDefault();
    e.stopPropagation();
    contextMenuTarget.value = item;
    contextMenuStyle.value = { left: `${e.clientX}px`, top: `${e.clientY}px` };
    contextMenuVisible.value = true;

    void nextTick(() => {
        const menu = contextMenuRef.value;
        if (!menu) return;

        const gap = 12;
        const maxLeft = Math.max(gap, window.innerWidth - menu.offsetWidth - gap);
        const maxTop = Math.max(gap, window.innerHeight - menu.offsetHeight - gap);
        contextMenuStyle.value = {
            left: `${Math.min(e.clientX, maxLeft)}px`,
            top: `${Math.min(e.clientY, maxTop)}px`,
        };
    });

    const hide = () => {
        contextMenuVisible.value = false;
        document.removeEventListener('click', hide);
        document.removeEventListener('contextmenu', hide);
    };
    setTimeout(() => {
        document.addEventListener('click', hide);
        document.addEventListener('contextmenu', hide);
    }, 0);
}

function contextOpen() {
    if (!contextMenuTarget.value) return;
    if (contextMenuTarget.value.isDirectory) {
        if (contextMenuTarget.value.isRootEntry && contextMenuTarget.value.entry) {
            handleDoubleClickProjectFile(contextMenuTarget.value.entry);
        } else {
            navigateInto(contextMenuTarget.value.name);
        }
    } else {
        openFile(contextMenuTarget.value.path);
    }
    contextMenuVisible.value = false;
}

function contextOpenLocation() {
    if (!contextMenuTarget.value) return;
    openFileLocation(contextMenuTarget.value.path);
    contextMenuVisible.value = false;
}

function contextRemove() {
    if (!contextMenuTarget.value?.entry) return;
    removeEntry(contextMenuTarget.value.entry);
    contextMenuVisible.value = false;
}

async function contextPreview() {
    if (!contextMenuTarget.value || contextMenuTarget.value.isDirectory) return;
    await previewFileContent(contextMenuTarget.value.path, contextMenuTarget.value.name);
    contextMenuVisible.value = false;
}

// File preview
const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
const textExts = ['txt', 'md', 'json', 'geojson', 'js', 'ts', 'tsx', 'jsx', 'vue', 'html', 'css', 'scss', 'less', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env', 'sh', 'bat', 'ps1', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'log', 'csv', 'gitignore', 'editorconfig', 'prettierrc'];

function getFileExt(name: string): string {
    const dotIdx = name.lastIndexOf('.');
    if (dotIdx < 0) return '';
    return name.substring(dotIdx + 1).toLowerCase();
}

function canPreview(name: string): boolean {
    const ext = getFileExt(name);
    return imageExts.includes(ext) || textExts.includes(ext);
}

async function previewFileContent(filePath: string, fileName: string): Promise<boolean> {
    const ext = getFileExt(fileName);
    if (imageExts.includes(ext)) {
        try {
            const base64 = await api.readBinaryFileBase64(normalizePath(filePath));
            const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon' };
            const mime = mimeMap[ext] || 'image/png';
            previewFile.value = { name: fileName, path: filePath, content: `data:${mime};base64,${base64}`, type: 'image' };
            previewVisible.value = true;
            return true;
        } catch {
            ElMessage.warning(t('fileManager.previewFailed'));
            return false;
        }
    } else if (textExts.includes(ext)) {
        try {
            const content = await api.readTextFile(normalizePath(filePath));
            const truncated = content.length > 50000 ? content.substring(0, 50000) + '\n\n... (truncated)' : content;
            previewFile.value = { name: fileName, path: filePath, content: truncated, type: 'text' };
            previewVisible.value = true;
            return true;
        } catch (e) {
            ElMessage.warning(t('fileManager.previewFailed'));
            return false;
        }
    }

    return false;
}

async function chooseEntries(directory: boolean) {
    try {
        const selected = await api.openDialog({
            directory,
            multiple: true,
        });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        void addEntries(paths, directory);
    } catch (e) {
        console.error(e);
    }
}

async function detectDirectory(path: string): Promise<boolean> {
    try {
        await api.readDir(path);
        return true;
    } catch {
        return false;
    }
}

async function addEntries(paths: string[], isDirectory?: boolean) {
    const project = projectStore.projects.find(p => p.id === props.project.id);
    if (!project) return;
    if (!project.projectFiles) project.projectFiles = [];

    let added = 0;
    for (const path of paths) {
        if (project.projectFiles.some(f => f.path === path)) continue;
        const name = path.split(/[/\\]/).pop() || path;
        const entryIsDirectory = typeof isDirectory === 'boolean' ? isDirectory : await detectDirectory(path);
        project.projectFiles.push({
            id: crypto.randomUUID(),
            name,
            path,
            isDirectory: entryIsDirectory,
        });
        added++;
    }
    if (added > 0) {
        ElMessage.success(t('fileManager.addSuccess', { count: added }));
    }
}

function removeEntry(file: ProjectFileEntry) {
    ElMessageBox.confirm(
        t('fileManager.removeConfirm', { name: file.name }),
        t('common.delete'),
        {
            confirmButtonText: t('common.confirm'),
            cancelButtonText: t('common.cancel'),
            type: 'warning',
        }
    ).then(() => {
        const project = projectStore.projects.find(p => p.id === props.project.id);
        if (!project || !project.projectFiles) return;
        project.projectFiles = project.projectFiles.filter(f => f.id !== file.id);
        if (browsingEntry.value?.id === file.id) {
            navigateToRoot();
        }
        ElMessage.success(t('common.success'));
    }).catch(() => {});
}

function getFileIcon(entry: { name: string; isDirectory: boolean }) {
    if (entry.isDirectory) return 'i-mdi-folder text-amber-500';
    const ext = getFileExt(entry.name);
    switch (ext) {
        case 'ts': case 'tsx': return 'i-mdi-language-typescript text-blue-500';
        case 'js': case 'jsx': return 'i-mdi-language-javascript text-yellow-500';
        case 'vue': return 'i-mdi-vuejs text-green-500';
        case 'json': case 'geojson': return 'i-mdi-code-json text-yellow-600';
        case 'md': return 'i-mdi-language-markdown text-slate-500';
        case 'html': return 'i-mdi-language-html5 text-orange-500';
        case 'css': case 'scss': case 'less': return 'i-mdi-language-css3 text-blue-400';
        case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': return 'i-mdi-file-image text-pink-500';
        case 'pdf': return 'i-mdi-file-pdf-box text-red-500';
        case 'zip': case 'rar': case '7z': case 'tar': case 'gz': return 'i-mdi-folder-zip text-purple-500';
        default: return 'i-mdi-file-outline text-slate-400';
    }
}
</script>

<template>
    <div class="absolute inset-0 flex flex-col bg-slate-50 dark:bg-[#0f172a] overflow-hidden">
        <!-- Toolbar -->
        <div class="border-b border-slate-200 dark:border-slate-700/20 bg-white dark:bg-[#1e293b] shrink-0">
            <div class="flex items-center justify-between px-3 py-1.5 gap-3">
                <div class="flex items-center gap-2 min-w-0">
                    <button v-if="browsingEntry" @click="navigateToRoot"
                        class="file-toolbar-icon-btn">
                        <div class="i-mdi-arrow-left text-sm" />
                    </button>
                    <span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0">
                        {{ t('fileManager.title') }}
                    </span>
                    <span class="hidden xl:block text-[11px] text-slate-400 dark:text-slate-500 truncate">
                        {{ t('fileManager.interactionHint') }}
                    </span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <div class="file-view-switcher">
                        <button @click="viewMode = 'list'"
                            class="file-view-btn"
                            :class="{ 'file-view-btn-active': viewMode === 'list' }">
                            <div class="i-mdi-view-list text-sm" />
                        </button>
                        <button @click="viewMode = 'detail'"
                            class="file-view-btn"
                            :class="{ 'file-view-btn-active': viewMode === 'detail' }">
                            <div class="i-mdi-view-grid text-sm" />
                        </button>
                    </div>
                    <template v-if="!browsingEntry">
                        <button @click="chooseEntries(false)" class="file-toolbar-btn">
                            <div class="i-mdi-file-plus text-base mr-1" />
                            {{ t('fileManager.addFile') }}
                        </button>
                        <button @click="chooseEntries(true)" class="file-toolbar-btn">
                            <div class="i-mdi-folder-plus text-base mr-1" />
                            {{ t('fileManager.addFolder') }}
                        </button>
                    </template>
                </div>
            </div>
            <div class="px-3 pb-2">
                <el-input
                    v-model="searchQuery"
                    :placeholder="t('fileManager.searchPlaceholder')"
                    clearable
                >
                    <template #prefix>
                        <el-icon><div class="i-mdi-magnify" /></el-icon>
                    </template>
                </el-input>
            </div>
        </div>

        <!-- Breadcrumbs (when browsing into a directory) -->
        <div v-if="browsingEntry" class="flex items-center gap-1 px-3 py-1 border-b border-slate-200 dark:border-slate-700/20 bg-slate-50/80 dark:bg-[#0f172a] text-xs overflow-x-auto shrink-0">
            <button @click="navigateToRoot" class="text-blue-500 hover:text-blue-600 dark:hover:text-blue-300 hover:underline">
                {{ t('fileManager.root') }}
            </button>
            <template v-for="(crumb, i) in breadcrumbs" :key="i">
                <span class="text-slate-400">/</span>
                <button
                    @click="navigateToBreadcrumb(i)"
                    class="cursor-pointer hover:underline"
                    :class="i === breadcrumbs.length - 1 ? 'text-slate-600 dark:text-slate-300 font-medium' : 'text-blue-500 hover:text-blue-700 dark:hover:text-blue-300'">
                    {{ crumb.name }}
                </button>
            </template>
        </div>

        <!-- File List Content -->
        <div class="relative flex-1 min-h-0 px-3 pb-3 sm:px-4">
            <div
                ref="fileListContainerRef"
                class="h-full overflow-y-auto rounded-2xl px-2 py-1.5 sm:px-3 custom-scrollbar"
                @scroll="handleFileListScroll"
            >
            <!-- Deep search results -->
            <template v-if="hasSearchQuery">
                <div v-if="searchIndexLoading" class="flex items-center justify-center h-full text-slate-400">
                    <div class="i-mdi-loading animate-spin text-2xl" />
                </div>

                <div v-else-if="searchResults.length === 0" class="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500">
                    <div class="i-mdi-magnify text-5xl mb-3 opacity-20" />
                    <p class="text-sm">{{ t('fileManager.noResults') }}</p>
                    <p class="text-xs opacity-50 mt-1">{{ t('fileManager.noResultsHint') }}</p>
                </div>

                <template v-else-if="viewMode === 'list'">
                    <div
                        v-for="result in searchResults"
                        :key="result.id"
                        @dblclick="openSearchResult(result)"
                        @contextmenu="onContextMenu($event, { path: result.path, name: result.name, isDirectory: result.isDirectory, isRootEntry: !result.relativePath, entry: !result.relativePath ? projectFiles.find(file => file.id === result.sourceEntryId) : undefined })"
                        class="flex items-center gap-2 px-2 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group"
                    >
                        <div :class="getFileIcon(result)" class="text-sm flex-shrink-0" />
                        <div class="flex-1 min-w-0">
                            <p class="text-[13px] text-slate-700 dark:text-slate-200 truncate leading-tight">{{ result.name }}</p>
                            <p class="text-[11px] text-slate-400 dark:text-slate-500 truncate font-mono leading-tight">{{ result.path }}</p>
                        </div>
                    </div>
                </template>

                <template v-else>
                    <div class="grid grid-cols-5 gap-2 2xl:grid-cols-7 xl:grid-cols-6 lg:grid-cols-5">
                        <div
                            v-for="result in searchResults"
                            :key="result.id"
                            @dblclick="openSearchResult(result)"
                            @contextmenu="onContextMenu($event, { path: result.path, name: result.name, isDirectory: result.isDirectory, isRootEntry: !result.relativePath, entry: !result.relativePath ? projectFiles.find(file => file.id === result.sourceEntryId) : undefined })"
                            class="flex flex-col items-center gap-1 p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                        >
                            <div :class="getFileIcon(result)" class="text-2xl" />
                            <p class="text-xs text-center text-slate-600 dark:text-slate-300 truncate w-full leading-tight">{{ result.name }}</p>
                        </div>
                    </div>
                </template>
            </template>

            <!-- Root view: show project files -->
            <template v-else-if="!browsingEntry">
                <div v-if="projectFiles.length === 0" class="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500">
                    <div class="i-mdi-folder-open-outline text-5xl mb-3 opacity-20" />
                    <p class="text-sm">{{ t('fileManager.empty') }}</p>
                    <p class="text-xs opacity-50 mt-1">{{ t('fileManager.emptyHint') }}</p>
                </div>

                <div v-else-if="filteredProjectFiles.length === 0" class="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500">
                    <div class="i-mdi-magnify text-5xl mb-3 opacity-20" />
                    <p class="text-sm">{{ t('fileManager.noResults') }}</p>
                    <p class="text-xs opacity-50 mt-1">{{ t('fileManager.noResultsHint') }}</p>
                </div>

                <!-- List view -->
                <template v-else-if="viewMode === 'list'">
                    <div v-for="file in filteredProjectFiles" :key="file.id"
                        @dblclick="handleDoubleClickProjectFile(file)"
                        @contextmenu="onContextMenu($event, { path: file.path, name: file.name, isDirectory: file.isDirectory, isRootEntry: true, entry: file })"
                        class="flex items-center gap-2 px-2 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group">
                        <div :class="getFileIcon(file)" class="text-sm flex-shrink-0" />
                        <div class="flex-1 min-w-0">
                            <p class="text-[13px] text-slate-700 dark:text-slate-200 truncate leading-tight">{{ file.name }}</p>
                            <p class="text-[11px] text-slate-400 dark:text-slate-500 truncate font-mono leading-tight">{{ file.path }}</p>
                        </div>
                        <button @click.stop="removeEntry(file)"
                            class="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-red-500 transition-all rounded hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer">
                            <div class="i-mdi-close text-sm" />
                        </button>
                    </div>
                </template>

                <!-- Detail/Grid view -->
                <template v-else-if="viewMode === 'detail'">
                    <div class="grid grid-cols-5 gap-2 2xl:grid-cols-7 xl:grid-cols-6 lg:grid-cols-5">
                        <div v-for="file in filteredProjectFiles" :key="file.id"
                            @dblclick="handleDoubleClickProjectFile(file)"
                            @contextmenu="onContextMenu($event, { path: file.path, name: file.name, isDirectory: file.isDirectory, isRootEntry: true, entry: file })"
                            class="flex flex-col items-center gap-1 p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group relative">
                            <button @click.stop="removeEntry(file)"
                                class="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-red-500 transition-all rounded hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer">
                                <div class="i-mdi-close text-xs" />
                            </button>
                            <div :class="getFileIcon(file)" class="text-2xl" />
                            <p class="text-xs text-center text-slate-600 dark:text-slate-300 truncate w-full leading-tight">{{ file.name }}</p>
                        </div>
                    </div>
                </template>
            </template>

            <!-- Browsing directory view -->
            <template v-else>
                <div v-if="loadingDir" class="flex items-center justify-center h-full text-slate-400">
                    <div class="i-mdi-loading animate-spin text-2xl" />
                </div>

                <div v-else-if="dirContents.length === 0" class="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500">
                    <div class="i-mdi-folder-open-outline text-5xl mb-3 opacity-20" />
                    <p class="text-sm">{{ t('fileManager.emptyFolder') }}</p>
                </div>

                <div v-else-if="filteredDirContents.length === 0" class="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500">
                    <div class="i-mdi-magnify text-5xl mb-3 opacity-20" />
                    <p class="text-sm">{{ t('fileManager.noResults') }}</p>
                    <p class="text-xs opacity-50 mt-1">{{ t('fileManager.noResultsHint') }}</p>
                </div>

                <!-- List view for directory browsing -->
                <template v-else-if="viewMode === 'list'">
                    <div v-for="entry in filteredDirContents" :key="entry.name"
                        @dblclick="handleDoubleClick(entry)"
                        @contextmenu="onContextMenu($event, { path: joinPath(currentFullPath, entry.name), name: entry.name, isDirectory: entry.isDirectory })"
                        class="flex items-center gap-2 px-2 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors cursor-pointer">
                        <div :class="getFileIcon(entry)" class="text-sm flex-shrink-0" />
                        <p class="text-[13px] text-slate-700 dark:text-slate-200 truncate leading-tight">{{ entry.name }}</p>
                    </div>
                </template>

                <!-- Detail/Grid view for directory browsing -->
                <template v-else-if="viewMode === 'detail'">
                    <div class="grid grid-cols-5 gap-2 2xl:grid-cols-7 xl:grid-cols-6 lg:grid-cols-5">
                        <div v-for="entry in filteredDirContents" :key="entry.name"
                            @dblclick="handleDoubleClick(entry)"
                            @contextmenu="onContextMenu($event, { path: joinPath(currentFullPath, entry.name), name: entry.name, isDirectory: entry.isDirectory })"
                            class="flex flex-col items-center gap-1 p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors cursor-pointer">
                            <div :class="getFileIcon(entry)" class="text-2xl" />
                            <p class="text-xs text-center text-slate-600 dark:text-slate-300 truncate w-full leading-tight">{{ entry.name }}</p>
                        </div>
                    </div>
                </template>
            </template>
            </div>

            <button
                v-if="showBackToTop"
                :title="t('fileManager.backToTop')"
                class="absolute bottom-5 right-5 z-10 inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/88 px-3 py-2 text-xs font-medium text-slate-600 shadow-lg shadow-slate-200/40 backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:text-blue-600 dark:border-slate-700/70 dark:bg-slate-900/82 dark:text-slate-200 dark:shadow-black/20 dark:hover:border-blue-400/40 dark:hover:text-blue-300"
                @click="scrollToTop"
            >
                <div class="i-mdi-arrow-up text-sm" />
                <span>{{ t('fileManager.backToTop') }}</span>
            </button>
        </div>

        <!-- Context Menu -->
        <Teleport to="body">
            <div v-if="contextMenuVisible"
                ref="contextMenuRef"
                class="file-context-menu fixed z-999 min-w-[166px] overflow-hidden rounded-[13px] bg-white/78 p-[4px] text-sm backdrop-blur-2xl dark:bg-slate-900/74"
                :style="contextMenuStyle">
                <button @click="contextOpen"
                    class="menu-item w-full">
                    <span class="menu-item__icon">
                        <div class="i-mdi-open-in-new text-[15px]" />
                    </span>
                    <span class="menu-item__label">{{ openMenuLabel }}</span>
                </button>
                <button v-if="contextMenuTarget && !contextMenuTarget.isDirectory && canPreview(contextMenuTarget.name)" @click="contextPreview"
                    class="menu-item w-full">
                    <span class="menu-item__icon">
                        <div class="i-mdi-eye text-[15px]" />
                    </span>
                    <span class="menu-item__label">{{ previewMenuLabel }}</span>
                </button>
                <button @click="contextOpenLocation"
                    class="menu-item w-full">
                    <span class="menu-item__icon">
                        <div class="i-mdi-folder-open text-[15px]" />
                    </span>
                    <span class="menu-item__label">{{ locationMenuLabel }}</span>
                </button>
                <template v-if="contextMenuTarget?.isRootEntry">
                    <div class="menu-divider" />
                    <button @click="contextRemove"
                        class="menu-item menu-item-danger w-full">
                        <span class="menu-item__icon">
                            <div class="i-mdi-delete-outline text-[15px]" />
                        </span>
                        <span class="menu-item__label">{{ removeMenuLabel }}</span>
                    </button>
                </template>
            </div>
        </Teleport>

        <!-- File Preview Dialog -->
        <Teleport to="body">
            <div v-if="previewVisible" class="fixed inset-0 z-998 bg-black/40 backdrop-blur-sm flex items-center justify-center p-8" @click.self="previewVisible = false">
                <div class="bg-white dark:bg-[#1e293b] rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700/50 w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
                    <div class="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700/30 shrink-0">
                        <div class="flex items-center gap-2 min-w-0">
                            <div v-if="previewFile" :class="getFileIcon({ name: previewFile.name, isDirectory: false })" class="text-sm" />
                            <span class="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{{ previewFile?.name }}</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <button v-if="previewFile" @click="openFile(previewFile.path)"
                                class="px-2 py-0.5 text-[11px] rounded bg-blue-500/8 text-blue-600 dark:text-blue-400 border border-blue-500/15 hover:bg-blue-500/15 flex items-center gap-1 transition-all duration-150">
                                <div class="i-mdi-open-in-new text-xs" />
                                {{ t('fileManager.open') }}
                            </button>
                            <button @click="previewVisible = false"
                                class="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors duration-150">
                                <div class="i-mdi-close text-sm" />
                            </button>
                        </div>
                    </div>
                    <div class="flex-1 overflow-auto p-4">
                        <template v-if="previewFile?.type === 'image'">
                            <img v-if="previewFile.content" :src="previewFile.content" :alt="previewFile.name" class="max-w-full mx-auto rounded" />
                            <div v-else class="flex flex-col items-center justify-center py-16 text-slate-400">
                                <div class="i-mdi-file-image text-6xl mb-3 opacity-30" />
                                <p class="text-sm">{{ previewFile.name }}</p>
                                <button @click="openFile(previewFile.path)" class="mt-3 px-3 py-1.5 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 cursor-pointer">
                                    {{ t('fileManager.open') }}
                                </button>
                            </div>
                        </template>
                        <template v-else-if="previewFile?.type === 'text'">
                            <pre class="text-xs font-mono text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words leading-relaxed">{{ previewFile.content }}</pre>
                        </template>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<style scoped>
.file-context-menu {
  transform-origin: top left;
  box-shadow:
    0 14px 30px rgba(15, 23, 42, 0.12),
    0 4px 12px rgba(15, 23, 42, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.52);
}

.menu-item {
  appearance: none;
  -webkit-appearance: none;
  display: flex;
  align-items: center;
  gap: 0.48rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  padding: 0.34rem 0.52rem;
  color: rgba(15, 23, 42, 0.84);
  font-size: 12px;
  line-height: 1.15;
  transition:
    background-color 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.menu-item:hover {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.58));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.7),
    0 1px 2px rgba(15, 23, 42, 0.06);
  transform: translateY(-0.5px);
}

.dark .menu-item {
  color: rgba(241, 245, 249, 0.9);
}

.dark .menu-item:hover {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0.07));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 1px 2px rgba(2, 6, 23, 0.16);
}

.menu-item-danger {
  color: rgba(225, 29, 72, 0.9);
}

.menu-item-danger:hover {
  background: linear-gradient(180deg, rgba(255, 241, 242, 0.92), rgba(255, 228, 230, 0.74));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.7),
    0 1px 2px rgba(190, 24, 93, 0.08);
}

.dark .menu-item-danger:hover {
  background: linear-gradient(180deg, rgba(136, 19, 55, 0.26), rgba(113, 19, 48, 0.18));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 1px 2px rgba(15, 23, 42, 0.18);
}

.menu-item__icon {
  display: inline-flex;
  height: 0.9rem;
  width: 0.9rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: currentColor;
  opacity: 0.68;
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.menu-item:hover .menu-item__icon {
  opacity: 0.9;
  transform: scale(1.04);
}

.menu-item__label {
  min-width: 0;
  flex: 1;
  text-align: left;
  font-weight: 500;
  letter-spacing: -0.02em;
}

.menu-divider {
  margin: 0.16rem 0.28rem;
  height: 1px;
  background: linear-gradient(90deg, rgba(148, 163, 184, 0), rgba(148, 163, 184, 0.22), rgba(148, 163, 184, 0));
}

.dark .menu-divider {
  background: linear-gradient(90deg, rgba(148, 163, 184, 0), rgba(148, 163, 184, 0.16), rgba(148, 163, 184, 0));
}

.file-toolbar-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  width: 30px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(255,255,255,0.68), rgba(248,250,252,0.5));
  color: rgb(100 116 139);
  backdrop-filter: blur(14px) saturate(1.16);
  -webkit-backdrop-filter: blur(14px) saturate(1.16);
  box-shadow:
    0 8px 18px rgba(15,23,42,0.05),
    inset 0 1px 0 rgba(255,255,255,0.44),
    inset 0 0 0 1px rgba(226,232,240,0.5);
  transition: all 0.22s ease, backdrop-filter 0.22s ease, -webkit-backdrop-filter 0.22s ease;
}

.file-toolbar-icon-btn:hover {
  color: rgb(37 99 235);
  transform: translateY(-1px);
  backdrop-filter: blur(18px) saturate(1.28);
  -webkit-backdrop-filter: blur(18px) saturate(1.28);
}

.file-view-switcher {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border-radius: 12px;
  background: rgba(248,250,252,0.56);
  backdrop-filter: blur(18px) saturate(1.18);
  -webkit-backdrop-filter: blur(18px) saturate(1.18);
  box-shadow:
    0 10px 22px rgba(15,23,42,0.05),
    inset 0 1px 0 rgba(255,255,255,0.4),
    inset 0 0 0 1px rgba(226,232,240,0.48);
}

.file-view-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  width: 30px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: rgb(100 116 139);
  transition: all 0.18s ease;
}

.file-view-btn:hover {
  background: rgba(255,255,255,0.42);
  color: rgb(51 65 85);
}

.file-view-btn-active {
  background: linear-gradient(180deg, rgba(255,255,255,0.72), rgba(248,250,252,0.5));
  color: rgb(37 99 235);
  backdrop-filter: blur(16px) saturate(1.22);
  -webkit-backdrop-filter: blur(16px) saturate(1.22);
  box-shadow:
    0 10px 20px rgba(15,23,42,0.06),
    inset 0 1px 0 rgba(255,255,255,0.4),
    inset 0 0 0 1px rgba(191,219,254,0.58);
}

.file-toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(255,255,255,0.68), rgba(248,250,252,0.5));
  color: rgb(71 85 105);
  font-size: 12px;
  font-weight: 600;
  backdrop-filter: blur(14px) saturate(1.16);
  -webkit-backdrop-filter: blur(14px) saturate(1.16);
  box-shadow:
    0 8px 18px rgba(15,23,42,0.05),
    inset 0 1px 0 rgba(255,255,255,0.42),
    inset 0 0 0 1px rgba(226,232,240,0.5);
  transition: all 0.22s ease, backdrop-filter 0.22s ease, -webkit-backdrop-filter 0.22s ease;
}

.file-toolbar-btn:hover {
  color: rgb(37 99 235);
  transform: translateY(-1px);
  backdrop-filter: blur(18px) saturate(1.28);
  -webkit-backdrop-filter: blur(18px) saturate(1.28);
  box-shadow:
    0 12px 24px rgba(15,23,42,0.08),
    inset 0 1px 0 rgba(255,255,255,0.48),
    inset 0 0 0 1px rgba(191,219,254,0.64);
}

.dark .file-toolbar-icon-btn {
  background:
    linear-gradient(180deg, rgba(45,212,191,0.02), rgba(45,212,191,0)),
    linear-gradient(180deg, rgba(15,23,42,0.82), rgba(2,6,23,0.72));
  color: rgb(148 163 184);
  backdrop-filter: blur(20px) saturate(1.18);
  -webkit-backdrop-filter: blur(20px) saturate(1.18);
  box-shadow:
    0 16px 28px rgba(2,6,23,0.3),
    inset 0 1px 0 rgba(255,255,255,0.05),
    inset 0 0 0 1px rgba(148,163,184,0.12);
}

.dark .file-view-switcher {
  background:
    linear-gradient(180deg, rgba(59,130,246,0.04), rgba(59,130,246,0.01)),
    rgba(2,6,23,0.62);
  backdrop-filter: blur(24px) saturate(1.16);
  -webkit-backdrop-filter: blur(24px) saturate(1.16);
  box-shadow:
    0 18px 34px rgba(2,6,23,0.32),
    inset 0 1px 0 rgba(255,255,255,0.05),
    inset 0 0 0 1px rgba(148,163,184,0.12);
}

.dark .file-view-btn {
  color: rgb(148 163 184);
}

.dark .file-view-btn:hover {
  background: rgba(30,41,59,0.54);
  color: rgb(226 232 240);
}

.dark .file-view-btn-active {
  background:
    linear-gradient(180deg, rgba(96,165,250,0.18), rgba(59,130,246,0.08)),
    linear-gradient(180deg, rgba(30,41,59,0.78), rgba(15,23,42,0.64));
  color: rgb(191 219 254);
  backdrop-filter: blur(22px) saturate(1.2);
  -webkit-backdrop-filter: blur(22px) saturate(1.2);
  box-shadow:
    0 16px 28px rgba(2,6,23,0.34),
    inset 0 1px 0 rgba(255,255,255,0.09),
    inset 0 0 0 1px rgba(96,165,250,0.22);
}

.dark .file-toolbar-btn {
  background:
    linear-gradient(180deg, rgba(96,165,250,0.03), rgba(96,165,250,0)),
    linear-gradient(180deg, rgba(15,23,42,0.84), rgba(2,6,23,0.74));
  color: rgb(203 213 225);
  backdrop-filter: blur(20px) saturate(1.18);
  -webkit-backdrop-filter: blur(20px) saturate(1.18);
  box-shadow:
    0 16px 30px rgba(2,6,23,0.32),
    inset 0 1px 0 rgba(255,255,255,0.06),
    inset 0 0 0 1px rgba(148,163,184,0.13);
}

.dark .file-toolbar-btn:hover {
  color: rgb(96 165 250);
  backdrop-filter: blur(24px) saturate(1.26);
  -webkit-backdrop-filter: blur(24px) saturate(1.26);
  box-shadow:
    0 18px 34px rgba(2,6,23,0.36),
    inset 0 1px 0 rgba(255,255,255,0.08),
    inset 0 0 0 1px rgba(96,165,250,0.24);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 2px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: #334155;
}
</style>
