<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, h } from 'vue';
import { api } from './api';
import { ElMessageBox, ElMessage, ElLoading } from 'element-plus';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useI18n } from 'vue-i18n';
import Sidebar from './components/Sidebar.vue';
import Dashboard from './views/Dashboard.vue';
import Settings from './views/Settings.vue';
import NodeManager from './views/NodeManager.vue';
import PortManager from './views/PortManager.vue';
import CommitCalendar from './views/CommitCalendar.vue';
import TitleBar from './components/TitleBar.vue';
import UpdateProgress from './components/UpdateProgress.vue';
import {
  canOpenConfigDirectory,
  flushPendingSave,
  loadData,
  openConfigDirectory,
  persistenceRecovery,
  restoreConfigBackup,
  scheduleSaveData,
  subscribePersistenceEvents,
  type PersistenceEvent,
} from './utils/persistence';
import { useProjectStore } from './stores/project';
import { useSettingsStore } from './stores/settings';
import { useNodeStore } from './stores/node';
import { useGitStore } from './stores/git';
import { useUsageStore } from './stores/usage';
import { useRunHistoryStore } from './stores/runHistory';
import type { Project } from './types';
import { normalizeNodeVersion, projectNodeVersionHint } from './utils/nvm';
import { getRuntimesByVersion } from './utils/nodeRuntime';
import { buildJavaPresetCommands, ensureNodeInstallCommand, isWindowsPlatform } from './utils/projectCommands';
import ProjectQuickSearch from './components/ProjectQuickSearch.vue';
import {
  INITIAL_UPDATE_PROGRESS,
  reduceUpdateProgress,
  type UpdateProgressPhase,
} from './utils/updateProgress';
import {
  DEFAULT_QUICK_SEARCH_APP_SHORTCUT,
  DEFAULT_QUICK_SEARCH_GLOBAL_SHORTCUT,
  DEFAULT_SIDEBAR_MENU_SHORTCUTS,
  isShortcutEvent,
  normalizeShortcut,
} from './utils/shortcut';
import { useAppShortcuts } from './composables/useAppShortcuts.ts';
import { formatErrorDetails, getLatestCapturedError } from './utils/errorDetails';
import { createLifecycleGuard, flushBeforeLifecycle } from './utils/lifecycle';

const target = import.meta.env.VITE_TARGET;
const isPlugin = target === 'utools' || target === 'ztools';

const { t } = useI18n();
type AppView = 'dashboard' | 'settings' | 'nodes' | 'ports' | 'commitCalendar';
const currentView = ref<AppView>('dashboard');
const loaded = ref(false);
const isDragging = ref(false);
let unlistenDragEnter: UnlistenFn | null = null;
let unlistenDragLeave: UnlistenFn | null = null;
let unlistenDragDrop: UnlistenFn | null = null;
let unlistenSingleInstance: UnlistenFn | null = null;
let unlistenQuickSearchSelect: UnlistenFn | null = null;
let manualUpdateCheckListener: (() => void) | null = null;

const showUpdateProgress = ref(false);
const downloadProgress = ref(0);
const updateProgressIndeterminate = ref(false);
const updateProgressPhase = ref<UpdateProgressPhase>('downloading');
const processedImportInstallVersions = new Set<string>();
const closeBehaviorDialogVisible = ref(false);
const pluginQuickSearchVisible = ref(false);
const rememberCloseAction = ref(false);
let trayIcon: { close?: () => Promise<void> } | null = null;
let pendingCloseResolver: ((action: 'tray' | 'exit' | 'cancel') => void) | null = null;
let unlistenCloseRequested: UnlistenFn | null = null;
let unlistenNativeExitRequested: UnlistenFn | null = null;
let unlistenPersistenceEvents: (() => void) | null = null;
let persistenceErrorMessage: ReturnType<typeof ElMessage> | null = null;
let registeredQuickSearchGlobalShortcut = '';
let quickSearchShortcutRecording = false;
let quickSearchShortcutRecordingListener: ((event: Event) => void) | null = null;
let allowWindowClose = false;
let traySetupToken = 0;
const exitGuard = createLifecycleGuard();
let exiting = false;
let nativeExitRequestedBeforeLoad = false;
const persistenceReadOnly = ref(false);
const recoveryBusy = ref(false);
const configDirectoryAvailable = ref(false);
const lastPersistenceError = ref<Error | null>(null);


