<script setup lang="ts">
/**
 * 关于弹窗组件
 * 展示应用信息、功能特性、技术栈等内容
 */
import { X, Palette, Code2, Download, Zap, Heart, Sparkles, Monitor } from 'lucide-vue-next'

// 组件属性
defineProps<{
  show: boolean  // 是否显示弹窗
}>()

// 组件事件
const emit = defineEmits<{
  (e: 'close'): void  // 关闭弹窗事件
}>()

// 功能特性列表
const features = [
  {
    icon: Code2,
    title: '语法高亮',
    desc: '100+ 语言',
    gradient: 'from-pink-500 to-rose-500'
  },
  {
    icon: Palette,
    title: '丰富主题',
    desc: '10+ 配色',
    gradient: 'from-violet-500 to-purple-500'
  },
  {
    icon: Download,
    title: '多格式导出',
    desc: 'PNG / SVG',
    gradient: 'from-emerald-500 to-teal-500'
  },
  {
    icon: Zap,
    title: '智能检测',
    desc: '自动识别',
    gradient: 'from-amber-500 to-orange-500'
  }
]

// 技术栈列表
const techStack = [
  { name: 'Vue 3', color: '#42b883', icon: 'V' },
  { name: 'TypeScript', color: '#3178c6', icon: 'TS' },
  { name: 'Shiki', color: '#1e1e2e', icon: '♓' },
  { name: 'Vite', color: '#646cff', icon: '⚡' }
]
</script>

<template>
  <Teleport to="body">
    <Transition name="overlay">
      <div v-if="show" class="about-modal-overlay" @click="emit('close')">
        <Transition name="modal">
          <div v-if="show" class="about-modal" @click.stop>
            <!-- Decorative floating shapes -->
            <div class="decorative-shapes">
              <div class="shape shape-1"></div>
              <div class="shape shape-2"></div>
              <div class="shape shape-3"></div>
            </div>

            <button class="close-about-btn" @click="emit('close')">
              <X :size="16" />
            </button>

            <!-- Header Section -->
            <div class="about-header">
              <div class="app-icon">
                <div class="app-icon-inner">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="16 18 22 12 16 6"></polyline>
                    <polyline points="8 6 2 12 8 18"></polyline>
                  </svg>
                </div>
                <div class="app-icon-glow"></div>
              </div>
              <div class="title-row">
                <h2 class="about-title">Code Screenshot</h2>
                <span class="version-badge">v1.0.0</span>
              </div>
              <p class="about-desc">
                一款优雅而专业的代码截图工具。将您的代码片段转化为精美的设计图片，支持语法高亮与多种主题。
              </p>
            </div>

            <!-- Features Grid -->
            <div class="features-section">
              <h3 class="section-title">
                <Sparkles :size="14" />
                功能特性
              </h3>
              <div class="features-grid">
                <div v-for="feature in features" :key="feature.title" class="feature-card">
                  <div class="feature-icon" :class="feature.gradient">
                    <component :is="feature.icon" :size="18" />
                  </div>
                  <div class="feature-info">
                    <span class="feature-title">{{ feature.title }}</span>
                    <span class="feature-desc">{{ feature.desc }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Code Preview -->
            <div class="preview-section">
              <h3 class="section-title">
                <Monitor :size="14" />
                效果预览
              </h3>
              <div class="code-window">
                <div class="window-header">
                  <div class="window-dots">
                    <span class="dot dot-red"></span>
                    <span class="dot dot-yellow"></span>
                    <span class="dot dot-green"></span>
                  </div>
                  <span class="window-title">hello.ts</span>
                </div>
                <div class="window-content">
                  <pre><code><span class="keyword">const</span> <span class="fn">greet</span> = (<span class="param">name</span>: <span class="type">string</span>) => {{ '{' }}
  <span class="keyword">return</span> <span class="string">`Hello, ${<span class="param">name</span>}!`</span>
{{ '}' }}

<span class="comment">// 输出: Hello, World!</span>
<span class="fn">greet</span>(<span class="string">"World"</span>)</code></pre>
                </div>
              </div>
            </div>

            <!-- Footer -->
            <div class="about-footer">
              <div class="tech-section">
                <span class="tech-label">Powered by</span>
                <div class="tech-tags">
                  <span v-for="tech in techStack" :key="tech.name" class="tech-tag"
                    :style="{ '--tech-color': tech.color }">
                    <span class="tech-icon">{{ tech.icon }}</span>
                    {{ tech.name }}
                  </span>
                </div>
              </div>
              <div class="brand-row">
                <span class="brand-text">
                  <Heart :size="12" class="heart-icon" />
                  Made with for developers
                </span>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.about-modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-modal-overlay);
  backdrop-filter: blur(8px);
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.about-modal {
  position: relative;
  width: 100%;
  max-width: 420px;
  max-height: 90vh;
  overflow-y: auto;
  /* Allow vertical scroll when content exceeds viewport */
  overflow-x: hidden;
  background: var(--color-modal-bg);
  border: 1px solid var(--color-dropdown-border);
  border-radius: 24px;
  padding: 32px 28px 28px;
  display: flex;
  flex-direction: column;
  gap: 24px;

  // Hide scrollbar
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    display: none;
  }

  // Light theme specific adjustments
  :global(.light-theme) & {
    background: rgba(255, 255, 255, 0.98);
    box-shadow:
      0 25px 50px -12px rgba(0, 0, 0, 0.15),
      0 0 0 1px rgba(0, 0, 0, 0.05);
  }
}

