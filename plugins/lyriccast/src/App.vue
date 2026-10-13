<script setup lang="ts">
/**
 * 词投 LyricCast 主界面:
 * - 「歌词」首页 = 网易云「正在播放」页:封面氛围背景 + 正在播放条 + 全高滚动歌词;
 * - 「设置」页 = 桌面歌词 / 歌词显示 / 校准 / 连接(端口、Token、配对二维码)/ 关于;
 * - 桌面歌词:独立置顶透明窗口(desktop-bridge),主界面 rAF tick 顺带驱动其状态推送。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { activeCoverUrl, displayAnchor, initStore, markCoverBroken, retryCover, ui } from './store'
import { renderProgress, type LinkStatus } from './progress'
import { settings } from './settings'
import { disableDesktopLyrics, enableDesktopLyrics, notifyStyleChanged } from './desktop-bridge'
import CandidatePicker from './components/CandidatePicker.vue'
import Lyrics from './components/Lyrics.vue'
import SettingsView from './components/SettingsView.vue'
import { openCandidatePicker } from './store'

/** 协议状态 → 中文展示 */
const STATE_TEXT: Record<string, string> = {
  playing: '播放中',
  paused: '已暂停',
  buffering: '缓冲中',
  stopped: '已停止',
  none: '无播放'
}

/** 降级状态 → 徽标附加文案(协议 §6.3) */
const LINK_TEXT: Record<LinkStatus, string> = {
  connected: '',
  stale: '数据延迟',
  grace: '已断开 · 重连中',
  disconnected: '已断开'
}

type Tab = 'lyrics' | 'settings'
const tab = ref<Tab>('lyrics')

const cleanupRef = ref<(() => void) | null>(null)
interface PositionView {
  positionMs: number
  known: boolean
  state: string
  status: LinkStatus
}
const position = ref<PositionView | null>(null)
let rafId = 0
let lastUiUpdate = 0

const displayState = computed(() => displayAnchor.value?.state ?? null)

const hasDevices = computed(() => (ui.snapshot?.devices.length ?? 0) > 0)

const statusText = computed(() => {
  if (ui.serverError) return '服务错误'
  if (!ui.snapshot?.listening) return '服务未启动'
  if (!hasDevices.value) return '等待手机连接'
  return `已连接 ${ui.snapshot.devices.length} 台设备`
})

const statusDot = computed(() => {
  if (ui.serverError || !ui.snapshot?.listening) return 'err'
  return hasDevices.value ? 'ok' : 'warn'
})

const stateBadge = computed(() => {
  if (!displayState.value) return ''
  const base = STATE_TEXT[displayState.value.playback.state ?? 'none'] ?? '无播放'
  const link = position.value?.status ?? 'connected'
  const suffix = LINK_TEXT[link]
  return suffix ? `${base} · ${suffix}` : base
})

/** 断线且超过宽限期:整卡灰化,保留最后一首歌的信息 */
const offline = computed(() => position.value?.status === 'disconnected')

const durationMs = computed(() => displayAnchor.value?.state.track.durationMs ?? 0)
const positionMs = computed(() => position.value?.positionMs ?? 0)
const progressPct = computed(() =>
  durationMs.value > 0 ? Math.min(100, (positionMs.value / durationMs.value) * 100) : 0
)

/** 进度未知时 UI 显示 --:-- 而不是伪造 0:00 */
const positionKnown = computed(() => position.value?.known ?? false)

/** 展示用封面:手机推送封面优先,API 兜底封面其次(store.activeCoverUrl 统一裁决) */
const artworkUrl = activeCoverUrl

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * rAF 驱动进度显示;~20fps 足够,降低无谓重绘。
 * 页面不可见时 rAF 自动暂停(Electron 行为),恢复后由纯函数按墙钟一次性算对。
 * 桌面歌词的推送不在这里驱动 —— bridge 自持定时器,主窗口隐藏时依然换行。
 */
function tick(now: number) {
  rafId = requestAnimationFrame(tick)
  if (now - lastUiUpdate < 50) return
  lastUiUpdate = now
  const anchor = displayAnchor.value
  if (!anchor) {
    position.value = null
    return
  }
  const rendered = renderProgress(anchor, Date.now())
  position.value = {
    positionMs: rendered.positionMs,
    known: rendered.known,
    state: anchor.state.playback.state,
    status: rendered.status
  }
}

// ===== 桌面歌词生命周期:开关 → 创建/销毁悬浮窗;样式设置变化 → 立即重推 =====
watch(
  () => settings.desktopEnabled,
  (enabled) => {
    if (enabled) {
      const result = enableDesktopLyrics()
      ui.desktopError = result.ok ? '' : result.error || '创建悬浮窗失败'
    } else {
      ui.desktopError = ''
      disableDesktopLyrics()
    }
  }
)

