<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { computed } from 'vue';
  import { APP_ICONS, APP_LABELS } from '../../composables/shared';

  const props = defineProps({
    session: { type: Object, required: true }
  });

  const emit = defineEmits(['view', 'export', 'delete']);

  const appIcon = computed(() => APP_ICONS[props.session.app] || null);
  const appLabel = computed(() => APP_LABELS[props.session.app] || props.session.app);

  function formatTime(ts) {
    if (!ts) return '';
    try {
      var d = new Date(ts);
      var now = new Date();
      var diff = now.getTime() - d.getTime();
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
      if (diff < 86400000 * 7) return Math.floor(diff / 86400000) + ' 天前';
      var m = ('0' + (d.getMonth() + 1)).slice(-2);
      var day = ('0' + d.getDate()).slice(-2);
      return d.getFullYear() + '-' + m + '-' + day;
    } catch (e) {
      return ts;
    }
  }

  function formatTokens(n) {
    if (!n) return '';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M tokens';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k tokens';
    return n + ' tokens';
  }

  function truncatePath(p) {
    if (!p) return '';
    if (p.length <= 30) return p;
    return '...' + p.substring(p.length - 27);
  }
</script>

<template>
  <n-card size="small" hoverable class="session-card" @click="emit('view', session)">
    <div class="session-card__inner">
      <div class="session-card__icon">
        <img v-if="appIcon" :src="appIcon" :alt="appLabel" class="session-card__icon-img" />
      </div>
      <div class="session-card__body">
        <n-text strong class="session-card__title">{{ session.title }}</n-text>
        <n-space :size="4" align="center" class="session-card__meta">
          <n-text v-if="session.projectPath" depth="3" class="session-card__path">
            📁 {{ truncatePath(session.projectPath) }}
          </n-text>
          <n-text v-if="session.projectPath" depth="3">·</n-text>
          <n-text depth="3">{{ session.messageCount }} 条消息</n-text>
        </n-space>
        <n-space :size="4" align="center" class="session-card__meta">
          <n-text depth="3">{{ formatTime(session.updatedAt) }}</n-text>
          <template v-if="session.tokenUsage">
            <n-text depth="3">·</n-text>
            <n-text depth="3">{{ formatTokens(session.tokenUsage) }}</n-text>
          </template>
          <template v-if="session.model">
            <n-text depth="3">·</n-text>
            <n-text depth="3" class="session-card__model">{{ session.model }}</n-text>
          </template>
        </n-space>
      </div>
      <n-space class="session-card__actions" :size="4" @click.stop>
        <n-button size="tiny" quaternary @click="emit('view', session)">查看</n-button>
        <n-button size="tiny" quaternary @click="emit('export', session)">导出</n-button>
        <n-popconfirm @confirm="emit('delete', session)">
          <template #trigger>
            <n-button size="tiny" quaternary type="error">删除</n-button>
          </template>
          确定删除该会话？
        </n-popconfirm>
      </n-space>
    </div>
  </n-card>
</template>

<style lang="scss" scoped>
  .session-card {
    cursor: pointer;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;

    &:hover {
      border-color: var(--primary);
      box-shadow: 0 1px 4px rgba(217, 119, 6, 0.1);
    }

    &__inner {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    &__icon {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg-hover);
      flex-shrink: 0;
    }

    &__icon-img {
      width: 18px;
      height: 18px;
      object-fit: contain;
    }

    &__body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    &__title {
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    &__meta {
      font-size: 11px;
      flex-wrap: nowrap;
    }

    &__path {
      max-width: 200px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    &__model {
      max-width: 120px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    &__actions {
      flex-shrink: 0;
      align-self: center;
    }
  }
</style>