async function handleImportProject(path: string) {
  const store = useProjectStore();
  if (store.projects.some(p => p.path === path)) {
    ElMessage.warning(t('project.alreadyExists') || 'Project already exists');
    return;
  }

  const loading = ElLoading.service({
    lock: true,
    text: 'Scanning...',
    background: 'color-mix(in srgb, black 70%, transparent)',
  });

  try {
    const info = await api.scanProject(path);
    let nodeVersion = '';
    let projectRuntimeId = '';

    const hint = projectNodeVersionHint(info);
    const normalizedNvmVersion = normalizeNodeVersion(hint);
    if (normalizedNvmVersion) {
      let detectedRuntime = undefined as ReturnType<typeof getRuntimesByVersion>[number] | undefined;
      try {
        await nodeStore.loadRuntimes();
        detectedRuntime = getRuntimesByVersion(nodeStore.versions, normalizedNvmVersion)[0];
      } catch (runtimeError) {
        console.error('Failed to load node runtimes for import', runtimeError);
      }

      if (!detectedRuntime && !processedImportInstallVersions.has(normalizedNvmVersion) && nodeStore.managedSupported) {
        processedImportInstallVersions.add(normalizedNvmVersion);
        try {
          ElMessage.info(t('project.autoInstallStart', { version: normalizedNvmVersion }));
          await nodeStore.installManagedNode(normalizedNvmVersion);
          ElMessage.success(t('project.autoInstallSuccess', { version: normalizedNvmVersion }));
          detectedRuntime = getRuntimesByVersion(nodeStore.versions, normalizedNvmVersion)[0];
        } catch (installErr) {
          ElMessage.error(`${t('project.autoInstallFailed', { version: normalizedNvmVersion })}: ${String(installErr)}`);
          console.error('Failed to auto-install node version while importing project', installErr);
        }
      }

      if (detectedRuntime) {
        nodeVersion = detectedRuntime.version;
        projectRuntimeId = detectedRuntime.runtimeId || '';
      }
    } else if (hint) {
      ElMessage.warning(t('project.invalidNvmrc'));
      console.warn('Invalid Node version hint while importing project', hint);
    }

    const project: Project = {
      id: crypto.randomUUID(),
      name: info.name || path.split(/[\\/]/).pop() || 'Untitled',
      path: path,
      type: info.projectType === 'node' ? 'node' : (info.projectType === 'java' ? 'java' : 'other'),
    };

    if (info.projectType === 'node') {
      project.nodeVersion = nodeVersion;
      project.nodeRuntimeId = projectRuntimeId;
      project.packageManager = info.packageManager || 'npm';
      project.scripts = info.scripts;
    }
    if (info.projectType === 'java' && info.buildTool) {
      project.buildTool = info.buildTool;
      project.hasWrapper = !!info.hasWrapper;
      project.customCommands = buildJavaPresetCommands(
        info.buildTool,
        !!info.hasWrapper,
        isWindowsPlatform(),
        () => crypto.randomUUID(),
      );
    }

    store.addProject(ensureNodeInstallCommand(project, t('project.installDependencies')));
    ElMessage.success(t('dashboard.addProject') + ' Success');
  } catch (e) {
    ElMessage.error('Failed to import: ' + e);
  } finally {
    loading.close();
  }
}

/***********************快速搜索快捷键*********************/

async function openQuickSearch() {
  if (isPlugin) {
    pluginQuickSearchVisible.value = true;
    return;
  }

  try {
    await flushPendingSave();
    const [{ WebviewWindow }, { emitTo }] = await Promise.all([
      import('@tauri-apps/api/webviewWindow'),
      import('@tauri-apps/api/event'),
    ]);
    const quickSearchWindow = await WebviewWindow.getByLabel('quick-search');
    if (!quickSearchWindow) {
      throw new Error('Quick search window is unavailable');
    }

    await emitTo('quick-search', 'quick-search-open');
    await quickSearchWindow.center().catch(() => undefined);
    await quickSearchWindow.show();
    await quickSearchWindow.setFocus();
  } catch (error) {
    console.error('Failed to open quick search window:', error);
    ElMessage.error(`${t('common.error')}: ${String(error)}`);
  }
}

