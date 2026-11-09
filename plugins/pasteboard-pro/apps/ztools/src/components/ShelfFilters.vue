<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";

import type { PasteItem } from "@pasteboard-pro/core";
import type { DockEdge } from "@pasteboard-pro/design-tokens";

import {
  activeShelfFilterGroups,
  isShelfFilterSelected,
  resetShelfQueryFilters,
  selectedShelfQueryFilters,
  setShelfQueryFilters,
  SHELF_TYPE_FILTERS,
  toggleShelfQueryFilter,
  type ShelfFilterOption,
} from "./shelf-filter-query";
import { readModernPalette } from "./modern-palette";
import { placePopover, type PopupPlacement } from "./popup-position";

const props = withDefaults(
  defineProps<{
    query: string;
    items: readonly PasteItem[];
    edge: DockEdge;
    iconOnly?: boolean;
  }>(),
  { iconOnly: false },
);
const emit = defineEmits<{
  "update:query": [value: string];
  "openChange": [open: boolean];
}>();

const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const placement = ref<PopupPlacement>({ left: 8, top: 8 });
const popoverPalette = ref<Record<string, string>>({});
const popoverStyle = computed(() => ({
  left: placement.value.left + "px",
  top: placement.value.top + "px",
  ...popoverPalette.value,
}));
const activeGroups = computed(() => activeShelfFilterGroups(props.query));

