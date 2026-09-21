<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

const bp = () => window.bingpaper

// ---------- 数据源 ----------
const source = ref<'latest' | 'history'>('latest')
// 中国区归档从 2024-04 开始
const ARCHIVE_START_YEAR = 2024
const years = Array.from(
  { length: new Date().getFullYear() - ARCHIVE_START_YEAR + 1 },
  (_, i) => new Date().getFullYear() - i
)
const year = ref(new Date().getFullYear())

const list = ref<BingImage[]>([])
const loading = ref(true)
const errorMsg = ref('')

// ---------- 分页 ----------
const page = ref(1)
const pageSize = 12
const pagedList = computed(() => list.value.slice((page.value - 1) * pageSize, page.value * pageSize))

async function load() {
  loading.value = true
  errorMsg.value = ''
  page.value = 1
  try {
    list.value = source.value === 'latest' ? await bp().fetchList() : await bp().fetchArchive(year.value)
  } catch (e: any) {
    errorMsg.value = e?.message || '壁纸列表加载失败'
  } finally {
    loading.value = false
  }
}

function switchSource() {
  load()
}

// ---------- 下载配置 ----------
const SETTING_KEY = 'bingpaper-settings'
const settings = ref<DownloadSettings>({ mode: 'ask', defaultDir: '' })
const settingsVisible = ref(false)

async function loadSettings() {
  const saved = window.ztools.dbStorage.getItem(SETTING_KEY) as DownloadSettings | null
  if (saved && saved.mode) {
    settings.value = { mode: saved.mode, defaultDir: saved.defaultDir || '' }
  }
  if (!settings.value.defaultDir) {
    settings.value.defaultDir = bp().defaultSaveDir()
  }
}

function openSettings() {
  settingsVisible.value = true
}

function chooseDir() {
  const dir = bp().pickDirectory('选择默认下载目录')
  if (dir) settings.value.defaultDir = dir
}

async function saveSettings() {
  if (settings.value.mode === 'default') {
    if (!settings.value.defaultDir) {
      ElMessage.error('请先选择默认下载目录')
      return
    }
    bp().ensureDir(settings.value.defaultDir)
  }
  // dbStorage 无法序列化 Vue Proxy，必须转纯对象
  window.ztools.dbStorage.setItem(SETTING_KEY, JSON.parse(JSON.stringify(settings.value)))
  settingsVisible.value = false
  ElMessage.success('设置已保存')
}

// ---------- 详情弹窗 ----------
const current = ref<BingImage | null>(null)
const dialogVisible = ref(false)
const downloading = ref(false)
const applying = ref(false)

const RESOLUTIONS = [
  { label: '1920 x 1080', value: '1920x1080' },
  { label: 'UHD 4K (3840 x 2160)', value: 'UHD' }
]

function openDetail(item: BingImage) {
  current.value = item
  dialogVisible.value = true
}

// ---------- 工具 ----------
function fmtDate(enddate: string): string {
  if (!enddate || enddate.length !== 8) return enddate
  return `${enddate.slice(0, 4)}-${enddate.slice(4, 6)}-${enddate.slice(6, 8)}`
}

function thumbUrl(item: BingImage): string {
  // 有 urlbase（官方接口或归档 bing_url 提取）→ Bing CDN 640x360 小图；
  // 否则兜底归档原尺寸直链
  return item.urlbase ? bp().imageUrl(item.urlbase, '640x360') : item.url
}

// ---------- 缩略图加载 ----------
// 渲染进程直连 Bing CDN 在部分环境会失败（QUIC/代理），统一由 preload 走 Node 下载并缓存后转 data URL
const thumbs = ref<Record<string, string>>({})
let thumbSeq = 0

function thumbKey(item: BingImage): string {
  return item.urlbase || item.enddate + item.title
}

function thumbSrc(item: BingImage): string {
  return thumbs.value[thumbKey(item)] || ''
}

async function loadThumbs() {
  const seq = ++thumbSeq
  for (const item of pagedList.value) {
    const key = thumbKey(item)
    if (thumbs.value[key]) continue
    const remote = thumbUrl(item)
    try {
      const dataUrl = await bp().thumbDataUrl(remote)
      if (seq !== thumbSeq) return // 翻页后丢弃过期结果
      thumbs.value[key] = dataUrl
    } catch {
      if (seq !== thumbSeq) return
      // Node 通道也失败时回退渲染进程直连
      thumbs.value[key] = remote
    }
  }
}

