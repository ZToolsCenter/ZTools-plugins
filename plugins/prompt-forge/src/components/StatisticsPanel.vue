<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePromptStore } from '../stores/prompt'
import type { PromptType } from '../types'

const prompt = usePromptStore()

const TYPE_LABELS: Record<string, string> = {
  prompt: '提示词',
  snippet: '片段',
  template: '模板',
  constraint: '约束',
}
const TYPE_COLORS: Record<string, string> = {
  prompt: '#6C5CE7',
  snippet: '#00B894',
  template: '#FDCB6E',
  constraint: '#E17055',
}
const TYPE_ORDER: PromptType[] = ['prompt', 'snippet', 'template', 'constraint']

// ====== 统计卡片 ======
const totalCount = computed(() => prompt.liveItems.value.length)
const totalUsage = computed(() => prompt.liveItems.value.reduce((s, i) => s + (i.usageCount || 0), 0))
const favoriteCount = computed(() => prompt.liveItems.value.filter(i => i.favorite).length)
const withVarsCount = computed(() => prompt.liveItems.value.filter(i => i.variables?.length).length)

// ====== 类型分布 ======
const typeDistribution = computed(() =>
  TYPE_ORDER.map(type => ({
    type,
    count: prompt.liveItems.value.filter(i => i.type === type).length,
  }))
)

// donut 饼图段（stroke-dasharray 实现环形图）
const DONUT_R = 50
const DONUT_C = 2 * Math.PI * DONUT_R
const donutSegments = computed(() => {
  const total = totalCount.value
  if (!total) return []
  let acc = 0
  return typeDistribution.value
    .filter(d => d.count > 0)
    .map(d => {
      const len = (d.count / total) * DONUT_C
      const seg = {
        type: d.type,
        count: d.count,
        dasharray: `${len} ${DONUT_C - len}`,
        dashoffset: -acc,
      }
      acc += len
      return seg
    })
})

// ====== 时间范围（本周/本月，TOP10 与趋势共用） ======
const range = ref<'week' | 'month'>('week')
const rangeDays = computed(() => (range.value === 'week' ? 7 : 30))
const rangeStart = computed(() => Date.now() - rangeDays.value * 24 * 3600 * 1000)

// ====== 使用 TOP10（基于历史记录按时间范围聚合） ======
const topUsage = computed(() => {
  const counts = new Map<string, number>()
  for (const h of prompt.historyItems.value) {
    if (h.usedAt < rangeStart.value) continue
    counts.set(h.promptId, (counts.get(h.promptId) || 0) + 1)
  }
  const items = [...counts.entries()].map(([id, count]) => {
    const item = prompt.liveItems.value.find(i => i.id === id)
    return { id, title: item?.title || '（已删除）', count }
  })
  items.sort((a, b) => b.count - a.count)
  return items.slice(0, 10)
})
const topMax = computed(() => Math.max(1, ...topUsage.value.map(t => t.count)))

// ====== 使用频次趋势（按日期聚合历史记录） ======
function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const trendData = computed(() => {
  const days = rangeDays.value
  const buckets = new Map<string, number>()
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    buckets.set(dateKey(d), 0)
  }
  for (const h of prompt.historyItems.value) {
    const key = dateKey(new Date(h.usedAt))
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + 1)
  }
  return [...buckets.entries()].map(([date, count]) => ({ date, count }))
})
const trendMax = computed(() => Math.max(1, ...trendData.value.map(d => d.count)))

// SVG 折线坐标
const CHART_W = 600
const CHART_H = 200
const PAD_X = 30
const PAD_Y = 24
const trendPoints = computed(() => {
  const n = trendData.value.length
  const innerW = CHART_W - PAD_X * 2
  const innerH = CHART_H - PAD_Y * 2
  const xStep = n > 1 ? innerW / (n - 1) : 0
  return trendData.value.map((d, i) => ({
    x: PAD_X + i * xStep,
    y: PAD_Y + innerH - (d.count / trendMax.value) * innerH,
    ...d,
  }))
})
const polylinePoints = computed(() => trendPoints.value.map(p => `${p.x},${p.y}`).join(' '))
const areaPoints = computed(() => {
  const pts = trendPoints.value
  if (!pts.length) return ''
  const baseline = PAD_Y + (CHART_H - PAD_Y * 2)
  return `${PAD_X},${baseline} ${pts.map(p => `${p.x},${p.y}`).join(' ')} ${pts[pts.length - 1].x},${baseline}`
})
// x 轴日期标签（间隔显示，最多 7 个）
const xLabelStep = computed(() => Math.max(1, Math.ceil(trendData.value.length / 7)))

