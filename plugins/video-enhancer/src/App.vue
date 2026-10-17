<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { EnhanceOptions, InstallProgress, JobProgress, SystemInfo, VideoFileInfo, WatermarkPosition } from './env.d'

// 本地存储 key
const STORAGE_KEY_TOKEN = 'ztools_video_enhancer_replicate_token'
const STORAGE_KEY_ENGINE_PATH = 'ztools_video_enhancer_engine_path'
const STORAGE_KEY_MODE = 'ztools_video_enhancer_preferred_mode'
const STORAGE_KEY_WORKER_COUNT = 'ztools_video_enhancer_worker_count'
const STORAGE_KEY_SPEED_MODE = 'ztools_video_enhancer_speed_mode'

// 系统信息
const systemInfo = ref<SystemInfo>({
  platform: 'darwin',
  arch: 'arm64',
  totalMemGB: 16,
  isMac: true,
  isWindows: false,
  isAppleSilicon: true,
  foundEnginePath: '',
  isLocalAvailable: false,
  defaultRecommendedEngine: 'cloud'
})

// 运行模式与凭证
const engineMode = ref<'cloud' | 'local'>('cloud')
const localEnginePath = ref('')
const cloudApiKey = ref('')

// 引擎一键安装状态
const isInstalling = ref(false)
const installSuccessMessage = ref('')
const installProgress = ref<InstallProgress>({
  percent: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  downloadedFormatted: '0 B',
  totalFormatted: '0 B',
  speedText: ''
})
const installStatusText = ref('准备就绪')
const installError = ref('')

// 视频文件信息
const selectedFile = ref<VideoFileInfo | null>(null)
const isDragging = ref(false)

// 场景预设：anime | real | interpolate
const activePreset = ref<'anime' | 'real' | 'interpolate'>('anime')
const scaleFactor = ref<number>(2)
const speedMode = ref<'fast' | 'quality'>('fast')
const customWorkerCount = ref<number | 'auto'>('auto')
const vramGuard = ref(true)
const removeWatermark = ref(false)
const watermarkPosition = ref<WatermarkPosition>('bottom-right')

// 作业状态：'idle' | 'running' | 'completed' | 'error'
const jobStatus = ref<'idle' | 'running' | 'completed' | 'error'>('idle')
const currentJobId = ref('')
const isPreviewMode = ref(false)
const progressData = ref<JobProgress>({
  jobId: '',
  percent: 0,
  currentFrame: 0,
  totalFrames: 0,
  fps: 0,
  etaSeconds: 0,
  statusText: '准备就绪'
})
const lastOutputPath = ref('')
const logs = ref<string[]>([])
const showLogs = ref(false)
const errorMessage = ref('')

// 试看对比弹窗与设置弹窗
const showCompareModal = ref(false)
const compareSliderPos = ref(50)
const showSettings = ref(false)
const settingsTab = ref<'cloud' | 'local'>('cloud')

// 校验状态
const isCloudReady = computed(() => !!cloudApiKey.value.trim())
const isLocalReady = computed(() => systemInfo.value.isLocalAvailable || !!localEnginePath.value.trim())

// 计算按钮就绪状态
const canStart = computed(() => {
  if (!selectedFile.value) return false
  if (engineMode.value === 'cloud') return isCloudReady.value
  return isLocalReady.value
})

const startButtonText = computed(() => {
  if (engineMode.value === 'cloud') {
    if (!isCloudReady.value) return '🔑 请先填写云端 Token (点击获取)'
    return isPreviewMode.value ? '🔍 开始云端试看 (3秒)' : '🚀 启动云端真实增强'
  } else {
    if (!isLocalReady.value) return '⬇️ 本地未安装引擎，点击一键安装'
    return isPreviewMode.value ? '🔍 开始本地试看 (3秒)' : '🚀 启动本地 GPU 增强'
  }
})

const formattedEta = computed(() => {
  const sec = progressData.value.etaSeconds
  if (!sec || sec <= 0) return '计算中...'
  if (sec < 60) return `约 ${sec} 秒`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  return `约 ${min} 分 ${remSec} 秒`
})

// 初始化与持久化
onMounted(async () => {
  const savedToken = localStorage.getItem(STORAGE_KEY_TOKEN)
  if (savedToken) cloudApiKey.value = savedToken

  const savedEnginePath = localStorage.getItem(STORAGE_KEY_ENGINE_PATH)
  if (savedEnginePath) localEnginePath.value = savedEnginePath

  const savedMode = localStorage.getItem(STORAGE_KEY_MODE) as 'cloud' | 'local'
  if (savedMode) engineMode.value = savedMode

  const savedWorkerCount = localStorage.getItem(STORAGE_KEY_WORKER_COUNT)
  if (savedWorkerCount) {
    customWorkerCount.value = savedWorkerCount === 'auto' ? 'auto' : parseInt(savedWorkerCount, 10)
  }

  const savedSpeedMode = localStorage.getItem(STORAGE_KEY_SPEED_MODE) as 'fast' | 'quality'
  if (savedSpeedMode) speedMode.value = savedSpeedMode

  // 探测系统环境
  if (window.services && typeof window.services.detectEnvironment === 'function') {
    try {
      const info = await window.services.detectEnvironment(customWorkerCount.value)
      systemInfo.value = info
      if (!savedMode) {
        engineMode.value = info.defaultRecommendedEngine
      }
      if (!savedEnginePath && info.foundEnginePath) {
        localEnginePath.value = info.foundEnginePath
      }
    } catch (e) {
      console.warn('环境探测异常，进入降级状态:', e)
    }
  }

  // 监听 ZTools 生命周期
  const hostApi = window.ztools || (window as any).utools
  if (hostApi && typeof hostApi.onPluginEnter === 'function') {
    hostApi.onPluginEnter((action: any) => {
      try {
        if (action?.type === 'files' && Array.isArray(action.payload) && action.payload.length > 0) {
          handleFilePath(action.payload[0].path || action.payload[0])
        }
      } catch (e) {
        console.error('onPluginEnter 处理失败:', e)
      }
    })
  }
})

watch(cloudApiKey, (val) => {
  localStorage.setItem(STORAGE_KEY_TOKEN, val)
})

watch(localEnginePath, (val) => {
  localStorage.setItem(STORAGE_KEY_ENGINE_PATH, val)
})

watch(engineMode, (val) => {
  localStorage.setItem(STORAGE_KEY_MODE, val)
})

watch(customWorkerCount, async (val) => {
  localStorage.setItem(STORAGE_KEY_WORKER_COUNT, String(val))
  if (window.services && typeof window.services.detectEnvironment === 'function') {
    try {
      systemInfo.value = await window.services.detectEnvironment(val)
    } catch (e) {}
  }
})

watch(speedMode, (val) => {
  localStorage.setItem(STORAGE_KEY_SPEED_MODE, val)
})

