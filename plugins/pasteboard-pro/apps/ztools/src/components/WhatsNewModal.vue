<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { CURRENT_APP_VERSION } from "../whats-new";

withDefaults(defineProps<{
  version?: string;
  standalone?: boolean;
}>(), { version: CURRENT_APP_VERSION });

const emit = defineEmits<{
  close: [];
}>();

const features = [
  {
    icon: "✨",
    title: "新版浮窗与界面切换",
    badge: "全新外观",
    tagClass: "badge--violet",
    desc: "保留 Paste 标识，短搜索框与收藏分组集中在顶部；新版卡片和设置保持统一风格，通用设置中可随时切回旧版界面。",
  },
  {
    icon: "🔎",
    title: "搜索展开与多选粘贴",
    badge: "操作优化",
    tagClass: "badge--blue",
    desc: "搜索框展开、收起加入过渡动画，输入时合并重复检索；完善多选计数、混合类型粘贴提示与连续粘贴队列。",
  },
  {
    icon: "🖱️",
    title: "卡片与分组拖动排序",
    badge: "拖动整理",
    tagClass: "badge--amber",
    desc: "改进列表内卡片排序和拖动预览，收藏分组通过拖动把手调整顺序；新建分组和分组菜单也采用新版样式。",
  },
  {
    icon: "🖼️",
    title: "背景图片与主题编辑",
    badge: "自定义",
    tagClass: "badge--emerald",
    desc: "背景图片支持裁切、旋转、缩放和比例调整，并可设置平铺等渲染方式；磨砂效果可选，卡片和背景底色可单独调整。",
  },
  {
    icon: "🛡️",
    title: "应用来源与隐私设置",
    badge: "设置完善",
    tagClass: "badge--pink",
    desc: "通过应用图标辨认复制来源，用应用选择列表设置屏蔽项；屏幕共享隐藏浮窗默认关闭，开关选择可持久保存。",
  },
  {
    icon: "🗂️",
    title: "历史保存与清空修复",
    badge: "可靠性",
    tagClass: "badge--cyan",
    desc: "改进历史图片保存失败后的重试，并抑制清空后已清理旧项再次导入；读取或保存清理状态失败时停止后续清空操作。",
  },
];

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.stopPropagation();
    emit("close");
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeydown, true);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown, true);
});
</script>

<template>
  <div
    class="whats-new-backdrop"
    :class="{ 'whats-new-backdrop--standalone': standalone }"
    role="dialog"
    aria-modal="true"
    aria-labelledby="whats-new-title"
    @click.self="emit('close')"
  >
    <div class="whats-new-modal" :class="{ 'whats-new-modal--standalone': standalone }">
      <header class="whats-new-header">
        <div class="whats-new-tag">
          <span class="pulse-dot"></span>
          <span>🚀 版本更新 {{ version }} · {{ features.length }} 项更新</span>
        </div>
        <button type="button" class="whats-new-close" aria-label="关闭更新日志" @click="emit('close')">×</button>
        <h2 id="whats-new-title" class="whats-new-title">新版界面与使用体验优化</h2>
        <p class="whats-new-subtitle">更集中地浏览、搜索和整理剪贴板历史</p>
      </header>

      <div class="whats-new-body">
        <div v-for="feature in features" :key="feature.title" class="feature-card">
          <div class="feature-card__icon-wrap">
            <span class="feature-card__icon" role="img" aria-hidden="true">{{ feature.icon }}</span>
          </div>
          <div class="feature-card__content">
            <div class="feature-card__header">
              <h3 class="feature-card__title">{{ feature.title }}</h3>
              <span class="feature-card__badge" :class="feature.tagClass">{{ feature.badge }}</span>
            </div>
            <p class="feature-card__desc">{{ feature.desc }}</p>
          </div>
        </div>
      </div>

      <footer class="whats-new-footer">
        <button type="button" class="whats-new-btn" @click="emit('close')">
          <span>开始体验</span>
          <span class="btn-arrow" aria-hidden="true">→</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.whats-new-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 8, 20, 0.65);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  padding: 18px;
  animation: fadeIn 200ms ease-out;
}

.whats-new-backdrop--standalone {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  max-height: 100%;
  padding: 0;
  background: var(--pb-window-bg);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  animation: none;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.whats-new-modal {
  position: relative;
  width: 100%;
  max-width: 540px;
  max-height: 90vh;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--pb-glass-strong) 94%, transparent);
  border: 1px solid color-mix(in srgb, var(--pb-line) 85%, transparent);
  border-radius: 20px;
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.08) inset;
  overflow: hidden;
  animation: slideUp 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.whats-new-modal--standalone {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  min-height: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: var(--pb-window-bg);
  animation: none;
  overflow: hidden;
}

