<script setup lang="ts">
import type { ShelfUiVersion, ThemeBackground } from "../../preload/window-preferences";
import ThemeImageBackdrop from "./ThemeImageBackdrop.vue";

defineProps<{
  uiVersion: ShelfUiVersion;
  background: ThemeBackground;
}>();
</script>

<template>
  <div
    class="theme-preview"
    :class="`theme-preview--${uiVersion}`"
    :data-ui-version="uiVersion"
    aria-label="外观预览"
  >
    <ThemeImageBackdrop :background="background" />
    <div class="theme-preview__brand-wrap">
      <span class="theme-preview__brand">Paste</span>
      <span class="theme-preview__tag">{{ uiVersion === 'modern' ? '新版外观' : '经典外观' }}</span>
    </div>

    <div class="theme-preview__cards" :class="`theme-preview__cards--${uiVersion}`">
      <!-- 新版卡片预览 (高卡片、顶部应用图标、正文预览、底部角标) -->
      <template v-if="uiVersion === 'modern'">
        <div class="theme-preview__modern-card" data-pb-theme-preview-card>
          <div class="theme-preview__card-head">
            <span class="theme-preview__app-dot"></span>
            <span class="theme-preview__title-bar"></span>
          </div>
          <div class="theme-preview__card-body">文本内容</div>
          <div class="theme-preview__card-foot">
            <span>文本</span>
            <kbd>⌘1</kbd>
          </div>
        </div>
        <div class="theme-preview__modern-card theme-preview__modern-card--url" data-pb-theme-preview-card>
          <div class="theme-preview__card-head">
            <span class="theme-preview__app-dot theme-preview__app-dot--url"></span>
            <span class="theme-preview__title-bar"></span>
          </div>
          <div class="theme-preview__card-body">https://...</div>
          <div class="theme-preview__card-foot">
            <span>链接</span>
            <kbd>⌘2</kbd>
          </div>
        </div>
        <div class="theme-preview__modern-card theme-preview__modern-card--image" data-pb-theme-preview-card>
          <div class="theme-preview__card-head">
            <span class="theme-preview__app-dot theme-preview__app-dot--image"></span>
            <span class="theme-preview__title-bar"></span>
          </div>
          <div class="theme-preview__card-image-box">
            <svg viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor"/><path d="m4 15 5-5 4 4 3-3 1 1" stroke="currentColor" stroke-width="1.5"/></svg>
          </div>
          <div class="theme-preview__card-foot">
            <span>图片</span>
            <kbd>⌘3</kbd>
          </div>
        </div>
      </template>

      <!-- 经典版卡片预览 (扁平卡片、顶部彩色类型标签+序号、加粗底部标题) -->
      <template v-else>
        <div class="theme-preview__classic-card" data-pb-theme-preview-card>
          <div class="theme-preview__classic-head">
            <span class="theme-preview__classic-badge">TEXT</span>
            <kbd class="theme-preview__classic-kbd">1</kbd>
          </div>
          <div class="theme-preview__classic-body">普通文本内容</div>
          <div class="theme-preview__classic-foot">
            <strong>备忘便签</strong>
          </div>
        </div>
        <div class="theme-preview__classic-card" data-pb-theme-preview-card>
          <div class="theme-preview__classic-head">
            <span class="theme-preview__classic-badge theme-preview__classic-badge--url">URL</span>
            <kbd class="theme-preview__classic-kbd">2</kbd>
          </div>
          <div class="theme-preview__classic-body">网页链接</div>
          <div class="theme-preview__classic-foot">
            <strong>zcool.com.cn</strong>
          </div>
        </div>
        <div class="theme-preview__classic-card" data-pb-theme-preview-card>
          <div class="theme-preview__classic-head">
            <span class="theme-preview__classic-badge theme-preview__classic-badge--img">IMAGE</span>
            <kbd class="theme-preview__classic-kbd">3</kbd>
          </div>
          <div class="theme-preview__classic-body">
            <svg viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor"/><path d="m4 15 5-5 4 4 3-3 1 1" stroke="currentColor" stroke-width="1.5"/></svg>
          </div>
          <div class="theme-preview__classic-foot">
            <strong>屏幕截图</strong>
          </div>
        </div>
      </template>
    </div>

    <span class="theme-preview__button">外观预览</span>
  </div>
</template>

