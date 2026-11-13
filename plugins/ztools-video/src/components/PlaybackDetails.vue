<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EpisodePicker from './EpisodePicker.vue'
import VideoPlayer from './VideoPlayer.vue'
import { readHistory, saveHistory } from '../history'
import { readAutoNext, saveAutoNext } from '../prefs'
import { service } from '../service'
import type { Catalog, Episode, PlaybackRequest, Source } from '../types'

const props = defineProps<{ request?: PlaybackRequest; inline?: boolean }>()
const emit = defineEmits<{ back: [] }>()
const busy = ref('')
const error = ref('')
const catalog = ref<Catalog | null>(null)
const title = ref('影视播放')
const selected = ref<Episode | null>(null)
const sources = ref<Source[]>([])
const chosen = ref(0)
const attempt = ref(0)
const startAt = ref(0)
const autoNext = ref(readAutoNext())
const source = computed(() => sources.value[chosen.value])
// 多集剧集才提供连播，单集影片和直链不显示。
const isSeries = computed(() => (catalog.value?.episodes.length || 0) > 1)
// 跨窗口通知的合并间隔。
const NOTICE_INTERVAL = 5000
let lastNoticeAt = 0
let session = 0

function invalidate() {
  session++
  service.cancel()
  return session
}

function explain(cause: unknown) {
  return cause instanceof Error ? cause.message : '请求失败，请稍后重试。'
}

/**
 * 查找这部剧上次看到的位置，用于续播。
 * @param request 本次播放请求。
 * @returns 上次的记录项，没有或不是同一部剧时为空。
 */
function resumeFrom(request?: PlaybackRequest) {
  if (request?.kind !== 'catalog') return
  // 每次打开剧集只读一次，取最新的落盘结果，避免窗口长期复用后读到旧进度。
  return readHistory(true).find(entry => entry.key === `catalog:${request.v}`)
}

/**
 * 把播放位置写入播放记录。
 * @param position 当前播放位置（秒）。
 * @param duration 视频总时长（秒）。
 * @param force 为 true 时跳过通知合并，立即告知主窗口。
 */
function remember(position: number, duration: number, force = false) {
  const request = props.request
  if (!request) return
  saveHistory(request, position, duration, {
    cover: request.kind === 'catalog' ? request.cover ?? null : null,
    episodeV: selected.value?.v,
    episodeNumber: selected.value?.number,
    episodeLine: selected.value?.line,
  })
  // 独立窗口离屏时主窗口收不到 focus，用消息让首页记录实时更新。
  // 跨窗口通知本身有固定开销，合并到最多每 5 秒一次。
  const now = Date.now()
  if (!force && now - lastNoticeAt < NOTICE_INTERVAL) return
  lastNoticeAt = now
  window.videoPlayback?.notifyHistoryChanged()
}

async function loadRequest(request?: PlaybackRequest) {
  const task = invalidate()
  catalog.value = null
  selected.value = null
  sources.value = []
  chosen.value = 0
  startAt.value = 0
  error.value = ''
  busy.value = ''
  title.value = request?.title || '影视播放'
  if (!props.inline) document.title = title.value
  if (!request) return
  if (request.kind === 'direct') {
    sources.value = [request.source]
    startAt.value = resumeFrom(request)?.position ?? 0
    return
  }
  busy.value = '正在读取选集…'
  try {
    const info = await service.catalog(request.v)
    if (session !== task) return
    catalog.value = info
    title.value = info.title
    if (!props.inline) document.title = info.title
    // 续播：回到上次看的那一集，找不到就退回默认集。
    const resumed = resumeFrom(request)
    if (resumed?.position) startAt.value = resumed.position
    const episode = info.episodes.find(item => item.v === resumed?.episodeV)
      // 剧集标识可能随线路调整变化，再按线路和集号兜底匹配一次。
      ?? info.episodes.find(item => item.line === resumed?.episodeLine && item.number === resumed?.episodeNumber)
      ?? info.selected
    await loadEpisode(episode, { keepPosition: Boolean(resumed?.position) })
  } catch (cause) {
    if (session === task) { error.value = explain(cause); busy.value = '' }
  }
}

/**
 * 加载一集并解析播放地址。
 * @param episode 目标剧集。
 * @param options.keepPosition 续播时为 true，保留上次的播放位置。
 */
