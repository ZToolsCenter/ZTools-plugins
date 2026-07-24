<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useConfigStore, type ReaderConfig } from '../../stores/config'
import { useBookStore, type Book } from '../../stores/books'
import Toast from '../Bookshelf/Toast.vue'

const emit = defineEmits<{ close: [] }>()

const configStore = useConfigStore()
const cfg = computed(() => configStore.config)

const toastMessage = ref('')
const toastType = ref<'info' | 'success' | 'error'>('info')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  if (toastTimer) clearTimeout(toastTimer)
  toastMessage.value = msg
  toastType.value = type
  toastTimer = setTimeout(() => { toastMessage.value = '' }, 2500)
}

const activeTab = ref<'hushreader' | 'function' | 'other'>('hushreader')

const FONT_OPTIONS = [
  { label: '系统默认', value: 'system-ui, -apple-system, sans-serif' },
  { label: '衬线体', value: 'Georgia, "Times New Roman", serif' },
  { label: '思源黑体', value: '"Source Han Sans SC", sans-serif' },
  { label: '楷体', value: '"KaiTi", "楷体", serif' },
  { label: '仿宋', value: '"FangSong", "仿宋", serif' },
]

const isAddingFont = ref(false)
const newFontInput = ref('')
const fontBeforeAdd = ref('')

const allFontOptions = computed(() => {
  const customFonts = cfg.value.other.customFonts || []
  const customOptions = customFonts.map(f => ({ label: f, value: f }))
  return [...FONT_OPTIONS, ...customOptions]
})

function startAddFont() {
  fontBeforeAdd.value = cfg.value.hushreader.fontFamily
  isAddingFont.value = true
  newFontInput.value = ''
}

function confirmAddFont() {
  const fontName = newFontInput.value.trim()
  if (!fontName) {
    isAddingFont.value = false
    cfg.value.hushreader.fontFamily = fontBeforeAdd.value
    return
  }
  if (!cfg.value.other.customFonts) {
    cfg.value.other.customFonts = []
  }
  if (!cfg.value.other.customFonts.includes(fontName)) {
    cfg.value.other.customFonts.push(fontName)
  }
  cfg.value.hushreader.fontFamily = fontName
  isAddingFont.value = false
  newFontInput.value = ''
}

function cancelAddFont() {
  isAddingFont.value = false
  cfg.value.hushreader.fontFamily = fontBeforeAdd.value
  newFontInput.value = ''
}

function removeCustomFont(fontName: string) {
  if (cfg.value.other.customFonts) {
    cfg.value.other.customFonts = cfg.value.other.customFonts.filter(f => f !== fontName)
  }
  if (cfg.value.hushreader.fontFamily === fontName) {
    cfg.value.hushreader.fontFamily = FONT_OPTIONS[0].value
  }
}

const bookStore = useBookStore()

const isExportingConfig = ref(false)
const isImportingConfig = ref(false)
const isExportingBooks = ref(false)
const isImportingBooks = ref(false)
const isAddingConfig = ref(false)
const newConfigName = ref('')
const renamingConfigIndex = ref(-1)
const renameInput = ref('')

