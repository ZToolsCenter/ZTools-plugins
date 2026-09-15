<template>
  <div class="emoticon-loader-container">
    <div class="loader-content">
      <!-- 简洁的加载动画 -->
      <div class="simple-loader">
        <!-- 单个旋转表情 -->
        <div class="rotating-emoji">😊</div>
        
        <!-- 有趣的加载文字 -->
        <div class="loading-messages">
          <div class="message" :class="{ active: currentMessageIndex === 0 }">
            正在加载最可爱的表情包...
          </div>
          <div class="message" :class="{ active: currentMessageIndex === 1 }">
            表情包们正在排队入场...
          </div>
          <div class="message" :class="{ active: currentMessageIndex === 2 }">
            马上就好，请稍等片刻...
          </div>
        </div>
        
        <!-- 简单的点点动画 -->
        <div class="dots">
          <span class="dot" :style="{ animationDelay: '0s' }">•</span>
          <span class="dot" :style="{ animationDelay: '0.3s' }">•</span>
          <span class="dot" :style="{ animationDelay: '0.6s' }">•</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const currentMessageIndex = ref(0)
let messageInterval: number | null = null

onMounted(() => {
  // 循环切换加载文字
  messageInterval = setInterval(() => {
    currentMessageIndex.value = (currentMessageIndex.value + 1) % 3
  }, 1500) as unknown as number
})

onUnmounted(() => {
  if (messageInterval) {
    clearInterval(messageInterval)
  }
})
</script>

<style scoped lang="scss">
.emoticon-loader-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--el-bg-color-page);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  border-radius: 16px;
}

.loader-content {
  text-align: center;
  padding: 40px;
}

.simple-loader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

// 旋转表情
.rotating-emoji {
  font-size: 3rem;
  animation: gentle-spin 2s ease-in-out infinite;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

@keyframes gentle-spin {
  0%, 100% { 
    transform: rotate(0deg) scale(1);
  }
  50% { 
    transform: rotate(180deg) scale(1.1);
  }
}

// 加载文字消息
.loading-messages {
  position: relative;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  
  .message {
    position: absolute;
    font-size: 1.1rem;
    color: var(--el-text-color-regular);
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.5s ease;
    white-space: nowrap;
    
    &.active {
      opacity: 1;
      transform: translateY(0);
    }
  }
}

// 点点动画
.dots {
  display: flex;
  gap: 4px;
  
  .dot {
    font-size: 1.5rem;
    color: var(--el-color-primary);
    animation: bounce-dot 1.4s ease-in-out infinite;
    opacity: 0.3;
  }
}

@keyframes bounce-dot {
  0%, 80%, 100% {
    transform: scale(0.8);
    opacity: 0.3;
  }
  40% {
    transform: scale(1.2);
    opacity: 1;
  }
}

// 响应式设计
@media (max-width: 768px) {
  .loader-content {
    padding: 20px;
  }

  .rotating-emoji {
    font-size: 2.5rem;
  }

  .loading-messages .message {
    font-size: 1rem;
  }
}
</style>

<!-- 暗黑模式适配 -->
<style lang="scss">
html.dark {
  .emoticon-loader-container {
    background: var(--el-bg-color-page);
  }
}
</style>