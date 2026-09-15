<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { evidenceLabel, scanStatusLabel, statusLabel } from './composables/presentation'
import { useLanDiscovery } from './composables/useLanDiscovery'

const {
  cancelScan,
  devices,
  error,
  interfaces,
  loadingInterfaces,
  refreshInterfaces,
  resolveHostnames,
  restrictedInterfaceConfirmed,
  result,
  scanning,
  selectedInterface,
  selectedInterfaceId,
  startScan,
} = useLanDiscovery()

const copiedIp = ref('')

async function copyIp(ip: string) {
  const ok = await window.lanDiscovery?.copyText(ip)
  if (!ok) return
  copiedIp.value = ip
  window.setTimeout(() => {
    if (copiedIp.value === ip) copiedIp.value = ''
  }, 1200)
}

onMounted(refreshInterfaces)
</script>

<template>
  <main class="shell">
    <header class="masthead">
      <div class="brand-mark" aria-hidden="true">
        <span class="signal signal-a" />
        <span class="signal signal-b" />
        <span class="signal signal-c" />
        <span class="signal-dot" />
      </div>
      <div class="heading">
        <p class="eyebrow">LOCAL NETWORK / READ-ONLY</p>
        <h1>局域网设备发现</h1>
        <p>读取系统邻居表，并通过受限 ICMP 探测确认当前网络中的可见设备。</p>
      </div>
      <div class="privacy-badge"><span /> 数据仅在本机处理</div>
    </header>

    <section class="control-panel" aria-label="扫描设置">
      <div class="field interface-field">
        <label for="network-interface">网络接口</label>
        <select id="network-interface" v-model="selectedInterfaceId" :disabled="scanning || loadingInterfaces">
          <option v-if="interfaces.length === 0" value="">未找到可用 IPv4 网卡</option>
          <option v-for="item in interfaces" :key="item.id" :value="item.id">
            {{ item.name }} · {{ item.cidr }}{{ item.requiresConfirmation ? ' · 需确认' : '' }}
          </option>
        </select>
      </div>

      <label class="toggle-row">
        <input v-model="resolveHostnames" type="checkbox" :disabled="scanning">
        <span class="toggle" aria-hidden="true"><span /></span>
        <span><strong>解析设备名称</strong><small>可能向系统 DNS 发起反向查询</small></span>
      </label>

      <label v-if="selectedInterface?.requiresConfirmation" class="restricted-confirm">
        <input v-model="restrictedInterfaceConfirmed" type="checkbox" :disabled="scanning">
        <span>
          我确认扫描此{{ selectedInterface.riskReason || '受限网络接口' }}
          <small>该接口默认不扫描；确认后仍仅执行最多 254 个 ICMP Echo。</small>
        </span>
      </label>

      <div class="actions">
        <button class="secondary" type="button" :disabled="scanning || loadingInterfaces" @click="refreshInterfaces">
          {{ loadingInterfaces ? '刷新中…' : '刷新网卡' }}
        </button>
        <button
          v-if="!scanning"
          class="primary"
          type="button"
          :disabled="!selectedInterfaceId || Boolean(selectedInterface?.requiresConfirmation && !restrictedInterfaceConfirmed)"
          @click="startScan"
        >
          开始扫描
        </button>
        <button v-else class="danger" type="button" @click="cancelScan">停止扫描</button>
      </div>
    </section>

    <p v-if="selectedInterface" class="scan-boundary">
      本次范围：<strong>{{ selectedInterface.cidr }}</strong>；最多探测 254 个地址，不执行端口扫描。
    </p>

    <section v-if="scanning" class="progress-card" aria-live="polite">
      <span class="radar" aria-hidden="true"><span /></span>
      <div><strong>正在确认局域网设备</strong><p>读取邻居表并发送受限 ICMP Echo，可随时停止。</p></div>
    </section>

    <div v-if="error" class="alert error-alert" role="alert">{{ error }}</div>

    <template v-if="result && !scanning">
      <section class="summary-strip" aria-label="扫描摘要">
        <div><span>设备</span><strong>{{ devices.length }}</strong></div>
        <div><span>已确认在线</span><strong>{{ devices.filter((item) => item.onlineStatus === 'online').length }}</strong></div>
        <div><span>探测地址</span><strong>{{ result.scannedHostCount }}</strong></div>
        <div><span>耗时</span><strong>{{ (result.durationMs / 1000).toFixed(1) }}s</strong></div>
        <p :class="['result-status', `result-${result.status}`]">{{ scanStatusLabel(result.status) }}</p>
      </section>

      <div v-for="warning in result.warnings" :key="warning" class="alert warning-alert">{{ warning }}</div>
      <div v-for="issue in result.errors" :key="issue.code" class="alert error-alert">{{ issue.message }}</div>

      <section class="device-section">
        <div class="section-title">
          <div><p class="eyebrow">DISCOVERED DEVICES</p><h2>发现的设备</h2></div>
          <small>结果为当前时刻的局部快照</small>
        </div>
        <div v-if="devices.length" class="table-wrap">
          <table>
            <thead><tr><th>IP 地址</th><th>设备名称</th><th>厂商</th><th>在线状态</th><th>判断依据</th></tr></thead>
            <tbody>
              <tr v-for="device in devices" :key="device.ip">
                <td data-label="IP 地址">
                  <button class="ip-copy" type="button" :title="`复制 ${device.ip}`" @click="copyIp(device.ip)">
                    {{ device.ip }} <span>{{ copiedIp === device.ip ? '已复制' : '复制' }}</span>
                  </button>
                  <em v-if="device.isSelf">本机</em>
                </td>
                <td data-label="设备名称">{{ device.hostname || '—' }}</td>
                <td data-label="厂商">{{ device.vendor || '未知厂商' }}</td>
                <td data-label="在线状态"><span :class="['state-pill', `state-${device.onlineStatus}`]"><i />{{ statusLabel(device.onlineStatus) }}</span></td>
                <td class="evidence" data-label="判断依据">{{ evidenceLabel(device) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="result-empty" role="status">
          <strong>未发现当前可见设备</strong>
          <p>可以稍后重新扫描；部分设备可能处于休眠状态，或不会响应受限 ICMP 探测。</p>
          <button class="secondary" type="button" @click="startScan">重新扫描</button>
        </div>
      </section>
    </template>

    <section v-else-if="!scanning" class="empty-state">
      <div class="network-sketch" aria-hidden="true"><i /><i /><i /><span /></div>
      <h2>准备扫描当前网络</h2>
      <p>选择网卡后手动开始。插件不会自动扫描，也不会检测端口、服务或漏洞。</p>
    </section>

    <footer>
      <span>邻居表 + ICMP Echo</span>
      <span>macOS · Windows · Linux</span>
      <span>不上传扫描结果</span>
    </footer>
  </main>
</template>
