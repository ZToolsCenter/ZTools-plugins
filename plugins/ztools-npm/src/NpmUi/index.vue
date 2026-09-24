<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed, nextTick, watch } from 'vue'
import { useTheme } from '../lib/useTheme'
import { useNpmCache } from '../lib/useNpmCache'
import { parseSearch } from '../lib/search-parser'
import { tagVersion, dedupeVersions, formatTimestamp, pickLatest, applyDistTags } from '../lib/version-tag'
import { buildInstallCommand } from '../lib/command-builder'
import { renderMarkdown } from '../lib/markdown'
import type { NpmPackage, NpmVersion, ParsedQuery, NpmMeta, SearchResult } from '../lib/types'
import NpmSettings from '../NpmSettings/index.vue'

const props = defineProps<{ enterAction: any }>()

useTheme()
const cache = useNpmCache()

const searchInput = ref('')
const debouncedInput = ref('')
let debounceTimer: any = null
const searchResult = ref<SearchResult | null>(null)
const selectedIdx = ref(0)
const selectedPackage = ref<NpmPackage | null>(null)
const meta = ref<NpmMeta | null>(null)
const versions = ref<NpmVersion[]>([])
const versionIdx = ref(0)
const MAX_VERSIONS_PER_PAGE = 200
const versionPage = ref(1)
const visibleVersions = computed(() => versions.value.slice(0, versionPage.value * MAX_VERSIONS_PER_PAGE))
const versionsHasMore = computed(() => visibleVersions.value.length < versions.value.length)
const hasSourceErrors = computed(() => {
  const e = searchResult.value?.errors
  return !!e && Object.keys(e).length > 0
})
function loadMoreVersions() { versionPage.value += 1 }
const loading = ref(false)
const error = ref<any>(null)
const settingsOpen = ref(false)
const helpOpen = ref(false)
const menuOpen = ref(false)
const menuFocusIdx = ref(0)

// 右侧面板：使用指南
const rightTab = ref<'guide'>('guide')

const STORAGE_TAB_KEY = 'npm-search-tab'
const STORAGE_MODE_KEY = 'npm-mode'
type AppMode = 'create' | 'manage'
const activeMode = ref<AppMode>('create')

// 管理页数据
interface GlobalPkg {
  name: string
  version: string
  description: string
  path: string
  extraneous?: boolean
  missing?: boolean
}
interface NodeVer {
  version: string
  current: boolean
  currentGlobal?: boolean
  npmBin: string
  prefix: string
  available: boolean
}

// 左：Node 版本列表；右：所选版本下的全局包列表
const nodeVerList = ref<NodeVer[]>([])
const nodeManager = ref<string>('')
const currentGlobalVersion = ref<string>('')   // 用户 shell 实际在用的 Node 版本（PATH 上的那个）
const nodeDebugLog = ref<string[]>([])  // 探测过程的诊断信息（每个候选失败原因）
const loadingNode = ref(false)
const nodeErr = ref('')
const selectedVersion = ref<NodeVer | null>(null)

const versionPkgs = ref<GlobalPkg[]>([])
const loadingVersionPkgs = ref(false)
const versionPkgsErr = ref('')
const versionPkgsDebug = ref<{ npmBin: string; prefix: string; problems: any[]; rawStdout: string; rawStderr: string } | null>(null)
const busyPkgName = ref('')   // 正在更新/卸载的包名（用于按钮 loading 态）

async function loadNodeVersions() {
  loadingNode.value = true
  nodeErr.value = ''
  try {
    const data = await window.services.nodeListVersions()
    nodeVerList.value = (data.versions || []) as NodeVer[]
    nodeManager.value = data.manager || ''
    currentGlobalVersion.value = data.currentGlobalVersion || ''
    nodeDebugLog.value = data.debug || []
    // 首次加载或上次选中的版本已不存在 → 自动选：优先当前全局默认，否则第一个
    if (nodeVerList.value.length > 0) {
      const stillExists = selectedVersion.value &&
        nodeVerList.value.some(v => v.version === selectedVersion.value!.version)
      if (!stillExists) {
        const preferred = nodeVerList.value.find(v => v.currentGlobal) || nodeVerList.value[0]
        selectVersion(preferred)
      }
    }
  } catch (e: any) {
    nodeErr.value = e?.message || String(e)
  } finally {
    loadingNode.value = false
  }
}

// 复制 Node 切换命令到剪贴板 + 提示
async function copySwitchCommand(v: NodeVer, kind: 'use' | 'default') {
  const cmd = kind === 'default'
    ? window.services.defaultCommandForManager(nodeManager.value, v.version)
    : window.services.switchCommandForManager(nodeManager.value, v.version)
  if (!cmd) {
    window.ztools?.showNotification?.(`${v.version}：当前环境不直接支持切换（无 nvm/fnm），请手动改 shell 配置`)
    return
  }
  try {
    await window.ztools?.clipboard?.writeContent?.({ type: 'text', content: cmd, shouldPaste: false })
    window.ztools?.showNotification?.(`已复制：${cmd}（请到终端粘贴执行）`)
  } catch {
    window.ztools?.showNotification?.(`请手动执行：${cmd}`)
  }
}

// 跨版本复制（=在目标版本上 install <pkg>@<exactVer>，默认走淘宝镜像）
const checkedPkgNames = ref<Set<string>>(new Set())
const copyDialogOpen = ref(false)
const copyTargetVersion = ref<NodeVer | null>(null)
const copyMirrorEnabled = ref(true)
const copyInProgress = ref(false)
const copyProgress = ref({ done: 0, total: 0, lastError: '' })

function togglePkgCheck(name: string) {
  // 用 Set 的 reactive 替代：直接换新 Set 才能触发 computed 更新
  const next = new Set(checkedPkgNames.value)
  if (next.has(name)) next.delete(name); else next.add(name)
  checkedPkgNames.value = next
}
function selectAllVisible() {
  const next = new Set(checkedPkgNames.value)
  for (const p of visibleVersionPkgs.value) next.add(p.name)
  checkedPkgNames.value = next
}
function clearSelection() { checkedPkgNames.value = new Set() }
const checkedCount = computed(() => checkedPkgNames.value.size)
const checkedVisibleAll = computed(() => {
  const visible = visibleVersionPkgs.value
  return visible.length > 0 && visible.every(p => checkedPkgNames.value.has(p.name))
})
// 预览要执行的命令（给复制对话框展示）
const copyPreviewCmd = computed(() => {
  const target = copyTargetVersion.value
  if (!target || checkedCount.value === 0) return ''
  const pkgs = versionPkgs.value.filter(p => checkedPkgNames.value.has(p.name))
  const mirror = copyMirrorEnabled.value ? ' --registry https://registry.npmmirror.com' : ''
  return pkgs.map(p => `${target.npmBin || 'npm'} install -g ${p.name}@${p.version} --prefix ${target.prefix}${mirror}`).join('\n')
})

function openCopyDialog() {
  if (checkedCount.value === 0) return
  copyProgress.value = { done: 0, total: 0, lastError: '' }
  // 默认选第一个非当前选中版本的节点作为目标
  copyTargetVersion.value = nodeVerList.value.find(v => v.version !== selectedVersion.value?.version)
    || nodeVerList.value[0]
  copyDialogOpen.value = true
}
function closeCopyDialog() {
  if (copyInProgress.value) return
  copyDialogOpen.value = false
}

async function executeCopy() {
  const target = copyTargetVersion.value
  if (!target || checkedCount.value === 0) return
  const pkgs = versionPkgs.value.filter(p => checkedPkgNames.value.has(p.name))
  copyInProgress.value = true
  copyProgress.value = { done: 0, total: pkgs.length, lastError: '' }
  const mirror = copyMirrorEnabled.value ? 'https://registry.npmmirror.com' : ''
  let failed = []
  for (let i = 0; i < pkgs.length; i++) {
    const p = pkgs[i]
    copyProgress.value = { ...copyProgress.value, done: i }
    try {
      await window.services.npmInstallGlobal({
        name: p.name,
        version: p.version,
        npmBin: target.npmBin,
        prefix: target.prefix,
        registry: mirror || undefined,
      })
    } catch (e: any) {
      failed.push({ name: p.name, err: e?.message || String(e) })
      copyProgress.value = { ...copyProgress.value, lastError: `${p.name}: ${e?.message || e}` }
    }
  }
  copyProgress.value = { done: pkgs.length, total: pkgs.length, lastError: '' }
  copyInProgress.value = false
  if (failed.length === 0) {
    window.ztools?.showNotification?.(`已成功复制 ${pkgs.length} 个包到 ${target.version}`)
    copyDialogOpen.value = false
    checkedPkgNames.value = new Set()
  } else {
    window.ztools?.showNotification?.(`复制完成，${failed.length}/${pkgs.length} 失败（见调试面板）`)
  }
}

