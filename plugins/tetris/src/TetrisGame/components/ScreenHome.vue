<script setup lang="ts">
defineEmits<{
  (e: 'start-game'): void
  (e: 'show-settings'): void
}>()
</script>

<template>
  <div id="homeScreen" class="home-screen">
    <div class="home-title">俄罗斯方块</div>
    <div class="home-subtitle">TETRIS</div>
    <div class="home-buttons">
      <button class="home-btn" @click="$emit('start-game')">开始游戏</button>
      <button class="home-btn" @click="$emit('show-settings')">设 置</button>
    </div>
  </div>
</template>

<style scoped>
.home-screen {
  text-align: center;
  animation: fadeIn 0.5s ease;
}

.home-title {
  font-size: 40px;
  font-weight: 900;
  margin-bottom: 8px;
  letter-spacing: 4px;
  transition: color 0.3s, text-shadow 0.3s;
}

.home-subtitle {
  font-size: 14px;
  opacity: 0.7;
  margin-bottom: 32px;
  letter-spacing: 3px;
  transition: color 0.3s;
}

.home-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

.home-btn {
  width: 200px;
  padding: 12px 32px;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 700;
  font-family: 'Noto Sans SC', sans-serif;
  cursor: pointer;
  transition: all 0.3s ease;
  letter-spacing: 2px;
}

.home-btn:hover {
  transform: translateY(-3px);
}

.home-btn:active {
  transform: translateY(0);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
