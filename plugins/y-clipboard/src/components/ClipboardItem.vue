<script setup lang="ts">
import { computed } from 'vue'
import type { ClipboardRecord } from '../types'
import { KIND_META, previewText, relTime, recordMeta, isHexColor, webUrlOf } from '../utils/format'

const props = defineProps<{
  record: ClipboardRecord
  selected: boolean
  starred: boolean
}>()

const emit = defineEmits<{
  copy: []
  star: []
  remove: []
  /** 在浏览器里打开（仅当内容是一个 http(s) 网址时才有这个入口） */
  open: []
}>()

/**
 * 可打开的网址；不是网址时为空 —— 按钮随之不渲染。
 * 按"内容"而不是按 kind 判断：宿主的分类不一定准（同一段 URL 可能被归成文本），
 * 而用户看到的是内容本身。
 */
const linkUrl = computed(() => webUrlOf(props.record.content))

const meta = computed(() => KIND_META[props.record.kind])
const time = computed(() => relTime(props.record.createdAt))
const sub = computed(() => recordMeta(props.record))

// 文件记录已由 FileCard 承载（要显示路径 + 定位），这里只处理文本类
const preview = computed(() => {
  const r = props.record
  if (r.kind === 'color') return r.content.trim()
  return previewText(r.content)
})

const colorSwatch = computed(() => (isHexColor(props.record.content) ? props.record.content.trim() : ''))
</script>

<template>
  <div
    class="item"
    :class="{ sel: selected }"
    @click="emit('copy')"
    @dblclick.prevent
  >
    <!-- 左：类型标识（PNG 卡片图标，与侧栏同一套素材） -->
    <div class="lead">
      <span
        v-if="colorSwatch"
        class="swatch"
        :style="{ background: colorSwatch }"
      />
      <img v-else class="type-icon" :src="meta.icon" :alt="meta.label" draggable="false" />
    </div>

    <!-- 中：内容 -->
    <div class="body">
      <div class="title" :title="preview">{{ preview }}</div>
      <div class="sub">
        <span class="kind-tag" :style="{ color: meta.color }">{{ meta.label }}</span>
        <template v-if="sub">
          <span class="dot">·</span>
          <span>{{ sub }}</span>
        </template>
      </div>
    </div>

    <!-- 右：时间 + 操作 -->
    <div class="tail">
      <span class="time">{{ time }}</span>
      <span class="ops">
        <!-- 链接专用：交给系统浏览器打开（打开后插件会自己退出，见 store.openLink） -->
        <button
          v-if="linkUrl"
          class="op op-open"
          title="在浏览器中打开"
          @click.stop="emit('open')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 5h5v5" stroke="currentColor" />
            <path d="M19 5l-7.5 7.5" stroke="currentColor" />
            <path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" stroke="currentColor" />
          </svg>
        </button>
        <button
          class="op"
          :class="{ starred }"
          title="收藏"
          @click.stop="emit('star')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" :fill="starred ? 'currentColor' : 'none'"
            stroke-width="1.6" stroke-linejoin="round">
            <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1L3.2 9.4l6.1-.8z" stroke="currentColor" />
          </svg>
        </button>
        <button class="op op-del" title="删除" @click.stop="emit('remove')">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" />
          </svg>
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 100%;
  padding: 0 14px 0 12px;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.1s;
  outline: none;
}

.item:hover { background: var(--hover); }
.item.sel { background: var(--accent-weak); }

.lead {
  width: 24px;
  height: 24px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: var(--bg);
}

/* 类型图标用 PNG 素材（透明底彩色字形），与侧栏分类同一套；20px 的由来见 Sidebar 的 .cat-icon */
.type-icon {
  width: 20px;
  height: 20px;
  display: block;
  object-fit: contain;
}

.swatch {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1px solid var(--border-strong);
}

.body { flex: 1; min-width: 0; }

.title {
  font-size: 13px;
  line-height: 1.45;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sub {
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
}

.kind-tag { font-weight: 500; }
.dot { opacity: 0.5; }

.tail {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 100%;
}

.time {
  font-size: 11.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.ops {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s;
}

.item:hover .ops,
.item.sel .ops { opacity: 1; }

.op {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: var(--text-3);
  transition: background 0.1s, color 0.1s;
}

.op:hover { background: var(--active); color: var(--text); }
.op.starred { color: var(--star); }
/* 打开链接是"往外走"的动作，用主色区别于删除（危险色） */
.op.op-open:hover { background: var(--accent-weak); color: var(--accent); }
.op.op-del:hover { background: var(--danger-weak); color: var(--danger); }
</style>