function selectVersion(v: NodeVer) {
  console.log('[manage] selectVersion', v.version, 'npmBin=', v.npmBin, 'available=', v.available)
  selectedVersion.value = v
  loadVersionPkgs()
}

async function loadVersionPkgs() {
  const sv = selectedVersion.value
  if (!sv) return
  console.log('[manage] loadVersionPkgs start', sv.version, 'npmBin=', sv.npmBin)
  loadingVersionPkgs.value = true
  versionPkgsErr.value = ''
  versionPkgsDebug.value = null
  try {
    const data = await window.services.npmListGlobal({
      npmBin: sv.npmBin,
      prefix: sv.prefix,
    })
    console.log('[manage] loadVersionPkgs done', { count: data.packages?.length, prefix: data.debug?.prefix })
    versionPkgs.value = data.packages || []
    versionPkgsDebug.value = data.debug || null
  } catch (e: any) {
    console.warn('[manage] loadVersionPkgs error', e?.message || e)
    versionPkgsErr.value = e?.message || String(e)
    versionPkgsDebug.value = null
  } finally {
    loadingVersionPkgs.value = false
  }
}

async function updatePkg(pkg: GlobalPkg) {
  busyPkgName.value = pkg.name
  try {
    await window.services.npmUpdateGlobal(pkg.name, {
      npmBin: selectedVersion.value?.npmBin,
      prefix: selectedVersion.value?.prefix,
    })
    window.ztools?.showNotification?.(`${pkg.name} 已更新到最新版`)
    await loadVersionPkgs()
  } catch (e: any) {
    window.ztools?.showNotification?.(`更新失败：${e?.message || e}`)
  } finally {
    busyPkgName.value = ''
  }
}

async function updateAllPkgs() {
  if (!selectedVersion.value) return
  busyPkgName.value = '*'
  try {
    await window.services.npmUpdateAllGlobal({
      npmBin: selectedVersion.value.npmBin,
      prefix: selectedVersion.value.prefix,
    })
    window.ztools?.showNotification?.(`已更新 ${selectedVersion.value.version} 的所有全局包`)
    await loadVersionPkgs()
  } catch (e: any) {
    window.ztools?.showNotification?.(`批量更新失败：${e?.message || e}`)
  } finally {
    busyPkgName.value = ''
  }
}

// 包管理工具 denylist：默认不展示（属于"工具"而非"依赖"），可点击展开
const PKG_MANAGER_NAMES = new Set(['n', 'npx', 'yarn', 'pnpm', 'corepack'])
function isPkgManagerTool(name: string): boolean {
  const k = name.toLowerCase()
  // npm 自身在 npm ls 输出中是 'npm@<ver>' 形式，pnpm 可能也会以 'pnpm@<ver>' 出现
  if (k.startsWith('npm@') || k.startsWith('pnpm@')) return true
  return PKG_MANAGER_NAMES.has(k)
}
const showTools = ref(false)
const visibleVersionPkgs = computed(() =>
  showTools.value
    ? versionPkgs.value
    : versionPkgs.value.filter(p => !isPkgManagerTool(p.name))
)
const hiddenToolsCount = computed(() =>
  versionPkgs.value.filter(p => isPkgManagerTool(p.name)).length
)
const TABS = [
  { key: 'all', label: '全部' },
  { key: 'npm', label: 'npm' },
  { key: 'npmmirror', label: 'npmmirror' },
]
const activeTab = ref('all')
let tabIdx = 0

const SOURCE_LABELS: Record<string, string> = { npm: 'npm', npmmirror: 'npmmirror' }

type MenuItem =
  | { separator: true }
  | { label: string; shortcut: string; manager: 'npm' | 'pnpm' | 'yarn'; global: boolean }

const MENU_ITEMS: MenuItem[] = [
  { label: '复制 npm install',  shortcut: 'n', manager: 'npm',   global: false },
  { label: '复制 pnpm add',      shortcut: 'p', manager: 'pnpm',  global: false },
  { label: '复制 yarn add',      shortcut: 'y', manager: 'yarn',  global: false },
  { separator: true },
  { label: '全局安装 npm -g',    shortcut: 'N', manager: 'npm',   global: true  },
  { label: '全局安装 pnpm -g',   shortcut: 'P', manager: 'pnpm',  global: true  },
  { label: '全局安装 yarn global', shortcut: 'Y', manager: 'yarn', global: true  },
]

// 跳过分隔符的导航索引：Tab / Up / Down 在这 6 项之间循环
const NAV_INDICES = [0, 1, 2, 4, 5, 6]
const KEY_TO_IDX: Record<string, number> = {
  n: 0, p: 1, y: 2,
  N: 4, P: 5, Y: 6,
}

function isSeparator(item: MenuItem): item is { separator: true } {
  return 'separator' in item && item.separator === true
}

// 全局安装二次确认对话框
// 二次确认对话框：上下文统一用 discriminated union
type NavMenuItem = Exclude<MenuItem, { separator: true }>
type ConfirmContext =
  | { kind: 'install-global';   coord: { name: string; version?: string }; item: NavMenuItem }
  | { kind: 'uninstall-global'; name: string }

const confirmOpen = ref(false)
const pendingConfirm = ref<ConfirmContext | null>(null)
const cancelBtnRef = ref<HTMLButtonElement | null>(null)
const pendingCmd = computed(() => {
  const p = pendingConfirm.value
  if (!p) return ''
  if (p.kind === 'install-global') return buildInstallCommand(p.coord, p.item.manager, { global: true })
  return `npm uninstall -g ${p.name}`
})
const confirmTitle = computed(() => {
  const p = pendingConfirm.value
  if (!p) return ''
  return p.kind === 'install-global'
    ? '确认全局安装？'
    : `确认卸载全局包「${p.name}」？`
})
const confirmWarning = computed(() => {
  const p = pendingConfirm.value
  if (!p) return ''
  return p.kind === 'install-global'
    ? '将在系统目录安装以下包（可能需要管理员/sudo 权限），请确认是本人操作：'
    : '将从全局环境卸载以下包（移除该包的命令和符号链接，影响所有项目），请确认是本人操作：'
})
const confirmPrimaryLabel = computed(() => {
  const p = pendingConfirm.value
  if (!p) return '确认'
  return p.kind === 'install-global' ? '确认全局安装' : '确认卸载'
})

watch(confirmOpen, async (open) => {
  if (open) { await nextTick(); cancelBtnRef.value?.focus() }
})

function cancelConfirm() {
  confirmOpen.value = false
  pendingConfirm.value = null
}
async function applyConfirm() {
  const p = pendingConfirm.value
  if (!p) return
  if (p.kind === 'install-global') {
    copyContent(buildInstallCommand(p.coord, p.item.manager, { global: true }), p.item.label)
    cancelConfirm()
    closeMenu()
    return
  }
  // uninstall-global：真执行卸载
  const name = p.name
  cancelConfirm()
  try {
    await window.services.npmUninstallGlobal(name, {
      npmBin: selectedVersion.value?.npmBin,
      prefix: selectedVersion.value?.prefix,
    })
    window.ztools?.showNotification?.(`已卸载 ${name}`)
    await loadVersionPkgs()
  } catch (e: any) {
    window.ztools?.showNotification?.(`卸载失败：${e?.message || e}`)
  }
}

function askUninstallGlobal(pkg: GlobalPkg) {
  pendingConfirm.value = { kind: 'uninstall-global', name: pkg.name }
  confirmOpen.value = true
}

// 顶部 hint 旁边的「开源 v{version}」链接
// 版本号与 plugin.json / package.json 同步（升级时记得同时改这三处）
const PLUGIN_VERSION = '1.0.0'
const REPO_URL = 'https://github.com/kshq1996/ztools-npm'

function openRepo() {
  window.ztools?.shellOpenExternal?.(REPO_URL)
}

const resultsListRef = ref<HTMLUListElement | null>(null)
const versionsListRef = ref<HTMLDivElement | null>(null)
const menuOverlayRef = ref<HTMLDivElement | null>(null)

/**
 * 把容器内第 idx 个子元素智能滚到可视区：
 * - 已在可视区内：不滚动（避免抖动）
 * - 偏上/完全在顶外：让元素顶部对齐到容器顶部
 * - 偏下/完全在底外：让元素底部对齐到容器底部
 * 使用浏览器原生的 nearest 策略，跨 offsetParent 也安全。
 */
