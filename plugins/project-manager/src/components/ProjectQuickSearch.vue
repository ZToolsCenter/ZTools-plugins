<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useProjectStore } from '../stores/project';
import { useUsageStore } from '../stores/usage';
import { pinyin } from 'pinyin-pro';

const props = withDefaults(defineProps<{
  standalone?: boolean;
}>(), {
  standalone: false,
});

const { t } = useI18n();
const projectStore = useProjectStore();
const usageStore = useUsageStore();

/***********************搜索结果类型定义*********************/
type SearchResultType = 'project' | 'script';

interface SearchResult {
  type: SearchResultType;
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  iconColor: string;
  /** 关联的项目 ID（用于项目/脚本跳转） */
  projectId?: string;
}

const emit = defineEmits<{
  close: [];
  draggingChange: [dragging: boolean];
  /** 选中项目 */
  select: [projectId: string];
  /** 选中脚本 */
  selectScript: [projectId: string, scriptName: string];
}>();

const searchQuery = ref('');
const selectedIndex = ref(0);
const searchInputRef = useTemplateRef<HTMLInputElement>('searchInputRef');

/***********************拼音搜索工具*********************/
function buildPinyinSearchText(text: string): string {
    if (!text) return '';
    const syllables = pinyin(text, { toneType: 'none', type: 'array' }) as string[];
    const full = syllables.join('');
    const initials = syllables.map(s => s[0] || '').join('');
    return `${full} ${initials}`.toLowerCase();
}

const pinyinCache = new Map<string, string>();

function getCachedPinyin(text: string) {
    if (!text) return '';
    const cached = pinyinCache.get(text);
    if (cached) return cached;
    const next = buildPinyinSearchText(text);
    pinyinCache.set(text, next);
    return next;
}

/***********************构建搜索条目*********************/
/**
 * 计算项目与查询的匹配优先级：数字越小越靠前。
 * 名称匹配 > 路径匹配 > 其他（描述/标签/拼音）匹配；不匹配返回 null。
 */
function scoreProjectMatch(project: { name: string; path: string; description?: string; tags?: string[] }, query: string, compactQuery: string): number | null {
    const name = project.name.toLowerCase();
    const path = project.path.toLowerCase();
    if (name.includes(query)) return 0;
    if (path.includes(query)) return 1;
    const desc = (project.description || '').toLowerCase();
    const tags = (project.tags || []).join(' ').toLowerCase();
    const namePinyin = getCachedPinyin(project.name);
    if (desc.includes(query) || tags.includes(query) || namePinyin.includes(compactQuery)) return 2;
    return null;
}

function buildProjectResults(query: string, compactQuery: string): SearchResult[] {
    return projectStore.projects
        .map(project => ({ project, score: scoreProjectMatch(project, query, compactQuery) }))
        .filter((entry): entry is { project: typeof entry.project; score: number } => entry.score !== null)
        .sort((a, b) => a.score - b.score)
        .map(({ project }) => ({
            type: 'project' as SearchResultType,
            id: `project-${project.id}`,
            name: project.name,
            subtitle: project.path,
            icon: project.type === 'node' ? 'i-mdi-nodejs' : 'i-mdi-folder-outline',
            iconColor: project.type === 'node' ? 'text-emerald-500' : 'text-slate-400',
            projectId: project.id,
        }));
}

function buildScriptResults(query: string, compactQuery: string): SearchResult[] {
    const results: SearchResult[] = [];
    for (const project of projectStore.projects) {
        const scripts = project.scripts || [];
        const commands = project.customCommands || [];
        for (const script of scripts) {
            const s = script.toLowerCase();
            const sPinyin = getCachedPinyin(script);
            if (s.includes(query) || sPinyin.includes(compactQuery)) {
                results.push({
                    type: 'script',
                    id: `script-${project.id}-${script}`,
                    name: script,
                    subtitle: `${project.name} · npm run ${script}`,
                    icon: 'i-mdi-play-circle-outline',
                    iconColor: 'text-amber-500',
                    projectId: project.id,
                });
            }
        }
        for (const cmd of commands) {
            const cn = cmd.name.toLowerCase();
            const cc = cmd.command.toLowerCase();
            const cnPinyin = getCachedPinyin(cmd.name);
            if (cn.includes(query) || cc.includes(query) || cnPinyin.includes(compactQuery)) {
                results.push({
                    type: 'script',
                    id: `cmd-${project.id}-${cmd.id}`,
                    name: cmd.name,
                    subtitle: `${project.name} · ${cmd.command}`,
                    icon: 'i-mdi-console',
                    iconColor: 'text-amber-500',
                    projectId: project.id,
                });
            }
        }
    }
    return results;
}

