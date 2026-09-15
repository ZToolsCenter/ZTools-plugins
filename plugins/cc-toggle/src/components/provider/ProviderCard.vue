<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { computed } from 'vue';
  import {
    EllipsisHorizontalOutline,
    SwapHorizontalOutline,
    CreateOutline,
    CopyOutline,
    TrashOutline,
    RefreshOutline,
    AppsOutline
  } from '@vicons/ionicons5';
  import { NIcon } from 'naive-ui';
  import BalanceCard from './BalanceCard.vue';
  const props = defineProps({
    provider: Object,
    compact: Boolean,
    balance: Object,
    lowThreshold: Number,
    showWidget: Boolean,
    widgetOpen: Boolean
  });
  const emit = defineEmits(['switch', 'edit', 'copy', 'delete', 'refresh', 'widget']);
  const dialog = useDialog();
  const contentStyle = computed(() => {
    if (props.provider?.isCurrent) return { padding: '6px 12px' };
    return props.compact ? { padding: '12px 12px' } : { padding: '8px 12px' };
  });

  const balanceLow = computed(() => {
    const r = props.balance?.result;
    if (!r?.success || r.balance == null) return false;
    const threshold = props.lowThreshold != null ? Number(props.lowThreshold) : 5;
    return r.balance < threshold;
  });

  const moreOptions = [
    { label: '复制', key: 'copy' },
    { label: '删除', key: 'delete', type: 'error' }
  ];

  function onMoreSelect(key) {
    if (key === 'copy') {
      emit('copy', props.provider.id);
    } else if (key === 'delete') {
      dialog.warning({
        title: '删除供应商',
        content: `确定删除供应商「${props.provider.name}」？`,
        positiveText: '删除',
        negativeText: '取消',
        onPositiveClick: () => emit('delete', props.provider.id)
      });
    }
  }

  const proxyHint = computed(() => {
    const p = props.provider || {};
    if (p.configType !== 'openai') return null;
    const af = p.apiFormat || '';
    if (af === 'anthropic')
      return {
        level: 'required',
        label: '需代理',
        tip: '该供应商为 Anthropic 协议，Codex 无法直连，必须开启代理接管。'
      };
    if (af === 'openai_chat')
      return {
        level: 'optional',
        label: '可代理',
        tip: '该供应商仅支持 Chat Completions。可直连(连接协议选 Chat)，或走代理接管获得协议转换与多供应商切换。'
      };
    return null;
  });

  const CAT_LABELS = {
    official: '官方',
    cn_official: '国内官方',
    partner: '合作',
    prime: 'Prime',
    third_party: '第三方',
    custom: '自定义'
  };
  const CAT_COLORS = {
    official: { color: 'rgba(59,130,246,.12)', textColor: '#3b82f6' },
    cn_official: { color: 'rgba(34,197,94,.12)', textColor: '#22c55e' },
    partner: { color: 'rgba(245,158,11,.12)', textColor: '#f59e0b' },
    prime: { color: 'rgba(168,85,247,.12)', textColor: '#a855f7' }
  };
</script>

