<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";

defineProps<{
  version?: string;
  standalone?: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const features = [
  {
    icon: "☁️",
    title: "WebDAV 自动定时加密备份",
    badge: "数据随行",
    tagClass: "badge--violet",
    desc: "支持按需自定义备份周期（每 15 分钟至 24 小时），默认每小时后台无感加密上传 WebDAV；休眠唤醒自动补漏，历史数据与自定义分组多端永久安全随行。",
  },
  {
    icon: "🖼️",
    title: "长图宽图顺畅滑动与分辨率",
    badge: "视觉进化",
    tagClass: "badge--blue",
    desc: "智能感知图片宽高比：竖图长截图垂直滑动，全景宽图水平滑动；鼠标悬停即刻展示原始物理分辨率（如 1920×1080），底部信息留白呼吸，绝不遮挡。",
  },
  {
    icon: "⚡",
    title: "十万级历史毫秒秒搜",
    badge: "性能突破",
    tagClass: "badge--amber",
    desc: "后台专属轻量 Worker 检索引掣与按页动态水合，即使本地累积 100,000+ 条记录依然秒打秒搜，浮窗轻盈秒开不占电脑内存。",
  },
  {
    icon: "🚀",
    title: "虚拟化时间线与零闪烁唤起",
    badge: "丝滑流畅",
    tagClass: "badge--emerald",
    desc: "动态视口虚拟滚动，极大削减海量卡片下的渲染压力；首屏数据就绪后平滑显现，彻底消除启动闪烁，并深度校准多屏幕与外接显示器坐标。",
  },
  {
    icon: "🖱️",
    title: "原生拖拽直发与截图入库",
    badge: "顺畅流转",
    tagClass: "badge--pink",
    desc: "从时间线直接原生拖拽卡片到微信、飞书或桌面；一键静默截屏自动沉淀入库，无需手动另存转存。",
  },
  {
    icon: "⌨️",
    title: "跨平台原生操控心流",
    badge: "键盘掌控",
    tagClass: "badge--cyan",
    desc: "macOS 保持原生 ⌘ 习惯，Windows/Linux 深度适配 Ctrl；方向键游走、回车即贴、空格大图预览、快捷键直达设置中心，全键盘行云流水。",
  },
  {
    icon: "🛡️",
    title: "专属数据隔离与安全守护",
    badge: "安全加固",
    tagClass: "badge--slate",
    desc: "数据全面迁移至插件专属 pluginData 存储目录；附件清理采用 SHA-256 内容寻址白名单双重安全复核，坚如磐石不误删。",
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
          <span>🚀 版本更新 {{ version ?? "v1.3.0" }} · 7 大生产力升级</span>
        </div>
        <button type="button" class="whats-new-close" aria-label="关闭更新日志" @click="emit('close')">×</button>
        <h2 id="whats-new-title" class="whats-new-title">全新特性，助你效率翻倍</h2>
        <p class="whats-new-subtitle">给你更顺手、更丝滑、更稳定的下一代剪贴板生产力体验</p>
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
  position: static;
  inset: auto;
  width: 100%;
  height: 100%;
  padding: 0;
  background: var(--pb-window-bg);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  animation: none;
}

.whats-new-modal {
  position: relative;
  width: 100%;
  max-width: 540px;
  max-height: 90vh;
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
  max-width: none;
  max-height: none;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: var(--pb-window-bg);
  animation: none;
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
  overflow-y: auto;
  scrollbar-width: thin;
  flex: 1;
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
