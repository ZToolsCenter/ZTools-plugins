<template>
  <!-- 使用 Teleport 确保组件渲染到 body -->
  <Teleport to="body">
    <Transition
      name="slide-down"
      @enter="onEnter"
      @leave="onLeave"
    >
      <div
        v-if="visible"
        class="delete-confirm-overlay"
        @click="handleOverlayClick"
      >
        <div
          class="delete-confirm-modal"
          @click.stop
        >
          <!-- 头部区域 -->
          <div class="modal-header">
            <div class="warning-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 16h2v2h-2v-2zm0-6h2v4h-2v-4z"/>
              </svg>
            </div>
            <h3 class="modal-title">{{ title }}</h3>
          </div>
          
          <!-- 内容区域 -->
          <div class="modal-content">
            <p class="modal-message">{{ message }}</p>
            <div v-if="itemCount && itemCount > 1" class="item-count">
              <span class="count-badge">{{ itemCount }}</span>
              <span class="count-text">个项目将被删除</span>
            </div>
          </div>
          
          <!-- 按钮区域 -->
          <div class="modal-actions">
            <button
              class="cancel-btn"
              @click="handleCancel"
            >
              取消
            </button>
            <button
              class="confirm-btn"
              @click="handleConfirm"
              :disabled="isProcessing"
            >
              <span v-if="!isProcessing">确定删除</span>
              <span v-else class="processing">
                <svg class="spinner" width="16" height="16" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="31.416" stroke-dashoffset="31.416">
                    <animate attributeName="stroke-dasharray" dur="2s" values="0 31.416;15.708 15.708;0 31.416" repeatCount="indefinite"/>
                    <animate attributeName="stroke-dashoffset" dur="2s" values="0;-15.708;-31.416" repeatCount="indefinite"/>
                  </circle>
                </svg>
                处理中...
              </span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'

interface Props {
  visible: boolean
  title?: string
  message: string
  itemCount?: number
}

interface Emits {
  (e: 'update:visible', value: boolean): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}

const props = withDefaults(defineProps<Props>(), {
  title: '确认删除',
  itemCount: 0
})

const emit = defineEmits<Emits>()

const isProcessing = ref(false)

// 处理确认
const handleConfirm = async () => {
  isProcessing.value = true
  try {
    emit('confirm')
  } finally {
    // 延迟关闭，让用户看到处理状态
    setTimeout(() => {
      isProcessing.value = false
      emit('update:visible', false)
    }, 300)
  }
}

// 处理取消
const handleCancel = () => {
  emit('cancel')
  emit('update:visible', false)
}

// 处理遮罩点击
const handleOverlayClick = () => {
  if (!isProcessing.value) {
    handleCancel()
  }
}

// 进入动画
const onEnter = (el: Element) => {
  const modalEl = el.querySelector('.delete-confirm-modal') as HTMLElement
  if (modalEl) {
    modalEl.style.transform = 'translateY(-100%)'
    nextTick(() => {
      modalEl.style.transform = 'translateY(0)'
    })
  }
}

// 离开动画
const onLeave = (el: Element) => {
  const modalEl = el.querySelector('.delete-confirm-modal') as HTMLElement
  if (modalEl) {
    modalEl.style.transform = 'translateY(-100%)'
  }
}
</script>

<style scoped lang="scss">
// 遮罩层
.delete-confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(4px);
  z-index: 10000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 60px;
}

// 模态框主体
.delete-confirm-modal {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(40px) saturate(200%);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 20px;
  box-shadow: 
    0 20px 60px rgba(0, 0, 0, 0.15),
    0 8px 32px rgba(0, 0, 0, 0.1),
    0 2px 8px rgba(0, 0, 0, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  min-width: 380px;
  max-width: 480px;
  overflow: hidden;
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  
  @media (prefers-color-scheme: dark) {
    background: rgba(28, 28, 30, 0.95);
    border: 1px solid rgba(84, 84, 88, 0.6);
    box-shadow: 
      0 20px 60px rgba(0, 0, 0, 0.6),
      0 8px 32px rgba(0, 0, 0, 0.4),
      0 2px 8px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.15),
      inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  }
  
  @media (max-width: 600px) {
    min-width: 320px;
    max-width: calc(100vw - 40px);
    margin: 0 20px;
  }
}

