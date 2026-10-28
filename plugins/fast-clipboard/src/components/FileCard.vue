<script setup lang="ts">
import { computed } from 'vue'
import type { ClipboardRecord } from '../types'
import { KIND_META, fileDir, fileName, relTime, shrinkPath } from '../utils/format'
import { FILE_MAX_LINES } from '../utils/layout'
import { fileExists } from '../utils/fs'

/**
 * 文件记录卡片。
 *
 * 与文本行最大的不同：文件看名字没用，真正需要的是"它在哪"——
 * 所以每个文件独占一行，列出文件名 + 所在目录，并给一个定位按钮，
 * 一键在系统文件管理器里选中它。
 *
 * 行高由 layout.fileRowHeight 决定，这里只负责在给定高度内排版。
 */
const props = defineProps<{
  record: ClipboardRecord
  selected: boolean
  starred: boolean
}>()

const emit = defineEmits<{
  copy: []
  star: []
  remove: []
  /** 在文件管理器中定位到该路径 */
  reveal: [path: string]
}>()

const time = computed(() => relTime(props.record.createdAt))

/** 路径列表：files 为空（老结构/收藏快照）时用 content 兜底 */
const paths = computed<string[]>(() => {
  const list = props.record.files?.filter(Boolean)
  if (list && list.length) return list
  return props.record.content ? [props.record.content] : []
})

const entries = computed(() =>
  paths.value.slice(0, FILE_MAX_LINES).map((p) => ({
    path: p,
    name: fileName(p),
    dir: shrinkPath(fileDir(p)),
    /** null = 无法判断（无 preload）；按存在处理，不误报"已失效" */
    exists: fileExists(p) !== false
  }))
)

const restCount = computed(() => Math.max(0, paths.value.length - entries.value.length))
const countText = computed(() => (paths.value.length > 1 ? `${paths.value.length} 个文件` : '文件'))
</script>

<template>
  <div class="fcard" :class="{ sel: selected }" @click="emit('copy')">
    <div class="lead">
      <img class="type-icon" :src="KIND_META.file.icon" alt="文件" draggable="false" />
    </div>

    <div class="body">
      <div
        v-for="f in entries"
        :key="f.path"
        class="fline"
        :class="{ gone: !f.exists }"
      >
        <span class="fname" :title="f.path">{{ f.name }}</span>
        <span class="fdir" :title="f.dir">{{ f.dir }}</span>
        <span v-if="!f.exists" class="fgone">已不存在</span>
        <button
          class="flocate"
          :disabled="!f.exists"
          :title="f.exists ? '在文件管理器中显示' : '文件已不存在'"
          @click.stop="emit('reveal', f.path)"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v6.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 16.5z"
              stroke="currentColor" />
            <path d="M3 10h16" stroke="currentColor" />
          </svg>
          <span class="flocate-text">定位</span>
        </button>
      </div>

      <div v-if="restCount > 0" class="fmore">还有 {{ restCount }} 个文件（复制可一次带走全部）</div>
    </div>

    <div class="tail">
      <span class="count">{{ countText }}</span>
      <span class="time">{{ time }}</span>
      <span class="ops">
        <button class="op" :class="{ starred }" title="收藏" @click.stop="emit('star')">
          <svg class="icon-svg" viewBox="0 0 24 24" :fill="starred ? 'currentColor' : 'none'"
            stroke-width="1.6" stroke-linejoin="round">
            <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1L3.2 9.4l6.1-.8z"
              stroke="currentColor" />
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
.fcard {
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

.fcard:hover { background: var(--hover); }
.fcard.sel { background: var(--accent-weak); }

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

.type-icon {
  width: 20px;
  height: 20px;
  display: block;
  object-fit: contain;
}

.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* 行高必须与 layout.FILE_LINE_H 一致，否则虚拟列表会算错总高度 */
.fline {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.fname {
  flex: none;
  max-width: 42%;
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 路径是这条记录的核心信息：默认就显示，不用 hover 才出现 */
.fdir {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

.gone .fname { color: var(--text-3); text-decoration: line-through; }
.gone .fdir { color: var(--danger); }

.fgone {
  flex: none;
  font-size: 11px;
  color: var(--danger);
  opacity: 0.9;
}

.flocate {
  flex: none;
  display: flex;
  align-items: center;
  gap: 3px;
  height: 22px;
  padding: 0 6px;
  border-radius: 5px;
  font-size: 11px;
  color: var(--text-3);
  background: transparent;
  opacity: 0.55;
  transition: opacity 0.12s, background 0.12s, color 0.12s;
}

.fcard:hover .flocate { opacity: 1; }
.flocate:hover { background: var(--active); color: var(--text); }
.flocate:disabled { opacity: 0.3; cursor: not-allowed; }
.flocate:disabled:hover { background: transparent; color: var(--text-3); }

.flocate-text { line-height: 1; }

.fmore {
  height: 18px;
  line-height: 18px;
  font-size: 11px;
  color: var(--text-3);
  opacity: 0.8;
}

.tail {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

.count,
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

.fcard:hover .ops,
.fcard.sel .ops { opacity: 1; }

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
.op.op-del:hover { background: var(--danger-weak); color: var(--danger); }
.op:disabled { opacity: 0.35; cursor: not-allowed; }
</style>
