<template>
  <div class="account-card">
    <IssuerIcon :issuer="account.issuer" :size="40" />

    <div class="card-info">
      <div class="card-issuer">{{ account.issuer }}<span v-if="account.type === 'hotp'" class="hotp-badge">HOTP</span><span v-else-if="account.type === 'steam'" class="hotp-badge steam-badge">STEAM</span></div>
      <div class="card-label">{{ account.label }}</div>
    </div>

    <div class="card-right">
      <div class="code-group">
        <button
          class="code-btn"
          :class="{ copied }"
          @click="handleCopy"
          :disabled="!totpDisplay"
        >
          <span class="code-text" v-if="totpDisplay">
            <template v-if="copied">&#10003;</template>
            <template v-else>{{ formattedCode }}</template>
          </span>
          <span class="code-text code-placeholder" v-else>------</span>
        </button>
        <Transition name="next-code">
          <button v-if="formattedNextCode" class="next-code-btn" @click="handleCopyNext">
            次码 {{ formattedNextCode }}
          </button>
        </Transition>
      </div>

      <CountdownRing
        v-if="totpDisplay && !totpDisplay.isHotp && theme.indicatorMode.value === 'ring'"
        :remaining="totpDisplay.remaining"
        :period="totpDisplay.period"
      />
      <CountdownBar
        v-else-if="totpDisplay && !totpDisplay.isHotp && theme.indicatorMode.value === 'bar'"
        :remaining="totpDisplay.remaining"
        :period="totpDisplay.period"
      />

      <button
        v-if="totpDisplay && totpDisplay.isHotp"
        class="refresh-btn"
        title="生成下一个验证码"
        @click="handleRefresh"
      >&#x21bb;</button>

      <div class="menu-wrapper">
        <button class="menu-btn" @click="toggleMenu">&#8942;</button>
        <div v-if="menuOpen" class="menu-dropdown">
          <button class="menu-item" @click="handlePin">&#128204; 置顶</button>
          <button class="menu-item" @click="handleEdit">&#9998; 编辑</button>
          <button class="menu-item menu-item-danger" @click="handleDelete">&#128465; 删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { Account, TotpDisplay } from '@/types'
import IssuerIcon from './IssuerIcon.vue'
import CountdownRing from './CountdownRing.vue'
import CountdownBar from './CountdownBar.vue'
import { useTheme } from '@/composables/useTheme'

const theme = useTheme()

const props = defineProps<{
  account: Account
  totpDisplay?: TotpDisplay
}>()

const emit = defineEmits<{
  copy: [code: string]
  edit: [account: Account]
  delete: [account: Account]
  pin: [account: Account]
  refreshHotp: [account: Account]
}>()

const copied = ref(false)
const menuOpen = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

const formattedCode = computed(() => {
  if (!props.totpDisplay) return ''
  const code = props.totpDisplay.code
  const mid = Math.ceil(code.length / 2)
  return code.slice(0, mid) + ' ' + code.slice(mid)
})

const formattedNextCode = computed(() => {
  if (!props.totpDisplay?.nextCode) return ''
  const code = props.totpDisplay.nextCode
  const mid = Math.ceil(code.length / 2)
  return code.slice(0, mid) + ' ' + code.slice(mid)
})

function handleCopyNext() {
  if (!props.totpDisplay?.nextCode) return
  emit('copy', props.totpDisplay.nextCode)
}

function handleCopy() {
  if (!props.totpDisplay) return
  emit('copy', props.totpDisplay.code)
  copied.value = true
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = false
  }, 1500)
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function handleRefresh() {
  emit('refreshHotp', props.account)
}

function handlePin() {
  menuOpen.value = false
  emit('pin', props.account)
}

function handleEdit() {
  menuOpen.value = false
  emit('edit', props.account)
}

function handleDelete() {
  menuOpen.value = false
  emit('delete', props.account)
}

function closeMenu(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.menu-wrapper')) {
    menuOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', closeMenu)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenu)
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<style scoped>
.account-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  transition: background 0.2s ease;
  cursor: default;
}

.account-card:hover {
  background: var(--bg-card-hover);
}

.card-info {
  flex: 1;
  min-width: 0;
}

.card-issuer {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 6px;
}

.hotp-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--accent);
  color: var(--bg-primary);
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.steam-badge {
  background: #1b2838;
  color: #66c0f4;
}

.refresh-btn {
  width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg-secondary);
  color: var(--accent);
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, transform 0.3s;
  flex-shrink: 0;
}

.refresh-btn:hover {
  background: var(--bg-card-hover);
}

.refresh-btn:active {
  transform: rotate(180deg);
}

.card-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.code-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius);
  transition: background 0.15s ease;
}

.code-btn:hover {
  background: var(--bg-secondary);
}

.code-btn:disabled {
  cursor: default;
  opacity: 0.5;
}

.code-text {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 20px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 2px;
}

.code-placeholder {
  color: var(--text-secondary);
}

.code-btn.copied .code-text {
  color: var(--success);
}

.code-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.next-code-btn {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 1px;
  padding: 2px 8px;
  opacity: 0.8;
  background: none;
  border: 1px dashed transparent;
  border-radius: var(--radius);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.next-code-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  opacity: 1;
}

.next-code-enter-active {
  transition: all 0.3s ease;
}
.next-code-leave-active {
  transition: all 0.2s ease;
}
.next-code-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.next-code-leave-to {
  opacity: 0;
}

.menu-wrapper {
  position: relative;
}

.menu-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 20px;
  padding: 4px 6px;
  border-radius: var(--radius);
  line-height: 1;
  transition: background 0.15s ease, color 0.15s ease;
}

.menu-btn:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.menu-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  min-width: 120px;
  padding: 4px 0;
  z-index: 100;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--text-primary);
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.menu-item:hover {
  background: var(--bg-card-hover);
}

.menu-item-danger {
  color: var(--danger);
}

.menu-item-danger:hover {
  background: rgba(243, 139, 168, 0.1);
}
</style>
