<script setup>
const emit = defineEmits(['copy', 'paste', 'clear'])
</script>

<template>
  <div class="sidebar">
    <div class="sidebar-actions">
      <!-- 复制按钮 -->
      <button class="sidebar-btn copy-btn" @click="emit('copy')" data-tooltip="仅复制">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc. -->
          <path d="M480 400L288 400C279.2 400 272 392.8 272 384L272 128C272 119.2 279.2 112 288 112L421.5 112C425.7 112 429.8 113.7 432.8 116.7L491.3 175.2C494.3 178.2 496 182.3 496 186.5L496 384C496 392.8 488.8 400 480 400zM288 448L480 448C515.3 448 544 419.3 544 384L544 186.5C544 169.5 537.3 153.2 525.3 141.2L466.7 82.7C454.7 70.7 438.5 64 421.5 64L288 64C252.7 64 224 92.7 224 128L224 384C224 419.3 252.7 448 288 448zM160 192C124.7 192 96 220.7 96 256L96 512C96 547.3 124.7 576 160 576L352 576C387.3 576 416 547.3 416 512L416 496L368 496L368 512C368 520.8 360.8 528 352 528L160 528C151.2 528 144 520.8 144 512L144 256C144 247.2 151.2 240 160 240L176 240L176 192L160 192z"
            fill="currentColor" />
        </svg>
      </button>

      <!-- 粘贴按钮 -->
      <button class="sidebar-btn paste-btn" @click="emit('paste')" data-tooltip="复制并粘贴">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc. -->
          <path d="M128 112L352 112C360.8 112 368 119.2 368 128L368 176L416 176L416 128C416 92.7 387.3 64 352 64L128 64C92.7 64 64 92.7 64 128L64 448C64 483.3 92.7 512 128 512L240 512L240 464L128 464C119.2 464 112 456.8 112 448L112 128C112 119.2 119.2 112 128 112zM304 184C304 170.7 293.3 160 280 160L168 160C154.7 160 144 170.7 144 184C144 197.3 154.7 208 168 208L273.6 208C282.4 199.4 292.6 192.2 303.8 186.9C303.9 186 304 185 304 184zM512 528L352 528C343.2 528 336 520.8 336 512L336 288C336 279.2 343.2 272 352 272L453.5 272C457.7 272 461.8 273.7 464.8 276.7L523.3 335.2C526.3 338.2 528 342.3 528 346.5L528 512C528 520.8 520.8 528 512 528zM288 288L288 512C288 547.3 316.7 576 352 576L512 576C547.3 576 576 547.3 576 512L576 346.5C576 329.5 569.3 313.2 557.3 301.2L498.8 242.7C486.8 230.7 470.5 224 453.5 224L352 224C316.7 224 288 252.7 288 288z"
            fill="currentColor" />
        </svg>
      </button>
    </div>

    <div class="sidebar-bottom">
      <!-- 清空按钮 -->
      <button class="sidebar-btn clear-btn" @click="emit('clear')" data-tooltip="清空">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 6h18M8 6V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v2m3 0v14c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2V6h14z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round" />
          <path d="M10 11v6M14 11v6"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  width: 60px;
  min-height: 100vh;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0;
  position: sticky;
  top: 0;
  height: 100vh;
}

.sidebar-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.sidebar-bottom {
  margin-top: auto;
}

.sidebar-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.3s;
  color: var(--text-secondary);
}

.sidebar-btn:hover {
  background: var(--bg-hover);
  border-color: var(--primary-color);
  color: var(--primary-color);
  transform: translateX(-2px);
}

.sidebar-btn svg {
  width: 20px;
  height: 20px;
}

/* Tooltip */
.sidebar-btn::after {
  content: attr(data-tooltip);
  position: absolute;
  right: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
  padding: 4px 10px;
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  font-size: 12px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 10;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}

.sidebar-btn:hover::after {
  opacity: 1;
}

.sidebar-btn.copy-btn:hover {
  color: var(--primary-color);
}

.sidebar-btn.paste-btn:hover {
  color: #4caf50;
  border-color: #4caf50;
}

.sidebar-btn.clear-btn {
  color: var(--text-danger);
}

.sidebar-btn.clear-btn:hover {
  background: var(--bg-danger-light);
  border-color: var(--text-danger);
  color: var(--text-danger);
}
</style>
