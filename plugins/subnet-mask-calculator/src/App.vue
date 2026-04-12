<template>
  <div class="app">
    <h1 class="title">子网掩码计算器</h1>

    <!-- 输入区 -->
    <div class="input-section">
      <div class="input-row">
        <div class="input-group">
          <label>IP 地址</label>
          <input
            v-model="ipInput"
            type="text"
            placeholder="192.168.1.100"
            @keyup.enter="calculate"
          />
        </div>
        <div class="input-group cidr-group">
          <label>CIDR</label>
          <div class="cidr-input">
            <span class="slash">/</span>
            <input
              v-model="cidrInput"
              type="number"
              min="0"
              max="32"
              placeholder="24"
              @keyup.enter="calculate"
            />
          </div>
        </div>
        <div class="input-group mask-group">
          <label>或 子网掩码</label>
          <input
            v-model="maskInput"
            type="text"
            placeholder="255.255.255.0"
            @keyup.enter="calculateByMask"
          />
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" @click="calculate">计 算</button>
        <button class="btn btn-secondary" @click="calculateByMask">掩码计算</button>
        <button class="btn btn-reset" @click="reset">清空</button>
      </div>
      <div v-if="errorMsg" class="error">{{ errorMsg }}</div>
    </div>

    <!-- 结果区 -->
    <div v-if="result" class="result-section">
      <h2>计算结果</h2>
      <div class="result-grid">
        <div class="result-item" v-for="item in resultItems" :key="item.label">
          <span class="result-label">{{ item.label }}</span>
          <span class="result-value" @click="copyValue(item.value)">{{ item.value }}</span>
        </div>
      </div>
      <div class="copy-tip">💡 点击结果可复制</div>
    </div>

    <!-- CIDR 快速参考 -->
    <div class="ref-section">
      <h2 @click="showRef = !showRef" class="ref-toggle">
        CIDR 快速参考 {{ showRef ? '▲' : '▼' }}
      </h2>
      <div v-if="showRef" class="ref-table">
        <div class="ref-header">
          <span>CIDR</span>
          <span>子网掩码</span>
          <span>可用主机数</span>
        </div>
        <div
          v-for="r in commonCidrList"
          :key="r.cidr"
          class="ref-row"
          @click="fillCidr(r.cidr)"
        >
          <span>/{{ r.cidr }}</span>
          <span>{{ r.mask }}</span>
          <span>{{ formatNumber(r.hosts) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  calculateSubnet,
  parseCidr,
  isValidIp,
  isValidMask,
  maskToCidr,
  formatNumber,
  cidrQuickRef,
  type SubnetResult,
} from './utils/subnet'

const ipInput = ref('192.168.1.100')
const cidrInput = ref('24')
const maskInput = ref('')
const errorMsg = ref('')
const result = ref<SubnetResult | null>(null)
const showRef = ref(false)

const commonCidrList = computed(() =>
  cidrQuickRef.filter((r) => r.cidr >= 8 && r.cidr <= 30)
)

const resultItems = computed(() => {
  if (!result.value) return []
  const r = result.value
  return [
    { label: 'IP 地址', value: r.ip },
    { label: 'CIDR 表示', value: `${r.ip}/${r.cidr}` },
    { label: '子网掩码', value: r.subnetMask },
    { label: '通配符掩码', value: r.wildcardMask },
    { label: '网络地址', value: r.networkAddress },
    { label: '广播地址', value: r.broadcastAddress },
    {
      label: '可用主机范围',
      value: r.firstHost && r.lastHost ? `${r.firstHost} - ${r.lastHost}` : '无',
    },
    { label: '可用主机数', value: formatNumber(r.hostCount) },
    { label: 'IP 类别', value: r.ipClass },
    { label: '私有地址', value: r.isPrivate ? '是' : '否' },
    { label: 'IP 二进制', value: r.binaryIp },
    { label: '掩码二进制', value: r.binaryMask },
  ]
})

function calculate() {
  errorMsg.value = ''
  result.value = null

  if (!isValidIp(ipInput.value)) {
    errorMsg.value = 'IP 地址格式不正确'
    return
  }

  const cidr = parseInt(cidrInput.value)
  if (isNaN(cidr) || cidr < 0 || cidr > 32) {
    errorMsg.value = 'CIDR 必须在 0-32 之间'
    return
  }

  result.value = calculateSubnet(ipInput.value, cidr)
  if (!result.value) {
    errorMsg.value = '计算失败，请检查输入'
  }
}

function calculateByMask() {
  errorMsg.value = ''
  result.value = null

  if (!isValidIp(ipInput.value)) {
    errorMsg.value = 'IP 地址格式不正确'
    return
  }

  if (!isValidMask(maskInput.value)) {
    errorMsg.value = '子网掩码格式不正确'
    return
  }

  const cidr = maskToCidr(maskInput.value)
  if (cidr < 0) {
    errorMsg.value = '无法解析子网掩码'
    return
  }

  cidrInput.value = String(cidr)
  result.value = calculateSubnet(ipInput.value, cidr)
}

function reset() {
  ipInput.value = ''
  cidrInput.value = ''
  maskInput.value = ''
  errorMsg.value = ''
  result.value = null
}

function fillCidr(cidr: number) {
  cidrInput.value = String(cidr)
  if (isValidIp(ipInput.value)) {
    calculate()
  }
}

function copyValue(text: string) {
  if (window.subnetApi?.copyToClipboard) {
    window.subnetApi.copyToClipboard(text)
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
  }
}

// 检查是否通过 CIDR 正则触发
const params = new URLSearchParams(window.location.search)
const cidrParam = params.get('cidr')
if (cidrParam) {
  const parsed = parseCidr(cidrParam)
  if (parsed) {
    ipInput.value = parsed.ip
    cidrInput.value = String(parsed.cidr)
    calculate()
  }
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    sans-serif;
  background: #1a1a2e;
  color: #e0e0e0;
  min-height: 100vh;
}

.app {
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 16px;
}

.title {
  text-align: center;
  font-size: 22px;
  font-weight: 600;
  color: #7c9aff;
  margin-bottom: 20px;
}

/* 输入区 */
.input-section {
  background: #16213e;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}

.input-row {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.input-group {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 120px;
}

.input-group label {
  font-size: 12px;
  color: #8a8fa8;
  margin-bottom: 6px;
}

.input-group input {
  background: #0f3460;
  border: 1px solid #2a3a5c;
  border-radius: 8px;
  padding: 10px 12px;
  color: #e0e0e0;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.input-group input:focus {
  border-color: #7c9aff;
}

.input-group input::placeholder {
  color: #4a5568;
}

.cidr-input {
  display: flex;
  align-items: center;
  background: #0f3460;
  border: 1px solid #2a3a5c;
  border-radius: 8px;
  overflow: hidden;
}

.cidr-input .slash {
  padding: 0 8px;
  color: #7c9aff;
  font-size: 16px;
  font-weight: bold;
}

.cidr-input input {
  background: transparent;
  border: none;
  padding: 10px 12px 10px 0;
  color: #e0e0e0;
  font-size: 14px;
  outline: none;
  width: 100%;
}

.cidr-group {
  flex: 0 0 80px;
  min-width: 80px;
}

.btn-row {
  display: flex;
  gap: 10px;
}

.btn {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: #7c9aff;
  color: #1a1a2e;
}

.btn-primary:hover {
  background: #5f7eff;
}

.btn-secondary {
  background: #0f3460;
  color: #7c9aff;
  border: 1px solid #7c9aff;
}

.btn-secondary:hover {
  background: #162856;
}

.btn-reset {
  background: #2a2a3e;
  color: #8a8fa8;
}

.btn-reset:hover {
  background: #353550;
}

.error {
  margin-top: 10px;
  color: #ff6b6b;
  font-size: 13px;
}

/* 结果区 */
.result-section {
  background: #16213e;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}

.result-section h2 {
  font-size: 16px;
  color: #7c9aff;
  margin-bottom: 16px;
}

.result-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.result-item {
  background: #0f3460;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.result-label {
  font-size: 11px;
  color: #8a8fa8;
}

.result-value {
  font-size: 13px;
  color: #e0e0e0;
  word-break: break-all;
  cursor: pointer;
  transition: color 0.2s;
}

.result-value:hover {
  color: #7c9aff;
}

.copy-tip {
  text-align: center;
  font-size: 12px;
  color: #4a5568;
  margin-top: 12px;
}

/* CIDR 快速参考 */
.ref-section {
  background: #16213e;
  border-radius: 12px;
  padding: 20px;
}

.ref-toggle {
  font-size: 16px;
  color: #7c9aff;
  cursor: pointer;
  user-select: none;
}

.ref-table {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ref-header {
  display: grid;
  grid-template-columns: 60px 1fr 1fr;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: #8a8fa8;
  font-weight: 600;
}

.ref-row {
  display: grid;
  grid-template-columns: 60px 1fr 1fr;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.ref-row:hover {
  background: #0f3460;
}
</style>
