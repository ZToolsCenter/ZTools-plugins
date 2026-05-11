<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import QRCodeLib from 'qrcode'
import { QrCode } from 'lucide-vue-next'
import { POPOVER_SHOW_DELAY, POPOVER_HIDE_DELAY } from '../utils/constants'

interface Props {
  url: string
  size?: number
}

const props = withDefaults(defineProps<Props>(), {
  size: 120
})

const emit = defineEmits<{
  (e: 'loaded', dataUrl: string): void
  (e: 'error', error: Error): void
}>()

const qrCodeUrl = ref<string>('')
const showPopover = ref(false)
const containerRef = ref<HTMLElement>()
const popoverPosition = ref({ x: 0, y: 0 })
let showTimeoutId: number | null = null
let hideTimeoutId: number | null = null

const popoverStyle = computed(() => ({
  left: `${popoverPosition.value.x}px`,
  top: `${popoverPosition.value.y}px`
}))

async function generateQRCode() {
  if (!props.url) return

  try {
    const dataUrl = await QRCodeLib.toDataURL(props.url, {
      width: props.size,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    })
    qrCodeUrl.value = dataUrl
    emit('loaded', dataUrl)
  } catch (error) {
    emit('error', error as Error)
  }
}

function updatePopoverPosition() {
  if (!containerRef.value) return

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  popoverPosition.value = {
    x: (viewportWidth - props.size - 24) / 2,
    y: (viewportHeight - props.size - 60) / 2
  }
}

function showPopoverDelayed() {
  if (hideTimeoutId) {
    clearTimeout(hideTimeoutId)
    hideTimeoutId = null
  }
  if (showTimeoutId) {
    clearTimeout(showTimeoutId)
  }
  updatePopoverPosition()
  showTimeoutId = window.setTimeout(() => {
    showPopover.value = true
    showTimeoutId = null
  }, POPOVER_SHOW_DELAY)
}

function hidePopoverDelayed() {
  if (showTimeoutId) {
    clearTimeout(showTimeoutId)
    showTimeoutId = null
  }
  if (hideTimeoutId) {
    clearTimeout(hideTimeoutId)
  }
  hideTimeoutId = window.setTimeout(() => {
    showPopover.value = false
    hideTimeoutId = null
  }, POPOVER_HIDE_DELAY)
}

function cancelHide() {
  if (hideTimeoutId) {
    clearTimeout(hideTimeoutId)
    hideTimeoutId = null
  }
}

function handleMouseEnter() {
  cancelHide()
  if (!showPopover.value) {
    showPopoverDelayed()
  }
}

function handleMouseLeave() {
  if (showTimeoutId) {
    clearTimeout(showTimeoutId)
    showTimeoutId = null
  }
  hidePopoverDelayed()
}

watch(() => props.url, generateQRCode)

onMounted(() => {
  generateQRCode()
})

onUnmounted(() => {
  if (showTimeoutId) {
    clearTimeout(showTimeoutId)
  }
  if (hideTimeoutId) {
    clearTimeout(hideTimeoutId)
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="qrcode-container"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <slot>
      <div class="qrcode">
        <QrCode :size="16" />
      </div>
    </slot>

    <Teleport to="body">
      <div
        v-if="showPopover && qrCodeUrl"
        class="qrcode-popover"
        :style="popoverStyle"
      >
        <div class="qrcode-content">
          <img :src="qrCodeUrl" :alt="'QR Code for ' + url" />
          <div class="qrcode-url">{{ url }}</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.qrcode-container {
  position: relative;
  display: inline-block;
}

.qrcode-trigger {
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border, #d1d1d6);
  border-radius: 6px;
  background: var(--bg-primary, #ffffff);
  color: var(--text-secondary, #6e6e73);
  cursor: pointer;
  transition: all 0.3s ease;

  &:active {
    transform: scale(0.95);
  }
}

.qrcode-popover {
  position: fixed;
  z-index: 9999;
  padding: 12px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border, #d1d1d6);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  animation: fadeInSlideUp 0.3s ease-out;
  pointer-events: none;
}

[data-theme="dark"] .qrcode-popover {
  background: rgba(26, 26, 27, 0.85);
}

.qrcode-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;

  img {
    display: block;
    border-radius: 8px;
  }

  .qrcode-url {
    max-width: 200px;
    font-size: 11px;
    color: var(--text-secondary, #6e6e73);
    text-align: center;
    word-break: break-all;
    font-family: 'SF Mono', Monaco, monospace;
  }
}
</style>
