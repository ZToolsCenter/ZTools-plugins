<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useFavorites, type GradientStop, type LinearGradient } from "@/utils/favorites";
import { colorToCSS } from "@/utils/favorites";
import { useMessage } from "@/utils/message";

const favorites = useFavorites();
const message = useMessage();

// ── 预览容器尺寸（用于精确计算圆点位置） ──

const previewRef = ref<HTMLElement>();
const box = reactive({ w: 800, h: 192 });

onMounted(() => {
  if (!previewRef.value) return;
  const update = () => {
    if (!previewRef.value) return;
    box.w = previewRef.value.clientWidth || 800;
    box.h = previewRef.value.clientHeight || 192;
  };
  update();
  const obs = new ResizeObserver(update);
  obs.observe(previewRef.value);
});

// ── 方向 / 角度 ──

/** 预设方向（角度 + 标签） */
const presets = [
  { angle: 0, label: "↑", title: "向上" },
  { angle: 45, label: "↗", title: "右上" },
  { angle: 90, label: "→", title: "向右" },
  { angle: 135, label: "↘", title: "右下" },
  { angle: 180, label: "↓", title: "向下" },
  { angle: 225, label: "↙", title: "左下" },
  { angle: 270, label: "←", title: "向左" },
  { angle: 315, label: "↖", title: "左上" },
];

const angle = ref(90);

const safeAngle = computed(() => {
  if (typeof angle.value !== "number" || isNaN(angle.value)) {
    return 90;
  }
  return angle.value;
});

/** 角度 → CSS 方向字符串 */
const directionCSS = computed(() => `${safeAngle.value}deg`);

/** 点击预设：设置角度 */
const setAngle = (a: number) => {
  angle.value = a;
};

// ── 渐变状态 ──

const stops = ref<GradientStop[]>([
  { color: "#FF6B6B", position: 0 },
  { color: "#4ECDC4", position: 100 },
]);

/** 当前渐变的 LinearGradient 对象 */
const currentGradient = computed<LinearGradient>(() => ({
  type: "linear-gradient",
  direction: directionCSS.value,
  stops: [...stops.value].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
}));

/** 渲染用的 CSS 字符串 */
const gradientCSS = computed(() => colorToCSS(currentGradient.value));

/** 渐变预览条的 CSS */
const previewStops = computed(() => {
  const sorted = [...stops.value].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return sorted.map((s) => `${s.color} ${s.position ?? 0}%`).join(", ");
});

/**
 * 根据角度 + 容器实际宽高，计算每个色标圆点在预览区域中的 (x%, y%) 位置
 *
 * CSS 渐变线几何：
 *   1. 方向向量 d = (sin θ, -cos θ)（屏幕坐标，y 向下）
 *   2. 线从矩形中心出发，沿 ±d 方向延伸到与矩形边界的交点
 *   3. 交点距离 t_max = min(W/(2|dx|), H/(2|dy|))
 *   4. 起点（0%）= 中心 - d·t_max，终点（100%）= 中心 + d·t_max
 *   5. 色标按 position% 插值，最后转换为百分比坐标
 */
