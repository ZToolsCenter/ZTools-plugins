<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { getOTP, base32tohex } from './utils/otp'
import { useAuth } from './composables/useAuth'
import { useAccounts } from './composables/useAccounts'
import { useTicker } from './composables/useTicker'
import { useDataManagement } from './composables/useDataManagement'

// Components
import AccountCard from './components/AccountCard.vue'
import VerifyAuthModal from './components/Modals/VerifyAuthModal.vue'
import SetPasswordModal from './components/Modals/SetPasswordModal.vue'
import SettingsModal from './components/Modals/SettingsModal.vue'
import EditModal from './components/Modals/EditModal.vue'
import ConfirmModal from './components/Modals/ConfirmModal.vue'
import ImportDataModal from './components/Modals/ImportDataModal.vue'
import ChangePasswordModal from './components/Modals/ChangePasswordModal.vue'
import { STORAGE_KEY, CONFIG_KEY, DEFAULT_PINYIN_SCHEME } from './constants'
import { matchesPinyinCached, buildPinyinCache, type PinyinScheme, type PinyinCache } from './utils/pinyin'

// --- Composables Initialization ---
const {
  masterKey, masterSalt, lastAuthTime,
  showSetPasswordModal, showVerifyPasswordModal,
  passwordInput, confirmPasswordInput,
  passwordErrorMsg, verifyErrorMsg,
  verifyInput, pendingAction,
  tryAutoUnlock, setMasterPassword, verifyMasterPassword,
  clearAuthData, changeMasterPassword, getHardwareKey
} = useAuth()

const {
  accounts, loadAccounts, decryptAllAccounts, saveAccounts, saveConfig, getPinnedCount
} = useAccounts()

const {
  tokens, nextTokens, currentTime, msNow,
  startTicker, stopTicker, updateAllTokens, updateTokens,
  getAccountTimeLeft, performTokenUpdate
} = useTicker()

const {
  showImportModal, importDataInput, importPasswordInput, importDataError, importPasswordError,
  exportData, importData, verifyAndApplyImportData, cancelImport
} = useDataManagement()

// --- Local UI State ---
const config = ref({ timerStyle: 'bar', nextPreview: true, pinyinScheme: DEFAULT_PINYIN_SCHEME })
const searchQuery = ref('')

// 拼音缓存：账户列表变化时重新计算，搜索时直接复用
const pinyinCacheMap = ref<Map<string, PinyinCache>>(new Map())
watch(
  () => accounts.value.map(a => a.id + '|' + a.name),
  () => {
    const newMap = new Map<string, PinyinCache>()
    for (const acc of accounts.value) {
      newMap.set(acc.id, buildPinyinCache(acc.name))
    }
    pinyinCacheMap.value = newMap
  },
  { immediate: true }
)

// filteredAccounts 携带真实索引，避免模板中 indexOf 的 O(N²) 开销
const filteredAccounts = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const scheme = (config.value.pinyinScheme || DEFAULT_PINYIN_SCHEME) as PinyinScheme
  return accounts.value
    .map((acc, index) => ({ acc, index }))
    .filter(({ acc }) => {
      if (!q) return true
      const cache = pinyinCacheMap.value.get(acc.id)
      if (!cache) return acc.name.toLowerCase().includes(q)
      return matchesPinyinCached(acc.name, q, scheme, cache)
    })
})

const setupSubInput = () => {
  const z = (window as any).ztools
  z?.setSubInput?.((data: { text: string }) => {
    searchQuery.value = data.text || ''
  }, '搜索账号...', false)
}
const showModal = ref(false)
const showNextSelectMenu = ref(false)
const showAbout = ref(false)
const showSettings = ref(false)
const showSelectMenu = ref(false)
const showPinyinSelectMenu = ref(false)

const modalTitle = ref('')
const modalForm = ref({
  id: '', name: '', secret: '',
  type: 'totp', period: 30, counter: 1,
  algorithm: 'SHA1', digits: 6,
  encrypted: false
})
const activeModalDropdown = ref<string | null>(null)
const nameError = ref(false)
const secretError = ref(false)
const secretErrorMsg = ref('密钥不合法')
const nameWarn = ref(false)

const menuVisible = ref(false)
const menuPos = ref({ x: 0, y: 0 })
const menuContext = ref<any>(null)
const showConfirm = ref(false)
const confirmData = ref({ name: '', id: '' })
const toastMsg = ref('')

