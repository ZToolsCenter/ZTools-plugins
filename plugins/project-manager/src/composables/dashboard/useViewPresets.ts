import { ref, computed } from 'vue';
import type { Ref } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import type { ProjectViewPreset, ProjectQuickFilter } from '../../types';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';

/**
 * 保存视图 composable：把当前搜索/快捷筛选/分组/标签/排序状态打包命名后保存，
 * 点击 preset chips 可一键恢复筛选条件。
 */
export function useViewPresets(options: {
  searchQuery: Ref<string>;
  activeQuickFilter: Ref<ProjectQuickFilter>;
  selectedGroupId: Ref<string>;
  selectedTags: Ref<string[]>;
  sortMode: Ref<'default' | 'smart'>;
}) {
  const settingsStore = useSettingsStore();
  const { t } = useI18n();

  /** 所有保存视图 */
  const presets = computed<ProjectViewPreset[]>(
    () => settingsStore.settings.projectViewPresets ?? []
  );

  /** 当前激活的视图 id */
  const activePresetId = ref<string | null>(null);

  /** 保存当前筛选状态为命名视图 */
  function saveCurrentView(name: string): ProjectViewPreset {
    const preset: ProjectViewPreset = {
      id: crypto.randomUUID(),
      name,
      searchQuery: options.searchQuery.value,
      quickFilter: options.activeQuickFilter.value,
      groupId: options.selectedGroupId.value || null,
      tags: [...options.selectedTags.value],
      sortMode: options.sortMode.value,
      createdAt: new Date().toISOString(),
    };
    if (!settingsStore.settings.projectViewPresets) {
      settingsStore.settings.projectViewPresets = [];
    }
    settingsStore.settings.projectViewPresets.push(preset);
    activePresetId.value = preset.id;
    ElMessage.success(t('dashboard.viewSaved', { name }));
    return preset;
  }

  /** 应用某个视图：回填筛选条件 */
  function applyPreset(preset: ProjectViewPreset) {
    options.searchQuery.value = preset.searchQuery;
    options.activeQuickFilter.value = preset.quickFilter;
    options.selectedGroupId.value = preset.groupId ?? '';
    options.selectedTags.value = [...preset.tags];
    settingsStore.settings.sortMode = preset.sortMode;
    activePresetId.value = preset.id;
  }

  /** 删除某个视图 */
  function deletePreset(id: string) {
    if (!settingsStore.settings.projectViewPresets) return;
    settingsStore.settings.projectViewPresets = settingsStore.settings.projectViewPresets.filter(
      (p) => p.id !== id
    );
    if (activePresetId.value === id) {
      activePresetId.value = null;
    }
  }

  /** 检测当前筛选状态是否与某个 preset 一致 */
  function isPresetActive(preset: ProjectViewPreset): boolean {
    return (
      options.searchQuery.value === preset.searchQuery &&
      options.activeQuickFilter.value === preset.quickFilter &&
      (options.selectedGroupId.value || null) === preset.groupId &&
      options.selectedTags.value.length === preset.tags.length &&
      options.selectedTags.value.every((tag) => preset.tags.includes(tag)) &&
      options.sortMode.value === preset.sortMode
    );
  }

  /** 自动检测活跃 preset（当筛选条件变化时调用） */
  function detectActivePreset() {
    const matched = presets.value.find((p) => isPresetActive(p));
    activePresetId.value = matched?.id ?? null;
  }

  return {
    presets,
    activePresetId,
    saveCurrentView,
    applyPreset,
    deletePreset,
    isPresetActive,
    detectActivePreset,
  };
}
