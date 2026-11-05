<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import SourceAppIcon from "./SourceAppIcon.vue";

type ApplicationEntry = Readonly<{ bundleId: string; name: string }>;
type SelectedEntry = Readonly<ApplicationEntry & { iconBundleId: string; missing: boolean; unverified: boolean }>;
type CatalogState = "idle" | "loading" | "ready" | "unsupported" | "error";

const props = withDefaults(defineProps<{
  modelValue: readonly string[];
  disabled?: boolean;
}>(), { disabled: false });
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();

const defaultApplicationNames: Readonly<Record<string, string>> = {
  "com.1password.1password": "1Password",
  "com.bitwarden.desktop": "Bitwarden",
  "org.keepassxc.keepassxc": "KeePassXC",
};

const ROW_HEIGHT = 56;
const OVERSCAN_ROWS = 5;
let nextSelectId = 0;
const selectId = `blocked-app-select-${++nextSelectId}`;
const listboxId = `${selectId}-listbox`;

const rootElement = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const listElement = ref<HTMLDivElement | null>(null);
const retryButton = ref<HTMLButtonElement | null>(null);
const expanded = ref(false);
const query = ref("");
const catalogState = ref<CatalogState>("idle");
const catalogError = ref("");
const applications = ref<ApplicationEntry[]>([]);
const loading = ref(false);
const activeIndex = ref(-1);
const pendingFirst = ref(false);
const pendingLast = ref(false);
const scrollTop = ref(0);
const viewportHeight = ref(200);
const menuPosition = ref({ left: 8, top: 8, width: 300, height: 280 });

function bundleIdKey(bundleId: string): string { return bundleId.trim().toLowerCase(); }

const applicationById = computed(() => new Map(applications.value.map((application) => [bundleIdKey(application.bundleId), application])));
const selectedEntries = computed<SelectedEntry[]>(() => props.modelValue.map((bundleId) => {
  const application = applicationById.value.get(bundleIdKey(bundleId));
  if (application !== undefined) {
    return {
      ...application,
      bundleId,
      iconBundleId: application.bundleId,
      missing: false,
      unverified: false,
    };
  }
  const checked = catalogState.value === "ready";
  return {
    bundleId,
    name: defaultApplicationNames[bundleIdKey(bundleId)] ?? bundleId,
    iconBundleId: bundleId,
    missing: checked,
    unverified: !checked,
  };
}));
const normalizedQuery = computed(() => query.value.trim().toLowerCase());
const filteredApplications = computed(() => {
  if (!expanded.value || catalogState.value !== "ready") return [];
  const needle = normalizedQuery.value;
  if (needle.length === 0) return applications.value;
  return applications.value.filter((application) =>
    `${application.name}\n${application.bundleId}`.toLowerCase().includes(needle),
  );
});
const startIndex = computed(() => Math.max(
  0,
  Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN_ROWS,
));
const endIndex = computed(() => Math.min(
  filteredApplications.value.length,
  Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + OVERSCAN_ROWS,
));
const visibleApplications = computed(() =>
  filteredApplications.value.slice(startIndex.value, endIndex.value),
);
const topSpacerHeight = computed(() => startIndex.value * ROW_HEIGHT);
const bottomSpacerHeight = computed(() =>
  Math.max(0, (filteredApplications.value.length - endIndex.value) * ROW_HEIGHT),
);
const activeDescendant = computed(() =>
  expanded.value && activeIndex.value >= 0 && activeIndex.value < filteredApplications.value.length
    ? `${listboxId}-option-${activeIndex.value}`
    : undefined,
);
const menuStyle = computed(() => ({ left: `${menuPosition.value.left}px`, top: `${menuPosition.value.top}px`, width: `${menuPosition.value.width}px`, height: `${menuPosition.value.height}px` }));
const listStyle = computed(() => ({ height: `${Math.max(36, menuPosition.value.height - 54)}px` }));
const statusLabel = computed(() => {
  if (catalogState.value === "loading") return "正在读取应用列表…";
  if (catalogState.value === "unsupported") return "当前环境暂不支持读取应用列表";
  if (catalogState.value === "error") return "应用列表读取失败";
  if (catalogState.value === "ready" && applications.value.length === 0) return "应用列表为空";
  if (normalizedQuery.value.length > 0 && filteredApplications.value.length === 0) return "没有匹配的应用";
  return `${filteredApplications.value.length} 个应用`;
});