// 一键安装本地引擎核心流程
async function handleInstallEngine() {
  if (isInstalling.value) return
  if (!window.services || typeof window.services.installLocalEngine !== 'function') {
    alert('当前环境不支持自动安装脚本')
    return
  }

  isInstalling.value = true
  installError.value = ''
  installStatusText.value = '正在连接高速镜像拉取 AI 核心...'
  installProgress.value = {
    percent: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    downloadedFormatted: '0 B',
    totalFormatted: '0 B',
    speedText: ''
  }

  try {
    const result = await window.services.installLocalEngine(
      (p) => {
        installProgress.value = p
        if (p.percent < 100) {
          installStatusText.value = `正在下载 AI 引擎核心 (${p.downloadedFormatted} / ${p.totalFormatted})`
        } else {
          installStatusText.value = '下载完成，正在自动解压与配置运行权限...'
        }
      },
      (log) => {
        logs.value.push(log)
      }
    )

    if (result && result.success) {
      localEnginePath.value = result.enginePath
      systemInfo.value.isLocalAvailable = true
      systemInfo.value.foundEnginePath = result.enginePath
      installStatusText.value = '✅ 安装成功！本地 AI 离线引擎已就绪'
      installSuccessMessage.value = 'AI 离线引擎已部署成功，路径已自动填入！'
      setTimeout(() => {
        isInstalling.value = false
      }, 1200)
    }
  } catch (err: any) {
    installError.value = err.message || '安装过程中出现异常'
    isInstalling.value = false
  }
}

// 解析视频文件
function handleFilePath(filePath: string) {
  if (!filePath) return
  if (window.services) {
    try {
      const fileInfo = window.services.getVideoFileInfo(filePath)
      selectedFile.value = fileInfo
      jobStatus.value = 'idle'
      errorMessage.value = ''
    } catch (err: any) {
      errorMessage.value = '无法解析所选文件: ' + err.message
    }
  } else {
    selectedFile.value = {
      path: filePath,
      name: filePath.split('/').pop()?.split('\\').pop() || '示例视频.mp4',
      dir: '/Users/demo/Videos',
      size: 32 * 1024 * 1024,
      sizeFormatted: '32 MB',
      ext: 'mp4',
      lastModified: Date.now()
    }
  }
}

/**
 * 从 File 对象安全提取本地绝对路径。
 * ZTools/Electron 环境下 File.path 已废弃，
 * 必须通过宿主 API getPathForFile 获取。
 */
function resolveFilePath(file: File): string {
  // 1. 优先使用宿主提供的标准 API
  const hostApi = window.ztools || (window as any).utools
  if (hostApi?.getPathForFile) {
    try {
      const p = hostApi.getPathForFile(file)
      if (p) return p
    } catch (e) {}
  }
  // 2. 旧版 Electron 兼容（File.path）
  if ((file as any).path) return (file as any).path
  // 3. 最终兜底（仅文件名，调用方会报错提醒）
  return file.name
}

// 拖拽处理
function onDrop(e: DragEvent) {
  isDragging.value = false
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0]
    handleFilePath(resolveFilePath(file))
  }
}

function triggerFilePicker() {
  // 优先使用宿主原生文件选择器（可以返回绝对路径）
  const hostApi = window.ztools || (window as any).utools
  if (hostApi?.showOpenDialog) {
    try {
      const result = hostApi.showOpenDialog({
        properties: ['openFile'],
        filters: [
          {
            name: '视频文件',
            extensions: ['mp4', 'mkv', 'mov', 'avi', 'flv', 'webm', 'm4v', 'wmv']
          }
        ]
      })

      // showOpenDialog 可能返回 Promise 或同步结果
      const handle = (files: any) => {
        const filePath = Array.isArray(files) ? files[0] : files?.filePaths?.[0] || files
        if (filePath && typeof filePath === 'string') handleFilePath(filePath)
      }

      if (result && typeof result.then === 'function') {
        result.then(handle)
      } else {
        handle(result)
      }
      return
    } catch (e) {}
  }

  // 兜底：浏览器原生 <input> 选择器
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'video/mp4,video/mkv,video/quicktime,video/x-matroska,video/*'
  input.onchange = (ev: any) => {
    if (ev.target.files && ev.target.files[0]) {
      const file = ev.target.files[0]
      handleFilePath(resolveFilePath(file))
    }
  }
  input.click()
}

// 启动任务拦截与执行
async function handleActionClick(preview: boolean = false) {
  if (engineMode.value === 'cloud' && !isCloudReady.value) {
    settingsTab.value = 'cloud'
    showSettings.value = true
    return
  }

  if (engineMode.value === 'local' && !isLocalReady.value) {
    // 未安装时，直接触发一键安装
    handleInstallEngine()
    return
  }

  await startEnhance(preview)
}

async function startEnhance(preview: boolean = false) {
  if (!selectedFile.value) return

  isPreviewMode.value = preview
  jobStatus.value = 'running'
  logs.value = []
  errorMessage.value = ''
  currentJobId.value = 'job_' + Date.now()

  const options: EnhanceOptions = {
    engineMode: engineMode.value,
    enginePath: localEnginePath.value,
    cloudApiKey: cloudApiKey.value.trim(),
    inputPath: selectedFile.value.path,
    preset: activePreset.value,
    scale: scaleFactor.value,
    isPreview: preview,
    speedMode: speedMode.value,
    customWorkerCount: customWorkerCount.value,
    vramGuard: vramGuard.value,
    removeWatermark: removeWatermark.value,
    watermarkPosition: watermarkPosition.value
  }

  if (window.services) {
    const res = await window.services.startEnhanceJob(currentJobId.value, options, {
      onProgress: (p) => {
        progressData.value = p
      },
      onLog: (msg) => {
        logs.value.push(msg)
        if (logs.value.length > 200) logs.value.shift()
      },
      onComplete: (res) => {
        jobStatus.value = 'completed'
        lastOutputPath.value = res.outputPath
        if (preview) {
          showCompareModal.value = true
        }
      },
      onError: (err) => {
        jobStatus.value = 'error'
        errorMessage.value = err.message || '处理过程中出现异常'
      }
    })

    if (res?.error) {
      jobStatus.value = 'error'
      errorMessage.value = res.error
    }
  }
}

function cancelCurrentJob() {
  if (currentJobId.value && window.services) {
    window.services.cancelJob(currentJobId.value)
  }
  jobStatus.value = 'idle'
  logs.value.push('[System] 用户取消了任务')
}

function openFolder() {
  if (lastOutputPath.value && window.services) {
    window.services.showInFolder(lastOutputPath.value)
  }
}

function playVideo() {
  if (lastOutputPath.value && window.services) {
    window.services.playVideoFile(lastOutputPath.value)
  }
}

function resetAll() {
  jobStatus.value = 'idle'
  progressData.value.percent = 0
  logs.value = []
  lastOutputPath.value = ''
  selectedFile.value = null
}

function copyReplicateUrl() {
  const url = 'https://replicate.com/account/api-tokens'
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url)
    alert('已复制链接到剪贴板，请在浏览器中打开注册并复制 API Token：' + url)
  }
}

// 智能云端错误感知与降级救砖
const isCloudError = computed(() => {
  const msg = (errorMessage.value || '').toLowerCase()
  return msg.includes('云端') || msg.includes('replicate') || msg.includes('credit') || msg.includes('billing') || msg.includes('token') || msg.includes('unauthenticated')
})

