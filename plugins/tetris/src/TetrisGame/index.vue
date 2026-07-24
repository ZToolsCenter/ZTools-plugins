<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import ScreenHome from './components/ScreenHome.vue'
import ScreenSettings from './components/ScreenSettings.vue'
import ScreenGame from './components/ScreenGame.vue'
import { useTheme } from './composables/useTheme'
import { useControls } from './composables/useControls'
import * as engine from './engine'

// Screen navigation — internal to the game (not ZTools route)
type GameScreen = 'home' | 'settings' | 'game'
const screen = ref<GameScreen>('home')
const cameFromPause = ref(false)
const gameId = ref(0)

// Composable instances
const { currentTheme, setTheme } = useTheme()
const {
  controlMode,
  keyBindings,
  isListening,
  listeningAction,
  setControlMode,
  startRebinding,
  finishRebinding,
  resetToDefaults,
} = useControls()

// Navigation
function goToGame() {
  cameFromPause.value = false
  gameId.value++
  screen.value = 'game'
}

function goToSettings() {
  cameFromPause.value = false
  screen.value = 'settings'
}

function gameBackToHome() {
  cameFromPause.value = false
  screen.value = 'home'
}

function gameToSettings(cameFrom: boolean) {
  cameFromPause.value = cameFrom
  screen.value = 'settings'
}

function settingsBack() {
  if (cameFromPause.value) {
    cameFromPause.value = false
    screen.value = 'game'
  } else {
    screen.value = 'home'
  }
}

// Global keyboard: rebinding + ESC navigation
function onKeyDown(e: KeyboardEvent) {
  // Rebinding is active — capture key
  if (isListening.value) {
    e.preventDefault()
    finishRebinding(e.key)
    return
  }

  // ESC on settings → back (game if from pause, home otherwise)
  if (e.key === 'Escape' && screen.value === 'settings') {
    settingsBack()
    e.preventDefault()
    return
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
  engine.stopGameLoop()
})
</script>

<template>
  <div class="tetris-game-root">
    <ScreenHome
      v-if="screen === 'home'"
      @start-game="goToGame"
      @show-settings="goToSettings"
    />

    <ScreenSettings
      v-if="screen === 'settings'"
      :current-theme="currentTheme"
      :control-mode="controlMode"
      :key-bindings="keyBindings"
      :is-listening="isListening"
      :listening-action="listeningAction"
      @back="settingsBack"
      @set-theme="setTheme"
      @set-control-mode="setControlMode"
      @start-rebinding="startRebinding"
      @reset-defaults="resetToDefaults"
    />

    <ScreenGame
      v-show="screen === 'game'"
      :theme-name="currentTheme"
      :key-bindings="keyBindings"
      :active="screen === 'game'"
      :game-id="gameId"
      @back-to-home="gameBackToHome"
      @show-settings="gameToSettings"
    />
  </div>
</template>

<style scoped>
.tetris-game-root {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}
</style>