/***********************搜索结果计算*********************/
const searchResults = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    const compactQuery = query.replace(/\s+/g, '');

    if (!query) return [];

    const projects = buildProjectResults(query, compactQuery);
    const scripts = buildScriptResults(query, compactQuery);

    return [...projects, ...scripts];
});

/***********************默认结果（无搜索时）*********************/
const defaultResults = computed(() => {
    const pinned = projectStore.projects.filter(p => p.pinned);
    const weights = usageStore.calculateAllWeights();
    const recent = projectStore.projects
        .filter(p => !p.pinned && (weights[p.id] ?? 0) > 0)
        .sort((a, b) => (weights[b.id] ?? 0) - (weights[a.id] ?? 0))
        .slice(0, 10);

    const items: SearchResult[] = [];
    for (const p of pinned) {
        items.push({
            type: 'project',
            id: `project-${p.id}`,
            name: p.name,
            subtitle: p.path,
            icon: p.type === 'node' ? 'i-mdi-nodejs' : 'i-mdi-folder-outline',
            iconColor: p.type === 'node' ? 'text-emerald-500' : 'text-slate-400',
            projectId: p.id,
        });
    }
    for (const p of recent) {
        items.push({
            type: 'project',
            id: `project-${p.id}`,
            name: p.name,
            subtitle: p.path,
            icon: p.type === 'node' ? 'i-mdi-nodejs' : 'i-mdi-folder-outline',
            iconColor: p.type === 'node' ? 'text-emerald-500' : 'text-slate-400',
            projectId: p.id,
        });
    }
    return { pinned, recent, items };
});

const showPinnedHeader = computed(() => !searchQuery.value.trim() && defaultResults.value.pinned.length > 0);
const showRecentHeader = computed(() => !searchQuery.value.trim() && defaultResults.value.recent.length > 0);
const showNoResults = computed(() => searchQuery.value.trim() && searchResults.value.length === 0);

const displayList = computed(() => {
    if (searchQuery.value.trim()) return searchResults.value;
    return defaultResults.value.items;
});

const fullFlatList = computed(() => displayList.value);

/***********************键盘导航*********************/
function handleKeydown(event: KeyboardEvent) {
    const list = fullFlatList.value;
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedIndex.value = list.length > 0
            ? Math.min(selectedIndex.value + 1, list.length - 1)
            : 0;
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        const selected = list[selectedIndex.value];
        if (selected) selectItem(selected);
    } else if (event.key === 'Escape') {
        event.preventDefault();
        emit('close');
    }
}

function selectItem(item: SearchResult) {
    switch (item.type) {
        case 'project':
            if (item.projectId) emit('select', item.projectId);
            break;
        case 'script':
            if (item.projectId) {
                emit('selectScript', item.projectId, item.name);
            }
            break;
    }
}

function handleOverlayClick(event: MouseEvent) {
    if (props.standalone) return;
    if ((event.target as HTMLElement).classList.contains('quick-search-overlay')) {
        emit('close');
    }
}

async function startWindowDrag(event: MouseEvent) {
    if (!props.standalone || event.button !== 0) return;
    event.preventDefault();
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const currentWindow = getCurrentWindow();
    emit('draggingChange', true);
    try {
        await currentWindow.startDragging();
    } finally {
        emit('draggingChange', false);
        await currentWindow.setFocus().catch(() => undefined);
    }
}

watch(searchQuery, () => {
    selectedIndex.value = 0;
});