async function exportConfig() {
  isExportingConfig.value = true
  try {
    const configData = JSON.parse(JSON.stringify(configStore.config))
    const exportObj = {
      _hushreaderConfigBackup: true,
      version: 1,
      exportedAt: new Date().toISOString(),
      config: configData
    }
    const json = JSON.stringify(exportObj, null, 2)
    const ztools = (window as any).ztools
    if (ztools?.showSaveDialog) {
      const filePath = ztools.showSaveDialog({
        title: '导出 HushReader 配置',
        defaultPath: `hushreader-config-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (filePath) {
        window.services.writeFileToPath(filePath, json)
      }
    } else {
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `hushreader-config-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    }
    showToast('配置导出成功', 'success')
  } catch (e) {
    console.warn('Export config failed', e)
    showToast('配置导出失败', 'error')
  } finally {
    isExportingConfig.value = false
  }
}

async function importConfig() {
  isImportingConfig.value = true
  try {
    const ztools = (window as any).ztools
    let json = ''
    if (ztools?.showOpenDialog) {
      const filePaths = ztools.showOpenDialog({
        title: '导入 HushReader 配置',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (!filePaths || !filePaths.length) {
        isImportingConfig.value = false
        return
      }
      json = window.services.readFileFromPath(filePaths[0])
    } else {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      const file = await new Promise<File | null>(resolve => {
        input.onchange = () => resolve(input.files?.[0] ?? null)
        input.click()
      })
      if (!file) {
        isImportingConfig.value = false
        return
      }
      json = await file.text()
    }
    if (!json) {
      isImportingConfig.value = false
      return
    }
    const data = JSON.parse(json)
    if (!data._hushreaderConfigBackup) {
      showToast('无效的 HushReader 配置备份文件', 'error')
      isImportingConfig.value = false
      return
    }
    if (data.config) {
      const configName = data.config.other?.configName || `导入配置 ${configStore.configList.length + 1}`
      configStore.addConfig(configName)
      configStore.config = deepMerge(JSON.parse(JSON.stringify(configStore.DEFAULT_CONFIG)), data.config)
      configStore.config.other.configName = configName
      configStore.save()
      showToast(`配置「${configName}」导入成功`, 'success')
    } else {
      showToast('备份文件中未找到配置数据', 'error')
    }
  } catch (e) {
    console.warn('Import config failed', e)
    showToast('配置导入失败', 'error')
  } finally {
    isImportingConfig.value = false
  }
}

async function exportBooks() {
  isExportingBooks.value = true
  try {
    const booksData = bookStore.books.map(b => {
      const { coverImage, customCoverImage, ...rest } = b
      return rest
    })
    const exportObj = {
      _hushreaderBooksBackup: true,
      version: 1,
      exportedAt: new Date().toISOString(),
      books: booksData
    }
    const json = JSON.stringify(exportObj, null, 2)
    const ztools = (window as any).ztools
    if (ztools?.showSaveDialog) {
      const filePath = ztools.showSaveDialog({
        title: '导出 HushReader 书籍',
        defaultPath: `hushreader-books-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (filePath) {
        window.services.writeFileToPath(filePath, json)
      }
    } else {
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `hushreader-books-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    }
    showToast(`成功导出 ${booksData.length} 本书`, 'success')
  } catch (e) {
    console.warn('Export books failed', e)
    showToast('书籍导出失败', 'error')
  } finally {
    isExportingBooks.value = false
  }
}

async function importBooks() {
  isImportingBooks.value = true
  try {
    const ztools = (window as any).ztools
    let json = ''
    if (ztools?.showOpenDialog) {
      const filePaths = ztools.showOpenDialog({
        title: '导入 HushReader 书籍',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (!filePaths || !filePaths.length) {
        isImportingBooks.value = false
        return
      }
      json = window.services.readFileFromPath(filePaths[0])
    } else {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      const file = await new Promise<File | null>(resolve => {
        input.onchange = () => resolve(input.files?.[0] ?? null)
        input.click()
      })
      if (!file) {
        isImportingBooks.value = false
        return
      }
      json = await file.text()
    }
    if (!json) {
      isImportingBooks.value = false
      return
    }
    const data = JSON.parse(json)
    if (!data._hushreaderBooksBackup) {
      showToast('无效的 HushReader 书籍备份文件', 'error')
      isImportingBooks.value = false
      return
    }
    if (Array.isArray(data.books)) {
      let added = 0
      let skipped = 0
      const newBooks: Book[] = []
      for (const book of data.books) {
        const filePathName = book.filePath.split(/[\\/]/).pop() ?? book.filePath
        const isDuplicate = bookStore.books.some(b => {
          if (b.filePath === book.filePath) return true
          const existingName = b.filePath.split(/[\\/]/).pop() ?? b.filePath
          return existingName === filePathName
        }) || newBooks.some(b => {
          if (b.filePath === book.filePath) return true
          const existingName = b.filePath.split(/[\\/]/).pop() ?? b.filePath
          return existingName === filePathName
        })

        if (isDuplicate) {
          skipped++
          continue
        }

        const now = Date.now()
        newBooks.push({
          ...book,
          id: `book_${now}_${Math.random().toString(36).slice(2)}`,
          addedAt: now,
          updatedAt: now
        })
        added++
      }
      if (newBooks.length > 0) {
        bookStore.books.unshift(...newBooks)
        bookStore.save()
      }
      if (added > 0) {
        const msg = skipped > 0
          ? `成功导入 ${added} 本书，跳过 ${skipped} 本重复`
          : `成功导入 ${added} 本书`
        showToast(msg, 'success')
      } else {
        showToast(skipped > 0 ? `所有 ${skipped} 本书均已存在，无新增` : '备份文件中未找到书籍数据', 'info')
      }
    } else {
      showToast('备份文件中未找到书籍数据', 'error')
    }
  } catch (e) {
    console.warn('Import books failed', e)
    showToast('书籍导入失败', 'error')
  } finally {
    isImportingBooks.value = false
  }
}

function deepMerge(target: any, source: any): any {
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor') continue
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {}
      deepMerge(target[key], source[key])
    } else {
      target[key] = source[key]
    }
  }
  return target
}

function startAddConfig() {
  isAddingConfig.value = true
  newConfigName.value = ''
}

function confirmAddConfig() {
  const name = newConfigName.value.trim()
  if (!name) {
    isAddingConfig.value = false
    return
  }
  configStore.addConfig(name)
  isAddingConfig.value = false
  newConfigName.value = ''
}

function cancelAddConfig() {
  isAddingConfig.value = false
  newConfigName.value = ''
}

function startRenameConfig(index: number) {
  renamingConfigIndex.value = index
  renameInput.value = configStore.configList[index]?.name || ''
}

function confirmRenameConfig() {
  const name = renameInput.value.trim()
  if (name && renamingConfigIndex.value >= 0) {
    configStore.renameConfig(renamingConfigIndex.value, name)
  }
  renamingConfigIndex.value = -1
  renameInput.value = ''
}

function cancelRenameConfig() {
  renamingConfigIndex.value = -1
  renameInput.value = ''
}

let originalConfig: ReaderConfig | null = null

function save() {
  configStore.save()
  emit('close')
}

function cancel() {
  if (originalConfig) {
    configStore.config = JSON.parse(JSON.stringify(originalConfig))
  }
  emit('close')
}

function resetDefault() {
  showResetConfirm.value = true
}

function confirmReset() {
  configStore.resetToDefault()
  showResetConfirm.value = false
}

const showResetConfirm = ref(false)

watch(() => configStore.config, () => {
  if (!originalConfig) {
    originalConfig = JSON.parse(JSON.stringify(configStore.config))
  }
}, { immediate: true })

watch(() => cfg.value.hushreader.fontFamily, (newVal) => {
  if (newVal === '__add__') {
    startAddFont()
  }
})

// Key binding capture
function getKeyBinding(e: KeyboardEvent): string | null {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  const key = e.key.toLowerCase()
  if (!['control', 'meta', 'alt', 'shift'].includes(key)) {
    parts.push(key === ' ' ? 'space' : key)
  }
  return parts.length > 0 ? parts.join('+') : null
}

// Multi-key binding helpers for function tab
function addKey(arr: string[], key: string) {
  if (!arr.includes(key)) arr.push(key)
}
function removeKey(arr: string[], idx: number) {
  arr.splice(idx, 1)
}

const capturingFor = ref<string | null>(null)
const capturedKey = ref('')

function startCapture(field: string) {
  capturingFor.value = field
  capturedKey.value = ''
}

function onKeyCapture(e: KeyboardEvent, field: string) {
  e.preventDefault()
  const b = getKeyBinding(e)
  if (!b) return
  capturedKey.value = b
}

function commitCapture(targetArr: string[]) {
  if (capturedKey.value && !targetArr.includes(capturedKey.value)) {
    targetArr.push(capturedKey.value)
  }
  capturingFor.value = null
  capturedKey.value = ''
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="settings-box">
      <!-- Header -->
      <div class="settings-header">
        <h2 class="settings-title">插件设置</h2>
        <div class="config-switcher">
          <select :value="configStore.activeConfigIndex"
            @change="(e: Event) => configStore.switchConfig(Number((e.target as HTMLSelectElement).value))"
            class="config-select" title="切换配置">
            <option v-for="(c, i) in configStore.configList" :key="i" :value="i">{{ c.name }}</option>
          </select>
          <button class="config-action-btn" @click="startAddConfig" title="添加配置">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button class="config-action-btn" @click="startRenameConfig(configStore.activeConfigIndex)" title="重命名配置">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
          <button class="config-action-btn" :disabled="configStore.configList.length <= 1"
            @click="configStore.removeConfig(configStore.activeConfigIndex)" title="删除配置">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <button class="close-btn" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- Config rename/add inline bar -->
      <div v-if="isAddingConfig || renamingConfigIndex >= 0" class="config-inline-bar">
        <template v-if="isAddingConfig">
          <input v-model="newConfigName" class="config-inline-input" placeholder="新配置名称..."
            @keyup.enter="confirmAddConfig" @keyup.esc="cancelAddConfig" />
          <button class="btn-primary" @click="confirmAddConfig" style="padding: 3px 10px; font-size: 12px">确定</button>
          <button class="btn-secondary" @click="cancelAddConfig" style="padding: 3px 10px; font-size: 12px">取消</button>
        </template>
        <template v-else-if="renamingConfigIndex >= 0">
          <input v-model="renameInput" class="config-inline-input" placeholder="输入新名称..."
            @keyup.enter="confirmRenameConfig" @keyup.esc="cancelRenameConfig" />
          <button class="btn-primary" @click="confirmRenameConfig"
            style="padding: 3px 10px; font-size: 12px">确定</button>
          <button class="btn-secondary" @click="cancelRenameConfig"
            style="padding: 3px 10px; font-size: 12px">取消</button>
        </template>
      </div>

      <!-- Tabs -->
      <div class="tab-bar">
        <button class="tab-btn" :class="{ active: activeTab === 'hushreader' }"
          @click="activeTab = 'hushreader'">隐阅窗口</button>
        <button class="tab-btn" :class="{ active: activeTab === 'function' }"
          @click="activeTab = 'function'">功能设置</button>
        <button class="tab-btn" :class="{ active: activeTab === 'other' }" @click="activeTab = 'other'">其他设置</button>
      </div>

      <!-- Body -->
      <div class="settings-body">

        <!-- ===== 隐阅窗口 ===== -->
        <div v-if="activeTab === 'hushreader'" class="settings-grid">

          <div class="section-label">字体</div>

          <div class="setting-row">
            <label>字体</label>
            <div class="input-group">
              <select v-if="!isAddingFont" v-model="cfg.hushreader.fontFamily" class="select" style="flex: 1">
                <option v-for="f in allFontOptions" :key="f.value" :value="f.value">{{ f.label }}</option>
                <option value="__add__">+ 添加自定义字体</option>
              </select>
              <input v-else v-model="newFontInput" class="text-input" placeholder="输入字体名称..."
                @keyup.enter="confirmAddFont" @keyup.esc="cancelAddFont" style="flex: 1" />
              <button v-if="isAddingFont" class="btn-primary" @click="confirmAddFont"
                style="padding: 4px 10px">确定</button>
              <button v-if="isAddingFont" class="btn-secondary" @click="cancelAddFont"
                style="padding: 4px 10px">取消</button>
            </div>
          </div>

          <div class="setting-row">
            <label>字体大小</label>
            <div class="input-group">
              <input type="range" min="12" max="36" v-model.number="cfg.hushreader.fontSize" class="slider" />
              <span class="badge">{{ cfg.hushreader.fontSize }}px</span>
            </div>
          </div>

          <div class="setting-row">
            <label>行间距</label>
            <div class="input-group">
              <input type="range" min="1.2" max="3" step="0.1" v-model.number="cfg.hushreader.lineHeight"
                class="slider" />
              <span class="badge">{{ cfg.hushreader.lineHeight.toFixed(1) }}</span>
            </div>
          </div>

          <div class="setting-row">
            <label>字间距</label>
            <div class="input-group">
              <input type="range" min="0" max="8" step="0.5" v-model.number="cfg.hushreader.letterSpacing"
                class="slider" />
              <span class="badge">{{ cfg.hushreader.letterSpacing }}px</span>
            </div>
          </div>

          <div class="divider"></div>
          <div class="section-label">窗口</div>

          <div class="setting-row">
            <label>窗口宽度</label>
            <div class="input-group">
              <input type="range" min="280" max="1180" v-model.number="cfg.hushreader.hushreaderWidth" class="slider" />
              <span class="badge">{{ cfg.hushreader.hushreaderWidth }}px</span>
            </div>
          </div>

          <div class="setting-row">
            <label>窗口高度</label>
            <div class="input-group">
              <input type="range" min="22" max="500" v-model.number="cfg.hushreader.hushreaderHeight" class="slider" />
              <span class="badge">{{ cfg.hushreader.hushreaderHeight }}px</span>
            </div>
          </div>

          <div class="setting-row">
            <label>透明度</label>
            <div class="input-group">
              <input type="range" min="10" max="100" v-model.number="cfg.hushreader.opacity" class="slider" />
              <span class="badge">{{ cfg.hushreader.opacity }}%</span>
            </div>
          </div>

          <div class="setting-row">
            <label>背景透明度</label>
            <div class="input-group">
              <input type="range" min="0" max="100" v-model.number="cfg.hushreader.bgOpacity" class="slider" />
              <span class="badge">{{ cfg.hushreader.bgOpacity }}%</span>
            </div>
          </div>

          <div class="divider"></div>
          <div class="section-label">颜色</div>

          <div class="setting-row">
            <label>背景颜色</label>
            <div class="input-group">
              <input type="color" v-model="cfg.hushreader.bgColor" class="color-picker" />
              <input type="text" v-model="cfg.hushreader.bgColor" class="color-input" placeholder="#16191c"
                pattern="^#[0-9A-Fa-f]{6}$" />
            </div>
          </div>

          <div class="setting-row">
            <label>文字颜色</label>
            <div class="input-group">
              <input type="color" v-model="cfg.hushreader.textColor" class="color-picker" />
              <input type="text" v-model="cfg.hushreader.textColor" class="color-input" placeholder="#cccccc"
                pattern="^#[0-9A-Fa-f]{6}$" />
            </div>
          </div>

          <div class="divider"></div>
          <div class="section-label">显示</div>

          <div class="setting-row">
            <label>显示进度信息</label>
            <label class="toggle">
              <input type="checkbox" v-model="cfg.hushreader.showHushreaderMeta" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div class="setting-row" v-if="cfg.hushreader.showHushreaderMeta">
            <label>进度显示方式</label>
            <select v-model="cfg.hushreader.progressMode" class="select">
              <option value="chapter">章节进度 (3/20)</option>
              <option value="percent">阅读百分比 (45%)</option>
            </select>
          </div>
        </div>

        <!-- ===== 功能设置 ===== -->
        <div v-if="activeTab === 'function'" class="settings-grid">

          <div class="section-label">翻页控制</div>

          <div class="setting-row">
            <label>鼠标移出隐藏</label>
            <select v-model="cfg.hushreader.hideOnMouseLeave" class="select">
              <option value="off">不隐藏</option>
              <option value="show-progress">快速隐藏但显示进度</option>
              <option value="hide-all">快速隐藏且不显示进度</option>
            </select>
          </div>

          <div class="setting-row" v-if="cfg.hushreader.hideOnMouseLeave !== 'off'">
            <label>移入显示延迟</label>
            <div class="input-group">
              <input type="number" min="0" max="10" step="0.1" v-model.number="cfg.hushreader.mouseEnterDelay"
                class="number-input" />
              <span class="unit">秒</span>
            </div>
          </div>

          <div class="setting-row">
            <label>滚轮翻页</label>
            <label class="toggle">
              <input type="checkbox" v-model="cfg.hushreader.wheelTurnPage" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div class="setting-row">
            <label>上一页快捷键</label>
            <div class="input-group">
              <input class="key-input" :value="cfg.hushreader.prevPageKey"
                @keydown.prevent="(e: KeyboardEvent) => { const b = getKeyBinding(e); if (b) cfg.hushreader.prevPageKey = b }"
                placeholder="按下按键..." readonly />
            </div>
          </div>

          <div class="setting-row">
            <label>下一页快捷键</label>
            <div class="input-group">
              <input class="key-input" :value="cfg.hushreader.nextPageKey"
                @keydown.prevent="(e: KeyboardEvent) => { const b = getKeyBinding(e); if (b) cfg.hushreader.nextPageKey = b }"
                placeholder="按下按键..." readonly />
            </div>
          </div>

          <div class="setting-row">
            <label>添加书签快捷键</label>
            <div class="input-group">
              <input class="key-input" :value="cfg.hushreader.addBookmarkKey"
                @keydown.prevent="(e: KeyboardEvent) => { const b = getKeyBinding(e); if (b) cfg.hushreader.addBookmarkKey = b }"
                placeholder="按下按键..." readonly />
            </div>
          </div>

          <div class="setting-row">
            <label>销毁隐阅窗口快捷键</label>
            <div class="input-group">
              <input class="key-input" :value="cfg.hushreader.destroyKey"
                @keydown.prevent="(e: KeyboardEvent) => { const b = getKeyBinding(e); if (b) cfg.hushreader.destroyKey = b }"
                placeholder="按下按键..." readonly />
            </div>
          </div>

          <div class="divider"></div>
          <div class="section-label">自动翻页</div>

          <div class="setting-row">
            <label>自动翻页</label>
            <label class="toggle">
              <input type="checkbox" v-model="cfg.hushreader.autoFlipEnabled" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div class="setting-row" v-if="cfg.hushreader.autoFlipEnabled">
            <label>翻页间隔</label>
            <div class="input-group">
              <input type="number" min="1000" max="60000" step="500" v-model.number="cfg.hushreader.autoFlipInterval"
                class="number-input" />
              <span class="unit">ms</span>
            </div>
          </div>

          <div class="setting-row" v-if="cfg.hushreader.autoFlipEnabled">
            <label>连续翻页</label>
            <label class="toggle">
              <input type="checkbox" v-model="cfg.hushreader.continuousFlip" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div class="divider"></div>
          <div class="section-label">阅读功能</div>

          <div class="setting-row">
            <label>窗口可拖动</label>
            <label class="toggle">
              <input type="checkbox" v-model="cfg.function.windowMovable" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div class="setting-row">
            <label>窗口大小锁定</label>
            <label class="toggle">
              <input type="checkbox" v-model="cfg.function.windowSizeLocked" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div class="divider"></div>
          <div class="section-label">阅读定时器</div>

          <div class="setting-row">
            <label>启用定时器</label>
            <label class="toggle">
              <input type="checkbox" v-model="cfg.other.timerEnabled" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div class="setting-row" v-if="cfg.other.timerEnabled">
            <label>定时时长</label>
            <div class="input-group">
              <input type="number" min="1" max="180" step="1" v-model.number="cfg.other.timerMinutes"
                class="number-input" />
              <span class="unit">分钟</span>
            </div>
          </div>
        </div>

        <!-- ===== 其他设置 ===== -->
        <div v-if="activeTab === 'other'" class="settings-grid">

          <div class="section-label">书架</div>

          <div class="setting-row">
            <label>显示纯色封面</label>
            <label class="toggle">
              <input type="checkbox" v-model="cfg.other.plainTextCover" />
              <span class="toggle-track"></span>
            </label>
          </div>
          <p v-if="!cfg.other.plainTextCover" class="hint" style="margin: -2px 0 6px; padding-left: 0">
            关闭时书籍将解析封面图片，可能消耗较多资源
          </p>
          <p v-else class="hint" style="margin: -2px 0 6px; padding-left: 0">所有书籍使用纯色背景封面，不解析封面图片</p>

          <div class="divider"></div>
          <div class="section-label">解析</div>

          <div class="setting-row" style="align-items: flex-start; flex-direction: column; gap: 6px;">
            <label>TXT 章节识别正则 <span class="tip-icon" tabindex="0">ⓘ<span
                  class="tip-bubble">默认规则：匹配以"第"开头，后跟中文数字（零一二三…）或阿拉伯数字，再跟"章/节/卷/集/部"的行，如"第三章 大战"、第12卷
                  等</span></span></label>
            <input v-model="cfg.other.chapterRegex" class="text-input full-width" placeholder="留空使用默认规则（第X章...）" />
            <p class="hint" style="margin:0">支持标准 JavaScript 正则语法，EPUB/MOBI 使用内置章节标识</p>
          </div>

          <div class="divider"></div>
          <div class="section-label">自定义字体</div>

          <div v-if="cfg.other.customFonts && cfg.other.customFonts.length > 0" class="setting-row"
            style="align-items: flex-start; flex-direction: column; gap: 6px;">
            <label>已添加的字体</label>
            <div class="custom-fonts-list">
              <div v-for="font in cfg.other.customFonts" :key="font" class="custom-font-item">
                <span class="custom-font-name">{{ font }}</span>
                <button class="btn-ghost" @click="removeCustomFont(font)"
                  style="padding: 2px 8px; font-size: 12px">删除</button>
              </div>
            </div>
          </div>
          <div v-else class="setting-row">
            <label>已添加的字体</label>
            <span class="badge" style="font-size: 12px">暂无自定义字体</span>
          </div>

          <div class="divider"></div>
          <div class="section-label">备份与恢复</div>

          <div class="setting-row">
            <label>导出配置</label>
            <button class="btn-secondary" :disabled="isExportingConfig" @click="exportConfig"
              style="padding: 5px 14px; font-size: 12px">
              {{ isExportingConfig ? '导出中...' : '导出配置' }}
            </button>
          </div>
          <p class="hint" style="margin: -2px 0 6px; padding-left: 0">将当前插件设置导出为 JSON 文件</p>

          <div class="setting-row">
            <label>导入配置</label>
            <button class="btn-secondary" :disabled="isImportingConfig" @click="importConfig"
              style="padding: 5px 14px; font-size: 12px">
              {{ isImportingConfig ? '导入中...' : '导入配置' }}
            </button>
          </div>
          <p class="hint" style="margin: -2px 0 6px; padding-left: 0">从备份文件导入配置，将新增为独立配置项</p>

          <div class="divider"></div>

          <div class="setting-row">
            <label>导出书籍</label>
            <button class="btn-secondary" :disabled="isExportingBooks" @click="exportBooks"
              style="padding: 5px 14px; font-size: 12px">
              {{ isExportingBooks ? '导出中...' : '导出书籍' }}
            </button>
          </div>
          <p class="hint" style="margin: -2px 0 6px; padding-left: 0">将书架书籍信息导出为 JSON 文件（不含封面图片）</p>

          <div class="setting-row">
            <label>导入书籍</label>
            <button class="btn-secondary" :disabled="isImportingBooks" @click="importBooks"
              style="padding: 5px 14px; font-size: 12px">
              {{ isImportingBooks ? '导入中...' : '导入书籍' }}
            </button>
          </div>
          <p class="hint" style="margin: -2px 0 6px; padding-left: 0">从备份文件导入书籍到书架，自动跳过路径重复的书籍</p>

        </div>
      </div>

      <!-- Footer -->
      <div class="settings-footer">
        <button class="btn-ghost" @click="resetDefault">恢复默认设置</button>
        <div style="flex: 1"></div>
        <button class="btn-secondary" @click="cancel">取消</button>
        <button class="btn-primary" @click="save">保存</button>
      </div>
    </div>

    <!-- Reset confirm -->
    <div v-if="showResetConfirm" class="confirm-overlay" @click.self="showResetConfirm = false">
      <div class="confirm-box">
        <p>确定恢复所有默认设置吗？此操作不可撤销。</p>
        <div class="confirm-actions">
          <button class="btn-secondary" @click="showResetConfirm = false">取消</button>
          <button class="btn-danger" @click="confirmReset">恢复默认</button>
        </div>
      </div>
    </div>

    <Toast :message="toastMessage" :type="toastType" />
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--c-overlay-bg);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 8000;
  animation: fade-in 0.15s var(--ease-out);
}

.settings-box {
  background: var(--c-surface-overlay);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-xl);
  width: 520px;
  max-width: 96vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-xl);
  animation: slide-up 0.2s var(--ease-out);
}

.settings-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 22px 16px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}

.settings-title {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  flex-shrink: 0;
}

.config-switcher {
  display: flex;
  align-items: center;
  gap: 4px;
}

.config-select {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  max-width: 120px;
  transition: border-color 0.15s var(--ease-out);
}

.config-select:focus {
  border-color: var(--c-accent);
  outline: none;
}

.config-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-xs);
  color: var(--c-ink-tertiary);
  transition: background 0.12s var(--ease-out), color 0.12s var(--ease-out);
}

