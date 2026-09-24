<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  src: string
  fallbackSrc?: string
  label: string
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
let image: HTMLImageElement | null = null
let animationFrame = 0
let frameIndex = 0
let frameStartedAt = 0
let resizeObserver: ResizeObserver | null = null
let loadSequence = 0

/**
 * 把远程 Petdex 资源转换为由 preload 受控加载的本地图片地址。
 * @param source 原始预览或精灵图地址。
 * @returns 浏览器可直接加载的本地或 data URL。
 */
async function resolveImageSource(source: string): Promise<string> {
  if (source.startsWith('file:') || source.startsWith('data:')) return source
  return window.desktopPet.loadPreviewAsset(source)
}

/**
 * 根据容器尺寸和设备像素比调整预览 Canvas。
 * @returns 无返回值。
 */
function resizeCanvas(): void {
  if (!canvas.value) return
  const bounds = canvas.value.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  canvas.value.width = Math.max(1, Math.round(bounds.width * ratio))
  canvas.value.height = Math.max(1, Math.round(bounds.height * ratio))
}

/**
 * 加载一张预览资源并在失败时尝试完整精灵图。
 * @param source 首选资源地址。
 * @param fallbackSource 备用资源地址。
 * @returns 图片加载完成后的 Promise。
 */
async function loadImage(source: string, fallbackSource?: string): Promise<void> {
  const sequence = ++loadSequence
  const nextImage = new Image()
  nextImage.decoding = 'async'
  try {
    nextImage.src = await resolveImageSource(source)
    await nextImage.decode()
  } catch {
    if (!fallbackSource || fallbackSource === source) throw new Error('宠物预览加载失败')
    return loadImage(fallbackSource)
  }
  if (sequence !== loadSequence) return
  image = nextImage
  frameIndex = 0
  frameStartedAt = performance.now()
  canvas.value?.setAttribute('data-ready', 'true')
}

/**
 * 把当前 idle 帧等比绘制到预览画布中。
 * @param now 当前高精度时间。
 * @returns 无返回值。
 */
function render(now: number): void {
  const target = canvas.value
  if (target) {
    const context = target.getContext('2d', { alpha: true })
    if (context) {
      if (now - frameStartedAt >= 180) {
        frameIndex = (frameIndex + 1) % 6
        frameStartedAt = now
      }
      context.clearRect(0, 0, target.width, target.height)
      if (image) {
        const isPreviewStrip = image.naturalWidth / image.naturalHeight > 3
        const sourceFrameWidth = image.naturalWidth / (isPreviewStrip ? 6 : 8)
        const sourceFrameHeight = isPreviewStrip
          ? image.naturalHeight
          : sourceFrameWidth * (208 / 192)
        const scale = Math.min(target.width / sourceFrameWidth, target.height / sourceFrameHeight)
        const drawWidth = sourceFrameWidth * scale
        const drawHeight = sourceFrameHeight * scale
        const drawX = (target.width - drawWidth) / 2
        const drawY = (target.height - drawHeight) / 2
        context.imageSmoothingEnabled = false
        context.drawImage(
          image,
          frameIndex * sourceFrameWidth,
          0,
          sourceFrameWidth,
          sourceFrameHeight,
          drawX,
          drawY,
          drawWidth,
          drawHeight
        )
      }
    }
  }
  animationFrame = requestAnimationFrame(render)
}

watch(
  () => [props.src, props.fallbackSrc] as const,
  ([source, fallbackSource]) => {
    canvas.value?.removeAttribute('data-ready')
    void loadImage(source, fallbackSource).catch(() => {
      image = null
      canvas.value?.setAttribute('data-ready', 'error')
    })
  }
)

onMounted(() => {
  if (canvas.value) {
    resizeObserver = new ResizeObserver(resizeCanvas)
    resizeObserver.observe(canvas.value)
    resizeCanvas()
  }
  void loadImage(props.src, props.fallbackSrc).catch(() => {
    canvas.value?.setAttribute('data-ready', 'error')
  })
  animationFrame = requestAnimationFrame(render)
})

onBeforeUnmount(() => {
  loadSequence += 1
  cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
})
</script>

<template>
  <canvas ref="canvas" class="pet-preview-canvas" role="img" :aria-label="label" />
</template>
