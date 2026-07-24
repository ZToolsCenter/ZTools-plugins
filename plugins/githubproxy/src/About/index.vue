<script lang="ts" setup>
import Header from '../components/Header/index.vue'
</script>

<template>
  <div class="about">
    <el-container>
      <Header current-view="about" @navigate="$emit('navigate', $event)" />

      <el-main>
        <div class="about-content">
          <div class="logo-section">
            <img src="/logo.png" alt="Github Proxy" class="logo" />
            <h1>Github Proxy</h1>
            <p class="subtitle">GitHub 文件代理加速工具</p>
          </div>

          <el-card class="info-card">
            <h2>功能介绍</h2>
            <ul class="feature-list">
              <li>
                <span class="icon">🔧</span>
                <span>支持多个代理服务器选择</span>
              </li>
              <li>
                <span class="icon">⚡</span>
                <span>自动生成 Git Clone / Wget / Curl 命令</span>
              </li>
              <li>
                <span class="icon">📥</span>
                <span>支持直接下载文件到本地</span>
              </li>
              <li>
                <span class="icon">⏱️</span>
                <span>代理服务器响应速度测试</span>
              </li>
              <li>
                <span class="icon">💾</span>
                <span>数据自动持久化存储</span>
              </li>
            </ul>
          </el-card>

          <el-card class="tech-card">
            <h2>技术栈</h2>
            <div class="tech-tags">
              <el-tag type="primary">Vue 3</el-tag>
              <el-tag type="success">TypeScript</el-tag>
              <el-tag type="warning">Vite</el-tag>
              <el-tag type="danger">Element Plus</el-tag>
              <el-tag>ZTools API</el-tag>
            </div>
          </el-card>

          <el-card class="links-card">
            <h2>相关链接</h2>
            <div class="link-list">
              <a href="https://github.com/wangbin-blog/ztools-githubproxy" target="_blank" class="link-item">
                <span>GitHub</span>
              </a>
            </div>
          </el-card>

          <div class="footer">
            <p>Made with ❤️ for GitHub thinkw</p>
          </div>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<style scoped>
.about {
  width: 100%;
  height: 100%;
}

.el-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.el-main {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  box-sizing: border-box;
  background-color: var(--bg-secondary);
}

.about-content {
  max-width: 600px;
  margin: 0 auto;
}

.logo-section {
  text-align: center;
  margin-bottom: 32px;
}

.logo {
  width: 120px;
  height: 120px;
  border-radius: 16px;
  margin-bottom: 16px;
}

.logo-section h1 {
  margin: 0 0 8px 0;
  font-size: 32px;
  font-weight: bold;
  color: var(--text-primary);
}

.subtitle {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.info-card,
.tech-card,
.links-card {
  margin-bottom: 16px;
}

.info-card h2,
.tech-card h2,
.links-card h2 {
  margin: 0 0 16px 0;
  font-size: 18px;
  color: var(--text-primary);
}

.feature-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.feature-list li {
  display: flex;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
}

.feature-list li:last-child {
  border-bottom: none;
}

.icon {
  font-size: 20px;
  margin-right: 12px;
}

.tech-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.link-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.link-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #409eff;
  text-decoration: none;
  padding: 8px 12px;
  border-radius: 8px;
  transition: background-color 0.2s;
}

.link-item:hover {
  background-color: rgba(64, 158, 255, 0.1);
}

.footer {
  text-align: center;
  padding: 24px 0;
  color: var(--text-secondary);
}

.footer p {
  margin: 8px 0;
  font-size: 14px;
}

.version {
  font-size: 12px;
}
</style>