<script setup>
// 定义 Props
const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: '提示'
  },
  width: {
    type: String,
    default: '340px' // 默认 max-w-sm
  },
  confirmText: {
    type: String,
    default: '确认'
  }
})

// 定义 Events
const emit = defineEmits(['update:visible', 'confirm'])

// 关闭弹窗
const handleClose = () => {
  emit('update:visible', false)
}

// 确认按钮点击
const handleConfirm = () => {
  emit('confirm')
}
</script>

<template>
  <Transition name="fade" appear>
    <div 
      v-show="visible" 
      class="dialog-overlay"
      @click.self="handleClose"
    >
      <div class="dialog-content" :style="{ maxWidth: width }">
        
        <div class="dialog-header">
          <h3 class="header-title">
            <slot name="icon"></slot>
            {{ title }}
          </h3>
          <button @click="handleClose" class="btn-close">×</button>
        </div>

        <div class="dialog-body">
          <slot></slot>
        </div>

        <div class="dialog-footer">
          <slot name="footer">
            <button 
              @click="handleConfirm" 
              class="btn-confirm"
            >
              {{ confirmText }}
            </button>
          </slot>
        </div>

      </div>
    </div>
  </Transition>
</template>

<style lang="scss" scoped>
// 淡入弹出动画
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

// 2. 为内容单独添加 transform 过渡
.fade-enter-active .dialog-content,
.fade-leave-active .dialog-content {
  transition: transform 0.3s ease;
}

// 3. 初始/结束状态：背景透明，内容缩放
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.fade-enter-from .dialog-content,
.fade-leave-to .dialog-content {
  transform: scale(0.9);
}

// 4. 正常状态
.fade-enter-to,
.fade-leave-from {
  opacity: 1;
}
.fade-enter-to .dialog-content,
.fade-leave-from .dialog-content {
  transform: scale(1);
}

// 遮罩层
.dialog-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(15, 23, 42, 0.5);
}

// 弹窗主体
.dialog-content {
  background-color: white;
  border-radius: 5px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  width: 100%;
  // max-width 由 props 控制
  border: 1px solid #f3f4f6;
  overflow: hidden;
}

// 头部
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  border-bottom: 1px solid #f9fafb;
  background-color: rgba(249, 250, 251, 0.5);
}

.header-title {
  font-weight: 600;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 15px;
  margin: 0;
}

.btn-close {
  color: #94a3b8;
  width: 20px;
  height: 20px;
  padding: 5px;
  border-radius: 50%;
  transition: color 0.2s, background-color 0.2s;
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.btn-close:hover {
  color: #475569;
  background-color: #f3f4f6;
}

// 内容区
.dialog-body {
  padding: 20px 10px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

// 底部
.dialog-footer {
  padding: 10px;
  background-color: #f9fafb;
  border-top: 1px solid #f3f4f6;
}

.btn-confirm {
  width: 100%;
  padding-top: 10px;
  padding-bottom: 10px;
  background-color: var(--primary-color);
  color: white;
  border-radius: 5px;
  font-size: 14px;
  font-weight: 500;
  transition: opacity 0.2s, transform 0.1s;
  border: none;
  cursor: pointer;
}

.btn-confirm:hover {
  opacity: 0.9;
}

.btn-confirm:active {
  transform: scale(0.98);
}
</style>