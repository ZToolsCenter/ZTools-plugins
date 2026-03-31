<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, h } from 'vue';
import { api } from './api';
import { ElMessageBox, ElMessage, ElLoading } from 'element-plus';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useI18n } from 'vue-i18n';
import Sidebar from './components/Sidebar.vue';
import Dashboard from './views/Dashboard.vue';
import Settings from './views/Settings.vue';
import NodeManager from './views/NodeManager.vue';
import TitleBar from './components/TitleBar.vue';
import UpdateProgress from './components/UpdateProgress.vue';
import { loadData, saveData } from './utils/persistence';
import { useProjectStore } from './stores/project';
import { useSettingsStore } from './stores/settings';
import { useNodeStore } from './stores/node';
import { useGitStore } from './stores/git';
import type { Project } from './types';
import { normalizeNvmVersion, findInstalledNodeVersion } from './utils/nvm';

const target = import.meta.env.VITE_TARGET;
const isPlugin = target === 'utools' || target === 'ztools';

const { t } = useI18n();
const currentView = ref<'dashboard' | 'settings' | 'nodes'>('dashboard');
const loaded = ref(false);
const isDragging = ref(false);
let unlistenDragEnter: UnlistenFn | null = null;
let unlistenDragLeave: UnlistenFn | null = null;
let unlistenDragDrop: UnlistenFn | null = null;
let unlistenSingleInstance: UnlistenFn | null = null;

const showUpdateProgress = ref(false);
const downloadProgress = ref(0);
const processedImportInstallVersions = new Set<string>();


async function handleImportProject(path: string) {
  const store = useProjectStore();
  if (store.projects.some(p => p.path === path)) {
    ElMessage.warning(t('project.alreadyExists') || 'Project already exists');
    return;
  }

  const loading = ElLoading.service({
    lock: true,
    text: 'Scanning...',
    background: 'rgba(0, 0, 0, 0.7)',
  });

  try {
    const info = await api.scanProject(path);
    let nodeVersion = '';

    const normalizedNvmVersion = normalizeNvmVersion(info.nvmVersion);
    if (normalizedNvmVersion) {
      let currentNodeVersions: string[] = [];
      try {
        const nvmList = await api.getNvmList();
        currentNodeVersions = nvmList.map(v => v.version);
      } catch (nvmErr) {
        console.error('Failed to load node versions for import', nvmErr);
      }

      let installed = findInstalledNodeVersion(currentNodeVersions, normalizedNvmVersion);

      if (!installed && !processedImportInstallVersions.has(normalizedNvmVersion)) {
        processedImportInstallVersions.add(normalizedNvmVersion);
        try {
          ElMessage.info(t('project.autoInstallStart', { version: normalizedNvmVersion }));
          await api.installNode(normalizedNvmVersion);
          ElMessage.success(t('project.autoInstallSuccess', { version: normalizedNvmVersion }));

          const latestList = await api.getNvmList();
          currentNodeVersions = latestList.map(v => v.version);
          installed = findInstalledNodeVersion(currentNodeVersions, normalizedNvmVersion);
        } catch (installErr) {
          ElMessage.error(`${t('project.autoInstallFailed', { version: normalizedNvmVersion })}: ${String(installErr)}`);
          console.error('Failed to auto-install node version while importing project', installErr);
        }
      }

      if (!installed) {
        installed = findInstalledNodeVersion(currentNodeVersions, normalizedNvmVersion);
      }

      if (installed) {
        nodeVersion = installed;
      }
    } else if (info.nvmVersion) {
      ElMessage.warning(t('project.invalidNvmrc'));
      console.warn('Invalid .nvmrc version while importing project', info.nvmVersion);
    }

    const project: Project = {
      id: crypto.randomUUID(),
      name: info.name || path.split(/[\\/]/).pop() || 'Untitled',
      path: path,
      type: 'node',
      nodeVersion,
      packageManager: info.packageManager || 'npm',
      scripts: info.scripts
    };
    store.addProject(project);
    ElMessage.success(t('dashboard.addProject') + ' Success');
  } catch (e) {
    ElMessage.error('Failed to import: ' + e);
  } finally {
    loading.close();
  }
}

