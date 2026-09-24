import { computed, shallowRef } from "vue";
import {
  DEFAULT_CATEGORY_ORDER,
  type FinderCategory,
  type FinderSortMode,
  normalizeCategoryOrder,
} from "../core/finderLogic";

interface FinderPreferences {
  previewEnabled: boolean;
  sortMode: FinderSortMode;
  matchPathEnabled: boolean;
  resultListWidth: number;
  sidebarWidth: number;
  categoryEnabled: Record<string, boolean>;
  categoryOrder: string[];
}

const PREFERENCES_STORAGE_KEY = "preferences";
const CUSTOM_CATEGORIES_STORAGE_KEY = "customCategories";

const DEFAULT_PREFERENCES: FinderPreferences = {
  previewEnabled: false,
  sortMode: "modified-desc",
  matchPathEnabled: true,
  resultListWidth: 315,
  sidebarWidth: 64,
  categoryEnabled: {},
  categoryOrder: [...DEFAULT_CATEGORY_ORDER],
};

const preferences = shallowRef<FinderPreferences>({ ...DEFAULT_PREFERENCES });
const customCategories = shallowRef<FinderCategory[]>([]);

const previewEnabled = computed({
  get: () => preferences.value.previewEnabled,
  set: setPreviewEnabled,
});
const sortMode = computed({
  get: () => preferences.value.sortMode,
  set: setSortMode,
});
const matchPathEnabled = computed({
  get: () => preferences.value.matchPathEnabled,
  set: setMatchPathEnabled,
});
const resultListWidth = computed({
  get: () => preferences.value.resultListWidth,
  set: setResultListWidth,
});
const sidebarWidth = computed({
  get: () => preferences.value.sidebarWidth,
  set: setSidebarWidth,
});
const categoryOrder = computed(() => preferences.value.categoryOrder);

let loaded = false;

export function usePersistStorage() {
  return {
    loadPersistStorage,
    previewEnabled,
    sortMode,
    matchPathEnabled,
    resultListWidth,
    setResultListWidth,
    sidebarWidth,
    setSidebarWidth,
    categoryOrder,
    setCategoryOrder,
    resetCategoryOrder,
    customCategories,
    addCustomCategory,
    updateCustomCategory,
    removeCustomCategory,
    isCategoryEnabled,
    setCategoryEnabled,
  };
}

function loadPersistStorage() {
  if (loaded) return;

  loadPreferences();
  loadCustomCategories();
  loaded = true;
}

function loadPreferences() {
  try {
    const stored =
      window.ztools.dbStorage.getItem<Partial<FinderPreferences>>(PREFERENCES_STORAGE_KEY);
    if (!stored) {
      preferences.value = { ...DEFAULT_PREFERENCES };
      savePreferences();
      return;
    }

    preferences.value = normalizePreferences(stored);
  } catch (error) {
    console.warn("[local-search-neo] 读取偏好设置失败:", error);
    preferences.value = { ...DEFAULT_PREFERENCES };
  }
}

function loadCustomCategories() {
  try {
    const stored = window.ztools.dbStorage.getItem<FinderCategory[]>(CUSTOM_CATEGORIES_STORAGE_KEY);
    if (!stored) {
      customCategories.value = [];
      saveCustomCategories();
      return;
    }

    customCategories.value = stored.map(normalizeCustomCategory);
  } catch (error) {
    console.warn("[local-search-neo] 读取自定义分组失败:", error);
    customCategories.value = [];
  }
}

function setPreviewEnabled(value: boolean) {
  preferences.value = {
    ...preferences.value,
    previewEnabled: value,
  };
  savePreferences();
}

function setSortMode(value: FinderSortMode) {
  preferences.value = {
    ...preferences.value,
    sortMode: value,
  };
  savePreferences();
}

function setMatchPathEnabled(value: boolean) {
  preferences.value = {
    ...preferences.value,
    matchPathEnabled: value,
  };
  savePreferences();
}

function setResultListWidth(value: number, persist = true) {
  if (typeof value !== "number" || Number.isNaN(value)) return;
  preferences.value = {
    ...preferences.value,
    resultListWidth: Math.round(value),
  };
  if (persist) {
    savePreferences();
  }
}

