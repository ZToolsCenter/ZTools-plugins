<template>
  <Teleport to="body">
    <div class="ui-modal-overlay" @click.self="onOverlayClick">
      <div
        ref="modalRef"
        class="ui-modal"
        :class="[`ui-modal--${props.size}`]"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <div class="ui-modal__header">
          <h3 :id="titleId" class="ui-modal__title">{{ props.title }}</h3>
          <UiButton ref="closeButtonRef" variant="ghost" size="sm" icon-only @click="$emit('close')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </UiButton>
        </div>
        <div class="ui-modal__body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="ui-modal__footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import UiButton from './UiButton.vue'

const props = withDefaults(defineProps<{
  title: string
  size?: 'sm' | 'md' | 'lg'
  closeOnOverlay?: boolean
}>(), {
  size: 'md',
  closeOnOverlay: true
})

const emit = defineEmits<{
  close: []
}>()

const modalRef = ref<HTMLElement | null>(null)
const closeButtonRef = ref<{ $el?: HTMLElement } | null>(null)
const titleId = `ui-modal-title-${Math.random().toString(36).slice(2, 10)}`
let previousFocusedElement: HTMLElement | null = null

function getFocusableElements(): HTMLElement[] {
  const root = modalRef.value
  if (!root) {
    return []
  }

  const selectors = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ]

  return Array.from(root.querySelectorAll<HTMLElement>(selectors.join(','))).filter((el) => {
    return !el.hasAttribute('disabled') && el.tabIndex !== -1
  })
}

function focusInitialElement() {
  const closeEl = closeButtonRef.value?.$el
  if (closeEl) {
    closeEl.focus()
    return
  }

  const focusables = getFocusableElements()
  focusables[0]?.focus()
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }

  if (event.key !== 'Tab') {
    return
  }

  const focusables = getFocusableElements()
  if (focusables.length === 0) {
    event.preventDefault()
    return
  }

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement as HTMLElement | null

  if (event.shiftKey) {
    if (!active || active === first || !modalRef.value?.contains(active)) {
      event.preventDefault()
      last.focus()
    }
    return
  }

  if (!active || active === last || !modalRef.value?.contains(active)) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  await nextTick()
  focusInitialElement()
  window.addEventListener('keydown', onWindowKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown, true)
  previousFocusedElement?.focus()
})

function onOverlayClick() {
  if (props.closeOnOverlay) emit('close')
}
</script>

<style scoped>
.ui-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
  animation: overlayIn 0.2s ease;
}

@keyframes overlayIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.ui-modal {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg, 16px);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  animation: modalIn 0.2s ease;
  overflow: hidden;
}

@keyframes modalIn {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}

.ui-modal--sm {
  width: 440px;
  max-width: 90vw;
  height: 340px;
  max-height: 80vh;
}

.ui-modal--md {
  width: 640px;
  max-width: 90vw;
  height: 480px;
  max-height: 80vh;
}

.ui-modal--lg {
  width: 860px;
  max-width: 90vw;
  height: 580px;
  max-height: 85vh;
}

.ui-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
  background: var(--bg-surface);
}

.ui-modal__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.ui-modal__body {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.ui-modal__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-sm);
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
  background: var(--bg-surface);
}
</style>
