<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { computed } from 'vue';
  import { APP_LABELS, APP_ICONS, APP_OPTIONS } from '../../composables/shared';

  const props = defineProps({ server: Object });
  const emit = defineEmits(['edit', 'delete', 'toggle', 'update-apps']);

  const typeLabel = computed(() => {
    const t = props.server?.type;
    if (t === 'sse') return 'SSE';
    if (t === 'streamable-http') return 'HTTP';
    return 'stdio';
  });

  const statusColor = computed(() => {
    if (!props.server?.enabled) return 'var(--text-muted)';
    return 'var(--success)';
  });

  const statusLabel = computed(() => {
    return props.server?.enabled ? '已启用' : '已禁用';
  });

  const commandSummary = computed(() => {
    const s = props.server;
    if (!s) return '';
    if (s.type === 'stdio' && s.stdio) {
      const parts = [s.stdio.command || ''];
      if (s.stdio.args && s.stdio.args.length) {
        parts.push(s.stdio.args.join(' '));
      }
      return parts.join(' ');
    }
    if (s.type === 'sse' && s.sse) return s.sse.url || '';
    if (s.type === 'streamable-http' && s.http) return s.http.url || '';
    return '';
  });

  const appTags = computed(() => {
    return (props.server?.apps || []).map(function (a) {
      return { key: a, label: APP_LABELS[a] || a, icon: APP_ICONS[a] };
    });
  });

  function toggleApp(app) {
    var apps = (props.server?.apps || []).slice();
    var idx = apps.indexOf(app);
    if (idx === -1) apps.push(app);
    else apps.splice(idx, 1);
    emit('update-apps', props.server.id, apps);
  }
</script>

<template>
  <n-card
    size="small"
    :bordered="true"
    class="mcp-card"
    :class="{ 'mcp-card--disabled': !server.enabled }"
  >
    <div class="mcp-row">
      <div class="mcp-info">
        <div class="mcp-name">
          <span class="mcp-dot" :style="{ background: statusColor }"></span>
          <n-text strong>{{ server.name || '未命名' }}</n-text>
          <n-tag size="tiny" :bordered="false">{{ typeLabel }}</n-tag>
          <n-tag size="tiny" :bordered="false" :type="server.enabled ? 'success' : 'default'">{{
            statusLabel
          }}</n-tag>
        </div>
        <div class="mcp-meta">
          <span class="mcp-command" :title="commandSummary">{{ commandSummary }}</span>
        </div>
        <div class="mcp-apps">
          <button
            v-for="opt in APP_OPTIONS"
            :key="opt.value"
            class="agent-chip"
            :class="{ 'agent-chip--on': (server.apps || []).indexOf(opt.value) !== -1 }"
            @click="toggleApp(opt.value)"
          >
            <img v-if="APP_ICONS[opt.value]" :src="APP_ICONS[opt.value]" class="chip-icon" />
            {{ opt.label }}
          </button>
        </div>
      </div>
      <div class="mcp-actions">
        <n-switch :value="server.enabled" size="small" @update:value="emit('toggle', server.id)" />
        <n-button quaternary size="tiny" @click="emit('edit', server.id)">编辑</n-button>
        <n-popconfirm @positive-click="emit('delete', server.id)">
          <template #trigger>
            <n-button quaternary type="error" size="tiny">删除</n-button>
          </template>
          确定删除该 MCP Server？
        </n-popconfirm>
      </div>
    </div>
  </n-card>
</template>

<style scoped>
  .mcp-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .mcp-info {
    flex: 1;
    min-width: 0;
  }
  .mcp-actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .mcp-name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    margin-bottom: 3px;
  }

  .mcp-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .mcp-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
  }
  .mcp-command {
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    font-size: 11px;
    color: var(--text-secondary);
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mcp-apps {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-top: 4px;
  }
  .agent-chip {
    padding: 3px 10px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--bg);
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-muted);
    white-space: nowrap;
    transition: all 0.15s;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .agent-chip:hover {
    border-color: var(--primary);
    color: var(--primary);
  }
  .agent-chip--on {
    border-color: var(--primary);
    background: var(--primary-light);
    color: var(--primary);
  }
  .chip-icon {
    width: 12px;
    height: 12px;
    object-fit: contain;
  }

  .mcp-card--disabled {
    opacity: 0.6;
  }
</style>