const copiedId = ref<string | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const showSecret = ref(false)
const showResetConfirmModal = ref(false)
const countdown = ref(0)
const countdownTimer = ref<any>(null)

const showExportConfirmModal = ref(false)
const exportCountdown = ref(0)
const exportCountdownTimer = ref<any>(null)

const showChangePasswordModal = ref(false)
const changePwdCurrentError = ref('')
const changePwdNewError = ref('')
const changePwdConfirmError = ref('')
let changePwdCurrent = ''
let changePwdNew = ''
let changePwdConfirm = ''

const dragIndex = ref<number | null>(null)
const isDragging = ref(false)
const deleteCountdown = ref(0)
let deleteTimer: any = null

// --- Core Logic Integration ---
const initialize = async () => {
  const z = (window as any).ztools
  if (z?.isDarkColors?.()) {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }

  z?.setExpendHeight?.(552)

  await loadAccounts(masterSalt, masterKey, config, {
    onAutoUnlock: tryAutoUnlock,
    onDecryptAll: () => decryptAllAccounts(masterKey.value),
    onShowVerify: (action) => {
      passwordInput.value = ''
      verifyErrorMsg.value = ''
      showVerifyPasswordModal.value = true
      pendingAction.value = action
    },
    onTokensUpdate: () => updateTokens(accounts.value)
  })
  startTicker(accounts)
  window.addEventListener('click', hideContextMenu)
  setupSubInput()

  let killTimer: any = null

  if (z?.onPluginEnter) {
    z.onPluginEnter(async () => {
      // 中途打开，取消待执行的 kill
      if (killTimer) { clearTimeout(killTimer); killTimer = null }

      searchQuery.value = ''
      z?.setSubInputValue?.('')

      await loadAccounts(masterSalt, masterKey, config, {
        onAutoUnlock: tryAutoUnlock,
        onDecryptAll: () => decryptAllAccounts(masterKey.value),
        onShowVerify: () => {}, // 自动模式不弹窗
        onTokensUpdate: () => updateTokens(accounts.value)
      })
    })
  }

  if (z?.onPluginOut) {
    z.onPluginOut(() => {
      // 退出后 3 分钟内未打开则结束进程释放内存
      killTimer = setTimeout(() => { z.outPlugin(true) }, 3 * 60 * 1000)
    })
  }
}

const handleResetDatabase = () => {
  showResetConfirmModal.value = true
  startCountdown()
}

const handleExportData = async () => {
  if (!masterSalt.value) {
    passwordInput.value = ''
    verifyErrorMsg.value = ''
    showVerifyPasswordModal.value = true
    pendingAction.value = handleExportData
    return
  }
  
  if (!masterKey.value) {
    await tryAutoUnlock()
    if (!masterKey.value) {
      pendingAction.value = handleExportData
      showVerifyPasswordModal.value = true
      return
    }
  }

  // 弹出确认框，开始倒计时
  showExportConfirmModal.value = true
  exportCountdown.value = 3
  if (exportCountdownTimer.value) clearInterval(exportCountdownTimer.value)
  exportCountdownTimer.value = setInterval(() => {
    if (exportCountdown.value > 0) exportCountdown.value--
    else { clearInterval(exportCountdownTimer.value); exportCountdownTimer.value = null }
  }, 1000)
}

const confirmExport = async () => {
  showExportConfirmModal.value = false
  await exportData(accounts.value, masterSalt.value, masterKey.value)
}

const handleImportData = async () => {
  importData()
}

const handleChangePassword = () => {
  if (!masterSalt.value) {
    const z = (window as any).ztools
    z?.showNotification?.('尚未设置主密码')
    return
  }
  changePwdCurrentError.value = ''
  changePwdNewError.value = ''
  changePwdConfirmError.value = ''
  showChangePasswordModal.value = true
}

const handleChangePasswordSubmit = async () => {
  const result = await changeMasterPassword(
    changePwdCurrent,
    changePwdNew,
    changePwdConfirm,
    accounts.value,
    (msg) => { changePwdCurrentError.value = msg },
    (msg) => { changePwdNewError.value = msg },
    (msg) => { changePwdConfirmError.value = msg }
  )
  if (result) showChangePasswordModal.value = false
}
const handleImportPasswordVerify = async () => {
  if (!importDataInput.value) {
    importDataError.value = '数据不能为空'
    return
  }
  
  if (!importPasswordInput.value) {
    importPasswordError.value = '主密码不能为空'
    return
  }
  
  await verifyAndApplyImportData(
    importDataInput.value,
    importPasswordInput.value,
    accounts.value,
    masterSalt,
    masterKey,
    config.value,
    getHardwareKey
  )
}

