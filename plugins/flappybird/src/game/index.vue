<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { FlappyGame } from './engine'

defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

const canvas = ref<HTMLCanvasElement | null>(null)
let game: FlappyGame | null = null

onMounted(() => {
  try {
    window.ztools.setExpendHeight(600)
    window.ztools.removeSubInput()
    window.ztools.subInputBlur()
  } catch {
    /* 浏览器预览时没有 ZTools API */
  }

  if (!canvas.value) return
  game = new FlappyGame(canvas.value)
  game.start()
})

onUnmounted(() => {
  game?.destroy()
  game = null
})
</script>

<template>
  <div class="stage">
    <canvas ref="canvas" />
  </div>
</template>

<style scoped>
.stage {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #4ec0ca;
  user-select: none;
  -webkit-user-select: none;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: pointer;
  touch-action: none;
}
</style>