watch(pagedList, loadThumbs, { immediate: true })

function fullUrl(item: BingImage): string {
  // 预览用 1920x1080 CDN 图；无 urlbase 时兜底归档直链
  if (item.urlbase) return bp().imageUrl(item.urlbase, '1920x1080')
  return item.url.startsWith('http') ? item.url : `https://cn.bing.com${item.url}`
}

function titleOf(item: BingImage): string {
  return item.title || item.copyright || 'Bing 每日壁纸'
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith('\\') || dir.endsWith('/') ? dir + name : dir + '/' + name
}

// ---------- 下载 ----------
async function downloadImage(item: BingImage, resolution: string) {
  // 有 urlbase → Bing CDN 按分辨率下载；否则兜底归档直链
  const hasBase = !!item.urlbase
  const fileName = hasBase ? bp().buildFileName(item.enddate, resolution) : `Bing_${item.enddate}.jpg`
  const imgUrl = hasBase ? bp().imageUrl(item.urlbase, resolution) : item.url
  let savePath: string | null = null
  if (settings.value.mode === 'ask') {
    const picked = window.ztools.showSaveDialog({
      title: '保存壁纸',
      defaultPath: fileName,
      filters: [{ name: 'JPEG 图片', extensions: ['jpg'] }]
    })
    if (!picked) return
    savePath = picked
  } else {
    savePath = joinPath(bp().ensureDir(settings.value.defaultDir), fileName)
  }
  downloading.value = true
  try {
    await bp().download(imgUrl, savePath)
    ElMessage.success(`已保存：${savePath}`)
  } catch (e: any) {
    ElMessage.error(e?.message || '下载失败')
  } finally {
    downloading.value = false
  }
}

// ---------- 设为壁纸 ----------
async function setAsWallpaper(item: BingImage) {
  // 有 urlbase 固定用 UHD 4K；否则用归档直链原图。本地没有就先下载到默认目录
  const dir = bp().ensureDir(settings.value.defaultDir || bp().defaultSaveDir())
  const hasBase = !!item.urlbase
  const fileName = hasBase ? bp().buildFileName(item.enddate, 'UHD') : `Bing_${item.enddate}.jpg`
  const imgUrl = hasBase ? bp().imageUrl(item.urlbase, 'UHD') : item.url
  const localPath = joinPath(dir, fileName)
  applying.value = true
  try {
    await bp().download(imgUrl, localPath)
    await bp().setWallpaper(localPath)
    window.ztools.showNotification('已设为桌面壁纸')
    ElMessage.success('已设为桌面壁纸')
  } catch (e: any) {
    ElMessage.error(e?.message || '设置壁纸失败')
  } finally {
    applying.value = false
  }
}

onMounted(() => {
  loadSettings()
  load()
})
</script>