async function unregisterQuickSearchGlobalShortcut() {
  if (!registeredQuickSearchGlobalShortcut) return;
  const shortcut = registeredQuickSearchGlobalShortcut;
  registeredQuickSearchGlobalShortcut = '';
  try {
    const { unregister } = await import('@tauri-apps/plugin-global-shortcut');
    await unregister(shortcut);
  } catch (error) {
    console.error('Failed to unregister quick search global shortcut:', error);
  }
}

async function syncQuickSearchGlobalShortcut() {
  if (isPlugin) return;

  if (quickSearchShortcutRecording) {
    await unregisterQuickSearchGlobalShortcut();
    return;
  }

  const enabled = settingsStore.settings.quickSearchGlobalShortcutEnabled === true;
  const shortcut = normalizeShortcut(
    settingsStore.settings.quickSearchGlobalShortcut || DEFAULT_QUICK_SEARCH_GLOBAL_SHORTCUT,
  );

  if (!enabled || !shortcut) {
    await unregisterQuickSearchGlobalShortcut();
    return;
  }

  if (registeredQuickSearchGlobalShortcut === shortcut) return;

  await unregisterQuickSearchGlobalShortcut();
  try {
    const { register } = await import('@tauri-apps/plugin-global-shortcut');
    await register(shortcut, (event) => {
      if (event.state === 'Pressed') {
        void openQuickSearch();
      }
    });
    registeredQuickSearchGlobalShortcut = shortcut;
  } catch (error) {
    console.error('Failed to register quick search global shortcut:', error);
    ElMessage.warning(t('settings.quickSearchGlobalShortcutRegisterFailed'));
  }
}

/** 应用内键盘事件处理：按设置项打开快速搜索 */
function handleGlobalKeydown(event: KeyboardEvent) {
  if (quickSearchShortcutRecording) return;
  const shortcut = settingsStore.settings.quickSearchAppShortcut || DEFAULT_QUICK_SEARCH_APP_SHORTCUT;
  if (isShortcutEvent(event, shortcut)) {
    event.preventDefault();
    void openQuickSearch();
  }
}

async function activateQuickSearchSelection(projectId: string) {
  const store = useProjectStore();
  // 请求 Dashboard 打开该项目所属根项目的工作区（Dashboard 挂载或 watch 时消费）
  store.pendingWorkspaceProjectId = projectId;
  store.pendingWorkspaceRootId = store.getRootProjectId(projectId);
  currentView.value = 'dashboard';
  if (!isPlugin) {
    await showMainWindow();
  }
}

type ManualUpdateResult = {
  status: 'available' | 'latest' | 'error';
  version?: string;
  error?: string;
};

function dispatchManualUpdateResult(detail: ManualUpdateResult) {
  window.dispatchEvent(new CustomEvent<ManualUpdateResult>('manual-check-update-result', { detail }));
}

function displayUpdateVersion(version: string) {
  return version.startsWith('v') ? version : `v${version}`;
}

function resetUpdateProgress() {
  downloadProgress.value = INITIAL_UPDATE_PROGRESS.percentage;
  updateProgressIndeterminate.value = INITIAL_UPDATE_PROGRESS.indeterminate;
  updateProgressPhase.value = INITIAL_UPDATE_PROGRESS.phase;
}

async function waitForUpdateSave() {
  const result = await flushBeforeLifecycle(
    flushPendingSave,
    () => runHistoryStore.flushStrict(),
    async (error) => {
      try {
        await ElMessageBox.confirm(
          t('update.saveFailedMessage', { error: String(error) }),
          t('update.saveFailedTitle'),
          {
            type: 'error',
            confirmButtonText: t('update.retrySave'),
            cancelButtonText: t('update.cancel'),
            closeOnClickModal: false,
          },
        );
        return 'retry';
      } catch {
        return 'cancel';
      }
    },
  );
  return result === 'saved';
}