.whats-new-modal--standalone .whats-new-header {
  -webkit-app-region: drag;
}

.whats-new-modal--standalone .whats-new-close,
.whats-new-modal--standalone .whats-new-btn {
  -webkit-app-region: no-drag;
}

.whats-new-header {
  position: relative;
  flex-shrink: 0;
  padding: 22px 24px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--pb-line) 50%, transparent);
  background: radial-gradient(circle at 80% -20%, color-mix(in srgb, var(--pb-violet) 22%, transparent), transparent 70%);
}

.whats-new-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  margin-bottom: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--pb-violet) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--pb-violet) 35%, transparent);
  color: var(--pb-violet);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--pb-violet);
  box-shadow: 0 0 8px var(--pb-violet);
}

.whats-new-close {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--pb-ink) 8%, transparent);
  color: var(--pb-muted);
  font-size: 16px;
  cursor: pointer;
  transition: all 120ms ease;
}

.whats-new-close:hover {
  background: color-mix(in srgb, var(--pb-ink) 16%, transparent);
  color: var(--pb-ink);
}

.whats-new-title {
  margin: 0;
  color: var(--pb-ink);
  font-size: 19px;
  font-weight: 780;
  letter-spacing: -0.01em;
}

.whats-new-subtitle {
  margin: 4px 0 0;
  color: var(--pb-muted);
  font-size: 12px;
  line-height: 1.4;
}

.whats-new-body {
  padding: 14px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}

.whats-new-body::-webkit-scrollbar {
  width: 6px;
}

.whats-new-body::-webkit-scrollbar-track {
  background: transparent;
}

.whats-new-body::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--pb-ink) 18%, transparent);
  border-radius: 3px;
}

.whats-new-body::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--pb-ink) 30%, transparent);
}

.feature-card {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--pb-ink) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--pb-line) 40%, transparent);
  transition: transform 140ms ease, background-color 140ms ease;
}

.feature-card:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--pb-ink) 7%, transparent);
}

.feature-card__icon-wrap {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--pb-violet) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--pb-violet) 25%, transparent);
}

.feature-card__icon {
  font-size: 18px;
}

.feature-card__content {
  flex: 1;
  min-width: 0;
}

.feature-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 3px;
}

.feature-card__title {
  margin: 0;
  color: var(--pb-ink);
  font-size: 13px;
  font-weight: 700;
}

.feature-card__badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 6px;
}

.badge--violet {
  color: var(--pb-violet);
  background: color-mix(in srgb, var(--pb-violet) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--pb-violet) 25%, transparent);
}

.badge--blue {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.25);
}

.badge--amber {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.25);
}

.badge--emerald {
  color: #10b981;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.25);
}

.badge--pink {
  color: #ec4899;
  background: rgba(236, 72, 153, 0.12);
  border: 1px solid rgba(236, 72, 153, 0.25);
}

.badge--cyan {
  color: #06b6d4;
  background: rgba(6, 182, 212, 0.12);
  border: 1px solid rgba(6, 182, 212, 0.25);
}

.badge--slate {
  color: #8b5cf6;
  background: rgba(139, 92, 246, 0.12);
  border: 1px solid rgba(139, 92, 246, 0.25);
}

.feature-card__desc {
  margin: 0;
  color: var(--pb-muted);
  font-size: 11px;
  line-height: 1.45;
}

.whats-new-footer {
  flex-shrink: 0;
  position: relative;
  z-index: 2;
  padding: 14px 20px 18px;
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid color-mix(in srgb, var(--pb-line) 40%, transparent);
  background: color-mix(in srgb, var(--pb-glass-strong) 85%, transparent);
}

.whats-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 20px;
  border: 0;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--pb-violet), #4e40b3);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 14px color-mix(in srgb, var(--pb-violet) 40%, transparent);
  transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
}

.whats-new-btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
  box-shadow: 0 6px 20px color-mix(in srgb, var(--pb-violet) 55%, transparent);
}

.whats-new-btn:active {
  transform: translateY(0);
}

.btn-arrow {
  transition: transform 120ms ease;
}

.whats-new-btn:hover .btn-arrow {
  transform: translateX(3px);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