watch(
  () => [
    settings.desktopFontSize,
    settings.desktopTheme,
    settings.desktopAlign,
    settings.desktopTranslation,
    settings.desktopLocked,
    settings.desktopOpacity,
    settings.desktopWidth,
    settings.desktopHeight,
    settings.desktopLineGap,
    settings.desktopLineOffset,
    settings.desktopCustomCss
  ],
  () => notifyStyleChanged()
)

/** 占位符点击重试:手机重发封面 + 立即走一次封面 API 兜底(绕过负缓存) */
function requestArtwork() {
  try {
    window.services.lanLyrics.requestArtwork()
  } catch (_) { /* 非 ZTools 环境(纯浏览器调试) */ }
  retryCover()
}

onMounted(async () => {
  // onPluginOut 在「转入后台」和「完全退出」时都会触发,靠 processExit 区分:
  // 转后台(false)时悬浮窗必须常驻 —— bridge 自持定时器不依赖主窗口,后台继续换行;
  // 只有完全退出(true)才销毁,否则插件一隐藏桌面歌词就跟着消失
  try {
    window.ztools?.onPluginOut?.((processExit) => {
      if (processExit) disableDesktopLyrics()
    })
  } catch (_) { /* 非 ZTools 环境 */ }
  cleanupRef.value = await initStore()
  rafId = requestAnimationFrame(tick)
})

onUnmounted(() => {
  cancelAnimationFrame(rafId)
  cleanupRef.value?.()
})
</script>

<template>
  <div class="app" :class="{ 'on-stage': tab === 'lyrics' }">
    <!-- 封面模糊氛围背景:铺在整页(顶栏 + 内容区共用同一张连续背景),仅歌词页显示 -->
    <div
      v-show="tab === 'lyrics'"
      class="ambience"
      :class="{ on: !!artworkUrl && displayState }"
      :style="artworkUrl ? { backgroundImage: `url(${artworkUrl})` } : {}"
    ></div>
    <div v-show="tab === 'lyrics'" class="scrim"></div>

    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">♪</span>
        <span class="brand-name">词投 LyricCast</span>
      </div>
      <nav class="tabs">
        <button :class="{ on: tab === 'lyrics' }" @click="tab = 'lyrics'">歌词</button>
        <button :class="{ on: tab === 'settings' }" @click="tab = 'settings'">设置</button>
      </nav>
      <span class="status" :title="ui.serverError || statusText">
        <span class="dot" :class="statusDot"></span>{{ statusText }}
      </span>
    </header>

    <main class="view">
      <!-- ===== 首页:氛围舞台 + 正在播放 + 滚动歌词 ===== -->
      <section v-show="tab === 'lyrics'" class="stage">
        <template v-if="displayState">
          <!-- 正在播放条(断线超宽限期整卡灰化,信息保留) -->
          <section class="np" :class="{ offline }">
            <img
              v-if="artworkUrl"
              class="artwork"
              :src="artworkUrl"
              alt="封面"
              @error="markCoverBroken"
            />
            <div
              v-else
              class="artwork placeholder"
              @click="requestArtwork"
              title="点击重试获取封面"
            >
              ♪
            </div>
            <div class="np-meta">
              <div class="np-title">{{ displayState.track.title || '(未知标题)' }}</div>
              <div class="np-sub">
                {{ displayState.track.artist || '(未知歌手)'
                }}<template v-if="displayState.track.album"> · {{ displayState.track.album }}</template>
              </div>
              <div class="np-tags">
                <span class="badge">{{ displayState.app.name || displayState.app.package }}</span>
                <span class="badge" :class="{ warn: offline }">{{ stateBadge }}</span>
                <button class="badge link" title="手动选择歌词候选" @click="openCandidatePicker">
                  歌词不对?换一个
                </button>
              </div>
            </div>
            <div class="np-progress">
              <span class="mono time">{{ positionKnown ? formatTime(positionMs) : '--:--' }}</span>
              <div class="progress">
                <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
              </div>
              <span class="mono time">{{ formatTime(durationMs) }}</span>
            </div>
          </section>

          <!-- 滚动歌词(占满剩余高度) -->
          <Lyrics :position-ms="positionKnown ? positionMs : -1" />
        </template>

        <!-- 空态引导 -->
        <section v-else class="hero">
          <div class="disc"><span>♪</span></div>
          <h2 class="hero-title">已就绪,等待手机连接</h2>
          <div class="steps">
            <span class="step"><i>1</i>手机安装「词投」App</span>
            <span class="step"><i>2</i>同一 Wi-Fi 扫码配对</span>
            <span class="step"><i>3</i>开启局域网推送</span>
          </div>
          <div class="hero-hint">{{ statusText }}<template v-if="ui.serverError">:{{ ui.serverError }}</template></div>
          <button class="cta" @click="tab = 'settings'">前往设置 / 配对</button>
        </section>
      </section>

      <!-- ===== 设置页 ===== -->
      <SettingsView v-show="tab === 'settings'" />
    </main>

    <!-- 候选面板(任务 3.1):任意页可唤起,覆盖层独立于选项卡 -->
    <CandidatePicker />
  </div>
