<script setup>
/**
 * K22（v1.9.x）密度直达菜单（原三态循环 chip 的升级形态）。
 *
 * 背景（第三轮评审⑦）：原 chip 是「点一下循环到下一档」，想到大字档必须盲点两次，
 * 且三档说明只藏在 title 里（悬停才可见）。本组件改为：
 *  · 点击 chip → 弹出三选项菜单，**当前档高亮**；
 *  · 每个选项 = 名称 + **常驻可见**的说明副标题（不依赖悬停）；
 *  · 点选项直达该档；点菜单外任意处关闭。
 * 「三态循环」语义由 prefs.DENSITIES 的顺序承载（菜单即顺序列表），不再需要盲点循环。
 *
 * 密度仍是**独立键、不进账本**（v1.7 决定不变）：写入口唯一是 prefs.setDensity()，
 * 它同时同步 densityLive 信号，列表 / 图表 / 抽屉全部自动响应。
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { densityLive, setDensity, DENSITIES, DENSITY_LABEL, DENSITY_DESC } from '../lib/prefs';

const open = ref(false);
const root = ref(null);

const currentLabel = computed(() => DENSITY_LABEL[densityLive.value] || '密度');
const currentTitle = computed(() => `当前${currentLabel.value.replace('密度·', '')}。点击选择密度`);

function pick(v) {
  setDensity(v);
  open.value = false;
}
function onDocClick(e) {
  if (open.value && root.value && !root.value.contains(e.target)) open.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick, true));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick, true));
</script>

<template>
  <span ref="root" class="dens-wrap">
    <button
      class="chip dens"
      data-density-toggle
      :data-density-current="densityLive"
      :title="currentTitle"
      @click.stop="open = !open"
    >{{ currentLabel }}</button>
    <div v-if="open" class="dens-menu" data-density-menu @click.stop>
      <button
        v-for="d in DENSITIES" :key="d"
        class="dens-opt" :class="{ on: densityLive === d }"
        :data-density-opt="d"
        type="button"
        @click="pick(d)"
      >
        <span class="do-nm">{{ DENSITY_LABEL[d] }}</span>
        <span class="do-ds">{{ DENSITY_DESC[d] }}</span>
      </button>
    </div>
  </span>
</template>

<style scoped>
.dens-wrap { position: relative; display: inline-flex; }
.dens-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  min-width: 208px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dens-opt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 6px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}
.dens-opt:hover { background: var(--surface-2); }
.dens-opt.on { background: var(--accent-soft); }
.do-nm { font-size: 12px; font-weight: 700; color: var(--ink); }
.dens-opt.on .do-nm { color: var(--accent); }
.do-ds { font-size: 10.5px; color: var(--muted); line-height: 1.35; }
</style>