function updateMenuPosition(): void {
  const anchor = rootElement.value;
  if (anchor === null) return;
  const bounds = anchor.getBoundingClientRect();
  const inputBounds = searchInput.value?.getBoundingClientRect() ?? bounds;
  const panel = anchor.closest(".settings-panel");
  const panelBounds = panel?.getBoundingClientRect();
  const headerBottom = panel?.querySelector(".settings-titlebar")?.getBoundingClientRect().bottom ?? 0;
  const footerTop = panel?.querySelector(".settings-footer")?.getBoundingClientRect().top ?? window.innerHeight;
  const gutter = 10;
  const upperEdge = Math.max(gutter, headerBottom + gutter);
  const lowerEdge = Math.min(window.innerHeight - gutter, footerTop - gutter);
  const leftEdge = Math.max(gutter, panelBounds?.left ?? 0) + gutter;
  const rightEdge = Math.min(window.innerWidth - gutter, panelBounds?.right ?? window.innerWidth) - gutter;
  const below = Math.max(0, lowerEdge - inputBounds.bottom - 6);
  const above = Math.max(0, inputBounds.top - upperEdge - 6);
  const placeAbove = below < 210 && above > below;
  const available = placeAbove ? above : below;
  const height = Math.max(1, Math.min(320, available));
  const width = Math.min(
    Math.max(bounds.width, 220),
    Math.max(1, rightEdge - leftEdge),
  );
  const left = Math.max(leftEdge, Math.min(bounds.left, rightEdge - width));
  const top = placeAbove
    ? Math.max(upperEdge, inputBounds.top - height - 6)
    : Math.min(lowerEdge - height, inputBounds.bottom + 6);
  menuPosition.value = { left, top, width, height };
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!rootElement.value?.contains(event.target as Node)) closeMenu();
}

async function loadApplications(refresh = false): Promise<void> {
  if (loading.value) return;
  const listApplications = window.pasteboardPro?.listApplications;
  if (listApplications === undefined) {
    catalogState.value = "unsupported";
    return;
  }

  loading.value = true;
  catalogState.value = "loading";
  catalogError.value = "";
  try {
    const result = await window.pasteboardPro?.listApplications?.(refresh);
    if (result === undefined || !result.supported) {
      applications.value = [];
      catalogState.value = "unsupported";
      return;
    }
    const uniqueApplications = new Map<string, ApplicationEntry>();
    for (const entry of result.applications) {
      if (typeof entry.bundleId !== "string" || entry.bundleId.length === 0) continue;
      if (typeof entry.name !== "string" || entry.name.length === 0) continue;
      const key = bundleIdKey(entry.bundleId);
      if (!uniqueApplications.has(key)) {
        uniqueApplications.set(key, { bundleId: entry.bundleId, name: entry.name });
      }
    }
    applications.value = [...uniqueApplications.values()].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
    catalogState.value = "ready";
  } catch (error) {
    catalogError.value = error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "请重试读取应用列表。";
    catalogState.value = "error";
  } finally {
    loading.value = false;
  }
}

function openMenu(focusSearch = false): void {
  if (props.disabled) return;
  expanded.value = true;
  void nextTick(() => {
    updateMenuPosition();
    if (focusSearch && document.activeElement !== searchInput.value) {
      searchInput.value?.focus({ preventScroll: true });
    }
  });
  if (catalogState.value === "idle" || catalogState.value === "error") {
    void loadApplications();
  }
}

function closeMenu(): void { expanded.value = false; activeIndex.value = -1; pendingFirst.value = false; pendingLast.value = false; }

function updateSelected(bundleId: string): void {
  if (props.disabled) return;
  const key = bundleIdKey(bundleId);
  const wasSelected = props.modelValue.some((selected) => bundleIdKey(selected) === key);
  emit("update:modelValue", wasSelected
    ? props.modelValue.filter((selected) => bundleIdKey(selected) !== key)
    : [...props.modelValue, bundleId]);
}

function removeSelected(bundleId: string): void {
  if (props.disabled) return;
  const key = bundleIdKey(bundleId);
  emit("update:modelValue", props.modelValue.filter((selected) => bundleIdKey(selected) !== key));
}

function removeLastSelected(): void {
  const last = props.modelValue.at(-1);
  if (last !== undefined) removeSelected(last);
}

function activateIndex(index: number): void {
  if (filteredApplications.value.length === 0) return;
  activeIndex.value = Math.max(0, Math.min(index, filteredApplications.value.length - 1));
  void nextTick(() => {
    const list = listElement.value;
    if (list === null) return;
    const rowTop = activeIndex.value * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowTop < list.scrollTop) list.scrollTop = rowTop;
    else if (rowBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = rowBottom - list.clientHeight;
    }
    scrollTop.value = list.scrollTop;
  });
}

function toggleActive(): void {
  const application = filteredApplications.value[activeIndex.value];
  if (application !== undefined) updateSelected(application.bundleId);
}

function retryApplications(): void {
  void loadApplications(true);
  void nextTick(() => searchInput.value?.focus({ preventScroll: true }));
}