function compareVersions(v1: string, v2: string) {
  const p1 = v1.split('.').map(Number);
  const p2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] ?? 0;
    const n2 = p2[i] ?? 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

async function checkUpdate() {
  try {
    // Use /releases list instead of /releases/latest to avoid missing pre-release tagged versions
    const response = await fetch('https://api.github.com/repos/cuteyuchen/project-manager/releases?per_page=10');
    if (!response.ok) return;
    const releases = await response.json();
    // Find the highest-version non-draft release (regardless of pre-release flag)
    const validReleases = (releases as any[]).filter((r) => !r.draft && r.tag_name);
    if (validReleases.length === 0) return;
    const latestRelease = validReleases.reduce((best: any, cur: any) =>
      compareVersions(cur.tag_name.replace(/^v/, ''), best.tag_name.replace(/^v/, '')) > 0 ? cur : best
    );
    const latestTag: string = latestRelease.tag_name;
    const remoteVersion = latestTag.replace(/^v/, '');
    const localVersion = await api.getAppVersion();

    if (compareVersions(remoteVersion, localVersion) > 0) {
      ElMessageBox.confirm(
        h('div', null, [
          h('p', null, t('update.message', { version: latestTag })),
          h('div', { class: 'mt-2' }, [
            h('a', {
              class: 'text-blue-500 hover:text-blue-600 cursor-pointer underline',
              onClick: (e: Event) => {
                e.preventDefault();
                api.openUrl('https://github.com/cuteyuchen/project-manager/releases');
              }
            }, t('update.openDownloadPage'))
          ])
        ]),
        t('update.title'),
        {
          confirmButtonText: t('update.confirm'),
          cancelButtonText: t('update.cancel'),
          type: 'info',
        }
      ).then(async () => {
        showUpdateProgress.value = true;
        downloadProgress.value = 0;

        let unlisten: (() => void) | undefined;

        try {
          unlisten = await api.onDownloadProgress((percentage) => {
             downloadProgress.value = percentage;
          });

          const { os, arch } = await api.getPlatformInfo();
          const versionNoV = latestTag.replace(/^v/, '');
          let fileName = '';

          if (os === 'windows') {
            // Windows: project-manager_0.1.10_x64-setup.exe
            const archStr = arch === 'x86_64' ? 'x64' : arch;
            fileName = `project-manager_${versionNoV}_${archStr}-setup.exe`;
          } else if (os === 'macos') {
            // macOS: project-manager_0.1.10_x64.dmg or aarch64.dmg
            // Tauri bundle naming for mac usually uses target triple or just arch? 
            // Standard tauri bundle is {productName}_{version}_{arch}.dmg
            // x86_64 -> x64, aarch64 -> aarch64
            const archStr = arch === 'x86_64' ? 'x64' : arch;
            fileName = `project-manager_${versionNoV}_${archStr}.dmg`;
          } else if (os === 'linux') {
            // Linux: project-manager_0.1.10_amd64.AppImage
            // x86_64 -> amd64
            const archStr = arch === 'x86_64' ? 'amd64' : arch;
            fileName = `project-manager_${versionNoV}_${archStr}.AppImage`;
          } else {
             // Fallback or error? defaulting to windows x64 if unknown is risky.
             // But for now let's assume one of these 3.
             const archStr = arch === 'x86_64' ? 'x64' : arch;
             fileName = `project-manager_${versionNoV}_${archStr}-setup.exe`;
          }

          const downloadUrl = `https://github.com/cuteyuchen/project-manager/releases/download/${latestTag}/${fileName}`;
          await api.installUpdate(downloadUrl);
        } catch (error: any) {
          if (error && error.toString().includes('cancelled')) {
             ElMessage.info(t('update.cancelled') || 'Update cancelled');
          } else {
             ElMessage.error(t('update.error', { error }));
          }
          showUpdateProgress.value = false;
        } finally {
          if (unlisten) unlisten();
          // Don't hide progress immediately on success, let the app restart
          // But if it failed/cancelled, we hide it (handled in catch or here)
          // If successful, the app will close.
        }
      }).catch(() => { });
    }
  } catch (e) {
    console.error('Failed to check for updates:', e);
  }
}