function scrollItemIntoView(container: HTMLElement | null, idx: number) {
  if (!container) return
  const item = container.children.item(idx) as HTMLElement | null
  item?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function baseTabResults(): NpmPackage[] {
  const s = searchResult.value
  if (!s) return []
  if (activeTab.value === 'npm') return s.sources?.npm ?? []
  if (activeTab.value === 'npmmirror') return s.sources?.npmmirror ?? []
  return s.data ?? []
}
function tabCount(key: string): number {
  const s = searchResult.value
  if (!s) return 0
  if (key === 'npm') return s.sources?.npm?.length ?? 0
  if (key === 'npmmirror') return s.sources?.npmmirror?.length ?? 0
  return s.data?.length ?? 0
}
function persistTab(key: string) { try { window.ztools?.dbStorage?.setItem?.(STORAGE_TAB_KEY, key) } catch {} }
function switchTab(key: string) {
  activeTab.value = key
  tabIdx = TABS.findIndex(t => t.key === key)
  selectedIdx.value = 0
  persistTab(key)
}
// 模式切换（管理 / 创建）
function enterManage() {
  // 进入管理页：按需加载节点版本（packages 列表随版本选中自动 fetch）
  if (nodeVerList.value.length === 0 && !loadingNode.value) loadNodeVersions()
}
function switchMode(m: AppMode) {
  if (activeMode.value === m) {
    // 同模式也允许主动触发首次加载（修复 onMounted 从 dbStorage 恢复 manage 模式
    // 时 activeMode 已被设为 manage 而 switchMode 早退的 bug）
    if (m === 'manage') enterManage()
    return
  }
  activeMode.value = m
  try { window.ztools?.dbStorage?.setItem?.(STORAGE_MODE_KEY, m) } catch {}
  if (m === 'manage') enterManage()
}
function tabStep(dir: 1 | -1) {
  tabIdx = (tabIdx + dir + TABS.length) % TABS.length
  switchTab(TABS[tabIdx].key)
}

function cacheKey(parsed: ParsedQuery): string {
  if (parsed.kind === 'package') return `${parsed.name}${parsed.versionPrefix ? '@' + parsed.versionPrefix : ''}`
  return parsed.text
}

async function doSearch() {
  const input = debouncedInput.value.trim()
  if (!input) { searchResult.value = null; return }
  const parsed = parseSearch(input)
  const key = cacheKey(parsed)
  const cached = cache.getSearch(key)
  if (cached) {
    selectedIdx.value = 0
    error.value = null
    searchResult.value = cached
    return
  }
  loading.value = true
  error.value = null
  try {
    const r = await window.services.npmSearch(parsed)
    cache.setSearch(key, r)
    searchResult.value = r
    selectedIdx.value = 0
  } catch (e: any) {
    error.value = e
    searchResult.value = null
  } finally {
    loading.value = false
  }
}

async function loadMeta(pkg: NpmPackage) {
  const key = `${pkg.source === 'npmmirror' ? 'm:' : ''}${pkg.name}`
  const cached = cache.getMeta(key)
  const metaData: NpmMeta = cached ?? (await window.services.npmMeta(pkg.name, pkg.source ?? 'npm'))
  if (!cached) cache.setMeta(key, metaData)
  meta.value = metaData
  const tagged: NpmVersion[] = (metaData.versions ?? []).map(v => ({
    v: v.v, time: v.time ?? 0, status: tagVersion(v.v), isLatest: false, isDistTag: false,
  }))
  const deduped = applyDistTags(dedupeVersions(tagged), metaData.distTags ?? {})
  let finalVersions = deduped
  if (!deduped.some(v => v.isLatest)) {
    const latest = pickLatest(deduped)
    if (latest) finalVersions = deduped.map(v => ({ ...v, isLatest: v === latest }))
  }
  versions.value = finalVersions.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
  versionIdx.value = Math.max(versions.value.findIndex(v => v.isLatest), 0)
  versionPage.value = 1
  rightTab.value = 'guide'
}

async function selectPackage(pkg: NpmPackage) {
  selectedPackage.value = pkg
  loading.value = true
  error.value = null
  try {
    await loadMeta(pkg)
  } catch (e: any) {
    error.value = e
    versions.value = []
    meta.value = null
  } finally {
    loading.value = false
  }
}

async function copyContent(content: string, msg: string) {
  if (!window.ztools?.clipboard) return
  try {
    await window.ztools.clipboard.writeContent({ type: 'text', content, shouldPaste: true })
    window.ztools?.showNotification?.(msg)
    window.ztools?.hideMainWindow?.()
  } catch {
    window.ztools?.showNotification?.('复制失败')
  }
}

function currentCoord(): { name: string; version?: string } | null {
  const p = selectedPackage.value
  if (!p) return null
  const v = versions.value[versionIdx.value]
  return { name: p.name, version: v ? v.v : p.version }
}
function copyNpm() { const c = currentCoord(); if (c) copyContent(buildInstallCommand(c, 'npm'), '已复制 npm install') }
function copyPnpm() { const c = currentCoord(); if (c) copyContent(buildInstallCommand(c, 'pnpm'), '已复制 pnpm add') }
function copyYarn() { const c = currentCoord(); if (c) copyContent(buildInstallCommand(c, 'yarn'), '已复制 yarn add') }
function copyFromRow(pkg: NpmPackage | undefined, manager: 'npm' | 'pnpm' | 'yarn') {
  if (!pkg) return
  copyContent(buildInstallCommand({ name: pkg.name, version: pkg.version }, manager), `已复制 ${manager} 安装指令`)
}

function openMenu() {
  if (!currentCoord()) return
  menuOpen.value = true
  menuFocusIdx.value = 0
  nextTick(() => menuOverlayRef.value?.focus())
}
function closeMenu() { menuOpen.value = false }
function confirmMenu() {
  const c = currentCoord()
  if (!c) return
  const item = MENU_ITEMS[menuFocusIdx.value]
  if (isSeparator(item)) return
  if (item.global) {
    // 全局安装：先开二次确认，复制动作推迟到用户确认
    pendingConfirm.value = { kind: 'install-global', coord: c, item }
    confirmOpen.value = true
    return
  }
  copyContent(buildInstallCommand(c, item.manager), item.label)
  closeMenu()
}
function confirmMenuAt(i: number) {
  menuFocusIdx.value = i
  confirmMenu()
}

function onSearchChange(input: unknown) {
  const text = typeof input === 'string' ? input : (input as any)?.text ?? ''
  searchInput.value = text
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { debouncedInput.value = text; doSearch() }, 700)
}

function onResultKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    selectedIdx.value = Math.min(selectedIdx.value + 1, baseTabResults().length - 1)
    nextTick(() => scrollItemIntoView(resultsListRef.value, selectedIdx.value))
    e.preventDefault()
  }
  else if (e.key === 'ArrowUp') {
    selectedIdx.value = Math.max(selectedIdx.value - 1, 0)
    nextTick(() => scrollItemIntoView(resultsListRef.value, selectedIdx.value))
    e.preventDefault()
  }
}
function onVersionKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    versionIdx.value = Math.min(versionIdx.value + 1, visibleVersions.value.length - 1)
    nextTick(() => scrollItemIntoView(versionsListRef.value, versionIdx.value))
    e.preventDefault()
  }
  else if (e.key === 'ArrowUp') {
    versionIdx.value = Math.max(versionIdx.value - 1, 0)
    nextTick(() => scrollItemIntoView(versionsListRef.value, versionIdx.value))
    e.preventDefault()
  }
  else if (e.key === 'ArrowLeft') { selectedPackage.value = null; e.preventDefault() }
}
function onMenuKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { closeMenu(); e.stopPropagation(); e.preventDefault() }
  else if (e.key === 'Tab') {
    e.stopPropagation()
    e.preventDefault()
    const cur = NAV_INDICES.indexOf(menuFocusIdx.value)
    const dir = e.shiftKey ? -1 : 1
    const next = cur === -1 ? 0 : (cur + dir + NAV_INDICES.length) % NAV_INDICES.length
    menuFocusIdx.value = NAV_INDICES[next]
  } else if (e.key === 'Enter') { confirmMenu(); e.stopPropagation(); e.preventDefault() }
  else if (e.key in KEY_TO_IDX) {
    menuFocusIdx.value = KEY_TO_IDX[e.key]
    confirmMenu()
    e.stopPropagation()
    e.preventDefault()
  }
}

function onConfirmKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { cancelConfirm(); e.stopPropagation(); e.preventDefault() }
}

function onGlobalKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && helpOpen.value) { helpOpen.value = false; e.preventDefault(); return }
  if (menuOpen.value || settingsOpen.value || helpOpen.value) return

  const key = e.key.toLowerCase()
  // 管理模式只保留 Cmd+K 切帮助
  if (activeMode.value === 'manage') {
    if ((e.metaKey || e.ctrlKey) && key === 'k') { helpOpen.value = !helpOpen.value; e.preventDefault(); return }
    return
  }

  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

  const inDetail = !!selectedPackage.value
  const hasSelection = inDetail || (!selectedPackage.value && baseTabResults().length > 0)

  if (e.key === 'Escape') {
    if (selectedPackage.value) selectedPackage.value = null
    else window.ztools?.hideMainWindow?.()
    e.preventDefault(); return
  }
  if (e.key === '/') {
    document.getElementById('npm-search-input')?.focus(); e.preventDefault()
    return
  }
  if (!selectedPackage.value && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    tabStep(e.key === 'ArrowRight' ? 1 : -1); e.preventDefault(); return
  }
  if (selectedPackage.value && e.key === 'ArrowLeft') { selectedPackage.value = null; e.preventDefault(); return }
  if (inDetail && key === 'r') { rightTab.value = 'guide'; e.preventDefault(); return }

  if (hasSelection && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === 'Enter' || key === 'c') {
      if (inDetail) openMenu()
      else { const entry = baseTabResults()[selectedIdx.value]; if (entry) selectPackage(entry) }
      e.preventDefault()
    } else if (key === 'n') {
      if (inDetail) copyNpm()
      else copyFromRow(baseTabResults()[selectedIdx.value], 'npm')
      e.preventDefault()
    } else if (key === 'p') {
      if (inDetail) copyPnpm()
      else copyFromRow(baseTabResults()[selectedIdx.value], 'pnpm')
      e.preventDefault()
    } else if (key === 'y') {
      if (inDetail) copyYarn()
      else copyFromRow(baseTabResults()[selectedIdx.value], 'yarn')
      e.preventDefault()
    }
  }
}

watch([() => activeTab.value, () => baseTabResults().length], async () => {
  if (baseTabResults().length > 0 && !selectedPackage.value) {
    const ae = document.activeElement as HTMLElement | null
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return
    await nextTick()
    resultsListRef.value?.focus({ preventScroll: true })
  }
})

onMounted(() => {
  window.ztools?.setSubInput?.(onSearchChange, '搜索 npm 包…', true)
  window.addEventListener('keydown', onGlobalKey)
  Promise.resolve()
    .then(() => window.ztools?.dbStorage?.getItem?.(STORAGE_TAB_KEY))
    .then((saved) => {
      if (saved && TABS.some(t => t.key === saved)) switchTab(saved)
      else tabIdx = TABS.findIndex(t => t.key === activeTab.value)
    })
    .catch(() => { tabIdx = 0 })
  // 恢复上次停留的 mode（默认 create）
  Promise.resolve()
    .then(() => window.ztools?.dbStorage?.getItem?.(STORAGE_MODE_KEY))
    .then((saved) => {
      if (saved === 'create' || saved === 'manage') {
        activeMode.value = saved
        if (saved === 'manage') switchMode('manage')
      }
    })
    .catch(() => { /* 忽略，保持默认 create */ })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  clearTimeout(debounceTimer)
})
</script>

