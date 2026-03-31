<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Project, ProjectFileEntry } from '../types';
import { useProjectStore } from '../stores/project';
import { api } from '../api';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';

const { t } = useI18n();
const props = defineProps<{ project: Project }>();
const projectStore = useProjectStore();

// View mode: 'list' or 'detail'
const viewMode = ref<'list' | 'detail'>('list');

// Current browsing path (for navigating into directories)
const currentPath = ref<string[]>([]);

// Loading state for directory contents
const dirContents = ref<{ name: string; isDirectory: boolean }[]>([]);
const loadingDir = ref(false);

// The project files saved in project data
const projectFiles = computed(() => props.project.projectFiles || []);

// Currently browsing inside a project file directory
const browsingEntry = ref<ProjectFileEntry | null>(null);

// Context menu state
const contextMenuVisible = ref(false);
const contextMenuStyle = ref({ left: '0px', top: '0px' });
const contextMenuTarget = ref<{ path: string; name: string; isDirectory: boolean; isRootEntry?: boolean; entry?: ProjectFileEntry } | null>(null);

// File preview
const previewVisible = ref(false);
const previewFile = ref<{ name: string; path: string; content: string; type: 'image' | 'text' | 'unsupported' } | null>(null);

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
        openFile(filePath);
    }
}

