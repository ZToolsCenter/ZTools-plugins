<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ClipboardRecord } from '../types'
import { relTime } from '../utils/format'
import { CAT_ICONS_LG } from '../utils/icons'
import { ratioOf, resolutionText } from '../utils/layout'
import { resolveImageSrc } from '../utils/image'

const props = defineProps<{
  record: ClipboardRecord
  selected: boolean
  starred: boolean
}>()

const emit = defineEmits<{
  copy: []
  star: []
  remove: []
  preview: []
}>()

const time = computed(() => relTime(props.record.createdAt))
const reso = computed(() => resolutionText(props.record.resolution))
const appName = computed(() => props.record.appName || '')

/**
 * 卡片宽度贴合图片比例（而非一律撑满）：
 * 行高由比例算出，多数情况下 height × ratio 正好等于可用宽度；
 * 当高度被上限截住（竖图 / 方图）时宽度也同比收窄并居中，
 * 避免两侧出现大片无效留白。
 * 宿主未给分辨率时，等图片加载完用真实尺寸兜底（只影响卡片宽度，不影响行高）。
 */
const naturalRatio = ref<number | null>(null)
const ratio = computed(() => ratioOf(props.record) ?? naturalRatio.value)

/**
 * 图片源。宿主可能在两种情况下给不出真实图片：
 *   1. 超大图片未落盘 —— content 是兜底文案（如 "[图片] 2.3MB"）
 *   2. 路径失效 / 格式不支持 —— img 触发 error
 * 这两种都降级为占位块并显示文案，不再出现破图或空白。
 */
const src = computed(() => resolveImageSrc(props.record.content))

const failed = ref(false)
const loaded = ref(false)
watch(
  () => props.record.content,
  () => {
    failed.value = false
    loaded.value = false
    naturalRatio.value = null
  }
)

/** 加载完成：记录真实尺寸，用于没有分辨率信息的记录 */
function onImgLoad(e: Event): void {
  loaded.value = true
  const el = e.target as HTMLImageElement
  if (el.naturalWidth > 0 && el.naturalHeight > 0) {
    naturalRatio.value = el.naturalWidth / el.naturalHeight
  }
}

const showImg = computed(() => !!src.value && !failed.value)

/** 无图可显示时的说明文案（绝不把 data URL / 路径 / base64 原文倒给用户看） */
const placeholder = computed(() => {
  // 宿主给的 preview 一定是给人看的文案（如 "[图片] 2.3MB"），优先用
  const preferred = props.record.preview
  const raw = (preferred || props.record.content || '').replace(/\s+/g, ' ').trim()
  if (!raw) return '图片无法显示'

  // 源数据形态：不是文案，只提示不可显示，避免暴露一长串 base64
  const isSrcLike =
    /^(data:|file:|https?:|[a-z]:[\\/]|[\\/])/i.test(raw) ||
    /^[A-Za-z0-9+/]{60,}={0,2}$/.test(raw)
  if (isSrcLike && !preferred) return '图片无法显示'

  return raw.length > 40 ? raw.slice(0, 40) + '…' : raw
})
</script>

<template>
  <div
    class="card"
    :class="{ sel: selected, fluid: !ratio }"
    :style="ratio ? { '--ratio': String(ratio) } : undefined"
    @click="emit('copy')"
  >
    <!-- 图片本体：contain 保证完整可见、不裁切 -->
    <img
      v-if="showImg"
      class="img"
      :class="{ ready: loaded }"
      :src="src"
      loading="lazy"
      decoding="async"
      alt=""
      draggable="false"
      @load="onImgLoad"
      @error="failed = true"
    />

    <!-- 无图 / 加载失败：占位块 + 说明文案（图标用 PNG 卡片素材） -->
    <div v-else class="fallback">
      <img class="fallback-icon" :src="CAT_ICONS_LG.image" alt="图片" draggable="false" />
      <span class="fallback-text">{{ placeholder }}</span>
    </div>

    <!-- 左下：分辨率 / 来源应用 -->
    <div class="tags">
      <span v-if="reso" class="chip">{{ reso }}</span>
      <span v-if="appName" class="chip chip-app">{{ appName }}</span>
    </div>

    <!-- 右下：时间 -->
    <span v-if="time" class="time">{{ time }}</span>

    <!-- 右上：操作（hover 或选中时出现，不遮挡图片主体） -->
    <div class="ops">
      <button class="op" :class="{ starred }" title="收藏" @click.stop="emit('star')">
        <svg class="icon-svg" viewBox="0 0 24 24" :fill="starred ? 'currentColor' : 'none'"
          stroke-width="1.6" stroke-linejoin="round">
          <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1L3.2 9.4l6.1-.8z"
            stroke="currentColor" />
        </svg>
      </button>
      <button class="op" title="放大预览" @click.stop="emit('preview')">
        <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" />
          <path d="M20 20l-4.4-4.4M11 8.6v4.8M8.6 11h4.8" stroke="currentColor" />
        </svg>
      </button>
      <button class="op op-del" title="删除" @click.stop="emit('remove')">
        <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.card {
  position: relative;
  height: 100%;
  /* 宽度由图片比例推导；超出可用宽度时由 max-width 收敛 */
  width: auto;
  aspect-ratio: var(--ratio, 1.5);
  max-width: 100%;
  margin: 0 auto;
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--border);
  background-color: var(--img-bg);
  /* 棋盘格：透明 PNG 也能看清边界与内容 */
  background-image:
    linear-gradient(45deg, var(--checker) 25%, transparent 25%),
    linear-gradient(-45deg, var(--checker) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--checker) 75%),
    linear-gradient(-45deg, transparent 75%, var(--checker) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  transition: box-shadow 0.12s, border-color 0.12s;
}

.card:hover { border-color: var(--border-strong); }

/* 无分辨率信息：撑满可用宽度，图片在框内居中 */
.card.fluid {
  width: 100%;
  aspect-ratio: auto;
}

.card.sel {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-weak);
}

/* ===== 图片本体 ===== */
.img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* contain 而非 cover：完整呈现内容，这是"一眼看懂"的关键 */
  object-fit: contain;
  display: block;
  opacity: 0;
  transition: opacity 0.15s;
}

.img.ready { opacity: 1; }

/* ===== 无图占位 ===== */
.fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  color: var(--c-image);
  opacity: 0.85;
}

.fallback-icon {
  width: 32px;
  height: 32px;
  flex: none;
  display: block;
  object-fit: contain;
}

.fallback-text {
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
  line-height: 1.4;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ===== 角标 ===== */
.tags {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: flex;
  gap: 4px;
  max-width: 60%;
  flex-wrap: wrap;
}

.chip {
  padding: 2px 6px;
  border-radius: 5px;
  font-size: 11px;
  line-height: 1.5;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.chip-app { opacity: 0.85; }

.time {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 2px 6px;
  border-radius: 5px;
  font-size: 11px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  font-variant-numeric: tabular-nums;
}

/* ===== 操作按钮 ===== */
.ops {
  position: absolute;
  top: 7px;
  right: 7px;
  display: flex;
  gap: 3px;
  opacity: 0;
  transition: opacity 0.12s;
}

.card:hover .ops,
.card.sel .ops { opacity: 1; }

.op {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  transition: background 0.12s, color 0.12s;
}

.op:hover { background: rgba(0, 0, 0, 0.75); }
.op.starred { color: var(--star); }
.op.op-del:hover { background: var(--danger); }
</style>