const startCountdown = () => {
  countdown.value = 3
  if (countdownTimer.value) clearInterval(countdownTimer.value)
  countdownTimer.value = setInterval(() => {
    if (countdown.value > 0) countdown.value--
    else {
      clearInterval(countdownTimer.value)
      countdownTimer.value = null
    }
  }, 1000)
}

const confirmReset = async () => {
  const z = (window as any).ztools
  try {
    const conf = z.db.get(CONFIG_KEY)
    if (conf) z.db.remove(conf)
    const accs = z.db.get(STORAGE_KEY)
    if (accs) z.db.remove(accs)
  } catch(e) {}
  
  accounts.value = []
  clearAuthData()
  lastAuthTime.value = 0
  showResetConfirmModal.value = false
  showSettings.value = false
  z.showNotification('数据已重置')
}

const refreshHOTP = async (acc: any) => {
  const now = Date.now()
  if (acc._lastRefresh && now - acc._lastRefresh < 5000) return
  
  acc.counter = (acc.counter || 0) + 1
  acc._lastRefresh = now
  saveAccounts(masterKey.value, masterSalt.value, config.value)
  await performTokenUpdate(acc)
}

const openAddModal = () => {
  if (!masterSalt.value) {
    passwordInput.value = ''; confirmPasswordInput.value = ''; passwordErrorMsg.value = ''
    showSetPasswordModal.value = true
    pendingAction.value = openAddModal
    return
  }
  
  modalTitle.value = '添加账号'
  modalForm.value = {
    id: '', name: '', secret: '',
    type: 'totp', period: 30, counter: 1,
    algorithm: 'SHA1', digits: 6,
    encrypted: false
  }
  nameError.value = false
  secretError.value = false
  secretErrorMsg.value = '密钥不合法'
  nameWarn.value = false
  showModal.value = true
  showSecret.value = false
  activeModalDropdown.value = null
}

const finalizeForm = async () => {
  if (!masterSalt.value && accounts.value.length === 0) {
    pendingAction.value = finalizeForm
    showSetPasswordModal.value = true
    passwordInput.value = ''; confirmPasswordInput.value = ''; passwordErrorMsg.value = ''
    return
  }
  
  if (masterSalt.value && !masterKey.value) {
    await tryAutoUnlock()
    if (!masterKey.value) {
      pendingAction.value = finalizeForm
      showVerifyPasswordModal.value = true
      return
    }
  }

  nameError.value = false
  secretError.value = false
  const nameVal = (modalForm.value.name || '').toString().trim()
  const secretVal = (modalForm.value.secret || '').toString().trim().replace(/\s/g, '')

  if (!nameVal) { nameError.value = true; nameWarn.value = false; return }
  if (!secretVal) { secretErrorMsg.value = '请输入密钥'; secretError.value = true; return }

  try {
    const testHex = base32tohex(secretVal)
    if (!testHex) throw new Error()
    const testToken = await getOTP({ ...modalForm.value, secret: secretVal })
    if (testToken === 'Error') throw new Error()
  } catch (e) {
    secretErrorMsg.value = '密钥合法性验证失败'; secretError.value = true; return
  }

  const secureAccount = { ...JSON.parse(JSON.stringify(modalForm.value)), name: nameVal, secret: secretVal }

  // 检测同名（排除自身，编辑时不与自己比较）
  const isDuplicate = accounts.value.some(a => a.name.toLowerCase() === nameVal.toLowerCase() && a.id !== secureAccount.id)
  if (isDuplicate && !nameWarn.value) {
    nameWarn.value = true
    return
  }
  nameWarn.value = false

  if (secureAccount.id) {
    const idx = accounts.value.findIndex(a => a.id === secureAccount.id)
    if (idx !== -1) accounts.value[idx] = { ...accounts.value[idx], ...secureAccount }
  } else {
    accounts.value.splice(getPinnedCount(), 0, { ...secureAccount, id: 'acc_' + Date.now(), pinned: false })
  }

  saveAccounts(masterKey.value, masterSalt.value, config.value)
  showModal.value = false
  updateAllTokens(accounts.value)
}

