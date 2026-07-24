<template>
  <Teleport to="body">
    <div class="ui-confirm-overlay" @click.self="cancel">
      <div
        ref="confirmRef"
        class="ui-confirm"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <div class="ui-confirm__icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <h3 :id="titleId" class="ui-confirm__title">{{ title }}</h3>
        <p class="ui-confirm__message">{{ message }}</p>
        <div class="ui-confirm__actions">
          <UiButton ref="cancelButtonRef" variant="secondary" size="sm" @click="cancel">
            {{ cancelText }}
          </UiButton>
          <UiButton ref="confirmButtonRef" :variant="confirmVariant" size="sm" @click="confirm">
            {{ confirmText }}
          </UiButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from './UiButton.vue'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  confirmVariant?: 'danger' | 'primary'
}>(), {
  confirmVariant: 'primary'
})

const confirmText = computed(() => props.confirmText || t('common.confirm'))
const cancelText = computed(() => props.cancelText || t('common.cancel'))

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const confirmRef = ref<HTMLElement | null>(null)
const cancelButtonRef = ref<{ $el?: HTMLElement } | null>(null)
const confirmButtonRef = ref<{ $el?: HTMLElement } | null>(null)
const titleId = `ui-confirm-title-${Math.random().toString(36).slice(2, 10)}`
let previousFocusedElement: HTMLElement | null = null

function getFocusableElements(): HTMLElement[] {
  const root = confirmRef.value
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
  const cancelEl = cancelButtonRef.value?.$el
  if (cancelEl) {
    cancelEl.focus()
    return
  }

  const confirmEl = confirmButtonRef.value?.$el
  if (confirmEl) {
    confirmEl.focus()
    return
  }

  const focusables = getFocusableElements()
  focusables[0]?.focus()
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
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
    if (!active || active === first || !confirmRef.value?.contains(active)) {
      event.preventDefault()
      last.focus()
    }
    return
  }

  if (!active || active === last || !confirmRef.value?.contains(active)) {
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

function confirm() {
  emit('confirm')
}

function cancel() {
  emit('cancel')
}
</script>

<style scoped>
.ui-confirm-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg, rgba(0, 0, 0, 0.4));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9500;
  animation: overlayIn 0.2s ease;
}

@keyframes overlayIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.ui-confirm {
  width: 380px;
  max-width: 90vw;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg, 16px);
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: var(--shadow-lg);
  animation: confirmIn 0.2s ease;
}

@keyframes confirmIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.ui-confirm__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(255, 153, 0, 0.1);
  color: var(--warning-color);
  margin-bottom: 16px;
}

.ui-confirm__title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  text-align: center;
}

.ui-confirm__message {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.5;
}

.ui-confirm__actions {
  display: flex;
  gap: 8px;
  width: 100%;
  justify-content: flex-end;
}
</style>
