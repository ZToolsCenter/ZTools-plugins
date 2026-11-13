<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { State } from './types';
import Icon from './Icon.vue';
import { command } from './bridge';
const props = defineProps<{ state: State }>();
const query = ref('');
const selected = ref(props.state.config.settings.lastCategoryId);
const shell = ref<HTMLElement>(), bar = ref<HTMLElement>(), tray = ref<HTMLElement>();
const categories = computed(() => {
  const occupied = new Set(props.state.config.entries.map(entry => entry.categoryId));
  return props.state.config.categories.filter(category => occupied.has(category.id));
});
const entries = computed(() => {
  const text = query.value.trim().toLowerCase();
  return props.state.config.entries.filter(e => text ? `${e.name} ${e.target} ${e.plugin || ''}`.toLowerCase().includes(text) : e.categoryId === selected.value);
});
const current = computed(() => categories.value.find(c => c.id === selected.value));
const trayLeft = ref(16);
const iconPixels = computed(() => ({ small: 24, medium: 29, large: 36 })[props.state.config.settings.iconSize]);
const dimensions = computed(() => ({ '--panel-opacity': `${props.state.config.settings.panelOpacity * 100}%`, '--card-opacity': `${(0.2 + props.state.config.settings.panelOpacity * 0.8) * 100}%`, '--bar-width': `${Math.max(160, categories.value.length * 100 + 32)}px`, '--tray-width': `${props.state.config.settings.columns * 128 + 8}px`, '--card-height': `${props.state.config.settings.cardSize}px` }));
let observer: ResizeObserver | undefined, frame = 0, lastShape = '';