.config-action-btn:hover:not(:disabled) {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.config-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.config-inline-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 22px;
  background: var(--c-surface-sunken);
  border-bottom: 1px solid var(--c-border);
  animation: slide-up 0.15s var(--ease-out);
}

.config-inline-input {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  font-size: 12px;
  flex: 1;
  max-width: 200px;
  transition: border-color 0.15s var(--ease-out);
}

.config-inline-input:focus {
  border-color: var(--c-accent);
  outline: none;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--c-ink-tertiary);
  margin-left: auto;
  transition: background 0.12s var(--ease-out), color 0.12s var(--ease-out);
}

.close-btn:hover {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.tab-bar {
  display: flex;
  gap: 0;
  padding: 0 22px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}

.tab-btn {
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--c-ink-tertiary);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
}

.tab-btn:hover {
  color: var(--c-ink-secondary);
}

.tab-btn.active {
  color: var(--c-accent);
  border-bottom-color: var(--c-accent);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 22px;
}

.settings-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--c-ink-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 10px 0 6px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  gap: 16px;
  min-height: 36px;
}

.setting-row>label:first-child {
  font-size: 13px;
  color: var(--c-ink);
  flex-shrink: 0;
  min-width: 100px;
}

.input-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.slider {
  width: 140px;
  accent-color: var(--c-accent);
  cursor: pointer;
}