function onKeydown(event: KeyboardEvent): void {
  if (event.target === searchInput.value && (event.isComposing || event.keyCode === 229)) {
    if (event.key === "Escape") event.stopPropagation();
    return;
  }
  if (event.key === "Escape") {
    if (expanded.value) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    }
    return;
  }
  if (event.key === "Tab") {
    if (event.target === searchInput.value && catalogState.value === "error" && !event.shiftKey) {
      event.preventDefault();
      retryButton.value?.focus();
      return;
    }
    closeMenu();
    return;
  }
  if (event.target !== searchInput.value) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!expanded.value) openMenu();
    if (filteredApplications.value.length > 0) activateIndex(activeIndex.value + 1);
    else if (catalogState.value === "loading") pendingFirst.value = true;
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (!expanded.value) openMenu();
    if (filteredApplications.value.length > 0) {
      activateIndex(activeIndex.value < 0 ? filteredApplications.value.length - 1 : activeIndex.value - 1);
    } else if (catalogState.value === "loading") pendingLast.value = true;
    return;
  }
  if ((event.key === "Home" || event.key === "End") && query.value.length === 0) {
    if (filteredApplications.value.length > 0) {
      event.preventDefault();
      activateIndex(event.key === "Home" ? 0 : filteredApplications.value.length - 1);
    }
    return;
  }
  if (event.key === "Enter" && expanded.value) {
    event.preventDefault();
    if (activeIndex.value >= 0) toggleActive();
    return;
  }
  if (event.key === " " && expanded.value && activeIndex.value >= 0 && normalizedQuery.value.length === 0) {
    event.preventDefault();
    toggleActive();
    return;
  }
  if (event.key === "Backspace" && query.value.length === 0) removeLastSelected();
}

function onListScroll(event: Event): void {
  const list = event.currentTarget;
  if (!(list instanceof HTMLDivElement)) return;
  scrollTop.value = list.scrollTop;
  viewportHeight.value = list.clientHeight || viewportHeight.value;
  const firstVisible = Math.max(0, Math.floor(list.scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const lastVisible = Math.ceil((list.scrollTop + list.clientHeight) / ROW_HEIGHT) + OVERSCAN_ROWS;
  if (activeIndex.value < firstVisible || activeIndex.value >= lastVisible) activeIndex.value = -1;
}

watch(filteredApplications, () => {
  scrollTop.value = 0;
  activeIndex.value = -1;
  void nextTick(() => {
    if (listElement.value !== null) listElement.value.scrollTop = 0;
    if (pendingFirst.value) {
      pendingFirst.value = false;
      activateIndex(0);
    } else if (pendingLast.value) {
      pendingLast.value = false;
      activateIndex(filteredApplications.value.length - 1);
    }
  });
}, { flush: "post" });

watch([selectedEntries, catalogState], () => {
  if (expanded.value) void nextTick(updateMenuPosition);
}, { flush: "post" });

watch(expanded, (isExpanded) => {
  if (isExpanded) {
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("resize", updateMenuPosition);
    void nextTick(() => {
      updateMenuPosition();
      if (listElement.value !== null) {
        viewportHeight.value = listElement.value.clientHeight || viewportHeight.value;
      }
    });
    return;
  }
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  document.removeEventListener("scroll", updateMenuPosition, true);
  window.removeEventListener("resize", updateMenuPosition);
});

watch(() => props.disabled, (disabled) => {
  if (disabled) closeMenu();
}, { flush: "sync" });

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  document.removeEventListener("scroll", updateMenuPosition, true);
  window.removeEventListener("resize", updateMenuPosition);
});
</script>