const appOptions = computed<ShelfFilterOption[]>(() => {
  const byId = new Map<string, ShelfFilterOption>();
  for (const item of props.items) {
    const name = item.sourceApp?.name?.trim() || undefined;
    const bundleId = item.sourceApp?.bundleId?.trim() || undefined;
    const label = name || bundleId;
    const queryValue = bundleId || name;
    if (label === undefined || queryValue === undefined) continue;
    const key = queryValue.toLocaleLowerCase();
    byId.set(key, {
      label,
      values: [queryValue],
      matchValues: [queryValue, ...(name === undefined ? [] : [name])],
    });
  }

  const options = [...byId.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
  const selected = selectedShelfQueryFilters(props.query, "apps");
  for (const value of selected) {
    const represented = options.some((option) =>
      (option.matchValues ?? option.values).some((candidate) =>
        queryMatchesApp(value, candidate),
      ),
    );
    if (!represented) {
      options.push({ label: value, values: [value], matchValues: [value] });
    }
  }
  return options;
});

const dateOptions = computed<ShelfFilterOption[]>(() => {
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, "0")}-${String(yesterdayDate.getDate()).padStart(2, "0")}`;
  const options: ShelfFilterOption[] = [
    { label: "今天", values: ["today"] },
    { label: "昨天", values: [yesterday] },
    { label: "最近 7 天", values: ["week"] },
    { label: "最近 30 天", values: ["month"] },
  ];

  for (const value of selectedShelfQueryFilters(props.query, "dates")) {
    if (!options.some((option) => option.values.includes(value))) {
      options.push({ label: value, values: [value] });
    }
  }
  return options;
});

const typeOptions = computed<ShelfFilterOption[]>(() => {
  const options = [...SHELF_TYPE_FILTERS];
  for (const value of selectedShelfQueryFilters(props.query, "types")) {
    if (!options.some((option) => option.values.includes(value))) {
      options.push({ label: value, values: [value] });
    }
  }
  return options;
});

let animationFrameId: number | undefined;

function startTrackingPlacement(): void {
  const startTime = performance.now();
  const duration = 380;
  function track(now: number): void {
    if (!open.value) return;
    updatePlacement();
    if (now - startTime < duration) {
      animationFrameId = requestAnimationFrame(track);
    }
  }
  cancelTrackingPlacement();
  animationFrameId = requestAnimationFrame(track);
}

function cancelTrackingPlacement(): void {
  if (animationFrameId !== undefined) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = undefined;
  }
}

let openTimestamp = 0;

function onTriggerMouseEnter(): void {
  if (!open.value) openPopover();
}

function openPopover(): void {
  if (open.value) return;
  open.value = true;
  openTimestamp = performance.now();
  emit("openChange", true);
  window.pasteboardPro?.setShelfExpanded?.(true, 420);
  document.body.classList.add("shelf-window--expanded-" + props.edge);
  if (trigger.value !== undefined) popoverPalette.value = readModernPalette(trigger.value);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  window.addEventListener("keydown", onWindowKeydown, true);
  window.addEventListener("resize", updatePlacement);
  window.addEventListener("scroll", updatePlacement, true);
  void nextTick(updatePlacement);
  startTrackingPlacement();
}

function closePopover(): void {
  if (!open.value) return;
  open.value = false;
  emit("openChange", false);
  cancelTrackingPlacement();
  window.pasteboardPro?.setShelfExpanded?.(false);
  document.body.classList.remove("shelf-window--expanded-" + props.edge);
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  window.removeEventListener("keydown", onWindowKeydown, true);
  window.removeEventListener("resize", updatePlacement);
  window.removeEventListener("scroll", updatePlacement, true);
}

function togglePopover(): void {
  if (open.value) closePopover();
  else openPopover();
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (performance.now() - openTimestamp < 350) return;
  const target = event.target;
  if (
    target instanceof Node &&
    !trigger.value?.contains(target) &&
    !panel.value?.contains(target)
  ) {
    closePopover();
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closePopover();
  void nextTick(() => trigger.value?.focus());
}

function updatePlacement(): void {
  if (!open.value || trigger.value === undefined || panel.value === undefined) return;
  const anchor = trigger.value.getBoundingClientRect();
  const bounds = panel.value.getBoundingClientRect();
  popoverPalette.value = readModernPalette(trigger.value);
  const isExpandedUpwards = document.body.classList.contains("shelf-window--expanded-bottom");
  placement.value = placePopover(anchor, bounds, {
    width: window.innerWidth,
    height: window.innerHeight,
  }, {
    align: props.edge === "left" ? "start" : "end",
    preferAbove: isExpandedUpwards || props.edge === "bottom",
    gap: 8,
    margin: 8,
  });
}

function update(kind: "types" | "apps" | "dates", option: ShelfFilterOption): void {
  emit("update:query", toggleShelfQueryFilter(props.query, kind, option));
}

function resetFilters(): void {
  emit("update:query", resetShelfQueryFilters(props.query));
}

function selected(kind: "types" | "apps" | "dates", option: ShelfFilterOption): boolean {
  return isShelfFilterSelected(props.query, kind, option);
}

function clearGroup(kind: "types" | "apps" | "dates"): void {
  emit("update:query", setShelfQueryFilters(props.query, kind, []));
}

function queryMatchesApp(queryValue: string, candidate: string): boolean {
  const query = queryValue.toLocaleLowerCase();
  const value = candidate.toLocaleLowerCase();
  return value.includes(query) || query.includes(value);
}

onBeforeUnmount(() => {
  cancelTrackingPlacement();
  window.pasteboardPro?.setShelfExpanded?.(false);
  document.body.classList.remove("shelf-window--expanded-" + props.edge);
  closePopover();
});
</script>

<template>
  <div class="shelf-filter-trigger" :class="{ 'shelf-filter-trigger--icon-only': iconOnly }">
    <button
      ref="trigger"
      type="button"
      class="modern-control modern-filter-button"
      :class="{
        'modern-control--active': activeGroups > 0,
        'modern-filter-button--icon-only': iconOnly,
      }"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :title="activeGroups > 0 ? '筛选（已启用 ' + activeGroups + ' 组条件）' : '筛选'"
      :aria-label="activeGroups > 0 ? '筛选，已启用 ' + activeGroups + ' 组条件' : '筛选'"
      @click.stop="togglePopover"
      @mouseenter="onTriggerMouseEnter"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 6h16M7 12h10m-7 6h4"></path>
      </svg>
      <span v-if="!iconOnly">筛选</span>
      <span v-if="activeGroups > 0" class="modern-filter-count">{{ activeGroups }}</span>
    </button>

    <Teleport to="body">
      <section
        v-if="open"
        ref="panel"
        class="shelf-filter-popover popover-surface"
        role="dialog"
        aria-label="筛选剪贴板历史"
        :style="popoverStyle"
        @pointerdown.stop
      >
        <header class="shelf-filter-popover__header">
          <div>
            <strong>筛选</strong>
            <span v-if="activeGroups > 0">已启用 {{ activeGroups }} 组</span>
          </div>
          <button
            type="button"
            class="shelf-filter-reset"
            :disabled="activeGroups === 0"
            @click="resetFilters"
          >重置</button>
        </header>

        <section class="shelf-filter-group" aria-label="类型">
          <div class="shelf-filter-group__title">
            <span>类型</span>
            <button type="button" @click="clearGroup('types')">清除</button>
          </div>
          <div class="shelf-filter-options">
            <button
              type="button"
              class="shelf-filter-chip"
              :class="{ 'shelf-filter-chip--selected': selected('types', { label: '全部', values: [] }) }"
              :aria-pressed="selected('types', { label: '全部', values: [] })"
              @click="clearGroup('types')"
            >全部</button>
            <button
              v-for="option in typeOptions"
              :key="option.label"
              type="button"
              class="shelf-filter-chip"
              :class="{ 'shelf-filter-chip--selected': selected('types', option) }"
              :aria-pressed="selected('types', option)"
              @click="update('types', option)"
            >
              <span v-if="option.label === '文本'" class="shelf-filter-chip__icon" style="color: #6F61EA;" aria-hidden="true">T</span>
              <span v-else-if="option.label === '图像' || option.label === '图片'" class="shelf-filter-chip__icon" style="color: #E06D9A;" aria-hidden="true">▧</span>
              <span>{{ option.label }}</span>
            </button>
          </div>
        </section>

        <section class="shelf-filter-group" aria-label="来源应用">
          <div class="shelf-filter-group__title">
            <span>来源应用</span>
            <button type="button" @click="clearGroup('apps')">清除</button>
          </div>
          <div class="shelf-filter-options shelf-filter-options--apps">
            <button
              type="button"
              class="shelf-filter-chip"
              :class="{ 'shelf-filter-chip--selected': selected('apps', { label: '所有应用', values: [] }) }"
              :aria-pressed="selected('apps', { label: '所有应用', values: [] })"
              @click="clearGroup('apps')"
            >所有应用</button>
            <button
              v-for="option in appOptions"
              :key="option.values[0]"
              type="button"
              class="shelf-filter-chip"
              :class="{ 'shelf-filter-chip--selected': selected('apps', option) }"
              :aria-pressed="selected('apps', option)"
              :title="option.label"
              @click="update('apps', option)"
            >{{ option.label }}</button>
            <span v-if="appOptions.length === 0" class="shelf-filter-empty">暂无来源应用</span>
          </div>
        </section>

        <section class="shelf-filter-group" aria-label="时间">
          <div class="shelf-filter-group__title">
            <span>时间</span>
            <button type="button" @click="clearGroup('dates')">清除</button>
          </div>
          <div class="shelf-filter-options">
            <button
              type="button"
              class="shelf-filter-chip"
              :class="{ 'shelf-filter-chip--selected': selected('dates', { label: '不限', values: [] }) }"
              :aria-pressed="selected('dates', { label: '不限', values: [] })"
              @click="clearGroup('dates')"
            >不限</button>
            <button
              v-for="option in dateOptions"
              :key="option.values[0]"
              type="button"
              class="shelf-filter-chip"
              :class="{ 'shelf-filter-chip--selected': selected('dates', option) }"
              :aria-pressed="selected('dates', option)"
              @click="update('dates', option)"
            >{{ option.label }}</button>
          </div>
        </section>

        <footer class="shelf-filter-popover__footer">
          <span>可与搜索词、设备和收藏夹条件组合</span>
          <button type="button" @click="closePopover">完成</button>
        </footer>
      </section>
    </Teleport>
  </div>
</template>

<style scoped src="./ShelfFilters.css"></style>