function setSidebarWidth(value: number, persist = true) {
  if (typeof value !== "number" || Number.isNaN(value)) return;
  preferences.value = {
    ...preferences.value,
    sidebarWidth: Math.round(value),
  };
  if (persist) {
    savePreferences();
  }
}

function setCategoryOrder(order: string[]) {
  preferences.value = {
    ...preferences.value,
    categoryOrder: [...order],
  };
  savePreferences();
}

function resetCategoryOrder(allAvailableCategoryIds: string[]) {
  preferences.value = {
    ...preferences.value,
    categoryOrder: normalizeCategoryOrder(DEFAULT_CATEGORY_ORDER, allAvailableCategoryIds),
  };
  savePreferences();
}

function addCustomCategory(label: string, rule: string) {
  const category = {
    id: `custom-${Date.now()}`,
    label,
    kind: "custom",
    rule,
  } satisfies FinderCategory;

  customCategories.value = [...customCategories.value, category];
  preferences.value = {
    ...preferences.value,
    categoryEnabled: {
      ...preferences.value.categoryEnabled,
      [category.id]: true,
    },
    categoryOrder: [...preferences.value.categoryOrder, category.id],
  };
  savePreferences();
  saveCustomCategories();
  return category;
}

function updateCustomCategory(id: string, input: Pick<FinderCategory, "label" | "rule">) {
  customCategories.value = customCategories.value.map((category) =>
    category.id === id
      ? {
          ...category,
          label: input.label,
          rule: input.rule,
        }
      : category,
  );
  saveCustomCategories();
}

function removeCustomCategory(category: FinderCategory) {
  customCategories.value = customCategories.value.filter((item) => item.id !== category.id);
  const { [category.id]: _removed, ...categoryEnabled } = preferences.value.categoryEnabled;
  preferences.value = {
    ...preferences.value,
    categoryEnabled,
    categoryOrder: preferences.value.categoryOrder.filter((id) => id !== category.id),
  };
  savePreferences();
  saveCustomCategories();
}

function isCategoryEnabled(categoryId: string) {
  return preferences.value.categoryEnabled[categoryId] ?? true;
}

function setCategoryEnabled(categoryId: string, enabled: boolean) {
  preferences.value = {
    ...preferences.value,
    categoryEnabled: {
      ...preferences.value.categoryEnabled,
      [categoryId]: enabled,
    },
  };
  savePreferences();
}

function normalizePreferences(stored: Partial<FinderPreferences>): FinderPreferences {
  const rawOrder = Array.isArray(stored.categoryOrder)
    ? stored.categoryOrder.filter((item): item is string => typeof item === "string")
    : [...DEFAULT_CATEGORY_ORDER];

  return {
    previewEnabled: stored.previewEnabled ?? DEFAULT_PREFERENCES.previewEnabled,
    sortMode: stored.sortMode ?? DEFAULT_PREFERENCES.sortMode,
    matchPathEnabled: stored.matchPathEnabled ?? DEFAULT_PREFERENCES.matchPathEnabled,
    resultListWidth:
      typeof stored.resultListWidth === "number" && stored.resultListWidth >= 200
        ? stored.resultListWidth
        : DEFAULT_PREFERENCES.resultListWidth,
    sidebarWidth:
      typeof stored.sidebarWidth === "number" && stored.sidebarWidth >= 48
        ? stored.sidebarWidth
        : DEFAULT_PREFERENCES.sidebarWidth,
    categoryEnabled: { ...DEFAULT_PREFERENCES.categoryEnabled, ...stored.categoryEnabled },
    categoryOrder: rawOrder,
  };
}

function normalizeCustomCategory(category: FinderCategory): FinderCategory {
  return {
    id: category.id,
    label: category.label,
    kind: "custom",
    rule: category.rule,
  };
}

function savePreferences() {
  try {
    window.ztools.dbStorage.setItem(PREFERENCES_STORAGE_KEY, preferences.value);
  } catch (error) {
    console.warn("[local-search-neo] 保存偏好设置失败:", error);
  }
}

function saveCustomCategories() {
  try {
    window.ztools.dbStorage.setItem(
      CUSTOM_CATEGORIES_STORAGE_KEY,
      customCategories.value.map(normalizeCustomCategory),
    );
  } catch (error) {
    console.warn("[local-search-neo] 保存自定义分组失败:", error);
  }
}