const handleEyeClick = () => {
  if (showSecret.value) {
    showSecret.value = false
    return
  }
  
  const now = Date.now()
  // 已经在 60s 豁免期内，或正在“添加”新账号时，无需验证
  if ((now - lastAuthTime.value < 60000) || !modalForm.value.id) {
    showSecret.value = !showSecret.value
    return
  }
  
  pendingAction.value = () => { showSecret.value = true }
  passwordInput.value = ''
  verifyErrorMsg.value = ''
  showVerifyPasswordModal.value = true
  nextTick(() => verifyInput.value?.focus())
}

const handleAction = (action: string) => {
  const acc = menuContext.value
  if (!acc) return
  if (action === 'edit') {
    modalTitle.value = '修改账号'
    modalForm.value = JSON.parse(JSON.stringify(acc))
    nameError.value = false
    secretError.value = false
    nameWarn.value = false
    showModal.value = true
    showSecret.value = false
    activeModalDropdown.value = null
  } else if (action === 'delete') {
    confirmData.value = { name: acc.name, id: acc.id }
    showConfirm.value = true
    deleteCountdown.value = 3
    if (deleteTimer) clearInterval(deleteTimer)
    deleteTimer = setInterval(() => {
      if (deleteCountdown.value > 0) deleteCountdown.value--
      else { clearInterval(deleteTimer); deleteTimer = null }
    }, 1000)
  } else if (action === 'pin') {
    acc.pinned = !acc.pinned
    const oldIdx = accounts.value.findIndex(a => a.id === acc.id)
    if (oldIdx !== -1) {
      const [item] = accounts.value.splice(oldIdx, 1)
      if (item.pinned) accounts.value.unshift(item)
      else accounts.value.splice(getPinnedCount(), 0, item)
    }
    saveAccounts(masterKey.value, masterSalt.value, config.value)
  }
  menuVisible.value = false
}

const copyCode = (acc: any, e: MouseEvent) => {
  const code = tokens.value[acc.id]
  const z = (window as any).ztools
  if (code && code !== 'Error') {
    if (e && e.shiftKey) z.copyText(code)
    else { z.hideMainWindowTypeString(code); z.copyText(code) }
    copiedId.value = acc.id
    if (acc.type === 'hotp') {
      const now = Date.now()
      if (!acc._lastRefresh || now - acc._lastRefresh >= 5000) {
        acc.counter = (acc.counter || 0) + 1
        acc._lastRefresh = now
        saveAccounts(masterKey.value, masterSalt.value, config.value); updateTokens(accounts.value)
      }
    }
    setTimeout(() => { if (copiedId.value === acc.id) copiedId.value = null }, 2000)
  }
}

const showContextMenu = (acc: any, e: MouseEvent) => {
  menuContext.value = acc
  menuVisible.value = true
  nextTick(() => {
    let x = e.clientX; let y = e.clientY
    if (x + 100 > window.innerWidth) x = window.innerWidth - 110
    if (y + 130 > window.innerHeight) y = window.innerHeight - 140
    menuPos.value = { x, y }
  })
}

const hideContextMenu = () => { menuVisible.value = false; showSelectMenu.value = false }

const confirmDelete = () => {
  if (deleteCountdown.value > 0) return
  accounts.value = accounts.value.filter(a => a.id !== confirmData.value.id)
  saveAccounts(masterKey.value, masterSalt.value, config.value)
  showConfirm.value = false
}

const openExternal = (url: string) => (window as any).ztools.shellOpenExternal(url)

const handleDragStart = (index: number, e: DragEvent) => {
  if (accounts.value[index].pinned) { e.preventDefault(); return }
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', index.toString())
  setTimeout(() => { dragIndex.value = index; isDragging.value = true }, 0)
}

