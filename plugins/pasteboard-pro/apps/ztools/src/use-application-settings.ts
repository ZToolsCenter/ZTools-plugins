import { computed, ref, type Ref } from "vue";
import type { PasteStackAction } from "@pasteboard-pro/core";
import type { SaveSyncConfigurationInput } from "../preload/sync-config";
import { defaultPrivacySettings, type PrivacySettings } from "../preload/privacy";
import { defaultSyncSettings, type SyncSettings } from "../preload/sync-store";
import { defaultWindowPreferences, type WindowPreferences } from "../preload/window-preferences";
import { useApplicationPresentation } from "./use-application-presentation";
import type { PasteboardState } from "./state";
import type { ApplicationWindowContext } from "./application-window-context";

export function useApplicationSettings(
  context: ApplicationWindowContext,
  state: PasteboardState,
  status: Ref<string>,
  paused: Ref<boolean>,
  updatePasteStack: (action: PasteStackAction) => Promise<void>,
) {
  const { panelMode } = context;
  const syncSettings = ref<SyncSettings>(structuredClone(defaultSyncSettings));
  const privacySettings = ref<PrivacySettings>(structuredClone(defaultPrivacySettings));
  const windowPreferences = ref<WindowPreferences>(structuredClone(defaultWindowPreferences));
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  const prefersDark = ref(colorScheme.matches);
  const { themeStyle } = useApplicationPresentation(windowPreferences, prefersDark);
  const hasImageBackground = computed(
    () => windowPreferences.value.theme.background.type === "image",
  );
  const settingsOpen = ref(false);
  const settingsSaving = ref(false);
  const settingsSaveError = ref<string>();
  const settingsInitialTab = ref<SettingsTab>("general");

  type SettingsTab = "general" | "appearance" | "privacy" | "sync";

  async function loadSettings(tab: SettingsTab): Promise<void> {
    settingsSaveError.value = undefined;
    const [privacy, preferences, sync] = await Promise.all([
      window.pasteboardPro?.getPrivacySettings(),
      window.pasteboardPro?.getWindowPreferences(),
      window.pasteboardPro?.getSyncSettings(),
    ]);
    privacySettings.value = privacy ?? structuredClone(defaultPrivacySettings);
    windowPreferences.value = preferences ?? structuredClone(defaultWindowPreferences);
    syncSettings.value = sync ?? structuredClone(defaultSyncSettings);
    settingsInitialTab.value = tab;
    settingsOpen.value = true;
  }

  async function openSettings(tab: SettingsTab): Promise<void> {
    if (panelMode === undefined && window.pasteboardPro !== undefined) {
      window.pasteboardPro.openPanel(tab === "sync" ? "sync" : "privacy", { tab });
      return;
    }
    await loadSettings(tab);
  }

  async function retrySync(): Promise<void> {
    status.value = "正在重新同步…";
    const settings = await window.pasteboardPro?.retrySync();
    if (settings !== undefined) syncSettings.value = settings;
    status.value = settings?.status.state === "success" ? "同步完成" : "同步仍需处理";
  }

  function openPrivacySettings(): void {
    void openSettings("general");
  }

  async function saveSettings(
    settings: PrivacySettings,
    preferences: WindowPreferences,
    syncInput: SaveSyncConfigurationInput,
  ): Promise<void> {
    settingsSaving.value = true;
    settingsSaveError.value = undefined;
    let savedSuccessfully = false;
    try {
      const currentSync = syncSettings.value;
      const syncChanged =
        syncInput.enabled !== currentSync.enabled ||
        syncInput.baseUrl.trim() !== currentSync.baseUrl ||
        syncInput.username.trim() !== currentSync.username ||
        syncInput.intervalMinutes !== currentSync.intervalMinutes ||
        syncInput.webdavPassword !== undefined ||
        syncInput.syncPassword !== undefined;
      const saved = await window.pasteboardPro?.savePrivacySettings(settings);
      const [savedPreferences, savedSync] = await Promise.all([
        window.pasteboardPro?.saveWindowPreferences(preferences),
        syncChanged
          ? window.pasteboardPro?.saveSyncSettings(syncInput)
          : Promise.resolve(undefined),
      ]);
      privacySettings.value = saved ?? settings;
      windowPreferences.value = savedPreferences ?? preferences;
      if (savedSync !== undefined) syncSettings.value = savedSync;
      if (
        windowPreferences.value.multiPasteMode === "batch" &&
        state.pasteStack.itemIds.length > 0
      ) {
        await updatePasteStack({ type: "clear" });
      }
      paused.value = privacySettings.value.pause.paused;
      status.value = "设置已保存";
      savedSuccessfully = true;
    } catch (error) {
      settingsSaveError.value = error instanceof Error ? error.message : "设置保存失败";
      status.value = settingsSaveError.value;
    } finally {
      settingsSaving.value = false;
    }
    if (savedSuccessfully) closeSettings();
  }

  function closeSettings(): void {
    if (settingsSaving.value) return;
    if (panelMode === "privacy" || panelMode === "sync") {
      window.close();
      return;
    }
    settingsOpen.value = false;
  }


  return {
    syncSettings, privacySettings, windowPreferences, colorScheme, prefersDark, themeStyle,
    hasImageBackground, settingsOpen, settingsSaving, settingsSaveError, settingsInitialTab,
    loadSettings, openSettings, openPrivacySettings, saveSettings, retrySync, closeSettings,
  };
}
export type ApplicationSettings = ReturnType<typeof useApplicationSettings>;