watch(fullFlatList, (list) => {
    if (selectedIndex.value >= list.length) {
        selectedIndex.value = 0;
    }
});

onMounted(() => {
    nextTick(() => {
        searchInputRef.value?.focus();
    });
});

function getTypeLabel(type: SearchResultType): string {
    switch (type) {
        case 'project': return '';
        case 'script': return '脚本';
        default: return '';
    }
}
</script>

<template>
    <div
        class="quick-search-overlay"
        :class="{ 'quick-search-overlay-standalone': standalone }"
        @click="handleOverlayClick"
    >
        <div class="quick-search-container" :class="{ 'quick-search-container-standalone': standalone }">
            <div class="quick-search-header">
                <button
                    v-if="standalone"
                    type="button"
                    class="quick-search-drag-handle"
                    :aria-label="t('dashboard.quickSearchDrag')"
                    :title="t('dashboard.quickSearchDrag')"
                    @mousedown="startWindowDrag"
                >
                    <span class="i-mdi-drag-horizontal text-lg" aria-hidden="true" />
                </button>
                <div class="i-mdi-magnify text-lg text-slate-400 dark:text-slate-500 flex-shrink-0" />
                <input
                    ref="searchInputRef"
                    v-model="searchQuery"
                    :placeholder="t('dashboard.quickSearchPlaceholder')"
                    class="quick-search-input"
                    :aria-label="t('dashboard.quickSearchPlaceholder')"
                    @keydown="handleKeydown"
                />
                <div class="quick-search-shortcut">
                    <kbd>ESC</kbd>
                </div>
            </div>

            <div class="quick-search-results custom-scrollbar">
                <!-- 搜索态：统一列表 -->
                <template v-if="searchQuery.trim()">
                    <div
                        v-for="(item, index) in searchResults"
                        :key="item.id"
                        class="quick-search-item"
                        :class="{ 'quick-search-item-active': index === selectedIndex }"
                        @click="selectItem(item)"
                        @mouseenter="selectedIndex = index"
                    >
                        <div class="quick-search-item-icon">
                            <div :class="[item.icon, item.iconColor]" class="text-base" />
                        </div>
                        <div class="quick-search-item-content">
                            <div class="flex items-center gap-1.5">
                                <div class="quick-search-item-name">{{ item.name }}</div>
                                <span v-if="item.type !== 'project'" class="quick-search-tag">
                                    {{ getTypeLabel(item.type) }}
                                </span>
                            </div>
                            <div class="quick-search-item-path">{{ item.subtitle }}</div>
                        </div>
                    </div>
                    <div v-if="showNoResults" class="quick-search-empty">
                        <div class="i-mdi-magnify-close text-3xl mb-2 opacity-20" />
                        <p class="text-sm">{{ t('dashboard.noSearchResults') }}</p>
                    </div>
                </template>

                <!-- 默认态：置顶 + 最近使用 -->
                <template v-else>
                    <template v-if="showPinnedHeader">
                        <div class="quick-search-section-title">
                            <div class="i-mdi-pin text-xs text-amber-500" />
                            {{ t('dashboard.pinnedProjects') }}
                        </div>
                        <template v-for="(item, localIdx) in defaultResults.items.filter(i => {
                            const p = defaultResults.pinned.find(pp => pp.id === i.projectId);
                            return !!p;
                        })" :key="item.id">
                            <div
                                class="quick-search-item"
                                :class="{ 'quick-search-item-active': localIdx === selectedIndex }"
                                @click="selectItem(item)"
                                @mouseenter="selectedIndex = localIdx"
                            >
                                <div class="quick-search-item-icon">
                                    <div :class="[item.icon, item.iconColor]" class="text-base" />
                                </div>
                                <div class="quick-search-item-content">
                                    <div class="quick-search-item-name">{{ item.name }}</div>
                                    <div class="quick-search-item-path">{{ item.subtitle }}</div>
                                </div>
                            </div>
                        </template>
                    </template>

                    <template v-if="showRecentHeader">
                        <div class="quick-search-divider" />
                        <div class="quick-search-section-title">
                            <div class="i-mdi-clock-outline text-xs text-slate-400" />
                            {{ t('dashboard.recentProjects') }}
                        </div>
                        <template v-for="(item, localIdx) in defaultResults.items.filter(i => {
                            const p = defaultResults.recent.find(pp => pp.id === i.projectId);
                            return !!p;
                        })" :key="item.id">
                            <div
                                class="quick-search-item"
                                :class="{ 'quick-search-item-active': (defaultResults.pinned.length + localIdx) === selectedIndex }"
                                @click="selectItem(item)"
                                @mouseenter="selectedIndex = defaultResults.pinned.length + localIdx"
                            >
                                <div class="quick-search-item-icon">
                                    <div :class="[item.icon, item.iconColor]" class="text-base" />
                                </div>
                                <div class="quick-search-item-content">
                                    <div class="quick-search-item-name">{{ item.name }}</div>
                                    <div class="quick-search-item-path">{{ item.subtitle }}</div>
                                </div>
                            </div>
                        </template>
                    </template>

                    <div v-if="defaultResults.items.length === 0" class="quick-search-empty">
                        <div class="i-mdi-folder-open-outline text-3xl mb-2 opacity-20" />
                        <p class="text-sm">{{ t('dashboard.noProjects') }}</p>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<style scoped>
