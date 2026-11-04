<script setup>
import { computed } from 'vue';
import { fmt } from '../lib/core';
/** K16（v1.9.x）：大字档直达组件 —— 直接读 prefs 的全局密度信号，无需视图传 prop */
import { densityLive } from '../lib/prefs';

const props = defineProps({
  labels: { type: Array, default: () => [] },
  values: { type: Array, default: () => [] },
  color: { type: String, default: 'var(--accent)' },
  height: { type: Number, default: 76 },
  /** 是否把峰值柱加亮 */
  highlightPeak: { type: Boolean, default: true },
});

const max = computed(() => Math.max(...props.values.map((v) => +v || 0), 1));
/** K16：大字档所有图表文字 ≥12px */
const large = computed(() => densityLive.value === 'large');
/**
 * K10（v1.8.2）柱顶数值字号 → K17（v1.9.x）**8px 档回退为 9px**。
 *
 * K10 当时的实测：12 列压力场景下 9px 的 `¥246,055.97` 会与邻柱重叠 1.29px，故降到 8px。
 * 第三轮评审②指出：8px 已低于「图表字号下限 9」的口径，宁可让极端场景走省略号
 * （下方 `.mv` 的 `max-width:100% + ellipsis` 硬兜底保证**永不叠压邻柱**），
 * 也不为了极罕见的 12 列场景牺牲可读性 —— 故删去 8px 档，柱顶恒为 9px（大字档 12px）。
 * K10 的其余决定（不隐藏、不缩写、不换单位、元 + 千分位）全部保留。
 */
const valFont = computed(() => (large.value ? 12 : 9));
const peakIdx = computed(() => props.values.indexOf(Math.max(...props.values.map((v) => +v || 0))));
const bars = computed(() => props.labels.map((label, i) => {
  const v = +props.values[i] || 0;
  return {
    label,
    short: label.length > 5 ? label.slice(2) : label,
    value: v,
    h: v > 0 ? Math.max((v / max.value) * 100, 5) : 0,
    hot: props.highlightPeak && i === peakIdx.value && v > 0,
  };
}));
</script>

<template>
  <div class="minibars" :data-density="densityLive" :style="{ height: `${height}px` }">
    <div v-for="(b, i) in bars" :key="i" class="mb" :title="`${b.label} · ${fmt(b.value)}`">
      <span
        class="mv"
        :style="large
          ? { fontSize: '12px', height: '14px', lineHeight: '14px' }
          : { fontSize: `${valFont}px` }"
      >{{ b.value > 0 ? fmt(b.value) : '' }}</span>
      <div class="mtrack">
        <i :style="{ height: `${b.h}%`, background: b.hot ? 'var(--accent)' : color, opacity: b.hot ? 1 : 0.62 }" />
      </div>
      <span class="ml" :style="large ? { fontSize: '12px' } : null">{{ b.short }}</span>
    </div>
  </div>
</template>

<style scoped>
.minibars { display: flex; align-items: flex-end; gap: 6px; width: 100%; }
.mb {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  gap: 2px;
}
.mv {
  /* font-size 由 valFont 给出（9px；大字档 12px），此处仅作兜底 */
  font-size: 9px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  height: 11px;
  line-height: 11px;
  /* K10 硬兜底：限宽到列宽后省略号截断 —— 宁可截断也绝不叠压邻柱。
     .mb 是 flex:1 + min-width:0，故 max-width:100% 能正确限到列宽；
     .mv 是 flex item（自动 blockify），text-overflow 才生效。 */
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mtrack {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  min-height: 0;
}
.mtrack > i {
  display: block;
  width: 68%;
  max-width: 34px;
  border-radius: 4px 4px 2px 2px;
  transition: height 0.25s ease;
}
.ml {
  font-size: 9.5px;
  color: var(--muted);
  white-space: nowrap;
  height: 12px;
  line-height: 12px;
}
</style>
