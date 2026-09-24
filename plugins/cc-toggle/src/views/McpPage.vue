<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { ref, computed, onMounted, nextTick } from 'vue';
  import { useRouter } from 'vue-router';
  import { ArrowBackOutline } from '@vicons/ionicons5';
  import { useMcp } from '../composables/useMcp';
  import { APP_LABELS, APP_ICONS } from '../composables/shared';
  import McpCard from '../components/mcp/McpCard.vue';
  import McpForm from '../components/mcp/McpForm.vue';

  const dialog = useDialog();

  const router = useRouter();
  const {
    mcpServers,
    loadServers,
    saveServer,
    deleteServer,
    toggleServer,
    getServer,
    syncFromConfigFiles
  } = useMcp();

  const showForm = ref(false);
  const editingId = ref(null);
  const formInitialData = ref(null);
  const syncing = ref(false);

  async function onSync() {
    syncing.value = true;
    await nextTick();
    await new Promise(function (r) {
      setTimeout(r, 50);
    });
    try {
      syncFromConfigFiles();
    } finally {
      syncing.value = false;
    }
  }

  const AGENT_APPS = [
    { key: 'claude', label: 'Claude' },
    { key: 'claude-desktop', label: 'Claude Desktop' },
    { key: 'codex', label: 'Codex' },
    { key: 'openclaw', label: 'OpenClaw' },
    { key: 'opencode', label: 'OpenCode' }
  ];

  const agentStats = computed(() => {
    var counts = {};
    AGENT_APPS.forEach(function (f) {
      counts[f.key] = 0;
    });
    mcpServers.value.forEach(function (s) {
      (s.apps || []).forEach(function (app) {
        if (counts.hasOwnProperty(app)) counts[app] += 1;
      });
    });
    return AGENT_APPS.map(function (f) {
      return {
        app: f.key,
        label: f.label,
        icon: APP_ICONS[f.key] || null,
        count: counts[f.key] || 0
      };
    });
  });

  onMounted(() => loadServers());

  function onAdd() {
    editingId.value = null;
    formInitialData.value = null;
    showForm.value = true;
  }

  function onEdit(id) {
    editingId.value = id;
    formInitialData.value = getServer(id);
    showForm.value = true;
  }

  function onDelete(id) {
    dialog.warning({
      title: '删除 MCP Server',
      content: '确定删除该 MCP Server？删除后将自动清理关联应用配置文件中的对应条目。',
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: function () {
        deleteServer(id);
      }
    });
  }

  function onSave(data) {
    saveServer(data);
    showForm.value = false;
    editingId.value = null;
  }

  function onUpdateApps(id, apps) {
    var server = getServer(id);
    if (server) saveServer(Object.assign({}, server, { apps: apps }));
  }
</script>

<template>
  <div class="page">
    <n-page-header @back="router.back()">
      <template #title>
        <span>MCP 管理</span>
        <n-tag size="tiny" :bordered="false" round style="margin-left: 8px">{{
          mcpServers.length
        }}</n-tag>
      </template>
      <template #extra>
        <n-space :size="6">
          <n-button
            size="small"
            quaternary
            :disabled="syncing"
            @click="onSync"
            title="从 Agent 配置文件同步 MCP Server"
          >
            <span class="sync-icon" :class="{ 'sync-icon--spinning': syncing }">↻</span> 刷新
          </n-button>
          <n-button type="primary" size="small" @click="onAdd">+ 添加</n-button>
        </n-space>
      </template>
    </n-page-header>

    <div class="dash-grid">
      <div
        v-for="stat in agentStats"
        :key="stat.app"
        class="dash-card"
        :class="{ 'dash-card--zero': stat.count === 0 }"
      >
        <div class="dash-icon" :class="'dash-icon--' + stat.app">
          <img v-if="stat.icon" :src="stat.icon" :alt="stat.label" class="dash-icon-img" />
        </div>
        <div class="dash-body">
          <span class="dash-agent">{{ stat.label }}</span>
          <span v-if="stat.count" class="dash-num">{{ stat.count }}</span>
          <span v-else class="dash-num dash-num--zero">—</span>
          <span class="dash-unit">MCP</span>
        </div>
      </div>
    </div>

    <div class="page-body">
      <n-empty
        v-if="mcpServers.length === 0"
        description="暂无 MCP Server 配置"
        style="padding: 60px 0"
      >
        <template #extra>
          <n-text depth="3" style="font-size: 13px">点击「+ 添加」开始配置 MCP Server</n-text>
        </template>
      </n-empty>

      <McpCard
        v-for="s in mcpServers"
        :key="s.id"
        :server="s"
        @edit="onEdit"
        @delete="onDelete"
        @toggle="toggleServer"
        @update-apps="onUpdateApps"
      />
    </div>

    <McpForm
      :visible="showForm"
      :initial-data="formInitialData"
      @close="showForm = false"
      @save="onSave"
    />
  </div>
</template>

<style scoped>
  .page {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  /* n-page-header 统一样式 */
  .page :deep(.n-page-header) {
    padding: 8px 16px;
    min-height: 44px;
    border-bottom: 1px solid var(--border);
  }
  .page :deep(.n-page-header__title) {
    font-size: 14px !important;
    font-weight: 600;
  }
  .page :deep(.n-page-header__back) {
    margin-right: 8px;
  }
  .page :deep(.n-page-header__back:hover) {
    color: var(--primary);
  }
  .page :deep(.n-page-header .n-button) {
    font-size: 12px;
  }

  .dash-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
    padding: 12px 20px 8px;
    flex-shrink: 0;
  }
  .dash-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .dash-card:hover {
    border-color: var(--primary);
    box-shadow: 0 1px 4px rgba(217, 119, 6, 0.1);
  }
  .dash-card--zero {
    opacity: 0.55;
  }
  .dash-card--zero:hover {
    border-color: var(--text-muted);
    box-shadow: none;
  }
  .dash-icon {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    flex-shrink: 0;
    background: var(--bg-hover);
  }
  .dash-icon-img {
    width: 20px;
    height: 20px;
    object-fit: contain;
  }
  .dash-icon--codex {
    background: #fef3c7;
  }
  .dash-icon--claude {
    background: #ede9fe;
  }
  .dash-icon--claude-desktop {
    background: #ede9fe;
  }
  .dash-icon--openclaw {
    background: #d1fae5;
  }
  .dash-icon--opencode {
    background: #ccfbf1;
  }
  .dash-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .dash-agent {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .dash-num {
    font-size: 20px;
    font-weight: 700;
    color: var(--text);
    line-height: 1.2;
  }
  .dash-num--zero {
    color: var(--text-muted);
    font-size: 18px;
  }
  .dash-unit {
    font-size: 10px;
    color: var(--text-muted);
  }

  .page-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sync-icon {
    display: inline-block;
  }
  .sync-icon--spinning {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