async function resolveUpdateFailure(error: unknown): Promise<'retry' | 'download' | 'close'> {
  try {
    await ElMessageBox.confirm(
      h('div', null, [
        h('p', null, t('update.error', { error: String(error) })),
        h('p', { class: 'mt-2' }, t('update.failureHint')),
      ]),
      t('update.failureTitle'),
      {
        type: 'error',
        confirmButtonText: t('update.retry'),
        cancelButtonText: t('update.openDownloadPage'),
        distinguishCancelAndClose: true,
        closeOnClickModal: false,
      },
    );
    return 'retry';
  } catch (action) {
    return action === 'cancel' ? 'download' : 'close';
  }
}

async function installDesktopUpdate(update: Update) {
  while (true) {
    resetUpdateProgress();
    showUpdateProgress.value = true;
    let progressState = INITIAL_UPDATE_PROGRESS;

    try {
      await update.download((event) => {
        progressState = reduceUpdateProgress(progressState, event);
        downloadProgress.value = progressState.percentage;
        updateProgressIndeterminate.value = progressState.indeterminate;
        updateProgressPhase.value = progressState.phase;
      });

      if (!await waitForUpdateSave()) {
        showUpdateProgress.value = false;
        await update.close();
        return;
      }

      updateProgressPhase.value = 'installing';
      await update.install();
      await relaunch();
      return;
    } catch (error) {
      showUpdateProgress.value = false;
      const action = await resolveUpdateFailure(error);
      if (action === 'retry') continue;
      if (action === 'download') {
        await api.openUrl('https://github.com/cuteyuchen/project-manager/releases');
      }
      await update.close();
      return;
    }
  }
}

async function checkUpdate(manual = false) {
  if (isPlugin) return;

  let update: Update | null = null;
  try {
    update = await check({ timeout: 15_000 });
    if (!update) {
      if (manual) dispatchManualUpdateResult({ status: 'latest' });
      return;
    }

    const version = displayUpdateVersion(update.version);
    if (manual) dispatchManualUpdateResult({ status: 'available', version });

    try {
      await ElMessageBox.confirm(
        h('div', null, [
          h('p', null, t('update.message', { version })),
          h('div', { class: 'mt-2' }, [
            h('a', {
              class: 'text-blue-500 hover:text-blue-600 cursor-pointer underline',
              onClick: (event: Event) => {
                event.preventDefault();
                void api.openUrl('https://github.com/cuteyuchen/project-manager/releases');
              },
            }, t('update.openDownloadPage')),
          ]),
        ]),
        t('update.title'),
        {
          confirmButtonText: t('update.confirm'),
          cancelButtonText: t('update.cancel'),
          type: 'info',
        },
      );
    } catch {
      await update.close();
      update = null;
      return;
    }

    await installDesktopUpdate(update);
    update = null;
  } catch (error) {
    console.error('Failed to check for updates:', error);
    if (manual) {
      dispatchManualUpdateResult({
        status: 'error',
        error: String(error),
      });
    }
  } finally {
    if (update) await update.close().catch(() => undefined);
  }
}

function handleBackgroundUpdate() {
  showUpdateProgress.value = false;
}

function getCloseAction() {
  if (isPlugin) return 'exit';
  if (settingsStore.settings.trayEnabled === false) return 'exit';
  return settingsStore.settings.closeAction || 'ask';
}

async function showMainWindow() {
  useGitStore().setColdStorage(false);
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const currentWindow = getCurrentWindow();
  await currentWindow.show();
  await currentWindow.unminimize().catch(() => undefined);
  await currentWindow.setFocus().catch(() => undefined);
}

async function hideToTray() {
  useGitStore().setColdStorage(true);
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
}

async function destroyTray() {
  if (!trayIcon) return;
  await trayIcon.close?.().catch(() => undefined);
  trayIcon = null;
}

function handlePersistenceEvent(event: PersistenceEvent) {
  if (event.type === 'recovered') {
    if (event.operation === 'load') persistenceReadOnly.value = false;
    lastPersistenceError.value = null;
    persistenceErrorMessage?.close();
    persistenceErrorMessage = null;
    return;
  }

  if (event.operation === 'load') {
    persistenceReadOnly.value = true;
    lastPersistenceError.value = event.error;
  }
  persistenceErrorMessage?.close();
  persistenceErrorMessage = ElMessage({
    type: 'error',
    duration: 0,
    showClose: true,
    message: event.operation === 'load'
      ? t('persistence.loadFailed', { error: event.error.message })
      : t('persistence.saveFailed', { error: event.error.message }),
  });
}