function shortDate(date: string): string {
  // 'YYYY-MM-DD' -> 'M/D'
  const [, m, d] = date.split('-')
  return `${Number(m)}/${Number(d)}`
}
</script>

<template>
  <div class="stats-panel">
    <!-- 统计卡片行 -->
    <div class="stats-cards">
      <div class="stat-card">
        <div class="stat-value">{{ totalCount }}</div>
        <div class="stat-label">总提示词</div>
      </div>
      <div class="stat-card">
        <div class="stat-value accent">{{ totalUsage }}</div>
        <div class="stat-label">累计使用</div>
      </div>
      <div class="stat-card">
        <div class="stat-value warning">{{ favoriteCount }}</div>
        <div class="stat-label">收藏</div>
      </div>
      <div class="stat-card">
        <div class="stat-value success">{{ withVarsCount }}</div>
        <div class="stat-label">含变量</div>
      </div>
    </div>

    <!-- 中部：类型分布 + TOP10 -->
    <div class="stats-mid">
      <div class="panel-card">
        <div class="panel-title">类型分布</div>
        <div class="donut-wrap">
          <svg class="donut" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--pf-surface-raised)" stroke-width="20" />
            <circle
              v-for="s in donutSegments"
              :key="s.type"
              cx="60" cy="60" r="50" fill="none"
              stroke-width="20"
              :stroke="TYPE_COLORS[s.type]"
              :stroke-dasharray="s.dasharray"
              :stroke-dashoffset="s.dashoffset"
              transform="rotate(-90 60 60)"
            />
            <text x="60" y="57" text-anchor="middle" class="donut-total">{{ totalCount }}</text>
            <text x="60" y="73" text-anchor="middle" class="donut-label">提示词</text>
          </svg>
          <div class="legend">
            <div v-for="d in typeDistribution" :key="d.type" class="legend-item">
              <span class="legend-dot" :style="{ background: TYPE_COLORS[d.type] }"></span>
              <span class="legend-label">{{ TYPE_LABELS[d.type] }}</span>
              <span class="legend-count">{{ d.count }}</span>
              <span class="legend-percent">{{ totalCount ? Math.round((d.count / totalCount) * 100) : 0 }}%</span>
            </div>
          </div>
        </div>
      </div>

      <div class="panel-card top-card">
        <div class="panel-title-row">
          <span class="panel-title">使用 TOP10</span>
          <div class="mode-toggle">
            <button :class="['mode-btn', { active: range === 'week' }]" @click="range = 'week'">本周</button>
            <button :class="['mode-btn', { active: range === 'month' }]" @click="range = 'month'">本月</button>
          </div>
        </div>
        <div v-if="topUsage.length" class="top-list">
          <div v-for="(t, i) in topUsage" :key="t.id" class="top-item">
            <span class="top-rank" :class="{ hot: i < 3 }">{{ i + 1 }}</span>
            <span class="top-title">{{ t.title }}</span>
            <div class="top-bar-track">
              <div class="top-bar" :style="{ width: (t.count / topMax) * 100 + '%' }"></div>
            </div>
            <span class="top-count">{{ t.count }}</span>
          </div>
        </div>
        <div v-else class="empty-hint">该时间段暂无使用记录</div>
      </div>
    </div>

    <!-- 趋势折线图 -->
    <div class="panel-card trend-card">
      <div class="panel-title-row">
        <span class="panel-title">使用频次趋势</span>
        <div class="mode-toggle">
          <button :class="['mode-btn', { active: range === 'week' }]" @click="range = 'week'">本周</button>
          <button :class="['mode-btn', { active: range === 'month' }]" @click="range = 'month'">本月</button>
        </div>
      </div>
      <svg class="trend-svg" viewBox="0 0 600 200" preserveAspectRatio="none">
        <!-- 水平网格线 -->
        <line
          v-for="i in 4"
          :key="'g' + i"
          :x1="PAD_X"
          :x2="CHART_W - PAD_X"
          :y1="PAD_Y + ((CHART_H - PAD_Y * 2) / 4) * i"
          :y2="PAD_Y + ((CHART_H - PAD_Y * 2) / 4) * i"
          stroke="var(--pf-border)"
          stroke-width="1"
        />
        <!-- 面积填充 -->
        <polygon v-if="trendPoints.length > 1" :points="areaPoints" fill="var(--pf-accent)" opacity="0.08" />
        <!-- 折线 -->
        <polyline
          :points="polylinePoints"
          fill="none"
          stroke="var(--pf-accent)"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <!-- 数据点 -->
        <circle
          v-for="(p, i) in trendPoints"
          :key="'p' + i"
          :cx="p.x"
          :cy="p.y"
          r="2.5"
          fill="var(--pf-accent)"
        />
        <!-- x 轴日期标签 -->
        <text
          v-for="(p, i) in trendPoints"
          v-show="i % xLabelStep === 0"
          :key="'t' + i"
          :x="p.x"
          :y="CHART_H - 6"
          text-anchor="middle"
          class="trend-label"
        >{{ shortDate(p.date) }}</text>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.stats-panel {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 16px 20px;
  display: flex; flex-direction: column; gap: 14px;
}