.quick-search-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
  background: color-mix(in srgb, var(--app-bg) 62%, transparent);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.quick-search-container {
  width: min(640px, calc(100vw - 48px));
  max-height: 440px;
  display: flex;
  flex-direction: column;
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  box-shadow: var(--app-shadow-lg);
  border: 1px solid var(--app-border);
  overflow: hidden;
}

.quick-search-overlay-standalone {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 0;
  align-items: stretch;
  background: var(--app-surface);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.quick-search-container-standalone {
  width: 100%;
  height: 100%;
  max-height: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.quick-search-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--app-border);
}

.quick-search-drag-handle {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: -6px 0 -6px -8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--app-text-muted);
  cursor: grab;
  transition:
    color var(--app-duration-fast) var(--app-ease),
    background-color var(--app-duration-fast) var(--app-ease);
}

.quick-search-drag-handle:hover {
  color: var(--app-text-secondary);
  background: var(--app-surface-soft);
}

.quick-search-drag-handle:active {
  cursor: grabbing;
}

.quick-search-drag-handle:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}

.quick-search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--app-font-body);
  font-weight: 500;
  color: var(--app-text);
  font-family: inherit;
}

.quick-search-input::placeholder {
  color: var(--app-text-muted);
  font-weight: 400;
}

.quick-search-shortcut {
  display: flex;
  align-items: center;
  gap: 4px;
}

.quick-search-shortcut kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  min-width: 20px;
  padding: 0 5px;
  border-radius: 5px;
  background: var(--app-surface-soft);
  border: 1px solid var(--app-border);
  color: var(--app-text-secondary);
  font-size: var(--app-font-meta);
  font-family: inherit;
  font-weight: 600;
}

.quick-search-results {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.quick-search-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: var(--app-font-meta);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--app-text-muted);
}

.quick-search-divider {
  height: 1px;
  margin: 4px 10px;
  background: var(--app-border);
}

.quick-search-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color var(--app-duration-fast) var(--app-ease);
}

.quick-search-item:hover {
  background: var(--app-surface-soft);
}

.quick-search-item-active {
  background: var(--app-primary-soft);
}

.quick-search-item-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--app-surface-soft);
}

.quick-search-item-content {
  flex: 1;
  min-width: 0;
}

.quick-search-item-name {
  font-size: var(--app-font-control);
  font-weight: 600;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick-search-item-path {
  font-size: var(--app-font-meta);
  color: var(--app-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono, monospace);
}

.quick-search-item-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.quick-search-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: var(--app-font-caption);
  font-weight: 600;
  background: var(--app-primary-soft);
  color: var(--app-primary);
}

.quick-search-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  color: var(--app-text-muted);
}
</style>
