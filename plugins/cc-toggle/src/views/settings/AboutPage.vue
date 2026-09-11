<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { ref, onMounted } from 'vue';
  import { useProviders } from '../../composables/useProviders';

  const { providers } = useProviders();

  const version = ref('1.5.0');
  const electronVersion = ref('');
  const nodeVersion = ref('');
  const osInfo = ref('');

  onMounted(() => {
    try {
      electronVersion.value = process.versions?.electron || 'N/A';
      nodeVersion.value = process.versions?.node || 'N/A';
      // 从 userAgent 提取系统信息
      const ua = window.navigator.userAgent;
      const platform = window.navigator.platform;
      if (ua.includes('Windows NT 10.0')) {
        // Windows 10/11 都是 NT 10.0，通过 build 号区分
        const build = ua.match(/Windows NT 10\.0\.(\d+)/)?.[1];
        osInfo.value = build && parseInt(build) >= 22000 ? 'Windows 11' : 'Windows 10';
      } else if (ua.includes('Windows')) {
        osInfo.value = 'Windows';
      } else if (ua.includes('Mac')) {
        osInfo.value = 'macOS';
      } else if (ua.includes('Linux')) {
        osInfo.value = 'Linux';
      } else {
        osInfo.value = platform || 'N/A';
      }
    } catch (e) {}
  });

  const links = [
    { label: 'GitHub', url: 'https://github.com/Cifferni/zTools-ccToggle', desc: '项目仓库' },
    {
      label: '反馈问题',
      url: 'https://github.com/Cifferni/zTools-ccToggle/issues',
      desc: '提交 Issue'
    }
  ];

  function openUrl(url) {
    try {
      window.ztools?.shellOpenExternal?.(url) || window.open(url, '_blank');
    } catch (e) {}
  }
</script>

<template>
  <div class="about-page">
    <!-- 头部 -->
    <div class="about-header">
      <img src="/logo.png" alt="CCToggle" class="about-logo" />
      <div class="about-info">
        <h2 class="about-title">
          CCToggle <n-tag size="tiny" :bordered="false">v{{ version }}</n-tag>
        </h2>
        <n-text depth="3" class="about-desc">AI CLI 一键切换工具</n-text>
      </div>
    </div>

    <!-- 运行环境 -->
    <n-card size="small" title="运行环境">
      <div class="info-grid">
        <div class="info-item">
          <n-text depth="3" class="info-label">Electron</n-text>
          <n-text code>{{ electronVersion }}</n-text>
        </div>
        <div class="info-item">
          <n-text depth="3" class="info-label">Node.js</n-text>
          <n-text code>{{ nodeVersion }}</n-text>
        </div>
        <div class="info-item">
          <n-text depth="3" class="info-label">系统</n-text>
          <n-text code>{{ osInfo }}</n-text>
        </div>
        <div class="info-item">
          <n-text depth="3" class="info-label">供应商</n-text>
          <n-text code>{{ providers.length }} 个</n-text>
        </div>
      </div>
    </n-card>

    <!-- 相关链接 -->
    <n-card size="small" title="相关链接">
      <div class="link-list">
        <div v-for="link in links" :key="link.label" class="link-item" @click="openUrl(link.url)">
          <div class="link-info">
            <span class="link-label">{{ link.label }}</span>
            <n-text depth="3" class="link-desc">{{ link.desc }}</n-text>
          </div>
          <n-text depth="3" class="link-url">{{ link.url }}</n-text>
        </div>
      </div>
    </n-card>

    <!-- 底部 -->
    <div class="about-footer">
      <n-text depth="3">Made with ❤️ by Cifferni</n-text>
    </div>
  </div>
</template>

<style scoped>
  .about-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .about-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 0;
  }

  .about-logo {
    width: 56px;
    height: 56px;
    flex-shrink: 0;
  }

  .about-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .about-title {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .about-desc {
    font-size: 13px;
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .info-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .info-label {
    font-size: 12px;
  }

  .link-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .link-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--bg-hover);
    border-radius: var(--radius);
    cursor: pointer;
    transition: all 0.15s;
  }

  .link-item:hover {
    background: var(--bg-active);
  }

  .link-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .link-label {
    font-size: 13px;
    font-weight: 500;
  }

  .link-desc {
    font-size: 11px;
  }

  .link-url {
    font-size: 11px;
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  }

  .about-footer {
    text-align: center;
    padding: 8px 0;
  }
</style>
