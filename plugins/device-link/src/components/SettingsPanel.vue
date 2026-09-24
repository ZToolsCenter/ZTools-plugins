<script setup lang="ts">
import { reactive, watch } from 'vue'
import { Cloud, Database, LockKeyhole, RefreshCw, Server, Shield, X } from 'lucide-vue-next'
import type { DeviceLinkSettings, SaveSettingsInput, SaveWebDavInput } from '../types'

const props = defineProps<{ settings: DeviceLinkSettings; busy: boolean }>()
const emit = defineEmits<{
  close: []
  saveSettings: [input: SaveSettingsInput]
  saveWebDav: [input: SaveWebDavInput]
  sync: []
}>()

const general = reactive<SaveSettingsInput>({
  deviceName: '', port: 32125, pairingCodeMode: 'random', customPairingCode: '',
  autoAcceptTrustedText: true, autoAcceptTrustedFiles: false, maxIncomingFileBytes: 10 * 1024 ** 3,
})
const webdav = reactive<SaveWebDavInput>({ enabled: false, baseUrl: '', username: '', password: '', syncPassword: '' })

watch(() => props.settings, (value) => {
  Object.assign(general, {
    deviceName: value.deviceName,
    port: value.port,
    pairingCodeMode: value.pairingCodeMode,
    customPairingCode: '',
    autoAcceptTrustedText: value.autoAcceptTrustedText,
    autoAcceptTrustedFiles: value.autoAcceptTrustedFiles,
    maxIncomingFileBytes: value.maxIncomingFileBytes,
  })
  Object.assign(webdav, {
    enabled: value.webdav.enabled,
    baseUrl: value.webdav.baseUrl,
    username: value.webdav.username,
    password: '',
    syncPassword: '',
  })
}, { immediate: true })
</script>

<template>
  <div class="overlay" @mousedown.self="emit('close')">
    <section class="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <button class="dialog__close" type="button" aria-label="关闭" @click="emit('close')"><X :size="19" /></button>
      <div class="dialog__eyebrow"><Shield :size="15" />连接策略</div>
      <h2 id="settings-title">设置与同步</h2>

      <div class="settings-scroll">
        <section class="settings-section">
          <div class="settings-heading"><span class="settings-heading__icon"><Server :size="18" /></span><div><strong>本机服务</strong><small>局域网发现、配对与接收限制</small></div></div>
          <div class="form-grid">
            <label class="form-field"><span>设备名称</span><input v-model="general.deviceName" maxlength="60"></label>
            <label class="form-field"><span>监听端口</span><input v-model.number="general.port" type="number" min="1024" max="65535"></label>
            <label class="form-field form-field--wide"><span>匹配码策略</span><select v-model="general.pairingCodeMode"><option value="random">每次随机生成（推荐）</option><option value="custom">使用自定义匹配码</option></select></label>
            <label v-if="general.pairingCodeMode === 'custom'" class="form-field form-field--wide"><span>自定义匹配码</span><input v-model="general.customPairingCode" type="password" inputmode="numeric" minlength="6" maxlength="12" :placeholder="settings.customPairingCodeSet ? '留空表示不修改' : '6–12 位数字'"></label>
            <label class="form-field form-field--wide"><span>单文件接收上限</span><select v-model.number="general.maxIncomingFileBytes"><option :value="2 * 1024 ** 3">2 GB</option><option :value="10 * 1024 ** 3">10 GB</option><option :value="100 * 1024 ** 3">100 GB</option><option :value="1024 * 1024 ** 3">1 TB</option></select></label>
          </div>
          <label class="switch-row"><input v-model="general.autoAcceptTrustedText" type="checkbox"><span><strong>可信设备自动接收文本</strong><small>收到后进入会话，不自动写入系统剪贴板</small></span></label>
          <label class="switch-row"><input v-model="general.autoAcceptTrustedFiles" type="checkbox"><span><strong>可信设备自动接收文件</strong><small>关闭时仍需在发送端主动选择，接收后保存在隔离目录</small></span></label>
          <button class="button button--primary" type="button" @click="emit('saveSettings', { ...general })">保存本机设置</button>
        </section>

        <section class="settings-section">
          <div class="settings-heading"><span class="settings-heading__icon"><Cloud :size="18" /></span><div><strong>加密 WebDAV</strong><small>用于离线补拉和多端历史，不承担实时传输</small></div></div>
          <label class="switch-row"><input v-model="webdav.enabled" type="checkbox"><span><strong>启用 WebDAV 同步</strong><small>消息、文件名与附件全部在本机加密后上传</small></span></label>
          <div class="form-grid" :class="{ disabled: !webdav.enabled }">
            <label class="form-field form-field--wide"><span>WebDAV 地址</span><input v-model="webdav.baseUrl" type="url" placeholder="https://dav.example.com/DeviceLink/" :disabled="!webdav.enabled"></label>
            <label class="form-field"><span>用户名</span><input v-model="webdav.username" autocomplete="username" :disabled="!webdav.enabled"></label>
            <label class="form-field"><span>WebDAV 密码</span><input v-model="webdav.password" type="password" :placeholder="settings.webdav.hasPassword ? '留空表示不修改' : '必填'" autocomplete="current-password" :disabled="!webdav.enabled"></label>
            <label class="form-field form-field--wide"><span>同步加密密码</span><input v-model="webdav.syncPassword" type="password" minlength="10" :placeholder="settings.webdav.hasSyncPassword ? '留空表示不修改' : '至少 10 个字符；其他设备必须一致'" :disabled="!webdav.enabled"></label>
          </div>
          <div class="sync-status"><Database :size="15" /><span>状态：{{ settings.webdav.status || '未配置' }}</span><span v-if="settings.webdav.lastSyncedAt">上次同步：{{ new Date(settings.webdav.lastSyncedAt).toLocaleString('zh-CN') }}</span></div>
          <div class="dialog-actions dialog-actions--left"><button class="button button--primary" type="button" @click="emit('saveWebDav', { ...webdav })"><LockKeyhole :size="16" />保存同步设置</button><button class="button button--secondary" type="button" :disabled="busy || !settings.webdav.enabled" @click="emit('sync')"><RefreshCw :size="16" />立即同步</button></div>
        </section>
      </div>
    </section>
  </div>
</template>
