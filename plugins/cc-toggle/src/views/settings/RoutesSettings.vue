<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
  import { useProviders } from '../../composables/useProviders';
  import { useRoutes } from '../../composables/useRoutes';

  const message = useMessage();
  const { APP_LABELS, activeTab, providers, loadProviders } = useProviders();
  const { runtime, refreshStatus, getProxyPort, setProxyPort } = useRoutes();

  const currentApp = computed(() => activeTab());
  const rt = computed(() => runtime[currentApp.value] || {});
  const isRunning = computed(() => !!rt.value.running);

  // Port editing
  const portInput = ref(8788);
  function syncPort() {
    portInput.value = isRunning.value
      ? rt.value.port || getProxyPort(currentApp.value)
      : getProxyPort(currentApp.value);
  }
  function onSavePort() {
    const r = setProxyPort(currentApp.value, Number(portInput.value));
    if (r.success) {
      message.success('代理端口已保存：' + r.port);
    } else {
      message.error(
        r.error === 'proxy is running' ? '运行中无法修改' : '保存失败：' + (r.error || 'unknown')
      );
    }
  }

  // Address & copy
  const proxyUrl = computed(
    () => 'http://127.0.0.1:' + (isRunning.value ? rt.value.port : portInput.value)
  );
  const copied = ref(false);
  function copyUrl() {
    try {
      if (window.ztools?.copyText) window.ztools.copyText(proxyUrl.value);
      else navigator.clipboard?.writeText(proxyUrl.value);
      copied.value = true;
      setTimeout(() => (copied.value = false), 1500);
    } catch (e) {}
  }

  // Current provider / model
  const activeProvider = computed(() => {
    const members = rt.value.members || [];
    if (!members.length) return null;
    const id = rt.value.lastMemberId;
    return members.find(m => m.id === id) || members[0];
  });
  const activeModel = computed(() => {
    const ap = activeProvider.value;
    if (!ap) return '';
    const p = (providers.value || []).find(x => x.id === ap.id);
    return p?.model || '';
  });

  // Metrics
  const now = ref(Date.now());
  let timer = null;
  const successRate = computed(() => {
    const done = (rt.value.reqSuccess || 0) + (rt.value.reqFail || 0);
    if (!done) return '-';
    return Math.round(((rt.value.reqSuccess || 0) / done) * 100) + '%';
  });
  const uptime = computed(() => {
    if (!isRunning.value || !rt.value.startedAt) return '-';
    let s = Math.max(0, Math.floor((now.value - rt.value.startedAt) / 1000));
    const h = Math.floor(s / 3600);
    s -= h * 3600;
    const m = Math.floor(s / 60);
    s -= m * 60;
    const pad = n => String(n).padStart(2, '0');
    return (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(s);
  });

  // Member state
  const stateTypeMap = { closed: 'success', 'half-open': 'warning', open: 'error' };
  const stateLabelMap = { closed: '正常', 'half-open': '半开', open: '断开' };
  function memberState(m) {
    if (m.up === false) return 'open';
    return m.state || 'closed';
  }

  function reload() {
    refreshStatus(currentApp.value);
    loadProviders();
    syncPort();
    console.log('[DEBUG] UI reload, rt:', {
      running: rt.value.running,
      port: rt.value.port,
      reqTotal: rt.value.reqTotal,
      reqSuccess: rt.value.reqSuccess,
      members: rt.value.members?.map(m => ({
        id: m.id,
        name: m.name,
        latency: m.latency,
        up: m.up,
        state: m.state
      }))
    });
  }
  onMounted(() => {
    reload();
    timer = setInterval(() => {
      now.value = Date.now();
      refreshStatus(currentApp.value);
    }, 1000);
  });
  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });
  watch(currentApp, reload);
  watch(isRunning, syncPort);
</script>

