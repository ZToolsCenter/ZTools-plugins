<script setup lang="ts">
import { computed } from 'vue'
import type { BookSource } from '../../../utils/onlineBook'
import { sourceDisplayName, sourceKey, getSourceLoginUrl } from '../../../utils/onlineBook'
import { useOnlineStore } from '../../../stores/online'
import { mergeCookies } from '../../../utils/cookieJar'
import { evalLoginCheck } from '../../../utils/loginCheck'

const props = defineProps<{
  source: BookSource
  groupId: string
  index: number
  groupName?: string
  sourceTypeLabel: string
}>()

const emit = defineEmits<{
  toggle: []
  edit: []
  login: []
  debug: []
  delete: []
}>()

const onlineStore = useOnlineStore()

const hasLogin = computed(() => !!getSourceLoginUrl(props.source))

/** 登录状态：ok=已登录 / no=未登录 / unknown=无法判断 / null=未配置检测 */
const loginStatus = computed<'ok' | 'no' | 'unknown' | null>(() => {
  const check = props.source.loginCheckJs?.trim()
  if (!check) return null
  const url = getSourceLoginUrl(props.source)
  const jar = url ? onlineStore.jarCookie(url) : ''
  const cookie = mergeCookies(props.source.cookie, jar)
  const r = evalLoginCheck(check, { cookie, url })
  return r === true ? 'ok' : r === false ? 'no' : 'unknown'
})

const statusText = computed(() =>
  loginStatus.value === 'ok' ? '已登录'
  : loginStatus.value === 'no' ? '未登录'
  : loginStatus.value === 'unknown' ? '状态未知' : ''
)

function onToggle() {
  emit('toggle')
}
</script>

<template>
  <div class="source-item" :class="{ 'source-item-disabled': source.enabled === false }">
    <button class="icon-toggle" :class="{ on: source.enabled !== false }"
      :title="source.enabled === false ? '启用书源' : '停用书源（不参与搜索）'"
      @click="onToggle">
      <span class="toggle-dot"></span>
    </button>

    <div class="source-item-info">
      <div class="source-item-line">
        <span class="source-name" :title="sourceDisplayName(source)">{{ sourceDisplayName(source) }}</span>
        <span v-if="groupName" class="source-group-chip" :title="'分组：' + groupName">{{ groupName }}</span>
        <span class="source-type" :class="source.ruleSearch ? 'legado' : (source.source_type === '2' ? 'api' : 'html')">
          {{ sourceTypeLabel }}
        </span>
        <span v-if="loginStatus" class="login-chip" :class="loginStatus">{{ statusText }}</span>
      </div>
      <div class="source-url" :title="sourceKey(source)">{{ sourceKey(source) }}</div>
    </div>

    <button class="icon-btn" title="调试书源（搜索/目录/正文）" @click="emit('debug')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 15a7 7 0 0 1 8 0" />
        <circle cx="12" cy="11" r="3" />
        <path d="M3 3l2.5 2.5M21 3l-2.5 2.5M12 2v2M4 8H2M22 8h-2" />
        <circle cx="12" cy="12" r="10" stroke-dasharray="1 4" />
      </svg>
    </button>
    <button v-if="hasLogin" class="icon-btn" title="登录该书源并获取 Cookie" @click="emit('login')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    </button>
    <button class="icon-btn" title="编辑书源" @click="emit('edit')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      </svg>
    </button>
    <button class="icon-btn icon-danger" title="删除书源" @click="emit('delete')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.source-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  background: var(--c-surface);
  transition: border-color 0.15s var(--ease-out), background 0.15s var(--ease-out);
}

.source-item:hover {
  border-color: var(--c-border-strong);
}

.source-item-disabled {
  opacity: 0.55;
}

.source-item-info {
  flex: 1;
  min-width: 0;
}

.source-item-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.source-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-group-chip {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--c-surface-sunken);
  color: var(--c-ink-secondary);
  border: 1px solid var(--c-border);
}

.source-type {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: var(--radius-full);
  letter-spacing: 0.02em;
}

.source-type.html {
  background: var(--c-accent-soft);
  color: var(--c-accent);
}

.source-type.api {
  background: var(--c-success-soft);
  color: var(--c-success);
}

.source-type.legado {
  background: var(--c-warning-soft, var(--c-accent-soft));
  color: var(--c-warning, var(--c-accent));
}

.login-chip {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: var(--radius-full);
  letter-spacing: 0.02em;
}

.login-chip.ok {
  background: var(--c-success-soft);
  color: var(--c-success);
}

.login-chip.no {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

.login-chip.unknown {
  background: var(--c-warning-soft, var(--c-accent-soft));
  color: var(--c-warning, var(--c-accent));
}

.source-url {
  margin-top: 2px;
  font-size: 11px;
  color: var(--c-ink-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 26px;
  border-radius: var(--radius-full);
  background: var(--c-surface-sunken);
  border: 1px solid var(--c-border);
  flex-shrink: 0;
  cursor: pointer;
  transition: all 0.15s var(--ease-out);
}

.icon-toggle .toggle-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--c-ink-tertiary);
  transition: background 0.15s var(--ease-out), transform 0.15s var(--ease-out);
}

.icon-toggle.on {
  background: var(--c-success-soft);
  border-color: var(--c-success);
}

.icon-toggle.on .toggle-dot {
  background: var(--c-success);
  transform: scale(0.8);
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border-radius: var(--radius-sm);
  color: var(--c-ink-tertiary);
  flex-shrink: 0;
  transition: all 0.12s var(--ease-out);
}

.icon-btn:hover {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.icon-danger:hover {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}
</style>
