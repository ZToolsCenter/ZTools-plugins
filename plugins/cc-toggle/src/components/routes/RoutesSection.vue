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

  // —— 端口编辑 ——
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

  // —— 地址 & 复制 ——
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

  // —— 当前使用的 provider / 模型 ——
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

  // —— 指标 ——
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

  // 成员状态映射
  const stateTypeMap = {
    closed: 'success',
    'half-open': 'warning',
    open: 'error'
  };
  const stateLabelMap = {
    closed: '正常',
    'half-open': '半开',
    open: '断开'
  };

  function reload() {
    refreshStatus(currentApp.value);
    loadProviders();
    syncPort();
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
  <n-space vertical :size="12" class="routes-section">
    <!-- 1. 状态 -->
    <n-space align="center" :size="10">
      <n-tag :type="isRunning ? 'success' : 'default'" size="small" round :bordered="false">
        <template #icon>
          <span style="margin-right: 4px">{{ isRunning ? '●' : '○' }}</span>
        </template>
        {{ isRunning ? '运行中' : '已停止' }}
      </n-tag>
      <n-text strong style="font-size: 14px">{{ APP_LABELS[currentApp] }} 代理</n-text>
    </n-space>

    <!-- 2. 代理地址 + 复制 / 编辑 -->
    <n-card size="small" :bordered="true" :hoverable="true">
      <template #header>
        <n-text depth="2" style="font-size: 12px; font-weight: 600">代理地址</n-text>
      </template>
      <n-space align="center" :size="8" wrap>
        <template v-if="isRunning">
          <n-code :code="proxyUrl" language="text" :word-wrap="true" style="flex: 1" />
          <n-button size="small" @click="copyUrl" :type="copied ? 'success' : 'default'">
            {{ copied ? '✓ 已复制' : '复制' }}
          </n-button>
        </template>
        <template v-else>
          <n-text depth="3" style="font-family: monospace; font-size: 12px"
            >http://127.0.0.1:</n-text
          >
          <n-input-number
            v-model:value="portInput"
            :min="1024"
            :max="65535"
            size="small"
            style="width: 100px"
            :show-button="false"
          />
          <n-button size="small" @click="copyUrl" :type="copied ? 'success' : 'default'">
            {{ copied ? '✓ 已复制' : '复制' }}
          </n-button>
          <n-button type="primary" size="small" @click="onSavePort">保存</n-button>
        </template>
      </n-space>
      <template #footer>
        <n-text v-if="isRunning" depth="3" style="font-size: 11px">
          运行中不可修改，关闭代理后可编辑端口。
        </n-text>
        <n-text v-else depth="3" style="font-size: 11px">
          修改端口后点「保存」生效（下次开启代理时使用）。
        </n-text>
      </template>
    </n-card>

    <!-- 3. 当前使用 -->
    <n-card size="small" :bordered="true" :hoverable="true">
      <template #header>
        <n-text depth="2" style="font-size: 12px; font-weight: 600">当前使用</n-text>
      </template>
      <n-descriptions
        label-placement="left"
        :column="1"
        size="small"
        :bordered="true"
        label-style="font-weight: 500; color: var(--n-text-color-2); width: 70px;"
      >
        <n-descriptions-item label="Agent">{{ APP_LABELS[currentApp] }}</n-descriptions-item>
        <n-descriptions-item label="供应商">
          <n-text :type="activeProvider ? 'default' : 'warning'">
            {{ activeProvider ? activeProvider.name : isRunning ? '等待请求…' : '-' }}
          </n-text>
        </n-descriptions-item>
        <n-descriptions-item label="模型">
          <n-text v-if="activeModel" code>{{ activeModel }}</n-text>
          <n-text v-else depth="3">-</n-text>
        </n-descriptions-item>
      </n-descriptions>
    </n-card>

    <!-- 4. 指标 -->
    <n-grid :cols="4" :x-gap="8" :y-gap="8">
      <n-gi>
        <n-card size="small" :bordered="true" :hoverable="true" style="text-align: center">
          <n-statistic label="活跃连接" :value="rt.activeConn || 0">
            <template #suffix>
              <n-text depth="3" style="font-size: 11px">个</n-text>
            </template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card size="small" :bordered="true" :hoverable="true" style="text-align: center">
          <n-statistic label="请求数" :value="rt.reqTotal || 0">
            <template #suffix>
              <n-text depth="3" style="font-size: 11px">次</n-text>
            </template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card size="small" :bordered="true" :hoverable="true" style="text-align: center">
          <n-statistic label="成功率" :value="successRate" />
        </n-card>
      </n-gi>
      <n-gi>
        <n-card size="small" :bordered="true" :hoverable="true" style="text-align: center">
          <n-statistic label="运行时长" :value="uptime" />
        </n-card>
      </n-gi>
    </n-grid>

    <!-- 5. 成员健康 -->
    <n-card v-if="isRunning" size="small" :bordered="true">
      <template #header>
        <n-space align="center" :size="6">
          <n-text depth="2" style="font-size: 12px; font-weight: 600">成员健康</n-text>
          <n-tag v-if="rt.members && rt.members.length" size="tiny" :bordered="false" type="info">
            {{ rt.members.length }}
          </n-tag>
        </n-space>
      </template>
      <n-empty v-if="!(rt.members && rt.members.length)" description="暂无成员数据" size="small" />
      <n-list v-else :show-divider="true" size="small">
        <n-list-item v-for="m in rt.members" :key="m.id">
          <n-space align="center" :size="10" style="width: 100%">
            <n-badge :type="stateTypeMap[m.state] || 'default'" dot :offset="[0, 0]" />
            <n-text strong style="flex: 1; font-size: 12px">{{ m.name }}</n-text>
            <n-tag :type="stateTypeMap[m.state] || 'default'" size="tiny" :bordered="false" round>
              {{ stateLabelMap[m.state] || m.state }}
            </n-tag>
            <n-text depth="3" style="font-size: 11px; min-width: 50px; text-align: right">
              {{ m.latency || '-' }}ms
            </n-text>
            <n-tag v-if="m.fails" type="warning" size="tiny" :bordered="false">
              失败 {{ m.fails }}
            </n-tag>
          </n-space>
        </n-list-item>
      </n-list>
    </n-card>

    <!-- 6. 实时日志 -->
    <n-card v-if="isRunning" size="small" :bordered="true">
      <template #header>
        <n-space align="center" :size="6">
          <n-text depth="2" style="font-size: 12px; font-weight: 600">实时日志</n-text>
          <n-tag v-if="rt.logs && rt.logs.length" size="tiny" :bordered="false" type="info">
            {{ rt.logs.length }}
          </n-tag>
        </n-space>
      </template>
      <n-scrollbar style="max-height: 200px">
        <n-log
          v-if="rt.logs && rt.logs.length"
          :log="
            (rt.logs || [])
              .slice(-50)
              .map(
                l =>
                  `[${new Date(l.ts).toLocaleTimeString()}] ${l.msg}${l.meta ? ' · ' + JSON.stringify(l.meta) : ''}`
              )
              .join('\n')
          "
          language="text"
          :rows="8"
          :font-size="11"
        />
        <n-empty v-else description="暂无日志" size="small" />
      </n-scrollbar>
    </n-card>

    <n-alert
      v-if="!isRunning"
      type="info"
      :show-icon="true"
      :bordered="false"
      style="text-align: center"
    >
      <n-text depth="2" style="font-size: 12px"
        >代理未启动。在主页 TabBar 点击「代理」开关即可开启。</n-text
      >
    </n-alert>
  </n-space>
</template>

<style scoped>
  .routes-section {
    padding: 0;
  }
</style>
