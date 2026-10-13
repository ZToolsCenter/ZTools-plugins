<script setup lang="ts">
/**
 * 首页滚动歌词(网易云「正在播放」页风格):
 * - 全高视口,当前行居中放大高亮,其余行压暗;rAF 插值位置驱动,不依赖推送频率;
 * - 翻译内嵌在当前行下方(仅当前行展开)。行高固定,展开槽不改变行盒,
 *   滚动定位公式 offset = 视口高/2 − 行高/2 − index×行高 无需感知翻译;
 * - 跨行跳变(seek/切歌)瞬时定位,常规推进平滑滚动;
 * - 纯文本 / 搜索中 / 无歌词 / 等待播放降级态。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { lyric, userOffset } from '../store'
import { settings } from '../settings'
import { findActiveLine } from '../lyric/parse-lrc'

const props = defineProps<{
  /** 插值后的当前播放位置(毫秒);进度未知时传 -1 */
  positionMs: number
}>()

const fontSize = computed(() => settings.mainFontSize)
/** 行高随字号派生:给放大后的当前行与翻译槽留足空间 */
const rowHeight = computed(() => Math.max(48, Math.round(fontSize.value * 2.4)))

const viewport = ref<HTMLElement | null>(null)
const viewHeight = ref(360)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (!viewport.value) return
  viewHeight.value = viewport.value.clientHeight || 360
  observer = new ResizeObserver(() => {
    viewHeight.value = viewport.value?.clientHeight || 360
  })
  observer.observe(viewport.value)
})

onUnmounted(() => observer?.disconnect())

/** 应用偏移后用于查找当前行的位置:offset 正 = 歌词提前 */
const searchPosition = computed(() =>
  props.positionMs >= 0 ? props.positionMs + userOffset.value : Number.NaN
)

const activeIndex = computed(() => {
  if (!Number.isFinite(searchPosition.value) || lyric.lines.length === 0) return -1
  return findActiveLine(lyric.lines, searchPosition.value)
})

const containerOffset = ref(0)
const animate = ref(true)

watch(
  [activeIndex, rowHeight, viewHeight],
  ([index, rowH, viewH], previous) => {
    const previousIndex = previous ? previous[0] : -2
    animate.value = Math.abs(index - previousIndex) <= 3
    if (index < 0) {
      // 还没唱到第一句:让第一行停在视口中部,进场不突兀
      containerOffset.value = viewH / 2 - rowH / 2
      return
    }
    containerOffset.value = viewH / 2 - rowH / 2 - index * rowH
  },
  { immediate: true }
)

const hasSynced = computed(() => lyric.lines.length > 0)

/** 单行纯文本判定:纯音乐等占位歌词(如「纯音乐,请欣赏」)整首只有一行,
 * 按多行排进顶部左对齐的滚动容器会孤零零顶在左上角,改为视口居中展示 */
const plainIsSingleLine = computed(() => !!lyric.plain && !lyric.plain.includes('\n'))

/** 当前行翻译(settings.translation 开启且有对应译文) */
const activeTranslation = computed(() => {
  if (!settings.translation) return ''
  const index = activeIndex.value
  if (index < 0) return ''
  const line = lyric.lines[index]
  return line ? lyric.translationMap.get(line.timeMs) ?? '' : ''
})
</script>

<template>
  <div ref="viewport" class="lyrics">
    <!-- 逐行滚动歌词 -->
    <template v-if="hasSynced">
      <div class="scroll" :class="{ animate }" :style="{ transform: `translateY(${containerOffset}px)` }">
        <div
          v-for="(line, index) in lyric.lines"
          :key="index"
          class="row"
          :class="{ active: index === activeIndex }"
          :style="{ height: rowHeight + 'px' }"
        >
          <div
            class="text"
            :style="{ fontSize: (index === activeIndex ? fontSize * 1.28 : fontSize) + 'px' }"
          >
            {{ line.text || '♪' }}
          </div>
          <div class="trans" :class="{ open: index === activeIndex && activeTranslation }">
            <span v-if="index === activeIndex && activeTranslation">{{ activeTranslation }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 纯文本歌词(无时间轴);单行(如纯音乐的「纯音乐,请欣赏」占位)居中展示 -->
    <div
      class="plain"
      :class="{ single: plainIsSingleLine }"
      v-else-if="lyric.plain"
      :style="{ fontSize: fontSize + 'px' }"
    >{{ lyric.plain }}</div>

    <!-- 降级态占位 -->
    <div class="placeholder" v-else-if="lyric.loading">
      <span class="pulse">歌词搜索中<i>…</i></span>
    </div>
    <div class="placeholder" v-else-if="lyric.notFound">
      <span class="placeholder-main">未找到歌词</span>
      <span class="placeholder-sub">已缓存结果,次日自动重试</span>
    </div>
    <div class="placeholder" v-else>
      <span class="placeholder-main">等待播放…</span>
      <span class="placeholder-sub">手机端播放音乐后,歌词会在这里滚动</span>
    </div>
  </div>
</template>

<style scoped>
.lyrics {
  position: relative;
  flex: 1;
  min-height: 160px;
  overflow: hidden;
  /* 上下大范围渐隐:行淡出在进入边缘前就开始,视觉上更接近网易云 */
  -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 72px, #000 calc(100% - 72px), transparent 100%);
  mask-image: linear-gradient(180deg, transparent 0, #000 72px, #000 calc(100% - 72px), transparent 100%);
}

.scroll {
  will-change: transform;
}

.scroll.animate {
  transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
}

.row {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.text {
  max-width: 100%;
  line-height: 1.2;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.38);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  transition: color 0.35s, font-size 0.35s, text-shadow 0.35s;
}

.row.active .text {
  color: #ffffff;
  font-weight: 700;
  text-shadow: 0 0 28px rgba(130, 180, 255, 0.38);
}

.trans {
  height: 0;
  opacity: 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 18px;
  color: rgba(255, 255, 255, 0.55);
  transition: height 0.3s, opacity 0.3s;
}

.trans.open {
  height: 18px;
  opacity: 1;
}

.plain {
  white-space: pre-wrap;
  height: 100%;
  overflow-y: auto;
  line-height: 1.7;
  padding: 4px 6px;
  box-sizing: border-box;
  color: rgba(255, 255, 255, 0.78);
}

/* 单行纯文本(纯音乐占位等):整块在视口内水平垂直居中,观感与占位态一致 */
.plain.single {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.5);
}

.placeholder-main {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.75);
}

.placeholder-sub {
  font-size: 12px;
}

.pulse i {
  font-style: normal;
  animation: blink 1.2s infinite;
}

@keyframes blink {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}
</style>