interface DotPos {
  x: number;
  y: number;
  color: string;
  position: number;
}
const dotPositions = computed<DotPos[]>(() => {
  const rad = (angle.value * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const W = box.w;
  const H = box.h;

  // 渐变线半长（像素），确保线段刚好覆盖矩形
  let tMax: number;
  if (absDx < 0.0001 && absDy < 0.0001) {
    tMax = 0;
  } else if (absDx < 0.0001) {
    tMax = H / 2;
  } else if (absDy < 0.0001) {
    tMax = W / 2;
  } else {
    tMax = Math.min(W / (2 * absDx), H / (2 * absDy));
  }

  // 起点和终点（像素，原点在左上角）
  const xStart = W / 2 - dx * tMax;
  const yStart = H / 2 - dy * tMax;
  const xEnd = W / 2 + dx * tMax;
  const yEnd = H / 2 + dy * tMax;

  return [...stops.value]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((s) => {
      const p = (s.position ?? 0) / 100;
      return {
        x: ((xStart + (xEnd - xStart) * p) / W) * 100,
        y: ((yStart + (yEnd - yStart) * p) / H) * 100,
        color: s.color,
        position: s.position ?? 0,
      };
    });
});

// ── 色标操作 ──

/** 添加色标（在中间位置插入） */
const addStop = () => {
  if (stops.value.length >= 8) {
    message.warning("最多支持 8 个色标");
    return;
  }
  const sorted = [...stops.value].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  let newPos = 50;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]?.position ?? 0;
    const b = sorted[i + 1]?.position ?? 0;
    if (b - a >= 2) {
      newPos = Math.round((a + b) / 2);
      break;
    }
  }
  const mixIndex = sorted.findIndex((s) => (s.position ?? 0) >= newPos);
  const mixColor = mixIndex >= 0 ? (sorted[mixIndex]?.color ?? "#888888") : "#888888";
  stops.value.push({ color: mixColor, position: newPos });
};

/** 移除色标（至少保留 2 个） */
const removeStop = (index: number) => {
  if (stops.value.length <= 2) {
    message.warning("至少需要 2 个色标");
    return;
  }
  stops.value.splice(index, 1);
};

/** 移动色标位置 */
const updatePosition = (index: number, pos: number) => {
  if (!stops.value[index]) return;
  stops.value[index].position = pos;
};

/** 更新色标颜色 */
const updateColor = (index: number, color: string) => {
  if (!stops.value[index]) return;
  stops.value[index].color = color;
};

// ── 收藏操作 ──

const addToFavorites = () => {
  try {
    favorites.addFavorite(currentGradient.value);
    message.success("已添加到收藏");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "添加失败");
  }
};

/** 复制 CSS */
const copyCSS = async () => {
  try {
    await navigator.clipboard.writeText(gradientCSS.value);
    message.success("已复制 CSS");
  } catch {
    message.error("复制失败");
  }
};

/** 重置为默认渐变 */
const reset = () => {
  angle.value = 90;
  stops.value = [
    { color: "#FF6B6B", position: 0 },
    { color: "#4ECDC4", position: 100 },
  ];
};
</script>

