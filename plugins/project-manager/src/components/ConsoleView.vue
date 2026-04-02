<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { useProjectStore } from '../stores/project';
import { useI18n } from 'vue-i18n';
import { AnsiUp } from 'ansi_up';
import { api } from '../api';

const { t } = useI18n();
const projectStore = useProjectStore();
const ansiUp = new AnsiUp();

function parseAnsi(text: string) {
    const urlPlaceholders: { [key: string]: string } = {};
    let placeholderIndex = 0;
    
    // Regex to match URL allowing ANSI codes inside
    const urlRegex = /(https?:\/\/(?:[^\s\x1b]|(?:\x1b\[[0-9;]*[mK]))+)/g;
    
    let processedText = text.replace(urlRegex, (match) => {
        let urlWithAnsi = match;
        const trailingRegex = /([.,;!?'"\])])((\x1b\[[0-9;]*[mK])*)$/;
        let finalUrl = urlWithAnsi;
        let strippedSuffix = "";
        
        while (true) {
             const m = finalUrl.match(trailingRegex);
             if (m) {
                 const punct = m[1];
                 const ansi = m[2];
                 strippedSuffix = punct + strippedSuffix;
                 finalUrl = finalUrl.slice(0, -m[0].length) + ansi;
             } else {
                 break;
             }
        }

        const placeholder = `__URL_PLACEHOLDER_${placeholderIndex++}__`;
        urlPlaceholders[placeholder] = finalUrl;
        return placeholder + strippedSuffix;
    });
    
    const html = ansiUp.ansi_to_html(processedText);
    
    return html.replace(/__URL_PLACEHOLDER_(\d+)__/g, (match) => {
        const urlWithAnsi = urlPlaceholders[match];
        if (urlWithAnsi) {
            const cleanUrl = urlWithAnsi.replace(/\x1b\[[0-9;]*[mK]/g, '');
            const displayHtml = ansiUp.ansi_to_html(urlWithAnsi);
            return `<span class="log-link text-blue-400 hover:underline cursor-pointer" data-url="${cleanUrl.replace(/"/g, '&quot;')}" title="Ctrl + Click to open">${displayHtml}</span>`;
        }
        return match;
    });
}

function handleLogClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    // Find the closest log-link element, as the click might be on a nested span inside the link
    const linkElement = target.closest('.log-link') as HTMLElement;
    
    if (linkElement) {
        const url = linkElement.dataset.url;
        if (url && (event.ctrlKey || event.metaKey)) {
             api.openUrl(url);
        }
    }
}

const activeProject = computed(() =>
    projectStore.projects.find(p => p.id === projectStore.activeProjectId)
);

const activeScript = ref<string | null>(null);
const logContainer = ref<HTMLElement | null>(null);

// Keep track of active tabs explicitly
// We'll use a local state to track which tabs are "open"
// Tabs are opened when:
// 1. A script starts running
// 2. A script is manually clicked in the sidebar (ProjectListItem) -> wait, clicking there just runs it.
// 3. What if I want to see logs of a stopped script? 
// The user said: "After executing command on left, add tab on right".
// So we should add to 'openTabs' when runningStatus changes to true.

const openTabs = ref<Set<string>>(new Set());

// Watch for running scripts to auto-open tabs
watch(() => projectStore.runningStatus, (newStatus) => {
    if (!activeProject.value) return;

    Object.entries(newStatus).forEach(([key, running]) => {
        const prefix = `${activeProject.value?.id}:`;
        if (running && key.startsWith(prefix)) {
            const script = key.substring(prefix.length);
            if (!openTabs.value.has(script)) {
                openTabs.value.add(script);
                // If no active script, or if we want to auto-switch to newly started command?
                // User usually wants to see what they just ran.
                activeScript.value = script;
            }
        }
    });
}, { deep: true });

// Also populate openTabs from existing logs/running on mount/project change
watch(activeProject, (newP) => {
    openTabs.value.clear();
    activeScript.value = null;

    if (newP) {
        // Check node scripts
        if (newP.scripts) {
            newP.scripts.forEach(s => {
                const key = `${newP.id}:${s}`;
                if (projectStore.runningStatus[key] || (projectStore.logs[key] && projectStore.logs[key].length > 0)) {
                    openTabs.value.add(s);
                }
            });
        }

        // Check custom commands
        if (newP.customCommands) {
            newP.customCommands.forEach(c => {
                const key = `${newP.id}:${c.id}`;
                if (projectStore.runningStatus[key] || (projectStore.logs[key] && projectStore.logs[key].length > 0)) {
                    openTabs.value.add(c.id);
                }
            });
        }

        // Auto select first available
        if (openTabs.value.size > 0) {
            // Prefer running ones
            const running = Array.from(openTabs.value).find(s => projectStore.runningStatus[`${newP.id}:${s}`]);
            activeScript.value = running || Array.from(openTabs.value)[0];
        }
    }
}, { immediate: true });

const availableTabs = computed(() => {
    return Array.from(openTabs.value);
});

function getTabLabel(tabId: string): string {
    if (!activeProject.value) return tabId;
    const customCmd = activeProject.value.customCommands?.find(c => c.id === tabId);
    if (customCmd) return customCmd.name;
    return tabId;
}

const logs = computed(() => {
    if (!activeProject.value || !activeScript.value) return [];
    // Use Object.freeze to avoid deep reactivity overhead on large arrays
    const allLogs = projectStore.logs[`${activeProject.value.id}:${activeScript.value}`] || [];
    // Return a frozen slice
    return allLogs.slice(-500);
});

const isRunning = computed(() => {
    if (!activeProject.value || !activeScript.value) return false;
    return projectStore.runningStatus[`${activeProject.value.id}:${activeScript.value}`] || false;
});

// Auto-scroll logic
// We want to scroll to bottom when new logs arrive, BUT only if we are already near bottom
// or if it's the first render.
// User requirement: "Always display the latest output at the bottom" (Run project always show newest output).
// This implies forcing scroll to bottom.

const scrollToBottom = () => {
    if (logContainer.value) {
        // Use scrollTop assignment directly which is synchronous
        logContainer.value.scrollTop = logContainer.value.scrollHeight;
    }
};

watch(() => logs.value.length, () => {
    // Only scroll if we are already near bottom or if explicitly needed?
    // Actually for "tail -f" behavior we usually want to force scroll unless user scrolled up.
    // But user reported "cannot see latest output in time" which implies we are NOT scrolling fast enough.
    // Let's use requestAnimationFrame for smoother but guaranteed updates
    requestAnimationFrame(() => {
        scrollToBottom();
    });
});

// Force scroll on script switch - INSTANTLY
watch(activeScript, () => {
    // We need to wait for Vue to render the new logs first
    nextTick(() => {
        // Force scroll multiple times to ensure layout is settled
        scrollToBottom();
        requestAnimationFrame(scrollToBottom);
    });
});

function handleStop() {
    if (activeProject.value && activeScript.value) {
        projectStore.stopProject(activeProject.value, activeScript.value);
    }
}

async function handleRestart() {
    if (activeProject.value && activeScript.value) {
        const runId = `${activeProject.value.id}:${activeScript.value}`;
        
        // 如果已经在运行，先停止
        if (projectStore.runningStatus[runId]) {
            await projectStore.stopProject(activeProject.value, activeScript.value);
            
            // 等待进程真正退出
            const maxWait = 5000;
            const startTime = Date.now();
            while (projectStore.runningStatus[runId] && (Date.now() - startTime) < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // 启动
        if (activeProject.value && activeScript.value) {
            const customCmd = activeProject.value.customCommands?.find(c => c.id === activeScript.value);
            if (customCmd) {
                projectStore.runCustomCommand(activeProject.value, customCmd.id);
            } else {
                projectStore.runProject(activeProject.value, activeScript.value);
            }
        }
    }
}

function handleClear() {
    if (activeProject.value && activeScript.value) {
        projectStore.clearLog(`${activeProject.value.id}:${activeScript.value}`);
    }
}

function handleRun(script: string) {
    if (activeProject.value) {
        // Check if it's a custom command id
        const customCmd = activeProject.value.customCommands?.find(c => c.id === script);
        if (customCmd) {
            projectStore.runCustomCommand(activeProject.value, customCmd.id);
        } else {
            projectStore.runProject(activeProject.value, script);
        }
    }
}

function handleCloseTab(script: string) {
    // Stop the script if running
    if (activeProject.value && projectStore.runningStatus[`${activeProject.value.id}:${script}`]) {
        projectStore.stopProject(activeProject.value, script);
    }

    openTabs.value.delete(script);
    if (activeScript.value === script) {
        activeScript.value = Array.from(openTabs.value)[0] || null;
    }
}
</script>

<template>
    <div class="absolute inset-0 flex flex-col bg-slate-50 dark:bg-[#0f172a] text-slate-700 dark:text-slate-300 overflow-hidden transition-colors duration-200">
        <!-- Header -->
        <div v-if="activeProject"
            class="flex flex-col border-b border-slate-200 dark:border-slate-700/30 bg-white dark:bg-[#1e293b] z-10">
            <!-- Tabs for outputs -->
            <div v-if="availableTabs.length > 0" class="flex px-3 gap-0.5 overflow-x-auto custom-scrollbar pt-1.5">
                <div v-for="script in availableTabs" :key="script" @click="activeScript = script"
                    class="group relative px-3 py-1.5 text-xs font-medium rounded-t-md border-t border-x transition-all duration-150 cursor-pointer select-none flex items-center gap-2 min-w-[90px] justify-between"
                    :class="activeScript === script 
                        ? 'bg-slate-50 dark:bg-[#0f172a] text-blue-600 dark:text-blue-400 border-slate-200 dark:border-slate-700/30 border-b-transparent z-10' 
                        : 'bg-white dark:bg-slate-800/20 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 border-slate-200/60 dark:border-slate-700/20 hover:bg-slate-50 dark:hover:bg-slate-800/40'">
                    <div class="flex items-center gap-1.5">
                        <span v-if="projectStore.runningStatus[`${activeProject.id}:${script}`]"
                            class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_4px_rgba(16,185,129,0.4)]"></span>
                        <span v-else class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600"></span>
                        {{ getTabLabel(script) }}
                    </div>

                    <button @click.stop="handleCloseTab(script)"
                        class="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-slate-600 dark:hover:text-white transition-all duration-150">
                        <div class="i-mdi-close text-[10px]" />
                    </button>
                </div>
            </div>
        </div>

        <!-- Logs Control Bar (only if script selected) -->
        <div v-if="activeScript"
            class="flex items-center justify-between px-3 py-1.5 bg-slate-100/80 dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-800/50">
            <div class="text-[11px] text-slate-400 dark:text-slate-500 font-mono flex items-center gap-2">
                <span>{{ getTabLabel(activeScript) }}</span>
                <span v-if="isRunning" class="text-emerald-500 flex items-center gap-1">
                    <div class="i-mdi-loading animate-spin text-[10px]" /> {{ t('dashboard.running') }}
                </span>
                <span v-else class="text-slate-300 dark:text-slate-600">{{ t('dashboard.stopped') }}</span>
            </div>
            <div class="flex gap-1.5">
                <button @click="handleClear" class="p-1 hover:bg-slate-200/60 dark:hover:bg-slate-700/40 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors duration-150"
                    title="Clear Logs">
                    <div class="i-mdi-delete-sweep text-sm" />
                </button>
                <button v-if="isRunning" @click="handleRestart"
                    class="px-2 py-0.5 bg-amber-500/8 hover:bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/15 rounded text-[11px] flex items-center gap-1 transition-all duration-150">
                    <div class="i-mdi-restart text-[10px]" /> {{ t('dashboard.restart') }}
                </button>
                <button v-if="isRunning" @click="handleStop"
                    class="px-2 py-0.5 bg-rose-500/8 hover:bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/15 rounded text-[11px] flex items-center gap-1 transition-all duration-150">
                    <div class="i-mdi-stop text-[10px]" /> {{ t('dashboard.stop') }}
                </button>
                <button v-else @click="handleRun(activeScript!)"
                    class="px-2 py-0.5 bg-blue-500/8 hover:bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/15 rounded text-[11px] flex items-center gap-1 transition-all duration-150">
                    <div class="i-mdi-play text-[10px]" /> {{ t('dashboard.start') }}
                </button>
            </div>
        </div>

        <!-- Logs -->
        <div v-if="activeScript" ref="logContainer" @click="handleLogClick"
            class="flex-1 overflow-y-auto font-mono text-xs leading-relaxed whitespace-pre-wrap select-text relative min-h-0">
            <div :key="activeScript" class="p-3">
                <div v-for="(line, i) in logs" :key="i"
                    class="break-all border-l-2 border-transparent hover:border-slate-200 dark:hover:border-slate-700 pl-2 -ml-2 hover:bg-slate-100/40 dark:hover:bg-slate-800/20 transition-colors duration-100 py-px"
                    v-html="parseAnsi(line)">
                </div>
            </div>

            <div v-if="logs.length === 0"
                class="h-full flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 absolute inset-0 pointer-events-none">
                <div class="i-mdi-console-line text-5xl mb-3 opacity-20" />
                <p class="text-xs">{{ t('dashboard.waitingForOutput') }}</p>
            </div>
        </div>

        <!-- Empty State -->
        <div v-else class="flex-1 flex flex-col items-center justify-center text-slate-300 dark:text-slate-600">
            <div class="w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-800/40 flex items-center justify-center mb-4">
                <div class="i-mdi-monitor-dashboard text-4xl opacity-25" />
            </div>
            <p class="text-sm font-medium text-slate-500 dark:text-slate-500">{{ t('dashboard.selectScript') }}</p>
            <p class="text-xs opacity-40 mt-1">{{ t('dashboard.clickRunHint') }}</p>
        </div>
    </div>
</template>

<style scoped>
/* Custom Scrollbar for Webkit (Chrome, Safari, Edge) */
.overflow-y-auto::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.overflow-y-auto::-webkit-scrollbar-track {
  background: transparent;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
  background: #cbd5e1; /* slate-300 */
  border-radius: 4px;
}

.dark .overflow-y-auto::-webkit-scrollbar-thumb {
  background: #475569; /* slate-600 */
}

.overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: #94a3b8; /* slate-400 */
}

.dark .overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: #64748b; /* slate-500 */
}
</style>