<template>
  <div class="routes-page">
    <!-- Hero -->
    <div class="routes-hero" :class="{ 'routes-hero--running': isRunning }">
      <div class="hero-head">
        <n-tag :type="isRunning ? 'success' : 'default'" size="small" round :bordered="false">
          <template #icon>
            <span v-if="isRunning" class="hero-dot hero-dot--live">●</span>
            <span v-else style="margin-right: 4px">○</span>
          </template>
          {{ isRunning ? '运行中' : '已停止' }}
        </n-tag>
        <n-text strong style="font-size: 14px">{{ APP_LABELS[currentApp] }} 代理</n-text>
      </div>

      <!-- 运行时：地址栏 -->
      <div v-if="isRunning" class="hero-url">
        <span class="hero-url-text">{{ proxyUrl }}</span>
        <n-button size="tiny" quaternary @click="copyUrl" :type="copied ? 'success' : 'default'">
          {{ copied ? '✓ 已复制' : '复制' }}
        </n-button>
      </div>

      <!-- 停止时：端口配置 -->
      <div v-else class="hero-url">
        <span class="port-prefix">127.0.0.1:</span>
        <n-input-number
          v-model:value="portInput"
          :min="1024"
          :max="65535"
          size="small"
          class="port-input"
          :show-button="false"
        />
        <n-button size="small" @click="copyUrl" :type="copied ? 'success' : 'default'">
          {{ copied ? '✓ 已复制' : '复制' }}
        </n-button>
        <n-button type="primary" size="small" @click="onSavePort">保存</n-button>
      </div>

      <!-- 运行时：使用信息 -->
      <div v-if="isRunning" class="hero-info">
        <span class="hero-info-item">
          <span class="hero-info-label">Agent</span>
          <span class="hero-info-value">{{ APP_LABELS[currentApp] }}</span>
        </span>
        <span class="hero-info-item">
          <span class="hero-info-label">供应商</span>
          <span class="hero-info-value" :class="{ 'hero-info-value--muted': !activeProvider }">
            {{ activeProvider ? activeProvider.name : '等待请求…' }}
          </span>
        </span>
        <span class="hero-info-item">
          <span class="hero-info-label">模型</span>
          <span
            class="hero-info-value hero-info-value--code"
            :class="{ 'hero-info-value--muted': !activeModel }"
          >
            {{ activeModel || '-' }}
          </span>
        </span>
      </div>

      <!-- 停止时：提示 -->
      <n-text v-else depth="3" style="font-size: 11px"
        >新端口将在下次启动代理时生效。从主页 TabBar 开启代理。</n-text
      >
    </div>

    <!-- 指标网格（运行时） -->
    <div v-if="isRunning" class="metrics-grid">
      <div class="metric-card">
        <div class="metric-accent metric-accent--green"></div>
        <div class="metric-value">
          {{ rt.activeConn || 0 }}<span class="metric-suffix"> 个</span>
        </div>
        <div class="metric-label">活跃连接</div>
      </div>
      <div class="metric-card">
        <div class="metric-accent metric-accent--blue"></div>
        <div class="metric-value">{{ rt.reqTotal || 0 }}<span class="metric-suffix"> 次</span></div>
        <div class="metric-label">请求数</div>
      </div>
      <div class="metric-card">
        <div class="metric-accent metric-accent--amber"></div>
        <div class="metric-value">{{ successRate }}</div>
        <div class="metric-label">成功率</div>
      </div>
      <div class="metric-card">
        <div class="metric-accent metric-accent--purple"></div>
        <div class="metric-value metric-value--mono">{{ uptime }}</div>
        <div class="metric-label">运行时长</div>
      </div>
    </div>

    <!-- 成员健康（运行时） -->
    <div v-if="isRunning" class="section-card">
      <div class="section-head">
        <n-text depth="2" style="font-size: 12px; font-weight: 600">成员健康</n-text>
        <n-tag v-if="rt.members && rt.members.length" size="tiny" :bordered="false" type="info">
          {{ rt.members.length }}
        </n-tag>
      </div>
      <n-empty v-if="!(rt.members && rt.members.length)" description="暂无成员数据" size="small" />
      <div v-else class="member-list">
        <div
          v-for="m in rt.members"
          :key="m.id"
          class="member-row"
          :class="'member-row--' + memberState(m)"
        >
          <n-badge :type="stateTypeMap[memberState(m)] || 'default'" dot :offset="[0, 0]" />
          <span class="member-name">{{ m.name }}</span>
          <n-tag
            :type="stateTypeMap[memberState(m)] || 'default'"
            size="tiny"
            :bordered="false"
            round
          >
            {{ stateLabelMap[memberState(m)] || memberState(m) }}
          </n-tag>
          <span class="member-latency">{{ m.latency || '-' }}ms</span>
          <n-tag v-if="m.fails" type="warning" size="tiny" :bordered="false">
            失败 {{ m.fails }}
          </n-tag>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .routes-page {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ── Hero ── */
  .routes-hero {
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--bg-card);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    transition: all 0.3s;
  }
  .routes-hero--running {
    border-color: #22c55e;
    position: relative;
    overflow: hidden;
  }
  .routes-hero--running::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: #22c55e;
  }
  .hero-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .hero-dot--live {
    color: #34d399;
    margin-right: 4px;
    animation: pulse-dot 2s ease-in-out infinite;
  }
  @keyframes pulse-dot {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
  .hero-url {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 14px;
  }
  .hero-url-text {
    flex: 1;
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    font-size: 13px;
    color: var(--text);
    letter-spacing: 0.02em;
  }
  .hero-info {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
  }
  .hero-info-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hero-info-label {
    font-size: 11px;
    color: var(--text-muted);
  }
  .hero-info-value {
    font-size: 12px;
    color: var(--text);
    font-weight: 500;
  }
  .hero-info-value--code {
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    font-size: 11px;
    padding: 1px 6px;
    background: var(--bg-hover);
    border-radius: 4px;
  }
  .hero-info-value--muted {
    color: var(--text-muted);
  }

  .port-prefix {
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .port-input {
    width: 90px;
  }

  /* ── Metrics Grid ── */
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .metric-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 14px 16px;
    text-align: center;
    position: relative;
    overflow: hidden;
    transition:
      transform 0.15s,
      box-shadow 0.15s;
  }
  .metric-card:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
  .metric-accent {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
  }
  .metric-accent--green {
    background: #22c55e;
  }
  .metric-accent--blue {
    background: #3b82f6;
  }
  .metric-accent--amber {
    background: #f59e0b;
  }
  .metric-accent--purple {
    background: #a855f7;
  }
  .metric-value {
    font-size: 24px;
    font-weight: 700;
    line-height: 1.2;
    color: var(--text);
    margin-bottom: 4px;
  }
  .metric-value--mono {
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    font-size: 20px;
    letter-spacing: 0.03em;
  }
  .metric-suffix {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
  }
  .metric-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  /* ── Section Card ── */
  .section-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 14px 16px;
  }
  .section-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }

  /* ── Member List ── */
  .member-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .member-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    border-left: 3px solid transparent;
    transition: all 0.2s;
  }
  .member-row:hover {
    background: var(--bg-hover);
    transform: translateX(2px);
  }
  .member-row--closed {
    border-left-color: #22c55e;
  }
  .member-row--half-open {
    border-left-color: #f59e0b;
  }
  .member-row--open {
    border-left-color: #ef4444;
    opacity: 0.7;
  }
  .member-name {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .member-latency {
    font-size: 11px;
    color: var(--text-muted);
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    min-width: 52px;
    text-align: right;
  }
</style>
