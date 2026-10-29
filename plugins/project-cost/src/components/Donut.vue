<script setup>
import { computed } from 'vue';
import { fmt, donutValSize } from '../lib/core';
/** K16（v1.9.x）：大字档直达组件 —— 不靠视图层层传 prop，直接读 prefs 的全局密度信号 */
import { densityLive } from '../lib/prefs';

const props = defineProps({
  segments: { type: Array, default: () => [] },   // [{ label, value, color }]
  size: { type: Number, default: 108 },
  centerLabel: { type: String, default: '' },
  centerValue: { type: String, default: '' },
  legend: { type: Boolean, default: true },
  legendFmt: { type: String, default: 'money' },  // money | percent
});

const total = computed(() => props.segments.reduce((s, x) => s + Math.max(+x.value || 0, 0), 0));

const arcs = computed(() => {
  const r = props.size / 2 - 9;
  const C = 2 * Math.PI * r;
  const sum = total.value || 1;
  let offset = 0;
  return props.segments
    .filter((s) => (+s.value || 0) > 0)
    .map((s) => {
      const len = ((+s.value || 0) / sum) * C;
      const el = {
        color: s.color,
        dash: `${len} ${C - len}`,
        offset: -offset,
        r,
        C,
      };
      offset += len;
      return el;
    });
});

const cx = computed(() => props.size / 2);
const valText = computed(() => {
  if (props.centerValue) return props.centerValue;
  return total.value > 0 ? fmt(total.value) : '—';
});
/**
 * K10（v1.8.2）窄位自适应：万位出口废除后，中心值从 `¥24.6 万`（6 字符）变成
 * `¥246,055.97`（11 字符，带负号 12），必须按「字符数 × 环径」缩字号，否则会压到色环上。
 * 档位表与实测标定数字见 `src/lib/core.js` 的 `donutValSize()`（纯函数，逐档有断言覆盖）。
 * K16：大字档下限抬到 12px（极端长金额可能轻微触环 —— 大字档「可读性优先」的既定取舍）。
 */
const large = computed(() => densityLive.value === 'large');
const valSize = computed(() => donutValSize(String(valText.value).length, props.size, large.value ? 12 : 9));

const legendItems = computed(() => {
  const sum = total.value || 1;
  return props.segments
    .filter((s) => (+s.value || 0) > 0)
    .map((s) => ({
      ...s,
      text: props.legendFmt === 'percent' ? `${Math.round(((+s.value || 0) / sum) * 100)}%` : fmt(s.value),
    }));
});
</script>

<template>
  <div class="donut-wrap" :data-density="densityLive">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <circle
        :cx="cx" :cy="cx" :r="size / 2 - 9"
        fill="none" stroke="var(--surface-3)" stroke-width="11"
      />
      <circle
        v-for="(a, i) in arcs" :key="i"
        :cx="cx" :cy="cx" :r="a.r"
        fill="none" :stroke="a.color" stroke-width="11"
        :stroke-dasharray="a.dash" :stroke-dashoffset="a.offset"
        :transform="`rotate(-90 ${cx} ${cx})`"
        stroke-linecap="butt"
      />
      <text :x="cx" :y="cx - 5" text-anchor="middle" :font-size="large ? 12 : 9.5" fill="var(--muted)">
        {{ centerLabel }}
      </text>
      <text :x="cx" :y="cx + 11" text-anchor="middle" :font-size="valSize" font-weight="800" fill="var(--ink)">
        {{ valText }}
      </text>
    </svg>
    <div v-if="legend" class="legend">
      <div v-for="(s, i) in legendItems" :key="i" class="li" :title="s.label">
        <span class="sw" :style="{ background: s.color }" />
        <span class="nm">{{ s.label }}</span>
        <span class="vv">{{ s.text }}</span>
      </div>
      <div v-if="!legendItems.length" class="mini">暂无数据</div>
    </div>
  </div>
</template>