<template>
  <n-card
    size="small"
    :bordered="true"
    :content-style="contentStyle"
    class="provider-card"
    :class="{ 'provider-card--active': provider.isCurrent }"
  >
    <div class="provider-main">
      <!-- Full layout -->
      <div v-if="!compact" class="provider-row">
        <div class="provider-info">
          <div class="provider-name">
            <n-text strong>{{ provider.name }}</n-text>
            <n-tag v-if="provider.isCurrent" type="success" size="tiny" round :bordered="false"
              >当前</n-tag
            >
            <n-tag
              v-if="provider.category && provider.category !== 'custom'"
              size="tiny"
              round
              :bordered="false"
              :color="CAT_COLORS[provider.category]"
              >{{ CAT_LABELS[provider.category] }}</n-tag
            >
            <n-tag size="tiny" :bordered="false">{{ provider.configType }}</n-tag>
            <n-tooltip v-if="proxyHint" trigger="hover">
              <template #trigger>
                <n-tag
                  size="tiny"
                  round
                  :bordered="false"
                  :type="proxyHint.level === 'required' ? 'error' : 'info'"
                  >{{ proxyHint.label }}</n-tag
                >
              </template>
              {{ proxyHint.tip }}
            </n-tooltip>
          </div>
          <div class="provider-meta">
            <span v-if="provider.baseUrl" class="meta-url">{{ provider.baseUrl }}</span>
            <span v-if="provider.baseUrl && provider.model" class="meta-dot">&middot;</span>
            <span class="meta-model">{{ provider.model }}</span>
            <span v-if="provider.remark" class="meta-remark" :title="provider.remark">{{
              provider.remark
            }}</span>
          </div>
        </div>
        <n-space :size="4" align="center" :wrap="false" class="provider-actions">
          <n-tooltip
            v-if="provider.balance && provider.balance.enabled"
            :theme-overrides="{ color: 'var(--primary)', textColor: '#fff' }"
            trigger="hover"
            placement="top"
          >
            <template #trigger>
              <n-button
                circle
                quaternary
                size="tiny"
                :disabled="balance?.loading"
                @click="emit('refresh', provider.id)"
              >
                <n-icon :size="14"><RefreshOutline /></n-icon>
              </n-button>
            </template>
            {{ balance?.loading ? '查询中' : '刷新余额' }}
          </n-tooltip>
          <n-tooltip
            :theme-overrides="{ color: 'var(--primary)', textColor: '#fff' }"
            trigger="hover"
            placement="top"
          >
            <template #trigger>
              <n-button
                circle
                quaternary
                :type="provider.isCurrent ? 'default' : 'primary'"
                :secondary="provider.isCurrent"
                size="tiny"
                :disabled="provider.isCurrent"
                @click="emit('switch', provider.id, $event)"
              >
                <n-icon :size="14"><SwapHorizontalOutline /></n-icon>
              </n-button>
            </template>
            {{ provider.isCurrent ? '已激活' : '切换' }}
          </n-tooltip>
          <n-tooltip
            :theme-overrides="{ color: 'var(--primary)', textColor: '#fff' }"
            trigger="hover"
            placement="top"
          >
            <template #trigger>
              <n-button circle quaternary size="tiny" @click="emit('edit', provider.id)">
                <n-icon :size="14"><CreateOutline /></n-icon>
              </n-button>
            </template>
            编辑
          </n-tooltip>
          <n-tooltip
            :theme-overrides="{ color: 'var(--primary)', textColor: '#fff' }"
            trigger="hover"
            placement="top"
          >
            <template #trigger>
              <n-button circle quaternary size="tiny" @click="emit('copy', provider.id)">
                <n-icon :size="14"><CopyOutline /></n-icon>
              </n-button>
            </template>
            复制
          </n-tooltip>
          <n-popconfirm @positive-click="emit('delete', provider.id)">
            <template #trigger>
              <n-tooltip
                :theme-overrides="{ color: 'var(--primary)', textColor: '#fff' }"
                trigger="hover"
                placement="top"
              >
                <template #trigger>
                  <n-button circle quaternary type="error" size="tiny">
                    <n-icon :size="14"><TrashOutline /></n-icon>
                  </n-button>
                </template>
                删除
              </n-tooltip>
            </template>
            确定删除该供应商？
          </n-popconfirm>
        </n-space>
      </div>

      <!-- Compact layout: 信息在上，底部一行 = 余额(含刷新) + 操作按钮 -->
      <div v-else class="compact-layout">
        <div class="compact-row1">
          <div class="compact-name-wrap">
            <n-text strong class="compact-name">{{ provider.name }}</n-text>
            <template v-if="provider.isCurrent">
              <n-tag type="success" size="tiny" round :bordered="false">当前</n-tag>
              <n-tag
                v-if="provider.category && provider.category !== 'custom'"
                size="tiny"
                round
                :bordered="false"
                :color="CAT_COLORS[provider.category]"
                >{{ CAT_LABELS[provider.category] }}</n-tag
              >
              <n-tag size="tiny" :bordered="false">{{ provider.configType }}</n-tag>
              <n-tooltip v-if="proxyHint" trigger="hover">
                <template #trigger>
                  <n-tag
                    size="tiny"
                    round
                    :bordered="false"
                    :type="proxyHint.level === 'required' ? 'error' : 'info'"
                    >{{ proxyHint.label }}</n-tag
                  >
                </template>
                {{ proxyHint.tip }}
              </n-tooltip>
            </template>
          </div>
          <span class="meta-model">{{ provider.model }}</span>
        </div>
        <div class="compact-row2" :title="provider.remark">{{ provider.remark || '' }}</div>
        <div class="compact-bottom" :class="{ 'compact-bottom--low': balanceLow }">
          <BalanceCard
            v-if="provider.balance && provider.balance.enabled"
            class="compact-balance"
            :provider="provider"
            :balance="balance"
            :low-threshold="lowThreshold"
            :compact="compact"
            @refresh="emit('refresh', provider.id)"
          />
          <n-space :size="4" align="center" :wrap="false" class="compact-actions">
            <n-tooltip
              v-if="showWidget"
              :theme-overrides="{ color: 'var(--primary)', textColor: '#fff' }"
              trigger="hover"
              placement="top"
            >
              <template #trigger>
                <n-button
                  class="widget-btn"
                  circle
                  quaternary
                  size="tiny"
                  :type="widgetOpen ? 'primary' : 'default'"
                  :secondary="widgetOpen"
                  :title="widgetOpen ? '收起状态小组件' : '打开状态小组件'"
                  @click="emit('widget')"
                >
                  <n-icon :size="14"><AppsOutline /></n-icon>
                </n-button>
              </template>
              {{ widgetOpen ? '收起状态小组件' : '打开状态小组件' }}
            </n-tooltip>
            <n-tooltip
              v-if="provider.balance && provider.balance.enabled"
              :theme-overrides="{ color: 'var(--primary)', textColor: '#fff' }"
              trigger="hover"
              placement="top"
            >
              <template #trigger>
                <n-button
                  circle
                  quaternary
                  size="tiny"
                  :disabled="balance?.loading"
                  @click="emit('refresh', provider.id)"
                >
                  <n-icon :size="14"><RefreshOutline /></n-icon>
                </n-button>
              </template>
              {{ balance?.loading ? '查询中' : '刷新余额' }}
            </n-tooltip>
            <n-tooltip
              :theme-overrides="{ color: 'var(--primary)', textColor: '#fff' }"
              trigger="hover"
              placement="top"
            >
              <template #trigger>
                <n-button
                  circle
                  quaternary
                  :type="provider.isCurrent ? 'default' : 'primary'"
                  :secondary="provider.isCurrent"
                  size="tiny"
                  :disabled="provider.isCurrent"
                  @click="emit('switch', provider.id, $event)"
                >
                  <n-icon :size="14"><SwapHorizontalOutline /></n-icon>
                </n-button>
              </template>
              {{ provider.isCurrent ? '已激活' : '切换' }}
            </n-tooltip>
            <n-tooltip
              :theme-overrides="{ color: 'var(--primary)', textColor: '#fff' }"
              trigger="hover"
              placement="top"
            >
              <template #trigger>
                <n-button circle quaternary size="tiny" @click="emit('edit', provider.id)">
                  <n-icon :size="14"><CreateOutline /></n-icon>
                </n-button>
              </template>
              编辑
            </n-tooltip>
            <n-dropdown :options="moreOptions" trigger="click" size="small" @select="onMoreSelect">
              <n-button circle quaternary size="tiny">
                <n-icon :size="14"><EllipsisHorizontalOutline /></n-icon>
              </n-button>
            </n-dropdown>
          </n-space>
        </div>
      </div>
    </div>

    <!-- 余额区块（全宽布局时展示，紧凑布局已内嵌） -->
    <BalanceCard
      v-if="!compact && provider.balance && provider.balance.enabled"
      :provider="provider"
      :balance="balance"
      :low-threshold="lowThreshold"
      :compact="compact"
      @refresh="emit('refresh', provider.id)"
    />
  </n-card>