<template>
  <div ref="rootElement" class="blocked-app-select" @keydown="onKeydown">
    <div class="blocked-app-select__control" :class="{ 'blocked-app-select__control--open': expanded, 'blocked-app-select__control--disabled': disabled }">
      <div v-if="selectedEntries.length > 0" class="blocked-app-select__chips" aria-label="已屏蔽应用">
        <span
          v-for="(entry, index) in selectedEntries"
          :key="`${entry.bundleId}-${index}`"
          class="blocked-app-select__chip"
          :class="{ 'blocked-app-select__chip--missing': entry.missing }"
          :title="entry.missing ? `${entry.bundleId} · 未在应用列表中找到` : entry.unverified ? `${entry.bundleId} · 尚未核对应用列表` : entry.name"
        >
          <SourceAppIcon
            :source-app="{ name: entry.name, bundleId: entry.iconBundleId }"
            fallback=""
            fallback-kind="application"
            lazy
          />
          <span class="blocked-app-select__chip-copy">
            <span class="blocked-app-select__chip-name">{{ entry.name }}</span>
            <small v-if="entry.missing">未在应用列表中找到</small>
          </span>
          <button
            type="button"
            :disabled="disabled"
            :aria-label="`移除屏蔽应用 ${entry.name}`"
            @click="removeSelected(entry.bundleId)"
          >×</button>
        </span>
      </div>
      <div class="blocked-app-select__search-row">
        <span class="blocked-app-select__search-icon" aria-hidden="true"></span>
        <input
          :id="`${selectId}-input`"
          ref="searchInput"
          v-model="query"
          type="text"
          role="combobox"
          aria-label="搜索应用"
          aria-autocomplete="list"
          :aria-expanded="expanded"
          :aria-controls="expanded && catalogState === 'ready' && filteredApplications.length > 0 ? listboxId : undefined"
          :aria-activedescendant="activeDescendant"
          :disabled="disabled"
          placeholder="搜索应用名称"
          autocomplete="off"
          spellcheck="false"
          @focus="openMenu()"
          @click="openMenu()"
        />
        <button
          type="button"
          class="blocked-app-select__chevron"
          :disabled="disabled"
          :aria-label="expanded ? '收起应用列表' : '展开应用列表'"
          :aria-expanded="expanded"
          @click="expanded ? closeMenu() : openMenu(true)"
        >⌄</button>
      </div>
    </div>

    <small class="blocked-app-select__hint">不记录所选应用复制的新内容。</small>

    <div v-if="expanded" class="blocked-app-select__menu" :style="menuStyle">
      <div class="blocked-app-select__menu-status" :class="{ 'blocked-app-select__menu-status--error': catalogState === 'error' }">
        <span role="status" :aria-live="catalogState === 'error' ? 'off' : 'polite'">{{ statusLabel }}</span>
        <button
          v-if="catalogState === 'error'"
          ref="retryButton"
          type="button"
          class="blocked-app-select__retry"
          :disabled="loading"
          @click="retryApplications"
        >重试读取应用列表</button>
      </div>
      <p v-if="catalogState === 'error'" class="blocked-app-select__message" role="alert">{{ catalogError }}</p>
      <p v-else-if="catalogState === 'unsupported'" class="blocked-app-select__message" role="status">旧版宿主或当前平台无法读取应用目录；已有屏蔽项仍会保留，可逐项移除。</p>
      <p v-else-if="catalogState === 'loading'" class="blocked-app-select__message" role="status">正在读取此设备的应用目录…</p>
      <p v-else-if="catalogState === 'ready' && applications.length === 0" class="blocked-app-select__message" role="status">当前没有可选应用。已有屏蔽项仍会保留，可逐项移除。</p>
      <p v-else-if="catalogState === 'ready' && filteredApplications.length === 0" class="blocked-app-select__message" role="status">没有匹配的应用，试试应用名称或 Bundle ID。</p>
      <div
        v-else-if="catalogState === 'ready'"
        :id="listboxId"
        ref="listElement"
        class="blocked-app-select__options"
        role="listbox"
        aria-label="可屏蔽应用"
        aria-multiselectable="true"
        :style="listStyle"
        @scroll="onListScroll"
      >
        <div class="blocked-app-select__spacer" aria-hidden="true" :style="{ height: `${topSpacerHeight}px` }"></div>
        <div
          v-for="(application, offset) in visibleApplications"
          :id="`${listboxId}-option-${startIndex + offset}`"
          :key="application.bundleId"
          class="blocked-app-select__option"
          :class="{
            'blocked-app-select__option--selected': props.modelValue.some((selected) => bundleIdKey(selected) === bundleIdKey(application.bundleId)),
            'blocked-app-select__option--active': activeIndex === startIndex + offset,
          }"
          role="option"
          :aria-label="`${application.name}, ${application.bundleId}`"
          :aria-selected="props.modelValue.some((selected) => bundleIdKey(selected) === bundleIdKey(application.bundleId))"
          :aria-posinset="startIndex + offset + 1"
          :aria-setsize="filteredApplications.length"
          @pointerdown.prevent
          @mouseenter="activeIndex = startIndex + offset"
          @click="updateSelected(application.bundleId)"
        >
          <SourceAppIcon
            :source-app="{ name: application.name, bundleId: application.bundleId }"
            fallback=""
            fallback-kind="application"
            lazy
          />
          <span class="blocked-app-select__option-copy">
            <span>{{ application.name }}</span>
            <small>{{ application.bundleId }}</small>
          </span>
          <span class="blocked-app-select__check" aria-hidden="true">✓</span>
        </div>
        <div class="blocked-app-select__spacer" aria-hidden="true" :style="{ height: `${bottomSpacerHeight}px` }"></div>
      </div>
    </div>
  </div>
</template>

<style src="../styles/blocked-applications-select.css"></style>
