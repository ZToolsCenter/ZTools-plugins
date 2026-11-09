<script setup lang="ts">
import type { MultiPasteMode, ShelfDockEdge } from "../../preload/window-preferences";

const props = defineProps<{
  dockEdge: ShelfDockEdge;
  multiPasteMode: MultiPasteMode;
  fetchUrlMetadata?: boolean | undefined;
  multiPasteHint: string;
  hotkeySettingsHint: string;
  hotkeySettingsMessage: string;
}>();

const emit = defineEmits<{
  "update:dockEdge": [value: ShelfDockEdge];
  "update:multiPasteMode": [value: MultiPasteMode];
  "update:fetchUrlMetadata": [value: boolean];
  openHotkeySettings: [];
  showWhatsNew: [];
}>();

const dockOptions: readonly (readonly [ShelfDockEdge, string])[] = [
  ["bottom", "下方"],
  ["top", "上方"],
  ["left", "左侧"],
  ["right", "右侧"],
];
const multiPasteOptions: readonly (readonly [MultiPasteMode, string])[] = [
  ["batch", "一次性多条"],
  ["queue", "逐一粘贴队列"],
];
</script>

<template>
  <div class="settings-page__intro"><strong>窗口与粘贴</strong><span>决定列表出现在哪里，以及多选后如何执行。</span></div>
  <fieldset class="option-field">
    <legend>显示位置</legend>
    <div class="option-grid option-grid--four">
      <label v-for="option in dockOptions" :key="option[0]">
        <input
          :checked="props.dockEdge === option[0]"
          type="radio"
          name="dock-edge"
          :value="option[0]"
          @change="emit('update:dockEdge', option[0])"
        />
        <span>{{ option[1] }}</span>
      </label>
    </div>
    <small>每次唤起都会贴在当前鼠标所在屏幕的对应边缘。</small>
  </fieldset>
  <fieldset class="option-field">
    <legend>多选粘贴</legend>
    <div class="option-grid option-grid--two">
      <label v-for="option in multiPasteOptions" :key="option[0]">
        <input
          :checked="props.multiPasteMode === option[0]"
          type="radio"
          name="multi-paste-mode"
          :value="option[0]"
          @change="emit('update:multiPasteMode', option[0])"
        />
        <span>{{ option[1] }}</span>
      </label>
    </div>
    <small>{{ multiPasteHint }}</small>
  </fieldset>
  <label class="settings-toggle">
    <span>
      <strong>自动获取链接标题与图标</strong>
      <small>复制网页链接时，自动解析获取网页标题与高清网站图标（跳过敏感 Token 链接与内网地址）。</small>
    </span>
    <input
      type="checkbox"
      aria-label="自动获取链接标题与图标"
      :checked="props.fetchUrlMetadata !== false"
      @change="emit('update:fetchUrlMetadata', ($event.target as HTMLInputElement).checked)"
    />
  </label>
  <div class="shortcut-settings">
    <span><strong>全局唤起快捷键</strong><small>{{ hotkeySettingsHint }}</small></span>
    <button type="button" @click="emit('openHotkeySettings')">设置 ZTools 快捷键</button>
  </div>
  <div class="shortcut-settings">
    <span><strong>版本新特性</strong><small>探索当前版本 (v1.3.0) 带来的全新功能与体验提升。</small></span>
    <button type="button" @click="emit('showWhatsNew')">查看新特性</button>
  </div>
  <p v-if="hotkeySettingsMessage" class="settings-result" role="status">{{ hotkeySettingsMessage }}</p>
</template>