/* 卡片行 */
.stats-cards {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 12px; flex-shrink: 0;
}
.stat-card {
  background: var(--pf-bg-elevated);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-radius-md);
  padding: 16px 18px;
  display: flex; flex-direction: column; gap: 4px;
}
.stat-value {
  font-size: 26px; font-weight: 700; color: var(--pf-text);
  font-family: var(--pf-font-mono); line-height: 1;
}
.stat-value.accent { color: var(--pf-accent); }
.stat-value.warning { color: var(--pf-warning); }
.stat-value.success { color: var(--pf-success); }
.stat-label { font-size: 12px; color: var(--pf-text-muted); }

/* 中部两栏 */
.stats-mid {
  display: grid; grid-template-columns: 1fr 1.4fr;
  gap: 12px; flex-shrink: 0;
}
.panel-card {
  background: var(--pf-bg-elevated);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-radius-md);
  padding: 16px 18px;
  min-height: 220px;
}
.panel-title { font-size: 13px; font-weight: 700; color: var(--pf-text); }
.panel-title-row {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}

/* 饼图 */
.donut-wrap { display: flex; align-items: center; gap: 20px; margin-top: 8px; }
.donut { width: 130px; height: 130px; flex-shrink: 0; }
.donut-total { font-size: 24px; font-weight: 700; fill: var(--pf-text); font-family: var(--pf-font-mono); }
.donut-label { font-size: 9px; fill: var(--pf-text-muted); }
.legend { flex: 1; display: flex; flex-direction: column; gap: 10px; }
.legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.legend-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.legend-label { color: var(--pf-text-secondary); flex: 1; }
.legend-count { color: var(--pf-text); font-weight: 600; font-family: var(--pf-font-mono); }
.legend-percent { color: var(--pf-text-faint); font-family: var(--pf-font-mono); font-size: 11px; min-width: 36px; text-align: right; }

/* TOP10 列表 */
.top-list { display: flex; flex-direction: column; gap: 7px; }
.top-item { display: flex; align-items: center; gap: 10px; }
.top-rank {
  width: 20px; height: 20px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; font-family: var(--pf-font-mono);
  color: var(--pf-text-muted);
  background: var(--pf-surface-raised);
  border-radius: 50%;
}
.top-rank.hot { background: var(--pf-accent-soft); color: var(--pf-accent); }
.top-title {
  width: 130px; flex-shrink: 0; font-size: 12px;
  color: var(--pf-text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.top-bar-track {
  flex: 1; height: 8px; border-radius: 4px;
  background: var(--pf-surface-raised); overflow: hidden;
}
.top-bar {
  height: 100%; border-radius: 4px;
  background: var(--pf-gradient);
  transition: width 0.3s ease;
}
.top-count {
  width: 26px; flex-shrink: 0; text-align: right;
  font-size: 12px; font-weight: 600; font-family: var(--pf-font-mono);
  color: var(--pf-accent);
}
.empty-hint {
  display: flex; align-items: center; justify-content: center;
  height: 160px; font-size: 13px; color: var(--pf-text-faint);
}

/* 趋势图 */
.trend-card { min-height: 240px; }
.trend-svg { width: 100%; height: 200px; display: block; margin-top: 8px; }
.trend-label { font-size: 9px; fill: var(--pf-text-faint); font-family: var(--pf-font-mono); }
</style>
