<script setup lang="ts">
import { onMounted, ref } from 'vue'
import FolderList from './components/FolderList.vue'
import { folders, settings, displayName } from './store'
import type { TerminalType } from './types'

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

// 粘贴/拖入文件夹触发：用默认终端秒开，成功后自动退出插件
function openFromPayload(payload: unknown) {
  const target = extractPath(payload)
  if (target) openAndExit(target)
}

// 打开目标目录并退出插件；terminal 传 undefined 时走默认终端设置/自动探测
// 返回实际使用的终端类型，失败返回 null
function openAndExit(target: string, terminal?: string): TerminalType | null {
  try {
    const res = window.services.openInTerminal(target, terminal || settings.value.defaultTerminal || 'auto')
    return res.type
  } catch (e) {
    window.ztools.showNotification('QuickTerm: ' + ((e as Error).message || '打开失败'))
    return null
  } finally {
    window.ztools.outPlugin()
  }
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
}

const MAX_PUSH_RESULTS = 10

// 根据主输入框内容生成候选：
// 1. 输入像路径且真实存在 → 「直接打开」项（文件自动取父目录）
// 2. 按名称/路径关键字过滤收藏列表
function buildPushList(input: string): QtPushItem[] {
  const q = input.trim().replace(/^"(.*)"$/, '$1')
  if (!q) return []
  const results: QtPushItem[] = []

  if (looksLikePath(q)) {
    try {
      const resolved = window.services.normalizeTarget(q)
      results.push({ icon: 'logo.png', title: '在终端中打开', text: resolved, _qtPath: resolved })
    } catch {
      // 不是有效路径，静默跳过，继续走收藏搜索
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
        _qtTerminal: item.terminal
      })
    }
  }
  return results
}

onMounted(() => {
  // 跟随 ZTools 明暗主题，切换 Element Plus 暗色变量（html.dark）
  document.documentElement.classList.toggle('dark', !!window.ztools.isDarkColors())

  window.ztools.onPluginEnter((action) => {
    if (action.code === 'open-folder') {
      openFromPayload(action.payload)
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
        openAndExit(option._qtPath, option._qtTerminal)
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
