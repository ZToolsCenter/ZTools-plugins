<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useFavorites, type HexColor } from "@/utils/favorites";
import { useMessage } from "@/utils/message";
import zToolsApi from "@/utils/ztoolsapi";

const message = useMessage();
const favorites = useFavorites();

// ── 模型 ──

interface AiModel {
  id: string;
  label: string;
  description: string;
  icon: string;
  cost: number;
}

const models = ref<AiModel[]>([]);
const selectedModelId = ref("");
const loadingModels = ref(true);
const loadFailed = ref(false);
const currentModelLabel = ref("");

const noModels = () => !loadingModels.value && models.value.length === 0;

const loadModels = async () => {
  try {
    const list = await zToolsApi.allAiModels();
    models.value = list;
    loadFailed.value = false;
    if (list.length > 0) {
      const first = list[0]!;
      selectedModelId.value = first.id;
      currentModelLabel.value = first.label;
    }
  } catch {
    loadFailed.value = true;
    message.warning("获取模型列表失败");
  } finally {
    loadingModels.value = false;
  }
};

const onModelChange = () => {
  const m = models.value.find((m) => m.id === selectedModelId.value);
  currentModelLabel.value = m?.label ?? "";
};

onMounted(loadModels);

// ── 状态 ──

const colorCount = ref(4);
const prompt = ref("");
const isLoading = ref(false);
const abortController = ref<ReturnType<typeof zToolsApi.ai> | null>(null);

interface AiColor {
  hex: string;
  name: string;
}

const resultColors = ref<AiColor[]>([]);
const resultPrompt = ref("");

// ── 内置提示词 ──

const builtInPrompts = [
  "日落海滩",
  "赛博朋克",
  "森林清晨",
  "樱花季节",
  "深海探索",
  "复古怀旧",
  "极光幻彩",
  "水墨中国",
  "热带雨林",
  "星空银河",
  "奶油蛋糕",
  "秋日暖阳",
];

// ── 核心逻辑 ──

const systemPrompt = `你是一个专业的配色设计师。用户会告诉你一个主题，你需要为该主题生成一组协调的颜色。

规则：
1. 生成的颜色数量必须严格等于用户指定的数量
2. 每个颜色必须是有效的 HEX 格式（如 #FF5733）
3. 颜色之间要有良好的视觉协调性
4. 给每个颜色起一个简短的中文名称

必须严格返回以下 JSON 格式，不要包含任何其他文字：
{"colors":[{"hex":"#RRGGBB","name":"颜色名称"}]}`;

const generateColors = async () => {
  if (noModels()) {
    message.warning("未检测到可用模型，请先在 ZTools 设置中配置 AI 模型");
    return;
  }

  if (!selectedModelId.value) {
    message.warning("请选择一个 AI 模型");
    return;
  }

  if (!prompt.value.trim()) {
    message.warning("请输入配色主题");
    return;
  }

  if (isLoading.value) {
    // 正在生成则取消
    abortController.value?.abort();
    isLoading.value = false;
    return;
  }

  isLoading.value = true;
  resultColors.value = [];
  resultPrompt.value = prompt.value.trim();

  try {
    const result = await zToolsApi.ai({
      model: selectedModelId.value || undefined,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `主题：${prompt.value.trim()}\n颜色数量：${colorCount.value}`,
        },
      ],
    });

    // 解析 AI 返回的 JSON
    const content = result.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*"colors"[\s\S]*\}/);
    if (!jsonMatch) {
      message.error("AI 返回格式异常，请重试,或更换模型");
      return;
    }

    const parsed = JSON.parse(jsonMatch[0]) as { colors: AiColor[] };

    // 校验颜色数量
    if (!Array.isArray(parsed.colors) || parsed.colors.length === 0) {
      message.error("AI 未返回有效颜色");
      return;
    }

    // 截取到指定数量，校验 HEX 格式
    resultColors.value = parsed.colors
      .slice(0, colorCount.value)
      .filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c.hex))
      .map((c) => ({
        hex: c.hex.toUpperCase(),
        name: c.name || "未命名",
      }));

    if (resultColors.value.length === 0) {
      message.error("未解析到有效颜色");
      return;
    }

    message.success(`生成了 ${resultColors.value.length} 个颜色`);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      message.info("已取消生成");
    } else {
      message.error(`生成失败：${err?.message ?? err}`);
    }
  } finally {
    isLoading.value = false;
  }
};

// ── 内置提示词点击 ──

const applyBuiltInPrompt = (text: string) => {
  if (prompt.value) {
    prompt.value += `、${text}`;
  } else {
    prompt.value = text;
  }
};

// ── 复制颜色值 ──

const copyHex = async (hex: string) => {
  try {
    await navigator.clipboard.writeText(hex);
    message.success(`已复制 ${hex}`);
  } catch {
    message.error("复制失败");
  }
};

