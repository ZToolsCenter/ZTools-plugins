<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type DPlayerType from 'dplayer'
import type { Source } from '../types'
import type Hls from 'hls.js'

const props = defineProps<{ source: Source; title: string; startAt: number; hasNext?: boolean }>()
const emit = defineEmits<{ retry: []; progress: [position: number, duration: number]; ended: []; next: [] }>()
const host = ref<HTMLElement | null>(null)
const status = ref('正在加载视频…')
const failure = ref('')
let player: DPlayerType | undefined
let engine: Hls | undefined
// 播放器当前挂在哪个容器上，换容器时必须重建。
let mountedOn: HTMLElement | null = null
// 每次换源自增，用于丢弃已经过期的异步回调。
let generation = 0
let readyGeneration = -1
// 续播只需定位一次，之后由用户自己拖动。
let seeken = false
// 进度按「播放位置前进多少」上报，避免 timeupdate 每次触发都写记录。
const PROGRESS_STEP = 5
let lastReported = 0
// 注入到 DPlayer 控制栏的「下一集」按钮。
let nextButton: HTMLButtonElement | null = null

/**
 * 在播放按钮右侧插入「下一集」按钮。
 * DPlayer 没有开放自定义控件的接口，只能挂进它生成的控制栏。
 */
function mountNextButton() {
  nextButton = null
  const left = host.value?.querySelector('.dplayer-icons-left')
  const play = left?.querySelector('.dplayer-play-icon')
  if (!left || !play) return
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'dplayer-icon dplayer-next-icon'
  // 只保留无障碍标签，不加 data-balloon，避免悬停时弹出文字气泡。
  button.setAttribute('aria-label', '下一集')
  button.innerHTML = '<span class="dplayer-icon-content"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
    + '<path d="M5.6 5.1v13.8c0 .6.7 1 1.2.6l9-6.9a.75.75 0 0 0 0-1.2l-9-6.9c-.5-.4-1.2 0-1.2.6Z"/>'
    + '<path d="M17.6 5h1.5c.4 0 .7.3.7.7v12.6c0 .4-.3.7-.7.7h-1.5a.7.7 0 0 1-.7-.7V5.7c0-.4.3-.7.7-.7Z"/></svg></span>'
  button.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    if (!nextButton?.classList.contains('is-hidden')) emit('next')
  })
  play.insertAdjacentElement('afterend', button)
  nextButton = button
  syncNextButton()
}

/**
 * 按是否还有下一集显示或隐藏按钮。
 */
function syncNextButton() {
  nextButton?.classList.toggle('is-hidden', !props.hasNext)
}

function release() {
  engine?.destroy()
  engine = undefined
  player?.destroy()
  player = undefined
  mountedOn = null
  nextButton = null
}

function ready() {
  if (failure.value || readyGeneration === generation) return
  readyGeneration = generation
  status.value = ''
  // 浏览器的自动播放策略可能仍要求一次点击。
  void player?.play()?.catch(() => {})
}

function fail(text: string) {
  failure.value = text
  status.value = ''
  engine?.destroy()
  engine = undefined
}

function mediaError() {
  const code = player?.video?.error?.code
  if (!failure.value && code && code !== MediaError.MEDIA_ERR_ABORTED) {
    fail('浏览器无法读取此视频。可以重新获取地址后再试。')
  }
}

function toggleFullscreen(event: MouseEvent) {
  const target = event.target as Element | null
  const video = player?.video
  if (!host.value || !video || !target || !host.value.contains(target)) return
  // DPlayer 自带控制栏，按钮上的双击交给播放器自己处理。
  if (target.closest('.dplayer-controller, .dplayer-menu, button')) return
  event.preventDefault()
  // 全屏时 Chromium 把视频画在独立合成层，事件目标是面板而不是 video，
  // 所以监听挂在 document 上、用 fullscreenElement 判断当前状态。
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  else void video.requestFullscreen().catch(() => {})
}

/**
 * 用 hls.js 接管 DPlayer 的 HLS 播放。
 * 保留分片字节检查：部分片源会用 HTML 页面代替视频分片。
 * @param video DPlayer 创建的 video 元素，src 已指向清单地址。
 * @param session 当前加载会话编号，用于丢弃过期回调。
 */
