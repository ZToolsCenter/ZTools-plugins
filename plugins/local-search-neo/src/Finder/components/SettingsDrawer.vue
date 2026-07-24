<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { FinderCategory } from "../core/finderLogic";

const props = defineProps<{
  open: boolean;
  categories: FinderCategory[];
  matchPathEnabled: boolean;
}>();

const emit = defineEmits<{
  close: [];
  addCategory: [category: Pick<FinderCategory, "label" | "rule">];
  updateCategory: [id: string, category: Pick<FinderCategory, "label" | "rule">];
  removeCategory: [category: FinderCategory];
  setCategoryEnabled: [id: string, enabled: boolean];
  setMatchPathEnabled: [enabled: boolean];
}>();

const label = ref("");
const rule = ref("");
const editingCategoryId = ref<string | undefined>();
const isAdding = ref(false);
const builtInCollapsed = ref(true);
const builtInCategories = computed(() =>
  props.categories.filter((category) => category.kind !== "custom"),
);
const customCategories = computed(() =>
  props.categories.filter((category) => category.kind === "custom"),
);

watch(
  () => props.open,
  (open) => {
    resetDraft();
    if (open) {
      builtInCollapsed.value = true;
    }
  },
);

function submitCategory() {
  const trimmedLabel = label.value.trim();
  const trimmedRule = rule.value.trim();
  if (!trimmedLabel || !trimmedRule) return;

  const categoryInput = {
    label: trimmedLabel,
    rule: trimmedRule,
  };

  if (editingCategoryId.value) {
    emit("updateCategory", editingCategoryId.value, categoryInput);
  } else {
    emit("addCategory", categoryInput);
  }

  resetDraft();
}

function startAddCategory() {
  editingCategoryId.value = undefined;
  isAdding.value = true;
  label.value = "";
  rule.value = "";
}

function editCategory(category: FinderCategory) {
  if (category.kind !== "custom") return;
  isAdding.value = false;
  editingCategoryId.value = category.id;
  label.value = category.label;
  rule.value = category.rule;
}

function removeCategory(category: FinderCategory) {
  if (editingCategoryId.value === category.id) resetDraft();
  emit("removeCategory", category);
}

function resetDraft() {
  editingCategoryId.value = undefined;
  isAdding.value = false;
  label.value = "";
  rule.value = "";
}

function closeDrawer() {
  resetDraft();
  emit("close");
}

function categoryTypeLabel(category: FinderCategory) {
  return category.kind === "custom" ? "自定义" : "内置";
}

function handleCategoryEnabledChange(category: FinderCategory, event: Event) {
  const enabled = readChecked(event);
  emit("setCategoryEnabled", category.id, enabled);
}

function handleMatchPathEnabledChange(event: Event) {
  emit("setMatchPathEnabled", readChecked(event));
}

function readChecked(event: Event) {
  return event.target instanceof HTMLInputElement && event.target.checked;
}

function toggleBuiltInCategories() {
  builtInCollapsed.value = !builtInCollapsed.value;
}
</script>

