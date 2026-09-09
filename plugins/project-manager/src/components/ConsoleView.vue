<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useProjectStore } from '../stores/project';
import { useRunHistoryStore } from '../stores/runHistory';
import type { CustomCommand, Project, RunHistoryEntry, RunLogEntry, RunSession } from '../types';
import { useI18n } from 'vue-i18n';
import { AnsiUp } from 'ansi_up';
import { api } from '../api';
import {
    getCustomCommandDisplayName,
    getProjectCommandKey,
    getProjectCommandRunId,
    getRunnableProjectScripts,
    parseProjectCommandKey,
} from '../utils/projectCommands';
import {
    CONSOLE_RENDER_WINDOW_SIZE,
    buildSessionLogExportText,
    filterLogEntries,
    formatLogEntriesPlainText,
    getRenderWindow,
    nextMatchIndex,
    searchLogEntries,
    type LogStreamFilter,
} from '../utils/consoleLogs';
import { buildRunLogFileName, isHistoryCommandAvailable } from '../utils/runHistory';
import { formatDuration, isRunSessionActive } from '../utils/runSession';

const { t } = useI18n();
const projectStore = useProjectStore();
const runHistoryStore = useRunHistoryStore();
const ansiUp = new AnsiUp();

/** 一个 KeepAlive 实例只服务一个项目，外层 :key 负责隔离项目上下文。 */
const props = defineProps<{ project: Project }>();

