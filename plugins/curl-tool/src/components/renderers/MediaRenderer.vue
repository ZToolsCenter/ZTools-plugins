<script setup lang="ts">
import { Download, FileArchive, FileAudio2, FileCode2, FileImage, FileJson2, FileSpreadsheet, FileText, FileVideo2 } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { fileLabel, formatBytes, guessFileName } from '../../utils/content'

const props = defineProps<{
  contentType: string
  size: number
  bodyBase64: string
  image?: boolean
}>()

const emit = defineEmits<{
  download: []
}>()

const dataUrl = computed(() => `data:${props.contentType || 'application/octet-stream'};base64,${props.bodyBase64}`)
const fileName = computed(() => guessFileName(props.contentType))
const typeLabel = computed(() => fileLabel(props.contentType))
const hasTransparency = ref(false)
const icon = computed(() => {
  const type = props.contentType.toLowerCase()
  if (type.includes('image')) return FileImage
  if (type.includes('audio')) return FileAudio2
  if (type.includes('video')) return FileVideo2
  if (type.includes('excel') || type.includes('spreadsheet') || type.includes('csv')) return FileSpreadsheet
  if (type.includes('json')) return FileJson2
  if (type.includes('xml') || type.includes('html')) return FileCode2
  if (type.includes('zip') || type.includes('octet-stream')) return FileArchive
  return FileText
})

watch(
  dataUrl,
  async (value) => {
    hasTransparency.value = false
    if (!props.image || !/image\/(png|webp|gif)/i.test(props.contentType)) return
    hasTransparency.value = await detectTransparency(value)
  },
  { immediate: true }
)

function detectTransparency(src: string) {
  return new Promise<boolean>((resolve) => {
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const sampleWidth = Math.min(image.naturalWidth || image.width, 160)
        const sampleHeight = Math.min(image.naturalHeight || image.height, 160)
        canvas.width = sampleWidth
        canvas.height = sampleHeight
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return resolve(false)
        context.drawImage(image, 0, 0, sampleWidth, sampleHeight)
        const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data
        for (let index = 3; index < data.length; index += 4) {
          if (data[index] < 255) return resolve(true)
        }
      } catch {
        resolve(false)
      }
      resolve(false)
    }
    image.onerror = () => resolve(false)
    image.src = src
  })
}
</script>

<template>
  <div class="media-renderer">
    <div v-if="image" class="image-preview" :class="{ transparent: hasTransparency }">
      <img :src="dataUrl" :alt="fileName" />
    </div>
    <template v-else>
      <div class="file-badge">
        <component :is="icon" :size="28" :stroke-width="1.55" />
        <span>{{ typeLabel }}</span>
      </div>
      <div class="binary-info">
        <strong>{{ fileName }}</strong>
        <div class="detail-grid">
          <span>响应头</span>
          <b>{{ contentType || 'application/octet-stream' }}</b>
          <span>文件大小</span>
          <b>{{ formatBytes(size) }}</b>
        </div>
      </div>
      <button class="binary-download" title="下载响应" @click="emit('download')">
        <Download :size="17" :stroke-width="1.8" />
      </button>
    </template>
  </div>
</template>

<style scoped>
.media-renderer {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr) 38px;
  gap: 16px;
  align-items: center;
  height: 100%;
  min-height: 132px;
  box-sizing: border-box;
  padding: 22px 24px;
  margin-bottom: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.image-preview {
  grid-column: 1 / -1;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-height: 160px;
  border-radius: 7px;
  background: #fff;
  overflow: auto;
}

.image-preview.transparent {
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #e5e7eb 25%, transparent 25%),
    linear-gradient(-45deg, #e5e7eb 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e5e7eb 75%),
    linear-gradient(-45deg, transparent 75%, #e5e7eb 75%);
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
  background-size: 16px 16px;
}

img {
  width: 50%;
  height: 50%;
  border-radius: 6px;
  object-fit: contain;
}

.file-badge {
  display: grid;
  place-items: center;
  gap: 7px;
  width: 72px;
  height: 82px;
  border-radius: 8px;
  color: #4f46e5;
  background: linear-gradient(180deg, #eef2ff 0%, #f5f3ff 100%);
  font-size: 11px;
  font-weight: 900;
  box-shadow: inset 0 0 0 1px rgb(79 70 229 / 6%);
}

.binary-info {
  display: grid;
  align-content: center;
  gap: 8px;
  min-width: 0;
  color: #64748b;
  font-size: 12px;
}

.binary-info strong {
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-grid {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 6px 10px;
  align-items: center;
}

.detail-grid span {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 800;
}

.detail-grid b {
  min-width: 0;
  overflow: hidden;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.binary-download {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  color: #64748b;
  background: #fff;
  cursor: pointer;
  transition:
    border 0.16s ease,
    color 0.16s ease,
    background 0.16s ease;
}

.binary-download:hover {
  border-color: #c7d2fe;
  color: #4f46e5;
  background: #f5f3ff;
}
</style>