function handleDoubleClickProjectFile(file: ProjectFileEntry) {
    if (file.isDirectory) {
        browsingEntry.value = file;
        currentPath.value = [];
    } else {
        openFile(file.path);
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
const textExts = ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'vue', 'html', 'css', 'scss', 'less', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env', 'sh', 'bat', 'ps1', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'log', 'csv', 'gitignore', 'editorconfig', 'prettierrc'];

function getFileExt(name: string): string {
    const dotIdx = name.lastIndexOf('.');
    if (dotIdx < 0) return '';
    return name.substring(dotIdx + 1).toLowerCase();
}

function canPreview(name: string): boolean {
    const ext = getFileExt(name);
    return imageExts.includes(ext) || textExts.includes(ext);
}

async function previewFileContent(filePath: string, fileName: string) {
    const ext = getFileExt(fileName);
    if (imageExts.includes(ext)) {
        // Image preview: show info with option to open
        previewFile.value = { name: fileName, path: filePath, content: '', type: 'image' };
        previewVisible.value = true;
        // Try to read binary for inline preview
        try {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const bytes = await readFile(normalizePath(filePath));
            const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon' };
            const mime = mimeMap[ext] || 'image/png';
            const base64 = btoa(Array.from(bytes as Uint8Array, (b: number) => String.fromCharCode(b)).join(''));
            previewFile.value = { name: fileName, path: filePath, content: `data:${mime};base64,${base64}`, type: 'image' };
        } catch {
            // Fallback: can't load image inline, show placeholder
            previewFile.value = { name: fileName, path: filePath, content: '', type: 'image' };
        }
    } else if (textExts.includes(ext)) {
        try {
            const content = await api.readTextFile(normalizePath(filePath));
            const truncated = content.length > 50000 ? content.substring(0, 50000) + '\n\n... (truncated)' : content;
            previewFile.value = { name: fileName, path: filePath, content: truncated, type: 'text' };
            previewVisible.value = true;
        } catch (e) {
            ElMessage.warning(t('fileManager.previewFailed'));
        }
    }
}

async function addFileOrFolder() {
    try {
        const selected = await api.openDialog({
            directory: false,
            multiple: true,
        });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        addEntries(paths, false);
    } catch (e) {
        console.error(e);
    }
}

async function addFolder() {
    try {
        const selected = await api.openDialog({
            directory: true,
            multiple: true,
        });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        addEntries(paths, true);
    } catch (e) {
        console.error(e);
    }
}

function addEntries(paths: string[], isDirectory: boolean) {
    const project = projectStore.projects.find(p => p.id === props.project.id);
    if (!project) return;
    if (!project.projectFiles) project.projectFiles = [];

    let added = 0;
    for (const path of paths) {
        if (project.projectFiles.some(f => f.path === path)) continue;
        const name = path.split(/[/\\]/).pop() || path;
        project.projectFiles.push({
            id: crypto.randomUUID(),
            name,
            path,
            isDirectory,
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
        case 'json': return 'i-mdi-code-json text-yellow-600';
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
        <div class="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 dark:border-slate-700/20 bg-white dark:bg-[#1e293b] shrink-0">
            <div class="flex items-center gap-2">
                <button v-if="browsingEntry" @click="navigateToRoot"
                    class="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors duration-150">
                    <div class="i-mdi-arrow-left text-sm" />
                </button>
                <span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {{ t('fileManager.title') }}
                </span>
            </div>
            <div class="flex items-center gap-1.5">
                <div class="flex border border-slate-200 dark:border-slate-700/30 rounded-md overflow-hidden">
                    <button @click="viewMode = 'list'"
                        class="p-0.5 transition-colors duration-150"
                        :class="viewMode === 'list' ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'">
                        <div class="i-mdi-view-list text-sm" />
                    </button>
                    <button @click="viewMode = 'detail'"
                        class="p-0.5 transition-colors duration-150"
                        :class="viewMode === 'detail' ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'">
                        <div class="i-mdi-view-grid text-sm" />
                    </button>
                </div>
                <template v-if="!browsingEntry">
                    <button @click="addFolder"
                        class="px-1.5 py-0.5 text-[11px] rounded bg-amber-500/8 text-amber-600 dark:text-amber-400 border border-amber-500/15 hover:bg-amber-500/15 transition-all duration-150 flex items-center gap-1">
                        <div class="i-mdi-folder-plus text-sm" />
                        {{ t('fileManager.addFolder') }}
                    </button>
                    <button @click="addFileOrFolder"
                        class="px-1.5 py-0.5 text-[11px] rounded bg-blue-500/8 text-blue-600 dark:text-blue-400 border border-blue-500/15 hover:bg-blue-500/15 transition-all duration-150 flex items-center gap-1">
                        <div class="i-mdi-file-plus text-sm" />
                        {{ t('fileManager.addFile') }}
                    </button>
                </template>
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
        <div class="flex-1 overflow-y-auto px-2 py-1.5 custom-scrollbar">
            <!-- Root view: show project files -->
            <template v-if="!browsingEntry">
                <div v-if="projectFiles.length === 0" class="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500">
                    <div class="i-mdi-folder-open-outline text-5xl mb-3 opacity-20" />
                    <p class="text-sm">{{ t('fileManager.empty') }}</p>
                    <p class="text-xs opacity-50 mt-1">{{ t('fileManager.emptyHint') }}</p>
                </div>

                <!-- List view -->
                <template v-if="viewMode === 'list'">
                    <div v-for="file in projectFiles" :key="file.id"
                        @dblclick="handleDoubleClickProjectFile(file)"
                        @contextmenu="onContextMenu($event, { path: file.path, name: file.name, isDirectory: file.isDirectory, isRootEntry: true, entry: file })"
                        class="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group">
                        <div :class="getFileIcon(file)" class="text-base flex-shrink-0" />
                        <div class="flex-1 min-w-0">
                            <p class="text-sm text-slate-700 dark:text-slate-200 truncate leading-tight">{{ file.name }}</p>
                            <p class="text-xs text-slate-400 dark:text-slate-500 truncate font-mono leading-tight">{{ file.path }}</p>
                        </div>
                        <button @click.stop="removeEntry(file)"
                            class="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-red-500 transition-all rounded hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer">
                            <div class="i-mdi-close text-sm" />
                        </button>
                    </div>
                </template>

                <!-- Detail/Grid view -->
                <template v-if="viewMode === 'detail'">
                    <div class="grid grid-cols-5 gap-2 2xl:grid-cols-7 xl:grid-cols-6 lg:grid-cols-5">
                        <div v-for="file in projectFiles" :key="file.id"
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

                <!-- List view for directory browsing -->
                <template v-if="viewMode === 'list'">
                    <div v-for="entry in dirContents" :key="entry.name"
                        @dblclick="handleDoubleClick(entry)"
                        @contextmenu="onContextMenu($event, { path: joinPath(currentFullPath, entry.name), name: entry.name, isDirectory: entry.isDirectory })"
                        class="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors cursor-pointer">
                        <div :class="getFileIcon(entry)" class="text-base flex-shrink-0" />
                        <p class="text-sm text-slate-700 dark:text-slate-200 truncate leading-tight">{{ entry.name }}</p>
                    </div>
                </template>

                <!-- Detail/Grid view for directory browsing -->
                <template v-if="viewMode === 'detail'">
                    <div class="grid grid-cols-5 gap-2 2xl:grid-cols-7 xl:grid-cols-6 lg:grid-cols-5">
                        <div v-for="entry in dirContents" :key="entry.name"
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

        <!-- Context Menu -->
        <Teleport to="body">
            <div v-if="contextMenuVisible"
                class="fixed z-999 bg-white dark:bg-[#1e293b] rounded-lg shadow-lg border border-slate-200 dark:border-slate-700/50 py-1 min-w-36 text-xs backdrop-blur-sm"
                :style="contextMenuStyle">
                <button @click="contextOpen"
                    class="w-full px-3 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 transition-colors duration-100">
                    <div class="i-mdi-open-in-new text-sm text-blue-500" />
                    {{ t('fileManager.open') }}
                </button>
                <button v-if="contextMenuTarget && !contextMenuTarget.isDirectory && canPreview(contextMenuTarget.name)" @click="contextPreview"
                    class="w-full px-3 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 transition-colors duration-100">
                    <div class="i-mdi-eye text-sm text-slate-400" />
                    {{ t('fileManager.preview') }}
                </button>
                <button @click="contextOpenLocation"
                    class="w-full px-3 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 transition-colors duration-100">
                    <div class="i-mdi-folder-open text-sm text-amber-500" />
                    {{ t('fileManager.openLocation') }}
                </button>
                <template v-if="contextMenuTarget?.isRootEntry">
                    <div class="border-t border-slate-200 dark:border-slate-700/30 my-1" />
                    <button @click="contextRemove"
                        class="w-full px-3 py-1.5 text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 transition-colors duration-100">
                        <div class="i-mdi-delete-outline text-sm" />
                        {{ t('fileManager.remove') }}
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
