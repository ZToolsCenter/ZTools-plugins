import { ref } from 'vue'
import * as engine from '../engine'
import type { ThemeName } from '../themes'

export function useGameSession(themeName: ThemeName) {
  const score = ref(0)
  const gameOver = ref(false)
  const isPaused = ref(false)

  // Canvas refs — these will be set by the component
  let canvasCtx: CanvasRenderingContext2D | null = null
  let nextCanvasCtx: CanvasRenderingContext2D | null = null

  // ============================================================
  //  SETUP CANVAS
  // ============================================================
  function initCanvas(canvas: HTMLCanvasElement, nextCanvas: HTMLCanvasElement) {
    canvasCtx = canvas.getContext('2d')
    nextCanvasCtx = nextCanvas.getContext('2d')
    if (canvasCtx && nextCanvasCtx) {
      engine.setCanvasContexts(canvasCtx, nextCanvasCtx)
    }
  }

  // ============================================================
  //  GAME LIFECYCLE
  // ============================================================
  function startGame(themeNameOverride?: ThemeName) {
    score.value = 0
    gameOver.value = false
    isPaused.value = false

    engine.setCallbacks({
      onScoreChange: (s) => { score.value = s },
      onGameOverChange: (g) => { gameOver.value = g },
    })
    engine.setThemeName(themeNameOverride ?? themeName)
    engine.resetEngine()
    engine.startGameLoop()
  }

  function resetGame() {
    gameOver.value = false
    isPaused.value = false
    engine.resetEngine()
    engine.startGameLoop()
  }

  function togglePause() {
    if (gameOver.value) return
    isPaused.value = !isPaused.value
    engine.setEnginePaused(isPaused.value)
  }

  function pauseGame() {
    if (gameOver.value || isPaused.value) return
    isPaused.value = true
    engine.setEnginePaused(true)
  }

  function resumeGame() {
    if (!isPaused.value) return
    isPaused.value = false
    engine.setEnginePaused(false)
  }

  function cleanup() {
    engine.stopGameLoop()
  }

  /**
   * Restart the animation loop WITHOUT resetting game state.
   * Used when returning from settings (component stays alive via v-show).
   */
  function resumeLoop(themeNameOverride?: ThemeName) {
    const themeChanged = themeNameOverride !== undefined
    if (themeNameOverride) {
      engine.setThemeName(themeNameOverride)
    }
    engine.setCallbacks({
      onScoreChange: (s) => { score.value = s },
      onGameOverChange: (g) => { gameOver.value = g },
    })
    engine.startGameLoop()
    // restore pause state after startGameLoop() (which resets enginePaused to false)
    engine.setEnginePaused(isPaused.value)
    // if theme changed while paused, force immediate redraw so the new theme shows
    if (themeChanged) {
      engine.draw()
      engine.drawNextPiece()
    }
  }

  function getFinalScore(): number {
    return engine.getFinalScore()
  }

  return {
    score,
    gameOver,
    isPaused,
    initCanvas,
    startGame,
    resetGame,
    togglePause,
    pauseGame,
    resumeGame,
    cleanup,
    resumeLoop,
    getFinalScore,
  }
}
