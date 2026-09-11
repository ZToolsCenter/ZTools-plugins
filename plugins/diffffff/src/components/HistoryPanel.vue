<!--
  历史面板（本任务自 HistoryDrawer 抽屉重构）：侧边栏「历史」页签的内嵌
  展示体（原右侧滑出抽屉随「文本对比 / 历史」头部切换方案撤除）。
  - 触发：App.vue 侧边栏头部「文本对比 / 历史」分段切换（sidebarTab）的
    history 页签下条件渲染，无独立显隐态；
  - 能力保持：顶部搜索框（即时过滤，走 core/historyModel 的
    searchHistoryItems）、条目数/上限说明、「清空」（确认弹窗，复用 App
    挂载的同一单例确认框 —— useConfirmDialog 是本地模块级单例，与
    useFileLoad 的覆盖确认同一条通道）、列表项（标题 / 相对时间 / +N −M
    徽标）、每项「恢复」（主）与「删除」（次，陶土红 ghost 图标钮）；
  - 恢复链路：本组件只 emit('restore', item) —— 写回文本 / 选项 / 语言、
    diffStore.run() 重算、切结果态的编排全部归 App.vue 的
    handleRestoreHistory（保持「store 动作 + 态切换」都在 App 层接线；
    面板自身不再关闭 —— 显隐由外层页签切换承担，恢复成功后由 App 把
    页签切回 workbench，见 handleRestoreHistory）。
  - 时间展示：相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前），超过 7 天
    回退绝对时间 YYYY-MM-DD HH:mm（「32 天前」不如具体日期可定位，该回退
    属同一相对时间方案的内部分段，非第二种格式方案）。
  - 空态：无历史「暂无历史对比」；有历史但搜索无命中「未找到匹配的历史」。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import UiButton from './ui/UiButton.vue'
import UiIcon from './ui/UiIcon.vue'
import UiInput from './ui/UiInput.vue'
import { useConfirmDialog } from '../composables/useConfirm'
import { HISTORY_MAX_ITEMS, searchHistoryItems } from '../core/historyModel'
import type { HistoryItem } from '../core/historyModel'
import { historyStore } from '../stores/history'

/** restore 上抛：App.vue 据此执行写回 + 重算 + 切回 workbench 页签并切结果态。 */
const emit = defineEmits<{
  'restore': [item: HistoryItem]
}>()

/** 搜索关键字（即时过滤，无防抖 —— 列表上限 100 条，纯内存过滤零成本）。 */
const query = ref('')

/** 过滤后的列表：搜索框空（含纯空白）时为全量，否则按 title/left/right 子串匹配。 */
const filtered = computed(() => searchHistoryItems(historyStore.items, query.value))

/** 是否处于搜索过滤中（条目数说明与空态文案的分流条件）。 */
const isSearching = computed(() => query.value.trim() !== '')

/** 确认框单例：清空确认复用 App.vue 挂载的 UiConfirmDialog（同一模块级单例）。 */
const { confirm } = useConfirmDialog()

/**
 * 清空全部历史：先确认（防误触，沿用 useFileLoad / 清空输入的确认惯例），
 * 确认后清空并复位搜索框（清空后搜索态失去意义，回全量视图更直观）。
 * 列表本为空时不弹确认直接忽略（与「清空两侧输入」的幂等短路口径一致）。
 */
async function handleClearAll(): Promise<void> {
  if (historyStore.items.length === 0) return
  const confirmed = await confirm({
    title: '清空历史',
    message: '清空全部已保存差异？此操作不可撤销。',
    type: 'warning',
    confirmText: '清空',
    cancelText: '取消',
  })
  if (!confirmed) return
  historyStore.clearAll()
  query.value = ''
}

/** 删除单条历史：无确认（单条删除可由再次对比低成本重建，细粒度轻操作直接执行）。 */
function handleRemove(item: HistoryItem): void {
  historyStore.remove(item.id)
}

