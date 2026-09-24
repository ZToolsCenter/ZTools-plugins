<script setup lang="ts">
  import { computed } from 'vue';
  import { formatBalance, type BalanceView } from '../../composables/useBalance';

  const props = defineProps<{
    provider?: any;
    balance?: BalanceView | null;
    lowThreshold?: number;
    compact?: boolean;
  }>();

  const view = computed<BalanceView>(() => props.balance || { loading: false });
  const loading = computed(() => !!view.value.loading);
  const failed = computed(() => view.value.failed || '');
  const result = computed(() => view.value.result);

  const hasResult = computed(() => !!result.value?.success && result.value.balance != null);
  const amountText = computed(() =>
    hasResult.value ? formatBalance(result.value!.balance, result.value!.currency) : '—'
  );
  const low = computed(() => {
    if (!hasResult.value) return false;
    const threshold = props.lowThreshold != null ? Number(props.lowThreshold) : 5;
    return result.value!.balance! < threshold;
  });
  const usedText = computed(() => {
    if (!hasResult.value || result.value!.used == null) return '';
    // 仅当当前配置仍声明 usedPath 时才显示「已用」，配置移除后即时隐藏
    if (!props.provider?.balance?.usedPath) return '';
    return '已用 ' + formatBalance(result.value!.used, result.value!.currency);
  });
</script>

<template>
  <div
    class="balance-block"
    :class="{ 'balance-block--low': low, 'balance-block--compact': compact }"
  >
    <div class="balance-left">
      <span class="balance-label">余额</span>
      <span v-if="loading" class="balance-loading">
        <n-spin :size="12" />
      </span>
      <template v-else>
        <span
          class="balance-amount"
          :class="{ 'balance-amount--low': low, 'balance-amount--muted': !hasResult || !!failed }"
          >{{ amountText }}</span
        >
        <span v-if="low && hasResult" class="balance-warn">⚠</span>
        <span v-if="usedText && !failed" class="balance-used">{{ usedText }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
  .balance-block {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border-top: 1px solid var(--border);
    margin-top: 5px;
    padding-top: 5px;
  }
  .balance-block--low {
    border-top-color: var(--error, #d03050);
  }
  .balance-left {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }
  .balance-label {
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
    line-height: 1.4;
  }
  .balance-loading {
    display: inline-flex;
    align-items: center;
    align-self: center;
  }
  .balance-amount {
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.4;
  }
  .balance-amount--low {
    color: var(--error, #d03050);
  }
  .balance-amount--muted {
    color: var(--text-muted);
    font-weight: 400;
  }
  .balance-warn {
    color: var(--error, #d03050);
    font-size: 12px;
    line-height: 1.4;
  }
  .balance-used {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .balance-block--compact {
    border-top: none;
    margin-top: 0;
    padding-top: 0;
  }
  .balance-block--compact .balance-amount {
    font-size: 12px;
  }
</style>