async function resolveExitSaveFailure(error: unknown): Promise<'retry' | 'continue' | 'cancel'> {
  try {
    await ElMessageBox.confirm(
      t('persistence.exitSaveFailedMessage', { error: String(error) }),
      t('persistence.exitSaveFailedTitle'),
      {
        type: 'error',
        confirmButtonText: t('persistence.retrySave'),
        cancelButtonText: t('persistence.exitAnyway'),
        distinguishCancelAndClose: true,
        closeOnClickModal: false,
      },
    );
    return 'retry';
  } catch (action) {
    return action === 'cancel' ? 'continue' : 'cancel';
  }
}

async function exitApp() {
  if (!exitGuard.tryEnter()) return;
  exiting = true;

  try {
    const flushResult = await flushBeforeLifecycle(
      flushPendingSave,
      () => runHistoryStore.flushStrict(),
      resolveExitSaveFailure,
    );
    if (flushResult === 'cancel') return;

    useGitStore().setColdStorage(true);
    await destroyTray();
    await api.exitApp();
  } finally {
    exiting = false;
    exitGuard.leave();
  }
}

function promptCloseAction(): Promise<'tray' | 'exit' | 'cancel'> {
  rememberCloseAction.value = false;
  closeBehaviorDialogVisible.value = true;
  return new Promise((resolve) => {
    pendingCloseResolver = resolve;
  });
}

function resolveCloseDialog(action: 'tray' | 'exit' | 'cancel') {
  closeBehaviorDialogVisible.value = false;
  if (action !== 'cancel' && rememberCloseAction.value) {
    settingsStore.settings.closeAction = action;
  }
  if (pendingCloseResolver) {
    pendingCloseResolver(action);
    pendingCloseResolver = null;
  }
}

async function setupTray() {
  if (isPlugin || !loaded.value) return;

  const currentToken = ++traySetupToken;
  await destroyTray();
  if (currentToken !== traySetupToken) return;

  if (settingsStore.settings.trayEnabled === false) {
    return;
  }

  const [{ TrayIcon }, { Menu }, { MenuItem }, { defaultWindowIcon }] = await Promise.all([
    import('@tauri-apps/api/tray'),
    import('@tauri-apps/api/menu'),
    import('@tauri-apps/api/menu'),
    import('@tauri-apps/api/app'),
  ]);

  const showItem = await MenuItem.new({
    id: 'tray-show',
    text: t('settings.trayShowApp'),
    action: () => { void showMainWindow(); },
  });
  const hideItem = await MenuItem.new({
    id: 'tray-hide',
    text: t('settings.trayHideApp'),
    action: () => { void hideToTray(); },
  });
  const exitItem = await MenuItem.new({
    id: 'tray-exit',
    text: t('settings.trayExitApp'),
    action: () => { void exitApp(); },
  });
  const menu = await Menu.new({
    items: [showItem, hideItem, { item: 'Separator' }, exitItem],
  });
  const icon = await defaultWindowIcon();

  const nextTrayIcon = await TrayIcon.new({
    id: 'project-manager-tray',
    tooltip: t('common.title'),
    menu,
    showMenuOnLeftClick: false,
    icon: icon || undefined,
    action: (event) => {
      if (
        (event.type === 'Click' && event.button === 'Left' && event.buttonState === 'Up')
        || event.type === 'DoubleClick'
      ) {
        void showMainWindow();
      }
    },
  });

  if (currentToken !== traySetupToken) {
    await nextTrayIcon.close?.().catch(() => undefined);
    return;
  }

  trayIcon = nextTrayIcon;
}

