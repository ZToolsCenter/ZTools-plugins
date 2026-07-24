<template>
  <main class="shell">
    <section class="panel">
      <header class="topbar">
        <div class="brand">
          <span class="logo-mark">
            <img src="/logo.png" alt="" />
          </span>
          <div>
            <h1>中森互联</h1>
            <p>内核 {{ coreVersionText }}</p>
          </div>
        </div>
        <div class="top-actions">
          <button class="icon-button" type="button" title="设置" @click="showSettings = true">
            ⚙
          </button>
          <div class="status-line">
            <span class="status-dot" :class="statusClass"></span>
            <strong :class="statusClass">{{ displayStatusText }}</strong>
          </div>
        </div>
      </header>

      <ol v-if="!isBoundView" class="flow-steps" aria-label="使用流程">
        <li>
          <span class="step-index">1</span>
          <span class="step-copy">
            <strong>注册登录</strong>
            <small>进入官网</small>
          </span>
        </li>
        <li>
          <span class="step-index">2</span>
          <span class="step-copy">
            <strong>创建客户端</strong>
            <small>复制激活密钥</small>
          </span>
        </li>
        <li>
          <span class="step-index">3</span>
          <span class="step-copy">
            <strong>绑定插件</strong>
            <small>粘贴密钥</small>
          </span>
        </li>
        <li>
          <span class="step-index">4</span>
          <span class="step-copy">
            <strong>创建通道</strong>
            <small>配置本地服务</small>
          </span>
        </li>
      </ol>

      <p v-if="status.lastError || formError" class="error">{{ friendlyError(status.lastError || formError) }}</p>

      <template v-if="isBoundView">
        <div class="toolbar">
          <div>
            <h2>映射列表</h2>
            <p>{{ mappings.length }} 个通道</p>
          </div>
          <div class="actions">
            <button class="btn secondary" type="button" @click="rebindClient">重新绑定</button>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>本地服务</th>
                <th>访问地址</th>
                <th>限速</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!mappings.length">
                <td colspan="5" class="empty">暂无映射</td>
              </tr>
              <tr v-for="mapping in mappings" :key="mapping.id || mapping.name">
                <td :title="mapping.name || '-'">
                  <strong>{{ mapping.name || "-" }}</strong>
                  <small v-if="mapping.description">{{ mapping.description }}</small>
                </td>
                <td :title="mapping.localAddr || '-'">{{ mapping.localAddr || "-" }}</td>
                <td>
                  <div class="copy-cell">
                    <span :title="mapping.remoteAddr || '-'">{{ mapping.remoteAddr || "-" }}</span>
                    <button
                      v-if="mapping.remoteAddr"
                      class="icon-button"
                      type="button"
                      title="复制"
                      @click="copyRemote(mapping.remoteAddr)"
                    >
                      {{ copiedValue === mapping.remoteAddr ? "✓" : "⧉" }}
                    </button>
                  </div>
                </td>
                <td>{{ formatBandwidthForCustomer(mapping.bandwidth) }}</td>
                <td>
                  <span class="pill" :class="mapping.enabled ? 'success' : 'muted'">
                    {{ mapping.enabled ? "启用" : "禁用" }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <div v-else class="bind-panel">
        <h2>绑定客户端</h2>
        <div v-if="runtimeNoticeVisible" class="runtime-card">
          <div>
            <strong>{{ runtimeTitle }}</strong>
            <small>{{ runtimeMessage }}</small>
          </div>
          <div v-if="runtimeProgressVisible" class="runtime-progress">
            <span :style="{ width: `${runtimeProgress.percent}%` }"></span>
          </div>
          <button
            v-if="runtimeCanDownload"
            class="btn secondary"
            type="button"
            :disabled="runtimeBusy"
            @click="downloadRuntime"
          >
            {{ runtimeButtonText }}
          </button>
        </div>
        <form @submit.prevent="startClient">
          <label>
            <span>激活密钥</span>
            <input
              v-model="activationKey"
              type="password"
              autocomplete="off"
              placeholder="ak_xxx"
            />
          </label>
          <button class="btn primary" type="submit" :disabled="status.running || runtimeBusy">
            {{ bindButtonText }}
          </button>
        </form>
        <div class="register-entry">
          <span>还没有账号或激活密钥？</span>
          <button class="text-link" type="button" @click="openOfficialSite">去官网注册账号</button>
        </div>
      </div>
    </section>

    <div v-if="showSettings" class="settings-mask">
      <section class="settings-panel">
        <header>
          <h2>设置</h2>
          <button class="icon-button" type="button" title="关闭" @click="showSettings = false">×</button>
        </header>
        <div class="settings-info">
          <div>
            <span>平台地址</span>
            <strong>{{ status.platformURL || "http://39.106.140.106" }}</strong>
          </div>
          <div>
            <span>客户端 ID</span>
            <strong>{{ status.clientId || "-" }}</strong>
          </div>
          <div>
            <span>frps 节点</span>
            <strong>{{ status.frpsServer || "-" }}</strong>
          </div>
          <div>
            <span>配置版本</span>
            <strong>{{ status.configVersion || "-" }}</strong>
          </div>
          <div>
            <span>进程 PID</span>
            <strong>{{ status.pid || "-" }}</strong>
          </div>
        </div>
        <div class="settings-log">
          <div class="settings-log-header">
            <strong>事件日志</strong>
            <button class="text-button" type="button" @click="clearEvents">清空</button>
          </div>
          <div class="event-log">
            <div v-if="!events.length" class="empty compact">暂无事件</div>
            <div v-for="(event, index) in recentEvents" :key="`${event.time}-${index}`" class="event-item">
              <span>{{ formatTime(event.time) }}</span>
              <strong>{{ event.type || "event" }}</strong>
              <span :title="eventMessage(event)">{{ eventMessage(event) }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </main>

  <div class="toast" :class="{ show: toast }">{{ toast }}</div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

const STORAGE_KEY = "zosenlink-tunnel:activation-key";

const activationKey = ref("");
const boundKeyExists = ref(false);
const formError = ref("");
const showSettings = ref(false);
const toast = ref("");
const copiedValue = ref("");
const runtimeStatus = ref("checking");
const runtimeMessage = ref("正在检查客户端依赖");
const runtimeVersion = ref("");
const runtimeLatestVersion = ref("");
const runtimeProgress = ref({
  phase: "",
  percent: 0,
  downloaded: 0,
  total: 0
});
const status = ref({
  running: false,
  status: "idle",
  statusText: "未绑定",
  platformURL: "http://39.106.140.106",
  mappings: [],
  events: []
});

let toastTimer = null;

const mappings = computed(() => status.value.mappings || []);
const events = computed(() => status.value.events || []);
const recentEvents = computed(() => events.value.slice(-80).reverse());
const isBoundView = computed(() => status.value.running || Boolean(status.value.clientId) || boundKeyExists.value);
const runtimeBusy = computed(() => ["checking", "downloading", "extracting"].includes(runtimeStatus.value));
const runtimeCanDownload = computed(() => ["missing", "outdated", "error"].includes(runtimeStatus.value));
const runtimeProgressVisible = computed(() => ["downloading", "extracting"].includes(runtimeStatus.value));
const runtimeNoticeVisible = computed(() => runtimeStatus.value !== "ready");
const runtimeTitle = computed(() => {
  if (runtimeStatus.value === "checking") return "检查客户端依赖";
  if (runtimeStatus.value === "downloading") return "下载客户端依赖";
  if (runtimeStatus.value === "extracting") return "安装客户端依赖";
  if (runtimeStatus.value === "outdated") return "发现客户端依赖更新";
  if (runtimeStatus.value === "error") return "客户端依赖不可用";
  return "准备客户端依赖";
});
const runtimeButtonText = computed(() => runtimeStatus.value === "outdated" ? "下载更新" : "下载客户端");
const bindButtonText = computed(() => {
  if (runtimeStatus.value === "downloading") return `下载中 ${runtimeProgress.value.percent || 0}%`;
  if (runtimeStatus.value === "extracting") return "安装中";
  if (runtimeStatus.value === "checking") return "检查中";
  if (status.value.status === "starting") return "启动中";
  return "绑定";
});
const displayStatusText = computed(() => {
  if (!isBoundView.value && !status.value.running) return "未绑定";
  if (status.value.status === "starting") return "连接中";
  return status.value.statusText || "未绑定";
});
const coreVersionText = computed(() => (
  status.value.kernelVersion
  || runtimeVersion.value
  || status.value.runtimeVersion
  || runtimeLatestVersion.value
  || "-"
));
const statusClass = computed(() => {
  const current = status.value.status;
  if (current === "online" || current === "config_updated") return "success";
  if (current === "error") return "danger";
  if (["starting", "activating", "connecting", "reconnecting", "server_switched", "dependency_checking", "dependency_downloading", "dependency_extracting"].includes(current)) {
    return "warning";
  }
  return "muted";
});

function storage() {
  return window.ztools?.dbStorage;
}

function getStoredKey() {
  return storage()?.getItem(STORAGE_KEY) || window.localStorage?.getItem(STORAGE_KEY) || "";
}

function setStoredKey(value) {
  storage()?.setItem(STORAGE_KEY, value);
  window.localStorage?.setItem(STORAGE_KEY, value);
}

function removeStoredKey() {
  storage()?.removeItem?.(STORAGE_KEY);
  window.localStorage?.removeItem(STORAGE_KEY);
}

function render(nextStatus) {
  status.value = nextStatus || status.value;
  syncRuntimeFromStatus(status.value);
}

function syncRuntimeFromStatus(nextStatus) {
  const current = nextStatus?.status || "";
  if (!current.startsWith("dependency_")) return;
  const latest = (nextStatus.events || []).slice().reverse().find((event) => event?.progress);
  const progress = latest?.progress || {};
  runtimeProgress.value = {
    phase: progress.phase || "",
    percent: Number(progress.percent || 0),
    downloaded: Number(progress.downloaded || 0),
    total: Number(progress.total || 0)
  };
  if (current === "dependency_downloading") {
    runtimeStatus.value = "downloading";
    runtimeMessage.value = progress.total
      ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
      : "正在下载客户端依赖";
  } else if (current === "dependency_extracting") {
    runtimeStatus.value = "extracting";
    runtimeMessage.value = `正在安装 ${runtimeProgress.value.percent}%`;
  } else {
    runtimeStatus.value = "checking";
    runtimeMessage.value = "正在准备客户端依赖";
  }
}

function loadSavedSettings() {
  activationKey.value = getStoredKey();
  boundKeyExists.value = Boolean(activationKey.value.trim());
}

function saveSettings() {
  const key = activationKey.value.trim();
  if (key) {
    setStoredKey(key);
    boundKeyExists.value = true;
  }
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function formatBandwidthForCustomer(value) {
  const text = String(value || "").trim();
  if (!text || text === "0") return "不限速";
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(K|KB|M|MB)(?:\/S)?$/i);
  if (!match) return text;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return text;
  const unit = match[2].toUpperCase();
  const mbps = unit.startsWith("M") ? amount * 8 : amount * 8 / 1024;
  return `${formatBandwidthNumber(mbps)} Mbps`;
}

function formatBandwidthNumber(value) {
  return Math.abs(value - Math.round(value)) < 0.000001
    ? String(Math.round(value))
    : value.toFixed(2).replace(/\.?0+$/, "");
}

function applyRuntimeStatus(info) {
  runtimeVersion.value = info?.version || "";
  runtimeLatestVersion.value = info?.latestVersion || "";
  if (info?.ready) {
    runtimeStatus.value = "ready";
    runtimeMessage.value = info.message || "";
    runtimeProgress.value = { phase: "", percent: 100, downloaded: 0, total: 0 };
    return true;
  }
  runtimeStatus.value = info?.status || "missing";
  runtimeMessage.value = info?.message || "需要下载客户端依赖后才能启动";
  runtimeProgress.value = { phase: "", percent: 0, downloaded: 0, total: 0 };
  return false;
}

async function refreshRuntimeStatus() {
  runtimeStatus.value = "checking";
  runtimeMessage.value = "正在检查客户端依赖";
  try {
    return applyRuntimeStatus(await window.zosenlinkTunnel.checkClientRuntime());
  } catch (error) {
    runtimeStatus.value = "error";
    runtimeMessage.value = error.message || String(error);
    return false;
  }
}

async function downloadRuntime() {
  runtimeStatus.value = "checking";
  runtimeMessage.value = "正在获取客户端版本";
  runtimeProgress.value = { phase: "metadata", percent: 0, downloaded: 0, total: 0 };
  try {
    const info = await window.zosenlinkTunnel.installClientRuntime((progress = {}) => {
      const phase = progress.phase || "";
      runtimeProgress.value = {
        phase,
        percent: Number(progress.percent || 0),
        downloaded: Number(progress.downloaded || 0),
        total: Number(progress.total || 0)
      };
      if (phase === "download") {
        runtimeStatus.value = "downloading";
        runtimeMessage.value = progress.total
          ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
          : "正在下载客户端依赖";
      } else if (phase === "extract") {
        runtimeStatus.value = "extracting";
        runtimeMessage.value = `正在安装 ${runtimeProgress.value.percent}%`;
      } else if (phase === "done") {
        runtimeStatus.value = "ready";
        runtimeMessage.value = "";
      }
    });
    applyRuntimeStatus({ ...info, ready: true, status: "ready" });
    showToast("客户端依赖已就绪");
    return true;
  } catch (error) {
    runtimeStatus.value = "error";
    runtimeMessage.value = error.message || String(error);
    return false;
  }
}

async function startClient() {
  try {
    formError.value = "";
    const nextStatus = await window.zosenlinkTunnel.start(activationKey.value);
    saveSettings();
    applyRuntimeStatus({
      ready: true,
      status: "ready",
      version: nextStatus.runtimeVersion,
      path: nextStatus.runtimePath
    });
    render(nextStatus);
  } catch (error) {
    formError.value = error.message || String(error);
    await refreshRuntimeStatus();
  }
}

function rebindClient() {
  window.zosenlinkTunnel.reset?.();
  removeStoredKey();
  activationKey.value = "";
  boundKeyExists.value = false;
  render(window.zosenlinkTunnel.getStatus());
  formError.value = "";
}

function clearEvents() {
  render(window.zosenlinkTunnel.clearEvents());
}

function openOfficialSite() {
  window.ztools?.shellOpenExternal?.("http://39.106.140.106/");
}

function copyRemote(value) {
  if (!value) return;
  window.ztools?.copyText?.(value);
  copiedValue.value = value;
  showToast("访问地址已复制");
  setTimeout(() => {
    if (copiedValue.value === value) copiedValue.value = "";
  }, 1200);
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.value = message;
  toastTimer = setTimeout(() => {
    toast.value = "";
  }, 1500);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function eventMessage(event) {
  return event.error || event.message || event.frpsServer || "";
}

function friendlyError(error) {
  const raw = String(error || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.includes("unauthorized") || raw.includes("认证失败") || raw.includes("登录已过期")) return "激活密钥无效或已失效";
  if (raw.includes("Activation Key 不能为空") || raw.includes("激活密钥不能为空") || lower.includes("activation key") && lower.includes("empty")) return "请输入激活密钥";
  if (lower.includes("connection refused") || lower.includes("no route to host") || lower.includes("network is unreachable")) return "无法连接服务，请检查网络后重试";
  if (lower.includes("timeout") || lower.includes("deadline exceeded") || lower.includes("i/o timeout")) return "连接超时，请稍后重试";
  if (lower.includes("no such host")) return "服务地址解析失败，请检查网络后重试";
  if (lower.includes("internal server error") || lower.includes("status 500")) return "服务暂时不可用，请稍后重试";
  if (lower.includes("status 502") || lower.includes("status 503") || lower.includes("status 504")) return "服务暂时不可用，请稍后重试";
  if (lower.includes("not found")) return "客户端不存在或激活密钥无效";
  if (lower.includes("forbidden")) return "当前账号无权使用该客户端";
  if (lower.includes("bad request") || lower.includes("invalid")) return "请求参数无效，请检查激活密钥";
  if (lower.includes("post ") || lower.includes("get ") || lower.includes("http://") || lower.includes("https://")) return "请求失败，请稍后重试";
  return raw;
}

onMounted(() => {
  loadSavedSettings();
  window.addEventListener("zosenlink-tunnel:plugin-enter", () => {
    render(window.zosenlinkTunnel.getStatus());
    autoStartSavedClient();
  });
  window.zosenlinkTunnel.onStatusChange(render);
  render(window.zosenlinkTunnel.getStatus());
  refreshRuntimeStatus();
  autoStartSavedClient();
});

async function autoStartSavedClient() {
  if (status.value.running || status.value.clientId) return;
  const savedKey = getStoredKey().trim();
  if (!savedKey) return;
  activationKey.value = savedKey;
  boundKeyExists.value = true;
  try {
    formError.value = "";
    const nextStatus = await window.zosenlinkTunnel.start(savedKey);
    applyRuntimeStatus({
      ready: true,
      status: "ready",
      version: nextStatus.runtimeVersion,
      path: nextStatus.runtimePath
    });
    render(nextStatus);
  } catch (error) {
    formError.value = error.message || String(error);
    await refreshRuntimeStatus();
  }
}
</script>