let lastSwapTime = 0
const handleDragOver = (index: number, e: DragEvent) => {
  if (dragIndex.value === null || dragIndex.value === index || accounts.value[index].pinned) return
  const now = Date.now()
  if (now - lastSwapTime < 250) return
  const targetRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const mouseX = e.clientX; const mouseY = e.clientY
  const isAfter = dragIndex.value < index
  if (isAfter) {
    if (mouseX < targetRect.left + targetRect.width / 2 && mouseY < targetRect.top + targetRect.height / 2) return
  } else {
    if (mouseX > targetRect.left + targetRect.width / 2 && mouseY > targetRect.top + targetRect.height / 2) return
  }
  const draggedItem = accounts.value[dragIndex.value]
  accounts.value.splice(dragIndex.value, 1)
  accounts.value.splice(index, 0, draggedItem)
  dragIndex.value = index; lastSwapTime = now
}

const handleDragEnd = () => { isDragging.value = false; dragIndex.value = null; saveAccounts(masterKey.value, masterSalt.value, config.value) }

watch(() => modalForm.value.type, (newType, oldType) => {
  if (newType === 'steam') {
    modalForm.value.algorithm = 'SHA1'; modalForm.value.digits = 5; modalForm.value.period = 30
  } else if (oldType === 'steam') { modalForm.value.digits = 6 }
})

watch(() => modalForm.value.secret, (newVal) => {
  if (newVal && !newVal.includes(':') && !modalForm.value.encrypted) {
    const cleaned = newVal.toUpperCase().replace(/\s/g, '')
    if (cleaned !== newVal) modalForm.value.secret = cleaned
  }
})

onMounted(initialize)
onUnmounted(() => { stopTicker(); window.removeEventListener('click', hideContextMenu); clearAuthData() })
</script>