function handleCancelUpdate() {
  api.cancelUpdate();
  showUpdateProgress.value = false;
}

function handleBackgroundUpdate() {
  showUpdateProgress.value = false;
}

onMounted(async () => {
  await loadData();
  loaded.value = true;
  
  // Auto refresh projects
  useProjectStore().refreshAll();

  // Auto refresh git status for the active project on startup
  const projectStore = useProjectStore();
  const gitStore = useGitStore();
  const activeProject = projectStore.projects.find(p => p.id === projectStore.activeProjectId);
  if (activeProject) {
    gitStore.checkGitRepo(activeProject.id, activeProject.path).then(isRepo => {
      if (isRepo) gitStore.refreshSummaryAndStatus(activeProject.id, activeProject.path);
    });
  }
  
  // Handle Startup Args / uTools/ZTools Plugin Enter
  if (isPlugin) {
    const pluginApi = (window as any).ztools || (window as any).utools;
    if (pluginApi) {
      pluginApi.onPluginEnter(({ code, type, payload }: any) => {
        if (code === 'import_project' && type === 'files' && payload.length > 0) {
          handleImportProject(payload[0].path);
        }
      });
    }

    // Web/uTools Drag and Drop
    let dragCounter = 0;
    
    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (e.dataTransfer && e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        isDragging.value = true;
      }
    });

    document.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    document.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter === 0) {
        isDragging.value = false;
      }
    });

    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging.value = false;
      dragCounter = 0;
      
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
           const file = files[i] as any;
           // In Electron/uTools, File object has a 'path' property
           if (file.path) {
             await handleImportProject(file.path);
           }
        }
      }
    });
  } else {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const args = await invoke<string[]>('get_startup_args');
      if (args && args.length > 1) {
        const potentialPath = args[1];
        if (!potentialPath.startsWith('-')) {
          handleImportProject(potentialPath);
        }
      }
    } catch (e) {
      console.error('Failed to get startup args:', e);
    }

    // Setup Drag and Drop Listeners
    try {
      const { listen } = await import('@tauri-apps/api/event');
      
      unlistenDragEnter = await listen('tauri://drag-enter', () => {
        isDragging.value = true;
      });
      
      unlistenDragLeave = await listen('tauri://drag-leave', () => {
        isDragging.value = false;
      });
      
      unlistenDragDrop = await listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
        isDragging.value = false;
        if (event.payload.paths && event.payload.paths.length > 0) {
           for (const path of event.payload.paths) {
             handleImportProject(path);
           }
        }
      });

      // 监听单实例事件
      unlistenSingleInstance = await listen<string>('single-instance-args', (event) => {
        const path = event.payload;
        if (path) {
          handleImportProject(path);
        }
      });
    } catch (e) {
      console.error('Failed to setup drag listeners', e);
    }
  }

  // Default to true if undefined (legacy support)
  if (!isPlugin && useSettingsStore().settings.autoUpdate !== false) {
    checkUpdate();
  }
});

onUnmounted(() => {
  if (unlistenDragEnter) unlistenDragEnter();
  if (unlistenDragLeave) unlistenDragLeave();
  if (unlistenDragDrop) unlistenDragDrop();
  if (unlistenSingleInstance) unlistenSingleInstance();
});

// Watch stores and save
const projectStore = useProjectStore();
const settingsStore = useSettingsStore();
const nodeStore = useNodeStore();

let saveTimer: any = null;
const triggerSave = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveData();
  }, 1000);
};

watch(() => projectStore.projects, triggerSave, { deep: true });
watch(() => settingsStore.settings, triggerSave, { deep: true });
watch(() => nodeStore.versions, triggerSave, { deep: true });
</script>

