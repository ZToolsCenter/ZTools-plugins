<script setup>
import { onMounted, onBeforeUnmount } from 'vue';
/** K16（v1.9.x）：抽屉挂全局密度信号 —— 大字档下抽屉明细行（.mrow）等随之放大（见 styles.css） */
import { densityLive } from '../lib/prefs';

defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  width: { type: Number, default: 392 },
});

const emit = defineEmits(['close']);

function onKey(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    emit('close');
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey, true);
  // 打开抽屉时把焦点移到抽屉内，键盘操作不落到背后的列表
  requestAnimationFrame(() => {
    const el = document.querySelector('.drawer [data-autofocus]') || document.querySelector('.drawer .input');
    if (el && el.focus) {
      try { el.focus(); if (el.select && el.type !== 'date') el.select(); } catch (_) { /* 忽略 */ }
    }
  });
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
  <div class="drawer-mask" @click="emit('close')" />
  <aside class="drawer" :data-density="densityLive" :style="{ width: `${width}px` }" role="dialog" aria-modal="true">
    <header class="drawer-head">
      <div class="grow">
        <div class="ttl">{{ title }}</div>
        <div v-if="subtitle" class="sub">{{ subtitle }}</div>
      </div>
      <slot name="head-extra" />
      <button class="btn ghost icon" title="关闭 (Esc)" @click="emit('close')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </header>
    <div class="drawer-body">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="drawer-foot">
      <slot name="footer" />
    </footer>
  </aside>
</template>