<template>
  <div id="app" @click="hideContextMenu">
    <div class="header">
      <div class="header-tip">左键输入 | Shift+左键复制 | 右键修改</div>
      <div class="btn-group">
        <button class="btn" @click="showAbout = true">关于</button>
        <button class="btn" @click="showSettings = true">设置</button>
        <button class="btn" @click="openAddModal">添加账号</button>
      </div>
    </div>

    <div class="content-scroll">
      <div v-if="accounts.length === 0" class="empty-tip-container">
        <div class="empty-tip">暂无账号</div>
      </div>
      <div v-else-if="filteredAccounts.length === 0" class="empty-tip-container">
        <div class="empty-tip">无匹配结果</div>
      </div>
      <transition-group name="list" tag="div" class="list-container">
        <AccountCard 
          v-for="{ acc, index } in filteredAccounts" 
          :key="acc.id" 
          :acc="acc" 
          :index="index"
          :token="tokens[acc.id]"
          :nextToken="nextTokens[acc.id]"
          :timeLeft="getAccountTimeLeft(acc)"
          :config="config"
          :copiedId="copiedId"
          :isDragging="isDragging"
          :dragIndex="dragIndex"
          :msNow="msNow"
          @dragstart="handleDragStart"
          @dragover="handleDragOver"
          @dragend="handleDragEnd"
          @drop="isDragging = false; dragIndex = null"
          @contextmenu="showContextMenu"
          @copy="copyCode"
          @refresh-hotp="refreshHOTP"
        />
      </transition-group>
    </div>

    <!-- Modals -->
    <SettingsModal 
      v-model:show="showSettings"
      v-model:showSelectMenu="showSelectMenu"
      v-model:showNextSelectMenu="showNextSelectMenu"
      v-model:showPinyinSelectMenu="showPinyinSelectMenu"
      :config="config"
      @save-config="saveConfig(config)"
      @reset-database="handleResetDatabase"
      @export-data="handleExportData"
      @import-data="handleImportData"
      @change-password="handleChangePassword"
    />

    <EditModal 
      :show="showModal"
      v-model:modelValue="modalForm"
      v-model:activeDropdown="activeModalDropdown"
      v-model:showSecret="showSecret"
      :title="modalTitle"
      :nameError="nameError"
      :nameWarn="nameWarn"
      :secretError="secretError"
      :secretErrorMsg="secretErrorMsg"
      @submit="finalizeForm"
      @eye-click="handleEyeClick"
      @update:show="(v) => { showModal = v; if (!v) nameWarn = false }"
    />

    <!-- Priority Modals (Authentication) -->
    <SetPasswordModal 
      v-model:show="showSetPasswordModal"
      v-model:passwordInput="passwordInput"
      v-model:confirmPasswordInput="confirmPasswordInput"
      :errorMsg="passwordErrorMsg"
      @submit="setMasterPassword(config)"
      @cancel="showSetPasswordModal = false"
    />

    <VerifyAuthModal 
      v-model:show="showVerifyPasswordModal"
      v-model:modelValue="passwordInput"
      :errorMsg="verifyErrorMsg"
      @verify="verifyMasterPassword"
      @cancel="showVerifyPasswordModal = false"
      @focus="verifyErrorMsg = ''"
    />

    <ImportDataModal 
      v-model:show="showImportModal"
      v-model:dataInput="importDataInput"
      v-model:passwordInput="importPasswordInput"
      :dataError="importDataError"
      :passwordError="importPasswordError"
      @verify="handleImportPasswordVerify"
      @cancel="cancelImport"
    />

    <ChangePasswordModal
      v-model:show="showChangePasswordModal"
      :currentError="changePwdCurrentError"
      :newError="changePwdNewError"
      :confirmError="changePwdConfirmError"
      @update:currentPassword="changePwdCurrent = $event"
      @update:newPassword="changePwdNew = $event"
      @update:confirmPassword="changePwdConfirm = $event"
      @submit="handleChangePasswordSubmit"
      @cancel="showChangePasswordModal = false"
    />

    <ConfirmModal 
      v-model:show="showConfirm"
      title="要删除该账号吗？"
      confirmText="确认"
      cancelText="取消"
      :isDanger="true"
      :countdown="deleteCountdown"
      @confirm="confirmDelete"
      @cancel="showConfirm = false"
    >
      <div class="form-item">
        <div class="delete-confirm-name">{{ confirmData.name }}</div>
      </div>
    </ConfirmModal>

    <ConfirmModal 
      v-model:show="showResetConfirmModal"
      title="确定要重置数据吗？"
      tip="此操作将永久删除所有账号和主密码，且不可撤销！"
      confirmText="确认"
      cancelText="取消"
      :isDanger="true"
      :countdown="countdown"
      @confirm="confirmReset"
      @cancel="showResetConfirmModal = false"
    />

    <ConfirmModal
      v-model:show="showExportConfirmModal"
      title="确定要导出数据吗？"
      tip="导出的数据使用当前主密码进行加密，导入时也需要主密码进行解密，请牢记你的主密码"
      confirmText="导出"
      cancelText="取消"
      :isDanger="false"
      :countdown="exportCountdown"
      @confirm="confirmExport"
      @cancel="showExportConfirmModal = false"
    />

    <!-- About Modal -->
    <transition name="modal-fade">
      <div class="modal-overlay" v-if="showAbout" @click.self="showAbout = false">
        <div class="modal-content">
          <div class="modal-title">关于插件</div>
          <div class="about-content">
            <div class="about-section">
              <span class="about-label">插件反馈</span>
              <a href="javascript:void(0)" @click="openExternal('https://github.com/dishuo183/ZTools-plugins/issues')"
                class="about-link">Github Issues</a>
            </div>
            <div class="about-section">
              <span class="about-label">工具仓库</span>
              <a href="javascript:void(0)" @click="openExternal('https://github.com/ZToolsCenter/ZTools')"
                class="about-link">Github (ZToolsCenter/ZTools)</a>
            </div>
            <div class="about-disclaimer">
              本项目<strong>全部代码均由人工智能（AI）生成</strong><br>项目作者不具备相关编程能力，无法对代码内容提供技术解释，亦不作任何功能或稳定性保证。如遇问题或有改进建议，欢迎自行修改、Fork 或提交 Issue。
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn" @click="showAbout = false"><span class="btn-text">好的</span></button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Context Menu -->
    <div class="context-menu" v-if="menuVisible" :style="{ left: menuPos.x + 'px', top: menuPos.y + 'px' }" @click.stop>
      <div class="menu-item" @click="handleAction('pin')">{{ menuContext?.pinned ? '取消置顶' : '置顶账号' }}</div>
      <div class="menu-item" @click="handleAction('edit')">修改账号</div>
      <div class="menu-item danger-item" @click="handleAction('delete')">删除账号</div>
    </div>

    <!-- Toast -->
    <transition name="fade">
      <div class="msg-toast" v-if="toastMsg">{{ toastMsg }}</div>
    </transition>
  </div>
</template>

<style>
#app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  flex-shrink: 0;
  height: 50px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: none; /* 彻底删除白线 */
}

