<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watchEffect } from 'vue';
import TriggerArt from './TriggerArt.vue';
import { initialize, state, notice, command } from './bridge';
const Settings = defineAsyncComponent(() => import('./Settings.vue'));
const Dock = defineAsyncComponent(() => import('./Dock.vue'));
const surface = window.dock?.surface || 'settings';
document.title = surface === 'settings' ? '程序坞设置' : '程序坞';
const failure = ref('');
const dark = computed(() => state.value && (state.value.config.settings.theme === 'dark' || state.value.config.settings.theme === 'system' && state.value.dark));
watchEffect(() => { document.documentElement.dataset.theme = dark.value ? 'dark' : 'light'; document.body.dataset.surface = surface; document.body.dataset.edge = state.value?.config.settings.dockEdge || 'top'; if (state.value) document.documentElement.style.setProperty('--accent', state.value.config.settings.accent); });
onMounted(async () => { try { await initialize(); } catch (error) { failure.value = String(error); } });
</script>
<template>
  <template v-if="state">
    <div v-if="surface === 'trigger'" class="trigger" :style="{ color: state.config.settings.accent, opacity: state.config.settings.triggerOpacity, left: (state.triggerOffset?.x || 0) + 'px', top: (state.triggerOffset?.y || 0) + 'px', width: state.bounds?.triggerArt.width + 'px', height: state.bounds?.triggerArt.height + 'px' }" @mouseenter="command('hover', true)" @mouseleave="command('hover', false)" @dragenter.prevent="command('hover', true)" @dragover.prevent @click="command('expand')" @contextmenu.prevent="command('settings')" title="程序坞 · 悬停展开，右键设置"><span class="trigger-visual" :style="{ width: (['left','right'].includes(state.config.settings.dockEdge) ? state.bounds?.triggerArt.height : state.bounds?.triggerArt.width) + 'px', height: (['left','right'].includes(state.config.settings.dockEdge) ? state.bounds?.triggerArt.width : state.bounds?.triggerArt.height) + 'px' }"><TriggerArt :theme="state.config.settings.triggerTheme" :image="state.config.settings.triggerImage" /></span></div>
    <Dock v-else-if="surface === 'panel'" :state="state" />
    <div v-else-if="surface === 'host'" class="loading"><button class="button" @click="command('settings')">打开程序坞设置窗口</button></div>
    <Settings v-else :state="state" />
  </template>
  <div v-else class="loading">{{ failure || '正在打开程序坞…' }}</div>
  <div v-if="notice && surface !== 'trigger'" class="toast" :class="{ error: notice.error }" role="status">{{ notice.text }}</div>
</template>
