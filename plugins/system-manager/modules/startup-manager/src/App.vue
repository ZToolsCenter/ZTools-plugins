<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { filterItems, kindLabel, summarize, type Filters } from './composables/startupLogic'
import { useStartupManager } from './composables/useStartupManager'
import { useStartupGrouping, type StartupGroup } from './composables/useStartupGrouping'
import type { StartupItem } from './types/startup'

const manager = useStartupManager()
const filters = reactive<Filters>({ query: '', scope: 'all', state: 'all', kind: 'all' })
const items = computed(() => manager.report.value?.items ?? [])
const visibleItems = computed(() => filterItems(items.value, filters))
const summary = computed(() => summarize(items.value))
const kinds = computed(() => [...new Set(items.value.map((item) => item.kind))])
const platformName = computed(() => ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' })[manager.report.value?.platform || 'linux'])

const { groups, toggleGroupExpand } = useStartupGrouping(visibleItems)

function stateLabel(item: StartupItem) {
  if (item.running) return '运行中'
  if (item.enabled === false) return '已停用'
  if (item.enabled === true) return '已启用'
  return '状态未知'
}

async function requestToggle(item: StartupItem) {
  if (!item.action.canToggle || item.enabled == null) return
  const enabled = !item.enabled
  await manager.toggle(item, enabled)
}

async function toggleGroup(group: StartupGroup) {
  if (!group.canToggleAll) return
  // If not all enabled, toggle all to enabled; otherwise disable all
  const targetState = !group.allEnabled
  const actionText = targetState ? '启用' : '停用'
  
  const manageableItems = group.items.filter(i => i.action?.canToggle && i.enabled !== targetState)
  if (manageableItems.length === 0) return

  for (const item of manageableItems) {
    await manager.toggle(item, targetState)
  }
}

function resetFilters() {
  filters.query = ''
  filters.scope = 'all'
  filters.state = 'all'
  filters.kind = 'all'
}

onMounted(manager.scan)
</script>

<template>
  <main class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">SYSTEM STARTUP</p>
        <h1>开机启动管理</h1>
        <p class="subtitle">看清谁会随电脑启动，支持按父应用一键全部开启/关闭，或单独管理子进程。</p>
      </div>
      <button class="refresh" :disabled="manager.loading.value || !manager.bridgeAvailable.value" @click="manager.scan">
        <span :class="{ spin: manager.loading.value }">↻</span>{{ manager.loading.value ? '扫描中' : '重新扫描' }}
      </button>
    </header>

    <div v-if="!manager.bridgeAvailable.value" class="notice danger" role="alert">请在 ZTools 中打开插件，本地能力桥当前不可用。</div>
    <div v-if="manager.error.value" class="notice danger" role="alert">{{ manager.error.value }}</div>
    <div v-if="manager.report.value?.warnings.length" class="notice warning" role="status">
      <strong>部分来源未读取</strong><span>{{ manager.report.value.warnings.join('；') }}</span>
    </div>

    <section class="stats" aria-label="启动项摘要">
      <article><strong>{{ summary.total }}</strong><span>{{ platformName }} 项目</span></article>
      <article><strong>{{ summary.enabled }}</strong><span>已启用</span></article>
      <article><strong>{{ summary.running }}</strong><span>正在运行</span></article>
      <article><strong>{{ summary.manageable }}</strong><span>可安全管理</span></article>
    </section>

    <section class="toolbar" aria-label="筛选启动项">
      <label class="search"><span>⌕</span><input v-model="filters.query" type="search" placeholder="搜索名称、来源或命令" aria-label="搜索" /></label>
      <select v-model="filters.scope" aria-label="范围"><option value="all">全部范围</option><option value="user">当前用户</option><option value="system">系统级</option></select>
      <select v-model="filters.state" aria-label="状态"><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select>
      <select v-model="filters.kind" aria-label="类型"><option value="all">全部类型</option><option v-for="kind in kinds" :key="kind" :value="kind">{{ kindLabel(kind) }}</option></select>
    </section>

    <section class="list" aria-live="polite" :aria-busy="manager.loading.value">
      <!-- 按应用/服务分组列表展示 -->
      <article v-for="group in groups" :key="group.key" class="group-card">
        <!-- 父级卡片 Header -->
        <div class="group-header">
          <div class="group-info" @click="toggleGroupExpand(group.key)">
            <div class="group-icon-wrap">
              <img v-if="group.icon" :src="group.icon" class="group-app-icon" alt="" />
              <div v-else class="app-icon-fallback">{{ group.name.slice(0, 1).toUpperCase() }}</div>
            </div>
            <div class="group-meta">
              <div class="group-title-row">
                <h2 class="group-name">{{ group.name }}</h2>
                <span class="sub-count-badge">{{ group.items.length }} 个子服务/进程</span>
              </div>
              <p class="group-status-desc">
                已启用 {{ group.enabledCount }} / {{ group.totalCount }}
                <span v-if="group.items.length > 1" class="expand-hint">（点击{{ group.isExpanded ? '收起' : '展开' }}明细）</span>
              </p>
            </div>
          </div>

          <div class="group-actions">
            <button 
              v-if="group.canToggleAll" 
              class="switch" 
              :class="{ on: group.allEnabled, partial: !group.allEnabled && !group.noneEnabled }" 
              role="switch" 
              :aria-checked="group.allEnabled" 
              :title="group.allEnabled ? '一键全部停用' : '一键全部开启'"
              @click.stop="toggleGroup(group)"
            >
              <span />
            </button>
            <span v-else class="readonly">系统级</span>
            <button class="btn-expand" @click="toggleGroupExpand(group.key)" :aria-label="group.isExpanded ? '收起' : '展开'">
              {{ group.isExpanded ? '▲' : '▼' }}
            </button>
          </div>
        </div>

        <!-- 子进程/子项明细列表 -->
        <div v-show="group.isExpanded" class="group-children">
          <div v-for="item in group.items" :key="item.id" class="child-item-row">
            <div class="child-main">
              <div class="child-identity">
                <div class="child-title-row">
                  <span class="child-name">{{ item.name }}</span>
                  <span class="badge" :class="`impact-${item.impact.level}`">
                    {{ item.impact.level === 'high' ? '高影响' : item.impact.level === 'medium' ? '中影响' : item.impact.level === 'low' ? '低影响' : '影响未知' }}
                  </span>
                </div>
                <p class="child-sub">{{ kindLabel(item.kind) }} · {{ item.source.label }} · {{ item.trigger }}</p>
              </div>
              
              <div class="child-state" :class="{ running: item.running, disabled: item.enabled === false }">
                <i />{{ stateLabel(item) }}
              </div>

              <div class="child-control">
                <button 
                  v-if="item.action.canToggle && item.enabled != null" 
                  class="switch sub-switch" 
                  :class="{ on: item.enabled }" 
                  role="switch" 
                  :aria-checked="item.enabled" 
                  :disabled="manager.busyItems.value.has(item.id)" 
                  @click="requestToggle(item)"
                >
                  <span />
                </button>
                <span v-else class="readonly" :title="item.action.reason || ''">只读</span>
              </div>
            </div>

            <details class="child-details">
              <summary>查看位置与运行命令</summary>
              <dl>
                <div><dt>位置</dt><dd>{{ item.source.location || '未提供' }}</dd></div>
                <div><dt>启动命令</dt><dd>{{ item.commandSummary || '未提供' }}</dd></div>
                <div><dt>影响判断</dt><dd>{{ item.impact.reasons.join('；') }}（启发式判断）</dd></div>
                <div v-if="!item.action.canToggle"><dt>管理限制</dt><dd>{{ item.action.reason }}</dd></div>
              </dl>
            </details>
          </div>
        </div>
      </article>

      <div v-if="!manager.loading.value && visibleItems.length === 0" class="empty">
        <span>○</span><h2>{{ items.length ? '没有符合条件的项目' : '没有发现启动项' }}</h2><p>{{ items.length ? '试试清除筛选条件。' : '部分系统可能需要额外权限才能读取登录项。' }}</p>
        <button v-if="items.length" type="button" @click="resetFilters">重置筛选</button>
        <button v-else type="button" :disabled="!manager.bridgeAvailable.value" @click="manager.scan">重新扫描</button>
      </div>
    </section>

    <div v-if="manager.lastOperation.value" class="toast" role="status">
      <span>已更新 {{ manager.lastOperation.value.itemName }}</span><button @click="manager.undo">撤销</button>
    </div>

    <footer><span>系统级项目始终只读 · 支持按父应用多服务联动开启/关闭</span><span v-if="manager.report.value">扫描于 {{ new Date(manager.report.value.generatedAt).toLocaleTimeString() }}</span></footer>
  </main>
</template>
