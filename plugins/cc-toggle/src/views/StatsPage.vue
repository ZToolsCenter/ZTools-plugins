<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { onMounted, computed } from 'vue';
  import { useRouter } from 'vue-router';
  import { useStats } from '../composables/useStats';
  import { themeVars } from '../composables/useTheme';
  import EChart from '../components/common/EChart.vue';

  const dialog = useDialog();
  const message = useMessage();

  const router = useRouter();
  const {
    APP_TYPES,
    APP_LABELS,
    filter,
    stats,
    rawDaily,
    refreshing,
    initialLoading,
    refresh,
    setAppType,
    setDays,
    clearStats,
    cacheHitRate
  } = useStats();

  const DAY_OPTIONS = [
    { v: 7, label: '近 7 天' },
    { v: 30, label: '近 30 天' },
    { v: 0, label: '全部' }
  ];

  // 无缓存：进页直接扫描本地日志（异步不卡 UI），切换 agent/天数在内存中过滤
  onMounted(() => {
    refresh().then(r => {
      if (r.error) message.error(r.error);
    });
  });

  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万';
    return n.toLocaleString('en-US');
  }

  const hitRate = computed(() => (cacheHitRate() * 100).toFixed(1));
  const hasData = computed(() => stats.value.totals.requests > 0);

  function onClear() {
    dialog.warning({
      title: '清除统计',
      content:
        '确定清除' +
        APP_LABELS[filter.appType] +
        '的统计数据吗？将隐藏此刻之前的历史用量，之后的用量会继续统计。',
      positiveText: '清除',
      negativeText: '取消',
      onPositiveClick: function () {
        clearStats(filter.appType).then(function (r) {
          if (r.success) message.success('已清除统计数据');
          else message.error('清除失败' + (r.error ? '：' + r.error : ''));
        });
      }
    });
  }

  // ── 图表配置（Chart.js，颜色跟随主题，全部读缓存不查 DOM） ──
  const trendData = computed(() => {
    const p = themeVars.primaryRgba;
    const s = themeVars.success;
    const daily = stats.value.daily;
    const labels = [],
      inp = [],
      out = [],
      cache = [];
    for (const d of daily) {
      labels.push(d.day.slice(5));
      inp.push(d.input || 0);
      out.push(d.output || 0);
      cache.push(d.cacheRead || 0);
    }
    return {
      labels,
      datasets: [
        { label: '输入', type: 'bar', data: inp, backgroundColor: p(0.85), stack: 'tok', order: 2 },
        { label: '输出', type: 'bar', data: out, backgroundColor: s, stack: 'tok', order: 2 },
        {
          label: '缓存命中',
          type: 'line',
          data: cache,
          borderColor: p(0.7),
          backgroundColor: p(0.12),
          tension: 0.3,
          fill: false,
          order: 1
        }
      ]
    };
  });

  const trendOpts = computed(() => {
    const m = themeVars.textMuted;
    const grid = themeVars.primaryRgba(0.08);
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: m, boxWidth: 12, padding: 12 } },
        tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + fmt(ctx.parsed.y) } }
      },
      scales: {
        x: { ticks: { color: m } },
        y: { ticks: { color: m, callback: v => fmt(v) }, grid: { color: grid }, stacked: true }
      }
    };
  });

  const modelBarData = computed(() => {
    const list = stats.value.models.slice(0, 8).reverse();
    return {
      labels: list.map(m => m.model),
      datasets: [
        {
          data: list.map(m => m.total),
          backgroundColor: themeVars.primaryRgba(0.8),
          borderRadius: 4,
          barPercentage: 0.6
        }
      ]
    };
  });

  const modelBarOpts = computed(() => {
    const m = themeVars.textMuted;
    const grid = themeVars.primaryRgba(0.08);
    return {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => 'Tokens: ' + fmt(ctx.parsed.x) } }
      },
      scales: {
        x: { ticks: { color: m, callback: v => fmt(v) }, grid: { color: grid } },
        y: { ticks: { color: m }, grid: { display: false } }
      }
    };
  });

  const cacheData = computed(() => {
    const t = stats.value.totals;
    return {
      labels: ['缓存命中', '新增输入'],
      datasets: [
        {
          data: [t.cacheRead || 0, t.input || 0],
          backgroundColor: [themeVars.primaryRgba(0.6), themeVars.primaryRgba(0.85)],
          borderWidth: 0
        }
      ]
    };
  });

  const cacheOpts = computed(() => {
    const m = themeVars.textMuted;
    return {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '55%',
      plugins: {
        legend: { position: 'bottom', labels: { color: m, boxWidth: 12, padding: 12 } },
        tooltip: {
          callbacks: {
            label: ctx =>
              ctx.label +
              ': ' +
              fmt(ctx.parsed) +
              ' (' +
              Math.round((ctx.parsed / ctx.dataset.data.reduce((a, b) => a + b, 0)) * 100) +
              '%)'
          }
        }
      }
    };
  });

  // ── 热力图数据（Chart.js matrix，始终展示近一年，不受天数过滤器影响） ──
  function fmtDayLocal(d) {
    return (
      d.getFullYear() +
      '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) +
      '-' +
      ('0' + d.getDate()).slice(-2)
    );
  }

  // 周标签（中文星期）
  const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

  const heatmapData = computed(() => {
    // 按 agent 过滤，聚合每日总量
    const dayMap = {};
    for (const rec of rawDaily.value) {
      if (filter.appType !== 'all' && rec.appType !== filter.appType) continue;
      dayMap[rec.day] = (dayMap[rec.day] || 0) + (rec.total || 0);
    }

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // 回退到最近的周日起点（与 GitHub 热力图对齐）
    start.setDate(start.getDate() - 364);
    const startDow = start.getDay();
    if (startDow !== 0) start.setDate(start.getDate() - startDow);

    const points = [];
    const months = []; // { label, weekIdx } 用于 x 轴月份标签
    let lastMonth = -1;
    let weekIdx = 0;
    let dow = 0;

    for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
      const key = fmtDayLocal(d);
      if (dow === 0 && d.getDate() <= 7 && d.getMonth() !== lastMonth) {
        months.push({ label: d.getMonth() + 1 + '月', weekIdx });
        lastMonth = d.getMonth();
      }
      points.push({ x: weekIdx, y: dow, v: key in dayMap ? dayMap[key] : 0, d: key });
      dow++;
      if (dow > 6) {
        dow = 0;
        weekIdx++;
      }
    }

    // 当月没有周日落在循环内时（如 8 月 1 日是周六），补上当月标签
    const nowMonth = now.getMonth();
    if (lastMonth !== nowMonth) {
      months.push({ label: nowMonth + 1 + '月', weekIdx: dow > 0 ? weekIdx : weekIdx - 1 });
    }

    return { points, months, totalWeeks: weekIdx + (dow > 0 ? 1 : 0) };
  });

  // ── 热力图颜色（读缓存，不查 DOM） ──
  function heatmapColor(v) {
    if (!v || v <= 0) return 'rgba(148,163,184,.12)';
    const p = themeVars.primaryRgba;
    if (v < 1e4) return p(0.2);
    if (v < 5e4) return p(0.4);
    if (v < 2e5) return p(0.65);
    return p(0.9);
  }

  const HEATMAP_LEVELS = [0, 0.2, 0.4, 0.65, 0.9];

  const heatmapChartData = computed(() => ({
    datasets: [
      {
        type: 'matrix',
        data: heatmapData.value.points,
        width: ({ chart }) => {
          const area = chart.chartArea || {};
          return (area.width || 0) / (heatmapData.value.totalWeeks || 53) - 1.5;
        },
        height: ({ chart }) => {
          const area = chart.chartArea || {};
          return (area.height || 0) / 7 - 1.5;
        },
        backgroundColor(ctx) {
          return heatmapColor(ctx.dataset.data[ctx.dataIndex]?.v);
        },
        borderRadius: 2,
        borderWidth: 0
      }
    ]
  }));

  const heatmapChartOpts = computed(() => {
    const muted = themeVars.textMuted;
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 22, left: 20, right: 10, bottom: 4 }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title(items) {
              return items[0]?.raw?.d || '';
            },
            label(ctx) {
              const v = ctx.raw.v || 0;
              return v >= 1e4
                ? (v / 1e4).toFixed(1) + ' 万 tokens'
                : v.toLocaleString() + ' tokens';
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          offset: true,
          position: 'top',
          min: -0.5,
          max: heatmapData.value.totalWeeks - 0.5,
          afterBuildTicks(axis) {
            const monthWeeks = heatmapData.value.months.map(m => m.weekIdx);
            axis.ticks = monthWeeks.map(v => ({ value: v }));
          },
          ticks: {
            color: muted,
            stepSize: 1,
            autoSkip: false,
            maxRotation: 0,
            callback(v) {
              const m = heatmapData.value.months.find(m => m.weekIdx === v);
              return m ? m.label : '';
            }
          },
          grid: { display: false },
          border: { display: false }
        },
        y: {
          type: 'linear',
          offset: true,
          position: 'left',
          min: -0.5,
          max: 6.5,
          reverse: true,
          afterBuildTicks(axis) {
            axis.ticks = [1, 3, 5].map(v => ({ value: v }));
          },
          ticks: {
            color: muted,
            autoSkip: false,
            callback(v) {
              return WEEK_LABELS[v] || '';
            }
          },
          grid: { display: false },
          border: { display: false }
        }
      }
    };
  });
