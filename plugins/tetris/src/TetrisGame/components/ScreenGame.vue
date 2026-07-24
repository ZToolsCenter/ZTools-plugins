<script setup lang="ts">
import { ref, onMounted, onUnmounted, onBeforeUnmount, watch } from 'vue'
import { useGameSession } from '../composables/useGameSession'
import * as engine from '../engine'
import { COLS, ROWS } from '../../constants/game'
import type { KeyBindings } from '../../constants/game'
import type { ThemeName } from '../themes'

const props = defineProps<{
  themeName: ThemeName
  keyBindings: KeyBindings
  active: boolean
  /** Increment to force a fresh game start (home→game) */
  gameId: number
}>()

const emit = defineEmits<{
  (e: 'back-to-home'): void
  (e: 'show-settings', cameFromPause: boolean): void
}>()

// Canvas refs
const gameCanvas = ref<HTMLCanvasElement | null>(null)
const nextCanvas = ref<HTMLCanvasElement | null>(null)

// Game session
const session = useGameSession(props.themeName)
const showPauseOverlay = ref(false)

// Responsive block size
const blockSize = ref(30)

function computeBlockSize(): number {
  const vh = window.innerHeight
  const vw = window.innerWidth
  // Account for ZTools header and page padding
  const pad = 120
  const maxHeight = vh - pad
  const maxWidth = vw - pad
  const isLandscape = vw > 600
  // In landscape, board gets roughly half the width (info panel takes the rest)
  const boardWidth = isLandscape ? maxWidth * 0.55 : maxWidth
  const bs = Math.floor(Math.min(maxHeight / ROWS, boardWidth / COLS))
  return Math.max(18, Math.min(40, bs))
}

function applyBlockSize() {
  const size = computeBlockSize()
  blockSize.value = size
  engine.setBlockSize(size)
  if (gameCanvas.value) {
    gameCanvas.value.width = COLS * size
    gameCanvas.value.height = ROWS * size
  }
  if (nextCanvas.value) {
    const n = size * 5
    nextCanvas.value.width = n
    nextCanvas.value.height = n
  }
  engine.draw()
  engine.drawNextPiece()
}

let resizeTimer: ReturnType<typeof setTimeout> | null = null
function onResize() {
  if (!props.active) return
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(applyBlockSize, 150)
}

onMounted(() => {
  applyBlockSize()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (resizeTimer) clearTimeout(resizeTimer)
})

// Watch pause state to show/hide overlay
watch(() => session.isPaused.value, (val) => {
  showPauseOverlay.value = val
})

// Tracks the last gameId we started fresh for.
// When props.gameId increments (home→game), we start a fresh game.
// When props.gameId stays the same (settings→back), we resume the existing session.
const lastStartedGameId = ref(0)

// Initialize canvas refs (component is mounted via v-show even when hidden)
onMounted(() => {
  if (gameCanvas.value && nextCanvas.value) {
    session.initCanvas(gameCanvas.value, nextCanvas.value)
  }
})

// When the theme changes while the game screen is active, redraw immediately
watch(() => props.themeName, (newTheme) => {
  if (props.active) {
    engine.setThemeName(newTheme)
    engine.draw()
    engine.drawNextPiece()
  }
})

// Start/resume game loop when the screen becomes visible
watch(() => props.active, (active) => {
  if (active) {
    applyBlockSize() // Ensure correct canvas size after hidden resize guard skips
    if (props.gameId > lastStartedGameId.value) {
      // New game requested (gameId incremented from parent)
      lastStartedGameId.value = props.gameId
      session.startGame(props.themeName)
    } else if (!engine.isGameLoopRunning()) {
      // Re-shown (e.g. settings→back) → resume without resetting
      session.resumeLoop(props.themeName)
    }
    document.addEventListener('keydown', onGameKeyDown)
    window.addEventListener('blur', onBlur)
  } else {
    session.cleanup()
    document.removeEventListener('keydown', onGameKeyDown)
    window.removeEventListener('blur', onBlur)
  }
})

onUnmounted(() => {
  session.cleanup()
  document.removeEventListener('keydown', onGameKeyDown)
  window.removeEventListener('blur', onBlur)
})

// Game keyboard controls
function onGameKeyDown(e: KeyboardEvent) {
  const b = props.keyBindings
  const key = e.key.toLowerCase()
  const matchBinding = (binding: string) => key === binding.toLowerCase()

  // Pause key toggles pause
  if (matchBinding(b.pause)) {
    e.preventDefault()
    session.togglePause()
    return
  }

  // Don't process game keys if game is over, paused, or not visible
  if (session.gameOver.value || session.isPaused.value) return

  const piece = engine.getCurrentPiece()
  if (!piece) return

  if (matchBinding(b.left)) { e.preventDefault(); piece.moveLeft() }
  else if (matchBinding(b.right)) { e.preventDefault(); piece.moveRight() }
  else if (matchBinding(b.down)) {
    e.preventDefault()
    if (!piece.moveDown()) piece.lock()
  }
  else if (matchBinding(b.rotate)) { e.preventDefault(); piece.rotate() }
  else if (matchBinding(b.drop)) { e.preventDefault(); piece.hardDrop() }
  else return

  engine.draw()
  engine.drawNextPiece()
}

// Controls display helpers
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

function handleResume() {
  session.resumeGame()
  showPauseOverlay.value = false
}

function handleBackToHome() {
  session.cleanup()
  emit('back-to-home')
}

function handleShowSettings() {
  session.cleanup()
  emit('show-settings', true)
}

function onBlur() {
  if (!session.gameOver.value && !session.isPaused.value) {
    session.pauseGame()
  }
}
</script>