<template>
  <div class="npm-panel">
    <!-- 模式切换：创建 / 管理 -->
    <div class="mode-switch" role="tablist" aria-label="主模式">
      <button :class="{ active: activeMode === 'create' }" @click="switchMode('create')" role="tab" :aria-selected="activeMode === 'create'">创建</button>
      <button :class="{ active: activeMode === 'manage' }" @click="switchMode('manage')" role="tab" :aria-selected="activeMode === 'manage'">管理</button>
    </div>

    <div v-if="helpOpen" class="help-overlay" @click.self="helpOpen = false" tabindex="0" @keydown.escape="helpOpen = false">
      <div class="help-box">
        <h3>快捷键</h3>
        <ul>
          <li><kbd>/</kbd> 聚焦搜索</li>
          <li><kbd>↑</kbd>/<kbd>↓</kbd> 列表内移动</li>
          <li><kbd>←</kbd>/<kbd>→</kbd> 切换数据源</li>
          <li><kbd>Enter</kbd> 进入版本列表</li>
          <li><kbd>n</kbd> npm / <kbd>p</kbd> pnpm / <kbd>y</kbd> yarn</li>
          <li><kbd>Shift+N</kbd>/<kbd>Shift+P</kbd>/<kbd>Shift+Y</kbd> 全局安装（菜单中需确认）</li>
          <li><kbd>r</kbd> 使用指南</li>
          <li><kbd>Esc</kbd> 返回 / 退出</li>
          <li><kbd>Cmd/Ctrl+K</kbd> 帮助</li>
        </ul>
      </div>
    </div>

    <div v-if="menuOpen" ref="menuOverlayRef" class="menu-overlay" @click.self="closeMenu" @keydown="onMenuKey" tabindex="0">
      <div class="menu-box">
        <template v-for="(item, i) in MENU_ITEMS" :key="i">
          <hr v-if="isSeparator(item)" class="menu-sep" />
          <button v-else :class="{ focused: i === menuFocusIdx, 'is-global': item.global }" @click="confirmMenuAt(i)">
            <span>{{ item.label }}</span>
            <span class="hint">({{ item.shortcut }})</span>
          </button>
        </template>
      </div>
    </div>

    <!-- 全局安装二次确认 -->
    <div v-if="confirmOpen" class="menu-overlay" @click.self="cancelConfirm" @keydown="onConfirmKey" tabindex="0">
      <div class="confirm-box">
        <h4>{{ confirmTitle }}</h4>
        <p class="confirm-hint">{{ confirmWarning }}</p>
        <pre class="cmd">{{ pendingCmd }}</pre>
        <div class="confirm-actions">
          <button ref="cancelBtnRef" @click="cancelConfirm">取消</button>
          <button class="primary" @click="applyConfirm">{{ confirmPrimaryLabel }}</button>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-box">
      <div class="error-msg">{{ error?.message || '出错了' }}</div>
      <details>
        <summary class="err-toggle">查看错误详情</summary>
        <pre>{{ error?.url }} · {{ error?.status }} · {{ error?.durationMs }}ms</pre>
      </details>
    </div>

    <!-- 创建模式：一级结果列表 + 详情 -->
    <div v-if="activeMode === 'create'" class="mode-create">

    <!-- 一级：结果列表（全宽） -->
    <div v-if="!selectedPackage" class="results">
      <header class="result-header">
        <span class="search-tip">↑↓ 选包 · ←→ 切源 · n npm / p pnpm / y yarn · Enter 进入</span>
        <a class="footer-link" :href="REPO_URL" target="_blank" @click.prevent="openRepo" title="本项目基于 MIT 协议开源，点击查看 GitHub 仓库">
          <span class="github-icon" aria-hidden="true"></span>
          <span>开源 v{{ PLUGIN_VERSION }}</span>
        </a>
        <button class="settings-btn" @click="settingsOpen = true" title="HTTP 代理设置">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          设置
        </button>
      </header>

      <div v-if="searchResult" class="tabs">
        <button v-for="t in TABS" :key="t.key" class="tab" :class="{ active: activeTab === t.key }" @click="switchTab(t.key)">
          {{ t.label }}
          <span class="tab-count">{{ tabCount(t.key) }}</span>
        </button>
      </div>

      <div v-if="loading" class="loading">检索中…</div>
      <div v-else-if="searchResult && baseTabResults().length === 0" class="empty">
        <template v-if="searchResult.data.length === 0">
          <template v-if="hasSourceErrors">
            检索失败，请检查网络或代理设置
          </template>
          <template v-else>
            没找到相关包。
            <a :href="`https://www.npmjs.com/search?q=${encodeURIComponent(searchInput)}`" target="_blank" rel="noopener">去 npmjs.com 搜 “{{ searchInput }}”</a>
          </template>
        </template>
        <template v-else>
          当前数据源暂无结果，按 ← → 切换数据源查看
        </template>
      </div>
      <ul v-else-if="searchResult && baseTabResults().length > 0" ref="resultsListRef" tabindex="0" @keydown="onResultKey">
        <li v-for="(p, i) in baseTabResults()" :key="p.name + '-' + p.source" :class="{ active: i === selectedIdx }" @click="selectPackage(p)">
          <span class="name">{{ p.name }}</span>
          <span class="version">{{ p.version }}</span>
          <span v-if="activeTab === 'all' && p.source" class="src-tag" :class="'src-' + p.source">{{ SOURCE_LABELS[p.source] }}</span>
          <span class="copy-hint"><kbd>n</kbd>/<kbd>p</kbd>/<kbd>y</kbd> 复制 · <kbd>Enter</kbd> 进入</span>
        </li>
      </ul>
    </div>

    <!-- 详情：左侧版本 / 右侧使用指南 -->
    <div v-else class="detail">
      <aside class="left">
        <header>
          <button class="back-btn" @click="selectedPackage = null">← 返回</button>
          <span class="id">{{ selectedPackage.name }}</span>
          <button class="settings-btn" @click="settingsOpen = true" title="HTTP 代理">设置</button>
        </header>
        <div v-if="meta?.description" class="desc">{{ meta.description }}</div>

        <ul ref="versionsListRef" @keydown="onVersionKey" tabindex="0">
          <li v-for="(v, i) in visibleVersions" :key="v.v" :class="{ active: i === versionIdx, latest: v.isLatest }" @click="versionIdx = i" tabindex="0" @focus="versionIdx = i">
            <span class="ver">{{ v.v }}</span>
            <span class="time">{{ formatTimestamp(v.time ?? 0) }}</span>
            <span :class="['status', v.status]">{{ v.status }}</span>
            <span v-if="v.isLatest" class="latest-badge">LATEST</span>
            <span v-if="v.isDistTag && !v.isLatest" class="dist-tag">dist-tag</span>
          </li>
        </ul>
        <button v-if="versionsHasMore" class="more" @click="loadMoreVersions">加载更多（{{ versions.length - visibleVersions.length }} 条）</button>

        <footer class="left-footer">
          <span>r 使用指南 · Enter/c 菜单 · n/p/y 复制 · Esc 返回 · Cmd+K 帮助</span>
        </footer>
      </aside>

      <section class="right">
        <header class="right-tabs">
          <button :class="{ active: rightTab === 'guide' }" @click="rightTab = 'guide'">使用指南</button>
        </header>

        <div v-if="rightTab === 'guide'" class="tab-body guide">
          <div v-if="!meta?.readme" class="empty">暂无 README</div>
          <div v-else class="readme-body" v-html="renderMarkdown(meta.readme)"></div>
          <button v-if="meta?.readme" class="copy-readme" @click="copyContent(meta.readme, '已复制 README')">复制 README</button>
        </div>
      </section>
    </div>

    </div><!-- /mode-create -->

    <!-- 管理模式：全局 npm 包 / Node 版本，两栏布局 -->
    <div v-else class="mode-manage">
      <div class="manage-grid">
        <!-- 左：Node 版本（点击切换右栏） -->
        <section class="manage-section">
          <header>
            <h4>Node 版本</h4>
            <span class="count" v-if="!loadingNode && !nodeErr">{{ nodeVerList.length }}</span>
            <span class="manager-tag" v-if="nodeManager && nodeManager !== 'system'">{{ nodeManager }}</span>
            <button class="refresh-btn" @click="loadNodeVersions" :disabled="loadingNode">刷新</button>
          </header>
          <div v-if="nodeErr" class="manage-error">⚠ {{ nodeErr }}</div>
          <div v-else-if="loadingNode" class="loading">加载中…</div>
          <ul v-else-if="nodeVerList.length" class="node-list">
            <li v-for="v in nodeVerList" :key="v.version"
                :class="{ current: v.current, 'current-global': v.currentGlobal, selected: selectedVersion?.version === v.version, unavailable: !v.available }"
                @click="selectVersion(v)">
              <span class="ver">{{ v.version }}</span>
              <span v-if="v.currentGlobal" class="badge accent" title="PATH 上的 node 指向这个版本（nvm alias default 设的就是它）">默认</span>
              <span v-else-if="v.current" class="badge warn" title="ZTools 渲染进程对应的 Node 版本">当前进程</span>
              <span v-if="!v.available" class="badge danger" title="该版本下找不到 npm 二进制">无 npm</span>
              <span class="row-actions" v-if="v.available" @click.stop>
                <button class="mini-btn"
                        :disabled="v.currentGlobal"
                        :title="v.currentGlobal ? '该版本已是 PATH 上的默认版本' : '复制 nvm use 命令到剪贴板'"
                        @click.stop="copySwitchCommand(v, 'use')">切换</button>
                <button class="mini-btn"
                        v-if="nodeManager === 'nvm' || nodeManager === 'nvm-windows' || nodeManager === 'fnm'"
                        :disabled="v.currentGlobal"
                        :title="v.currentGlobal ? '该版本已是 PATH 上的默认版本' : '复制 nvm alias default 命令到剪贴板'"
                        @click.stop="copySwitchCommand(v, 'default')">默认</button>
              </span>
            </li>
          </ul>
          <div v-else class="empty">未发现已安装的 Node 版本</div>
          <p v-if="nodeManager === 'system'" class="hint-static">未检测到 nvm / fnm / volta，仅显示当前进程版本；这种情况下「默认」以外的版本都是你手工装的副本，切换不通用。</p>
          <details class="hint-details" v-else>
            <summary>?</summary>
            <div>
              「<b>默认</b>」=PATH 上激活的 Node 版本。<b>切换</b> 复制 <code>nvm use &lt;ver&gt;</code>（当前 shell 生效）；<b>默认</b> 复制 <code>nvm alias default &lt;ver&gt;</code>（重启 shell 也生效）。默认版本自身的两个按钮已禁用。
            </div>
          </details>
          <details v-if="nodeDebugLog.length" class="node-debug">
            <summary>调试信息（{{ nodeDebugLog.length }}）</summary>
            <ul>
              <li v-for="(d, i) in nodeDebugLog" :key="i">{{ d }}</li>
            </ul>
          </details>
        </section>

        <!-- 右：所选版本下的全局包（更新 + 卸载 + 跨版本复制） -->
        <section class="manage-section">
          <header>
            <h4>已安装的全局包<span v-if="selectedVersion" class="hdr-sub">— {{ selectedVersion.version }}</span></h4>
            <span class="count" v-if="selectedVersion && !loadingVersionPkgs && !versionPkgsErr">{{ visibleVersionPkgs.length }}</span>
            <button v-if="selectedVersion && !showTools && hiddenToolsCount > 0" class="show-tools-btn" @click="showTools = true">含 {{ hiddenToolsCount }} 工具</button>
            <button v-else-if="selectedVersion && showTools && hiddenToolsCount > 0" class="show-tools-btn" @click="showTools = false">收起工具</button>
            <button v-if="selectedVersion && visibleVersionPkgs.length" class="update-all-btn" @click="updateAllPkgs" :disabled="busyPkgName === '*'">全部更新</button>
            <button v-if="selectedVersion" class="refresh-btn" @click="loadVersionPkgs" :disabled="loadingVersionPkgs">刷新</button>
          </header>
          <div v-if="!selectedVersion" class="empty">← 请选择左侧的 Node 版本</div>
          <div v-else-if="versionPkgsErr" class="manage-error">⚠ {{ versionPkgsErr }}</div>
          <div v-else-if="loadingVersionPkgs" class="loading">加载中…</div>
          <!-- 多选工具栏 + 包列表：合并进同一 v-else-if 分支（避免两条同条件的 v-else-if 互相吞掉） -->
          <div v-else-if="visibleVersionPkgs.length" class="pkg-pane">
            <div class="selection-bar">
              <label class="check-all">
                <input type="checkbox" :checked="checkedVisibleAll" @change="checkedVisibleAll ? clearSelection() : selectAllVisible()" />
                <span>全选当前列表</span>
              </label>
              <span class="selection-count" v-if="checkedCount > 0">已选 {{ checkedCount }} 个</span>
              <button v-if="checkedCount > 0" class="copy-to-btn" @click="openCopyDialog">复制到另一版本…</button>
              <button v-if="checkedCount > 0" class="clear-btn" @click="clearSelection">清空</button>
            </div>
            <ul class="pkg-list">
              <li v-for="p in visibleVersionPkgs" :key="p.name" :class="{ extraneous: p.extraneous, missing: p.missing, 'is-tool': isPkgManagerTool(p.name), checked: checkedPkgNames.has(p.name) }">
                <label class="pkg-check">
                  <input type="checkbox" :checked="checkedPkgNames.has(p.name)" @change="togglePkgCheck(p.name)" />
                </label>
                <div class="pkg-row1">
                  <span class="name">{{ p.name }}</span>
                  <span class="version">{{ p.version }}</span>
                  <span v-if="p.extraneous" class="badge warn">extraneous</span>
                  <span v-if="p.missing" class="badge danger">missing</span>
                </div>
                <div class="desc" v-if="p.description">{{ p.description }}</div>
                <div class="pkg-actions">
                  <button class="update-btn" @click="updatePkg(p)" :disabled="busyPkgName === p.name || busyPkgName === '*'">
                    {{ busyPkgName === p.name ? '更新中…' : '更新' }}
                  </button>
                  <button class="uninstall-btn" @click="askUninstallGlobal(p)" :disabled="busyPkgName === '*'">卸载</button>
                </div>
              </li>
            </ul>
          </div>
          <!-- deps 为 0 时：先把日志面板弹出来，确保用户能看见 npm 实际返回了什么 -->
          <div v-else class="empty-and-debug">
            <div class="empty">该版本下未发现已安装的全局包</div>
            <details v-if="versionPkgsDebug" class="version-debug" open>
              <summary>调试 · npm 实际返回</summary>
              <dl>
                <dt>npmBin</dt><dd>{{ versionPkgsDebug.npmBin }}</dd>
                <dt>prefix</dt><dd>{{ versionPkgsDebug.prefix }}</dd>
                <dt v-if="versionPkgsDebug.problems.length">problems</dt>
                <dd v-if="versionPkgsDebug.problems.length"><pre>{{ JSON.stringify(versionPkgsDebug.problems, null, 2) }}</pre></dd>
                <dt>stdout</dt><dd><pre>{{ versionPkgsDebug.rawStdout || '(空)' }}</pre></dd>
                <dt v-if="versionPkgsDebug.rawStderr">stderr</dt>
                <dd v-if="versionPkgsDebug.rawStderr"><pre>{{ versionPkgsDebug.rawStderr }}</pre></dd>
              </dl>
            </details>
          </div>
        </section>
      </div>

      <!-- 跨版本复制对话框 -->
      <div v-if="copyDialogOpen" class="menu-overlay" @click.self="closeCopyDialog" @keydown.escape="closeCopyDialog" tabindex="0">
        <div class="confirm-box copy-dialog">
          <h4>复制 {{ checkedCount }} 个包到另一 Node 版本</h4>
          <p class="confirm-hint">
            实际是在目标版本上 <code>npm install -g &lt;name&gt;@&lt;exactVer&gt;</code>，
            逐个包安装。因为不同 Node 版本 ABI 不同，部分 native 包即便版本相同也需要重装。
            <strong class="danger-text">会修改目标版本的全局目录</strong>，可能影响其他项目。
          </p>

          <div class="copy-target-row">
            <label>目标 Node 版本：</label>
            <select v-model="copyTargetVersion" :disabled="copyInProgress || nodeVerList.length === 0">
              <option v-for="v in nodeVerList" :key="v.version" :value="v">
                {{ v.version }}<span v-if="v.currentGlobal">（全局激活）</span><span v-if="!v.available">（无 npm）</span>
              </option>
            </select>
          </div>

          <label class="copy-mirror-row">
            <input type="checkbox" v-model="copyMirrorEnabled" :disabled="copyInProgress" />
            <span>使用国内镜像 <code>https://registry.npmmirror.com</code></span>
          </label>

          <details class="copy-preview">
            <summary>预览（{{ checkedCount }} 条命令）</summary>
            <pre>{{ copyPreviewCmd }}</pre>
          </details>

          <div class="copy-progress" v-if="copyInProgress">
            <div class="progress-bar"><div class="fill" :style="{ width: copyProgress.total ? (copyProgress.done / copyProgress.total * 100) + '%' : '0%' }"></div></div>
            <div class="progress-text">已处理 {{ copyProgress.done }} / {{ copyProgress.total }}</div>
          </div>
          <div class="progress-text error" v-if="copyProgress.lastError && !copyInProgress">{{ copyProgress.lastError }}</div>

          <div class="confirm-actions">
            <button ref="cancelBtnRef" @click="closeCopyDialog" :disabled="copyInProgress">取消</button>
            <button class="primary" @click="executeCopy" :disabled="copyInProgress || !copyTargetVersion">
              {{ copyInProgress ? '复制中…' : '开始复制' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <NpmSettings :open="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>

<style scoped>
.npm-panel {
  padding: 16px 20px;
  background: var(--bg-primary);
  color: var(--text-primary);
  position: relative;
  font-size: 13.5px;       /* 整体缩一级 */
  line-height: 1.45;
  height: 100%; display: flex; flex-direction: column;
}
ul { list-style: none; padding: 0; margin: 0; }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.id { font-family: var(--font-mono); font-weight: 500; }
.desc { color: var(--text-secondary); font-size: 0.9em; }
.hint-mini { color: var(--text-muted); font-size: 0.8em; margin-left: auto; font-family: var(--font-mono); }
.result-header { margin-bottom: 12px; }
.search-tip { color: var(--text-muted); font-size: 0.85em; font-family: var(--font-mono); }
.results li, .left ul li {
  padding: 12px 14px; cursor: pointer; border-radius: var(--radius); margin-bottom: 4px;
  border: 1px solid transparent; display: flex; align-items: center; gap: 12px;
  transition: background 0.1s, border-color 0.1s;
}
.results li:hover, .left ul li:hover { background: var(--bg-hover); }
.results li.active, .left ul li.active { background: var(--bg-hover); border-color: var(--accent); }
.name { font-family: var(--font-mono); font-weight: 500; }
.version { margin-left: auto; color: var(--text-secondary); font-size: 0.9em; font-family: var(--font-mono); }
.copy-hint { margin-left: auto; color: var(--text-muted); font-size: 0.72em; font-family: var(--font-mono); white-space: nowrap; }
.copy-hint kbd { background: var(--bg-hover); border: 1px solid var(--border); border-radius: 3px; padding: 0 5px; font-size: 0.9em; }
.src-tag { font-size: 0.7em; padding: 2px 8px; border-radius: 999px; font-weight: 500; }
.src-npm { background: var(--status-stable); color: white; }
.src-npmmirror { background: var(--status-beta); color: white; }
.ver { font-family: var(--font-mono); }
.time { color: var(--text-muted); font-size: 0.85em; font-family: var(--font-mono); margin-left: 8px; }
.status { font-size: 0.7em; padding: 2px 8px; border-radius: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
.status.stable { background: var(--status-stable); color: white; }
.status.rc { background: var(--status-snapshot); color: white; }
.status.beta { background: var(--status-beta); color: white; }
.status.alpha { background: var(--status-alpha); color: white; }
.status.dev { background: var(--status-snapshot); color: white; }
.latest-badge { background: var(--accent); color: white; font-size: 0.7em; padding: 2px 8px; border-radius: 12px; font-weight: 600; }
.dist-tag { color: var(--text-muted); font-size: 0.7em; border: 1px dashed var(--border); padding: 2px 6px; border-radius: 999px; }
.tabs { display: flex; gap: 4px; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.tab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--text-secondary); font-size: 0.9em; cursor: pointer; }
.tab.active { background: var(--accent); color: white; border-color: var(--accent); }
.tab-count { font-size: 0.75em; font-family: var(--font-mono); padding: 1px 6px; border-radius: 999px; background: rgba(128,128,128,0.2); }
.tab.active .tab-count { background: rgba(255,255,255,0.25); }
button { background: transparent; color: var(--accent); border: 1px solid var(--border); padding: 6px 12px; border-radius: var(--radius); font-size: 0.95em; cursor: pointer; }
button:hover { background: var(--bg-hover); }
.settings-btn { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
/* 顶部「开源 v{version}」轻量 link：用 anchor 套 github-icon + 文字 */
.footer-link {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent; border: none;
  padding: 4px 10px; color: var(--text-muted);
  font-size: 0.85em; font-family: var(--font-mono);
  border-radius: var(--radius); cursor: pointer;
  text-decoration: none;
}
.footer-link:hover { color: var(--accent); background: var(--bg-hover); text-decoration: none; }
/* GitHub mark —— CSS mask + currentColor，hover 时随链接文本色变化 */
.github-icon {
  display: inline-block; width: 14px; height: 14px;
  background-color: currentColor; flex-shrink: 0;
  -webkit-mask: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23000' d='M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'/%3E%3C/svg%3E") no-repeat center / contain;
  mask: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23000' d='M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'/%3E%3C/svg%3E") no-repeat center / contain;
}
.result-header .settings-btn { margin-left: 0; }
.side-btn { white-space: nowrap; }
.back-btn { display: inline-flex; align-items: center; gap: 5px; }
.more { margin-top: 12px; display: block; width: 100%; padding: 10px; }
.empty { color: var(--text-muted); padding: 32px 16px; text-align: center; }
.empty a { color: var(--accent); display: block; margin-top: 12px; text-decoration: none; }
.loading { padding: 32px; text-align: center; color: var(--text-muted); }
.error-box { padding: 12px 14px; background: var(--error-bg); border: 1px solid var(--error-border); border-radius: var(--radius); margin-bottom: 12px; }
.error-box pre { font-size: 0.85em; max-height: 240px; overflow: auto; white-space: pre-wrap; font-family: var(--font-mono); }
.err-toggle { cursor: pointer; list-style: none; }
footer { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 0.85em; font-family: var(--font-mono); }
.menu-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; backdrop-filter: blur(2px); }
.menu-box { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 10px; padding: 12px; min-width: 320px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); }
.menu-box button { display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; margin-bottom: 6px; padding: 12px 14px; }
.menu-box button.focused { background: var(--bg-hover); outline: 2px solid var(--accent); outline-offset: -2px; }
.menu-box button.is-global { color: var(--accent); }
.menu-box button.is-global .hint { color: var(--text-muted); opacity: 0.8; }
.menu-box .hint { color: var(--text-muted); font-size: 0.8em; font-family: var(--font-mono); }
.menu-sep { border: none; border-top: 1px solid var(--border); margin: 6px 4px; }

/* 全局安装二次确认弹窗 */
.confirm-box {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 10px; padding: 20px;
  min-width: 380px; max-width: 480px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.4);
}
.confirm-box h4 { margin: 0 0 8px 0; }
.confirm-hint { color: var(--text-secondary); font-size: 0.9em; margin: 0 0 12px 0; }
.confirm-box .cmd {
  background: var(--bg-hover); border: 1px solid var(--border);
  border-radius: 6px; padding: 10px 12px;
  font-family: var(--font-mono); font-size: 0.9em;
  white-space: pre-wrap; word-break: break-all;
  margin: 0 0 16px 0; color: var(--text-primary);
}
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.confirm-actions .primary { background: var(--accent); color: white; border-color: var(--accent); }
.confirm-actions .primary:hover { background: var(--accent-hover); }
.help-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 200; backdrop-filter: blur(2px); }
.help-box { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 10px; padding: 24px; min-width: 360px; box-shadow: 0 10px 40px rgba(0,0,0,0.4); }
.help-box h3 { margin-top: 0; }
.help-box li { padding: 6px 0; }
.readme-body { line-height: 1.7; overflow: auto; max-height: 60vh; }
.readme-body :deep(pre) { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; padding: 12px; overflow: auto; font-family: var(--font-mono); font-size: 0.88em; }
.readme-body :deep(code) { font-family: var(--font-mono); background: var(--bg-hover); padding: 1px 5px; border-radius: 3px; }
.readme-body :deep(pre code) { background: none; padding: 0; }
.readme-body :deep(a) { color: var(--accent); }
.readme-body :deep(table) { border-collapse: collapse; }
.readme-body :deep(th), .readme-body :deep(td) { border: 1px solid var(--border); padding: 6px 10px; }
.copy-readme { margin-top: 12px; display: block; }