/** 恢复单条：只上抛事件，编排归 App.vue（见组件文件头「恢复链路」）。 */
function handleRestore(item: HistoryItem): void {
  emit('restore', item)
}

/** 两位数补零（相对时间方案的绝对回退段用）。 */
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 入库时间的展示文案（相对时间方案）：不足 1 分钟「刚刚」，依次分钟 / 小时 /
 * 天递进；超过 7 天回退「YYYY-MM-DD HH:mm」绝对时间。未来时间戳（宿主时钟
 * 被拨回的极端情况）按「刚刚」处理，不出现负数文案。
 */
function formatSavedAt(savedAt: number): string {
  const elapsed = Math.max(0, Date.now() - savedAt)
  if (elapsed < 60_000) return '刚刚'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  const date = new Date(savedAt)
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  )
}
</script>

<template>
  <!--
    面板主体：占满侧边栏 .sidebar-body（与 workbench 页签的分组列同一滚动
    容器，纵向内滚不撑破面板）。内部排版（工具行 / 列表 / 空态）沿用原
    main.css 的 history-* 段。
  -->
  <div class="history-panel">
    <!-- 顶部工具行：搜索框 + 清空按钮 -->
    <div class="history-toolbar">
      <UiInput
        v-model="query"
        class="history-search"
        type="text"
        clearable
        placeholder="搜索标题或文本内容"
        aria-label="搜索历史对比"
      />
      <UiButton
        variant="secondary"
        class="history-clear"
        title="清空全部已保存差异"
        @click="handleClearAll"
      >
        清空
      </UiButton>
    </div>

    <!-- 条目数 / 上限说明：搜索中显示命中数 -->
    <p class="history-count" role="status">
      <template v-if="isSearching">
        匹配 {{ filtered.length }} 条 / 共 {{ historyStore.items.length }} 条
      </template>
      <template v-else>{{ historyStore.items.length }} / {{ HISTORY_MAX_ITEMS }} 条</template>
    </p>

    <!-- 列表：最新在前（store 维护的 savedAt 降序） -->
    <ul v-if="filtered.length > 0" class="history-list">
      <li v-for="item in filtered" :key="item.id" class="history-item">
        <div class="history-item-main">
          <!-- 标题：溢出省略，完整内容经 title 提示（deriveHistoryTitle 产物） -->
          <span class="history-item-title" :title="item.title">{{ item.title }}</span>
          <span class="history-item-meta">
            <span class="history-item-time">{{ formatSavedAt(item.savedAt) }}</span>
            <span class="history-badge is-add">+{{ item.stats.addedLines }}</span>
            <span class="history-badge is-del">−{{ item.stats.removedLines }}</span>
          </span>
        </div>
        <div class="history-item-actions">
          <!-- 恢复（主按钮）：emit 给 App 编排写回 + 重算 + 切结果态 -->
          <UiButton
            variant="primary"
            :title="`恢复「${item.title}」到工作台`"
            @click="handleRestore(item)"
          >
            恢复
          </UiButton>
          <!-- 删除（次动作，陶土红 ghost 图标钮）：直接执行不弹确认（见 handleRemove） -->
          <UiButton
            variant="ghost"
            tone="danger"
            class="history-item-delete"
            title="删除该条历史"
            aria-label="删除该条历史"
            @click="handleRemove(item)"
          >
            <UiIcon name="trash" :size="14" />
          </UiButton>
        </div>
      </li>
    </ul>
    <!--
      空态：无历史（未搜索）→ 引导文案；有历史但搜索无命中 → 精确说明。
      样式（.history-empty）见 main.css 的 history 段。
    -->
    <div v-else class="history-empty">
      {{ isSearching ? '未找到匹配的历史' : '暂无历史对比' }}
    </div>
  </div>
</template>

<style scoped>
/* 面板主体：占满侧边栏主体区（padding 由 .history-panel 自理，与原抽屉 body 对齐） */
.history-panel {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
}

/* 清空按钮：不随 UiInput 满宽（flex 定宽，与搜索框同行） */
.history-clear {
  flex: none;
}
</style>