<style scoped>
.theme-preview {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  min-height: 110px;
  margin-bottom: 16px;
  padding: 16px 18px;
  overflow: hidden;
  border: 1px solid var(--settings-line);
  border-radius: 12px;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  transition: border-color 160ms ease, background 160ms ease;
}

.theme-preview__brand-wrap { display: flex; flex-direction: column; gap: 4px; }
.theme-preview__brand { color: var(--preview-accent, var(--settings-accent)); font-size: 19px; font-weight: 780; letter-spacing: -.04em; }
.theme-preview__tag {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--preview-accent, var(--settings-accent)) 16%, transparent);
  color: var(--preview-accent, var(--settings-accent));
  width: fit-content;
}

.theme-preview__cards {
  display: flex;
  gap: 8px;
  justify-content: center;
  align-items: center;
  min-height: 84px;
}

/* Modern Mini Cards */
.theme-preview__modern-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 72px;
  height: 84px;
  padding: 6px;
  border: 1px solid color-mix(in srgb, var(--preview-accent, var(--settings-line)) 26%, var(--settings-line));
  border-radius: 10px;
  background: linear-gradient(150deg, color-mix(in srgb, var(--settings-surface) 95%, var(--settings-ink) 5%), var(--settings-surface));
  box-shadow: 0 2px 8px rgb(0 0 0 / 7%);
  font-size: 9px;
  color: var(--settings-ink);
  box-sizing: border-box;
  transition: transform 140ms ease;
}
.theme-preview__modern-card:hover { transform: translateY(-1px); }

.theme-preview__card-head { display: flex; align-items: center; gap: 4px; }
.theme-preview__app-dot { width: 10px; height: 10px; border-radius: 3px; background: var(--preview-accent, var(--settings-accent)); flex: none; }
.theme-preview__app-dot--url { background: #3b82f6; }
.theme-preview__app-dot--image { background: #10b981; }
.theme-preview__title-bar { height: 4px; width: 34px; border-radius: 2px; background: color-mix(in srgb, var(--settings-ink) 20%, transparent); }

.theme-preview__card-body {
  font-size: 8px;
  line-height: 1.25;
  color: var(--settings-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 0;
}
.theme-preview__card-image-box {
  display: grid;
  place-items: center;
  height: 32px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--settings-ink) 6%, transparent);
  color: var(--settings-muted);
}
.theme-preview__card-image-box svg { width: 14px; height: 14px; }

.theme-preview__card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 8px;
  color: var(--settings-muted);
  padding-top: 2px;
  border-top: 1px solid color-mix(in srgb, var(--settings-line) 60%, transparent);
}
.theme-preview__card-foot kbd { font-size: 7px; padding: 1px 3px; border-radius: 3px; background: color-mix(in srgb, var(--settings-ink) 6%, transparent); }

/* Classic Mini Cards */
.theme-preview__classic-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 82px;
  height: 60px;
  padding: 5px 6px;
  border: 1px solid var(--settings-line);
  border-radius: 6px;
  background: var(--pb-theme-card-background, color-mix(in srgb, var(--settings-surface) 85%, transparent));
  box-shadow: 0 1px 4px rgb(0 0 0 / 5%);
  font-size: 8px;
  color: var(--settings-ink);
  box-sizing: border-box;
}

.theme-preview__classic-head { display: flex; align-items: center; justify-content: space-between; }
.theme-preview__classic-badge { font-size: 7px; font-weight: 700; color: var(--preview-accent, var(--settings-accent)); letter-spacing: 0.04em; }
.theme-preview__classic-badge--url { color: #3b82f6; }
.theme-preview__classic-badge--img { color: #10b981; }
.theme-preview__classic-kbd { font-size: 7px; padding: 0 3px; border-radius: 2px; border: 1px solid var(--settings-line); }

.theme-preview__classic-body {
  font-size: 8px;
  color: var(--settings-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: grid;
  place-items: center;
}
.theme-preview__classic-body svg { width: 14px; height: 14px; }

.theme-preview__classic-foot { font-size: 8px; font-weight: 600; color: var(--settings-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.theme-preview__button {
  display: grid;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 7px;
  background: var(--preview-accent, var(--settings-accent));
  color: var(--preview-on-accent, var(--settings-on-accent));
  font-size: 10px;
  font-weight: 680;
  place-items: center;
}
</style>
