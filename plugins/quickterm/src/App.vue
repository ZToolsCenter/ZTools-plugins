<script setup lang="ts">
import { onMounted, ref } from 'vue'
import FolderList from './components/FolderList.vue'
import { folders, settings, displayName } from './store'

// open-folder 触发时不渲染 UI（秒开终端后立即退出插件），panel/search 解析失败时显示面板
const showPanel = ref(false)
// 主输入框搜索关键字：无法唯一解析时带进面板，过滤列表供用户选择
const searchKeyword = ref('')

// 从 payload 提取路径字符串：
// files 触发时 payload 可能是字符串数组，也可能是文件信息对象数组（{ path, name, isDirectory, ... }）
// over/text 触发时 payload 是用户输入的文本
function extractPath(payload: unknown): string {
  let item: unknown = Array.isArray(payload) ? payload[0] : payload
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>
    return String(o.path ?? o.filePath ?? '').trim()
  }
  return String(item ?? '').trim()
}

// 统一「执行打开动作后退出插件」：失败走系统通知，退出不因失败阻断
function exitAfter(open: () => unknown) {
  try {
    open()
  } catch (e) {
    window.ztools.showNotification('QuickTerm: ' + ((e as Error).message || '打开失败'))
  } finally {
    window.ztools.outPlugin()
  }
}

// 粘贴/拖入触发：kind 决定打开方式（终端 / 资源管理器）
function openFromPayload(payload: unknown, kind: 'terminal' | 'explorer' = 'terminal') {
  const target = extractPath(payload)
  if (!target) return
  if (kind === 'explorer') openExplorerAndExit(target)
  else openAndExit(target)
}

// 在终端打开目标目录并退出插件；terminal 传 undefined 时走默认终端设置/自动探测
function openAndExit(target: string, terminal?: string): void {
  exitAfter(() => window.services.openInTerminal(target, terminal || settings.value.defaultTerminal || 'auto'))
}

// 在系统资源管理器中打开目标并退出插件（文件则选中该文件）
function openExplorerAndExit(target: string): void {
  exitAfter(() => {
    // preload 旧版（ZTools 未完全重启）时显式报错，避免静默退出
    if (typeof window.services.openInFileManager !== 'function') {
      throw new Error('服务为旧版本，请完全退出 ZTools 后重新启动再试')
    }
    return window.services.openInFileManager(target)
  })
}

// 判断文本是否为路径形态（含 \ / 或盘符前缀）
function looksLikePath(q: string): boolean {
  return /[\\/]/.test(q) || /^[a-zA-Z]:/.test(q)
}

// 把用户输入解析为可打开的目录，解析失败返回 null：
// 1. 路径形态 → 直接校验，文件自动取父目录
// 2. 收藏名称/路径精确匹配 → 唯一模糊匹配（如输入 babe → D:\zsm\code\babe）
function resolveOpenTarget(text: string): { path: string; terminal?: string } | null {
  const q = text.trim().replace(/^"(.*)"$/, '$1')
  if (!q) return null
  const lower = q.toLowerCase()

  if (looksLikePath(q)) {
    try {
      return { path: window.services.normalizeTarget(q) }
    } catch {
      // 路径无效，继续尝试收藏匹配
    }
  }

  const exact = folders.value.find(
    (f) => displayName(f.path).toLowerCase() === lower || f.path.toLowerCase() === lower
  )
  if (exact) return { path: exact.path, terminal: exact.terminal }

  const matches = folders.value.filter(
    (f) => displayName(f.path).toLowerCase().includes(lower) || f.path.toLowerCase().includes(lower)
  )
  if (matches.length === 1) {
    return { path: matches[0].path, terminal: matches[0].terminal }
  }
  return null
}

// ---------- 主输入框搜索（mainPush） ----------

// 推送结果项：在 MainPushResult 基础上挂自定义字段，选中时回读
interface QtPushItem {
  icon?: string
  title?: string
  text: string
  _qtPath?: string
  _qtTerminal?: string
  _qtKind?: 'terminal' | 'explorer'
}

const MAX_PUSH_RESULTS = 10