/* 两栏布局：左侧版本 / 右侧使用指南 */
.detail { display: grid; grid-template-columns: minmax(280px, 36%) 1fr; gap: 16px; min-height: 100%; }
.left { display: flex; flex-direction: column; min-height: 0; }
.left header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.left .desc { color: var(--text-secondary); font-size: 0.85em; margin-bottom: 8px; }
.left ul { list-style: none; padding: 0; margin: 0; overflow: auto; flex: 1; }

/* 一级结果列表：撑满 .npm-panel 剩余高度，ul 内部滚动 */
.results { display: flex; flex-direction: column; min-height: 0; flex: 1; }
/* 顶部操作提示 + 数据源 tab：固定自然高度，永远不被 ul 滚动带走 */
.results > .result-header,
.results > .tabs { flex: none; }
.results ul { list-style: none; padding: 0; margin: 0; overflow: auto; flex: 1; min-height: 0; }

/* 模式切换器（左上角） */
.mode-switch {
  display: inline-flex; gap: 4px;
  padding: 4px; background: var(--bg-secondary);
  border: 1px solid var(--border); border-radius: 999px;
  margin-bottom: 16px;
}
.mode-switch button {
  background: transparent; color: var(--text-secondary);
  border: none; padding: 6px 16px; border-radius: 999px;
  font-size: 0.92em; font-weight: 500; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.mode-switch button:hover { background: var(--bg-hover); color: var(--text-primary); }
.mode-switch button.active {
  background: var(--accent); color: white;
}

/* 管理模式：两栏布局 */
.mode-manage { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.manage-grid {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px; flex: 1; min-height: 0;
  /* 让两个 grid cell 强制等高且各自独立滚动 */
  grid-auto-rows: 1fr;
  align-items: stretch;
}
.manage-section {
  display: flex; flex-direction: column; min-height: 0;
  /* overflow:hidden 把 section 钉成确定高度容器，内部的 <ul> 才会被允许 overflow:auto */
  overflow: hidden;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-secondary);
}
.manage-section > header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; margin: 0;
  border-bottom: 1px solid var(--border); border-radius: var(--radius) var(--radius) 0 0;
  flex: none;
}
.manage-section h4 { margin: 0; font-size: 1em; }
.manage-section .count {
  font-family: var(--font-mono); font-size: 0.78em;
  color: var(--text-muted);
  background: var(--bg-hover); padding: 1px 8px; border-radius: 999px;
}
.manage-section .manager-tag {
  font-family: var(--font-mono); font-size: 0.78em;
  color: var(--accent); border: 1px dashed var(--accent);
  padding: 1px 8px; border-radius: 999px;
}
.manage-section .refresh-btn { margin-left: auto; padding: 4px 10px; font-size: 0.85em; }
.manage-section .show-tools-btn {
  padding: 4px 10px; font-size: 0.78em;
  border: 1px dashed var(--border); color: var(--text-muted);
  background: transparent;
}
.manage-section .show-tools-btn:hover {
  border-color: var(--accent); color: var(--accent); background: transparent;
}
.manage-section .update-all-btn { padding: 4px 10px; font-size: 0.82em; }
.manage-section h4 .hdr-sub { color: var(--text-muted); font-weight: 400; font-size: 0.88em; margin-left: 4px; }