.header-tip {
  font-size: 12px;
  color: var(--text-color); /* 显式指定颜色以适配主题 */
  opacity: 0.55;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.btn-group {
  display: flex;
  gap: 10px;
}

.content-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  position: relative; /* 关键 */
}

.empty-tip-container {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}

.empty-tip {
  font-size: 24px;
  font-weight: 700;
  opacity: 0.15;
  letter-spacing: 2px;
}

.list-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  position: relative;
}

.card {
  background: var(--card-bg);
  backdrop-filter: blur(14px);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 18px 18px;
  position: relative;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  overflow: hidden;
  cursor: pointer;
}

.card.dragging {
  opacity: 0.2 !important;
  transform: scale(0.98);
  box-shadow: none;
}

.card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
}

.card.low-time {
  --dynamic-color: #8F4D32;
}

.card:not(.low-time) {
  --dynamic-color: var(--primary-color);
}

.code-text,
.progress-bar,
.timer-circle {
  /* 基础动画：用于归位/回复，200ms 转场 */
  transition: all 0.2s ease-out, width 0.1s linear, stroke-dashoffset 0.1s linear;
}

/* 只有在 low-time 状态下才开启长达 5s 的报警颜色渐变 */
.low-time .code-text,
.low-time .progress-bar,
.low-time .timer-circle {
  transition: color 5.0s ease, stroke 5.0s ease, background-color 5.0s ease,
              width 0.1s linear, stroke-dashoffset 0.1s linear;
}

.card-header {
  margin-bottom: 8px; /* 增加下边距，使账号名称更突出 */
}

.card-title {
  font-weight: 700;
  font-size: 17px;
  opacity: 0.9;
}

.code-text {
  font-size: 30px;
  font-weight: 700;
  color: var(--dynamic-color);
  letter-spacing: 2px;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.next-code {
  font-size: 16px;
  opacity: 0.35;
  margin-left: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--text-color);
}

.timer-circle {
  stroke: var(--dynamic-color);
}

.progress-bar-container {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 4.5px;
  background: var(--border-color);
}

.progress-bar {
  height: 100%;
  background: var(--dynamic-color);
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--modal-bg);
  padding: 24px 20px;
  border-radius: 16px;
  width: 420px; /* 增加宽度，防止溢出 */
  max-width: 90vw;
  border: 1px solid var(--border-color);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}

.modal-title {
  margin: 0 0 18px 0;
  font-size: 18px;
  font-weight: 700;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 16px;
  margin-top: 20px;
}

.settings-item {
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.settings-label {
  font-weight: 600;
  font-size: 15px;
}

.settings-divider {
  font-size: 12px;
  font-weight: 700;
  opacity: 0.4;
  margin: 20px 0 12px 0;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 4px;
}

.setting-btn-align {
  width: 120px;
  padding: 10px 16px !important;
  border-radius: 10px !important;
  font-weight: 700;
  font-size: 14px;
}

.settings-divider.danger {
  color: #f25656;
  opacity: 0.8;
}

.full-width {
  width: 100% !important;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form-item {
  margin-bottom: 12px;
}

.form-item.full-width {
  grid-column: span 2;
}

.form-item label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  margin-left: 12px;
  margin-right: 12px;
  font-size: 13px;
  font-weight: 700;
}

.form-item input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: rgba(128, 128, 128, 0.05);
  color: var(--text-color);
  font-size: 15px;
  font-weight: 700;
  outline: none;
  box-sizing: border-box; /* 修复溢出关键 */
}

/* 统一账号弹窗中选择框和数字输入框的宽度 */
.form-item .settings-select,
.form-item input[type="number"] {
  width: 160px; /* 稍微减小长度 */
}

.form-item input:disabled {
  opacity: 0.4;
  cursor: default; /* 移除禁止符号，改为默认 */
  background: rgba(128, 128, 128, 0.1);
}

.label-error {
  color: #f25656;
  font-size: 13px; /* 同步标题大小 */
  font-weight: 700; /* 加粗 */
}

.label-warn {
  color: #e6a23c;
  font-size: 13px;
  font-weight: 700;
}

.settings-select {
  position: relative;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: rgba(128, 128, 128, 0.08);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  transition: all 0.3s;
  box-sizing: border-box;
}

/* 设置页面选项保持右对齐且紧凑 */
.settings-item .settings-select {
  width: 120px;
}

.settings-select:hover {
  border-color: var(--primary-color);
  background-color: rgba(128, 128, 128, 0.12);
}

