<script setup lang="ts">
import {
  Braces,
  AlertTriangle,
  Check,
  ChevronRight,
  Clipboard,
  Download,
  FileText,
  FlaskConical,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import StatusMark from './components/StatusMark.vue'
import { formatReportDate, reportToJson, reportToMarkdown } from './composables/formatReport'
import { useSystemReport } from './composables/useSystemReport'
import { hostCompatibility } from './composables/ztoolsCompatibility'
import type { DiagnosticStatus } from './types/report'

type Theme = 'light' | 'dark'
type ExportFormat = 'markdown' | 'json'

const compatibility = ref(hostCompatibility())
const { report, loading, error, stale, usedMock, collect } = useSystemReport()
const lastExportPath = ref('')
const canStartDrag = computed(() => typeof window.ztools?.startDrag === 'function')
const activeGroup = ref('overview')
const theme = ref<Theme>('light')
const announcement = ref('')
const exportDialog = ref<HTMLDialogElement | null>(null)
const observer = ref<IntersectionObserver | null>(null)
let announcementTimer = 0

const conclusion = computed(() => {
  const status = report.value?.overallStatus ?? 'checking'
  const details: Record<DiagnosticStatus, { eyebrow: string; title: string; text: string }> = {
    healthy: { eyebrow: '检查完成 · 状态正常', title: '未发现明显异常', text: '系统关键信息已完成采集，可以将这份记录用于后续排障。' },
    warning: { eyebrow: '检查完成 · 有提示', title: '有项目值得进一步核对', text: '设备可以继续使用；下列提示可能有助于缩小问题范围。' },
    error: { eyebrow: '检查完成 · 不完整', title: '部分信息采集失败', text: '已保留成功采集的内容。建议重新检查，或导出报告交给技术支持。' },
    unavailable: { eyebrow: '检查完成 · 信息有限', title: '当前环境未提供足够信息', text: '报告已标记不适用项目，不会用推测值补齐。' },
    checking: { eyebrow: '正在检查', title: '正在读取本机信息', text: '所有数据只在本机处理。' },
    neutral: { eyebrow: '检查完成', title: '系统信息已记录', text: '可以复制或导出这份安全报告。' },
  }
  return details[status]
})

const issueCount = computed(() => {
  if (!report.value) return 0
  return report.value.errors.length + report.value.warnings.length
})

function announce(message: string) {
  window.clearTimeout(announcementTimer)
  announcement.value = message
  announcementTimer = window.setTimeout(() => {
    announcement.value = ''
  }, 2800)
}

function applyTheme(value: Theme) {
  theme.value = value
  document.documentElement.dataset.theme = value
  document.documentElement.style.colorScheme = value
  try {
    localStorage.setItem('system-report-theme', value)
  } catch {
    // Theme still applies when storage is unavailable.
  }
}

function toggleTheme() {
  applyTheme(theme.value === 'light' ? 'dark' : 'light')
}

async function refresh() {
  const result = await collect({ privacy: 'safe' })
  if (!result.ok) {
    announce(result.stale ? '更新失败，仍显示上次检查结果' : '检查失败，请稍后重试')
    return
  }
  announce(issueCount.value ? `检查完成，发现 ${issueCount.value} 条提示` : '检查完成，未发现明显异常')
  await nextTick()
  observeSections()
}

async function writeClipboard(text: string): Promise<boolean> {
  if (window.systemReport?.copyText) return window.systemReport.copyText(text)
  if (window.ztools?.copyText) {
    window.ztools.copyText(text)
    return true
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }
  return false
}

async function copyMarkdown() {
  if (!report.value) return
  try {
    const copied = await writeClipboard(reportToMarkdown(report.value))
    announce(copied ? 'Markdown 已复制' : '无法访问剪贴板，请改用导出')
  } catch {
    announce('复制失败，请改用导出')
  }
}

function openExport() {
  exportDialog.value?.showModal()
}

async function exportAs(format: ExportFormat) {
  if (!report.value) return
  const content = format === 'markdown' ? reportToMarkdown(report.value) : reportToJson(report.value)
  const extension = format === 'markdown' ? 'md' : 'json'
  const defaultName = `system-diagnostic-${new Date().toISOString().slice(0, 10)}.${extension}`
  try {
    if (window.systemReport?.saveReport) {
      const result = await window.systemReport.saveReport({ content, defaultName, format })
      if (result.canceled) return
      lastExportPath.value = result.filePath || ''
    } else {
      const blob = new Blob([content], { type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = defaultName
      link.click()
      URL.revokeObjectURL(url)
    }
    exportDialog.value?.close()
    announce(`${format === 'markdown' ? 'Markdown' : 'JSON'} 已导出`)
  } catch {
    announce('导出失败，请重试')
  }
}

async function dragLastExport(event: DragEvent) {
  event.preventDefault()
  if (!lastExportPath.value || !window.systemReport?.startDrag) return
  try {
    const started = await window.systemReport.startDrag(lastExportPath.value)
    announce(started ? '已开始拖出导出文件' : '当前 ZTools 版本不支持拖出文件')
  } catch {
    announce('拖出文件失败，请在文件夹中打开')
  }
}

function observeSections() {
  observer.value?.disconnect()
  observer.value = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0]
      if (visible?.target.id.startsWith('group-')) activeGroup.value = visible.target.id.replace('group-', '')
    },
    { rootMargin: '-16% 0px -68% 0px', threshold: [0, 0.15] },
  )
  document.querySelectorAll<HTMLElement>('[data-report-section]').forEach((section) => observer.value?.observe(section))
}

