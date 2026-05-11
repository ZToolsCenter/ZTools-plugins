<script lang="ts" setup>
defineProps<{
  visible: boolean
  showFavoritesOnly: boolean
  horizontalLayout: string
  verticalLayout: string
}>()

const emit = defineEmits<{
  'update:showFavoritesOnly': [value: boolean]
  'update:horizontalLayout': [value: string]
  'update:verticalLayout': [value: string]
  close: []
}>()

const layoutOptions = [
  { label: '默认', value: 'default' },
  { label: '完整', value: 'full' },
  { label: '紧凑', value: 'fitted' },
  { label: '控制挤压', value: 'controlled smushing' },
  { label: '通用挤压', value: 'universal smushing' },
]
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="settings-overlay" @click.self="emit('close')">
      <div class="settings-panel">
        <h3 class="settings-title">字体设置</h3>

        <div class="setting-row">
          <label class="setting-label">
            仅显示收藏
            <span class="help-icon" title="勾选后，字体下拉列表和翻页只包含已收藏的字体">?</span>
          </label>
          <input
            type="checkbox"
            :checked="showFavoritesOnly"
            @change="emit('update:showFavoritesOnly', ($event.target as HTMLInputElement).checked)"
          />
        </div>

        <div class="setting-row">
          <label class="setting-label">
            水平间距
            <span class="help-icon" title="控制字符之间的水平排列方式">?</span>
          </label>
          <select
            class="setting-select"
            :value="horizontalLayout"
            @change="emit('update:horizontalLayout', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="opt in layoutOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="setting-row">
          <label class="setting-label">
            垂直间距
            <span class="help-icon" title="控制多行文字之间的垂直排列方式">?</span>
          </label>
          <select
            class="setting-select"
            :value="verticalLayout"
            @change="emit('update:verticalLayout', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="opt in layoutOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-panel {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  min-width: 320px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
}

.settings-title {
  margin: 0 0 20px;
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-label {
  font-size: 14px;
  color: #555;
  display: flex;
  align-items: center;
  gap: 4px;
}

.help-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #e0e0e0;
  color: #888;
  font-size: 11px;
  cursor: help;
}

.setting-select {
  min-width: 140px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  background: #f9fafb;
  color: #333;
}

.setting-select:focus {
  border-color: #3b82f6;
}

input[type='checkbox'] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

@media (prefers-color-scheme: dark) {
  .settings-panel {
    background: #3a3a3a;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
  }
  .settings-title {
    color: #eee;
  }
  .setting-label {
    color: #ccc;
  }
  .setting-row {
    border-bottom-color: #4a4a4a;
  }
  .setting-select {
    background: #4a4a4a;
    color: #eee;
    border-color: #555;
  }
  .help-icon {
    background: #555;
    color: #bbb;
  }
}
</style>