</script>

<template>
  <div class="page">
    <n-page-header title="用量统计" @back="router.push('/')">
      <template #extra>
        <n-space :size="6">
          <n-button size="small" quaternary :disabled="refreshing" @click="refresh">
            <span :class="{ spin: refreshing }">↻</span> {{ refreshing ? '扫描中…' : '刷新' }}
          </n-button>
          <n-button size="small" quaternary type="error" @click="onClear">清除统计</n-button>
        </n-space>
      </template>
    </n-page-header>

    <div class="stats-filters">
      <div class="seg">
        <button
          class="seg-btn"
          :class="{ on: filter.appType === 'all' }"
          @click="setAppType('all')"
        >
          全部
        </button>
        <button
          v-for="t in APP_TYPES"
          :key="t"
          class="seg-btn"
          :class="{ on: filter.appType === t }"
          @click="setAppType(t)"
        >
          {{ APP_LABELS[t] }}
        </button>
      </div>
      <div class="seg">
        <button
          v-for="o in DAY_OPTIONS"
          :key="o.v"
          class="seg-btn"
          :class="{ on: filter.days === o.v }"
          @click="setDays(o.v)"
        >
          {{ o.label }}
        </button>
      </div>
    </div>

    <div v-if="hasData" class="stats-body">
      <div class="cards">
        <div class="card">
          <div class="card-label">真实消耗 Tokens</div>
          <div class="card-num">{{ fmt(stats.totals.total) }}</div>
        </div>
        <div class="card">
          <div class="card-label">总请求数</div>
          <div class="card-num">{{ fmt(stats.totals.requests) }}</div>
        </div>
        <div class="card">
          <div class="card-label">新增输入</div>
          <div class="card-num">{{ fmt(stats.totals.input) }}</div>
        </div>
        <div class="card">
          <div class="card-label">Output</div>
          <div class="card-num">{{ fmt(stats.totals.output) }}</div>
        </div>
        <div class="card">
          <div class="card-label">缓存创建</div>
          <div class="card-num">{{ fmt(stats.totals.cacheCreate) }}</div>
        </div>
        <div class="card">
          <div class="card-label">缓存命中</div>
          <div class="card-num">{{ fmt(stats.totals.cacheRead) }}</div>
        </div>
        <div class="card card--accent">
          <div class="card-label">缓存命中率</div>
          <div class="card-num">{{ hitRate }}%</div>
        </div>
      </div>

      <div class="panels">
        <div class="panel panel--wide">
          <div class="panel-title">Token 消耗热力图</div>
          <div class="heatmap-wrap">
            <EChart
              type="matrix"
              :data="heatmapChartData"
              :options="heatmapChartOpts"
              height="150px"
            />
            <div class="heatmap-legend">
              <span class="legend-label">少</span>
              <span
                v-for="(a, i) in HEATMAP_LEVELS"
                :key="i"
                class="legend-box"
                :style="{
                  background: a === 0 ? 'rgba(148,163,184,.12)' : themeVars.primaryRgba(a)
                }"
              ></span>
              <span class="legend-label">多</span>
            </div>
          </div>
        </div>
        <div class="panel panel--wide">
          <div class="panel-title">Token 趋势</div>
          <EChart type="bar" :data="trendData" :options="trendOpts" height="240px" />
        </div>
        <div class="panel panel--wide">
          <div class="panel-title">模型用量排行</div>
          <EChart type="bar" :data="modelBarData" :options="modelBarOpts" height="260px" />
        </div>
        <div class="panel">
          <div class="panel-title">缓存命中占比</div>
          <EChart type="pie" :data="cacheData" :options="cacheOpts" height="240px" />
        </div>
        <div class="panel">
          <div class="panel-title">模型分布</div>
          <div class="model-list">
            <div v-if="!stats.models.length" class="model-empty">暂无模型数据</div>
            <div v-for="m in stats.models.slice(0, 8)" :key="m.model" class="model-row">
              <span class="model-name" :title="m.model">{{ m.model }}</span>
              <span class="model-val">{{ fmt(m.total) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="initialLoading" class="empty">
      <div class="loading-spinner"></div>
      <div class="empty-title">正在扫描日志…</div>
      <div class="empty-desc">首次加载需要扫描本地会话日志，请稍候</div>
    </div>

    <div v-else class="empty">
      <div class="empty-icon">📊</div>
      <div class="empty-title">暂无统计数据</div>
      <div class="empty-desc">
        用量数据来自 Claude Code / Codex 的本地会话日志。<br />使用过对应 CLI
        后，点击右上角「刷新」即可汇总用量。
      </div>
    </div>
  </div>
</template>

<style scoped>
  .page {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* n-page-header 统一样式 */
  .page :deep(.n-page-header) {
    padding: 8px 16px;
    min-height: 44px;
    border-bottom: 1px solid var(--border);
  }
  .page :deep(.n-page-header__title) {
    font-size: 14px !important;
    font-weight: 600;
  }
  .page :deep(.n-page-header__back) {
    margin-right: 8px;
  }
  .page :deep(.n-page-header__back:hover) {
    color: var(--primary);
  }
  .page :deep(.n-page-header .n-button) {
    font-size: 12px;
  }

  .stats-filters {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    padding: 4px 14px 8px;
  }
  .seg {
    display: flex;
    gap: 2px;
    background: var(--bg-hover);
    padding: 3px;
    border-radius: 9px;
  }
  .seg-btn {
    border: none;
    background: none;
    color: var(--text-secondary);
    padding: 4px 12px;
    border-radius: 7px;
    cursor: pointer;
    font-size: 12px;
  }
  .seg-btn:hover {
    color: var(--text);
  }
  .seg-btn.on {
    background: var(--primary);
    color: #fff;
  }

  .stats-body {
    flex: 1;
    overflow-y: auto;
    padding: 4px 14px 14px;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
    margin-bottom: 12px;
  }
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
  }
  .card--accent {
    border-color: var(--primary);
  }
  .card-label {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  .card-num {
    font-size: 20px;
    font-weight: 700;
    color: var(--text);
  }

  .panels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .panel {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
  }
  .panel--wide {
    grid-column: 1 / -1;
  }
  .panel-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }
  .heatmap-wrap {
    width: 100%;
    overflow-x: auto;
  }
  .heatmap-legend {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 3px;
    margin-top: 6px;
  }
  .legend-label {
    font-size: 11px;
    color: var(--text-muted);
    margin: 0 2px;
  }
  .legend-box {
    width: 12px;
    height: 12px;
    border-radius: 2px;
  }

  .model-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .model-empty {
    color: var(--text-muted);
    font-size: 12px;
    padding: 12px 0;
    text-align: center;
  }
  .model-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 8px;
    background: var(--bg-hover);
    border-radius: 6px;
  }
  .model-name {
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 65%;
  }
  .model-val {
    font-size: 12px;
    font-weight: 600;
    color: var(--primary);
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-muted);
  }
  .empty-icon {
    font-size: 40px;
  }
  .empty-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .empty-desc {
    font-size: 12px;
    text-align: center;
    line-height: 1.6;
  }
  .loading-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .spin {
    display: inline-block;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