<template>
  <div class="h-screen w-screen flex flex-col bg-slate-50 dark:bg-[#0f172a] text-slate-900 dark:text-gray-100 font-sans overflow-hidden select-none transition-colors duration-200 antialiased">
    <TitleBar v-if="!isPlugin" />
    
    <div class="flex-1 flex overflow-hidden relative">
      <Sidebar @navigate="v => currentView = v" />
      <main class="flex-1 h-full overflow-hidden relative">
        <!-- Modern deep gradient background -->
        <div
          class="absolute inset-0 bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 dark:from-[#0f172a] dark:via-[#131c2e] dark:to-[#0f172a] opacity-100 pointer-events-none transition-colors duration-200" />
        <!-- Subtle accent glow -->
        <div
          class="absolute top-[-20%] right-[-10%] w-[400px] h-[400px] bg-blue-500/5 dark:bg-blue-500/8 rounded-full blur-[100px] pointer-events-none">
        </div>
        <div
          class="absolute bottom-[-20%] left-[-10%] w-[400px] h-[400px] bg-purple-500/5 dark:bg-purple-500/8 rounded-full blur-[100px] pointer-events-none">
        </div>

        <div class="relative h-full z-10">
          <Transition name="page-fade" mode="out-in">
          <KeepAlive>
            <Dashboard v-if="currentView === 'dashboard'" key="dashboard" />
            <Settings v-else-if="currentView === 'settings'" key="settings" />
            <NodeManager v-else-if="currentView === 'nodes'" key="nodes" />
          </KeepAlive>
          </Transition>
        </div>
        
        <!-- Drag Overlay -->
        <div v-if="isDragging" class="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center border-4 border-blue-500 border-dashed m-4 rounded-xl transition-all duration-300">
          <div class="text-center text-white">
             <div class="text-6xl mb-4 text-blue-400 flex justify-center">
               <div class="i-mdi-folder-upload" />
             </div>
             <h2 class="text-2xl font-bold">{{ t('dashboard.dropToImport') || 'Drop folder to import' }}</h2>
          </div>
        </div>
      </main>
    </div>

    <UpdateProgress 
      v-if="showUpdateProgress" 
      :percentage="downloadProgress"
      @cancel="handleCancelUpdate"
      @background="handleBackgroundUpdate"
    />
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

:root {
  font-family: 'IBM Plex Sans', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
}

html.dark {
  color-scheme: dark;
  --el-bg-color: #1e293b !important;
  --el-bg-color-overlay: #1e293b !important;
  --el-border-color: #334155 !important;
  --el-border-color-light: #334155 !important;
  --el-border-color-lighter: #334155 !important;
  --el-text-color-primary: #f1f5f9 !important;
  --el-text-color-regular: #cbd5e1 !important;
  --el-fill-color-blank: #0f172a !important;
}

html,
body,
#app {
  height: 100%;
  margin: 0;
  overflow: hidden;
  background-color: transparent;
}

/* Monospace font for all font-mono elements */
.font-mono, code, pre, kbd, samp {
  font-family: var(--font-mono);
}

/* Respect reduced motion preference */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Focus visible styles for all interactive elements */
button:focus-visible,
[role="button"]:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid rgba(59, 130, 246, 0.5);
  outline-offset: 1px;
  border-radius: 4px;
}

/* Ensure all buttons get cursor-pointer */
button, [role="button"] {
  cursor: pointer;
}

/* Custom Scrollbar */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

.dark ::-webkit-scrollbar-thumb {
  background: #334155;
}

.dark ::-webkit-scrollbar-thumb:hover {
  background: #475569;
}

/* Element Plus refinements */
.el-button {
  transition: all 0.2s ease-out !important;
}

.el-card {
  transition: box-shadow 0.2s ease-out, border-color 0.2s ease-out !important;
}

.el-input__wrapper {
  transition: box-shadow 0.2s ease-out !important;
}

/* Smoother tag transitions */
.el-tag {
  transition: all 0.15s ease-out !important;
}

/* Page transition (view switching) */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.page-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