<template>
  <div class="space-y-6">
    <!-- 渐变预览 -->
    <div
      ref="previewRef"
      class="relative h-48 w-full overflow-hidden rounded-2xl shadow-lg"
      :style="{
        background: `linear-gradient(${directionCSS}, ${previewStops})`,
      }"
    >
      <div class="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/20 to-transparent" />
      <div
        v-for="(dot, i) in dotPositions"
        :key="i"
        class="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-2 ring-black/10"
        :style="{
          left: `${dot.x}%`,
          top: `${dot.y}%`,
          backgroundColor: dot.color,
        }"
      />
    </div>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- 左侧：方向 + 色标编辑 -->
      <div class="space-y-6">
        <!-- 方向选择 -->
        <div class="rounded-xl bg-white p-5 shadow-md">
          <h3 class="mb-3 text-sm font-semibold text-gray-500">渐变方向</h3>

          <!-- 角度滑块 + 数值输入 -->
          <div class="mb-4 flex items-center gap-3">
            <input
              type="range"
              v-model.number="angle"
              min="0"
              max="360"
              step="1"
              class="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 accent-blue-500"
            />
            <div class="flex items-center gap-1">
              <input
                :value.number="angle"
                @input="
                  {
                    let newAngle = parseInt(($event.target as HTMLInputElement).value);
                    if (!isNaN(newAngle)) {
                      angle = newAngle;
                    }
                  }
                "
                @change="
                  $event.target &&
                  'value' in $event.target &&
                  ($event.target.value = angle.toString())
                "
                type="number"
                min="0"
                max="360"
                step="1"
                class="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-center font-mono text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:outline-none"
              />
              <span class="text-xs text-gray-400">°</span>
            </div>
          </div>

          <!-- 8 个预设快捷按钮 -->
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="p in presets"
              :key="p.angle"
              @click="setAngle(p.angle)"
              :class="[
                'flex h-10 items-center justify-center rounded-lg text-lg font-bold transition-all',
                angle === p.angle
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              ]"
              :title="`${p.title} (${p.angle}°)`"
            >
              {{ p.label }}
            </button>
          </div>
        </div>

        <!-- 色标编辑 -->
        <div class="rounded-xl bg-white p-5 shadow-md">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-gray-500">色标</h3>
            <button
              @click="addStop"
              class="flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path stroke-linecap="round" d="M12 5v14M5 12h14" />
              </svg>
              添加
            </button>
          </div>

          <div class="space-y-3">
            <div
              v-for="(stop, index) in stops"
              :key="index"
              class="flex items-center gap-3 rounded-lg bg-gray-50 p-3"
            >
              <!-- 颜色选择器 -->
              <input
                type="color"
                :value="stop.color"
                @input="updateColor(index, ($event.target as HTMLInputElement).value)"
                class="h-9 w-9 cursor-pointer rounded-lg border-0 p-0"
              />
              <!-- Hex 输入 -->
              <input
                :value="stop.color"
                @input="updateColor(index, ($event.target as HTMLInputElement).value)"
                class="w-24 rounded-lg border border-gray-200 px-2 py-1.5 font-mono text-sm uppercase focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:outline-none"
                maxlength="7"
                spellcheck="false"
              />
              <!-- 位置滑块 -->
              <div class="flex flex-1 items-center gap-2">
                <input
                  type="range"
                  :value="stop.position ?? 0"
                  @input="updatePosition(index, Number(($event.target as HTMLInputElement).value))"
                  min="0"
                  max="100"
                  class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 accent-blue-500"
                />
                <span class="w-10 text-right text-xs text-gray-500">{{ stop.position ?? 0 }}%</span>
              </div>
              <!-- 删除按钮 -->
              <button
                @click="removeStop(index)"
                :disabled="stops.length <= 2"
                :class="[
                  'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                  stops.length <= 2
                    ? 'cursor-not-allowed text-gray-300'
                    : 'text-gray-400 hover:bg-red-50 hover:text-red-500',
                ]"
                title="删除色标"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path stroke-linecap="round" d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：CSS 预览 + 操作 -->
      <div class="space-y-6">
        <!-- CSS 输出 -->
        <div class="rounded-xl bg-white p-5 shadow-md">
          <h3 class="mb-3 text-sm font-semibold text-gray-500">CSS</h3>
          <div
            class="cursor-pointer rounded-lg bg-gray-50 p-4 font-mono text-sm text-gray-700 transition-colors hover:bg-gray-100"
            @click="copyCSS"
            title="点击复制"
          >
            {{ gradientCSS }}
          </div>
          <p class="mt-2 text-xs text-gray-400">点击复制 CSS 代码</p>
        </div>

        <!-- 操作按钮 -->
        <div class="rounded-xl bg-white p-5 shadow-md">
          <h3 class="mb-3 text-sm font-semibold text-gray-500">操作</h3>
          <div class="space-y-3">
            <button
              @click="addToFavorites"
              class="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-pink-500 to-red-500 px-4 py-3 text-white shadow-md transition-all hover:from-pink-600 hover:to-red-600 hover:shadow-lg"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                />
              </svg>
              <span class="font-medium">收藏渐变</span>
            </button>
            <button
              @click="copyCSS"
              class="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-700 transition-colors hover:bg-gray-50"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              <span class="text-sm">复制 CSS</span>
            </button>
            <button
              @click="reset"
              class="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-700 transition-colors hover:bg-gray-50"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span class="text-sm">重置</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