.badge {
  font-size: 12px;
  color: var(--c-ink-tertiary);
  min-width: 40px;
  text-align: right;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.badge.mono {
  font-family: var(--font-mono);
  min-width: 60px;
}

.select {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}

.select:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

.color-picker {
  width: 32px;
  height: 26px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-xs);
  padding: 2px;
  background: none;
  cursor: pointer;
}

.color-input {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  font-size: 12px;
  font-family: var(--font-mono);
  width: 72px;
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}

.color-input:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

.key-input {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  width: 140px;
  cursor: pointer;
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}

.key-input:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

.number-input {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  font-size: 13px;
  width: 80px;
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}

.number-input:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

.unit {
  font-size: 12px;
  color: var(--c-ink-tertiary);
}

.text-input {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 7px 12px;
  font-size: 13px;
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}

.text-input:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

.full-width {
  width: 100%;
}

.hint {
  font-size: 11px;
  color: var(--c-ink-tertiary);
  margin: 0 0 6px;
}

.tip-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 12px;
  color: var(--c-ink-tertiary);
  cursor: help;
  vertical-align: middle;
  margin-left: 4px;
  border-radius: 50%;
  transition: color 0.15s var(--ease-out);
}

.tip-icon:hover,
.tip-icon:focus {
  color: var(--c-accent);
}