async function attachHls(video: HTMLVideoElement, session: number) {
  try {
    const { default: HlsConstructor } = await import('hls.js')
    if (session !== generation) return
    if (!HlsConstructor.isSupported()) {
      fail('当前环境不支持 HLS 播放。')
      return
    }
    const hls = new HlsConstructor({ maxBufferLength: 30, backBufferLength: 60 })
    engine = hls
    hls.on(HlsConstructor.Events.FRAG_LOADED, (_event, { payload }) => {
      if (session !== generation || !payload) return
      // 检查字节内容：有些有效流会带无关的 Content-Type。
      const start = new TextDecoder().decode(new Uint8Array(payload, 0, Math.min(payload.byteLength, 512))).trimStart()
      if (!/^(?:<!doctype\s+html\b|<html(?:\s|>))/i.test(start)) return
      fail('片源服务器返回了网页，没有提供视频分片。请试试其他线路或剧集。')
    })
    hls.on(HlsConstructor.Events.ERROR, (_event, data) => {
      if (!data.fatal || session !== generation || failure.value) return
      fail(data.type === HlsConstructor.ErrorTypes.NETWORK_ERROR
        ? '无法加载 HLS 清单或分片，请检查网络后重试。'
        : '这个 HLS 线路无法在当前播放器中解码。')
    })
    hls.loadSource(video.src)
    hls.attachMedia(video)
  } catch {
    if (session === generation) fail('HLS 播放器加载失败，请重试。')
  }
}

/**
 * 加载一个播放地址。
 * @param source 播放地址。
 * @param fresh 为 true 时重建播放器；否则复用现有播放器切换地址，元素全屏不会中断。
 */
async function load(source: Source, fresh: boolean) {
  const session = ++generation
  seeken = false
  // 让新的一集第一次 timeupdate 就上报，记录里的集号能立刻跟上；
  // 否则从 0 开始的前几秒会一直是上一集的记录。
  lastReported = -PROGRESS_STEP
  failure.value = ''
  status.value = '正在加载视频…'
  const hls = source.format === 'hls'
  if (player && !fresh) {
    // 复用同一个 video 元素换源：浏览器会保持当前的全屏状态。
    engine?.destroy()
    engine = undefined
    player.switchVideo({ url: source.url, type: hls ? 'customHls' : 'normal' })
    void player.play()?.catch(() => {})
    return
  }
  const container = host.value
  if (!container) return
  release()
  // 播放器只在真正播放时加载，主窗口不下载这份代码。
  const { default: DPlayer } = await import('dplayer')
  if (session !== generation || host.value !== container) return
  player = new DPlayer({
    container,
    theme: '#3d70bf',
    lang: 'zh-cn',
    autoplay: true,
    preload: 'auto',
    hotkey: true,
    // 跨域视频会让截图画布被污染，直接关掉这个入口。
    screenshot: false,
    video: {
      url: source.url,
      type: hls ? 'customHls' : 'normal',
      customType: {
        // 换源时 DPlayer 会再次调用，这里读取最新的会话编号。
        customHls: (video: HTMLVideoElement) => { void attachHls(video, generation) },
      },
    },
  })
  mountedOn = container
  mountNextButton()
  for (const event of ['loadeddata', 'canplay', 'playing'] as const) player.on(event, ready)
  player.on('error', mediaError)
  player.on('ended', () => emit('ended'))
  player.on('timeupdate', () => {
    if (!player) return
    const video = player.video
    if (props.startAt > 0 && video.currentTime < props.startAt - 1 && !seeken) {
      seeken = true
      video.currentTime = props.startAt
    }
    // timeupdate 每秒触发约 4 次，逐次写记录和跨窗口通知会明显吃 CPU。
    // 只在播放位置前进足够多时才上报；拖动进度条会立刻上报。
    if (Math.abs(video.currentTime - lastReported) < PROGRESS_STEP) return
    lastReported = video.currentTime
    emit('progress', video.currentTime, video.duration)
  })
  // 暂停时补一次，避免刚停下就切走时丢掉这几秒。
  player.on('pause', () => {
    if (!player) return
    lastReported = player.video.currentTime
    emit('progress', player.video.currentTime, player.video.duration)
  })
}

watch([host, () => props.source], ([container, source]) => {
  if (!container || !source) return
  void load(source, !player || mountedOn !== container)
}, { flush: 'post' })

watch(() => props.hasNext, syncNextButton)

onMounted(() => document.addEventListener('dblclick', toggleFullscreen))
onBeforeUnmount(() => {
  document.removeEventListener('dblclick', toggleFullscreen)
  generation++
  release()
})
</script>

<template>
  <section class="video-panel" aria-label="视频播放器">
    <div ref="host" class="player-host" :aria-label="title" />
    <div v-if="status || failure" class="player-status" :class="{ failure }" role="status">
      <span v-if="!failure" class="spinner" aria-hidden="true"></span>
      <span>{{ failure || status }}</span>
      <button v-if="failure" class="secondary" type="button" @click="emit('retry')">重试播放</button>
    </div>
  </section>
</template>
