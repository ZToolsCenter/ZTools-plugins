<script setup lang="ts">
import { computed } from 'vue'
import { useStore } from '../composables/useStore'
import { CATS } from '../utils/categories'

const store = useStore()

/**
 * 图片显示密度只在会出现图片行的分类里才有意义。
 * 纯文本类分类（文本/链接/代码/颜色/文件）放一个"图片档位"按钮只会误导。
 * （从工具栏搬过来，规则不变）
 */
const showImgScale = computed(() => {
  const c = store.activeCat.value
  return c === 'all' || c === 'image'
})

function onClear(): void {
  if (window.confirm('确定清空全部剪贴板历史？收藏的内容会保留。')) {
    void store.clearAll()
  }
}
</script>

<template>
  <nav class="sidebar">
    <button
      v-for="cat in CATS"
      :key="cat.key"
      class="cat"
      :class="{ on: store.activeCat.value === cat.key }"
      @click="store.setCat(cat.key)"
    >
      <!--
        图标是 PNG 素材（透明底彩色字形），颜色写死在图里，
        所以选中态不能再靠"图标变色"表达 —— 靠整行的背景高亮。见 utils/icons.ts。
      -->
      <img class="cat-icon" :src="cat.icon" :alt="cat.label" draggable="false" />
      <span class="cat-label">{{ cat.label }}</span>
      <span class="cat-count">{{ store.counts[cat.key] || '' }}</span>
    </button>

    <!--
      操作区放侧栏底部：顶部那一整行工具栏已经去掉（只剩一句没用的说明），
      图片档位与清空历史挪到这里，纵向空间全部让给列表。
      图片档位是"按分类显隐"的（文本类分类里出现只会误导），但这里**不用 v-if**：
      这一段整体是靠 margin-top:auto 贴住底边的，元素一消失整块高度就变、顶边下移，
      「清空历史」会跟着上下跳 ~30px —— 而"全部 ↔ 文本"恰好是最常来回切的两个分类，
      一跳到下一次就容易点错。改成 `visibility: hidden` 占位：看不见也点不到（不可聚焦、
      不响应指针），但位置纹丝不动。
    -->
    <div class="sidebar-foot">
      <button class="foot-btn danger" title="清空历史（收藏保留）" @click="onClear">
        <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" stroke="currentColor" />
        </svg>
        <span>清空历史</span>
      </button>

      <button
        class="foot-btn"
        :class="{ 'is-off': !showImgScale }"
        :title="`图片显示：${store.imgScaleLabel.value}（点击切换）`"
        @click="store.cycleImgScale()"
      >
        <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.6"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 5h18v14H3zM3 15l5-4 4 3 3-2 6 5M15.5 9.5a1 1 0 1 0 0-.01"
            stroke="currentColor" />
        </svg>
        <span>图片：{{ store.imgScaleLabel.value }}</span>
      </button>

      <!-- 不配图标：132px 的侧栏装不下"图标 + Enter 复制 · Esc 退出"（会溢出 16px） -->
      <div class="foot-tip">Enter 复制 · Esc 退出</div>
    </div>
  </nav>
</template>

<style scoped>
.sidebar {
  width: 132px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border-right: 1px solid var(--border);
  background: var(--bg);
}

.cat {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 10px;
  border-radius: var(--radius);
  color: var(--text-2);
  transition: background 0.12s, color 0.12s;
}

/*
 * 图标位 24px：v2 素材是统一 128×128 画布、字形居中且光学尺寸一致，
 * 实测字形只占画布 63%~81%（留白用来对齐视觉重心）。
 * 也就是容器 20px 时字形看着约 13~16px。
 * 28px、24px 都试过，用户仍反馈偏大（v2 素材留白多，容器尺寸要压住才显得精致），收到 20px。
 */
.cat-icon {
  width: 20px;
  height: 20px;
  flex: none;
  display: block;
  object-fit: contain;
}

.cat:hover { background: var(--hover); }

.cat.on {
  background: var(--accent-weak);
  color: var(--accent);
}

.cat-label { flex: 1; text-align: left; font-size: 12.5px; }

.cat-count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}

/* 底部操作区：margin-top:auto 把它压到侧栏最下沿 */
.sidebar-foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.foot-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius);
  font-size: 12px;
  color: var(--text-2);
  transition: background 0.12s, color 0.12s;
}

.foot-btn:hover { background: var(--hover); color: var(--text); }

/* 不适用的分类里"占位不显"：省得整块 footer 高度变化带动上面的按钮跳动 */
.foot-btn.is-off { visibility: hidden; }

.foot-btn.danger:hover {
  background: var(--danger-weak);
  color: var(--danger);
}

.foot-tip {
  padding: 6px 10px 2px;
  color: var(--text-3);
  font-size: 11px;
  white-space: nowrap;
}
</style>