function openBillingUrl() {
  const url = 'https://replicate.com/account/billing#billing'
  const hostApi = window.ztools || (window as any).utools
  if (hostApi && typeof hostApi.shellOpenExternal === 'function') {
    hostApi.shellOpenExternal(url)
  } else {
    window.open(url, '_blank')
  }
}

async function switchToLocalAndRetry() {
  engineMode.value = 'local'
  localStorage.setItem(STORAGE_KEY_MODE, 'local')
  jobStatus.value = 'idle'
  errorMessage.value = ''

  if (!isLocalReady.value) {
    settingsTab.value = 'local'
    showSettings.value = true
  } else {
    if (selectedFile.value) {
      await handleActionClick(false)
    }
  }
}
</script>

<template>
  <div class="app-container">
    <!-- 顶部状态栏 -->
    <header class="app-header">
      <div class="logo-area">
        <div class="logo-icon">✨</div>
        <div class="logo-text">
          <h1>AI 视频画质修复</h1>
          <span class="sub-desc">智能超分 · 动漫修复 · 60FPS 丝滑补帧</span>
        </div>
      </div>

      <div class="header-right">
        <!-- 引擎模式切换胶囊 -->
        <div class="engine-switch">
          <button
            class="switch-btn"
            :class="{ active: engineMode === 'cloud' }"
            @click="engineMode = 'cloud'"
          >
            ☁️ 云端算力
          </button>
          <button
            class="switch-btn"
            :class="{ active: engineMode === 'local' }"
            @click="engineMode = 'local'"
          >
            💻 本地显卡
          </button>
        </div>

        <!-- 状态指示灯 -->
        <div
          class="status-indicator"
          :class="engineMode === 'cloud' ? (isCloudReady ? 'ready' : 'warning') : (isLocalReady ? 'ready' : 'danger')"
          @click="showSettings = true"
          :title="engineMode === 'cloud' ? (isCloudReady ? '云端 Token 已就绪' : '需配置云端 Token') : (isLocalReady ? '本地引擎就绪' : '未检测到本地引擎')"
        >
          <span class="dot"></span>
          <span class="status-text">
            {{ engineMode === 'cloud' ? (isCloudReady ? '云端已就绪' : '未配置 Token') : (isLocalReady ? '本地就绪' : '未安装引擎') }}
          </span>
        </div>

        <button class="icon-btn" title="引擎与凭证设置" @click="showSettings = true">
          ⚙️
        </button>
      </div>
    </header>

    <!-- 一键安装本地引擎横幅（仅在本地模式且未安装时展示） -->
    <div v-if="engineMode === 'local' && !isLocalReady" class="install-banner-box">
      <div v-if="!isInstalling" class="banner-idle">
        <div class="banner-left">
          <span class="banner-emoji">🤖</span>
          <div>
            <div class="banner-title">未检测到本地 AI 离线引擎</div>
            <div class="banner-desc">无需手动配置，点击即可自动下载适合当前系统的 AI 引擎包（仅约 25MB，支持 GPU 加速，内含全套深度模型）。</div>
          </div>
        </div>
        <button class="btn-install-quick" @click="handleInstallEngine">
          ⬇️ 一键自动下载并安装
        </button>
      </div>

      <div v-else class="banner-installing">
        <div class="install-info-row">
          <span class="install-status-text">⏳ {{ installStatusText }}</span>
          <span class="install-speed-tag" v-if="installProgress.speedText">{{ installProgress.speedText }}</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${installProgress.percent}%` }"></div>
        </div>
        <div class="install-meta-row">
          <span>{{ installProgress.downloadedFormatted }} / {{ installProgress.totalFormatted }}</span>
          <span>{{ installProgress.percent }}%</span>
        </div>
      </div>

      <div v-if="installError" class="install-error-hint">
        ❌ 安装失败：{{ installError }}（建议检查网络连接，或切换为「云端算力」模式）
      </div>
    </div>

    <!-- 主操作区 -->
    <main class="main-content">
      <!-- 1. 未选视频 -->
      <section
        v-if="!selectedFile"
        class="drop-zone"
        :class="{ 'drop-active': isDragging }"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="onDrop"
        @click="triggerFilePicker"
      >
        <div class="drop-illustration">🎬</div>
        <h2>拖拽视频文件到这里</h2>
        <p class="drop-hint">点击选择或拖入视频 · 支持 MP4, MKV, MOV, AVI, FLV 等</p>
        
        <div class="engine-badge-tag">
          <span v-if="engineMode === 'local' && isLocalReady" class="win-tip">
            ⚡ 本地 Vulkan 独立引擎已就绪，享受离线硬件加速修复
          </span>
          <span v-else-if="engineMode === 'local' && !isLocalReady" class="danger-tip">
            💡 本地引擎未安装：点击上方「一键自动下载并安装」即可 10 秒快速就绪
          </span>
          <span v-else class="mac-tip">
            ☁️ 云端算力模式：免显卡与本地依赖，轻薄本与 macOS 用户首选
          </span>
        </div>
      </section>

      <!-- 2. 已选视频 & 准备配置 -->
      <div v-else-if="jobStatus === 'idle'" class="workflow-container">
        <!-- 视频信息卡片 -->
        <div class="file-card">
          <div class="file-info">
            <span class="file-badge">{{ selectedFile.ext.toUpperCase() }}</span>
            <div class="file-details">
              <div class="file-title" :title="selectedFile.path">{{ selectedFile.name }}</div>
              <div class="file-meta">大小：{{ selectedFile.sizeFormatted }} · 自动保存在原视频同级目录</div>
            </div>
          </div>
          <button class="btn-change" @click="selectedFile = null">更换视频</button>
        </div>

        <!-- 场景卡片单选 -->
        <div class="section-title">选择要增强的效果：</div>
        <div class="preset-grid">
          <div
            class="preset-card"
            :class="{ active: activePreset === 'anime' }"
            @click="activePreset = 'anime'"
          >
            <div class="preset-icon">🎌</div>
            <div class="preset-name">动漫番剧高清修复</div>
            <div class="preset-desc">针对二次元动画优化，增强线条锐利度并消除色块</div>
            <div class="preset-badge">动漫首选</div>
          </div>

          <div
            class="preset-card"
            :class="{ active: activePreset === 'real' }"
            @click="activePreset = 'real'"
          >
            <div class="preset-icon">🎬</div>
            <div class="preset-name">真人实拍细腻增强</div>
            <div class="preset-desc">针对日常拍摄/影视剧，修复面部与场景微弱纹理</div>
            <div class="preset-badge">实拍推荐</div>
          </div>

          <div
            class="preset-card"
            :class="{ active: activePreset === 'interpolate' }"
            @click="activePreset = 'interpolate'"
          >
            <div class="preset-icon">⚡</div>
            <div class="preset-name">动态丝滑补帧 (60FPS)</div>
            <div class="preset-desc">智能光流插帧消除运动顿挫，使动作场景如丝顺滑</div>
            <div class="preset-badge">流畅消除卡顿</div>
          </div>
        </div>

        <!-- 选项行（极简傻瓜式交互，分组自适应防挤压） -->
        <div class="settings-row">
          <!-- 左侧：基础倍率与防爆防护 -->
          <div class="settings-group settings-group-left">
            <div class="setting-item">
              <span class="label">目标倍率：</span>
              <div class="pill-group">
                <button
                  class="pill-btn"
                  :class="{ active: scaleFactor === 2 }"
                  @click="scaleFactor = 2"
                >
                  2x (1080P)
                </button>
                <button
                  class="pill-btn"
                  :class="{ active: scaleFactor === 4 }"
                  @click="scaleFactor = 4"
                >
                  4x (4K 极清)
                </button>
              </div>
            </div>

            <div class="setting-item">
              <label class="toggle-label" title="自动对画面进行分块并启用动态内存熔断保护，彻底避免内存与显存溢出">
                <input type="checkbox" v-model="vramGuard" />
                <span>防爆显存/防 OOM</span>
              </label>
            </div>
          </div>

          <!-- 右侧：全场景智能去水印 -->
          <div class="settings-group settings-group-right">
            <div class="setting-item watermark-item">
              <label class="toggle-label" title="智能全场景消除视频中的水印（支持 Sora、短视频平台角标、电视台标、底部字幕栏等）">
                <input type="checkbox" v-model="removeWatermark" />
                <span>全场景去水印</span>
              </label>
              <select v-if="removeWatermark" v-model="watermarkPosition" class="watermark-pos-select">
                <option value="bottom-right">右下角 (Sora / 剪映 / 微博)</option>
                <option value="top-right">右上角 (B站 / 录屏 / 台标)</option>
                <option value="bottom-left">左下角 (小红书 / 抖音)</option>
                <option value="top-left">左上角 (视频台标 / 徽标)</option>
                <option value="both-right">🔥 双角标 (右上 + 右下)</option>
                <option value="bottom-bar">📜 底部通栏 (字幕与广告栏)</option>
                <option value="top-bar">📰 顶部通栏 (跑马灯与标题)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- 硬件动态并发状态条（本地模式且引擎就绪时展示） -->
        <div v-if="engineMode === 'local' && isLocalReady && systemInfo.hardwareInfo" class="hardware-concurrency-bar">
          <span class="hw-icon">⚡</span>
          <span class="hw-text"><b>硬件动态并发：</b>{{ systemInfo.hardwareInfo.concurrencyTitle }}</span>
          <span class="hw-badge">{{ systemInfo.hardwareInfo.workerCount }} 进程 × {{ systemInfo.hardwareInfo.threadsPerWorker }} 线程</span>
        </div>

        <!-- 当前模式提示条 -->
        <div v-if="engineMode === 'cloud' && !isCloudReady" class="warning-banner" @click="showSettings = true">
          ⚠️ <b>云端 GPU 需鉴权</b>：AI 视频增强需要高显存算力，请先配置 Replicate Token（支持免费试用额度，点击立即填写）
        </div>

        <!-- 操作按钮组 -->
        <div class="action-footer">
          <button class="btn-secondary" @click="handleActionClick(true)">
            🔍 快速试看 3 秒片段
          </button>
          <button
            class="btn-primary"
            :class="{ 'btn-alert': !canStart }"
            @click="handleActionClick(false)"
          >
            {{ startButtonText }}
          </button>
        </div>
      </div>

      <!-- 3. 处理中状态 -->
      <div v-else-if="jobStatus === 'running'" class="processing-container">
        <div class="progress-box">
          <div class="circular-progress">
            <svg viewBox="0 0 100 100" class="progress-svg">
              <circle class="bg-circle" cx="50" cy="50" r="42" />
              <circle
                class="fg-circle"
                cx="50"
                cy="50"
                r="42"
                :stroke-dasharray="264"
                :stroke-dashoffset="264 - (264 * progressData.percent) / 100"
              />
            </svg>
            <div class="circle-inner">
              <span class="percent-val">{{ progressData.percent.toFixed(0) }}%</span>
              <span class="percent-label">处理进度</span>
            </div>
          </div>

          <div class="status-meta">
            <h3>{{ progressData.statusText }}</h3>
            <div class="metrics-grid">
              <div class="metric-item">
                <span class="m-label">运算引擎</span>
                <span class="m-val">{{ engineMode === 'cloud' ? 'Replicate A100' : (systemInfo.hardwareInfo?.workerCount && systemInfo.hardwareInfo.workerCount > 1 ? `${systemInfo.hardwareInfo.workerCount} 进程分块并发 GPU` : '本地 Vulkan GPU') }}</span>
              </div>
              <div class="metric-item">
                <span class="m-label">实时渲染速度</span>
                <span class="m-val">{{ progressData.fps > 0 ? `${progressData.fps} FPS` : (progressData.percent >= 90 ? '压制混音中' : '测速中...') }}</span>
              </div>
              <div class="metric-item">
                <span class="m-label">预计剩余时间</span>
                <span class="m-val">{{ formattedEta }}</span>
              </div>
            </div>

            <div class="process-controls">
              <button class="btn-cancel" @click="cancelCurrentJob">⏹ 中止任务</button>
              <button class="btn-link" @click="showLogs = !showLogs">
                {{ showLogs ? '折叠运行日志' : '展开实时终端日志' }}
              </button>
            </div>
          </div>
        </div>

        <!-- 实时日志 -->
        <div v-if="showLogs" class="log-console">
          <div class="log-header">Realtime Execution Stream</div>
          <div class="log-body">
            <div v-for="(line, idx) in logs" :key="idx" class="log-line">{{ line }}</div>
          </div>
        </div>
      </div>

      <!-- 4. 完成状态 -->
      <div v-else-if="jobStatus === 'completed'" class="completed-container">
        <div class="success-icon">🎉</div>
        <h2>视频增强完成！</h2>
        <p class="success-desc">AI 已完成真实渲染与画质重塑，高清视频已保存到本地。</p>

        <div class="output-preview-path" :title="lastOutputPath">
          📁 本地保存：{{ lastOutputPath }}
        </div>

        <div class="complete-actions">
          <button class="btn-primary" @click="playVideo">▶ 立即播放</button>
          <button class="btn-secondary" @click="openFolder">📂 打开所在文件夹</button>
          <button class="btn-ghost" @click="resetAll">↺ 处理下一个</button>
        </div>
      </div>

      <!-- 5. 错误拦截状态 (带智能自愈与降级挽救) -->
      <div v-else-if="jobStatus === 'error'" class="error-container">
        <div class="error-icon">⚠️</div>
        <h2>任务处理中断</h2>

        <!-- 针对云端余额不足 / Token 异常的专属智能救砖卡片 -->
        <div v-if="isCloudError" class="rescue-card">
          <div class="rescue-header">
            <span class="rescue-icon">💡</span>
            <h4>检测到云端额度问题，推荐使用【本地 GPU 离线增强】</h4>
          </div>
          <p class="rescue-desc">
            您的设备具备本地硬件算力加速能力，使用本地离线 GPU 处理完全<b>免费无限次</b>，无需充值购买云端额度，且视频数据 100% 隐私保密！
          </p>
          <div class="rescue-actions">
            <button class="btn-primary btn-rescue" @click="switchToLocalAndRetry">
              ⚡ 立即切换为本地 GPU 运行
            </button>
            <button class="btn-secondary" @click="openBillingUrl">
              💳 前往 Replicate 充值
            </button>
          </div>
        </div>

        <pre class="error-desc">{{ errorMessage }}</pre>

        <div class="complete-actions">
          <button class="btn-secondary" @click="jobStatus = 'idle'">返回重试</button>
          <button class="btn-primary" @click="showSettings = true">检查环境与配置</button>
        </div>
      </div>
    </main>

    <!-- 试看 3 秒对比弹窗 -->
    <div v-if="showCompareModal" class="modal-backdrop" @click.self="showCompareModal = false">
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>🔍 3 秒试看效果对比 (Before / After)</h3>
          <button class="btn-close" @click="showCompareModal = false">✕</button>
        </div>

        <div class="compare-viewer">
          <div class="compare-frame original-frame">
            <div class="frame-tag left">修复前 (原画质)</div>
            <div class="mock-content low-res">
              <div class="mock-character">原片采样低分辨率</div>
            </div>
          </div>

          <div
            class="compare-frame enhanced-frame"
            :style="{ clipPath: `polygon(${compareSliderPos}% 0, 100% 0, 100% 100%, ${compareSliderPos}% 100%)` }"
          >
            <div class="frame-tag right">修复后 (AI 增强)</div>
            <div class="mock-content high-res">
              <div class="mock-character">AI 增强超清细节</div>
            </div>
          </div>

          <div class="slider-handle" :style="{ left: `${compareSliderPos}%` }">
            <div class="handle-line"></div>
            <div class="handle-button">↔</div>
          </div>

          <input
            type="range"
            min="0"
            max="100"
            v-model="compareSliderPos"
            class="invisible-slider"
          />
        </div>

        <div class="modal-footer">
          <span>拖动中间滑块对比前后画质差异</span>
          <button class="btn-primary" @click="showCompareModal = false; handleActionClick(false)">
            满意，开始全片增强
          </button>
        </div>
      </div>
    </div>

    <!-- 设置与环境诊断弹窗 -->
    <div v-if="showSettings" class="modal-backdrop" @click.self="showSettings = false">
      <div class="modal-dialog settings-dialog">
        <div class="modal-header">
          <h3>⚙️ 引擎与算力配置</h3>
          <button class="btn-close" @click="showSettings = false">✕</button>
        </div>

        <div class="tabs-nav">
          <button
            class="tab-btn"
            :class="{ active: settingsTab === 'cloud' }"
            @click="settingsTab = 'cloud'"
          >
            ☁️ 云端 GPU 算力
          </button>
          <button
            class="tab-btn"
            :class="{ active: settingsTab === 'local' }"
            @click="settingsTab = 'local'"
          >
            💻 本地离线引擎
          </button>
        </div>

        <div class="settings-content">
          <!-- 云端配置 -->
          <div v-if="settingsTab === 'cloud'" class="tab-pane">
            <div class="form-group">
              <label>Replicate API Token：</label>
              <input
                type="password"
                class="form-input"
                v-model="cloudApiKey"
                placeholder="r8_xxxxxxxxxxxxxxxxxxxxxxxxx"
              />
              <div class="form-hint-box">
                <p>💡 <b>为什么需要 Token？</b></p>
                <p>视频超分与插帧极其消耗 GPU，单次任务需要 A100 显卡全速运转几分钟。接入业界标准的 Replicate，按使用秒计费，注册即送免费试用额度。</p>
                <button class="btn-copy-link" @click="copyReplicateUrl">📋 复制 Token 获取地址</button>
              </div>
            </div>
          </div>

          <!-- 本地配置 -->
          <div v-else class="tab-pane">
            <div class="form-group">
              <label>本地 AI 引擎路径：</label>
              <div class="input-with-button">
                <input
                  type="text"
                  class="form-input"
                  v-model="localEnginePath"
                  placeholder="自动安装或手动指定路径"
                />
              </div>

              <!-- 一键安装/重新安装区域（弹窗内直接显示实时进度，拒绝盲盒操作） -->
              <div class="local-install-box">
                <!-- 未开始安装 -->
                <div v-if="!isInstalling" class="local-install-header">
                  <div class="install-prompt-text">
                    <span>🤖 <b>一键自动部署：</b></span>
                    <span class="install-desc-sub">自动下载 ~25MB 官方轻量引擎，支持 GPU 加速</span>
                  </div>
                  <button
                    class="btn-install-secondary"
                    @click="handleInstallEngine"
                  >
                    {{ isLocalReady ? '🔄 重新安装/更新' : '⬇️ 一键自动下载并安装' }}
                  </button>
                </div>

                <!-- 正在安装：弹窗内直接就地展开完整进度条 -->
                <div v-else class="modal-installing-card">
                  <div class="install-info-row">
                    <span class="install-status-text">⏳ {{ installStatusText }}</span>
                    <span class="install-speed-tag" v-if="installProgress.speedText">{{ installProgress.speedText }}</span>
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill" :style="{ width: `${installProgress.percent}%` }"></div>
                  </div>
                  <div class="install-meta-row">
                    <span>{{ installProgress.downloadedFormatted }} / {{ installProgress.totalFormatted }}</span>
                    <span>{{ installProgress.percent }}%</span>
                  </div>
                </div>

                <!-- 成功或错误提示 -->
                <div v-if="installSuccessMessage" class="install-success-msg">
                  ✅ {{ installSuccessMessage }}
                </div>
                <div v-if="installError" class="install-error-hint">
                  ❌ 安装失败：{{ installError }}
                </div>

                <div class="install-dir-hint">
                  默认安装目录：<code>{{ systemInfo.defaultInstallDir || '~/.ztools-video-enhancer/engine' }}</code>
                </div>
              </div>

              <!-- ⚡ 硬件动态并发与全平台分级防 OOM 调优专区 -->
              <div class="perf-tuning-box">
                <div class="perf-title-row">
                  <span class="perf-title">⚡ 全平台硬件自适应与并发安全调优</span>
                  <span
                    class="perf-badge"
                    :class="{
                      'tier-high': systemInfo.hardwareInfo?.tierInfo?.tier && systemInfo.hardwareInfo.tierInfo.tier >= 2,
                      'tier-low': systemInfo.hardwareInfo?.tierInfo?.tier !== undefined && systemInfo.hardwareInfo.tierInfo.tier < 2
                    }"
                  >
                    {{ systemInfo.hardwareInfo?.tierInfo?.tierName || '自动硬件分级' }}
                  </span>
                </div>

                <!-- 真实设备硬件全景识别条 -->
                <div class="gpu-spec-row">
                  <div class="gpu-spec-item">
                    <span class="spec-k">🎮 显卡硬件：</span>
                    <span class="spec-v">{{ systemInfo.hardwareInfo?.gpuInfo?.gpuName || '检测中...' }}</span>
                  </div>
                  <div class="gpu-spec-item">
                    <span class="spec-k">显卡架构：</span>
                    <span class="spec-v tag-pill" :class="{ 'tag-ded': systemInfo.hardwareInfo?.gpuInfo?.isDedicated }">
                      {{ systemInfo.hardwareInfo?.gpuInfo?.isDedicated ? '独立显卡 / 统一高算力 GPU' : '核显 (轻薄便携本)' }}
                    </span>
                  </div>
                  <div class="gpu-spec-item">
                    <span class="spec-k">显存/统一内存：</span>
                    <span class="spec-v">{{ systemInfo.hardwareInfo?.gpuInfo?.vramGB ? `${systemInfo.hardwareInfo.gpuInfo.vramGB} GB` : `${systemInfo.totalMemGB} GB` }}</span>
                  </div>
                  <div class="gpu-spec-item">
                    <span class="spec-k">CPU 算力：</span>
                    <span class="spec-v">{{ systemInfo.hardwareInfo?.cpuCores || 4 }} 核心</span>
                  </div>
                </div>

                <!-- 1. 并发进程数 -->
                <div class="tuning-item">
                  <div class="tuning-label-row">
                    <span class="tuning-label">并发进程数量：</span>
                    <span class="tuning-desc">
                      (当前设备推荐并发: {{ systemInfo.hardwareInfo?.tierInfo?.recommendedWorkers || 1 }} 进程，硬件安全上限: {{ systemInfo.hardwareInfo?.tierInfo?.maxAllowedWorkers || 2 }} 进程)
                    </span>
                  </div>
                  <div class="pill-group tuning-pill-group">
                    <button
                      class="pill-btn"
                      :class="{ active: customWorkerCount === 'auto' }"
                      @click="customWorkerCount = 'auto'"
                      title="根据 CPU 核心数、独立显存和空闲内存自动匹配黄金并发点"
                    >
                      🤖 智能自适应 (推荐)
                    </button>
                    <button
                      class="pill-btn"
                      :class="{ active: customWorkerCount === 1 }"
                      @click="customWorkerCount = 1"
                      title="单进程低功耗运行，适合轻薄本或前台办公"
                    >
                      🍃 单进程 (轻薄核显)
                    </button>
                    <button
                      class="pill-btn"
                      :class="{ active: customWorkerCount === 2 }"
                      @click="customWorkerCount = 2"
                      title="2 个进程分块并发 (适合中端独显/主流 Mac)"
                    >
                      ⚡ 2 进程 (主流独显)
                    </button>
                    <button
                      class="pill-btn"
                      :class="{ active: customWorkerCount === 3 }"
                      @click="customWorkerCount = 3"
                      title="3 个进程分块并发 (适合 Apple Silicon / 10核+ 独显)"
                    >
                      🔥 3 进程 (极速)
                    </button>
                    <button
                      class="pill-btn"
                      :class="{ active: customWorkerCount === 4 }"
                      @click="customWorkerCount = 4"
                      title="4 个进程分块并发 (适合高端桌面工作站)"
                    >
                      🚀 4 进程 (狂暴)
                    </button>
                  </div>

                  <!-- 超限安全拦截提醒 -->
                  <div
                    v-if="typeof customWorkerCount === 'number' && systemInfo.hardwareInfo?.tierInfo && customWorkerCount > systemInfo.hardwareInfo.tierInfo.maxAllowedWorkers"
                    class="clamp-warning-box"
                  >
                    🛡️ <b>智能安全防护已生效：</b>检测到当前设备属于 [{{ systemInfo.hardwareInfo.tierInfo.tierName }}]，为杜绝显卡驱动崩溃或死机，系统在运行时会自动安全平滑限流至最高 <b>{{ systemInfo.hardwareInfo.tierInfo.maxAllowedWorkers }} 进程</b>。
                  </div>
                </div>

                <!-- 2. 模型算法模式 -->
                <div class="tuning-item">
                  <div class="tuning-label-row">
                    <span class="tuning-label">AI 神经网络质量策略：</span>
                  </div>
                  <div class="pill-group tuning-pill-group">
                    <button
                      class="pill-btn"
                      :class="{ active: speedMode === 'fast' }"
                      @click="speedMode = 'fast'"
                      title="时序视频专用网络，推理速度提升 4~8 倍，抗闪烁自然"
                    >
                      🚀 5x 极速视频加速 (默认推荐)
                    </button>
                    <button
                      class="pill-btn"
                      :class="{ active: speedMode === 'quality' }"
                      @click="speedMode = 'quality'"
                      title="全量高权重深度模型，精修单帧极致微纹理"
                    >
                      🎨 极清画质模式
                    </button>
                  </div>
                </div>

                <!-- 3. 防 OOM 内存熔断与低配提示卡片 -->
                <div class="oom-guard-card">
                  <div class="oom-guard-header">
                    <span class="oom-icon">🛡️</span>
                    <span class="oom-title">全设备防爆显存与防 OOM 守护机制</span>
                  </div>
                  <p class="oom-desc">
                    系统实时剩余空闲内存：<b>{{ systemInfo.hardwareInfo?.freeMemGB || '充裕' }} GB</b> · 
                    动态瓦片保护策略：<b>Tile {{ systemInfo.hardwareInfo?.tierInfo?.tileSize === '0' ? 'Auto (自动优化)' : `${systemInfo.hardwareInfo?.tierInfo?.tileSize} (小瓦片防爆)` }}</b>。<br />
                    无论是在 8GB 轻薄核显笔记本、4GB 独立显卡 PC，还是高性能 M 芯片上，系统均已自适应启用安全护栏，动态规避显存溢出与卡死。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-primary" @click="showSettings = false">
            {{ isInstalling ? `后台安装中 (${installProgress.percent}%)...` : '保存并关闭' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg-page);
  padding: 16px 24px;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-icon {
  font-size: 28px;
  width: 44px;
  height: 44px;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-sm);
}

.logo-text h1 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-main);
  line-height: 1.2;
}

.sub-desc {
  font-size: 12px;
  color: var(--text-muted);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.engine-switch {
  display: flex;
  background: var(--border-color);
  padding: 3px;
  border-radius: 20px;
}

.switch-btn {
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 16px;
  background: transparent;
  color: var(--text-muted);
}

.switch-btn.active {
  background: var(--bg-card);
  color: var(--primary);
  box-shadow: var(--shadow-sm);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 20px;
  cursor: pointer;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
}

.status-indicator .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-indicator.ready .dot {
  background: var(--success);
}
.status-indicator.ready .status-text {
  color: var(--success);
}

.status-indicator.warning .dot {
  background: #f59e0b;
}
.status-indicator.warning .status-text {
  color: #f59e0b;
}

.status-indicator.danger .dot {
  background: var(--danger);
}
.status-indicator.danger .status-text {
  color: var(--danger);
}

.icon-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover {
  background: var(--border-color);
}

/* 一键安装横幅 */
.install-banner-box {
  margin-top: 14px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.12));
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: var(--radius-md);
  padding: 14px 18px;
}

.banner-idle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.banner-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.banner-emoji {
  font-size: 28px;
}

.banner-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 2px;
}

.banner-desc {
  font-size: 12px;
  color: var(--text-muted);
}

.btn-install-quick {
  padding: 8px 18px;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  color: #fff;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  box-shadow: var(--shadow-sm);
}

.btn-install-quick:hover {
  opacity: 0.95;
  transform: translateY(-1px);
}

.banner-installing {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.install-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
}

.install-speed-tag {
  font-size: 11px;
  background: var(--primary);
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
}

.progress-track {
  width: 100%;
  height: 8px;
  background: rgba(0, 0, 0, 0.08);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), var(--accent));
  border-radius: 4px;
  transition: width 0.25s ease;
}

.install-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}

.install-error-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--danger);
}

/* 主内容 */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 20px 0;
}

.drop-zone {
  border: 2px dashed var(--border-color);
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 50px 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.25s ease;
  box-shadow: var(--shadow-sm);
}

.drop-zone:hover,
.drop-zone.drop-active {
  border-color: var(--primary);
  background: var(--primary-light);
  transform: translateY(-2px);
}

.drop-illustration {
  font-size: 54px;
  margin-bottom: 12px;
}

.drop-zone h2 {
  font-size: 20px;
  color: var(--text-main);
  margin-bottom: 8px;
}

.drop-hint {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 16px;
}

.engine-badge-tag {
  display: inline-block;
  font-size: 12px;
  padding: 8px 16px;
  border-radius: 8px;
  background: var(--bg-page);
  border: 1px solid var(--border-color);
  max-width: 600px;
  line-height: 1.6;
}

.win-tip {
  color: var(--success);
  font-weight: 600;
}

.danger-tip {
  color: var(--danger);
  font-weight: 600;
}

.mac-tip {
  color: var(--primary);
}

/* 工作流卡片 */
.workflow-container {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.file-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-card);
  padding: 14px 20px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
}

.file-info {
  display: flex;
  align-items: center;
  gap: 14px;
}

.file-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 8px;
  background: var(--primary);
  color: #fff;
  border-radius: 6px;
}

.file-title {
  font-size: 15px;
  font-weight: 600;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  font-size: 12px;
  color: var(--text-muted);
}

.btn-change {
  font-size: 13px;
  padding: 6px 12px;
  background: transparent;
  color: var(--primary);
  border: 1px solid var(--primary);
  border-radius: 6px;
}

.btn-change:hover {
  background: var(--primary-light);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-muted);
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.preset-card {
  background: var(--bg-card);
  border: 2px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 18px 16px;
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.preset-card:hover {
  border-color: var(--primary);
  transform: translateY(-2px);
}

.preset-card.active {
  border-color: var(--primary);
  background: var(--primary-light);
  box-shadow: var(--shadow-md);
}

.preset-icon {
  font-size: 34px;
  margin-bottom: 8px;
}

.preset-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-main);
  margin-bottom: 6px;
}

.preset-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.preset-badge {
  margin-top: 10px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--border-color);
  color: var(--text-muted);
}

.preset-card.active .preset-badge {
  background: var(--primary);
  color: #fff;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px 16px;
  background: var(--bg-card);
  padding: 12px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
}

.settings-group {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.settings-group-left {
  flex-shrink: 0;
}

.settings-group-right {
  margin-left: auto;
  flex-shrink: 0;
}

.setting-item {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  flex-shrink: 0;
}

.setting-item .label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.pill-group {
  display: flex;
  gap: 6px;
}

.pill-btn {
  padding: 5px 12px;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 500;
  background: var(--border-color);
  color: var(--text-main);
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s;
}

.pill-btn.active {
  background: var(--primary);
  color: #fff;
  font-weight: 600;
}

.toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-main);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}

.toggle-label input[type="checkbox"] {
  cursor: pointer;
  accent-color: var(--primary);
  margin: 0;
}

.toggle-label span {
  white-space: nowrap;
}

.watermark-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
}

.watermark-pos-select {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-page);
  color: var(--text-main);
  font-size: 12px;
  outline: none;
  cursor: pointer;
  max-width: 210px;
  white-space: nowrap;
  text-overflow: ellipsis;
  transition: border-color 0.2s;
}

.watermark-pos-select:focus {
  border-color: var(--primary);
}

.hardware-concurrency-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(16, 185, 129, 0.08));
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: var(--radius-md);
  font-size: 12px;
  gap: 10px;
}

.hw-icon {
  font-size: 16px;
}

.hw-text {
  flex: 1;
  color: var(--text-main);
}

.hw-badge {
  font-size: 11px;
  font-weight: 700;
  background: var(--primary);
  color: #fff;
  padding: 3px 8px;
  border-radius: 6px;
  white-space: nowrap;
}

.warning-banner {
  padding: 12px 16px;
  background: #fef3c7;
  color: #92400e;
  border-radius: var(--radius-md);
  font-size: 13px;
  cursor: pointer;
  border: 1px solid #fde68a;
}

.warning-banner:hover {
  opacity: 0.95;
}

.action-footer {
  display: flex;
  gap: 16px;
  margin-top: 4px;
}

.btn-primary {
  flex: 2;
  padding: 14px 24px;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  color: #fff;
  border-radius: var(--radius-md);
  font-size: 16px;
  font-weight: 700;
  box-shadow: var(--shadow-md);
}

.btn-primary.btn-alert {
  background: linear-gradient(135deg, #f59e0b, #d97706);
}

.btn-primary:hover {
  opacity: 0.95;
  transform: translateY(-1px);
}

.btn-secondary {
  flex: 1;
  padding: 14px 20px;
  background: var(--bg-card);
  color: var(--primary);
  border: 1px solid var(--primary);
  border-radius: var(--radius-md);
  font-size: 15px;
  font-weight: 600;
}

.btn-secondary:hover {
  background: var(--primary-light);
}

.btn-ghost {
  padding: 12px 20px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: 14px;
}

.btn-ghost:hover {
  background: var(--border-color);
}

/* 进度运行界面 */
.processing-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.progress-box {
  display: flex;
  align-items: center;
  gap: 40px;
  background: var(--bg-card);
  padding: 36px 40px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-md);
}

.circular-progress {
  position: relative;
  width: 140px;
  height: 140px;
}

.progress-svg {
  transform: rotate(-90deg);
  width: 100%;
  height: 100%;
}

.bg-circle {
  fill: none;
  stroke: var(--border-color);
  stroke-width: 8;
}

.fg-circle {
  fill: none;
  stroke: var(--primary);
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.3s ease;
}

.circle-inner {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.percent-val {
  font-size: 28px;
  font-weight: 800;
  color: var(--text-main);
}

.percent-label {
  font-size: 11px;
  color: var(--text-muted);
}

.status-meta {
  flex: 1;
}

.status-meta h3 {
  font-size: 18px;
  margin-bottom: 16px;
  color: var(--text-main);
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  background: var(--bg-page);
  padding: 10px 14px;
  border-radius: 8px;
}

.m-label {
  font-size: 11px;
  color: var(--text-muted);
}

.m-val {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-main);
  margin-top: 4px;
}

.process-controls {
  display: flex;
  align-items: center;
  gap: 16px;
}

.btn-cancel {
  padding: 8px 18px;
  background: #fee2e2;
  color: var(--danger);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
}

.btn-cancel:hover {
  background: #fecaca;
}

.btn-link {
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  text-decoration: underline;
}

.log-console {
  background: #0f172a;
  color: #38bdf8;
  border-radius: var(--radius-md);
  font-family: monospace;
  font-size: 12px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.log-header {
  padding: 8px 14px;
  background: #1e293b;
  color: #94a3b8;
  font-size: 11px;
  border-bottom: 1px solid #334155;
}

.log-body {
  padding: 12px 14px;
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.completed-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  background: var(--bg-card);
  padding: 50px 24px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-md);
}

.success-icon {
  font-size: 56px;
  margin-bottom: 16px;
}

.completed-container h2 {
  font-size: 22px;
  color: var(--text-main);
  margin-bottom: 8px;
}

.success-desc {
  font-size: 14px;
  color: var(--text-muted);
  margin-bottom: 20px;
}

.output-preview-path {
  font-size: 13px;
  color: var(--text-muted);
  background: var(--bg-page);
  padding: 8px 16px;
  border-radius: 6px;
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 30px;
}

.complete-actions {
  display: flex;
  gap: 16px;
  justify-content: center;
  flex-wrap: wrap;
}

.complete-actions button {
  flex: 0 0 auto !important;
  white-space: nowrap !important;
  min-width: 130px;
  padding: 12px 24px !important;
  font-size: 14px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  background-color: var(--bg-card) !important;
  padding: 40px 28px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-md);
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  box-sizing: border-box;
}

.error-icon {
  font-size: 52px;
  margin-bottom: 12px;
  line-height: 1;
}

.error-desc {
  font-size: 13px;
  color: var(--danger);
  margin-bottom: 24px;
  width: 100%;
  max-width: 650px;
  white-space: pre-wrap;
  word-break: break-all;
  text-align: left;
  background-color: var(--bg-page) !important;
  padding: 12px 18px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  font-family: inherit;
  box-sizing: border-box;
}

/* 智能救砖与降级切换卡片 (100% 实体不透明背景，杜绝任何透光透屏) */
.rescue-card {
  width: 100%;
  max-width: 650px;
  background-color: var(--bg-card) !important;
  border: 1.5px solid #818cf8;
  border-radius: var(--radius-md);
  padding: 18px 22px;
  margin: 12px 0 20px 0;
  text-align: left;
  box-sizing: border-box;
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.12);
}

.rescue-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.rescue-icon {
  font-size: 18px;
}

.rescue-header h4 {
  font-size: 14px;
  font-weight: 700;
  color: var(--primary);
  margin: 0;
}

.rescue-desc {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.6;
  margin: 0 0 16px 0;
}

.rescue-desc b {
  color: var(--text-main);
}

.rescue-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}

.rescue-actions button {
  flex: 0 0 auto !important;
  white-space: nowrap !important;
  padding: 10px 20px !important;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn-rescue {
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%) !important;
  color: #fff !important;
  font-weight: 700 !important;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
}

/* 试看对比弹窗 */
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
  z-index: 100;
  overflow-y: auto;
}

.modal-dialog {
  background: var(--bg-card);
  width: 90%;
  max-width: 680px;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
  font-size: 16px;
  color: var(--text-main);
}

.btn-close {
  background: transparent;
  font-size: 18px;
  color: var(--text-muted);
}

.compare-viewer {
  position: relative;
  width: 100%;
  height: 320px;
  background: #111;
  overflow: hidden;
}

.compare-frame {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.frame-tag {
  position: absolute;
  top: 14px;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 4px;
  color: #fff;
  z-index: 5;
}

.frame-tag.left {
  left: 14px;
  background: rgba(0, 0, 0, 0.6);
}

.frame-tag.right {
  right: 14px;
  background: rgba(99, 102, 241, 0.85);
}

.mock-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 18px;
  font-weight: 700;
}

.low-res {
  background: radial-gradient(circle, #334155 10%, #0f172a 90%);
  filter: blur(2.5px);
  color: #94a3b8;
}

.high-res {
  background: radial-gradient(circle, #4338ca 10%, #1e1b4b 90%);
  color: #38bdf8;
  text-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
}

.slider-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #fff;
  z-index: 10;
  pointer-events: none;
  transform: translateX(-50%);
}

.handle-line {
  width: 100%;
  height: 100%;
  background: #fff;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.5);
}

.handle-button {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 32px;
  height: 32px;
  background: #fff;
  color: #333;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}

.invisible-slider {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: ew-resize;
  z-index: 20;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--bg-page);
  border-top: 1px solid var(--border-color);
  font-size: 13px;
  color: var(--text-muted);
}

/* 设置对话框 */
.settings-dialog {
  max-width: 620px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}

.tabs-nav {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-page);
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 12px;
  font-size: 13px;
  font-weight: 600;
  background: transparent;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
}

.tab-btn.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  background: var(--bg-card);
}

.settings-content {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.settings-content::-webkit-scrollbar {
  width: 6px;
}

.settings-content::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.5);
  border-radius: 3px;
}

.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
}

.form-input {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-main);
  font-size: 13px;
}

.form-input:focus {
  border-color: var(--primary);
  outline: none;
}

.form-hint-box {
  background: var(--bg-page);
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
  border: 1px solid var(--border-color);
}

.local-install-box {
  margin-top: 10px;
  padding: 12px 14px;
  background: var(--bg-page);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.local-install-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.install-prompt-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.install-desc-sub {
  font-size: 11px;
  color: var(--text-muted);
}

.modal-installing-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-card);
  padding: 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.install-success-msg {
  font-size: 12px;
  font-weight: 600;
  color: var(--success);
  background: rgba(16, 185, 129, 0.1);
  padding: 6px 10px;
  border-radius: 6px;
}

.btn-install-secondary {
  padding: 8px 14px;
  background: var(--primary);
  color: #fff;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.btn-install-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.install-dir-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.btn-copy-link {
  margin-top: 8px;
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 12px;
  font-weight: 600;
}

.btn-copy-link:hover {
  background: var(--primary);
  color: #fff;
}

/* 硬件动态并发与防 OOM 调优样式 */
.perf-tuning-box {
  margin-top: 14px;
  padding: 14px 16px;
  background: var(--bg-page);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.perf-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.perf-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-main);
}

.perf-badge {
  font-size: 11px;
  background: rgba(99, 102, 241, 0.12);
  color: var(--primary);
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.perf-badge.tier-high {
  background: rgba(16, 185, 129, 0.15);
  color: #059669;
}

.perf-badge.tier-low {
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
}

.gpu-spec-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  background: var(--bg-card);
  padding: 10px 14px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.gpu-spec-item {
  display: flex;
  align-items: center;
  font-size: 11px;
  gap: 6px;
}

.spec-k {
  color: var(--text-muted);
}

.spec-v {
  font-weight: 600;
  color: var(--text-main);
}

.tag-pill {
  padding: 2px 6px;
  border-radius: 4px;
  background: #f1f5f9;
  font-size: 10px;
}

.tag-pill.tag-ded {
  background: rgba(99, 102, 241, 0.12);
  color: var(--primary);
}

.clamp-warning-box {
  margin-top: 6px;
  padding: 8px 12px;
  background: #fef3c7;
  color: #92400e;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.5;
  border: 1px solid #fde68a;
}

.tuning-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tuning-label-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.tuning-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-main);
}

.tuning-desc {
  font-size: 11px;
  color: var(--text-muted);
}

.tuning-pill-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.oom-guard-card {
  padding: 10px 12px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.25);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.oom-guard-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.oom-icon {
  font-size: 14px;
}

.oom-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--success);
}

.oom-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}
</style>