</template>

<style scoped>
.app {
  position: relative;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-1);
}

/* ===== 歌词页:常暗氛围铺满整页,顶栏与内容区共用一张连续背景(网易云「正在播放」页同思路) ===== */
.app.on-stage {
  background: linear-gradient(165deg, #23262e 0%, #191b21 55%, #14161b 100%);
  color: #f2f4f8;
}

/* 深色氛围下顶栏控件切换为浅色配色 */
.on-stage .tabs {
  background: rgba(255, 255, 255, 0.09);
}

.on-stage .tabs button {
  color: rgba(255, 255, 255, 0.62);
}

.on-stage .tabs button.on {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
}

.on-stage .status {
  color: rgba(255, 255, 255, 0.6);
}

/* ===== 顶栏 ===== */
.topbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.02em;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: linear-gradient(135deg, #4f9cf9, #8a7bff);
  color: #fff;
  font-size: 12px;
  box-shadow: 0 2px 8px rgba(79, 156, 249, 0.4);
}

.tabs {
  display: inline-flex;
  background: var(--bg-3);
  border-radius: 10px;
  padding: 2px;
  gap: 2px;
  margin-left: auto;
}

.tabs button {
  border: none;
  background: transparent;
  padding: 4px 14px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.tabs button.on {
  background: var(--bg-2);
  color: var(--text-1);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14);
}

.status {
  font-size: 11px;
  color: var(--text-2);
  white-space: nowrap;
}

/* ===== 主视图(需在氛围背景层之上) ===== */
.view {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ===== 首页舞台:深色氛围背景铺在整页 .app 上(见 .on-stage),这里只做布局容器 ===== */
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 14px 12px;
  overflow: hidden;
}

.ambience {
  position: absolute;
  inset: -60px;
  background-size: cover;
  background-position: center;
  filter: blur(64px) saturate(1.5) brightness(0.86);
  opacity: 0;
  transform: scale(1.08);
  transition: opacity 1.2s ease;
  pointer-events: none;
}

.ambience.on {
  opacity: 0.62;
}

.scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(12, 14, 18, 0.28) 0%, rgba(12, 14, 18, 0.55) 100%);
  pointer-events: none;
}

/* ===== 正在播放条 ===== */
.np {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(18px) saturate(1.3);
  flex-shrink: 0;
}

/* 断线超宽限期:整卡降饱和度,信息保留(协议 §6.3) */
.np.offline {
  opacity: 0.55;
  filter: grayscale(0.9);
}

.artwork {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}

.artwork.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.5);
  font-size: 26px;
  cursor: pointer;
}

.np-meta {
  flex: 1;
  min-width: 0;
}

.np-title {
  font-size: 17px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np-sub {
  margin-top: 3px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np-tags {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.badge {
  font-size: 10.5px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.66);
  white-space: nowrap;
}

.badge.warn {
  border-style: dashed;
  color: rgba(255, 255, 255, 0.45);
}

/* "换一个"入口:徽标外形的幽灵按钮,悬停点亮 */
.badge.link {
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.badge.link:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.np-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 132px;
  flex-shrink: 0;
}

.time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  min-width: 32px;
  text-align: center;
}

.progress {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.16);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #4f9cf9, #9ecbff);
  transition: width 0.1s linear;
}

.mono {
  font-family: ui-monospace, Consolas, monospace;
}

/* ===== 空态引导 ===== */
.hero {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
  padding: 20px;
}

.disc {
  width: 84px;
  height: 84px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 32% 30%, rgba(255, 255, 255, 0.35), transparent 42%),
    conic-gradient(from 210deg, #2c3a52, #1d2430, #35415c, #1d2430, #2c3a52);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: spin 14s linear infinite;
}

.disc span {
  font-size: 26px;
  color: rgba(255, 255, 255, 0.8);
  animation: spin 14s linear infinite reverse;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.hero-title {
  margin: 4px 0 0;
  font-size: 17px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
}

.steps {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.62);
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.step i {
  font-style: normal;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(120, 170, 255, 0.28);
  color: #cfe3ff;
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.hero-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.cta {
  margin-top: 4px;
  padding: 8px 22px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, #4f9cf9, #8a7bff);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(79, 156, 249, 0.35);
  transition: transform 0.15s, box-shadow 0.15s;
}

.cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 26px rgba(79, 156, 249, 0.45);
}
</style>