function scrollToGroup(id: string) {
  activeGroup.value = id
  document.getElementById(`group-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function closeDialogOnBackdrop(event: MouseEvent) {
  if (event.target === exportDialog.value) exportDialog.value.close()
}

onMounted(async () => {
  let initialTheme: Theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  try {
    const stored = localStorage.getItem('system-report-theme')
    if (stored === 'light' || stored === 'dark') initialTheme = stored
  } catch {
    // Use the operating-system preference.
  }
  applyTheme(initialTheme)
  if (!compatibility.value.supported) return
  window.ztools?.onPluginOut?.(() => {
    // Collection is deliberately allowed to finish in preload. Closing only
    // transient UI avoids duplicate collectors when 3.2 hides this renderer.
    exportDialog.value?.close()
    observer.value?.disconnect()
    announcement.value = ''
  })
  window.ztools?.onPluginEnter?.(() => {
    if (!compatibility.value.supported) return
    if (report.value) void nextTick(observeSections)
    else if (!loading.value) void refresh()
  })
  if (compatibility.value.supported) await refresh()
})

onBeforeUnmount(() => {
  observer.value?.disconnect()
  window.clearTimeout(announcementTimer)
})
</script>

<template>
  <section v-if="!compatibility.supported" class="compatibility-gate" role="alert">
    <span class="compatibility-mark" aria-hidden="true">!</span>
    <div>
      <p>需要更新 ZTools</p>
      <h1>当前版本 {{ compatibility.version || '无法识别' }} 暂不支持此插件</h1>
      <p>为了获得更完整、稳定的体验，请升级至 ZTools 2.4.0 或更高版本。</p>
    </div>
  </section>
  <template v-else>
  <a class="skip-link" href="#report-content">跳到诊断内容</a>
  <div class="app-frame">
    <header class="topbar">
      <div class="brand-block" aria-label="系统诊断记录单">
        <span class="brand-seal" aria-hidden="true">诊</span>
        <div>
          <strong>系统诊断记录单</strong>
          <span>本机采集 · 安全报告</span>
        </div>
      </div>

      <div class="topbar-actions" aria-label="报告操作">
        <button class="icon-button theme-button" type="button" :aria-label="theme === 'light' ? '切换到深色主题' : '切换到浅色主题'" @click="toggleTheme">
          <Moon v-if="theme === 'light'" :size="17" aria-hidden="true" />
          <Sun v-else :size="17" aria-hidden="true" />
        </button>
        <span class="action-divider" aria-hidden="true"></span>
        <button class="text-button" type="button" :disabled="loading" @click="refresh">
          <RefreshCw :size="15" :class="{ spinning: loading }" aria-hidden="true" />
          <span>重新检查</span>
        </button>
        <button class="text-button" type="button" :disabled="!report || loading" @click="copyMarkdown">
          <Clipboard :size="15" aria-hidden="true" />
          <span>复制 Markdown</span>
        </button>
        <button class="primary-button" type="button" :disabled="!report || loading" @click="openExport">
          <Download :size="15" aria-hidden="true" />
          <span>导出</span>
        </button>
        <button v-if="lastExportPath && canStartDrag" class="text-button" type="button" draggable="true" title="按住并拖到外部应用" @dragstart="dragLastExport">
          <Download :size="15" aria-hidden="true" />
          <span>拖出上次导出</span>
        </button>
      </div>
    </header>

    <div class="workspace">
      <aside class="report-index" aria-label="诊断分组导航">
        <div class="index-heading">
          <span>记录索引</span>
          <small v-if="report">{{ report.groups.length }} 项</small>
        </div>
        <nav v-if="report" class="spine-nav">
          <button
            v-for="(group, index) in report.groups"
            :key="group.id"
            class="spine-link"
            :class="[{ active: activeGroup === group.id }, `is-${group.status}`]"
            type="button"
            :aria-current="activeGroup === group.id ? 'location' : undefined"
            @click="scrollToGroup(group.id)"
          >
            <span class="spine-node" aria-hidden="true"><Check v-if="group.status === 'healthy'" :size="9" /></span>
            <span class="spine-count">{{ String(index + 1).padStart(2, '0') }}</span>
            <span>{{ group.title }}</span>
          </button>
        </nav>
        <div class="privacy-note">
          <ShieldCheck :size="16" aria-hidden="true" />
          <div>
            <strong>安全模式</strong>
            <p>用户名、序列号、网络地址与完整路径默认不采集。</p>
          </div>
        </div>
      </aside>

      <main id="report-content" class="report-content" tabindex="-1">
        <div class="sr-live" aria-live="polite" aria-atomic="true">{{ announcement }}</div>

        <section v-if="loading && !report" class="loading-sheet" aria-busy="true" aria-label="正在采集系统信息">
          <div class="loading-heading">
            <span class="scanner" aria-hidden="true"></span>
            <div>
              <p>正在建立诊断记录</p>
              <h1>读取本机软硬件信息…</h1>
            </div>
          </div>
          <div class="loading-lines" aria-hidden="true">
            <span v-for="index in 8" :key="index"></span>
          </div>
          <p class="loading-footnote">所有信息仅在本机处理，完成后会自动显示。</p>
        </section>

        <section v-else-if="error && !report" class="failure-sheet" role="alert">
          <div class="failure-mark">!</div>
          <p class="document-kicker">检查未完成</p>
          <h1>无法读取系统信息</h1>
          <p>{{ error }}</p>
          <button class="primary-button" type="button" @click="refresh">
            <RefreshCw :size="15" aria-hidden="true" /> 重新检查
          </button>
        </section>

        <template v-else-if="report">
          <section v-if="stale && error" class="stale-alert" role="alert">
            <AlertTriangle :size="18" aria-hidden="true" />
            <div>
              <strong>更新失败，当前显示的是上次检查结果</strong>
              <p>{{ error }} 报告时间仍以页面中的生成时间为准。</p>
            </div>
          </section>
          <section class="conclusion-sheet" aria-labelledby="conclusion-title">
            <div class="document-meta">
              <span>SYS / LOCAL / {{ report.overallStatus.toUpperCase() }}</span>
              <span>{{ formatReportDate(report.generatedAt) }}</span>
            </div>
            <div class="conclusion-heading">
              <div>
                <p class="document-kicker">{{ conclusion.eyebrow }}</p>
                <h1 id="conclusion-title">{{ conclusion.title }}</h1>
                <p class="conclusion-text">{{ conclusion.text }}</p>
              </div>
              <div class="conclusion-stamp" :class="`is-${report.overallStatus}`" aria-hidden="true">
                <Check v-if="report.overallStatus === 'healthy'" :size="24" />
                <span v-else>{{ issueCount }}</span>
                <small>{{ report.overallStatus === 'healthy' ? '已核' : '提示' }}</small>
              </div>
            </div>

            <div class="recommendations" aria-label="诊断建议">
              <article v-for="(item, index) in report.recommendations" :key="item.id" class="recommendation-row" :class="`is-${item.status}`">
                <span class="recommendation-number">{{ String(index + 1).padStart(2, '0') }}</span>
                <div>
                  <h2>{{ item.title }}</h2>
                  <p>{{ item.detail }}</p>
                </div>
                <ChevronRight :size="17" aria-hidden="true" />
              </article>
            </div>

            <div class="safe-strip">
              <ShieldCheck :size="15" aria-hidden="true" />
              <span>这是一份默认脱敏的安全报告。</span>
              <span v-if="usedMock" class="mock-label"><FlaskConical :size="12" aria-hidden="true" /> 浏览器演示数据</span>
            </div>
          </section>

          <section
            v-for="(group, index) in report.groups"
            :id="`group-${group.id}`"
            :key="group.id"
            class="report-group"
            data-report-section
            :aria-labelledby="`heading-${group.id}`"
          >
            <header class="group-heading">
              <div class="group-index">{{ String(index + 1).padStart(2, '0') }}</div>
              <div>
                <h2 :id="`heading-${group.id}`">{{ group.title }}</h2>
                <p>{{ group.description }}</p>
              </div>
              <StatusMark :status="group.status" />
            </header>
            <dl class="field-list">
              <div v-for="field in group.fields" :key="field.key" class="field-row" :class="`is-${field.status}`">
                <dt>{{ field.label }}</dt>
                <dd>
                  <span>{{ field.value }}</span>
                  <small v-if="field.note">{{ field.note }}</small>
                </dd>
                <StatusMark :status="field.status" compact />
              </div>
            </dl>
          </section>

          <footer class="report-footer">
            <span>系统诊断记录单</span>
            <span>本地生成 · 未上传</span>
          </footer>
        </template>
      </main>
    </div>
  </div>

  <dialog ref="exportDialog" class="export-dialog" aria-labelledby="export-title" @click="closeDialogOnBackdrop">
    <div class="dialog-header">
      <div>
        <p class="document-kicker">保存副本</p>
        <h2 id="export-title">导出安全报告</h2>
      </div>
      <button class="icon-button" type="button" aria-label="关闭导出面板" @click="exportDialog?.close()">
        <X :size="18" aria-hidden="true" />
      </button>
    </div>
    <p class="dialog-description">选择便于阅读的 Markdown，或保留原始结构的 JSON。两种格式均使用当前脱敏数据。</p>
    <div class="export-options">
      <button type="button" @click="exportAs('markdown')">
        <span class="file-symbol"><FileText :size="20" aria-hidden="true" /></span>
        <span><strong>Markdown 文档</strong><small>适合粘贴到工单、邮件或聊天中</small></span>
        <ChevronRight :size="18" aria-hidden="true" />
      </button>
      <button type="button" @click="exportAs('json')">
        <span class="file-symbol"><Braces :size="20" aria-hidden="true" /></span>
        <span><strong>JSON 数据</strong><small>适合自动分析或附加到问题记录</small></span>
        <ChevronRight :size="18" aria-hidden="true" />
      </button>
    </div>
    <div class="dialog-safe"><ShieldCheck :size="14" aria-hidden="true" /> 敏感标识仍保持隐藏</div>
  </dialog>
  </template>
</template>