async function loadEpisode(episode: Episode, options: { keepPosition?: boolean } = {}) {
  const task = invalidate()
  selected.value = episode
  // 换集时保留上一集的画面，等新地址解析完成再替换，
  // 否则播放器会被卸载，正在全屏的视频也会被打断。
  // 手动选集从头开始，只有续播才沿用上次的位置。
  if (!options.keepPosition) startAt.value = 0
  error.value = ''
  busy.value = '正在获取播放地址…'
  try {
    const found = await service.resolve(episode.v)
    if (session !== task) return
    chosen.value = 0
    sources.value = found
  } catch (cause) {
    if (session !== task) return
    error.value = explain(cause)
    // 解析失败时清掉画面，让错误提示显示出来。
    sources.value = []
  } finally {
    if (session === task) busy.value = ''
  }
}

/**
 * 一集播放结束时标记看完，并按开关自动播放下一集。
 * 复用同一个播放器换源，因此全屏状态不会被退出。
 */
function handleEnded() {
  const video = document.querySelector('video')
  // 播完是状态变化（进度归零、可能切集），立即同步给主窗口。
  if (video) remember(video.duration, video.duration, true)
  if (autoNext.value && next.value) void loadEpisode(next.value)
}

watch(autoNext, value => saveAutoNext(value))

function retryPlayback() {
  if (selected.value) void loadEpisode(selected.value)
  else if (props.request?.kind === 'direct') attempt.value++
  else void loadRequest(props.request)
}

const next = computed(() => {
  const current = selected.value
  if (!current) return
  return catalog.value?.episodes.find(episode => episode.line === current.line && episode.number > current.number)
})

// pagehide 和 onBeforeUnmount 会先后触发，只保存一次，避免关窗口时重复写盘。
let savedOnExit = false

/**
 * 把当前播放位置补存一次。
 * @param once 为 true 时整个生命周期只执行一次，用于窗口关闭。
 */
function saveNow(once = false) {
  if (once) {
    if (savedOnExit) return
    savedOnExit = true
  }
  const video = document.querySelector('video')
  if (video && selected.value) remember(video.currentTime, video.duration, true)
}

watch(() => props.request, request => { void loadRequest(request) }, { immediate: true })
onMounted(() => {
  // pagehide 在窗口关闭和页面被替换时都会触发，比卸载钩子更可靠。
  window.addEventListener('pagehide', () => saveNow(true))
  // 切到后台或被遮挡时先存一次，用户可能不会再回来。
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow() })
})
onBeforeUnmount(() => {
  saveNow(true)
  invalidate()
})
</script>

<template>
  <div :class="inline ? 'inline-player' : 'player-window'">
    <section class="content" :class="{ shell: !inline }" aria-label="影视播放">
      <div class="play-heading">
        <button v-if="inline" type="button" class="secondary back" @click="emit('back')"><span aria-hidden="true">‹</span> 返回</button>
        <div class="play-title">
          <h2>{{ title }}</h2>
          <span v-if="selected && (catalog?.episodes.length || 0) > 1">第 {{ selected.number }} 集</span>
        </div>
        <button v-if="next" class="secondary" type="button" @click="loadEpisode(next)">下一集</button>
      </div>
      <div class="watch-grid" :class="{ 'with-episodes': catalog && selected && catalog.episodes.length > 1 }">
        <div class="player-column">
          <template v-if="source">
            <VideoPlayer :key="attempt + ':' + chosen" :source="source" :title="title" :start-at="startAt"
              :has-next="Boolean(next)" @retry="retryPlayback" @progress="remember" @ended="handleEnded"
              @next="next && loadEpisode(next)" />
            <div class="media-info">
              <span class="badge">{{ source.format === 'hls' ? 'HLS · M3U8' : 'MP4' }}</span>
              <label v-if="sources.length > 1">线路
                <select v-model.number="chosen">
                  <option v-for="(item, index) in sources" :key="item.url" :value="index">{{ item.quality || '线路 ' + (index + 1) }} · {{ item.format === 'hls' ? 'HLS' : 'MP4' }}</option>
                </select>
              </label>
              <span v-else-if="source.quality">{{ source.quality }}</span>
              <label v-if="isSeries" class="auto-next">
                <input v-model="autoNext" type="checkbox"> 自动连播
              </label>
            </div>
          </template>
          <div v-else class="state-panel" :class="{ failure: error }" role="status">
            <span v-if="busy" class="spinner" aria-hidden="true"></span><span>{{ error || busy || '等待选择影片…' }}</span>
            <button v-if="error" type="button" class="secondary" @click="retryPlayback">重新获取</button>
          </div>
        </div>
        <EpisodePicker v-if="catalog && selected && catalog.episodes.length > 1"
          :episodes="catalog.episodes" :selected="selected" @select="loadEpisode" />
      </div>
    </section>
  </div>
</template>