// ── 复制所有颜色为 CSS 变量 ──

const copyAsCSS = async () => {
  if (resultColors.value.length === 0) return;
  const lines = resultColors.value.map((c, i) => `  --color-${i + 1}: ${c.hex}; /* ${c.name} */`);
  const css = `:root {\n${lines.join("\n")}\n}`;
  try {
    await navigator.clipboard.writeText(css);
    message.success("已复制 CSS 变量");
  } catch {
    message.error("复制失败");
  }
};

// ── 复制为数组 ──

const copyAsArray = async () => {
  if (resultColors.value.length === 0) return;
  const arr = resultColors.value.map((c) => c.hex);
  try {
    await navigator.clipboard.writeText(JSON.stringify(arr));
    message.success("已复制颜色数组");
  } catch {
    message.error("复制失败");
  }
};

// ── 收藏 ──

/** 将单个颜色加入收藏 */
const favoriteColor = (hex: string, name: string) => {
  try {
    const color: HexColor = { type: "hex", hex };
    favorites.addFavorite(color, [resultPrompt.value, name]);
    message.success(`已收藏 ${hex}`);
  } catch (err: any) {
    message.warning(err?.message ?? "收藏失败");
  }
};

/** 将全部颜色一次性加入收藏 */
const favoriteAll = () => {
  let added = 0;
  for (const c of resultColors.value) {
    try {
      const color: HexColor = { type: "hex", hex: c.hex };
      favorites.addFavorite(color, [resultPrompt.value, c.name]);
      added++;
    } catch {
      // 跳过重复项
    }
  }
  if (added > 0) {
    message.success(`已收藏 ${added} 个颜色`);
  } else {
    message.info("所有颜色已在收藏中");
  }
};

// ── 清空结果 ──

const clearResult = () => {
  resultColors.value = [];
  resultPrompt.value = "";
};
</script>