.tip-bubble {
  display: none;
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  width: 260px;
  padding: 10px 12px;
  background: var(--c-surface-overlay);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-xl);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.6;
  color: var(--c-ink);
  white-space: normal;
  z-index: 100;
  pointer-events: none;
}

.tip-bubble::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: var(--c-surface-overlay);
}

.tip-icon:hover .tip-bubble,
.tip-icon:focus .tip-bubble {
  display: block;
}

.toggle {
  position: relative;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-track {
  width: 36px;
  height: 20px;
  background: var(--c-border-strong);
  border-radius: var(--radius-full);
  transition: background 0.2s var(--ease-out);
  position: relative;
}

.toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: var(--c-ink-inverse);
  border-radius: 50%;
  transition: transform 0.2s var(--ease-out);
  box-shadow: 0 1px 3px rgba(28, 25, 23, 0.15);
}

.toggle input:checked+.toggle-track {
  background: var(--c-accent);
}

.toggle input:checked+.toggle-track::after {
  transform: translateX(16px);
}

.divider {
  height: 1px;
  background: var(--c-border);
  margin: 10px 0 6px;
}

.settings-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 22px;
  border-top: 1px solid var(--c-border);
  flex-shrink: 0;
}

.btn-primary,
.btn-secondary,
.btn-ghost,
.btn-danger {
  padding: 8px 18px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s var(--ease-out);
}

