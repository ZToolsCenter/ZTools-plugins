<script setup lang="ts">
import type { ThemeName, ControlMode } from '../../constants/game'
import type { KeyBindings } from '../../constants/game'

const props = defineProps<{
  currentTheme: ThemeName
  controlMode: ControlMode
  keyBindings: KeyBindings
  isListening: boolean
  listeningAction: string | null
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'set-theme', theme: ThemeName): void
  (e: 'set-control-mode', mode: ControlMode): void
  (e: 'start-rebinding', action: string): void
  (e: 'reset-defaults'): void
}>()

function keyDisplayName(key: string): string {
  const map: Record<string, string> = {
    'ArrowLeft': '←', 'ArrowRight': '→', 'ArrowUp': '↑', 'ArrowDown': '↓',
    ' ': '空格', 'Control': 'Ctrl', 'Shift': 'Shift', 'Alt': 'Alt', 'Escape': 'Esc',
    'Enter': 'Enter', 'Tab': 'Tab', 'Backspace': 'BS', 'Delete': 'Del',
  }
  if (map[key]) return map[key]
  if (key && key.length === 1) return key.toUpperCase()
  return key || '?'
}

const themeCards = [
  { name: 'neon' as ThemeName, label: '霓虹赛博', desc: '发光边框 · 霓虹方块 · 科技感' },
  { name: 'modern' as ThemeName, label: '现代极简', desc: '柔和色彩 · 圆角设计 · 清爽' },
  { name: 'retro' as ThemeName, label: '复古像素', desc: 'CRT扫描线 · 像素字体 · 街机风' },
]

const modeCards = [
  { name: 'arrows' as ControlMode, label: '方向键', desc: '← → ↓ ↑ + 空格' },
  { name: 'wasd' as ControlMode, label: 'WASD', desc: 'A S D W + 空格' },
  { name: 'custom' as ControlMode, label: '自定义', desc: '自由设置键位' },
]

const actionLabels: Record<string, string> = {
  left: '移动 ←',
  right: '移动 →',
  down: '加速下降',
  rotate: '旋转',
  drop: '瞬间落下',
  pause: '暂停/继续',
}

const actionKeys = ['left', 'right', 'down', 'rotate', 'drop', 'pause'] as const
</script>

<template>
  <div id="settingsScreen" class="settings-screen">
    <div class="settings-header">
      <button class="back-btn" @click="$emit('back')">← 返回</button>
      <h2>设置</h2>
    </div>

    <!-- Theme selection -->
    <div class="theme-grid">
      <div
        v-for="card in themeCards"
        :key="card.name"
        class="theme-card"
        :class="{ active: currentTheme === card.name }"
        @click="$emit('set-theme', card.name)"
      >
        <div class="theme-preview" :class="card.name"></div>
        <div class="theme-card-info">
          <h4>{{ card.label }}</h4>
          <p>{{ card.desc }}</p>
        </div>
      </div>
    </div>

    <!-- Control mode -->
    <div class="settings-section-title">操控模式</div>
    <div class="control-mode-grid">
      <div
        v-for="mode in modeCards"
        :key="mode.name"
        class="mode-card"
        :class="{ active: controlMode === mode.name }"
        @click="$emit('set-control-mode', mode.name)"
      >
        <h4>{{ mode.label }}</h4>
        <p>{{ mode.desc }}</p>
      </div>
    </div>

    <!-- Custom key bindings -->
    <div id="keyBindings" v-if="controlMode === 'custom'" class="key-bindings">
      <div v-for="action in actionKeys" :key="action" class="bind-row">
        <span class="bind-label">{{ actionLabels[action] }}</span>
        <button
          class="bind-key"
          :class="{ listening: isListening && listeningAction === action }"
          @click="$emit('start-rebinding', action)"
        >
          {{ keyDisplayName(keyBindings[action]) }}
        </button>
      </div>
      <p class="bind-hint">点击按键，然后按下键盘上的新键位</p>
    </div>

    <button class="game-btn btn-ghost" style="margin-top:24px;" @click="$emit('reset-defaults')">
      恢复默认设置
    </button>
  </div>
</template>

<style scoped>
.settings-screen {
  animation: fadeIn 0.4s ease;
  width: 420px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  padding-right: 8px;
}

.settings-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 32px;
}

.settings-header h2 {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  transition: color 0.3s;
}

.back-btn {
  background: none;
  border: 2px solid;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  font-family: 'Noto Sans SC', sans-serif;
  cursor: pointer;
  transition: all 0.2s;
}

.back-btn:hover {
  transform: translateX(-2px);
}

.theme-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.theme-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 2px solid;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
}

.theme-card:hover {
  transform: translateX(4px);
}

.theme-card.active::after {
  content: '✓';
  position: absolute;
  right: 16px;
  font-size: 20px;
  font-weight: 700;
}

.theme-preview {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  flex-shrink: 0;
  border: 1px solid rgba(0,0,0,0.1);
}

.theme-card-info h4 {
  margin: 0 0 2px 0;
  font-size: 13px;
  font-weight: 600;
}

.theme-card-info p {
  margin: 0;
  font-size: 11px;
  opacity: 0.7;
}

.settings-section-title {
  font-size: 14px;
  font-weight: 700;
  margin: 20px 0 10px 0;
  transition: color 0.3s;
}

.control-mode-grid {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.mode-card {
  flex: 1;
  min-width: 90px;
  padding: 10px 12px;
  border: 2px solid;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.3s ease;
  text-align: center;
  position: relative;
}

.mode-card:hover {
  transform: translateY(-2px);
}

.mode-card h4 {
  margin: 0 0 2px 0;
  font-size: 12px;
  font-weight: 600;
}

.mode-card p {
  margin: 0;
  font-size: 10px;
  opacity: 0.7;
}

.mode-card.active::after {
  content: '✓';
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: 14px;
  font-weight: 700;
}

.key-bindings {
  margin-top: 14px;
}

.bind-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 8px;
  margin-bottom: 6px;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.bind-label {
  font-size: 12px;
  font-weight: 500;
}

.bind-key {
  min-width: 70px;
  padding: 4px 10px;
  border: 2px solid;
  border-radius: 6px;
  font-size: 12px;
  font-family: inherit;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  letter-spacing: 0.5px;
}

.bind-key:hover {
  transform: scale(1.05);
}

.bind-key.listening {
  animation: pulse 0.8s ease-in-out infinite alternate;
}

@keyframes pulse {
  from { opacity: 0.6; }
  to { opacity: 1; }
}

.bind-hint {
  font-size: 11px;
  opacity: 0.6;
  margin: 8px 0 0 0;
}

.game-btn {
  border: none;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  font-family: 'Noto Sans SC', sans-serif;
  cursor: pointer;
  transition: all 0.3s ease;
}

.game-btn:hover {
  transform: translateY(-2px);
}

.game-btn:active {
  transform: translateY(0);
}

.btn-ghost {
  background: transparent !important;
  border: 2px solid currentColor !important;
  box-shadow: none !important;
}

.btn-ghost:hover {
  transform: translateY(-1px) !important;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