<template>
  <div class="screen-game-wrapper">
    <div id="gameScreen" class="tetris-container">
      <!-- Game board -->
      <div class="game-board">
        <canvas
          ref="gameCanvas"
          width="300"
          height="600"
        ></canvas>
      </div>

      <!-- Info panel -->
      <div class="info-panel">
        <div class="score-box">
          <div class="score-label">得分</div>
          <div class="score-value">{{ session.score.value }}</div>
        </div>

        <div class="next-piece">
          <div class="score-label">下一个</div>
          <canvas
            ref="nextCanvas"
            width="120"
            height="120"
          ></canvas>
        </div>

        <div class="controls">
          <h3>操作</h3>
          <div class="control-item">{{ keyDisplayName(props.keyBindings.left) }} : 移动</div>
          <div class="control-item">{{ keyDisplayName(props.keyBindings.down) }} : 加速下降</div>
          <div class="control-item">{{ keyDisplayName(props.keyBindings.rotate) }} : 旋转</div>
          <div class="control-item">{{ keyDisplayName(props.keyBindings.drop) }} : 瞬间落下</div>
          <div class="control-item">{{ keyDisplayName(props.keyBindings.pause) }} : 暂停游戏</div>
        </div>

        <button class="game-btn btn-ghost" @click="session.togglePause()">
          {{ session.isPaused.value ? '继续' : '暂停' }}
        </button>
      </div>
    </div>

    <!-- Game Over Modal (outside tetris-container to avoid backdrop-filter clipping) -->
    <div id="gameOver" class="game-over" :class="{ show: session.gameOver.value }">
      <div class="game-over-card">
        <h2>游戏结束！</h2>
        <p>最终得分: <span id="finalScore">{{ session.getFinalScore() }}</span></p>
        <div class="game-over-buttons">
          <button class="game-btn" @click="session.resetGame()">再玩一次</button>
          <button class="game-btn btn-ghost" @click="handleBackToHome()">← 主页</button>
        </div>
      </div>
    </div>

    <!-- Pause Overlay (outside tetris-container to avoid backdrop-filter clipping) -->
    <div id="pauseOverlay" class="pause-overlay" :class="{ show: showPauseOverlay }">
      <div class="pause-card">
        <h2>游戏暂停</h2>
        <div class="pause-buttons">
          <button class="game-btn" @click="handleResume()">继续游戏</button>
          <button class="game-btn" @click="handleBackToHome()">返回主页</button>
          <button class="game-btn pause-settings-btn" @click="handleShowSettings()">进入设置</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tetris-container {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  padding: 20px;
  border-radius: 14px;
  transition: all 0.4s ease;
  position: relative;
  animation: fadeIn 0.4s ease;
}

.game-board {
  border-radius: 10px;
  overflow: hidden;
  transition: all 0.4s ease;
}

canvas {
  display: block;
  transition: background 0.4s ease;
}

.info-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 130px;
  transition: color 0.3s;
}

.score-box, .next-piece, .controls {
  padding: 12px;
  border-radius: 10px;
  text-align: center;
  transition: all 0.4s ease;
}

.score-label {
  font-size: 11px;
  letter-spacing: 1.5px;
  margin-bottom: 4px;
  transition: color 0.3s;
}

.score-value {
  font-size: 24px;
  font-weight: 700;
  transition: color 0.3s, text-shadow 0.3s;
}

.controls h3 {
  margin: 0 0 6px 0;
  font-size: 12px;
  transition: color 0.3s;
}

.control-item {
  margin: 3px 0;
  font-size: 11px;
  transition: color 0.3s;
}

.game-btn {
  border: none;
  padding: 10px 14px;
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

.screen-game-wrapper {
  position: relative;
}

.info-actions {
  display: flex;
  flex-direction: row;
  gap: 10px;
  margin-top: 8px;
}

.info-actions .game-btn {
  flex: 1;
  text-align: center;
}

.btn-ghost {
  background: transparent !important;
  border: 2px solid currentColor !important;
  box-shadow: none !important;
}

.btn-ghost:hover {
  transform: translateY(-1px) !important;
}

/* Game Over */
.game-over {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: none;
  z-index: 100;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.25);
}

.game-over.show {
  display: flex;
  animation: pauseFadeIn 0.3s ease;
}

.game-over-card {
  padding: 48px;
  border-radius: 20px;
  text-align: center;
  min-width: 300px;
  background: rgba(255,255,255,0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255,255,255,0.15);
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  transition: all 0.4s ease;
}

.game-over-card h2 {
  margin: 0 0 16px 0;
  font-size: 32px;
  transition: color 0.3s, text-shadow 0.3s;
}

.game-over-card p {
  font-size: 16px;
  margin-bottom: 24px;
  transition: color 0.3s;
}

.game-over-buttons {
  display: flex;
  gap: 16px;
  justify-content: center;
}

/* Pause Overlay */
.pause-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: none;
  z-index: 99;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.25);
}

.pause-overlay.show {
  display: flex;
  animation: pauseFadeIn 0.2s ease;
}

.pause-card {
  padding: 48px;
  border-radius: 20px;
  text-align: center;
  min-width: 300px;
  background: rgba(255,255,255,0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255,255,255,0.15);
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  transition: all 0.4s ease;
}

.pause-card h2 {
  margin: 0 0 28px 0;
  font-size: 32px;
  transition: color 0.3s, text-shadow 0.3s;
}

.pause-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

.pause-settings-btn {
  margin-top: 4px;
  background: transparent !important;
  border: 2px solid currentColor !important;
  box-shadow: none !important;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pauseFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (max-width: 600px) {
  .tetris-container {
    flex-direction: column;
    align-items: center;
    padding: 14px;
    gap: 12px;
  }
}
</style>