<template>
  <Transition name="settings-panel" appear>
    <div v-if="open" class="settings-layer">
      <div class="settings-backdrop" @click="closeDrawer"></div>
      <section class="settings-drawer" aria-label="设置">
        <header class="settings-header">
          <div>
            <h2>设置</h2>
          </div>
          <button type="button" class="drawer-close" @click="closeDrawer">×</button>
        </header>

        <section class="settings-section">
          <section class="search-settings">
            <div>
              <h3>搜索设置</h3>
              <p>启用后，普通关键字会同时匹配路径和文件名，结果更多但可能变慢。</p>
            </div>
            <label class="settings-switch">
              <input
                type="checkbox"
                :checked="matchPathEnabled"
                @change="handleMatchPathEnabledChange"
              />
              <span class="switch-track"></span>
              <span>同时搜索路径</span>
            </label>
          </section>

          <div class="category-section-header">
            <div>
              <h3>分组管理</h3>
              <p>关闭后，该分组不会显示在左侧分组栏。内置分组不支持删除。</p>
            </div>
          </div>

          <div class="category-list">
            <div class="category-list-header">
              <span>启用</span>
              <span>名称</span>
              <span>规则</span>
              <span>类型</span>
              <span>操作</span>
            </div>

            <div class="category-group">
              <button
                type="button"
                class="category-group-toggle"
                :aria-expanded="!builtInCollapsed"
                @click="toggleBuiltInCategories"
              >
                <span class="category-group-arrow" aria-hidden="true"></span>
                <span>内置分组</span>
                <span class="category-group-count">{{ builtInCategories.length }} 个</span>
              </button>

              <template v-if="!builtInCollapsed">
                <div
                  v-for="category in builtInCategories"
                  :key="category.id"
                  class="category-row"
                  :class="{ disabled: !category.enabled }"
                >
                  <label class="category-switch" title="启用该分组">
                    <input
                      type="checkbox"
                      :checked="category.enabled"
                      @change="handleCategoryEnabledChange(category, $event)"
                    />
                    <span class="switch-track"></span>
                  </label>
                  <span class="category-name">{{ category.label }}</span>
                  <span class="category-rule" :title="category.rule || '全部'">{{
                    category.rule || "全部"
                  }}</span>
                  <span class="category-type">{{ categoryTypeLabel(category) }}</span>
                  <span class="category-actions">
                    <span class="built-in-note">内置</span>
                  </span>
                </div>
              </template>
            </div>

            <template v-for="category in customCategories" :key="category.id">
              <form
                v-if="editingCategoryId === category.id"
                class="category-row category-edit-row"
                @submit.prevent="submitCategory"
              >
                <label class="category-switch" title="启用该分组">
                  <input
                    type="checkbox"
                    :checked="category.enabled"
                    @change="handleCategoryEnabledChange(category, $event)"
                  />
                  <span class="switch-track"></span>
                </label>
                <input v-model="label" class="category-inline-input" autocomplete="off" />
                <input v-model="rule" class="category-inline-input" autocomplete="off" />
                <span class="category-type">自定义</span>
                <span class="category-edit-actions">
                  <button type="submit">保存</button>
                  <button type="button" @click="resetDraft">取消</button>
                </span>
              </form>

              <div v-else class="category-row" :class="{ disabled: !category.enabled }">
                <label class="category-switch" title="启用该分组">
                  <input
                    type="checkbox"
                    :checked="category.enabled"
                    @change="handleCategoryEnabledChange(category, $event)"
                  />
                  <span class="switch-track"></span>
                </label>
                <span class="category-name">{{ category.label }}</span>
                <span class="category-rule" :title="category.rule || '全部'">{{
                  category.rule || "全部"
                }}</span>
                <span class="category-type">{{ categoryTypeLabel(category) }}</span>
                <span class="category-actions">
                  <button type="button" @click="editCategory(category)">编辑</button>
                  <button type="button" class="danger-action" @click="removeCategory(category)">
                    删除
                  </button>
                </span>
              </div>
            </template>

            <form
              v-if="isAdding"
              class="category-row category-edit-row"
              @submit.prevent="submitCategory"
            >
              <span class="category-add-marker">＋</span>
              <input
                v-model="label"
                class="category-inline-input"
                autocomplete="off"
                placeholder="例如 日志"
              />
              <input
                v-model="rule"
                class="category-inline-input"
                autocomplete="off"
                placeholder="log;txt 或 path:C:\Windows"
              />
              <span class="category-type">自定义</span>
              <span class="category-edit-actions">
                <button type="submit">添加</button>
                <button type="button" @click="resetDraft">取消</button>
              </span>
            </form>

            <button
              v-else
              type="button"
              class="category-row category-add-trigger"
              @click="startAddCategory"
            >
              <span>＋ 添加自定义分组</span>
            </button>
          </div>
        </section>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.settings-layer {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  align-items: end;
}

.settings-backdrop {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 35%);
}

.settings-drawer {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 16px;
  position: relative;
  width: 100%;
  height: 75vh;
  max-height: 75vh;
  box-sizing: border-box;
  padding: 18px 20px 20px;
  overflow: hidden;
  color: #f5f7fa;
  background: #2d2f32;
  border-top: 1px solid #55585c;
  border-radius: 12px 12px 0 0;
  box-shadow: 0 -16px 40px rgb(0 0 0 / 35%);
}