function scheduleLayout() {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; updateLayout(); });
}
function updateLayout() {
  if (!shell.value || !bar.value || !tray.value) return;
  const button = bar.value.querySelector<HTMLElement>('.dock-category.selected');
  const anchor = button?.getBoundingClientRect();
  const width = shell.value.clientWidth, height = shell.value.clientHeight;
  const centre = anchor ? anchor.x + anchor.width / 2 : width / 2;
  trayLeft.value = Math.max(16, Math.min(width - tray.value.offsetWidth - 16, Math.round(centre - tray.value.offsetWidth / 2)));
  // Position and native hit-region must come from the same rendered layout.
  tray.value.style.left = `${trayLeft.value}px`;
  const regions = [bar.value, ...(props.state.trayVisible ? [tray.value] : [])].map(el => {
    const rect = el.getBoundingClientRect(), shadow = props.state.material && props.state.material !== 'solid' ? 0 : 14;
    const x = Math.max(0, Math.floor(rect.x - shadow)), y = Math.max(0, Math.floor(rect.y - shadow));
    return { x, y, width: Math.min(width, Math.ceil(rect.right + shadow)) - x, height: Math.min(height, Math.ceil(rect.bottom + shadow)) - y };
  });
  const signature = JSON.stringify(regions);
  if (signature !== lastShape) {
    lastShape = signature;
    window.dock.call('panel-layout', regions).catch(() => { lastShape = ''; });
  }
}
async function revealSelected() {
  await nextTick();
  bar.value?.querySelector('.dock-category.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  scheduleLayout();
}
watch([categories, () => props.state.config.settings.lastCategoryId], ([list, id]) => {
  selected.value = list.some(c => c.id === id) ? id : list[0]?.id || '';
}, { immediate: true });
watch(selected, revealSelected);
watch([() => props.state.expanded, () => props.state.trayVisible, dimensions, () => props.state.material, () => entries.value.length, () => props.state.config.settings.searchEnabled, query], async () => { await nextTick(); scheduleLayout(); });
function select(id: string) {
  if (!props.state.trayVisible) command('expand');
  query.value = '';
  if (selected.value !== id) { selected.value = id; command('select', id); }
}
function scrollCategories(event: WheelEvent) {
  const nav = event.currentTarget as HTMLElement;
  nav.scrollLeft += Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
}
watch(() => props.state.config.settings.searchEnabled, enabled => { if (!enabled) query.value = ''; });
function keydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); if (props.state.config.settings.searchEnabled) { command('focus'); tray.value?.querySelector<HTMLInputElement>('input')?.focus(); } }
  if (event.key === 'Escape') {
    if (query.value) query.value = '';
    else command('collapse');
  }
  if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT' && entries.value[0]) command('run', entries.value[0].id);
  if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key) && (event.target as HTMLElement).classList.contains('launch-card')) {
    event.preventDefault();
    const cards = [...document.querySelectorAll<HTMLButtonElement>('.launch-card')];
    const index = cards.indexOf(event.target as HTMLButtonElement);
    const shift = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? props.state.config.settings.columns : -props.state.config.settings.columns;
    cards[(index + shift + cards.length) % cards.length]?.focus();
  }
}
function visibility() { if (!document.hidden) { lastShape = ''; scheduleLayout(); } }
onMounted(() => {
  observer = new ResizeObserver(scheduleLayout);
  [shell.value, bar.value, tray.value].forEach(el => { if (el) observer!.observe(el); });
  document.addEventListener('visibilitychange', visibility);
  revealSelected();
});
onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); });
</script>
<template>
  <main ref="shell" class="dock-panel" :class="{ 'material-native': state.material && state.material !== 'solid' }" :style="dimensions" @keydown="keydown" @contextmenu.prevent="command('settings')">
    <div ref="bar" class="dock-bar" @mouseenter="command('expand')">
      <nav class="dock-categories" aria-label="程序坞分类" @scroll.passive="scheduleLayout" @wheel.prevent="scrollCategories">
        <span v-if="!categories.length" class="dock-no-categories">暂无快捷入口</span>
        <button v-for="category in categories" :key="category.id" class="dock-category" :class="{ selected: selected === category.id }" :style="{ '--category-color': category.color }" :aria-pressed="selected === category.id" :title="category.name" @mouseenter="select(category.id)" @click="select(category.id)">
          <Icon :name="category.icon" :image="category.image" :size="Math.round(iconPixels * 25 / 29)" /><span>{{ category.name }}</span>
        </button>
      </nav>
      <button class="dock-menu-toggle" :class="{ active: state.pinned }" :aria-pressed="state.pinned" :title="state.pinned ? '取消钉住导航条' : '钉住导航条'" :aria-label="state.pinned ? '取消钉住导航条' : '钉住导航条'" @click="command('pin')"><Icon name="Pin" :size="18" /></button>
    </div>
    <section v-show="state.trayVisible" ref="tray" class="dock-tray" :style="{ left: trayLeft + 'px' }" :aria-label="query ? '搜索结果' : current?.name">
      <div v-if="state.config.settings.searchEnabled" class="dock-tools">
        <label class="dock-search"><Icon name="Search" :size="16" /><input v-model="query" placeholder="搜索所有入口" aria-label="搜索所有入口" @focus="command('focus')"></label>

      </div>
      <div v-if="state.error" class="inline-error" role="alert">{{ state.error }}</div>
      <div class="dock-grid" :style="{ gridTemplateColumns: `repeat(${state.config.settings.columns}, minmax(0, 1fr))` }">
        <button v-for="entry in entries" :key="entry.id" class="launch-card" :title="entry.name + '\n' + (entry.type === 'system' ? '系统目录' : entry.target)" @click="command('run', entry.id)">
          <span class="launch-icon" :style="{ color: entry.color }"><Icon :name="entry.icon" :image="entry.image" :size="iconPixels" /></span>
          <span class="launch-name">{{ entry.name }}</span>
        </button>
        <div v-if="!entries.length" class="dock-empty"><Icon :name="query ? 'Search' : current?.icon || 'Plus'" :size="28" /><p>{{ query ? '没有找到匹配的入口' : '这个分类还没有入口' }}</p><button v-if="!query" class="button" @click="command('settings')">添加入口</button></div>
      </div>
    </section>
  </main>
</template>