/* Node 版本列表项：可点击 + 选中态 */
.node-list li {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: var(--radius);
  border: 1px solid var(--border); margin-bottom: 6px;
  background: var(--bg-primary);
  font-family: var(--font-mono);
  cursor: pointer; user-select: none;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.node-list li:hover { border-color: var(--accent); }
.node-list li.selected {
  border-color: var(--accent);
  background: var(--bg-hover);
  box-shadow: inset 3px 0 0 var(--accent);
}
.node-list li.current {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--bg-hover);
}
.node-list li.current.selected { box-shadow: inset 3px 0 0 var(--accent), 0 0 0 2px var(--bg-hover); }
.node-list li.unavailable { opacity: 0.5; cursor: not-allowed; }
.node-list li.unavailable:hover { border-color: var(--border); }
.node-list .ver { font-weight: 500; }
/* 当前默认版本：左侧 3px accent 条 + 渐变 + 边框加粗 */
.node-list li.current-global {
  position: relative;
  border-color: var(--accent);
  border-width: 1.5px;
  background: linear-gradient(90deg, rgba(0, 102, 204, 0.22), rgba(0, 102, 204, 0.06) 60%, transparent);
}
.node-list li.current-global::before {
  content: '';
  position: absolute;
  left: 0; top: 6px; bottom: 6px; width: 3px;
  background: var(--accent);
  border-radius: 0 2px 2px 0;
}
.node-list li.current-global .ver::before {
  content: '◆ '; color: var(--accent); font-weight: 700;
}
.node-list li.current-global.selected {
  box-shadow: inset 3px 0 0 var(--accent), 0 0 0 2px var(--bg-hover);
}
/* 节点行末尾的小按钮（切换 / 默认） */
.node-list .row-actions { margin-left: auto; display: inline-flex; gap: 4px; }
.mini-btn {
  padding: 2px 8px; font-size: 0.72em;
  background: transparent; border: 1px solid var(--border);
  color: var(--text-muted); border-radius: var(--radius);
  cursor: pointer;
}
.mini-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); background: transparent; }
.mini-btn:disabled {
  opacity: 0.28;
  cursor: not-allowed;
  text-decoration: line-through;
  border-style: dashed;
}
/* 默认版本行的整体感 */
.node-list li.is-default .ver::before {
  content: '◆ '; color: var(--accent);
}
.pkg-list li.is-tool {
  border-style: dashed;
  background: var(--bg-secondary);
}
.pkg-list li.is-tool .name { color: var(--text-muted); }
/* 复选框：在 li 左侧 */
.pkg-list li { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: start; }
.pkg-list li.checked { background: var(--bg-hover); border-color: var(--accent); }
.pkg-list .pkg-check {
  display: flex; align-items: center; padding-top: 12px;
}
.pkg-list .pkg-check input[type="checkbox"] {
  width: 16px; height: 16px; cursor: pointer;
}
.pkg-list .pkg-row1,
.pkg-list .desc,
.pkg-list .pkg-actions { grid-column: 2; }