// 头部区域
.modal-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px 24px 16px;
  background: linear-gradient(180deg, 
    rgba(255, 255, 255, 0.1) 0%, 
    rgba(255, 255, 255, 0) 100%);
  
  @media (prefers-color-scheme: dark) {
    background: linear-gradient(180deg, 
      rgba(255, 255, 255, 0.05) 0%, 
      rgba(255, 255, 255, 0) 100%);
  }
  
  .warning-icon {
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, #FF3B30 0%, #FF453A 100%);
    color: white;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 
      0 4px 16px rgba(255, 59, 48, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.4);
    
    svg {
      width: 20px;
      height: 20px;
    }
  }
  
  .modal-title {
    font-size: 18px;
    font-weight: 700;
    color: #1d1d1f;
    margin: 0;
    letter-spacing: -0.3px;
    
    @media (prefers-color-scheme: dark) {
      color: #f5f5f7;
    }
  }
}

// 内容区域
.modal-content {
  padding: 8px 24px 20px;
  
  .modal-message {
    font-size: 15px;
    line-height: 1.6;
    color: #48484a;
    margin: 0 0 12px 0;
    
    @media (prefers-color-scheme: dark) {
      color: #aeaeb2;
    }
  }
  
  .item-count {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: rgba(255, 59, 48, 0.08);
    border: 1px solid rgba(255, 59, 48, 0.2);
    border-radius: 12px;
    
    @media (prefers-color-scheme: dark) {
      background: rgba(255, 69, 58, 0.12);
      border: 1px solid rgba(255, 69, 58, 0.3);
    }
    
    .count-badge {
      background: linear-gradient(135deg, #FF3B30 0%, #FF453A 100%);
      color: white;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 12px;
      min-width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 
        0 3px 12px rgba(255, 59, 48, 0.4),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
    }
    
    .count-text {
      font-size: 14px;
      font-weight: 600;
      color: #FF3B30;
      
      @media (prefers-color-scheme: dark) {
        color: #FF453A;
      }
    }
  }
}

// 按钮区域
.modal-actions {
  display: flex;
  gap: 14px;
  padding: 16px 24px 24px;
  background: linear-gradient(180deg, 
    rgba(0, 0, 0, 0) 0%, 
    rgba(0, 0, 0, 0.02) 100%);
  
  @media (prefers-color-scheme: dark) {
    background: linear-gradient(180deg, 
      rgba(255, 255, 255, 0) 0%, 
      rgba(255, 255, 255, 0.02) 100%);
  }
  
  button {
    flex: 1;
    border: none;
    border-radius: 12px;
    padding: 14px 20px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
    
    // 添加光泽效果
    &::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(135deg, 
        rgba(255, 255, 255, 0.15) 0%, 
        rgba(255, 255, 255, 0) 50%);
      opacity: 0;
      transition: opacity 0.25s ease;
    }
    
    &:hover::before {
      opacity: 1;
    }
    
    &:active {
      transform: scale(0.96);
      transition: transform 0.1s ease;
    }
    
    &:disabled {
      cursor: not-allowed;
      transform: none;
      
      &:hover::before {
        opacity: 0;
      }
    }
  }
  
  .cancel-btn {
    background: rgba(142, 142, 147, 0.14);
    color: #1d1d1f;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.3);
    
    &:hover {
      background: rgba(142, 142, 147, 0.22);
      transform: translateY(-1px) scale(1.02);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    
    @media (prefers-color-scheme: dark) {
      background: rgba(142, 142, 147, 0.2);
      color: #f5f5f7;
      border: 1px solid rgba(255, 255, 255, 0.1);
      
      &:hover {
        background: rgba(142, 142, 147, 0.3);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }
    }
  }
  
  .confirm-btn {
    background: linear-gradient(135deg, #FF3B30 0%, #FF453A 100%);
    color: white;
    box-shadow: 
      0 4px 16px rgba(255, 59, 48, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.2);
    
    &:hover:not(:disabled) {
      background: linear-gradient(135deg, #FF453A 0%, #FF6961 100%);
      transform: translateY(-1px) scale(1.02);
      box-shadow: 
        0 6px 20px rgba(255, 59, 48, 0.5),
        inset 0 1px 0 rgba(255, 255, 255, 0.5);
    }
    
    &:disabled {
      background: rgba(142, 142, 147, 0.3);
      color: rgba(255, 255, 255, 0.6);
      box-shadow: none;
      border: 1px solid rgba(142, 142, 147, 0.2);
    }
    
    .processing {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: center;
      
      .spinner {
        animation: spin 1s linear infinite;
      }
    }
  }
}

// 动画效果
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  backdrop-filter: blur(0px);
  
  .delete-confirm-modal {
    transform: translateY(-100%);
  }
}

.slide-down-enter-to,
.slide-down-leave-from {
  opacity: 1;
  backdrop-filter: blur(4px);
  
  .delete-confirm-modal {
    transform: translateY(0);
  }
}

// 旋转动画
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>