function parseAnsi(text: string): string {
    const urlPlaceholders: { [key: string]: string } = {};
    let placeholderIndex = 0;
    const urlRegex = /(https?:\/\/(?:[^\s\x1b]|(?:\x1b\[[0-9;]*[mK]))+)/g;

    const processedText = text.replace(urlRegex, (match) => {
        let finalUrl = match;
        const trailingRegex = /([.,;!?'"\])])((?:\x1b\[[0-9;]*[mK])*)$/;
        let strippedSuffix = '';
        while (true) {
            const found = finalUrl.match(trailingRegex);
            if (!found) break;
            strippedSuffix = found[1] + strippedSuffix;
            finalUrl = finalUrl.slice(0, -found[0].length) + found[2];
        }
        const placeholder = `__URL_PLACEHOLDER_${placeholderIndex++}__`;
        urlPlaceholders[placeholder] = finalUrl;
        return placeholder + strippedSuffix;
    });

    const html = ansiUp.ansi_to_html(processedText);
    return html.replace(/__URL_PLACEHOLDER_(\d+)__/g, (match) => {
        const urlWithAnsi = urlPlaceholders[match];
        if (!urlWithAnsi) return match;
        const cleanUrl = urlWithAnsi.replace(/\x1b\[[0-9;]*[mK]/g, '');
        const displayHtml = ansiUp.ansi_to_html(urlWithAnsi);
        return `<span class="log-link text-blue-400 hover:underline cursor-pointer" data-url="${cleanUrl.replace(/"/g, '&quot;')}" title="Ctrl + Click to open">${displayHtml}</span>`;
    });
}

function handleLogClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const linkElement = target.closest('.log-link') as HTMLElement | null;
    if (!linkElement) return;
    const url = linkElement.dataset.url;
    if (url && (event.ctrlKey || event.metaKey)) void api.openUrl(url);
}

const activeProject = computed(() => props.project);
const activeScript = ref<string | null>(null);
const stdinInput = ref('');
const sendingInput = ref(false);
const logContainer = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const parsedLogCache = new Map<string, string>();
const MAX_PARSED_LOG_CACHE_SIZE = 2000;
const LOG_BOTTOM_THRESHOLD = 48;
const shouldFollowLogs = ref(true);
let scrollToBottomToken = 0;

function getCachedParsedAnsi(text: string): string {
    const cached = parsedLogCache.get(text);
    if (cached) return cached;
    const parsed = parseAnsi(text);
    parsedLogCache.set(text, parsed);
    if (parsedLogCache.size > MAX_PARSED_LOG_CACHE_SIZE) {
        const oldestKey = parsedLogCache.keys().next().value;
        if (oldestKey) parsedLogCache.delete(oldestKey);
    }
    return parsed;
}

const openTabs = ref<Set<string>>(new Set());
const closedTabs = ref<Set<string>>(new Set());
const knownLatestSessionIds = new Map<string, string>();
const currentTime = ref(Date.now());
let durationTimer: number | null = null;
const projectCommandPrefix = computed(() => `${activeProject.value.id}:`);

function getSessionForTab(tabId: string): RunSession | undefined {
    const command = parseProjectCommandKey(tabId);
    if (!command) return undefined;
    const commandKey = getProjectCommandRunId(activeProject.value.id, command.type, command.id);
    const sessionId = projectStore.latestSessionIdByCommand[commandKey];
    const session = sessionId ? projectStore.runSessions[sessionId] : undefined;
    return session?.projectId === activeProject.value.id && session.commandKey === commandKey ? session : undefined;
}

const projectLatestSessions = computed(() => Object.entries(projectStore.latestSessionIdByCommand)
    .filter(([commandKey]) => commandKey.startsWith(projectCommandPrefix.value))
    .map(([commandKey, sessionId]) => ({
        commandKey,
        sessionId,
        tabId: commandKey.slice(projectCommandPrefix.value.length),
        session: projectStore.runSessions[sessionId],
    }))
    .filter((entry): entry is { commandKey: string; sessionId: string; tabId: string; session: RunSession } =>
        !!entry.session && entry.session.projectId === activeProject.value.id && entry.session.commandKey === entry.commandKey
    ));

const activeRunningTabs = computed(() => projectLatestSessions.value
    .filter(({ session }) => isRunSessionActive(session.status))
    .map(({ tabId }) => tabId));

watch(projectLatestSessions, (entries) => {
    for (const entry of entries) {
        if (knownLatestSessionIds.get(entry.commandKey) !== entry.sessionId) {
            knownLatestSessionIds.set(entry.commandKey, entry.sessionId);
            closedTabs.value.delete(entry.tabId);
            openTabs.value.add(entry.tabId);
        }
    }
    const runningTabs = activeRunningTabs.value;
    if (!activeScript.value && runningTabs.length > 0) {
        activeScript.value = runningTabs[runningTabs.length - 1];
    } else if (activeScript.value && !runningTabs.includes(activeScript.value) && runningTabs.length > 0) {
        const current = getSessionForTab(activeScript.value);
        if (!current || isRunSessionActive(current.status)) return;
        activeScript.value = runningTabs[runningTabs.length - 1];
    }
}, { immediate: true, deep: true });

function initOpenTabsFromProject(): void {
    const project = activeProject.value;
    openTabs.value.clear();
    closedTabs.value.clear();
    knownLatestSessionIds.clear();
    activeScript.value = null;

    for (const script of project.scripts || []) {
        const commandKey = getProjectCommandRunId(project.id, 'script', script);
        const sessionId = projectStore.latestSessionIdByCommand[commandKey];
        if (sessionId && projectStore.runSessions[sessionId]?.projectId === project.id) {
            knownLatestSessionIds.set(commandKey, sessionId);
            openTabs.value.add(getProjectCommandKey('script', script));
        }
    }
    for (const command of project.customCommands || []) {
        const commandKey = getProjectCommandRunId(project.id, 'custom', command.id);
        const sessionId = projectStore.latestSessionIdByCommand[commandKey];
        if (sessionId && projectStore.runSessions[sessionId]?.projectId === project.id) {
            knownLatestSessionIds.set(commandKey, sessionId);
            openTabs.value.add(getProjectCommandKey('custom', command.id));
        }
    }
    if (openTabs.value.size > 0) {
        const running = Array.from(openTabs.value).find(commandKey => isCommandKeyRunning(commandKey));
        activeScript.value = running || Array.from(openTabs.value)[0];
    }
}

initOpenTabsFromProject();

const availableTabs = computed(() => Array.from(openTabs.value));
const runnableScripts = computed(() => getRunnableProjectScripts(activeProject.value));
const runnableCustomCommands = computed(() => activeProject.value.customCommands ?? []);
const hasRunnableCommands = computed(() => runnableScripts.value.length > 0 || runnableCustomCommands.value.length > 0);

function isCommandKeyRunning(commandKey: string): boolean {
    return isRunSessionActive(getSessionForTab(commandKey)?.status);
}

function getCustomCmdLabel(command: Pick<CustomCommand, 'name' | 'builtinId'>): string {
    return getCustomCommandDisplayName(command, t);
}

function getTabLabel(tabId: string): string {
    const command = parseProjectCommandKey(tabId);
    if (!command) return tabId;
    if (command.type === 'custom') {
        const customCommand = activeProject.value.customCommands?.find(item => item.id === command.id);
        return customCommand ? getCustomCommandDisplayName(customCommand, t) : command.id;
    }
    return command.id;
}

function activeCommandKey(): string | null {
    if (!activeScript.value) return null;
    const command = parseProjectCommandKey(activeScript.value);
    return command ? getProjectCommandRunId(activeProject.value.id, command.type, command.id) : null;
}

const currentSessionId = computed(() => {
    const command = activeScript.value ? parseProjectCommandKey(activeScript.value) : null;
    if (!command) return null;
    const commandKey = getProjectCommandRunId(activeProject.value.id, command.type, command.id);
    const sessionId = projectStore.latestSessionIdByCommand[commandKey];
    const session = sessionId ? projectStore.runSessions[sessionId] : undefined;
    return session?.projectId === activeProject.value.id && session.commandKey === commandKey ? sessionId : null;
});

const currentSession = computed(() => currentSessionId.value ? projectStore.runSessions[currentSessionId.value] : undefined);
const isRunning = computed(() => isRunSessionActive(currentSession.value?.status));
const isInteractive = computed(() => currentSession.value?.status === 'running');
const currentSessionEntries = computed<RunLogEntry[]>(() => currentSessionId.value ? projectStore.sessionLogEntries[currentSessionId.value] || [] : []);
const promptPreview = computed(() => {
    const sessionId = currentSessionId.value;
    return sessionId && isRunning.value ? projectStore.sessionPartialOutput[sessionId] || '' : '';
});
const currentSessionDuration = computed(() => {
    void currentTime.value;
    const session = currentSession.value;
    if (!session) return null;
    return session.durationMs ?? (isRunSessionActive(session.status) ? Math.max(0, Date.now() - session.startedAt) : null);
});

function getSessionStatusLabel(status: RunSession['status']): string {
    const labels: Record<RunSession['status'], string> = {
        starting: t('dashboard.runStatusStarting'),
        running: t('dashboard.runStatusRunning'),
        stopping: t('dashboard.runStatusStopping'),
        success: t('dashboard.runStatusSuccess'),
        failed: t('dashboard.runStatusFailed'),
        stopped: t('dashboard.runStatusStopped'),
    };
    return labels[status];
}

function getHistoryStatusLabel(status: RunHistoryEntry['status']): string {
    return getSessionStatusLabel(status);
}

function getSessionStatusIcon(status: RunSession['status']): string {
    switch (status) {
        case 'starting': return 'i-mdi-loading animate-spin';
        case 'running': return 'i-mdi-circle';
        case 'stopping': return 'i-mdi-loading animate-spin';
        case 'success': return 'i-mdi-check-circle-outline';
        case 'failed': return 'i-mdi-alert-circle-outline';
        case 'stopped': return 'i-mdi-stop-circle-outline';
    }
}

function getSessionStatusClass(status: RunSession['status']): string {
    return `console-session-status-${status}`;
}

function getTabStatusIcon(commandKey: string): string {
    return getSessionStatusIcon(getSessionForTab(commandKey)?.status || 'stopped');
}

function getTabStatusClass(commandKey: string): string {
    return getSessionStatusClass(getSessionForTab(commandKey)?.status || 'stopped');
}

function canCloseTab(commandKey: string): boolean {
    return !isRunSessionActive(getSessionForTab(commandKey)?.status);
}

function getTabTooltip(commandKey: string): string {
    const session = getSessionForTab(commandKey);
    if (!session) return getTabLabel(commandKey);
    const exit = session.exitCode === undefined
        ? ''
        : ` · ${t('dashboard.exitCodeShort', { code: session.exitCode ?? 'null' })}`;
    const duration = session.durationMs === undefined ? '' : ` · ${formatDuration(session.durationMs)}`;
    return `${getSessionStatusLabel(session.status)}${exit}${duration}`;
}

const logFilter = ref<LogStreamFilter>('all');
const filteredLogEntries = computed(() => filterLogEntries(currentSessionEntries.value, logFilter.value));
const searchOpen = ref(false);
const searchQuery = ref('');
const selectedMatchIndex = ref(-1);
const renderWindowAnchor = ref<'latest' | 'top' | 'focus'>('latest');
const searchMatches = computed(() => searchLogEntries(filteredLogEntries.value, searchQuery.value));
const selectedMatch = computed(() => searchMatches.value[selectedMatchIndex.value]);
const renderedLogWindow = computed(() => getRenderWindow(
    filteredLogEntries.value,
    CONSOLE_RENDER_WINDOW_SIZE,
    renderWindowAnchor.value === 'focus'
        ? selectedMatch.value?.entryIndex
        : renderWindowAnchor.value === 'top' ? 0 : undefined,
));
const renderedLogs = computed(() => renderedLogWindow.value.items.map(entry => ({
    ...entry,
    html: getCachedParsedAnsi(entry.text),
    isMatch: searchMatches.value.some(match => match.sequence === entry.sequence),
    isSelectedMatch: selectedMatch.value?.sequence === entry.sequence,
})));

function resetSearchSelection(): void {
    selectedMatchIndex.value = searchMatches.value.length > 0 ? 0 : -1;
}

function openSearch(): void {
    searchOpen.value = true;
    resetSearchSelection();
    renderWindowAnchor.value = searchMatches.value.length > 0 ? 'focus' : 'latest';
    void nextTick(() => {
        searchInput.value?.focus();
        searchInput.value?.select();
        void scrollToSelectedMatch();
    });
}

function closeSearch(): void {
    searchOpen.value = false;
    searchQuery.value = '';
    selectedMatchIndex.value = -1;
    renderWindowAnchor.value = 'latest';
}

function moveToMatch(direction: 'next' | 'previous'): void {
    if (!searchMatches.value.length) return;
    selectedMatchIndex.value = nextMatchIndex(searchMatches.value.length, selectedMatchIndex.value, direction);
    renderWindowAnchor.value = 'focus';
    shouldFollowLogs.value = false;
    void nextTick(scrollToSelectedMatch);
}

function searchNext(): void { moveToMatch('next'); }
function searchPrevious(): void { moveToMatch('previous'); }

async function scrollToSelectedMatch(): Promise<void> {
    await nextTick();
    const sequence = selectedMatch.value?.sequence;
    if (sequence === undefined || !logContainer.value) return;
    logContainer.value.querySelector<HTMLElement>(`[data-sequence="${sequence}"]`)?.scrollIntoView({ block: 'center' });
}

watch([searchQuery, logFilter], () => {
    resetSearchSelection();
    renderWindowAnchor.value = searchMatches.value.length > 0 ? 'focus' : 'latest';
    if (searchOpen.value) void nextTick(scrollToSelectedMatch);
});

watch(searchMatches, (matches) => {
    if (matches.length === 0) {
        selectedMatchIndex.value = -1;
    } else if (selectedMatchIndex.value < 0 || selectedMatchIndex.value >= matches.length) {
        selectedMatchIndex.value = 0;
    }
});

function formatLocalDateTime(timestamp?: number): string {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    const today = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    if (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()) {
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const currentCommandHistory = computed(() => {
    const commandKey = activeCommandKey();
    return commandKey ? runHistoryStore.commandHistory(commandKey) : [];
});
const projectHistory = computed(() => runHistoryStore.projectHistory(activeProject.value.id));
const historyOpen = ref(false);
const historyScope = ref<'command' | 'project'>('command');
const selectedHistoryId = ref<string | null>(null);
const visibleHistoryEntries = computed(() => historyScope.value === 'command' && activeCommandKey() ? currentCommandHistory.value : projectHistory.value);
const selectedHistoryEntry = computed(() => visibleHistoryEntries.value.find(entry => entry.historyId === selectedHistoryId.value) || visibleHistoryEntries.value[0]);

watch(visibleHistoryEntries, (entries) => {
    if (!entries.some(entry => entry.historyId === selectedHistoryId.value)) selectedHistoryId.value = entries[0]?.historyId || null;
}, { immediate: true });

function openHistory(scope?: 'command' | 'project', entryId?: string): void {
    historyScope.value = scope || (activeCommandKey() ? 'command' : 'project');
    historyOpen.value = true;
    selectedHistoryId.value = entryId || visibleHistoryEntries.value[0]?.historyId || null;
}

function historyCommandExists(entry: RunHistoryEntry): boolean {
    return isHistoryCommandAvailable(entry, activeProject.value);
}

function rerunHistoryEntry(entry: RunHistoryEntry): void {
    if (!historyCommandExists(entry)) {
        ElMessage.warning(t('dashboard.commandNoLongerExists'));
        return;
    }
    activeScript.value = getProjectCommandKey(entry.commandType, entry.commandId);
    if (entry.commandType === 'custom') void projectStore.runCustomCommand(activeProject.value, entry.commandId);
    else void projectStore.runProject(activeProject.value, entry.commandId);
}

async function clearProjectHistory(): Promise<void> {
    try {
        await ElMessageBox.confirm(
            t('dashboard.clearProjectHistoryConfirm', { name: activeProject.value.name }),
            t('dashboard.clearProjectHistory'),
            { confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel'), type: 'warning', customClass: 'dark-message-box' },
        );
        runHistoryStore.clearProjectHistory(activeProject.value.id);
        selectedHistoryId.value = null;
        ElMessage.success(t('common.success'));
    } catch {
        // 用户取消
    }
}

function buildExportText(): string {
    const session = currentSession.value;
    if (!session) return '';
    return buildSessionLogExportText({
        project: activeProject.value.name,
        command: session.displayName,
        status: getSessionStatusLabel(session.status),
        started: formatLocalDateTime(session.startedAt),
        ended: formatLocalDateTime(session.endedAt),
        duration: currentSessionDuration.value === null ? '-' : formatDuration(currentSessionDuration.value),
        exitCode: session.exitCode === undefined ? '-' : String(session.exitCode ?? 'null'),
        node: session.nodeVersion || '-',
        runtime: session.nodePath || '-',
        packageManager: session.packageManager || '-',
        cwd: session.cwd,
    }, currentSessionEntries.value, promptPreview.value || undefined);
}

async function writeClipboard(text: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    if (typeof document === 'undefined') throw new Error('Clipboard is not supported');
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard is not supported');
}

async function copyAll(): Promise<void> {
    if (!currentSession.value) return;
    try {
        await writeClipboard(formatLogEntriesPlainText(currentSessionEntries.value, promptPreview.value || undefined));
        ElMessage.success(t('dashboard.copyAllSuccess'));
    } catch (error) {
        ElMessage.warning(`${t('dashboard.copyAllFailed')}: ${String(error)}`);
    }
}

async function exportLog(): Promise<void> {
    if (!currentSession.value) return;
    try {
        const filePath = await api.saveDialog({
            defaultPath: buildRunLogFileName(activeProject.value.name, currentSession.value.displayName),
            filters: [{ name: 'Log', extensions: ['log', 'txt'] }],
        });
        if (!filePath) return;
        await api.writeTextFile(filePath, buildExportText());
        ElMessage.success(t('dashboard.exportLogSuccess'));
    } catch (error) {
        ElMessage.error(`${t('dashboard.exportLogFailed')}: ${String(error)}`);
    }
}

function handleMoreCommand(command: string): void {
    if (command === 'copy') void copyAll();
    if (command === 'export') void exportLog();
    if (command === 'clear') handleClear();
}

function isNearLogBottom(): boolean {
    if (!logContainer.value) return true;
    const { scrollTop, clientHeight, scrollHeight } = logContainer.value;
    return scrollHeight - (scrollTop + clientHeight) <= LOG_BOTTOM_THRESHOLD;
}

function handleLogScroll(): void { shouldFollowLogs.value = isNearLogBottom(); }
function scrollToBottom(): void { if (logContainer.value) logContainer.value.scrollTop = logContainer.value.scrollHeight; }

async function scheduleScrollToBottom(): Promise<void> {
    const token = ++scrollToBottomToken;
    await nextTick();
    if (token !== scrollToBottomToken || !shouldFollowLogs.value) return;
    scrollToBottom();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (token !== scrollToBottomToken || !shouldFollowLogs.value) return;
    scrollToBottom();
}

function jumpTop(): void {
    shouldFollowLogs.value = false;
    renderWindowAnchor.value = 'top';
    void nextTick(() => { if (logContainer.value) logContainer.value.scrollTop = 0; });
}

function jumpBottom(): void {
    renderWindowAnchor.value = 'latest';
    shouldFollowLogs.value = true;
    void scheduleScrollToBottom();
}

function resumeLogFollow(): void { jumpBottom(); }

const renderedLogWindowSignature = computed(() => {
    const entries = renderedLogWindow.value.items;
    return `${currentSessionId.value || ''}:${renderedLogWindow.value.start}:${entries.length}:${entries[0]?.sequence ?? ''}:${entries[entries.length - 1]?.sequence ?? ''}`;
});

watch(renderedLogWindowSignature, () => {
    if (shouldFollowLogs.value && renderWindowAnchor.value === 'latest') void scheduleScrollToBottom();
}, { flush: 'post' });

watch(activeScript, () => {
    closeSearch();
    renderWindowAnchor.value = 'latest';
    shouldFollowLogs.value = true;
    void resumeLogFollow();
});

watch(currentSessionId, () => {
    closeSearch();
    renderWindowAnchor.value = 'latest';
    shouldFollowLogs.value = true;
});

watch(() => projectStore.requestedConsoleHistoryToken, () => {
    if (projectStore.requestedConsoleHistoryProjectId !== activeProject.value.id) return;
    const request = projectStore.consumeConsoleHistoryRequest();
    openHistory('project', request.historyId || undefined);
}, { immediate: true });

function handleStop(): void {
    const command = activeScript.value ? parseProjectCommandKey(activeScript.value) : null;
    if (command) void projectStore.stopProject(activeProject.value, command.id, command.type);
}

function handleRerun(): void {
    const command = activeScript.value ? parseProjectCommandKey(activeScript.value) : null;
    const session = currentSession.value;
    if (!command || !session || isRunSessionActive(session.status)) return;
    if (command.type === 'custom') void projectStore.runCustomCommand(activeProject.value, command.id);
    else void projectStore.runProject(activeProject.value, command.id);
}

function handleClear(): void {
    if (currentSessionId.value) projectStore.clearSessionOutput(currentSessionId.value);
}

function handleRun(commandKey: string): void {
    const command = parseProjectCommandKey(commandKey);
    if (!command) return;
    if (command.type === 'custom') void projectStore.runCustomCommand(activeProject.value, command.id);
    else void projectStore.runProject(activeProject.value, command.id);
}

function toggleRun(commandKey: string): void {
    const command = parseProjectCommandKey(commandKey);
    if (!command) return;
    if (isCommandKeyRunning(commandKey)) {
        void projectStore.stopProject(activeProject.value, command.id, command.type);
        return;
    }
    handleRun(commandKey);
    activeScript.value = commandKey;
}

async function sendStdin(event?: KeyboardEvent): Promise<void> {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const commandKey = activeCommandKey();
    if (!commandKey || !isInteractive.value || sendingInput.value) return;
    sendingInput.value = true;
    try {
        await api.sendProjectInput(commandKey, `${stdinInput.value}\n`);
        stdinInput.value = '';
    } catch (error) {
        ElMessage.error(String(error));
    } finally {
        sendingInput.value = false;
    }
}

function handleStdinKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) void sendStdin(event);
}

function handleCloseTab(commandKey: string): void {
    const session = getSessionForTab(commandKey);
    if (session && isRunSessionActive(session.status)) {
        ElMessage.warning(t('dashboard.closeRunningTabHint'));
        return;
    }
    openTabs.value.delete(commandKey);
    closedTabs.value.add(commandKey);
    if (activeScript.value === commandKey) activeScript.value = Array.from(openTabs.value)[0] || null;
}

function handleConsoleKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const isSearchField = target === searchInput.value;
    const inConsoleOutput = !!target && !!logContainer.value && logContainer.value.contains(target);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && (!target || isSearchField || inConsoleOutput)) {
        event.preventDefault();
        openSearch();
        return;
    }
    if (searchOpen.value && event.key === 'Escape') {
        event.preventDefault();
        closeSearch();
        return;
    }
    if (searchOpen.value && isSearchField && event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) searchPrevious();
        else searchNext();
    }
}

onMounted(() => {
    durationTimer = window.setInterval(() => { currentTime.value = Date.now(); }, 1000);
});

onBeforeUnmount(() => {
    if (durationTimer !== null) window.clearInterval(durationTimer);
});
</script>

<template>
    <div class="app-page absolute inset-0 console-view" tabindex="-1" @keydown="handleConsoleKeydown">
        <div v-if="activeProject && hasRunnableCommands" class="command-launcher app-panel-toolbar flex flex-wrap items-center gap-1.5 px-3 py-2 border-b">
            <span class="app-text-control text-slate-400 dark:text-slate-500 mr-1 shrink-0">{{ t('dashboard.runnableCommands') }}</span>
            <button v-for="cmd in runnableCustomCommands" :key="cmd.id" @click="toggleRun(getProjectCommandKey('custom', cmd.id))" class="launcher-btn" :class="isCommandKeyRunning(getProjectCommandKey('custom', cmd.id)) ? 'launcher-btn-running' : 'launcher-btn-custom'">
                <div :class="isCommandKeyRunning(getProjectCommandKey('custom', cmd.id)) ? 'i-mdi-stop' : 'i-mdi-play'" class="text-xs" />
                {{ getCustomCmdLabel(cmd) }}
            </button>
            <button v-for="script in runnableScripts" :key="script" @click="toggleRun(getProjectCommandKey('script', script))" class="launcher-btn" :class="isCommandKeyRunning(getProjectCommandKey('script', script)) ? 'launcher-btn-running' : (script === 'dev' || script === 'start' || script === 'serve' ? 'launcher-btn-primary' : 'launcher-btn-muted')">
                <div :class="isCommandKeyRunning(getProjectCommandKey('script', script)) ? 'i-mdi-stop' : 'i-mdi-play'" class="text-xs" />
                {{ script }}
            </button>
        </div>

        <div v-if="activeProject" class="app-panel-toolbar flex flex-col z-10">
            <div v-if="availableTabs.length > 0" class="flex px-3 gap-0.5 overflow-x-auto custom-scrollbar pt-1.5">
                <div v-for="commandKey in availableTabs" :key="commandKey" @click="activeScript = commandKey" :title="getTabTooltip(commandKey)" class="group relative px-3 py-1.5 app-text-control rounded-t-md border-t border-x transition-all duration-150 cursor-pointer select-none flex items-center gap-2 min-w-[90px] justify-between" :class="activeScript === commandKey ? 'bg-[var(--app-bg-muted)] text-[var(--app-primary)] border-[var(--app-border)] border-b-transparent z-10' : 'bg-[var(--app-surface)] text-muted hover:text-secondary border-[var(--app-border)] hover:bg-[var(--app-surface-soft)]'">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="console-tab-status-icon shrink-0" :class="[getTabStatusClass(commandKey), getTabStatusIcon(commandKey)]" />
                        <span class="truncate">{{ getTabLabel(commandKey) }}</span>
                    </div>
                    <button @click.stop="handleCloseTab(commandKey)" class="app-icon-btn !h-5 !min-w-5 opacity-0 group-hover:opacity-100 !rounded" :title="canCloseTab(commandKey) ? t('dashboard.closeTab') : t('dashboard.closeRunningTabHint')">
                        <div class="i-mdi-close text-xs" />
                    </button>
                </div>
            </div>
            <div v-if="!currentSession" class="flex items-center justify-end px-3 py-1.5">
                <button class="console-header-command" type="button" :title="t('dashboard.runHistory')" @click="openHistory()"><div class="i-mdi-history text-sm" />{{ t('dashboard.runHistory') }}</button>
            </div>
        </div>

        <div v-if="activeScript && currentSession" class="app-panel-toolbar flex items-center justify-between gap-2 px-3 py-1.5 console-session-header">
            <div class="app-text-meta text-slate-400 dark:text-slate-500 font-mono flex items-center gap-2 min-w-0 flex-wrap">
                <span class="truncate max-w-32">{{ getTabLabel(activeScript) }}</span>
                <span class="console-session-status px-1.5 py-0.5 rounded border flex items-center gap-1" :class="getSessionStatusClass(currentSession.status)"><div :class="getSessionStatusIcon(currentSession.status)" class="text-xs" />{{ getSessionStatusLabel(currentSession.status) }}</span>
                 <span v-if="currentSession.exitCode !== undefined">{{ t('dashboard.exitCodeShort', { code: currentSession.exitCode === null ? 'null' : currentSession.exitCode }) }}</span>
                <span v-if="currentSessionDuration !== null">{{ formatDuration(currentSessionDuration) }}</span>
                 <span v-if="currentSession.nodeVersion" class="truncate max-w-[180px]">{{ t('dashboard.nodeLabel') }} {{ currentSession.nodeVersion }}</span>
                 <span v-else-if="currentSession.nodePath" class="truncate max-w-[180px]">{{ t('dashboard.nodeLabel') }} {{ currentSession.nodePath }}</span>
            </div>
            <div class="console-header-actions shrink-0">
                <button class="app-icon-btn !h-6 !min-w-6 !rounded" :title="t('dashboard.searchLogs')" @click="openSearch"><div class="i-mdi-magnify text-sm" /></button>
                <button class="console-header-command" type="button" :title="t('dashboard.runHistory')" @click="openHistory()"><div class="i-mdi-history text-sm" /><span class="hidden sm:inline">{{ t('dashboard.runHistory') }}</span></button>
                <button v-if="currentSession.status === 'starting' || currentSession.status === 'running'" class="console-stop-command" type="button" @click="handleStop"><div class="i-mdi-stop text-xs" /><span class="hidden sm:inline">{{ t('dashboard.stop') }}</span></button>
                <button v-else-if="currentSession.status === 'stopping'" class="console-status-command" type="button" disabled><div class="i-mdi-loading animate-spin text-xs" /><span class="hidden sm:inline">{{ t('dashboard.runStatusStopping') }}</span></button>
                <button v-else class="console-rerun-command" type="button" @click="handleRerun"><div class="i-mdi-restart text-xs" /><span class="hidden sm:inline">{{ t('dashboard.rerun') }}</span></button>
                <el-dropdown trigger="click" @command="handleMoreCommand">
                    <button class="app-icon-btn !h-6 !min-w-6 !rounded" :title="t('dashboard.moreActions')" type="button"><div class="i-mdi-dots-horizontal text-sm" /></button>
                    <template #dropdown>
                        <el-dropdown-menu>
                            <el-dropdown-item command="copy">{{ t('dashboard.copyAll') }}</el-dropdown-item>
                            <el-dropdown-item command="export">{{ t('dashboard.exportLog') }}</el-dropdown-item>
                            <el-dropdown-item command="clear">{{ t('dashboard.clearOutput') }}</el-dropdown-item>
                        </el-dropdown-menu>
                    </template>
                </el-dropdown>
            </div>
        </div>

        <div v-if="activeScript" class="console-output-shell flex-1 min-h-0 flex flex-col">
            <div v-if="searchOpen" class="console-search-bar app-panel-toolbar flex items-center gap-1.5 px-3 py-1.5 border-b">
                <div class="i-mdi-magnify text-sm text-slate-400 shrink-0" />
                <input ref="searchInput" v-model="searchQuery" class="console-search-input min-w-0 flex-1" :placeholder="t('dashboard.searchLogs')" :aria-label="t('dashboard.searchLogs')">
                <span class="console-search-count shrink-0">{{ searchMatches.length ? `${selectedMatchIndex + 1} / ${searchMatches.length}` : '0 / 0' }}</span>
                <button class="app-icon-btn !h-6 !min-w-6 !rounded" :title="t('dashboard.previousMatch')" :disabled="!searchMatches.length" @click="searchPrevious"><div class="i-mdi-chevron-up text-sm" /></button>
                <button class="app-icon-btn !h-6 !min-w-6 !rounded" :title="t('dashboard.nextMatch')" :disabled="!searchMatches.length" @click="searchNext"><div class="i-mdi-chevron-down text-sm" /></button>
                <button class="app-icon-btn !h-6 !min-w-6 !rounded" :title="t('dashboard.closeSearch')" @click="closeSearch"><div class="i-mdi-close text-sm" /></button>
            </div>

            <div class="console-tools-bar app-panel-toolbar flex items-center justify-between gap-2 px-3 py-1 border-b">
                <div class="console-filter-group" role="group" :aria-label="t('dashboard.logFilter')">
                    <button v-for="filter in (['all', 'stdout', 'stderr', 'system'] as LogStreamFilter[])" :key="filter" type="button" class="console-filter-button" :class="{ 'is-active': logFilter === filter }" @click="logFilter = filter">{{ filter === 'all' ? t('dashboard.filterAll') : filter === 'system' ? t('dashboard.runnerStream') : filter }}</button>
                </div>
                <div class="flex items-center gap-1">
                    <button class="app-icon-btn !h-6 !min-w-6 !rounded" :title="t('dashboard.jumpToTop')" :disabled="filteredLogEntries.length === 0" @click="jumpTop"><div class="i-mdi-arrow-collapse-up text-sm" /></button>
                    <button class="app-icon-btn !h-6 !min-w-6 !rounded" :title="t('dashboard.jumpToBottom')" :disabled="filteredLogEntries.length === 0" @click="jumpBottom"><div class="i-mdi-arrow-collapse-down text-sm" /></button>
                </div>
            </div>

            <div ref="logContainer" @click="handleLogClick" @scroll="handleLogScroll" class="flex-1 overflow-y-auto font-mono app-text-console whitespace-pre-wrap select-text relative min-h-0">
                <div class="p-3">
                    <div v-for="item in renderedLogs" :key="`${currentSessionId}:${item.sequence}`" :data-sequence="item.sequence" class="console-log-row break-all border-l-2 border-transparent pl-2 -ml-2 transition-colors duration-100 py-px" :class="{ 'console-log-match': item.isMatch, 'console-log-match-selected': item.isSelectedMatch, 'console-log-stderr': item.stream === 'stderr' }" v-html="item.html" />
                    <div v-if="promptPreview" class="console-log-row break-all border-l-2 border-transparent pl-2 -ml-2 py-px text-amber-500" v-html="getCachedParsedAnsi(promptPreview)" />
                </div>
                <div v-if="filteredLogEntries.length === 0" class="h-full flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 absolute inset-0 pointer-events-none"><div class="i-mdi-console-line text-5xl mb-3 opacity-20" /><p class="app-text-caption">{{ t('dashboard.waitingForOutput') }}</p></div>
                <button v-if="!shouldFollowLogs && filteredLogEntries.length > 0" @click.stop="resumeLogFollow" class="app-primary-action app-text-control absolute right-4 bottom-4 z-10 !min-h-0 rounded-full px-3 py-1.5"><div class="i-mdi-arrow-down-circle text-sm" /><span>{{ t('dashboard.jumpToBottom') }}</span></button>
            </div>

            <div v-if="isInteractive" class="console-stdin-bar shrink-0 flex items-center gap-2 border-t px-3 py-2">
                <input v-model="stdinInput" class="console-stdin-input min-w-0 flex-1" :placeholder="t('dashboard.stdinPlaceholder')" :title="t('dashboard.stdinHint')" @keydown="handleStdinKeydown">
                <button type="button" class="console-stdin-send" :disabled="sendingInput" @click="sendStdin()">{{ t('dashboard.stdinSend') }}</button>
            </div>
        </div>

        <div v-else class="flex-1 flex flex-col items-center justify-center text-slate-300 dark:text-slate-600">
            <div class="w-20 h-20 rounded-full flex items-center justify-center mb-4" style="background: var(--app-surface-soft);"><div class="i-mdi-monitor-dashboard text-4xl opacity-25" /></div>
            <p class="text-sm font-medium text-slate-500 dark:text-slate-500">{{ !activeProject ? t('dashboard.selectScript') : (hasRunnableCommands ? t('dashboard.clickRunHint') : t('dashboard.noRunnableCommands')) }}</p>
            <button v-if="projectHistory.length > 0" type="button" class="console-empty-history" @click="openHistory('project')"><div class="i-mdi-history text-sm" />{{ t('dashboard.viewRunHistory') }}</button>
        </div>

        <div v-if="historyOpen" class="console-history-layer" @click.self="historyOpen = false">
            <aside class="console-history-drawer" role="dialog" :aria-label="t('dashboard.runHistory')">
                <div class="console-history-header"><div class="min-w-0"><h3 class="app-text-subheading truncate">{{ t('dashboard.runHistory') }}</h3><p class="app-text-meta text-slate-400 truncate">{{ activeProject.name }}</p></div><button class="app-icon-btn !h-7 !min-w-7 !rounded" :title="t('common.close')" @click="historyOpen = false"><div class="i-mdi-close text-sm" /></button></div>
                <div class="console-history-scope px-3 py-2"><button type="button" :class="{ 'is-active': historyScope === 'command' }" :disabled="!activeCommandKey()" @click="historyScope = 'command'">{{ t('dashboard.currentCommand') }}</button><button type="button" :class="{ 'is-active': historyScope === 'project' }" @click="historyScope = 'project'">{{ t('dashboard.currentProject') }}</button></div>
                <div class="console-history-list flex-1 overflow-y-auto px-3">
                    <div v-if="visibleHistoryEntries.length === 0" class="console-history-empty"><div class="i-mdi-history text-3xl opacity-25" /><span>{{ t('dashboard.noRunHistory') }}</span></div>
                    <button v-for="entry in visibleHistoryEntries" :key="entry.historyId" type="button" class="console-history-row" :class="{ 'is-selected': selectedHistoryEntry?.historyId === entry.historyId }" @click="selectedHistoryId = entry.historyId">
                        <span class="console-history-status" :class="getSessionStatusClass(entry.status)"><div :class="getSessionStatusIcon(entry.status)" /></span>
                        <span class="min-w-0 flex-1 text-left"><span class="block truncate app-text-control">{{ entry.displayName }}</span><span class="block app-text-meta text-slate-400">{{ formatLocalDateTime(entry.endedAt) }}</span></span>
                         <span class="app-text-meta text-slate-400 text-right shrink-0"><span v-if="entry.status === 'failed'" class="block">{{ t('dashboard.exitCodeShort', { code: entry.exitCode ?? 'null' }) }}</span><span>{{ formatDuration(entry.durationMs) }}</span></span>
                    </button>
                </div>
                <div v-if="selectedHistoryEntry" class="console-history-detail px-3 py-3 border-t">
                    <div class="flex items-center justify-between gap-2 mb-2"><span class="console-history-detail-status app-text-meta" :class="getSessionStatusClass(selectedHistoryEntry.status)"><div :class="getSessionStatusIcon(selectedHistoryEntry.status)" />{{ getHistoryStatusLabel(selectedHistoryEntry.status) }}</span><button type="button" class="console-rerun-command" :disabled="!historyCommandExists(selectedHistoryEntry)" :title="historyCommandExists(selectedHistoryEntry) ? t('dashboard.rerun') : t('dashboard.commandNoLongerExists')" @click="rerunHistoryEntry(selectedHistoryEntry)"><div class="i-mdi-restart text-xs" />{{ t('dashboard.rerun') }}</button></div>
                    <dl class="console-history-metadata">
                        <div><dt>{{ t('dashboard.historyStarted') }}</dt><dd>{{ formatLocalDateTime(selectedHistoryEntry.startedAt) }}</dd></div>
                        <div><dt>{{ t('dashboard.historyEnded') }}</dt><dd>{{ formatLocalDateTime(selectedHistoryEntry.endedAt) }}</dd></div>
                        <div><dt>{{ t('dashboard.historyDuration') }}</dt><dd>{{ formatDuration(selectedHistoryEntry.durationMs) }}</dd></div>
                        <div><dt>{{ t('dashboard.historyExitCode') }}</dt><dd>{{ selectedHistoryEntry.exitCode ?? 'null' }}</dd></div>
                         <div><dt>{{ t('dashboard.nodeLabel') }}</dt><dd>{{ selectedHistoryEntry.nodeVersion || '-' }}</dd></div>
                        <div><dt>{{ t('dashboard.historyRuntime') }}</dt><dd :title="selectedHistoryEntry.nodePath">{{ selectedHistoryEntry.nodePath || '-' }}</dd></div>
                        <div><dt>{{ t('dashboard.historyPackageManager') }}</dt><dd>{{ selectedHistoryEntry.packageManager || '-' }}</dd></div>
                        <div><dt>{{ t('dashboard.historyCwd') }}</dt><dd :title="selectedHistoryEntry.cwd">{{ selectedHistoryEntry.cwd }}</dd></div>
                    </dl>
                    <p v-if="selectedHistoryEntry.errorMessage" class="console-history-error">{{ selectedHistoryEntry.errorMessage }}</p><p class="app-text-meta text-slate-400 mt-2">{{ t('dashboard.historySummaryOnly') }}</p>
                </div>
                <div class="console-history-footer px-3 py-2 border-t"><button type="button" class="console-history-clear" :disabled="projectHistory.length === 0" @click="clearProjectHistory"><div class="i-mdi-delete-sweep text-sm" />{{ t('dashboard.clearProjectHistory') }}</button></div>
            </aside>
        </div>
    </div>
</template>

<style scoped>
.overflow-y-auto::-webkit-scrollbar { width: 8px; height: 8px; }
.overflow-y-auto::-webkit-scrollbar-track { background: transparent; }
.overflow-y-auto::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--app-text-muted) 52%, transparent); border-radius: 4px; }
.overflow-y-auto::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--app-text-muted) 74%, transparent); }
.console-tab-status-icon { width: 12px; height: 12px; display: inline-block; }
.console-session-status-starting, .console-session-status-running { color: var(--app-success); border-color: color-mix(in srgb, var(--app-success) 26%, transparent); background: color-mix(in srgb, var(--app-success) 8%, transparent); }
.console-session-status-stopping { color: var(--app-warning, #d97706); border-color: color-mix(in srgb, var(--app-warning, #d97706) 26%, transparent); background: color-mix(in srgb, var(--app-warning, #d97706) 8%, transparent); }
.console-session-status-success { color: var(--app-success); border-color: color-mix(in srgb, var(--app-success) 26%, transparent); background: color-mix(in srgb, var(--app-success) 8%, transparent); }
.console-session-status-failed { color: var(--app-danger, #dc2626); border-color: color-mix(in srgb, var(--app-danger, #dc2626) 26%, transparent); background: color-mix(in srgb, var(--app-danger, #dc2626) 8%, transparent); }
.console-session-status-stopped { color: var(--app-text-secondary); border-color: var(--app-border); background: var(--app-surface-soft); }
.console-log-row:hover { background: color-mix(in srgb, var(--app-text-muted) 10%, transparent); border-left-color: var(--app-border); }
.console-log-stderr { border-left-color: color-mix(in srgb, var(--app-warning, #d97706) 32%, transparent); }
.console-log-match { background: color-mix(in srgb, var(--app-warning, #d97706) 12%, transparent); }
.console-log-match-selected { outline: 1px solid color-mix(in srgb, var(--app-warning, #d97706) 58%, transparent); outline-offset: 1px; }
.launcher-btn { display: inline-flex; align-items: center; gap: 4px; min-height: var(--app-control-height-sm); padding: 3px 10px; border-radius: var(--app-radius-md); font-size: var(--app-font-control); line-height: var(--app-line-height-control); font-weight: 600; border: 1px solid transparent; cursor: pointer; transition: background-color var(--app-duration-fast) var(--app-ease), color var(--app-duration-fast) var(--app-ease); }
.launcher-btn-custom { background: color-mix(in srgb, var(--app-primary) 8%, transparent); color: var(--app-primary); border-color: color-mix(in srgb, var(--app-primary) 18%, transparent); border-style: dashed; }
.launcher-btn-custom:hover { background: color-mix(in srgb, var(--app-primary) 16%, transparent); }
.launcher-btn-primary { background: color-mix(in srgb, var(--app-success) 10%, transparent); color: var(--app-success); border-color: color-mix(in srgb, var(--app-success) 20%, transparent); }
.launcher-btn-primary:hover { background: color-mix(in srgb, var(--app-success) 18%, transparent); }
.launcher-btn-muted { background: var(--app-surface-soft); color: var(--app-text-secondary); border-color: var(--app-border); }
.launcher-btn-muted:hover { background: var(--app-surface); color: var(--app-text); }
.launcher-btn-running { background: color-mix(in srgb, var(--app-danger, #ef4444) 12%, transparent); color: var(--app-danger, #ef4444); border-color: color-mix(in srgb, var(--app-danger, #ef4444) 22%, transparent); }
.console-header-actions { display: flex; align-items: center; gap: 4px; }
.console-header-command, .console-stop-command, .console-rerun-command, .console-status-command { display: inline-flex; align-items: center; gap: 5px; min-height: var(--app-control-height-sm); padding: 0 8px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-surface-soft); color: var(--app-text-secondary); font-size: var(--app-font-control); line-height: var(--app-line-height-control); font-weight: 600; white-space: nowrap; }
.console-header-command:hover { color: var(--app-primary); border-color: color-mix(in srgb, var(--app-primary) 35%, transparent); }
.console-stop-command { color: var(--app-danger, #dc2626); border-color: color-mix(in srgb, var(--app-danger, #dc2626) 22%, transparent); background: color-mix(in srgb, var(--app-danger, #dc2626) 8%, transparent); }
.console-rerun-command { color: var(--app-warning, #b45309); border-color: color-mix(in srgb, var(--app-warning, #b45309) 25%, transparent); background: color-mix(in srgb, var(--app-warning, #b45309) 8%, transparent); }
.console-status-command { color: var(--app-text-muted); opacity: .75; }
.console-search-input { height: var(--app-control-height-sm); padding: 0 8px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-surface-soft); color: var(--app-text); font: inherit; font-size: var(--app-font-control); outline: none; }
.console-search-input:focus { border-color: color-mix(in srgb, var(--app-primary) 52%, transparent); }
.console-search-count { min-width: 46px; color: var(--app-text-muted); font-size: var(--app-font-meta); text-align: right; }
.console-filter-group { display: inline-flex; align-items: center; gap: 2px; }
.console-filter-button { min-height: var(--app-control-height-sm); padding: 0 7px; border: 1px solid transparent; border-radius: var(--app-radius-sm); background: transparent; color: var(--app-text-muted); font-size: var(--app-font-control); }
.console-filter-button:hover, .console-filter-button.is-active { border-color: var(--app-border); background: var(--app-surface-soft); color: var(--app-primary); }
.console-stdin-bar { background: var(--app-surface); }
.console-stdin-input { height: var(--app-control-height-sm); padding: 0 10px; border: 1px solid var(--app-border); border-radius: var(--app-radius-md); background: var(--app-surface-soft); color: var(--app-text); font-size: var(--app-font-control); line-height: var(--app-line-height-control); font-family: inherit; }
.console-stdin-send { height: var(--app-control-height-sm); padding: 0 12px; border-radius: var(--app-radius-md); border: 1px solid color-mix(in srgb, var(--app-primary) 30%, transparent); background: color-mix(in srgb, var(--app-primary) 10%, transparent); color: var(--app-primary); font-size: var(--app-font-control); line-height: var(--app-line-height-control); font-weight: 600; }
.console-empty-history { display: inline-flex; align-items: center; gap: 5px; margin-top: 12px; padding: 5px 9px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-surface-soft); color: var(--app-primary); font-size: var(--app-font-control); }
.console-history-layer { position: absolute; inset: 0; z-index: 30; background: color-mix(in srgb, black 18%, transparent); }
.console-history-drawer { position: absolute; inset: 0 0 0 auto; display: flex; flex-direction: column; width: min(420px, calc(100vw - 24px)); background: var(--app-surface); border-left: 1px solid var(--app-border); box-shadow: -8px 0 24px color-mix(in srgb, black 16%, transparent); }
.console-history-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border-bottom: 1px solid var(--app-border); }
.console-history-scope { display: flex; gap: 4px; border-bottom: 1px solid var(--app-border); }
.console-history-scope button { flex: 1; min-height: var(--app-control-height-sm); border: 1px solid transparent; border-radius: var(--app-radius-sm); background: transparent; color: var(--app-text-muted); font-size: var(--app-font-control); }
.console-history-scope button:hover, .console-history-scope button.is-active { color: var(--app-primary); border-color: var(--app-border); background: var(--app-surface-soft); }
.console-history-row { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 50px; padding: 7px 8px; border: 1px solid transparent; border-radius: var(--app-radius-sm); background: transparent; color: var(--app-text); }
.console-history-row:hover, .console-history-row.is-selected { border-color: var(--app-border); background: var(--app-surface-soft); }
.console-history-status { display: inline-flex; align-items: center; justify-content: center; width: 20px; flex-shrink: 0; font-size: 14px; }
.console-history-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; height: 180px; color: var(--app-text-muted); font-size: var(--app-font-meta); }
.console-history-detail { background: var(--app-surface-soft); }
.console-history-detail-status { display: inline-flex; align-items: center; gap: 5px; padding: 3px 6px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); font-size: var(--app-font-meta); }
.console-history-metadata { display: grid; gap: 5px; font-size: var(--app-font-meta); }
.console-history-metadata > div { display: grid; grid-template-columns: 86px minmax(0, 1fr); gap: 8px; }
.console-history-metadata dt { color: var(--app-text-muted); }
.console-history-metadata dd { overflow: hidden; color: var(--app-text-secondary); text-overflow: ellipsis; white-space: nowrap; }
.console-history-error { margin-top: 8px; padding: 6px 7px; border-left: 2px solid var(--app-danger, #dc2626); color: var(--app-text-secondary); font-size: var(--app-font-meta); line-height: var(--app-line-height-body); white-space: pre-wrap; word-break: break-word; }
.console-history-footer { background: var(--app-surface); }
.console-history-clear { display: inline-flex; align-items: center; gap: 5px; min-height: var(--app-control-height-sm); color: var(--app-danger, #dc2626); font-size: var(--app-font-control); }
.console-history-clear:disabled { color: var(--app-text-muted); opacity: .55; }
</style>
