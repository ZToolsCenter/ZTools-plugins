<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
  import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    ArcElement,
    Tooltip,
    Legend,
    Filler
  } from 'chart.js';
  import { Bar, Line, Pie } from 'vue-chartjs';
  import { MatrixController, MatrixElement } from 'chartjs-chart-matrix';

  ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    ArcElement,
    Tooltip,
    Legend,
    Filler,
    MatrixController,
    MatrixElement
  );

  const props = defineProps({
    type: { type: String, required: true }, // "bar" | "line" | "pie" | "matrix"
    data: { type: Object, required: true }, // Chart.js data
    options: { type: Object, default: () => ({}) }, // Chart.js options
    height: { type: String, default: '260px' }
  });

  const componentMap = { bar: Bar, line: Line, pie: Pie };
  const chartComp = computed(() => componentMap[props.type] || null);

  // ── matrix: 手动管理 Chart.js 实例 ──
  const canvasRef = ref(null);
  let chartInstance = null;

  function createMatrixChart() {
    if (!canvasRef.value) return;
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    chartInstance = new ChartJS(canvasRef.value, {
      type: 'matrix',
      data: props.data,
      options: props.options
    });
  }

  onMounted(() => {
    if (props.type === 'matrix') createMatrixChart();
  });

  watch(
    () => [props.data, props.options],
    () => {
      if (props.type === 'matrix') {
        if (chartInstance) {
          chartInstance.data = props.data;
          chartInstance.options = props.options;
          chartInstance.update();
        } else {
          createMatrixChart();
        }
      }
    },
    { flush: 'post' }
  );

  onBeforeUnmount(() => {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  });
</script>

<template>
  <div class="chart-wrap" :class="{ matrix: type === 'matrix' }" :style="{ height }">
    <template v-if="chartComp">
      <component :is="chartComp" :data="data" :options="options" />
    </template>
    <template v-else-if="type === 'matrix'">
      <canvas ref="canvasRef"></canvas>
    </template>
  </div>
</template>

<style scoped>
  .chart-wrap {
    position: relative;
    width: 100%;
  }
  .chart-wrap:deep(canvas) {
    width: 100% !important;
    height: 100% !important;
  }
  .chart-wrap.matrix :deep(canvas) {
    width: auto !important;
    height: auto !important;
  }
</style>