.settings-panel-enter-active,
.settings-panel-leave-active {
  transition: background-color 0.28s ease;
}

.settings-panel-enter-active .settings-backdrop,
.settings-panel-leave-active .settings-backdrop {
  transition: opacity 0.28s ease;
}

.settings-panel-enter-active .settings-drawer {
  transition:
    transform 0.32s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.24s ease;
  will-change: transform, opacity;
}

.settings-panel-leave-active .settings-drawer {
  transition:
    transform 0.22s cubic-bezier(0.32, 0, 0.67, 0),
    opacity 0.14s ease 0.08s;
  will-change: transform, opacity;
}

.settings-panel-enter-from .settings-backdrop,
.settings-panel-leave-to .settings-backdrop {
  opacity: 0;
}

.settings-panel-enter-from .settings-drawer {
  opacity: 0;
  transform: translate3d(0, 100%, 0);
}

.settings-panel-leave-to .settings-drawer {
  opacity: 0.96;
  transform: translate3d(0, 105%, 0);
}

.settings-panel-enter-to .settings-drawer,
.settings-panel-leave-from .settings-drawer {
  opacity: 1;
  transform: translate3d(0, 0, 0);
}

.settings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.settings-header h2 {
  margin: 0;
  font-size: 18px;
}

.drawer-close,
.category-group-toggle,
.category-actions button,
.category-edit-actions button,
.category-add-trigger {
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.drawer-close {
  width: 30px;
  height: 30px;
  background: transparent;
  border-radius: 6px;
  color: #cbd1d8;
  font-size: 24px;
  line-height: 1;
}

.drawer-close:focus,
.drawer-close:focus-visible,
.category-inline-input:focus,
.category-inline-input:focus-visible,
.category-group-toggle:focus,
.category-group-toggle:focus-visible,
.category-actions button:focus,
.category-actions button:focus-visible,
.category-edit-actions button:focus,
.category-edit-actions button:focus-visible,
.category-add-trigger:focus,
.category-add-trigger:focus-visible {
  outline: none;
  box-shadow: none;
}

.settings-section {
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.search-settings,
.category-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.search-settings {
  padding: 12px;
  background: #303234;
  border: 1px solid #47494c;
  border-radius: 8px;
}

.search-settings h3,
.category-section-header h3 {
  margin: 0;
  color: #ffffff;
  font-size: 15px;
}

.search-settings p,
.category-section-header p {
  margin: 4px 0 0;
  color: #aeb4bb;
  font-size: 12px;
}

.settings-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #cbd1d8;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.settings-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.category-list {
  display: grid;
  border: 1px solid #47494c;
  border-radius: 8px;
}

.category-list-header,
.category-row {
  display: grid;
  grid-template-columns: 46px minmax(82px, 130px) minmax(160px, 1fr) 60px 120px;
  gap: 10px;
  align-items: center;
  min-height: 34px;
  box-sizing: border-box;
  padding: 0 10px;
}

.category-list-header {
  color: #aeb4bb;
  background: #242629;
  font-size: 12px;
}

.category-group {
  display: grid;
  border-top: 1px solid #3f4246;
}

.category-group-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 10px;
  background: #2b2d30;
  text-align: left;
}

.category-group-arrow {
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  color: #aeb4bb;
  transform: rotate(-45deg);
  transition: transform 0.15s ease;
}

.category-group-toggle[aria-expanded="true"] .category-group-arrow {
  transform: rotate(45deg);
}

.category-group-count {
  margin-left: auto;
  color: #aeb4bb;
  font-size: 12px;
}

.category-row {
  border-top: 1px solid #3f4246;
  background: #303234;
  font-size: 13px;
}

.category-row.disabled .category-name,
.category-row.disabled .category-rule,
.category-row.disabled .category-type {
  opacity: 0.5;
}

.category-switch {
  display: inline-flex;
  justify-self: start;
  cursor: pointer;
}

.category-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.switch-track {
  position: relative;
  width: 32px;
  height: 16px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #6c7178;
  transition: background-color 0.15s ease;
}