/* pkg-pane 包裹 selection-bar + pkg-list，让工具栏固定、列表滚动 */
.pkg-pane {
  display: flex; flex-direction: column; min-height: 0;
  flex: 1;
}
.pkg-pane > .pkg-list { flex: 1; min-height: 0; }

/* 多选工具栏 */
.selection-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 6px 10px; background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  font-size: 0.85em;
  flex: none;
}
.selection-bar .check-all {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
}
.selection-bar .selection-count { color: var(--accent); font-weight: 500; }
.selection-bar .copy-to-btn {
  padding: 4px 12px; font-size: 0.82em; border-color: var(--accent); color: var(--accent);
}
.selection-bar .copy-to-btn:hover { background: rgba(0, 102, 204, 0.08); }
.selection-bar .clear-btn {
  margin-left: auto; padding: 4px 10px; font-size: 0.82em;
}

/* 跨版本复制对话框 */
.copy-dialog { min-width: 480px; max-width: 560px; }
.copy-dialog .copy-target-row {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 12px; font-size: 0.92em;
}
.copy-dialog .copy-target-row select {
  flex: 1; padding: 6px 10px; font-size: 0.95em;
  background: var(--bg-primary); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: var(--radius);
}
.copy-dialog .copy-mirror-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 0; font-size: 0.88em; cursor: pointer;
}
.copy-dialog .copy-preview summary {
  cursor: pointer; color: var(--text-muted); font-size: 0.85em; user-select: none;
}
.copy-dialog .copy-preview pre {
  margin: 6px 0 0; padding: 8px 10px; background: var(--bg-primary);
  border: 1px solid var(--border); border-radius: 4px;
  font-family: var(--font-mono); font-size: 0.8em;
  white-space: pre-wrap; word-break: break-all; max-height: 160px; overflow: auto;
}
.copy-progress { margin: 12px 0; }
.progress-bar {
  height: 6px; background: var(--bg-hover); border-radius: 3px; overflow: hidden;
}
.progress-bar .fill {
  height: 100%; background: var(--accent); transition: width 0.2s;
}
.progress-text { font-size: 0.82em; color: var(--text-muted); margin-top: 4px; }
.progress-text.error { color: var(--error-border, #d32f2f); }
.danger-text { color: var(--error-border, #d32f2f); }
.manage-error {
  padding: 16px; color: var(--error-border, #d32f2f);
  font-size: 0.88em;
}

/* 列表 */
.pkg-list, .node-list { list-style: none; padding: 8px; margin: 0; overflow: auto; flex: 1; min-height: 0; }
.pkg-list li {
  padding: 10px 12px; border-radius: var(--radius);
  border: 1px solid var(--border); margin-bottom: 6px;
  background: var(--bg-primary);
}
.pkg-list li.extraneous { border-color: var(--status-beta); }
.pkg-list li.missing { border-color: var(--status-alpha); }
.pkg-row1 {
  display: flex; align-items: center; gap: 8px;
}
.pkg-row1 .name { font-family: var(--font-mono); font-weight: 500; }
.pkg-row1 .version {
  color: var(--text-secondary); font-family: var(--font-mono);
  font-size: 0.85em;
}
.pkg-list li .desc {
  color: var(--text-muted); font-size: 0.83em;
  margin-top: 4px; line-height: 1.4;
}
.pkg-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px; }
.update-btn {
  padding: 4px 12px; font-size: 0.82em;
  border-color: var(--accent); color: var(--accent);
}
.update-btn:hover:not(:disabled) { background: rgba(0, 102, 204, 0.08); }
.update-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.uninstall-btn {
  padding: 4px 12px; font-size: 0.82em;
  border-color: var(--error-border, #ffcdd2);
  color: var(--error-border, #d32f2f);
}
.uninstall-btn:hover:not(:disabled) { background: var(--error-bg, #fff3f3); }
.uninstall-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.badge {
  font-size: 0.7em; padding: 1px 7px; border-radius: 999px; font-weight: 500;
  font-family: var(--font-mono);
}
.badge.warn { background: var(--status-beta); color: white; }
.badge.danger { background: var(--status-alpha); color: white; }
.badge.accent { background: var(--accent); color: white; }

.node-list li {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: var(--radius);
  border: 1px solid var(--border); margin-bottom: 6px;
  background: var(--bg-primary);
  font-family: var(--font-mono);
}
.node-list li.current {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--bg-hover);
}
.node-list .ver { font-weight: 500; }

.mode-manage .hint {
  padding: 6px 14px; color: var(--text-muted); font-size: 0.8em;
  border-top: 1px solid var(--border); margin: 0; flex: none;
}
/* 提示折叠到 ? 里（默认合上，不占行） */
.mode-manage .hint-static,
.mode-manage .hint-details {
  padding: 6px 14px; color: var(--text-muted); font-size: 0.8em;
  border-top: 1px solid var(--border); margin: 0; flex: none;
}
.mode-manage .hint-details > summary {
  cursor: pointer; user-select: none; width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); border-radius: 50%;
  color: var(--text-muted); font-weight: 600;
}
.mode-manage .hint-details > summary:hover { color: var(--accent); border-color: var(--accent); }
.mode-manage .hint-details > div {
  margin-top: 6px; padding: 6px 4px;
  line-height: 1.5;
}
.node-debug {
  padding: 4px 14px 8px; border-top: 1px solid var(--border);
  flex: none; font-size: 0.78em;
}
.node-debug summary { cursor: pointer; color: var(--text-muted); user-select: none; }
.node-debug ul { padding: 4px 0 0 16px; margin: 0; color: var(--text-muted); font-family: var(--font-mono); }
.node-debug li { margin: 2px 0; line-height: 1.4; }

/* 版本选完后 0 条结果时的调试面板 */
.empty-and-debug { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.empty-and-debug .empty { flex: none; padding: 14px 16px; }
.empty-and-debug .version-debug {
  flex: 1; min-height: 0; overflow: auto;
  padding: 10px 16px; border-top: 1px solid var(--border);
  font-size: 0.78em; background: var(--bg-primary);
}
.empty-and-debug .version-debug summary {
  cursor: pointer; color: var(--text-muted); margin-bottom: 8px; user-select: none;
}
.empty-and-debug .version-debug dl {
  display: grid; grid-template-columns: 60px 1fr;
  gap: 4px 10px; margin: 0; font-family: var(--font-mono);
}
.empty-and-debug .version-debug dt { color: var(--text-muted); }
.empty-and-debug .version-debug dd { margin: 0; word-break: break-all; }
.empty-and-debug .version-debug pre {
  margin: 0; padding: 6px 8px; background: var(--bg-secondary);
  border-radius: 4px; white-space: pre-wrap; word-break: break-all;
  max-height: 240px; overflow: auto; font-size: 0.95em;
}
.left-footer { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 0.8em; font-family: var(--font-mono); }
.right { display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--border); padding-left: 16px; }
.right-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.right-tabs button { border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 8px 12px; background: transparent; color: var(--text-muted); font-weight: 500; }
.right-tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
.right-tabs button:hover { background: var(--bg-hover); border-radius: var(--radius); }
.tab-body { flex: 1; overflow: auto; min-height: 0; }
.tab-body.guide { display: flex; flex-direction: column; }

kbd { background: var(--bg-hover); padding: 2px 8px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.85em; border: 1px solid var(--border); }
</style>
