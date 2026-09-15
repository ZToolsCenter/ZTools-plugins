<!--
  UiButton：北欧风轻量按钮（替代 ztools-ui ZButton）。

  三个 variant：
  - secondary（默认）：纸面底 + 细描边，hover 边框加深一档 + 底色轻提亮；
  - primary：雾松绿纯色填充（唯一重色按钮，保留克制阴影），hover 微深；
  - ghost：无底无边，hover 轻底色洗色（图标钮 / 行内次动作）。

  tone="danger" 供 ghost 删除钮着陶土红（history-item-delete 场景）。
  hover / 过渡遵守「极轻」原则：0.12s、只动背景 / 边框 / 文字色，无位移无发光。
  attrs（class / title / disabled / aria-* 等）落到根 button 上（inheritAttrs 默认），
  供外部布局类（sidebar-block-btn 等）与原生 tooltip 使用。
-->
<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'secondary' | 'primary' | 'ghost'
    tone?: 'default' | 'danger'
    size?: 'small' | 'medium'
    disabled?: boolean
  }>(),
  { variant: 'secondary', tone: 'default', size: 'small', disabled: false },
)
</script>

<template>
  <!-- 恒 type="button"：本插件无表单提交场景，杜绝隐式 submit 行为 -->
  <button
    type="button"
    class="ui-btn"
    :class="[`is-${variant}`, `tone-${tone}`, `size-${size}`]"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
.ui-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-s, 6px);
  font-family: inherit;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition:
    background-color 0.12s var(--ease-quiet),
    border-color 0.12s var(--ease-quiet),
    color 0.12s var(--ease-quiet),
    box-shadow 0.12s var(--ease-quiet);
}

.ui-btn:focus-visible {
  outline: 1.5px solid var(--primary-color);
  outline-offset: 1px;
}

.ui-btn:disabled {
  opacity: 0.45;
  cursor: default;
  pointer-events: none;
}

/* 尺寸：small（工具栏 / 侧边栏默认）与 medium（底部主按钮） */
.ui-btn.size-small {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  line-height: 1;
}

.ui-btn.size-medium {
  height: 32px;
  padding: 0 18px;
  font-size: 13px;
  line-height: 1;
}

/* secondary：纸面 + 细描边（默认形态，最贴近「干净桌面」） */
.ui-btn.is-secondary {
  background-color: var(--surface, #ffffff);
  border-color: var(--control-border, #ddd7cb);
  color: var(--text-color, #2e2c28);
  box-shadow: var(--shadow-1);
}

.ui-btn.is-secondary:hover {
  border-color: var(--border-strong, #d7d1c4);
  background-color: color-mix(in srgb, var(--surface, #ffffff) 55%, var(--hover-bg, #f2f0ea));
}

/* primary：雾松绿纯色填充，克制的 1px 阴影（不发光、不渐变） */
.ui-btn.is-primary {
  background-color: var(--primary-color, #4e7a60);
  color: var(--text-on-primary, #ffffff);
  box-shadow: var(--shadow-1);
}

.ui-btn.is-primary:hover {
  background-color: color-mix(in srgb, var(--primary-color, #4e7a60) 90%, var(--bg-color, #f7f5f1));
}

/* ghost：无底无边（图标钮 / 行内次动作），hover 轻洗色 */
.ui-btn.is-ghost {
  background-color: transparent;
  color: var(--text-secondary, #8a8377);
}

.ui-btn.is-ghost:hover {
  background-color: var(--hover-bg, #f2f0ea);
  color: var(--text-color, #2e2c28);
}

/* tone-danger：ghost 删除钮着陶土红，hover 同色轻底 */
.ui-btn.is-ghost.tone-danger {
  color: var(--danger-color, #b3563e);
}

.ui-btn.is-ghost.tone-danger:hover {
  background-color: color-mix(in srgb, var(--danger-color, #b3563e) 10%, transparent);
  color: var(--danger-color, #b3563e);
}
</style>
