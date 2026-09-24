<script setup lang="ts">
import { onMounted, ref, computed, watch, nextTick } from 'vue'
import ToolboxLayout from './toolbox/ToolboxLayout.vue'
import HomePage from './toolbox/HomePage.vue'
import { toolMap, categories, type Tool } from './toolbox/tools'

const route = ref('')
const isDev = ref(false)

// 多标签状态：已开 tab（按打开顺序）+ 当前激活 tab（空串 = 无激活 tab，显示首页）
const openTabCodes = ref<string[]>([])
const activeCode = ref('')

// 常用工具：按打开/激活次数自动统计，持久化到 ZTools dbStorage（无宿主环境时仅内存）
const USAGE_KEY = 'devbox.toolUsage'
const FREQ_LIMIT = 8
const usageCounts = ref<Record<string, number>>({})

function loadUsage() {
  try {
    const raw = (window as any).ztools?.dbStorage?.getItem?.(USAGE_KEY)
    if (raw) usageCounts.value = JSON.parse(raw) || {}
  } catch {
    // 存储损坏时按空数据重新统计
  }
}

function persistUsage() {
  try {
    ;(window as any).ztools?.dbStorage?.setItem?.(USAGE_KEY, JSON.stringify(usageCounts.value))
  } catch {
    // 存储失败不影响使用，下次再试
  }
}

watch(usageCounts, persistUsage, { deep: true })

// 注册顺序索引：次数相同时按工具注册顺序稳定排序
const toolOrder = new Map([...toolMap.keys()].map((code, i) => [code, i]))

const frequentTools = computed<Tool[]>(() =>
  Object.entries(usageCounts.value)
    .filter(([code, count]) => count > 0 && toolMap.has(code))
    .sort(
      (a, b) =>
        (b[1] as number) - (a[1] as number) ||
        (toolOrder.get(a[0]) ?? 0) - (toolOrder.get(b[0]) ?? 0)
    )
    .slice(0, FREQ_LIMIT)
    .map(([code]) => toolMap.get(code) as Tool)
)

const openTabs = computed(() =>
  openTabCodes.value
    .map((code) => toolMap.get(code))
    .filter((t) => !!t)
)

const activeTool = computed(() => toolMap.get(activeCode.value) ?? null)

function setActive(code: string) {
  activeCode.value = code
}

/** 打开工具：已开则激活，未开则新开 tab 并激活；同时计入常用统计 */
function openTab(code: string) {
  if (!toolMap.has(code)) return
  if (!openTabCodes.value.includes(code)) {
    openTabCodes.value.push(code)
  }
  setActive(code)
  usageCounts.value[code] = (usageCounts.value[code] || 0) + 1
}

/** 关闭 tab：若是激活 tab 则激活右侧邻 tab（末尾则左侧），全部关完显示首页 */
function closeTab(code: string) {
  const idx = openTabCodes.value.indexOf(code)
  if (idx === -1) return
  openTabCodes.value.splice(idx, 1)
  if (activeCode.value !== code) return
  const next = openTabCodes.value[idx] || openTabCodes.value[idx - 1]
  setActive(next ?? '')
}

// feature cmds 来自 tools.ts 注册表（新增工具时需与 public/plugin.json 的 cmds 同步维护）。
// 用于区分「真实 feature 触发」与「点击插件图标进入」：后者宿主会伪装成第一个 feature 的
// text 触发（code=第一个feature，payload=用户搜索词，实测搜 "dev" 点图标 → payload="dev"），
// 搜索词命中的是插件名而非 feature 的 cmds；真实关键词触发时 payload 与 cmds 精确或前缀匹配。
const featureCmds = new Map<string, string[]>(
  [...toolMap.values()].map((t) => [t.code, t.cmds.map((c) => c.toLowerCase())])
)

// 宿主对「主界面点击插件图标」固定回传 plugin.json 第一个 feature 的 code；
// 快捷键进入则回传绑定的 feature 的 code（实测 payload 为空、from 不填充）
const FIRST_FEATURE_CODE = categories[0].tools[0].code

function setRoute(action?: any) {
  route.value = 'toolbox'
  if (isFeatureTrigger(action)) {
    // 关键词/划词/图片/文件等 feature 触发：打开/激活对应工具，保留已开的其他 tab
    openTab(action.code)
  }
  // 点击插件图标进入或无指令进入：保持现状，无已开标签时显示首页
}

/** 是否为真实的 feature 触发（区别于点击插件图标进入） */
function isFeatureTrigger(action?: any): boolean {
  const code = action?.code
  if (!code || !toolMap.has(code)) return false
  if (action.type && action.type !== 'text') return true // 划词/图片/文件等，payload 即内容本身
  const payload = String(action.payload ?? '').trim().toLowerCase()
  if (payload) {
    // 有搜索词：命中该 feature 的 cmds（精确或前缀）才是关键词触发，否则是图标点击
    const cmds = featureCmds.get(code)
    if (!cmds || !cmds.length) return true // cmds 缺失时退化为「有 payload 即触发」
    return cmds.some((cmd) => cmd === payload || cmd.startsWith(payload))
  }
  // 无搜索词的 text 进入：快捷键（from 非 main，或 code 不是首个 feature）→ 真实触发；
  // 主界面图标点击（宿主固定回传首个 feature）→ 保持现状/首页
  if (action.from && action.from !== 'main') return true
  return code !== FIRST_FEATURE_CODE
}

onMounted(async () => {
  const ztools = (window as any).ztools

  loadUsage()

  if (!ztools) {
    isDev.value = true
    setRoute()
    return
  }

  ztools.setExpendHeight(600)

  ztools.onPluginEnter((action: any) => {
    setRoute(action)
  })

  ztools.onPluginOut(() => {
    // 插件只是隐藏到后台：保留 route 与全部标签状态，下次进入无缝恢复
    // （清空 route 会卸载整个页面，重进时若 enter 时序异常会导致黑屏）
  })

  await nextTick()
  setTimeout(() => {
    if (!route.value) {
      try {
        const action = ztools.getLaunchAction?.()
        setRoute(action)
      } catch (e) {
        setRoute()
      }
    }
  }, 100)
})
</script>

<template>
  <!-- 主视图：route 为空（enter 未到达的时序异常）时同样渲染，保证不黑屏 -->
  <ToolboxLayout
    v-if="route === 'toolbox' || !route"
    :tabs="openTabs"
    :active-code="activeCode"
    @select="openTab"
    @close="closeTab"
  >
    <!-- KeepAlive 保证切换/重开 tab 时各工具状态保留；无激活 tab 时显示首页 -->
    <KeepAlive>
      <component
        v-if="activeTool"
        :is="activeTool.component"
        :key="activeCode"
      />
    </KeepAlive>
    <HomePage
      v-if="!activeTool"
      :frequent="frequentTools"
      @select="openTab"
    />
  </ToolboxLayout>

  <!-- 开发模式提示（无宿主环境且 route 为空） -->
  <div v-if="isDev && !route" class="dev-hint">
    <p>开发模式：请在 ZTools 中使用插件</p>
  </div>
</template>

<style scoped>
.dev-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: #666;
  font-size: 14px;
}
</style>