<template>
  <div class="page">
    <header class="header">
      <span class="title">Bing 每日壁纸</span>
      <div class="header-right">
        <el-radio-group v-model="source" size="small" @change="switchSource">
          <el-radio-button value="latest">最新</el-radio-button>
          <el-radio-button value="history">历史归档</el-radio-button>
        </el-radio-group>
        <el-select v-if="source === 'history'" v-model="year" size="small" class="year-select" @change="load">
          <el-option v-for="y in years" :key="y" :label="`${y} 年`" :value="y" />
        </el-select>
        <el-button text @click="openSettings">下载设置</el-button>
      </div>
    </header>

    <!-- 加载骨架 -->
    <div v-if="loading" class="grid">
      <div v-for="i in 8" :key="i" class="card">
        <el-skeleton animated>
          <template #template>
            <el-skeleton-item variant="image" style="width: 100%; height: 140px" />
            <div style="padding: 10px">
              <el-skeleton-item variant="text" style="width: 70%" />
            </div>
          </template>
        </el-skeleton>
      </div>
    </div>

    <!-- 错误 + 重试 -->
    <div v-else-if="errorMsg" class="error-box">
      <p>{{ errorMsg }}</p>
      <el-button type="primary" @click="load">重试</el-button>
    </div>

    <template v-else>
      <!-- 壁纸网格 -->
      <div class="grid">
        <div
          v-for="item in pagedList"
          :key="item.urlbase || item.enddate + item.title"
          class="card"
          @click="openDetail(item)"
        >
          <div class="thumb-wrap">
            <img v-if="thumbSrc(item)" class="thumb" :src="thumbSrc(item)" :alt="titleOf(item)" />
          </div>
          <div class="card-info">
            <div class="card-title" :title="titleOf(item)">{{ titleOf(item) }}</div>
            <div class="card-date">{{ fmtDate(item.enddate) }}</div>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="list.length"
          layout="prev, pager, next"
          hide-on-single-page
          background
        />
      </div>
    </template>

    <!-- 大图详情：宽度用百分比，避免超出 ZTools 窗口把关闭按钮挤出屏幕 -->
    <el-dialog
      v-model="dialogVisible"
      :title="current ? titleOf(current) : ''"
      width="90%"
      class="preview-dialog"
      destroy-on-close
    >
      <template v-if="current">
        <img class="preview" :src="fullUrl(current)" :alt="titleOf(current)" />
        <div class="copyright">{{ current.copyright }}</div>
        <p v-if="current.story" class="story">{{ current.story }}</p>
        <div class="actions">
          <!-- 无 urlbase 的归档兜底图只有单一尺寸，直接下载 -->
          <el-dropdown v-if="current.urlbase" @command="(r: string) => downloadImage(current!, r)">
            <el-button type="primary" :loading="downloading">
              下载 ▾
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="r in RESOLUTIONS" :key="r.value" :command="r.value">
                  {{ r.label }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button v-else type="primary" :loading="downloading" @click="downloadImage(current!, '')">
            下载
          </el-button>          <el-button type="success" :loading="applying" @click="setAsWallpaper(current!)">
            设为壁纸
          </el-button>
          <el-button @click="dialogVisible = false">关闭</el-button>
          <span class="mode-hint">
            {{ settings.mode === 'ask' ? '每次下载询问保存路径' : '保存到默认目录' }}
          </span>
        </div>
      </template>
    </el-dialog>

    <!-- 下载设置 -->
    <el-dialog v-model="settingsVisible" title="下载设置" width="460px">
      <el-radio-group v-model="settings.mode" class="mode-group">
        <el-radio value="ask">每次下载时选择保存路径</el-radio>
        <el-radio value="default">保存到默认目录</el-radio>
      </el-radio-group>
      <div v-if="settings.mode === 'default'" class="dir-row">
        <el-input v-model="settings.defaultDir" placeholder="默认下载目录" readonly />
        <el-button @click="chooseDir">选择目录</el-button>
      </div>
      <p class="setting-tip">「设为壁纸」最新壁纸使用 UHD 4K 原图，历史归档使用原尺寸直链，均缓存到默认目录。</p>
      <template #footer>
        <el-button @click="settingsVisible = false">取消</el-button>
        <el-button type="primary" @click="saveSettings">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  padding: 16px 20px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.title {
  font-size: 18px;
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.year-select {
  width: 110px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}

.card {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.card:hover {
  transform: translateY(-3px);
  box-shadow: var(--el-box-shadow-light);
}

.thumb-wrap {
  height: 140px;
  background: var(--el-fill-color-light);
}

.thumb {
  display: block;
  width: 100%;
  height: 140px;
  object-fit: cover;
}

.card-info {
  padding: 8px 10px 10px;
}

.card-title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-date {
  font-size: 12px;
  opacity: 0.55;
  margin-top: 3px;
}

.pager {
  display: flex;
  justify-content: center;
  margin-top: 18px;
}

.preview {
  display: block;
  width: 100%;
  max-height: 56vh;
  object-fit: contain;
  border-radius: 6px;
  background: #000;
}

.copyright {
  margin-top: 10px;
  font-size: 12px;
  opacity: 0.65;
}

.story {
  font-size: 13px;
  line-height: 1.7;
  opacity: 0.85;
  margin: 8px 0 0;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}

.mode-hint {
  font-size: 12px;
  opacity: 0.5;
}

.error-box {
  text-align: center;
  padding: 60px 0;
}

.dir-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.mode-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.setting-tip {
  font-size: 12px;
  opacity: 0.55;
  margin: 12px 0 0;
}
</style>