.switch-track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #f2f4f7;
  transition: transform 0.15s ease;
}

.settings-switch input:checked + .switch-track,
.category-switch input:checked + .switch-track {
  background: #3b82f6;
}

.settings-switch input:checked + .switch-track::after,
.category-switch input:checked + .switch-track::after {
  transform: translateX(16px);
}

.category-name,
.category-rule {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-rule {
  color: #d7dce3;
  font-family: Consolas, "Cascadia Mono", "Microsoft YaHei Mono", monospace;
}

.category-inline-input {
  appearance: none;
  min-width: 0;
  height: 28px;
  box-sizing: border-box;
  padding: 0 8px;
  color: #ffffff;
  background: #1f2022;
  border: 1px solid #55585c;
  border-radius: 5px;
  font-family: Consolas, "Cascadia Mono", "Microsoft YaHei Mono", monospace;
}

.category-inline-input:focus,
.category-inline-input:focus-visible {
  border-color: #3b82f6;
}

.category-type,
.built-in-note {
  color: #aeb4bb;
  font-size: 12px;
}

.category-actions,
.category-edit-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1;
}

.category-actions button,
.category-edit-actions button {
  height: auto;
  padding: 0;
  background: transparent;
  border-radius: 0;
  line-height: 1;
}

.category-actions button:hover,
.category-edit-actions button:hover,
.category-add-trigger:hover {
  color: #ffffff;
}

.category-actions .danger-action {
  color: #ffb4b4;
}

.category-edit-actions button:first-child {
  color: #60a5fa;
}

.category-add-marker {
  color: #aeb4bb;
  font-size: 15px;
}

.category-add-trigger {
  width: 100%;
  color: #cbd1d8;
  background: #303234;
  text-align: left;
}

.category-add-trigger span {
  grid-column: 1 / -1;
}

@media (prefers-color-scheme: light) {
  .settings-backdrop {
    background: rgb(15 23 42 / 24%);
  }

  .settings-drawer {
    color: #1f2937;
    background: #ffffff;
    border-top-color: #d2d9e3;
    box-shadow: 0 -16px 40px rgb(15 23 42 / 16%);
  }

  .settings-header h2,
  .search-settings h3,
  .category-section-header h3 {
    color: #111827;
  }

  .search-settings p,
  .category-section-header p,
  .category-list-header,
  .category-group-arrow,
  .category-group-count,
  .category-type,
  .built-in-note,
  .category-add-marker {
    color: #667085;
  }

  .drawer-close {
    color: #4f5b6a;
  }

  .drawer-close:hover {
    background: #edf2f7;
  }

  .search-settings {
    background: #ffffff;
    border-color: #d6dde8;
  }

  .settings-switch {
    color: #4f5b6a;
  }

  .category-list {
    border-color: #d6dde8;
  }

  .category-list-header {
    background: #eef2f7;
  }

  .category-group {
    border-top-color: #e4e9f1;
  }

  .category-group-toggle {
    color: #1f2937;
    background: #f8fafc;
  }

  .category-row,
  .category-add-trigger {
    color: #1f2937;
    background: #ffffff;
    border-top-color: #e4e9f1;
  }

  .switch-track {
    background: #b9c2ce;
  }

  .settings-switch input:checked + .switch-track,
  .category-switch input:checked + .switch-track {
    background: #2563eb;
  }

  .category-rule {
    color: #4f5b6a;
  }

  .category-inline-input {
    color: #111827;
    background: #f8fafc;
    border-color: #c8d0da;
  }

  .category-inline-input:focus,
  .category-inline-input:focus-visible {
    border-color: #2563eb;
  }

  .category-actions button:hover,
  .category-edit-actions button:hover,
  .category-add-trigger:hover {
    color: #111827;
  }

  .category-edit-actions button:first-child {
    color: #2563eb;
  }

  .category-actions .danger-action {
    color: #c24141;
  }
}

@media (max-width: 760px) {
  .category-list-header,
  .category-row {
    grid-template-columns: 1fr;
  }

  .category-list-header {
    display: none;
  }

  .category-row {
    gap: 4px;
    padding: 8px 10px;
  }
}
</style>
