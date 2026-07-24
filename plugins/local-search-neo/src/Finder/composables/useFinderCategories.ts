import { computed, ref, watch } from "vue";
import { DEFAULT_CATEGORIES, type FinderCategory } from "../core/finderLogic";
import { usePersistStorage } from "./usePersistStorage";

const activeCategoryId = ref("all");
const {
  customCategories,
  addCustomCategory,
  updateCustomCategory,
  removeCustomCategory,
  isCategoryEnabled,
  setCategoryEnabled,
} = usePersistStorage();

const allCategories = computed(() =>
  [...DEFAULT_CATEGORIES, ...customCategories.value].map((category) => ({
    ...category,
    enabled: isCategoryEnabled(category.id),
  })),
);
const enabledCategories = computed(() =>
  allCategories.value.filter((category) => category.enabled),
);
const activeCategory = computed(
  () =>
    enabledCategories.value.find((category) => category.id === activeCategoryId.value) ??
    enabledCategories.value[0] ??
    DEFAULT_CATEGORIES[0],
);

watch(enabledCategories, ensureActiveCategoryVisible, { immediate: true });

export function useFinderCategories() {
  return {
    activeCategoryId,
    activeCategory,
    enabledCategories,
    allCategories,
    selectCategory,
    resetActiveCategory,
    handleAddCustomCategory,
    handleUpdateCustomCategory,
    handleRemoveCustomCategory,
    handleSetCategoryEnabled,
  };
}

function selectCategory(category: FinderCategory) {
  activeCategoryId.value = category.id;
}

function resetActiveCategory() {
  activeCategoryId.value = "all";
}

function handleAddCustomCategory(input: Pick<FinderCategory, "label" | "rule">) {
  try {
    const category = addCustomCategory(input.label, input.rule);
    activeCategoryId.value = category.id;
  } catch (error) {
    console.warn("[local-search-neo] 保存自定义分组失败:", error);
  }
}

function handleUpdateCustomCategory(id: string, input: Pick<FinderCategory, "label" | "rule">) {
  if (!customCategories.value.some((category) => category.id === id)) return;

  try {
    updateCustomCategory(id, input);
  } catch (error) {
    console.warn("[local-search-neo] 更新自定义分组失败:", error);
  }
}

function handleRemoveCustomCategory(category: FinderCategory) {
  if (category.kind !== "custom") return;

  try {
    removeCustomCategory(category);
    ensureActiveCategoryVisible();
  } catch (error) {
    console.warn("[local-search-neo] 删除自定义分组失败:", error);
  }
}

function handleSetCategoryEnabled(id: string, enabled: boolean) {
  try {
    setCategoryEnabled(id, enabled);
    ensureActiveCategoryVisible();
  } catch (error) {
    console.warn("[local-search-neo] 保存分组启用状态失败:", error);
  }
}

function ensureActiveCategoryVisible() {
  if (enabledCategories.value.some((category) => category.id === activeCategoryId.value)) return;
  activeCategoryId.value = enabledCategories.value[0]?.id ?? "all";
}