</template>

<style scoped>
  .provider-card {
    height: 100%;
  }
  .provider-card :deep(.n-card__content) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .provider-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .provider-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .provider-info {
    flex: 1;
    min-width: 0;
  }
  .provider-actions {
    flex-shrink: 0;
  }

  .provider-name {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 13px;
    margin-bottom: 2px;
    flex-wrap: nowrap;
  }

  .provider-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
  }
  .meta-url {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta-model {
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    font-size: 11px;
    color: var(--text-secondary);
  }
  .meta-dot {
    color: var(--text-muted);
  }
  .meta-remark {
    margin-left: 4px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Compact layout: 信息在上，底部一行 = 余额 + 操作 ── */
  .compact-layout {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .compact-row1 {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
  }
  .compact-bottom {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    border-top: 1px solid var(--border);
    padding-top: 6px;
  }
  .compact-bottom--low {
    border-top-color: var(--error, #d03050);
  }
  .compact-bottom .compact-balance {
    flex: 1;
    min-width: 0;
  }
  .compact-actions {
    flex-shrink: 0;
    margin-left: auto;
  }
  .compact-name-wrap {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }
  .provider-card--active .compact-name-wrap {
    flex-wrap: nowrap;
  }
  .provider-card--active .compact-name-wrap .compact-name {
    flex-shrink: 0;
    max-width: 50%;
  }
  .compact-name {
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    color: var(--text-primary);
  }
  .compact-name-wrap .n-tag {
    flex-shrink: 0;
  }
  .compact-row1 .meta-model {
    white-space: nowrap;
    flex-shrink: 0;
  }
  .compact-name-model .meta-model {
    color: var(--primary-color);
    opacity: 0.7;
  }
  .compact-row2 {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 16px;
    height: 16px;
  }

  /* ── Hover effect (compact cards only) ── */
  .provider-card:not(.provider-card--active) {
    transition: all 0.2s ease;
    cursor: pointer;
  }
  .provider-card:not(.provider-card--active):hover {
    border-color: var(--primary);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
    transform: translateY(-1px);
  }

  /* ── Active provider — strong visual treatment ── */
  .provider-card--active {
    border-left: 3px solid var(--primary);
    background: var(--primary-light);
    box-shadow: 0 2px 8px rgba(217, 119, 6, 0.15);
  }
  .provider-card--active .provider-name {
    font-size: 14px;
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  }
</style>