// Decorative shapes
.decorative-shapes {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  border-radius: 24px;
}

.shape {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.15;

  &-1 {
    width: 200px;
    height: 200px;
    background: var(--color-accent-blue);
    top: -80px;
    right: -60px;
  }

  &-2 {
    width: 150px;
    height: 150px;
    background: var(--color-accent-purple);
    bottom: -50px;
    left: -40px;
  }

  &-3 {
    width: 100px;
    height: 100px;
    background: #f43f5e;
    top: 40%;
    left: -30px;
    opacity: 0.1;
  }
}

.close-about-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-dropdown-hover);
  border: 1px solid var(--color-divider);
  border-radius: 10px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 10;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--color-text);
    border-color: rgba(255, 255, 255, 0.2);
  }

  :global(.light-theme) &:hover {
    background: rgba(0, 0, 0, 0.05);
    border-color: rgba(0, 0, 0, 0.1);
  }
}

.about-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
}

.app-icon {
  position: relative;
  width: 80px;
  height: 80px;
}

.app-icon-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%);
  border-radius: 20px;
  color: white;
  box-shadow:
    0 8px 32px rgba(56, 189, 248, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.1) inset;
  position: relative;
  z-index: 1;
}

.app-icon-glow {
  position: absolute;
  inset: -10px;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.4), rgba(139, 92, 246, 0.4));
  border-radius: 30px;
  filter: blur(20px);
  animation: pulse-glow 3s ease-in-out infinite;
}

@keyframes pulse-glow {

  0%,
  100% {
    opacity: 0.5;
    transform: scale(1);
  }

  50% {
    opacity: 0.8;
    transform: scale(1.05);
  }
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.about-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
  letter-spacing: -0.5px;
}

.version-badge {
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-accent-blue);
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 6px;
}

.about-desc {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-muted);
  line-height: 1.6;
  max-width: 320px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;

  svg {
    opacity: 0.7;
  }
}

.features-section {
  padding: 20px;
  background: var(--color-dropdown-hover);
  border: 1px solid var(--color-divider);
  border-radius: 16px;

  :global(.light-theme) & {
    background: rgba(0, 0, 0, 0.02);
  }
}

.features-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.feature-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--color-modal-bg);
  border: 1px solid var(--color-divider);
  border-radius: 12px;
  transition: all 0.2s ease;

  &:hover {
    transform: translateY(-2px);
    border-color: rgba(255, 255, 255, 0.15);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  :global(.light-theme) &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }
}

.feature-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: white;
  flex-shrink: 0;

  &.from-pink-500 {
    background: linear-gradient(135deg, #ec4899, #f43f5e);
  }

  &.from-violet-500 {
    background: linear-gradient(135deg, #8b5cf6, #a855f7);
  }

  &.from-emerald-500 {
    background: linear-gradient(135deg, #10b981, #14b8a6);
  }

  &.from-amber-500 {
    background: linear-gradient(135deg, #f59e0b, #f97316);
  }
}

.feature-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.feature-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.feature-desc {
  font-size: 11px;
  color: var(--color-text-muted-darker);
}

.preview-section {
  margin-top: 4px;
}

.code-window {
  background: #1e1e2e;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  overflow: hidden;
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.window-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.window-dots {
  display: flex;
  gap: 6px;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;

  &-red {
    background: #ff5f56;
  }

  &-yellow {
    background: #ffbd2e;
  }

  &-green {
    background: #27ca40;
  }
}

.window-title {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  font-family: var(--font-mono);
}

.window-content {
  padding: 16px;
}

.window-content pre {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.7;
  color: #cdd6f4;

  .keyword {
    color: #cba6f7;
  }

  .fn {
    color: #89b4fa;
  }

  .param {
    color: #fab387;
  }

  .type {
    color: #f9e2af;
  }

  .string {
    color: #a6e3a1;
  }

  .comment {
    color: #6c7086;
    font-style: italic;
  }
}

.about-footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding-top: 20px;
  border-top: 1px solid var(--color-divider);
}

.tech-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.tech-label {
  font-size: 11px;
  color: var(--color-text-muted-darker);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.tech-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.tech-tag {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--tech-color);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    transform: translateY(-1px);
  }

  :global(.light-theme) & {
    background: rgba(0, 0, 0, 0.04);
    border-color: rgba(0, 0, 0, 0.08);

    &:hover {
      background: rgba(0, 0, 0, 0.08);
    }
  }
}

.tech-icon {
  font-size: 10px;
  opacity: 0.8;
}

.brand-row {
  display: flex;
  align-items: center;
}

.brand-text {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-muted-darker);
}

.heart-icon {
  color: #f43f5e;
  fill: #f43f5e;
  animation: heartbeat 1.5s ease-in-out infinite;
}

@keyframes heartbeat {

  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.1);
  }
}

// Transitions
.overlay-enter-active,
.overlay-leave-active {
  transition: opacity 0.25s ease;
}

.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}

.modal-enter-active {
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.modal-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.modal-enter-from {
  opacity: 0;
  transform: scale(0.9) translateY(20px);
}

.modal-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