.btn-primary {
  background: var(--c-accent);
  color: var(--c-ink-inverse);
}

.btn-primary:hover {
  background: var(--c-accent-hover);
}

.btn-secondary {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
  border: 1px solid var(--c-border);
}

.btn-secondary:hover {
  background: var(--c-border);
}

.btn-ghost {
  color: var(--c-ink-tertiary);
  padding-left: 0;
}

.btn-ghost:hover {
  color: var(--c-ink);
}

.btn-danger {
  background: var(--c-danger);
  color: var(--c-ink-inverse);
}

.btn-danger:hover {
  opacity: 0.85;
}

.custom-fonts-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.custom-font-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--c-surface-sunken);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
}

.custom-font-name {
  font-size: 12px;
  color: var(--c-ink);
  font-family: var(--font-mono);
}

.confirm-overlay {
  position: fixed;
  inset: 0;
  background: var(--c-overlay-bg);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
  animation: fade-in 0.12s var(--ease-out);
}

.confirm-box {
  background: var(--c-surface-overlay);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-lg);
  padding: 24px;
  min-width: 300px;
  box-shadow: var(--shadow-xl);
  animation: slide-up 0.15s var(--ease-out);
}

.confirm-box p {
  margin: 0 0 20px;
  font-size: 14px;
  line-height: 1.6;
}

.confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