.settings-select.disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

.settings-select .arrow {
  transition: transform 0.3s;
}

.settings-select.open .arrow {
  transform: rotate(180deg);
}

.select-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background: var(--menu-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 4px;
  z-index: 2000;
  min-width: 100%;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  animation: menuFadeIn 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-sizing: border-box;
}

@keyframes menuFadeIn {
  from { opacity: 0; transform: scaleY(0.95) translateY(-5px); }
  to { opacity: 1; transform: scaleY(1) translateY(0); }
}

.select-menu.up {
  top: auto;
  bottom: calc(100% + 5px);
}

.select-item {
  padding: 8px 12px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  font-size: 14px;
}

.select-item:hover {
  background: var(--menu-hover);
}

.select-item.active {
  color: var(--primary-color);
  background: rgba(128, 128, 128, 0.05);
}

.context-menu {
  position: fixed;
  background: var(--menu-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 4px;
  width: 110px;
  z-index: 3000;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
}

.menu-item {
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 700;
  text-align: center; /* 居中显示 */
}

.menu-item:hover {
  background: var(--menu-hover);
}

.danger-item:hover {
  background: rgba(242, 86, 86, 0.15) !important;
  color: #f25656 !important;
}

/* 专项：确认删除按钮 */
.btn-confirm-delete {
  background: #d03050 !important;
  color: white !important; /* 强制白色以便在红底显示 */
  width: 90px; /* 进一步缩小宽度 */
  justify-content: center;
}

.btn-confirm-delete:not(.disabled):hover {
  background: #e04060 !important;
}

.form-input-container {
  position: relative;
  display: flex;
  align-items: center;
}

.eye-btn {
  position: absolute;
  right: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  opacity: 0.6;
  transition: opacity 0.2s;
  color: var(--text-color);
}

.eye-btn:hover {
  opacity: 1;
}

.about-section {
  margin-bottom: 20px;
  padding: 12px;
  background: rgba(128, 128, 128, 0.05);
  border-radius: 8px;
}

.about-label {
  font-weight: 700;
  color: var(--primary-color);
  margin-bottom: 4px;
  display: block;
}

.about-link {
  color: var(--primary-color);
  text-decoration: none;
  font-weight: 500;
}

.about-disclaimer {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.6;
  opacity: 0.8;
}

.pin-indicator {
  position: absolute;
  left: 0;
  top: 25%;
  height: 50%;
  width: 4.5px;
  background: var(--primary-color);
  border-radius: 0 2px 2px 0;
}

.delete-confirm-name {
  font-size: 15px;
  font-weight: 500;
  padding: 12px;
  background: rgba(128, 128, 128, 0.05);
  border-radius: 8px;
  border: 1px solid var(--border-color);
  margin-top: 8px;
  text-align: center; /* 居中显示 */
}

.modal-content.modal-delete {
  width: 320px; /* 减小宽度 */
}

.modal-tip {
  font-size: 13px;
  color: var(--text-color);
  opacity: 0.7;
  margin-bottom: 20px;
  line-height: 1.5;
}

.modal-tip.bold {
  font-weight: 700;
}

.modal-tip.dark {
  opacity: 1; /* 加深显示 */
}


.btn-primary {
  background: var(--primary-color);
  color: var(--btn-text);
}

.btn.btn-danger {
  background: #d03050;
  color: white !important; /* 强制白色以便在红底显示 */
}

.btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.timer-container .refresh-btn {
  cursor: pointer;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 20px;
  transition: all 0.2s;
  background: transparent;
}

.timer-container .refresh-btn:not(.cooling):hover {
  background: rgba(128, 128, 128, 0.15);
  transform: rotate(30deg);
}

.timer-container .refresh-btn:active:not(.cooling) {
  transform: scale(0.8) rotate(180deg);
  background: rgba(128, 128, 128, 0.25);
}

.timer-container .refresh-btn.cooling {
  opacity: 0.3;
  filter: grayscale(1);
  cursor: default;
  pointer-events: none;
  transform: none;
}

.msg-toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 13px;
  z-index: 4000;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}

.list-move {
  transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.list-enter-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.list-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
  position: absolute;
  pointer-events: none;
}

.list-enter-from {
  opacity: 0;
  transform: scale(0.96);
}

.list-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-6px);
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