// 根据主输入框内容生成候选：
// 1. 输入像路径且真实存在 → 「在终端中打开」+「在资源管理器中打开」双候选
//    （终端候选经 normalizeTarget，文件折算为父目录；资源管理器候选保留原路径，文件走 /select 选中）
// 2. 按名称/路径关键字过滤收藏列表，每个条目同样出双候选
function buildPushList(input: string): QtPushItem[] {
  const q = input.trim().replace(/^"(.*)"$/, '$1')
  if (!q) return []
  const results: QtPushItem[] = []

  if (looksLikePath(q)) {
    try {
      const resolved = window.services.normalizeTarget(q)
      results.push({
        icon: 'logo.png',
        title: '在终端中打开',
        text: resolved,
        _qtPath: resolved,
        _qtKind: 'terminal'
      })
    } catch {
      // 不是有效路径，静默跳过，继续走收藏搜索
    }
    try {
      const st = window.services.statPath(q)
      results.push({
        icon: 'logo.png',
        title: '在资源管理器中打开',
        text: st.path,
        _qtPath: st.path,
        _qtKind: 'explorer'
      })
    } catch {
      // 同上
    }
  }

  const lower = q.toLowerCase()
  for (const item of folders.value) {
    if (results.length >= MAX_PUSH_RESULTS) break
    if (displayName(item.path).toLowerCase().includes(lower) || item.path.toLowerCase().includes(lower)) {
      results.push({
        icon: 'logo.png',
        title: displayName(item.path),
        text: item.path,
        _qtPath: item.path,
        _qtTerminal: item.terminal,
        _qtKind: 'terminal'
      })
      if (results.length < MAX_PUSH_RESULTS) {
        results.push({
          icon: 'logo.png',
          title: displayName(item.path) + '（资源管理器）',
          text: item.path,
          _qtPath: item.path,
          _qtKind: 'explorer'
        })
      }
    }
  }
  return results
}

onMounted(() => {
  // 跟随 ZTools 明暗主题，切换 Element Plus 暗色变量（html.dark）
  document.documentElement.classList.toggle('dark', !!window.ztools.isDarkColors())

  window.ztools.onPluginEnter((action) => {
    if (action.code === 'open-folder') {
      openFromPayload(action.payload, 'terminal')
    } else if (action.code === 'open-explorer' || action.code === 'open-explorer-file') {
      // 粘贴/拖入文件夹或文件 → 秒开资源管理器（文件则选中）
      openFromPayload(action.payload, 'explorer')
    } else if (action.code === 'search') {
      // 主输入框文本 → 选中「在终端中打开」入口（over 指令）
      // 文本先解析：路径形态直接校验；否则匹配收藏列表（输入 babe → D:\zsm\code\babe）
      const text = extractPath(action.payload)
      const resolved = resolveOpenTarget(text)
      if (resolved) {
        openAndExit(resolved.path, resolved.terminal)
        searchKeyword.value = ''
      } else if (text) {
        // 无法唯一解析（多个模糊匹配 / 无匹配）：进入面板按关键字过滤，让用户选择
        searchKeyword.value = text
        showPanel.value = true
      }
    } else if (action.code === 'search-explorer') {
      // 主输入框文本 → 选中「在资源管理器中打开」入口（over 指令），解析规则与终端入口一致
      const text = extractPath(action.payload)
      const resolved = resolveOpenTarget(text)
      if (resolved) {
        openExplorerAndExit(resolved.path)
        searchKeyword.value = ''
      } else if (text) {
        searchKeyword.value = text
        showPanel.value = true
      }
    } else if (action.code === 'panel') {
      showPanel.value = true
    }
  })

  // 主输入框搜索：输入时推送候选，选中直接打开并退出
  window.ztools.onMainPush(
    (action) => buildPushList(String(action.payload ?? '')),
    (action) => {
      const option = action.option as QtPushItem
      if (option && option._qtPath) {
        if (option._qtKind === 'explorer') openExplorerAndExit(option._qtPath)
        else openAndExit(option._qtPath, option._qtTerminal)
      }
    }
  )

  window.ztools.onPluginOut(() => {
    showPanel.value = false
    searchKeyword.value = ''
  })
})
</script>

<template>
  <FolderList v-if="showPanel" :keyword="searchKeyword" />
</template>
