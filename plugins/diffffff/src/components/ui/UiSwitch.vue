<!--
  UiSwitch：北欧风开关（替代 ztools-ui ZSwitch，reka-ui SwitchRoot/Thumb）。

  形态：小尺寸圆角胶囊轨道，开启态雾松绿（主色）、关闭态浅米灰轨道；
  白色圆钮带 1px 克制阴影。过渡 0.12s 只动颜色，圆钮位移由 reka 的
  transform 承担。attrs（aria-label / class 等）落到根 switch 按钮上。
-->
<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'

withDefaults(defineProps<{ modelValue?: boolean; disabled?: boolean }>(), {
  modelValue: false,
  disabled: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <SwitchRoot
    class="ui-switch"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <SwitchThumb class="ui-switch-thumb" />
  </SwitchRoot>
</template>

<style scoped>
.ui-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: none;
  width: 30px;
  height: 17px;
  padding: 2px;
  border: none;
  border-radius: 999px;
  background-color: var(--control-border, #ddd7cb);
  cursor: pointer;
  transition: background-color 0.12s var(--ease-quiet);
}

.ui-switch:hover {
  background-color: var(--border-strong, #d7d1c4);
}

.ui-switch:focus-visible {
  outline: 1.5px solid var(--primary-color);
  outline-offset: 1px;
}

.ui-switch:disabled {
  opacity: 0.45;
  cursor: default;
}

/* 开启态：雾松绿轨道（hover 再深一档，主题内变化） */
.ui-switch[data-state='checked'] {
  background-color: var(--primary-color, #4e7a60);
}

.ui-switch[data-state='checked']:hover {
  background-color: color-mix(in srgb, var(--primary-color, #4e7a60) 88%, var(--bg-color, #f7f5f1));
}

/* 圆钮：纸白 + 1px 阴影，位移交给 transform（reka data-state 驱动） */
.ui-switch-thumb {
  display: block;
  width: 13px;
  height: 13px;
  border-radius: 999px;
  background-color: #ffffff;
  box-shadow: var(--shadow-1);
  transform: translateX(0);
  transition: transform 0.12s var(--ease-quiet);
  will-change: transform;
}

.ui-switch[data-state='checked'] .ui-switch-thumb {
  transform: translateX(13px);
}

@media (prefers-reduced-motion: reduce) {
  .ui-switch,
  .ui-switch-thumb {
    transition: none;
  }
}
</style>
