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
            <div class="logo-wrapper">
              <div class="logo-icon">
                <img src="/logo.png" alt="PicList" class="logo" />
              </div>
            </div>
            <h1>PicList 图片上传</h1>
            <p class="subtitle">便捷的图床图片上传工具</p>
          </div>

          <el-card class="info-card">
            <h2>功能介绍</h2>
            <ul class="feature-list">
              <li>
                <span class="icon">📤</span>
                <span>支持本地文件选择和拖拽上传</span>
              </li>
              <li>
                <span class="icon">🖼️</span>
                <span>多图片同时上传支持</span>
              </li>
              <li>
                <span class="icon">📋</span>
                <span>多种复制格式支持（Markdown/HTML/URL/UBB/自定义）</span>
              </li>
              <li>
                <span class="icon">⏰</span>
                <span>上传历史记录管理</span>
              </li>
              <li>
                <span class="icon">⚙️</span>
                <span>自定义 PicList 服务配置</span>
              </li>
              <li>
                <span class="icon">🔐</span>
                <span>支持 API Key 鉴权</span>
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
              <el-tag type="info">PicList</el-tag>
            </div>
          </el-card>

          <el-card class="links-card">
            <h2>相关链接</h2>
            <div class="link-list"> 
              <a href="https://github.com/wangbin-blog/ztools-piclist-plugin" target="_blank" class="link-item">
                <span>PicList 开源仓库</span>
              </a>
              <a href="https://piclist.cn" target="_blank" class="link-item">
                <span>PicList 官方网站</span>
              </a>
              <a href="https://ztoolscenter.github.io/ZTools-doc/" target="_blank" class="link-item">
                <span>ZTools 文档</span>
              </a>
            </div>
          </el-card>

          <div class="footer">
            <p>Made with ❤️ for PicList & ZTools</p>
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

.logo-wrapper {
  margin-bottom: 20px;
}

.logo-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100px;
  height: 100px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.logo {
  width: 64px;
  height: 64px;
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