<template>
  <div class="space-y-6">
    <!-- 标题区 -->
    <div class="rounded-xl bg-white p-5 shadow-md">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="mb-1 text-lg font-bold text-gray-800">AI 智能配色</h2>
          <p class="text-sm text-gray-500">输入主题描述，AI 为你生成协调的配色方案</p>
        </div>
        <div
          v-if="currentModelLabel"
          class="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1"
        >
          <span class="h-2 w-2 rounded-full bg-green-400" />
          <span class="text-xs font-medium text-gray-600">{{ currentModelLabel }}</span>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- 左侧：控制面板 -->
      <div class="space-y-5">
        <!-- 模型选择 -->
        <div class="rounded-xl bg-white p-5 shadow-md">
          <h3 class="mb-3 text-sm font-semibold text-gray-500">AI 模型</h3>

          <!-- 加载中 -->
          <div v-if="loadingModels" class="text-sm text-gray-400">加载模型列表中...</div>

          <!-- 加载失败 -->
          <div v-else-if="loadFailed" class="space-y-2">
            <p class="text-sm text-red-500">模型列表加载失败</p>
            <div class="flex gap-2">
              <button
                @click="loadModels"
                class="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-200"
              >
                重试
              </button>
              <button
                @click="zToolsApi.redirectAiModelsSetting()"
                class="rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-600 transition-colors hover:bg-blue-100"
              >
                前往设置
              </button>
            </div>
          </div>

          <!-- 无可用模型 -->
          <div v-else-if="noModels()" class="space-y-2">
            <p class="text-sm text-amber-600">未检测到可用的 AI 模型</p>
            <p class="text-xs text-gray-400">请先在 ZTools 设置中配置至少一个 AI 模型</p>
            <button
              @click="zToolsApi.redirectAiModelsSetting()"
              class="rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-600 transition-colors hover:bg-blue-100"
            >
              前往设置 AI 模型
            </button>
          </div>

          <!-- 模型列表 -->
          <template v-else>
            <div class="relative">
              <select
                v-model="selectedModelId"
                @change="onModelChange"
                class="w-full cursor-pointer appearance-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 pr-8 text-sm text-gray-700 transition-colors hover:bg-gray-100 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:outline-none"
              >
                <option v-for="m in models" :key="m.id" :value="m.id">
                  {{ m.label }}
                </option>
              </select>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="pointer-events-none absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <p v-if="currentModelLabel" class="mt-2 text-xs text-gray-400">
              当前使用：{{ currentModelLabel }}
            </p>
          </template>
        </div>

        <!-- 颜色数量滑动条 -->
        <div class="rounded-xl bg-white p-5 shadow-md">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-gray-500">颜色数量</h3>
            <span
              class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 font-bold text-white"
            >
              {{ colorCount }}
            </span>
          </div>
          <input
            type="range"
            v-model.number="colorCount"
            min="1"
            max="8"
            step="1"
            class="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-blue-500"
          />
          <div class="mt-1 flex justify-between text-xs text-gray-400">
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
            <span>5</span>
            <span>6</span>
            <span>7</span>
            <span>8</span>
          </div>
        </div>

        <!-- 提示词输入 -->
        <div class="rounded-xl bg-white p-5 shadow-md">
          <h3 class="mb-3 text-sm font-semibold text-gray-500">配色主题</h3>
          <div class="flex gap-2">
            <input
              v-model="prompt"
              type="text"
              placeholder="输入主题描述，如：日落海滩、赛博朋克..."
              class="flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:outline-none"
              @keydown.enter="generateColors"
            />
            <button
              @click="generateColors"
              :class="[
                'flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all',
                isLoading ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600',
              ]"
            >
              <svg
                v-if="isLoading"
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                />
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span>{{ isLoading ? "取消" : "生成" }}</span>
            </button>
          </div>
        </div>

        <!-- 内置提示词 -->
        <div class="rounded-xl bg-white p-5 shadow-md">
          <h3 class="mb-3 text-sm font-semibold text-gray-500">
            快捷主题
            <span class="font-normal text-gray-400">（点击添加）</span>
          </h3>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="bp in builtInPrompts"
              :key="bp"
              @click="applyBuiltInPrompt(bp)"
              class="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 transition-all hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
            >
              {{ bp }}
            </button>
          </div>
        </div>
      </div>

      <!-- 右侧：结果展示 -->
      <div class="space-y-5">
        <!-- 色板预览 -->
        <div v-if="resultColors.length > 0" class="rounded-xl bg-white p-5 shadow-md">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-gray-500">
              「{{ resultPrompt }}」配色方案
              <span v-if="currentModelLabel" class="ml-2 font-normal text-gray-400">
                · {{ currentModelLabel }}
              </span>
            </h3>
            <div class="flex items-center gap-2">
              <button
                @click="favoriteAll"
                class="flex items-center gap-1 rounded-lg bg-pink-50 px-2.5 py-1 text-xs font-medium text-pink-500 transition-colors hover:bg-pink-100"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-3.5 w-3.5"
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
                收藏全部
              </button>
              <button @click="clearResult" class="text-xs text-gray-400 hover:text-red-500">
                清空
              </button>
            </div>
          </div>

          <!-- 颜色条预览 -->
          <div class="mb-4 flex h-20 overflow-hidden rounded-xl shadow-inner">
            <div
              v-for="(color, i) in resultColors"
              :key="i"
              class="flex flex-1 cursor-pointer items-end justify-center pb-1.5 text-xs font-medium transition-all hover:flex-[1.5]"
              :style="{
                backgroundColor: color.hex,
                color: isLightColor(color.hex) ? '#333' : '#fff',
              }"
              @click="copyHex(color.hex)"
              :title="`${color.hex} - 点击复制`"
            >
              {{ color.hex }}
            </div>
          </div>

          <!-- 颜色列表 -->
          <div class="space-y-2">
            <div
              v-for="(color, i) in resultColors"
              :key="i"
              class="flex items-center gap-3 rounded-lg bg-gray-50 p-3 transition-colors hover:bg-gray-100"
            >
              <div
                class="h-10 w-10 cursor-pointer rounded-lg shadow-sm transition-transform hover:scale-110"
                :style="{ backgroundColor: color.hex }"
                @click="copyHex(color.hex)"
                :title="`${color.hex} - 点击复制`"
              />
              <div class="flex-1">
                <div class="font-mono text-sm font-medium text-gray-700">
                  {{ color.hex }}
                </div>
                <div class="text-xs text-gray-400">{{ color.name }}</div>
              </div>
              <button
                @click="copyHex(color.hex)"
                class="rounded-lg px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-500"
              >
                复制
              </button>
              <button
                @click="favoriteColor(color.hex, color.name)"
                class="rounded-lg px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-pink-50 hover:text-pink-500"
              >
                收藏
              </button>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div
          v-else
          class="flex flex-col items-center justify-center rounded-xl bg-white py-16 shadow-md"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="mb-4 h-16 w-16 text-gray-200"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
            />
          </svg>
          <p class="text-sm text-gray-400">输入主题，让 AI 为你配色</p>
        </div>

        <!-- 操作按钮 -->
        <div v-if="resultColors.length > 0" class="rounded-xl bg-white p-5 shadow-md">
          <h3 class="mb-3 text-sm font-semibold text-gray-500">导出</h3>
          <div class="space-y-2">
            <button
              @click="copyAsCSS"
              class="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
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
              <span>复制为 CSS 变量</span>
            </button>
            <button
              @click="copyAsArray"
              class="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
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
              <span>复制为颜色数组</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
/**
 * 判断 HEX 颜色是浅色还是深色（用于决定文字颜色）
 */
function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // YIQ 公式
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}
</script>