async function setupCloseRequestedHandler() {
  if (isPlugin || !loaded.value) return;

  if (unlistenCloseRequested) {
    unlistenCloseRequested();
    unlistenCloseRequested = null;
  }

  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  unlistenCloseRequested = await getCurrentWindow().onCloseRequested(async (event) => {
    if (allowWindowClose) return;
    if (exiting) {
      event.preventDefault();
      return;
    }

    const closeAction = getCloseAction();
    if (closeAction === 'exit') {
      event.preventDefault();
      await exitApp();
      return;
    }

    event.preventDefault();
    const resolvedAction = closeAction === 'ask' ? await promptCloseAction() : closeAction;

    if (resolvedAction === 'tray') {
      await hideToTray();
      return;
    }

    if (resolvedAction === 'exit') {
      await exitApp();
    }
  });
}

onMounted(async () => {
  unlistenPersistenceEvents = subscribePersistenceEvents(handlePersistenceEvent);
  if (!isPlugin) {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      unlistenNativeExitRequested = await listen('native-exit-requested', () => {
        if (!loaded.value) {
          nativeExitRequestedBeforeLoad = true;
          return;
        }
        void exitApp();
      });
    } catch (error) {
      console.error('Failed to setup native exit listener', error);
    }
  }
  const loadResult = await loadData();
  persistenceReadOnly.value = loadResult.state === 'read-only';
  if (loadResult.state === 'read-only') {
    lastPersistenceError.value = loadResult.error;
    configDirectoryAvailable.value = await canOpenConfigDirectory().catch(() => false);
  }
  await runHistoryStore.load();
  await nodeStore.loadRuntimes();
  loaded.value = true;
  if (nativeExitRequestedBeforeLoad) {
    nativeExitRequestedBeforeLoad = false;
    void exitApp();
  }

  const handleShortcutRecording = (event: Event) => {
    quickSearchShortcutRecording = (event as CustomEvent<boolean>).detail === true;
    if (!isPlugin) {
      if (quickSearchShortcutRecording) {
        void unregisterQuickSearchGlobalShortcut();
      } else {
        void syncQuickSearchGlobalShortcut();
      }
    }
  };
  quickSearchShortcutRecordingListener = handleShortcutRecording;
  window.addEventListener('quick-search-shortcut-recording', handleShortcutRecording);

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

      unlistenQuickSearchSelect = await listen<{ projectId: string; scriptName?: string }>('quick-search-selected', (event) => {
        if (event.payload.projectId) {
          void activateQuickSearchSelection(event.payload.projectId);
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

  // Restore auto-launch state after reinstall
  if (!isPlugin) {
    try {
      const settingsStore = useSettingsStore();
      if (settingsStore.settings.autoLaunch === true) {
        const autostart = await import('@tauri-apps/plugin-autostart');
        const isEnabled = await autostart.isEnabled();
        if (!isEnabled) {
          await autostart.enable();
        }
      }
    } catch (e) {
      console.error('Failed to restore auto-launch state:', e);
    }
  }

  // Listen for manual update check from Settings page
  const handleManualUpdateCheck = () => checkUpdate(true);
  manualUpdateCheckListener = () => window.removeEventListener('manual-check-update', handleManualUpdateCheck);
  window.addEventListener('manual-check-update', handleManualUpdateCheck);

  document.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  if (unlistenDragEnter) unlistenDragEnter();
  if (unlistenDragLeave) unlistenDragLeave();
  if (unlistenDragDrop) unlistenDragDrop();
  if (unlistenSingleInstance) unlistenSingleInstance();
  if (unlistenQuickSearchSelect) unlistenQuickSearchSelect();
  if (manualUpdateCheckListener) manualUpdateCheckListener();
  if (quickSearchShortcutRecordingListener) {
    window.removeEventListener('quick-search-shortcut-recording', quickSearchShortcutRecordingListener);
  }
  if (unlistenCloseRequested) unlistenCloseRequested();
  if (unlistenNativeExitRequested) unlistenNativeExitRequested();
  if (unlistenPersistenceEvents) unlistenPersistenceEvents();
  persistenceErrorMessage?.close();
  document.removeEventListener('keydown', handleGlobalKeydown);
  void unregisterQuickSearchGlobalShortcut();
  void destroyTray();
  void flushPendingSave().catch(() => undefined);
  void runHistoryStore.flush();
});

async function handleRestoreBackup(): Promise<void> {
  if (recoveryBusy.value || !persistenceRecovery.value.backupValid) return;
  try {
    await ElMessageBox.confirm(
      t('persistence.restoreBackupMessage'),
      t('persistence.restoreBackupTitle'),
      {
        type: 'warning',
        confirmButtonText: t('persistence.restoreBackup'),
        cancelButtonText: t('common.cancel'),
        closeOnClickModal: false,
      },
    );
  } catch {
    return;
  }

  recoveryBusy.value = true;
  try {
    const result = await restoreConfigBackup();
    if (result.state === 'ready') {
      persistenceReadOnly.value = false;
      lastPersistenceError.value = null;
      ElMessage.success(t('persistence.restoreSuccess'));
    } else {
      persistenceReadOnly.value = true;
      lastPersistenceError.value = result.error;
      ElMessage.error(t('persistence.restoreFailed', { error: result.error.message }));
    }
  } finally {
    recoveryBusy.value = false;
  }
}

async function handleOpenConfigDirectory(): Promise<void> {
  try {
    await openConfigDirectory();
  } catch (error) {
    ElMessage.error(t('persistence.openDirectoryFailed', { error: String(error) }));
  }
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard is unavailable');
}

async function handleCopyErrorDetails(): Promise<void> {
  const captured = getLatestCapturedError();
  const error = lastPersistenceError.value || captured?.error || new Error('Unknown application error');
  let appVersion = 'unknown';
  let platform = navigator.platform || 'unknown';
  try {
    appVersion = await api.getAppVersion();
  } catch {
    // Keep the local fallback when the host is unavailable during startup.
  }
  try {
    const platformInfo = await api.getPlatformInfo();
    platform = `${platformInfo.os}/${platformInfo.arch}`;
  } catch {
    // Keep the browser platform fallback.
  }

  try {
    await copyText(formatErrorDetails(error, {
      appVersion,
      target: target || 'unknown',
      platform,
      currentView: currentView.value,
      timestamp: captured?.timestamp,
    }));
    ElMessage.success(t('persistence.copyErrorDetailsSuccess'));
  } catch (copyError) {
    ElMessage.error(t('persistence.copyErrorDetailsFailed', { error: String(copyError) }));
  }
}

// Watch stores and save
const projectStore = useProjectStore();
const settingsStore = useSettingsStore();
const appBackgroundStyle = computed(() => ({
  backgroundImage: settingsStore.backgroundImageDataUrl
    ? `url("${settingsStore.backgroundImageDataUrl}")`
    : 'none',
  opacity: String(settingsStore.backgroundImagePreviewOpacity),
}));
const nodeStore = useNodeStore();
const usageStore = useUsageStore();
const runHistoryStore = useRunHistoryStore();

watch(() => runHistoryStore.lastError, (message) => {
  if (message) ElMessage.warning({ message, duration: 4500 });
});

/***********************左侧菜单快捷键*********************/
/** 与 Sidebar.vue 的视觉顺序保持一致：项目、Node、端口、提交日历、设置。 */
const SIDEBAR_MENU_VIEWS: AppView[] = ['dashboard', 'nodes', 'ports', 'commitCalendar', 'settings'];

useAppShortcuts(SIDEBAR_MENU_VIEWS.map((view, index) => ({
  keys: () => settingsStore.settings.sidebarMenuShortcuts?.[index]
    || DEFAULT_SIDEBAR_MENU_SHORTCUTS[index],
  enabled: () => loaded.value && !quickSearchShortcutRecording,
  handler: () => {
    currentView.value = view;
  },
})));

const triggerSave = () => {
  scheduleSaveData();
};

watch(() => projectStore.projects, triggerSave, { deep: true });
watch(() => projectStore.projectGroups, triggerSave, { deep: true });
watch(() => settingsStore.settings, triggerSave, { deep: true });
watch(() => nodeStore.versions, triggerSave, { deep: true });
watch(() => nodeStore.appDefault, triggerSave, { deep: true });
watch(() => usageStore.usageData, triggerSave, { deep: true });

watch(
  () => [loaded.value, settingsStore.settings.trayEnabled, settingsStore.settings.locale],
  async ([isLoaded]) => {
    if (!isLoaded || isPlugin) return;
    await setupTray();
  }
);

watch(
  () => [loaded.value, settingsStore.settings.trayEnabled, settingsStore.settings.closeAction],
  async ([isLoaded]) => {
    if (!isLoaded || isPlugin) return;
    await setupCloseRequestedHandler();
  }
);

watch(
  () => [
    loaded.value,
    settingsStore.settings.quickSearchGlobalShortcutEnabled,
    settingsStore.settings.quickSearchGlobalShortcut,
  ],
  async ([isLoaded]) => {
    if (!isLoaded || isPlugin) return;
    await syncQuickSearchGlobalShortcut();
  }
);
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell-with-titlebar': !isPlugin }">
    <div class="app-background-layer" :style="appBackgroundStyle" aria-hidden="true" />
    <TitleBar v-if="!isPlugin" />

    <section
      v-if="persistenceReadOnly"
      class="mx-4 mt-3 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
      role="alert"
    >
      <p class="font-semibold">{{ t('persistence.corruptedMessage') }}</p>
      <p v-if="persistenceRecovery.backupAvailable && !persistenceRecovery.backupValid" class="mt-1">
        {{ t('persistence.backupInvalid') }}
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <el-button
          v-if="persistenceRecovery.backupAvailable && persistenceRecovery.backupValid"
          type="danger"
          :loading="recoveryBusy"
          @click="handleRestoreBackup"
        >
          {{ t('persistence.restoreBackup') }}
        </el-button>
        <el-button v-if="configDirectoryAvailable" @click="handleOpenConfigDirectory">
          {{ t('persistence.openDataDirectory') }}
        </el-button>
        <el-button @click="handleCopyErrorDetails">
          {{ t('persistence.copyErrorDetails') }}
        </el-button>
      </div>
    </section>

    <div class="app-layout">
      <Sidebar :active="currentView" @navigate="v => currentView = v" />
      <main class="app-main">
        <div class="app-view-stack">
          <Transition name="page-fade">
          <KeepAlive>
            <Dashboard v-if="currentView === 'dashboard'" key="dashboard" />
            <CommitCalendar v-else-if="currentView === 'commitCalendar'" key="commitCalendar" />
            <Settings v-else-if="currentView === 'settings'" key="settings" />
            <NodeManager v-else-if="currentView === 'nodes'" key="nodes" @navigate-project="activateQuickSearchSelection" />
            <PortManager v-else-if="currentView === 'ports'" key="ports" />
          </KeepAlive>
          </Transition>
        </div>

        <!-- Drag Overlay -->
        <div v-if="isDragging" class="app-drag-overlay">
          <div class="text-center">
             <div class="text-6xl mb-4 text-blue-500 dark:text-blue-300 flex justify-center">
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
      :indeterminate="updateProgressIndeterminate"
      :phase="updateProgressPhase"
      @background="handleBackgroundUpdate"
    />

    <ProjectQuickSearch
      v-if="isPlugin && pluginQuickSearchVisible"
      @close="pluginQuickSearchVisible = false"
      @select="projectId => {
        pluginQuickSearchVisible = false;
        void activateQuickSearchSelection(projectId);
      }"
      @select-script="projectId => {
        pluginQuickSearchVisible = false;
        void activateQuickSearchSelection(projectId);
      }"
    />

    <el-dialog
      v-if="!isPlugin"
      v-model="closeBehaviorDialogVisible"
      :title="t('settings.closeActionTitle')"
      width="420px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      append-to-body
      align-center
      class="app-centered-dialog"
    >
      <div class="space-y-3 text-sm text-slate-600 dark:text-slate-300">
        <p>{{ t('settings.closeActionPrompt') }}</p>
        <el-checkbox v-model="rememberCloseAction">
          {{ t('settings.rememberCloseAction') }}
        </el-checkbox>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="resolveCloseDialog('cancel')">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" plain @click="resolveCloseDialog('tray')">
            {{ t('settings.closeActionOptions.tray') }}
          </el-button>
          <el-button type="danger" @click="resolveCloseDialog('exit')">
            {{ t('settings.closeActionOptions.exit') }}
          </el-button>
        </div>
      </template>
    </el-dialog>

  </div>
</template>
